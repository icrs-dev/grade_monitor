package main

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed static/*
var staticFS embed.FS

// MountStaticFiles 将内嵌前端 React 单页面应用的 static 目录挂载到 Gin 上并处理路由回退
func MountStaticFiles(r *gin.Engine) {
	// 获取子文件系统
	subFS, err := fs.Sub(staticFS, "static")
	if err != nil {
		panic(err)
	}

	// 挂载 /static 路径
	r.StaticFS("/static", http.FS(subFS))

	// 根路径跳转
	r.GET("/", func(c *gin.Context) {
		c.Redirect(http.StatusMovedPermanently, "/static/")
	})

	// 统一处理无路由状态 (SPA 页面回退)
	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		// 排除 API 路由，仅处理页面刷新 SPA 路由回退
		if !strings.HasPrefix(path, "/api") {
			c.FileFromFS("index.html", http.FS(subFS))
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"detail": "API 接口未找到"})
	})
}
