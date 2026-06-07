package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

var (
	loginAttempts = struct {
		sync.Mutex
		ipMap   map[string][]time.Time
		userMap map[string][]time.Time
	}{
		ipMap:   make(map[string][]time.Time),
		userMap: make(map[string][]time.Time),
	}
)

// CheckRateLimit 检查特定 IP 和用户名的登录尝试频率是否超标 (15分钟窗口)
func CheckRateLimit(ip, username string) error {
	loginAttempts.Lock()
	defer loginAttempts.Unlock()

	now := time.Now()
	window := 15 * time.Minute

	// 清理 IP 记录
	var validIPs []time.Time
	for _, t := range loginAttempts.ipMap[ip] {
		if now.Sub(t) < window {
			validIPs = append(validIPs, t)
		}
	}
	loginAttempts.ipMap[ip] = validIPs

	// 清理用户名记录
	var validUsers []time.Time
	for _, t := range loginAttempts.userMap[username] {
		if now.Sub(t) < window {
			validUsers = append(validUsers, t)
		}
	}
	loginAttempts.userMap[username] = validUsers

	if len(loginAttempts.ipMap[ip]) >= 15 {
		return fmt.Errorf("登录尝试过于频繁，请稍后再试")
	}
	if len(loginAttempts.userMap[username]) >= 5 {
		return fmt.Errorf("该账号登录尝试过于频繁，请稍后再试")
	}

	loginAttempts.ipMap[ip] = append(loginAttempts.ipMap[ip], now)
	loginAttempts.userMap[username] = append(loginAttempts.userMap[username], now)
	return nil
}

// RequireAdmin 中间件：校验 Admin-Key
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		apiKey := GetAPIKey()
		xAdminKey := c.GetHeader("X-Admin-Key")
		adminToken, err := c.Cookie("admin_token")

		if (xAdminKey != "" && xAdminKey == apiKey) || (err == nil && adminToken == apiKey) {
			c.Next()
			return
		}

		c.JSON(http.StatusUnauthorized, gin.H{"detail": "管理认证失败：需要有效的 API 密钥"})
		c.Abort()
	}
}

// RegisterAPIRoutes 注册全部路由
func RegisterAPIRoutes(r *gin.Engine) {
	setupRoutes(r.Group("/api"))
}

func setupRoutes(apiGroup *gin.RouterGroup) {
	// 1. 会话与登录相关
	apiGroup.POST("/session", createSessionHandler)
	apiGroup.GET("/organizations", getOrganizationsHandler)
	apiGroup.POST("/captcha", getCaptchaHandler)
	apiGroup.POST("/login", loginHandler)

	// 2. 成绩拉取相关 (需登录校验)
	apiGroup.GET("/exams", requireLoginMiddleware(), getExamsHandler)
	apiGroup.GET("/scores/all", requireLoginMiddleware(), getAllScoresHandler)
	apiGroup.GET("/scores/:exam_index", requireLoginMiddleware(), getScoresHandler)
	apiGroup.GET("/scores/:exam_index/subject/:subject_code", requireLoginMiddleware(), getSubjectDetailHandler)
	apiGroup.GET("/scores/:exam_index/sheet/:subject_code", requireLoginMiddleware(), getAnswerSheetHandler)

	// 3. 通用辅助
	apiGroup.GET("/proxy/image", proxyImageHandler)

	// 4. 配置修改相关 (需 Admin-Key 校验)
	apiGroup.GET("/config", requireConfigOrAdminMiddleware(), getConfigHandler)
	apiGroup.POST("/config", RequireAdmin(), saveConfigHandler)
	apiGroup.POST("/config/scores", RequireAdmin(), saveConfigScoresHandler)

	// 5. 自动监控服务相关 (需 Admin-Key 校验)
	apiGroup.GET("/monitor/status", getMonitorStatusHandler)
	apiGroup.POST("/monitor/start", RequireAdmin(), startMonitorHandler)
	apiGroup.POST("/monitor/stop", RequireAdmin(), stopMonitorHandler)
	apiGroup.POST("/monitor/check", RequireAdmin(), checkMonitorHandler)

	// 6. Telegram 消息测试
	apiGroup.POST("/telegram", requireLoginMiddleware(), testTelegramHandler)
	apiGroup.POST("/telegram/send", RequireAdmin(), sendTelegramHandler)
}

