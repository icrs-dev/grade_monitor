package main

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

// MonitorExamDetail 用于临时组装监控列表及详情数据以作哈希检测
type MonitorExamDetail struct {
	ExamName string                 `json:"exam_name"`
	ExamDate string                 `json:"exam_date"`
	Data     map[string]interface{} `json:"data"`
}

// Telegram HTML 清理预编译正则
var reDangerousHTML = regexp.MustCompile(`<\s*(script|iframe|object|embed|link|style|meta|applet|form|input|base|frame|frameset|head|html|body)[^>]*>.*?<\s*/\s*\1\s*>`)

var (
	monitorCancel    context.CancelFunc
	monitorCtx       context.Context
	monitorLock      sync.Mutex
	isMonitorRunning bool

	// telegramClient 复用的 Telegram API HTTP 客户端
	telegramClient = &http.Client{Timeout: 15 * time.Second}
)

// StartMonitor 后台启动自动监控轮询协程
func StartMonitor() {
	monitorLock.Lock()
	defer monitorLock.Unlock()

	if isMonitorRunning {
		return
	}

	cfg := LoadConfig()
	if !cfg.MonitorEnabled {
		return
	}

	monitorCtx, monitorCancel = context.WithCancel(context.Background())
	isMonitorRunning = true

	go monitorLoop(monitorCtx)
	log.Println("自动监控协程已启动")
}

// StopMonitor 停止自动监控协程
func StopMonitor() {
	monitorLock.Lock()
	defer monitorLock.Unlock()

	if !isMonitorRunning {
		return
	}

	if monitorCancel != nil {
		monitorCancel()
	}
	isMonitorRunning = false
	log.Println("自动监控协程已停止")
}

// GetMonitorStatus 获取当前后台运行状态
func GetMonitorStatus() bool {
	monitorLock.Lock()
	defer monitorLock.Unlock()
	return isMonitorRunning
}

// 执行监控轮询的主循环
func monitorLoop(ctx context.Context) {
	// 刚启动时立即执行一次
	if err := performCheck(); err != nil {
		log.Printf("监控即时检查失败: %v", err)
	}

	for {
		cfg := LoadConfig()
		interval := time.Duration(cfg.MonitorInterval) * time.Second
		if interval < 30*time.Second {
			interval = 3600 * time.Second // 默认防刷一小时
		}

		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			if err := performCheck(); err != nil {
				log.Printf("监控轮询检查失败: %v", err)
			}
		}
	}
}

// PerformManualCheck 提供手动立即检查触发接口
func PerformManualCheck() (bool, error) {
	cfg := LoadConfig()
	if cfg.OrgID == "" || cfg.Username == "" || cfg.Password == "" {
		return false, fmt.Errorf("请先保存登录凭据")
	}

	log.Println("正在执行手动即时监控检查...")
	return runMonitorCheck(cfg)
}

// performCheck 定时触发的监控逻辑封装
func performCheck() error {
	cfg := LoadConfig()
	if !cfg.MonitorEnabled {
		return nil
	}
	if cfg.OrgID == "" || cfg.Username == "" || cfg.Password == "" {
		return fmt.Errorf("登录凭据缺失")
	}

	_, err := runMonitorCheck(cfg)
	return err
}

