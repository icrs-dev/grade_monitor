# Stage 1: Build the Golang application
FROM golang:1.21-alpine AS builder

WORKDIR /app

# 启用中国镜像源（可选）
ARG USE_GOPROXY=false
RUN if [ "$USE_GOPROXY" = "true" ]; then \
        go env -w GOPROXY=https://goproxy.cn,direct; \
    fi

COPY go.mod ./
RUN go mod download

COPY . .

# 编译为静态二进制包，完全脱离 CGO 依赖
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o grade_monitor .

# Stage 2: Final minimal running image
FROM alpine:latest

# 安装基本的 ca 证书及本地时区支持
RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

# 从构建器中复制二进制文件
COPY --from=builder /app/grade_monitor .

EXPOSE 8000

# 默认启用 8000 端口启动
CMD ["./grade_monitor", "-port", "8000"]