// 登录校验中间件
func requireLoginMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		sid := c.Query("session_id")
		if sid == "" {
			sid = c.PostForm("session_id")
		}

		if sid == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"detail": "缺少 session_id 参数"})
			c.Abort()
			return
		}

		sess, err := GetSession(sid)
		if err != nil || !sess.LoggedIn {
			c.JSON(http.StatusUnauthorized, gin.H{"detail": "请先登录或会话已过期"})
			c.Abort()
			return
		}

		c.Set("session", sess)
		c.Next()
	}
}

// 对于 GET /api/config，若已经配过密码，且请求没带 admin key，可以只读，但由于原逻辑，非敏感直接脱敏后可以读
func requireConfigOrAdminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 无需严格 RequireAdmin，我们直接在 Handler 里面脱敏即可，与 FastAPI 保持一致
		c.Next()
	}
}

// Handler: 创建会话
func createSessionHandler(c *gin.Context) {
	// 先做一次会话清理
	CleanExpiredSessions()

	sid := uuid.New().String()
	sid = strings.ReplaceAll(sid, "-", "")

	sess, err := GetSession(sid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": err.Error()})
		return
	}

	if err := sess.InitCookie(); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"detail": fmt.Sprintf("无法连接云阅卷平台: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{"session_id": sid})
}

// Handler: 获取学校机构列表
func getOrganizationsHandler(c *gin.Context) {
	// 每次临时新起请求
	sess, err := GetSession("temp_" + uuid.New().String())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": err.Error()})
		return
	}
	defer sessionsMap.Delete(sess.ID)

	if err := sess.InitCookie(); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"detail": err.Error()})
		return
	}

	body, err := sess.postForm(BASE+"/system_xsloginsllist.do", nil, "")
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"detail": fmt.Sprintf("获取机构列表错误: %v", err)})
		return
	}

	var res map[string]interface{}
	if err := json.Unmarshal(body, &res); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "解析 JSON 错误"})
		return
	}

	if b, ok := res["res"].(bool); ok && b {
		list, _ := res["list_result"].([]interface{})
		var orgs []map[string]string
		for _, o := range list {
			m, _ := o.(map[string]interface{})
			id, _ := m["SLID"].(string)
			name, _ := m["SLMC"].(string)
			if name == "" {
				name = id
			}
			orgs = append(orgs, map[string]string{"id": id, "name": name})
		}
		c.JSON(http.StatusOK, gin.H{"orgs": orgs})
		return
	}

	msg, _ := res["msg"].(string)
	c.JSON(http.StatusOK, gin.H{"orgs": []interface{}{}, "error": msg})
}

// Handler: 获取图形验证码
func getCaptchaHandler(c *gin.Context) {
	sid := c.PostForm("session_id")
	if sid == "" {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "缺少 session_id"})
		return
	}

	sess, err := GetSession(sid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"detail": "会话不存在"})
		return
	}

	imgBytes, ct, err := sess.GetCaptchaBytes()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"detail": fmt.Sprintf("获取验证码网络失败: %v", err)})
		return
	}

	b64Data := fmt.Sprintf("data:%s;base64,%s", ct, strings.TrimSpace(strings.ReplaceAll(string(encodeBase64(imgBytes)), "\n", "")))

	// 自动识别 (本地有 Python 且装了 ddddocr 时)
	captchaText := ""
	hasOCR := HasLocalPythonOCR()
	if hasOCR {
		if text, err := RecognizeCaptcha(imgBytes, ""); err == nil {
			captchaText = text
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"captcha_image":  b64Data,
		"captcha_text":   captchaText,
		"ocr_available":  hasOCR,
	})
}