// 核心成绩监测轮询逻辑，模拟完整登录、拉取、哈希并比对
func runMonitorCheck(cfg *Config) (bool, error) {
	nowStr := time.Now().Format(time.RFC3339)

	// 1. 创建独立会话
	sess, err := GetSession("monitor_session_id")
	if err != nil {
		updateMonitorError(cfg, err.Error())
		return false, err
	}
	sess.LoggedIn = false // 强制重新登录

	if err := sess.InitCookie(); err != nil {
		updateMonitorError(cfg, fmt.Sprintf("首页Cookie建立失败: %v", err))
		return false, err
	}

	// 2. 验证码获取及 OCR 重试识别 (最多 3 次)
	var captcha string
	var ocrErr error
	for attempt := 0; attempt < 3; attempt++ {
		imgBytes, _, err := sess.GetCaptchaBytes()
		if err != nil {
			ocrErr = err
			time.Sleep(2 * time.Second)
			continue
		}

		// 这里传入空字符，表明通过本地 python ddddocr 识别
		captcha, ocrErr = RecognizeCaptcha(imgBytes, "")
		if ocrErr == nil && len(captcha) == 4 {
			break
		}
		time.Sleep(3 * time.Second)
	}

	if ocrErr != nil || len(captcha) != 4 {
		errStr := fmt.Sprintf("验证码 OCR 自动识别失败 (已重试3次): %v", ocrErr)
		updateMonitorError(cfg, errStr)
		return false, fmt.Errorf("%s", errStr)
	}

	// 3. 执行登录
	err = sess.Login(cfg.OrgID, cfg.Username, cfg.Password, captcha)
	if err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "密码错误") || strings.Contains(errStr, "学籍号不存在") {
			// 致命错误，禁用自动监控（异步停止避免死锁）
			cfg.MonitorEnabled = false
			cfg.LastError = "FATAL: 凭证错误，自动监控已禁用: " + errStr
			SaveConfig(cfg)
			go StopMonitor()
		} else {
			updateMonitorError(cfg, fmt.Sprintf("登录失败: %v", err))
		}
		return false, err
	}

	// 4. 获取考试列表
	examsRes, err := sess.GetExams()
	if err != nil {
		updateMonitorError(cfg, fmt.Sprintf("拉取考试列表失败: %v", err))
		return false, err
	}

	stuMap, _ := examsRes["student"].(map[string]interface{})
	schoolStr, _ := examsRes["school"].(string)
	examsList, _ := examsRes["exams"].([]Exam)

	// 5. 循环拉取所有考试成绩以构建深度哈希
	examCount := len(examsList)
	allScoresArray := make([]*MonitorExamDetail, examCount)
	var wg sync.WaitGroup

	for idx, e := range examsList {
		wg.Add(1)
		go func(i int, exam Exam) {
			defer wg.Done()
			scoreData, err := sess.GetScores(i)
			if err != nil {
				log.Printf("监控拉取考试 [%s] 成绩失败: %v", exam.Name, err)
				return
			}
			allScoresArray[i] = &MonitorExamDetail{
				ExamName: exam.Name,
				ExamDate: exam.Date,
				Data:     scoreData,
			}
		}(idx, e)
	}
	wg.Wait()

	var allScores []MonitorExamDetail
	for _, item := range allScoresArray {
		if item != nil {
			allScores = append(allScores, *item)
		}
	}

	// 6. 序列化排序计算哈希比对
	hashInputBytes, err := json.Marshal(allScores)
	if err != nil {
		updateMonitorError(cfg, fmt.Sprintf("序列化比对哈希错误: %v", err))
		return false, fmt.Errorf("序列化比对哈希错误: %w", err)
	}
	newHash := fmt.Sprintf("%x", md5.Sum(hashInputBytes))

	oldHash := cfg.LastHash
	changed := oldHash != "" && newHash != oldHash

	// 7. 更新本地缓存结构
	var cachedExams []map[string]interface{}
	for _, item := range allScores {
		d := item.Data
		bj, _ := d["summary"].(map[string]interface{})
		subjectsRaw, _ := d["subjects"].([]map[string]interface{})

		var cachedSubjects []map[string]interface{}
		for _, km := range subjectsRaw {
			cachedSubjects = append(cachedSubjects, map[string]interface{}{
				"name":       km["name"],
				"score":      km["score"],
				"class_rank": km["class_rank"],
				"grade_rank": km["grade_rank"],
			})
		}

		cachedExams = append(cachedExams, map[string]interface{}{
			"exam_name":      item.ExamName,
			"exam_date":      item.ExamDate,
			"total_score":    bj["total_score"],
			"class_rank":     bj["class_rank"],
			"grade_rank":     bj["grade_rank"],
			"total_students": bj["total_students"],
			"subjects":       cachedSubjects,
		})
	}

	cfg.LastHash = newHash
	cfg.LastCheck = nowStr
	cfg.LastError = ""
	cfg.ConsecutiveFailures = 0
	cfg.LastScores = map[string]interface{}{
		"student": map[string]interface{}{
			"name":  stuMap["name"],
			"id":    stuMap["id"],
			"grade": stuMap["grade"],
			"class": stuMap["class"],
		},
		"school": schoolStr,
		"exams":  cachedExams,
	}

	SaveConfig(cfg)

	// 8. 成绩变化时，发送 Telegram HTML 推送
	if changed && cfg.TgToken != "" && cfg.TgChatID != "" {
		notifyChanges(cfg, allScores)
	}

	log.Printf("自动成绩检查完成: hash=%s changed=%v", newHash[:8], changed)
	return changed, nil
}

