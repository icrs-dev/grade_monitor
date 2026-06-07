package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	BASE       = "http://sxoma.com:8088/CloudMarking"
	BASE2      = "http://sxoma.com:8088/CloudAnalysis"
	UA         = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
	SessionTTL = 30 * time.Minute
)

// ExamParams 缓存单次会话拉取考试列表后的基准定位数据
type ExamParams struct {
	KSID   string `json:"ksid"`
	BJDM   string `json:"bjdm"`
	NJDM   string `json:"njdm"`
	Exams  []Exam `json:"exams"`
}

// Exam 表示云阅卷考试项
type Exam struct {
	KSDM      string `json:"ksdm"`
	KLDM      string `json:"kldm"`
	Name      string `json:"name"`
	Date      string `json:"date"`
	ClassRank string `json:"class_rank"`
	GradeRank string `json:"grade_rank"`
	Subjects  string `json:"subjects"`
}

// UserSession 代表活跃的 HTTP 会话
type UserSession struct {
	ID         string
	HTTPClient *http.Client
	LoggedIn   bool
	ExamParams *ExamParams
	LastActive time.Time
}

var (
	sessionsMap sync.Map // sid -> *UserSession
)

// GetSession 获取现有会话，或创建新的会话
func GetSession(sid string) (*UserSession, error) {
	if sid == "" {
		return nil, fmt.Errorf("会话 ID 不能为空")
	}

	if val, ok := sessionsMap.Load(sid); ok {
		sess := val.(*UserSession)
		sess.LastActive = time.Now()
		return sess, nil
	}

	// 创建带 CookieJar 的 http.Client
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}

	sess := &UserSession{
		ID: sid,
		HTTPClient: &http.Client{
			Jar:     jar,
			Timeout: 20 * time.Second,
		},
		LoggedIn:   false,
		ExamParams: nil,
		LastActive: time.Now(),
	}

	sessionsMap.Store(sid, sess)
	return sess, nil
}

// CleanExpiredSessions 清理过期的内存会话
func CleanExpiredSessions() int {
	now := time.Now()
	count := 0
	sessionsMap.Range(func(key, value interface{}) bool {
		sess := value.(*UserSession)
		if now.Sub(sess.LastActive) > SessionTTL {
			sessionsMap.Delete(key)
			count++
		}
		return true
	})
	if count > 0 {
		log.Printf("内存会话清理：已清除 %d 个过期会话", count)
	}
	return count
}

// InitCookie 获取初始 Cookie 建立连接
func (s *UserSession) InitCookie() error {
	req, err := http.NewRequest("GET", BASE+"/", nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", UA)

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("无法连接云阅卷首页: %w", err)
	}
	resp.Body.Close()
	return nil
}