// base64 简易编码
func encodeBase64(data []byte) []byte {
	const encodeStd = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	var buf bytes.Buffer
	w := &base64Encoder{w: &buf, enc: encodeStd}
	w.Write(data)
	w.Close()
	return buf.Bytes()
}

type base64Encoder struct {
	w   *bytes.Buffer
	enc string
	buf [3]byte
	nb  int
}

func (e *base64Encoder) Write(p []byte) (int, error) {
	for i, b := range p {
		e.buf[e.nb] = b
		e.nb++
		if e.nb == 3 {
			e.writeBlock()
			e.nb = 0
		}
		if i == len(p)-1 {
			return len(p), nil
		}
	}
	return len(p), nil
}

func (e *base64Encoder) writeBlock() {
	val := uint32(e.buf[0])<<16 | uint32(e.buf[1])<<8 | uint32(e.buf[2])
	e.w.WriteByte(e.enc[val>>18&0x3F])
	e.w.WriteByte(e.enc[val>>12&0x3F])
	e.w.WriteByte(e.enc[val>>6&0x3F])
	e.w.WriteByte(e.enc[val&0x3F])
}

func (e *base64Encoder) Close() error {
	if e.nb > 0 {
		var val uint32
		if e.nb == 1 {
			val = uint32(e.buf[0]) << 16
			e.w.WriteByte(e.enc[val>>18&0x3F])
			e.w.WriteByte(e.enc[val>>12&0x3F])
			e.w.WriteByte('=')
			e.w.WriteByte('=')
		} else {
			val = uint32(e.buf[0])<<16 | uint32(e.buf[1])<<8
			e.w.WriteByte(e.enc[val>>18&0x3F])
			e.w.WriteByte(e.enc[val>>12&0x3F])
			e.w.WriteByte(e.enc[val>>6&0x3F])
			e.w.WriteByte('=')
		}
	}
	return nil
}

// Handler: 登录
func loginHandler(c *gin.Context) {
	sid := c.PostForm("session_id")
	orgID := c.PostForm("org_id")
	username := c.PostForm("username")
	password := c.PostForm("password")
	captcha := c.PostForm("captcha")

	if sid == "" || orgID == "" || username == "" || password == "" || captcha == "" {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "缺少必填登录参数"})
		return
	}

	// 频控校验
	ip := c.ClientIP()
	if err := CheckRateLimit(ip, username); err != nil {
		c.JSON(http.StatusTooManyRequests, gin.H{"detail": err.Error()})
		return
	}

	sess, err := GetSession(sid)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"detail": "会话不存在"})
		return
	}

	if err := sess.Login(orgID, username, password, captcha); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok", "message": "登录成功"})
}

// Handler: 获取考试列表
func getExamsHandler(c *gin.Context) {
	val, _ := c.Get("session")
	sess := val.(*UserSession)

	res, err := sess.GetExams()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"detail": err.Error()})
		return
	}

	c.JSON(http.StatusOK, res)
}

// Handler: 批量获取总成绩走势 (在 Go 里面将考试循环提取并拼接)
func getAllScoresHandler(c *gin.Context) {
	val, _ := c.Get("session")
	sess := val.(*UserSession)

	if sess.ExamParams == nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "请先获取考试列表"})
		return
	}

	var results []map[string]interface{}
	for i := range sess.ExamParams.Exams {
		scoreData, err := sess.GetScores(i)
		if err != nil {
			log.Printf("获取第 %d 个考试详情成绩错误: %v", i, err)
			continue
		}
		summary, _ := scoreData["summary"].(map[string]interface{})
		subjects, _ := scoreData["subjects"].([]map[string]interface{})

		// 精简结构匹配 TrendExamPoint 所需格式
		results = append(results, map[string]interface{}{
			"exam_name":      scoreData["exam_name"],
			"exam_date":      sess.ExamParams.Exams[i].Date,
			"total_score":    summary["total_score"],
			"class_rank":     summary["class_rank"],
			"grade_rank":     summary["grade_rank"],
			"total_students": summary["total_students"],
			"subjects":       subjects,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"student": map[string]string{
			"name":  "", // 前端只需成绩数组
		},
		"exams": results,
	})
}