// 错误处理及重试计数
func updateMonitorError(cfg *Config, errMsg string) {
	cfg.LastError = errMsg
	cfg.ConsecutiveFailures++
	cfg.LastCheck = time.Now().Format(time.RFC3339)
	SaveConfig(cfg)
	log.Printf("[MONITOR ERROR] 累计失败 %d 次: %s", cfg.ConsecutiveFailures, errMsg)
}

// 将变动的成绩格式化并推送至 Telegram
func notifyChanges(cfg *Config, allScores []MonitorExamDetail) {
	for _, item := range allScores {
		d := item.Data
		bj, _ := d["summary"].(map[string]interface{})

		var lines []string
		lines = append(lines, fmt.Sprintf("<b>%s</b>", item.ExamName))

		lines = append(lines, fmt.Sprintf(
			"总分: %v  班排: %v/%v  级排: %v",
			bj["total_score"], bj["class_rank"], bj["total_students"], bj["grade_rank"],
		))

		// 各学科 gkksxx
		var subs []string
		if subjectsRaw, ok := d["subjects"].([]map[string]interface{}); ok {
			for _, km := range subjectsRaw {
				subs = append(subs, fmt.Sprintf("%v:%v(B%v/G%v)", km["name"], km["score"], km["class_rank"], km["grade_rank"]))
			}
		}
		if len(subs) > 0 {
			lines = append(lines, strings.Join(subs, " | "))
		}

		// 弱势学科
		if xdb, ok := d["weaknesses"].(string); ok && xdb != "" {
			lines = append(lines, fmt.Sprintf("弱势: %s", xdb))
		}

		// 变化率
		var changes []string
		if chList, ok := d["changes"].([]map[string]interface{}); ok {
			for _, ch := range chList {
				diff := 0.0
				if dVal, ok := ch["diff"].(float64); ok {
					diff = dVal
				}
				sign := "="
				if diff > 0 {
					sign = "+"
				} else if diff < 0 {
					sign = "-"
				}
				changes = append(changes, fmt.Sprintf("%v%s%.0f%%", ch["subject"], sign, math.Abs(diff)*100))
			}
		}
		if len(changes) > 0 {
			lines = append(lines, "变化: "+strings.Join(changes, " "))
		}

		sanitizedMsg := sanitizeTelegramHTML(strings.Join(lines, "\n"))
		sendTelegram(cfg.TgToken, cfg.TgChatID, sanitizedMsg)
	}
}

// 发送 TG 消息的主函数
func sendTelegram(token, chatID, text string) {
	apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", token)

	postData := map[string]interface{}{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "HTML",
	}

	jsonBytes, err := json.Marshal(postData)
	if err != nil {
		log.Printf("序列化 TG 消息 JSON 失败: %v", err)
		return
	}

	req, err := http.NewRequest("POST", apiURL, bytes.NewBuffer(jsonBytes))
	if err != nil {
		log.Printf("创建 TG 消息网络请求失败: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := telegramClient.Do(req)
	if err != nil {
		log.Printf("Telegram 推送网络失败: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("Telegram 发送失败，状态码 %d: %s", resp.StatusCode, string(body))
	}
}

// 移除非 Telegram 支持的 HTML 标签
func sanitizeTelegramHTML(text string) string {
	text = reDangerousHTML.ReplaceAllString(text, "")

	if len(text) > 4096 {
		text = text[:4096]
	}
	return text
}