// GetCaptchaBytes 获取验证码原始图片流和 Content-Type
func (s *UserSession) GetCaptchaBytes() ([]byte, string, error) {
	captchaURL := fmt.Sprintf("%s/image.jsp?rnd=%d", BASE, time.Now().UnixNano()/int64(time.Millisecond))
	req, err := http.NewRequest("GET", captchaURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", UA)

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("拉取验证码状态码异常: %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}

	return data, resp.Header.Get("Content-Type"), nil
}

// Login 登录与 SSO 鉴权跳转
func (s *UserSession) Login(orgID, username, password, captcha string) error {
	formData := url.Values{}
	formData.Set("slid", orgID)
	formData.Set("ksid", username)
	formData.Set("ksmm", password)
	formData.Set("xs_yzm", captcha)
	formData.Set("dlfs", "1")

	req, err := http.NewRequest("POST", BASE+"/xslogin.do", strings.NewReader(formData.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", UA)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("登录请求发送失败: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	body := string(bodyBytes)
	if strings.Contains(body, "验证码错误") || strings.Contains(body, "验证码不正确") || strings.Contains(body, "验证码已过期") {
		return fmt.Errorf("验证码错误，请重新获取")
	}
	if strings.Contains(body, "密码错误") || strings.Contains(body, "密码不正确") {
		return fmt.Errorf("密码错误")
	}
	if strings.Contains(body, "用户不存在") || strings.Contains(body, "账号不存在") || strings.Contains(body, "考生不存在") || strings.Contains(body, "学籍号不存在") {
		return fmt.Errorf("学籍号不存在")
	}

	// SSO 参数匹配
	yhzh, txmy, njdm, err := parseSSOParams(body)
	if err != nil {
		return err
	}

	ssoURL := fmt.Sprintf("%s/sixslogin.do?yhzh=%s&txmy=%s&njdm=%s", BASE2, yhzh, txmy, njdm)
	ssoReq, err := http.NewRequest("GET", ssoURL, nil)
	if err != nil {
		return err
	}
	ssoReq.Header.Set("User-Agent", UA)

	ssoResp, err := s.HTTPClient.Do(ssoReq)
	if err != nil {
		return fmt.Errorf("SSO 登录跳转异常: %w", err)
	}
	ssoResp.Body.Close()

	s.LoggedIn = true
	return nil
}

// helper 解析 SSO 数据
func parseSSOParams(body string) (string, string, string, error) {
	reYhzh := regexp.MustCompile(`var yhzh\s*=\s*"([^"]+)"`)
	reTxmy := regexp.MustCompile(`var txmy\s*=\s*"([^"]+)"`)
	reNjdm := regexp.MustCompile(`var njdm\s*=\s*"([^"]+)"`)

	yhzhM := reYhzh.FindStringSubmatch(body)
	txmyM := reTxmy.FindStringSubmatch(body)
	njdmM := reNjdm.FindStringSubmatch(body)

	if len(yhzhM) < 2 || len(txmyM) < 2 || len(njdmM) < 2 {
		// 备用单引号正则
		reYhzhAlt := regexp.MustCompile(`yhzh\s*=\s*'([^']+)'`)
		reTxmyAlt := regexp.MustCompile(`txmy\s*=\s*'([^']+)'`)
		reNjdmAlt := regexp.MustCompile(`njdm\s*=\s*'([^']+)'`)

		yhzhM = reYhzhAlt.FindStringSubmatch(body)
		txmyM = reTxmyAlt.FindStringSubmatch(body)
		njdmM = reNjdmAlt.FindStringSubmatch(body)
	}

	if len(yhzhM) < 2 || len(txmyM) < 2 || len(njdmM) < 2 {
		snippet := body
		if len(snippet) > 400 {
			snippet = snippet[:400]
		}
		return "", "", "", fmt.Errorf("登录异常，未解析到SSO跳转密钥 (Body预览: %s)", snippet)
	}

	return yhzhM[1], txmyM[1], njdmM[1], nil
}

// GetExams 拉取考试列表和学生基础数据
func (s *UserSession) GetExams() (map[string]interface{}, error) {
	formData := url.Values{}
	formData.Set("ksid", "")
	formData.Set("njdm", "")

	body, err := s.postForm(BASE2+"/stunavi_getNavi.do", formData, BASE2+"/web/stu/navi.jsp")
	if err != nil {
		return nil, fmt.Errorf("拉取考试列表网络请求失败: %w", err)
	}

	var res map[string]interface{}
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("考试数据 JSON 解析错误: %w", err)
	}

	if b, ok := res["res"].(bool); !ok || !b {
		msg, _ := res["msg"].(string)
		return nil, fmt.Errorf("拉取考试列表失败: %s", msg)
	}

	stu, _ := res["kshengjcxx"].(map[string]interface{})
	examsList, _ := res["lcksxx"].([]interface{})

	var exams []Exam
	for _, e := range examsList {
		m, _ := e.(map[string]interface{})
		ksdm := getString(m["KSDM"])
		kldm := getString(m["KLDM"])
		name := getString(m["KSMC"])
		dateRaw := getString(m["KSSJ"])
		if len(dateRaw) > 10 {
			dateRaw = dateRaw[:10]
		}
		classRank := getString(m["BJPM"])
		gradeRank := getString(m["JFPM"])
		subjsRaw := getString(m["BCKSKM"])
		subjects := strings.ReplaceAll(subjsRaw, "_", " ")

		exams = append(exams, Exam{
			KSDM:      ksdm,
			KLDM:      kldm,
			Name:      name,
			Date:      dateRaw,
			ClassRank: classRank,
			GradeRank: gradeRank,
			Subjects:  subjects,
		})
	}

	ksid := getString(stu["KSID"])
	bjdm := getString(stu["BJDM"])
	njdm := getString(stu["NJDM"])

	s.ExamParams = &ExamParams{
		KSID:  ksid,
		BJDM:  bjdm,
		NJDM:  njdm,
		Exams: exams,
	}

	// 拼装符合 React 前端的数据格式
	studentMap := map[string]interface{}{
		"name":  stu["XM"],
		"id":    ksid,
		"grade": stu["NJMC"],
		"class": stu["BJMC"],
	}

	return map[string]interface{}{
		"student":    studentMap,
		"school":     res["zzmc"],
		"exam_count": len(exams),
		"exams":      exams,
	}, nil
}

// GetScores 获取单次考试得分详细数据
func (s *UserSession) GetScores(examIdx int) (map[string]interface{}, error) {
	if s.ExamParams == nil {
		return nil, fmt.Errorf("未检索到考试缓存，请先获取考试列表")
	}
	if examIdx < 0 || examIdx >= len(s.ExamParams.Exams) {
		return nil, fmt.Errorf("考试索引超限: %d", examIdx)
	}

	exam := s.ExamParams.Exams[examIdx]
	formData := url.Values{}
	formData.Set("ksdm", exam.KSDM)
	formData.Set("kldm", exam.KLDM)
	formData.Set("ksid", s.ExamParams.KSID)
	formData.Set("bjdm", s.ExamParams.BJDM)
	formData.Set("njdm", s.ExamParams.NJDM)
	formData.Set("kmdm", "")

	body, err := s.postForm(BASE2+"/stuckfx_getStuNavi.do", formData, BASE2+"/web/stu/ckfx.jsp")
	if err != nil {
		return nil, fmt.Errorf("请求详细成绩网络失败: %w", err)
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}

	if b, ok := raw["res"].(bool); !ok || !b {
		msg, _ := raw["msg"].(string)
		return nil, fmt.Errorf("获取成绩明细失败: %s", msg)
	}

	bj, _ := raw["bjcjjizhi"].(map[string]interface{})
	cj, _ := raw["cjpmbrkm"].(map[string]interface{})

	// 映射单科成绩 gkksxx
	gkksxx, _ := raw["gkksxx"].([]interface{})
	var subjects []map[string]interface{}
	for _, kmRaw := range gkksxx {
		km, _ := kmRaw.(map[string]interface{})
		codeStr := getString(km["KMDM"])
		if codeStr == "" {
			codeStr = getString(km["kmdm"])
		}
		subjects = append(subjects, map[string]interface{}{
			"name":       km["KMMC"],
			"code":       codeStr,
			"score":      km["KSCJ"],
			"class_rank": km["BJPM"],
			"grade_rank": km["NJPM"],
			"class_avg":  km["BJPJF"],
			"grade_avg":  km["NJPJF"],
		})
	}

	// 成绩升降级
	grgkpwlist, ok := raw["grgkpwlist"].([]interface{})
	if !ok {
		grgkpwlist, _ = raw["bckscjkmlist"].([]interface{})
	}
	var changes []map[string]interface{}
	for _, chRaw := range grgkpwlist {
		ch, _ := chRaw.(map[string]interface{})
		diffVal := 0.0
		if d, ok := ch["CJL"].(float64); ok {
			diffVal = d
		}
		direction := "flat"
		if diffVal > 0 {
			direction = "up"
		} else if diffVal < 0 {
			direction = "down"
		}
		changes = append(changes, map[string]interface{}{
			"subject":   ch["KMMC"],
			"diff":      diffVal,
			"direction": direction,
		})
	}

	// 班级排名前十
	classmates, _ := raw["bjstucjxx"].([]interface{})
	// 在 Go 里面做个简易的排序并截取前 10 名
	type classmateItem struct {
		Name  string
		Total float64
	}
	var cmList []classmateItem
	for _, cmRaw := range classmates {
		cm, _ := cmRaw.(map[string]interface{})
		name, _ := cm["XM"].(string)
		totalVal := 0.0
		switch t := cm["ZF"].(type) {
		case float64:
			totalVal = t
		case string:
			fmt.Sscanf(t, "%f", &totalVal)
		}
		cmList = append(cmList, classmateItem{Name: name, Total: totalVal})
	}
	// 简易冒泡排序
	for i := 0; i < len(cmList); i++ {
		for j := i + 1; j < len(cmList); j++ {
			if cmList[i].Total < cmList[j].Total {
				cmList[i], cmList[j] = cmList[j], cmList[i]
			}
		}
	}
	var topClassmates []map[string]interface{}
	limit := 10
	if len(cmList) < limit {
		limit = len(cmList)
	}
	for i := 0; i < limit; i++ {
		topClassmates = append(topClassmates, map[string]interface{}{
			"name":  cmList[i].Name,
			"total": fmt.Sprintf("%.2f", cmList[i].Total),
		})
	}

	summary := map[string]interface{}{
		"total_score":    cj["ZF"],
		"class_rank":     cj["BJPM"],
		"grade_rank":     cj["JFPM"],
		"total_students": bj["ZRS"],
		"class_max":      bj["ZGF"],
		"class_avg":      bj["PJF"],
		"class_min":      bj["ZDF"],
	}

	return map[string]interface{}{
		"exam_name":  exam.Name,
		"summary":    summary,
		"subjects":   subjects,
		"strengths":  cj["JDBRKMMC"],
		"weaknesses": cj["XDBRKMMC"],
		"changes":    changes,
		"classmates": topClassmates,
	}, nil
}

// GetSubjectDetail 获取单科小题分析
func (s *UserSession) GetSubjectDetail(examIdx int, subjectCode string) (map[string]interface{}, error) {
	if s.ExamParams == nil {
		return nil, fmt.Errorf("未检索到考试缓存")
	}
	if examIdx < 0 || examIdx >= len(s.ExamParams.Exams) {
		return nil, fmt.Errorf("考试索引超限")
	}

	exam := s.ExamParams.Exams[examIdx]
	formData := url.Values{}
	formData.Set("ksdm", exam.KSDM)
	formData.Set("kldm", exam.KLDM)
	formData.Set("ksid", s.ExamParams.KSID)
	formData.Set("bjdm", s.ExamParams.BJDM)
	formData.Set("njdm", s.ExamParams.NJDM)
	formData.Set("kmdm", subjectCode)

	body, err := s.postForm(BASE2+"/stuckfx_getStuByKm.do", formData, BASE2+"/web/stu/ckfx.jsp")
	if err != nil {
		return nil, err
	}

	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, err
	}

	if b, ok := data["res"].(bool); !ok || !b {
		msg, _ := data["msg"].(string)
		return nil, fmt.Errorf("获取小题明细失败: %s", msg)
	}

	cj, _ := data["cjpmbrkm"].(map[string]interface{})
	kmxtxq, _ := data["kmxtxq"].([]interface{})

	var questions []map[string]interface{}
	for _, qRaw := range kmxtxq {
		q, _ := qRaw.(map[string]interface{})
		questions = append(questions, map[string]interface{}{
			"bh":          getString(q["STBH"]),
			"name":        getString(q["STMC"]),
			"full_score":  getString(q["STMF"]),
			"score":       getString(q["GRDF"]),
			"class_ratio": formatRatio(q["BJDFL"]),
			"grade_ratio": formatRatio(q["NJDFL"]),
		})
	}

	return map[string]interface{}{
		"subject_score": cj["KMCJ"],
		"class_rank":     cj["BJPM"],
		"grade_rank":     cj["JFPM"],
		"questions":      questions,
	}, nil
}

// GetAnswerSheet 获取答题卡原卷
func (s *UserSession) GetAnswerSheet(examIdx int, subjectCode string) (map[string]interface{}, error) {
	if s.ExamParams == nil {
		return nil, fmt.Errorf("未检索到考试缓存")
	}
	if examIdx < 0 || examIdx >= len(s.ExamParams.Exams) {
		return nil, fmt.Errorf("考试索引超限")
	}

	exam := s.ExamParams.Exams[examIdx]
	formData := url.Values{}
	formData.Set("ksdm", exam.KSDM)
	formData.Set("kldm", exam.KLDM)
	formData.Set("ksid", s.ExamParams.KSID)
	formData.Set("kmdm", subjectCode)

	body, err := s.postForm(BASE2+"/stuckzd_getStuckzd.do", formData, BASE2+"/web/stu/ckfx.jsp")
	if err != nil {
		return nil, err
	}

	var data map[string]interface{}
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, err
	}

	if b, ok := data["res"].(bool); !ok || !b {
		msg, _ := data["msg"].(string)
		return nil, fmt.Errorf("获取答题卡数据失败: %s", msg)
	}

	tx, _ := data["kskmtxxx"].(map[string]interface{})
	cj, _ := data["xskmcjxx"].(map[string]interface{})

	baseURL := getString(tx["DYTXDZ"])
	barcode := getString(cj["DYBMH"])
	pageCountVal := 0.0
	if tx["TXSL"] != nil {
		switch pc := tx["TXSL"].(type) {
		case float64:
			pageCountVal = pc
		case string:
			fmt.Sscanf(pc, "%f", &pageCountVal)
		}
	}
	pageCount := int(pageCountVal)
	omr := getString(cj["OMR"])

	var imageURLs []string
	if baseURL != "" {
		for i := 1; i <= pageCount; i++ {
			var imgURL string
			if barcode != "" {
				imgURL = fmt.Sprintf("%s%s/%s_full_%d.jpg", baseURL, barcode, barcode, i)
			} else {
				imgURL = fmt.Sprintf("%s_full_%d.jpg", baseURL, i)
			}
			imageURLs = append(imageURLs, imgURL)
		}
	}

	return map[string]interface{}{
		"base_url":    baseURL,
		"barcode":     barcode,
		"page_count":  pageCount,
		"image_urls":  imageURLs,
		"omr":         omr,
	}, nil
}

// helper POST 表单提交
func (s *UserSession) postForm(urlStr string, data url.Values, referer string) ([]byte, error) {
	req, err := http.NewRequest("POST", urlStr, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", UA)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	if referer != "" {
		req.Header.Set("Referer", referer)
	}

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	return io.ReadAll(resp.Body)
}

// 辅助函数：安全将 interface{} 转换为 string，防止 float64 或其它类型断言失败变为空字符串
func getString(val interface{}) string {
	if val == nil {
		return ""
	}
	switch v := val.(type) {
	case string:
		return v
	case float64:
		// 如果 float64 带有小数，如得分率等，需要保留小数，如果是整数 ID，去除尾部的小数点
		if v == math.Trunc(v) {
			return fmt.Sprintf("%.0f", v)
		}
		return fmt.Sprintf("%.2f", v)
	case int:
		return fmt.Sprintf("%d", v)
	case int64:
		return fmt.Sprintf("%d", v)
	default:
		return fmt.Sprintf("%v", v)
	}
}

// 辅助函数：格式化得分率，将 0.7350 形式的 decimal 转换为 "73.50%"，如果是 "73.50" 或 "73.50%" 则保持不变
func formatRatio(val interface{}) string {
	if val == nil {
		return "0%"
	}
	var f float64
	switch v := val.(type) {
	case float64:
		f = v
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return "0%"
		}
		// 如果已经是带有 % 的格式，直接处理并返回
		if strings.Contains(trimmed, "%") {
			parsed, err := strconv.ParseFloat(strings.ReplaceAll(trimmed, "%", ""), 64)
			if err == nil {
				return fmt.Sprintf("%.2f%%", parsed)
			}
			return trimmed
		}
		parsed, err := strconv.ParseFloat(trimmed, 64)
		if err != nil {
			return trimmed
		}
		f = parsed
	default:
		strVal := fmt.Sprintf("%v", v)
		parsed, err := strconv.ParseFloat(strVal, 64)
		if err != nil {
			return strVal
		}
		f = parsed
	}

	// 如果数值 <= 1.0 (表示它是 0~1 的小数比率，如 0.7350)，则乘 100 得到百分比
	if f <= 1.0 {
		return fmt.Sprintf("%.2f%%", f*100)
	}
	// 如果大于 1.0，说明已经是百分数（如 73.50），直接保留两位小数加 %
	return fmt.Sprintf("%.2f%%", f)
}