// Handler: 获取某次考试得分详情
func getScoresHandler(c *gin.Context) {
	val, _ := c.Get("session")
	sess := val.(*UserSession)

	examIndexStr := c.Param("exam_index")
	idx, err := strconv.Atoi(examIndexStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "非法的考试编号格式"})
		return
	}

	res, err := sess.GetScores(idx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"detail": err.Error()})
		return
	}

	c.JSON(http.StatusOK, res)
}

// Handler: 获取单科小题明细
func getSubjectDetailHandler(c *gin.Context) {
	val, _ := c.Get("session")
	sess := val.(*UserSession)

	examIndexStr := c.Param("exam_index")
	idx, err := strconv.Atoi(examIndexStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "非法的考试编号"})
		return
	}

	subjectCode := c.Param("subject_code")
	if subjectCode == "" {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "缺少科目代码"})
		return
	}

	res, err := sess.GetSubjectDetail(idx, subjectCode)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"detail": err.Error()})
		return
	}

	c.JSON(http.StatusOK, res)
}

// Handler: 获取答题卡原卷
func getAnswerSheetHandler(c *gin.Context) {
	val, _ := c.Get("session")
	sess := val.(*UserSession)

	examIndexStr := c.Param("exam_index")
	idx, err := strconv.Atoi(examIndexStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "非法的考试编号"})
		return
	}

	subjectCode := c.Param("subject_code")
	if subjectCode == "" {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "缺少科目代码"})
		return
	}

	res, err := sess.GetAnswerSheet(idx, subjectCode)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"detail": err.Error()})
		return
	}

	c.JSON(http.StatusOK, res)
}

// Handler: 代理网络图片拉取，零拷贝直接管道化流式转发
func proxyImageHandler(c *gin.Context) {
	targetURL := c.Query("url")
	if targetURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "缺少 url 参数"})
		return
	}

	resp, err := http.Get(targetURL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"detail": fmt.Sprintf("代理图片网络错误: %v", err)})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		c.JSON(resp.StatusCode, gin.H{"detail": "代理上游返回状态异常"})
		return
	}

	c.DataFromReader(http.StatusOK, resp.ContentLength, resp.Header.Get("Content-Type"), resp.Body, nil)
}

// Handler: 获取当前本地配置
func getConfigHandler(c *gin.Context) {
	// 直接返回脱敏后的配置信息
	c.JSON(http.StatusOK, GetMaskedConfig())
}

