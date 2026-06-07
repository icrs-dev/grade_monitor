package main

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// RecognizeCaptchaCaptcha 自动识别验证码，具有本地 Python ddddocr 桥接和外部 API 识别逻辑
func RecognizeCaptcha(imgBytes []byte, customOcrAPI string) (string, error) {
	if customOcrAPI != "" {
		return recognizeViaExternalAPI(imgBytes, customOcrAPI)
	}

	return recognizeViaLocalPython(imgBytes)
}

// 方案 A: 临时调用本地 Python ddddocr 脚本识别 (适合已存在 python + ddddocr 的环境)
func recognizeViaLocalPython(imgBytes []byte) (string, error) {
	// 创建临时验证码图片文件
	tmpDir := os.TempDir()
	tmpFile := filepath.Join(tmpDir, fmt.Sprintf("captcha_%d.png", time.Now().UnixNano()))
	
	err := os.WriteFile(tmpFile, imgBytes, 0644)
	if err != nil {
		return "", fmt.Errorf("写入临时文件失败: %w", err)
	}
	defer os.Remove(tmpFile) // 保证最后删除临时文件

	// 构造 python -c 识别脚本
	pythonScript := fmt.Sprintf(`import ddddocr; ocr=ddddocr.DdddOcr(show_ad=False); print(ocr.classification(open(r'%s', 'rb').read()))`, tmpFile)
	
	// 首先尝试 python, 其次尝试 python3
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd := exec.Command("python", "-c", pythonScript)
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	err = cmd.Run()
	if err != nil {
		// 尝试使用 python3
		out.Reset()
		stderr.Reset()
		cmd3 := exec.Command("python3", "-c", pythonScript)
		cmd3.Stdout = &out
		cmd3.Stderr = &stderr
		err = cmd3.Run()
		if err != nil {
			return "", fmt.Errorf("执行本地 Python OCR 失败: %s", strings.TrimSpace(stderr.String()))
		}
	}

	result := strings.TrimSpace(out.String())
	// 验证结果格式 (通常应为 4 位字母或数字)
	if len(result) == 4 && isAlphanumeric(result) {
		return result, nil
	}

	return "", fmt.Errorf("识别结果无效: %s", result)
}

// 方案 B: 请求外部 OCR API (通用 multipart 上传)
func recognizeViaExternalAPI(imgBytes []byte, apiURL string) (string, error) {
	bodyBuf := &bytes.Buffer{}
	bodyWriter := multipart.NewWriter(bodyBuf)

	fileWriter, err := bodyWriter.CreateFormFile("file", "captcha.png")
	if err != nil {
		return "", err
	}

	_, err = io.Copy(fileWriter, bytes.NewReader(imgBytes))
	if err != nil {
		return "", err
	}

	bodyWriter.Close()

	req, err := http.NewRequest("POST", apiURL, bodyBuf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", bodyWriter.FormDataContentType())

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求外部 OCR 接口超时/错误: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("外部 OCR 接口状态码异常: %d, 响应: %s", resp.StatusCode, string(respBytes))
	}

	result := strings.TrimSpace(string(respBytes))
	// 一些 API 可能返回带有 JSON 的结果，我们做简单清理或期望接口直接返回文本
	// 若需要适配特定在线识别服务，用户可修改此解析逻辑
	if len(result) > 0 {
		return result, nil
	}

	return "", fmt.Errorf("外部 OCR 未返回结果")
}

// 判定字符集是否为字母数字
func isAlphanumeric(s string) bool {
	for _, r := range s {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') {
			return false
		}
	}
	return true
}

// HasLocalPythonOCR 判定当前环境是否具备本地 Python 与 ddddocr 条件
func HasLocalPythonOCR() bool {
	// 运行简单测试命令
	cmd := exec.Command("python", "-c", "import ddddocr")
	if err := cmd.Run(); err == nil {
		return true
	}
	cmd3 := exec.Command("python3", "-c", "import ddddocr")
	if err := cmd3.Run(); err == nil {
		return true
	}
	log.Println("本地检测未安装 python + ddddocr 库，自动识别将通过外部 API 或提示用户手动辅助")
	return false
}
