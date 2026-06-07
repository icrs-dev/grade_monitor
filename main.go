package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

func main() {
	// 1. 命令行参数解析
	port := flag.Int("port", 8000, "服务监听端口")
	flag.Parse()

	// 采用 release 模式，以精简后台打印并提高响应效率
	gin.SetMode(gin.ReleaseMode)

	// 2. 加载配置并生成/获取 API Key
	cfg := LoadConfig()
	apiKey := GetAPIKey()
	log.Printf("管理 API 密钥初始化成功 (前8位): %s...", apiKey[:8])

	// 3. 启动自动轮询监控常驻协程
	if cfg.MonitorEnabled {
		StartMonitor()
	}

	// 4. 创建 Gin 引擎
	r := gin.New()
	r.Use(gin.Recovery())

	// 注入简易的日志中间件以保证后台日志整洁
	r.Use(func(c *gin.Context) {
		start := time.Now()
		c.Next()
		latency := time.Since(start)
		log.Printf("[HTTP] %s - %s %s %d (%v)",
			c.ClientIP(), c.Request.Method, c.Request.URL.Path, c.Writer.Status(), latency)
	})

	// 5. 绑定 API 路由与内嵌前端网页资源
	RegisterAPIRoutes(r)
	MountStaticFiles(r)

	// 6. 启动 http 服务并集成优雅关闭机制
	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", *port),
		Handler: &rewriteHandler{handler: r},
	}

	go func() {
		log.Printf("CloudMarking Web 服务开启，地址: http://127.0.0.1:%d", *port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Web 服务启动失败: %v", err)
		}
	}()

	// 7. 等待系统信号以优雅退出
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	
	log.Println("收到关闭信号，正在安全下线服务...")

	// 停止监控协程并让当前网络连接完成
	StopMonitor()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Web 服务强制关闭异常: %v", err)
	}

	log.Println("服务完全安全下线。")
}

// 路由前置重写处理器：在请求进入 Gin 路由引擎之前，透明重写 /static/api 和 /static//api
type rewriteHandler struct {
	handler http.Handler
}

func (h *rewriteHandler) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	path := req.URL.Path
	if strings.HasPrefix(path, "/static//api/") {
		req.URL.Path = "/api/" + path[13:]
	} else if strings.HasPrefix(path, "/static/api/") {
		req.URL.Path = "/api/" + path[12:]
	} else if path == "/static//api" || path == "/static/api" {
		req.URL.Path = "/api"
	}
	h.handler.ServeHTTP(w, req)
}