// Handler: 保存本地配置
func saveConfigHandler(c *gin.Context) {
	cfg := LoadConfig()

	orgID := c.PostForm("org_id")
	username := c.PostForm("username")
	password := c.PostForm("password")
	tgToken := c.PostForm("tg_token")
	tgChatID := c.PostForm("tg_chat_id")
	intervalStr := c.PostForm("monitor_interval")

	if orgID != "" {
		cfg.OrgID = orgID
	}
	if username != "" {
		cfg.Username = username
	}
	if password != "" && !strings.Contains(password, "***") {
		cfg.Password = password
	}
	if tgToken != "" && !strings.Contains(tgToken, "***") {
		cfg.TgToken = tgToken
	}
	if tgChatID != "" {
		cfg.TgChatID = tgChatID
	}
	if intervalStr != "" {
		if val, err := strconv.Atoi(intervalStr); err == nil && val > 0 {
			cfg.MonitorInterval = val
		}
	}

	if err := SaveConfig(cfg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "保存配置失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Handler: 离线状态缓存保存数据
func saveConfigScoresHandler(c *gin.Context) {
	cfg := LoadConfig()

	lastScoresStr := c.PostForm("last_scores")
	if lastScoresStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "缺少 last_scores 参数"})
		return
	}

	var parsedScores interface{}
	if err := json.Unmarshal([]byte(lastScoresStr), &parsedScores); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "非法的 JSON 数据结构"})
		return
	}

	cfg.LastScores = parsedScores
	if err := SaveConfig(cfg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": "缓存保存失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Handler: 获取当前监控状态
func getMonitorStatusHandler(c *gin.Context) {
	cfg := LoadConfig()
	running := GetMonitorStatus()

	nextCheckTime := ""
	if running && cfg.LastCheck != "" {
		if t, err := time.Parse(time.RFC3339, cfg.LastCheck); err == nil {
			nextCheckTime = t.Add(time.Duration(cfg.MonitorInterval) * time.Second).Format(time.RFC3339)
		}
	}

	hasScores := cfg.LastScores != nil

	c.JSON(http.StatusOK, gin.H{
		"running":              running,
		"monitor_enabled":      cfg.MonitorEnabled,
		"monitor_interval":     cfg.MonitorInterval,
		"last_check":           cfg.LastCheck,
		"next_check":           nextCheckTime,
		"last_hash":            cfg.LastHash,
		"last_error":           cfg.LastError,
		"consecutive_failures": cfg.ConsecutiveFailures,
		"has_scores":           hasScores,
		"last_scores":          cfg.LastScores,
	})
}

// Handler: 开启自动监控
func startMonitorHandler(c *gin.Context) {
	cfg := LoadConfig()
	cfg.MonitorEnabled = true
	cfg.LastError = ""
	cfg.ConsecutiveFailures = 0
	SaveConfig(cfg)

	StartMonitor()
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Handler: 停止自动监控
func stopMonitorHandler(c *gin.Context) {
	cfg := LoadConfig()
	cfg.MonitorEnabled = false
	SaveConfig(cfg)

	StopMonitor()
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Handler: 手动触发监控立即检查
func checkMonitorHandler(c *gin.Context) {
	changed, err := PerformManualCheck()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"detail": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"changed": changed})
}

// Handler: 测试发送 Telegram 通知
func testTelegramHandler(c *gin.Context) {
	val, _ := c.Get("session")
	sess := val.(*UserSession)

	examIndexStr := c.PostForm("exam_index")
	idx, err := strconv.Atoi(examIndexStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "非法的考试编号"})
		return
	}

	tgToken := c.PostForm("tg_token")
	tgChatID := c.PostForm("tg_chat_id")

	cfg := LoadConfig()
	token := cfg.TgToken
	if tgToken != "" && !strings.Contains(tgToken, "***") {
		token = tgToken
	}
	chatID := cfg.TgChatID
	if tgChatID != "" {
		chatID = tgChatID
	}

	if token == "" || chatID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "缺少 Telegram Token 或 Chat ID"})
		return
	}

	scoreData, err := sess.GetScores(idx)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"detail": err.Error()})
		return
	}

	// 临时合并为数组通知
	allScores := []MonitorExamDetail{
		{
			ExamName: sess.ExamParams.Exams[idx].Name,
			ExamDate: sess.ExamParams.Exams[idx].Date,
			Data:     scoreData,
		},
	}

	// 覆写配置中 TG 参数进行测试发送
	tempCfg := *cfg
	tempCfg.TgToken = token
	tempCfg.TgChatID = chatID

	notifyChanges(&tempCfg, allScores)
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Handler: 直接发送 TG 纯文本
func sendTelegramHandler(c *gin.Context) {
	text := c.PostForm("text")
	tgToken := c.PostForm("tg_token")
	tgChatID := c.PostForm("tg_chat_id")

	cfg := LoadConfig()
	token := cfg.TgToken
	if tgToken != "" && !strings.Contains(tgToken, "***") {
		token = tgToken
	}
	chatID := cfg.TgChatID
	if tgChatID != "" {
		chatID = tgChatID
	}

	if token == "" || chatID == "" || text == "" {
		c.JSON(http.StatusBadRequest, gin.H{"detail": "缺少必要参数 (Token / ChatID / text)"})
		return
	}

	sendTelegram(token, chatID, sanitizeTelegramHTML(text))
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
