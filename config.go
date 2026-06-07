package main

import (
	"encoding/json"
	"io"
	"log"
	"os"
	"sync"

	"github.com/google/uuid"
)

const ConfigFileName = "config.json"

// Config 结构体映射 config.json 字段
type Config struct {
	OrgID               string      `json:"org_id"`
	Username            string      `json:"username"`
	Password            string      `json:"password"`
	TgToken             string      `json:"tg_token"`
	TgChatID            string      `json:"tg_chat_id"`
	MonitorEnabled      bool        `json:"monitor_enabled"`
	MonitorInterval     int         `json:"monitor_interval"`
	LastHash            string      `json:"last_hash"`
	LastCheck           string      `json:"last_check"`
	LastScores          interface{} `json:"last_scores"` // 保持 JSON 结构兼容
	LastError           string      `json:"last_error"`
	ConsecutiveFailures int         `json:"consecutive_failures"`
	APIKey              string      `json:"api_key"`
}

var (
	configLock sync.RWMutex
	currentCfg *Config
)

// DefaultConfig 提供默认配置项
func DefaultConfig() *Config {
	return &Config{
		OrgID:           "",
		Username:        "",
		Password:        "",
		TgToken:         "",
		TgChatID:        "",
		MonitorEnabled:  false,
		MonitorInterval: 3600,
		LastHash:        "",
		LastCheck:       "",
		LastScores:      nil,
		LastError:       "",
		APIKey:          "",
	}
}

// LoadConfig 从本地加载配置并做默认值补全
func LoadConfig() *Config {
	configLock.Lock()
	defer configLock.Unlock()

	if currentCfg != nil {
		return currentCfg
	}

	currentCfg = DefaultConfig()
	file, err := os.Open(ConfigFileName)
	if err != nil {
		if os.IsNotExist(err) {
			// 文件不存在则直接返回默认配置
			return currentCfg
		}
		log.Printf("读取配置文件 %s 错误: %v", ConfigFileName, err)
		return currentCfg
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		log.Printf("读取配置文件数据错误: %v", err)
		return currentCfg
	}

	var temp Config
	if err := json.Unmarshal(data, &temp); err != nil {
		log.Printf("解析配置文件 JSON 错误: %v", err)
		return currentCfg
	}

	// 补全默认值
	if temp.MonitorInterval <= 0 {
		temp.MonitorInterval = 3600
	}
	*currentCfg = temp
	return currentCfg
}

// SaveConfig 线程安全地保存配置到 config.json
func SaveConfig(cfg *Config) error {
	configLock.Lock()
	defer configLock.Unlock()

	currentCfg = cfg

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		log.Printf("序列化配置 JSON 错误: %v", err)
		return err
	}

	err = os.WriteFile(ConfigFileName, data, 0644)
	if err != nil {
		log.Printf("保存配置文件错误: %v", err)
		return err
	}

	return nil
}

// GetAPIKey 获取或自动生成管理 API 密钥
func GetAPIKey() string {
	cfg := LoadConfig()
	if cfg.APIKey != "" {
		return cfg.APIKey
	}

	// 生成新的 UUID Key
	newKey := uuid.New().String()
	newKey = replaceAllHyphens(newKey) // 移除连字符以符合 hex 风格
	cfg.APIKey = newKey
	if err := SaveConfig(cfg); err == nil {
		log.Printf("已生成新管理 API 密钥: %s...", newKey[:8])
	}
	return newKey
}

func replaceAllHyphens(s string) string {
	res := ""
	for _, c := range s {
		if c != '-' {
			res += string(c)
		}
	}
	return res
}

// GetMaskedConfig 获取脱敏后的配置，避免敏感数据泄漏给前端
func GetMaskedConfig() map[string]interface{} {
	cfg := LoadConfig()
	configLock.RLock()
	defer configLock.RUnlock()

	masked := map[string]interface{}{
		"org_id":               cfg.OrgID,
		"username":             cfg.Username,
		"password":             "***",
		"tg_chat_id":           cfg.TgChatID,
		"monitor_enabled":      cfg.MonitorEnabled,
		"monitor_interval":     cfg.MonitorInterval,
		"last_hash":            cfg.LastHash,
		"last_check":           cfg.LastCheck,
		"last_scores":          cfg.LastScores,
		"last_error":           cfg.LastError,
		"consecutive_failures": cfg.ConsecutiveFailures,
	}

	t := cfg.TgToken
	if len(t) > 4 {
		masked["tg_token"] = "***" + t[len(t)-4:]
	} else if t != "" {
		masked["tg_token"] = "***"
	} else {
		masked["tg_token"] = ""
	}

	return masked
}
