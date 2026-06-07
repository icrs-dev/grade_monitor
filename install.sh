#!/usr/bin/env bash

# ==============================================================================
#  CloudMarking 成绩监控系统 — Linux 一键部署服务化脚本
# ==============================================================================

set -e

# 彩色输出支持
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo "======================================================================"
echo "    __  __      _ _             ____        _ _     _ "
echo "   |  \/  |    | (_)           |  _ \      (_) |   | |"
echo "   | \  / | ___| |_  ___  _ __ | |_) |_   _ _| | __| |"
echo "   | |\/| |/ _ \ | |/ _ \| '_ \|  _ <| | | | | |/ _\` |"
echo "   | |  | |  __/ | | (_) | | | | |_) | |_| | | | (_| |"
echo "   |_|  |_|\___|_|_|\___/|_| |_|____/ \__,_|_|_|\__,_|"
echo "                                                      "
echo "        CloudMarking 成绩监控系统 — 一键部署服务化工具"
echo "======================================================================"
echo -e "${NC}"

# 1. 检查 root 权限 (Systemd 服务注册需要)
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}错误: 注册 Systemd 系统服务需要 root 权限，请使用 sudo 或 root 账号运行此脚本。${NC}"
    exit 1
fi

# 2. 检查本地是否存在 config.json，若无则初始化默认配置
init_config_json() {
    if [ ! -f "config.json" ]; then
        echo -e "${YELLOW}未检测到 config.json，正在初始化默认配置文件...${NC}"
        cat <<EOF > config.json
{
  "org_id": "",
  "username": "",
  "password": "",
  "tg_token": "",
  "tg_chat_id": "",
  "monitor_enabled": false,
  "monitor_interval": 3600,
  "last_hash": "",
  "last_check": "",
  "last_scores": null,
  "last_error": "",
  "consecutive_failures": 0,
  "api_key": ""
}
EOF
        # 赋予读写权限
        chmod 666 config.json
        echo -e "${GREEN}配置文件 config.json 初始化完成。${NC}"
    fi
}

# 3. 部署方案一：通过 Docker 容器一键构建运行
install_via_docker() {
    echo -e "${BLUE}=== 方案 1: 使用 Docker 容器化构建运行 ===${NC}"
    
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}未检测到 Docker 环境，请先安装 Docker (或使用方案 2 本地编译服务)。${NC}"
        exit 1
    fi

    init_config_json

    read -p "请输入服务对外映射端口 [默认: 8000]: " PORT
    PORT=${PORT:-8000}

    echo -e "${YELLOW}正在通过多阶段构建极简 Go 容器镜像 (约 30MB)...${NC}"
    docker build -t grade_monitor .

    echo -e "${YELLOW}正在清理同名旧容器 (若存在)...${NC}"
    docker rm -f grade_monitor 2>/dev/null || true

    echo -e "${YELLOW}正在启动 Docker 容器并挂载配置文件...${NC}"
    docker run -d \
        --name grade_monitor \
        -p "${PORT}":8000 \
        -v "$(pwd)"/config.json:/app/config.json \
        --restart unless-stopped \
        grade_monitor

    echo -e "${GREEN}恭喜！Docker 容器已在后台运行。${NC}"
    echo -e "访问地址: ${CYAN}http://你的服务器IP:${PORT}/${NC}"
    echo -e "你可以通过运行 ${YELLOW}docker logs -f grade_monitor${NC} 查看监控实时运行日志。"
}

# 4. 部署方案二：本地自动装 Go + 编译并配置为 Systemd 系统服务
install_via_systemd() {
    echo -e "${BLUE}=== 方案 2: 本地编译并配置为 Systemd 服务 (开机自启) ===${NC}"

    # 4.1 自动检查并安装 Go 环境
    if ! command -v go &> /dev/null; then
        echo -e "${YELLOW}未检测到 Go 编译环境，正在一键安装官方 Go 1.21.10...${NC}"
        
        ARCH=$(uname -m)
        if [ "$ARCH" = "x86_64" ]; then
            GO_ARCH="amd64"
        elif [ "$ARCH" = "aarch64" ]; then
            GO_ARCH="arm64"
        else
            echo -e "${RED}不支持的 CPU 架构: ${ARCH}，请手动安装 Go 后重试。${NC}"
            exit 1
        fi

        # 下载官方 Linux 包 (国内镜像)
        GO_URL="https://golang.google.cn/dl/go1.21.10.linux-${GO_ARCH}.tar.gz"
        echo -e "正在下载 Go 包: ${CYAN}${GO_URL}${NC}"
        curl -L -o go.tar.gz "$GO_URL"

        echo -e "${YELLOW}正在解压 Go 到 /usr/local/go...${NC}"
        rm -rf /usr/local/go
        tar -C /usr/local -xzf go.tar.gz
        rm go.tar.gz

        # 写入全局环境变量
        if ! grep -q "/usr/local/go/bin" /etc/profile; then
            echo 'export PATH=$PATH:/usr/local/go/bin' >> /etc/profile
        fi
        export PATH=$PATH:/usr/local/go/bin
        echo -e "${GREEN}Go 1.21.10 安装配置成功！${NC}"
    else
        echo -e "${GREEN}检测到本地 Go 环境: $(go version)${NC}"
    fi

    # 4.2 编译代码
    init_config_json
    echo -e "${YELLOW}正在整理 Go 模块依赖并进行静态编译...${NC}"
    go env -w GOPROXY=https://goproxy.cn,direct
    go mod tidy
    
    # 静态编译
    CGO_ENABLED=0 go build -o grade_monitor .
    echo -e "${GREEN}二进制可执行文件 grade_monitor 编译成功！${NC}"

    # 4.3 配置 Systemd 服务
    read -p "请输入本地服务监听端口 [默认: 8000]: " PORT
    PORT=${PORT:-8000}

    CURRENT_DIR=$(pwd)
    echo -e "${YELLOW}正在配置 Systemd 服务文件 (/etc/systemd/system/grade-monitor.service)...${NC}"

    cat <<EOF > /etc/systemd/system/grade-monitor.service
[Unit]
Description=CloudMarking Student Grade Monitor Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${CURRENT_DIR}
ExecStart=${CURRENT_DIR}/grade_monitor -port ${PORT}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    echo -e "${YELLOW}正在重新加载 Systemd 配置并启动服务...${NC}"
    systemctl daemon-reload
    systemctl enable grade-monitor
    systemctl restart grade-monitor

    echo -e "${GREEN}恭喜！CloudMarking 服务已成功以守护进程挂载后台运行，且设置为开机自启。${NC}"
    echo -e "服务端口: ${PORT}"
    echo -e "服务管理常用指令："
    echo -e "  - 启动服务: ${YELLOW}systemctl start grade-monitor${NC}"
    echo -e "  - 停止服务: ${YELLOW}systemctl stop grade-monitor${NC}"
    echo -e "  - 重启服务: ${YELLOW}systemctl restart grade-monitor${NC}"
    echo -e "  - 查看状态: ${YELLOW}systemctl status grade-monitor${NC}"
    echo -e "  - 查看实时日志: ${YELLOW}journalctl -u grade-monitor -f${NC}"
    echo -e "\n访问地址: ${CYAN}http://你的服务器IP:${PORT}/${NC}"
}

# 5. 仅编译二进制文件
only_compile() {
    echo -e "${BLUE}=== 方案 3: 仅在本地编译二进制可执行包 ===${NC}"
    if ! command -v go &> /dev/null; then
        echo -e "${RED}未检测到 Go 环境。请先安装 Go 语言环境后重试。${NC}"
        exit 1
    fi
    init_config_json
    go env -w GOPROXY=https://goproxy.cn,direct
    go mod tidy
    CGO_ENABLED=0 go build -o grade_monitor .
    echo -e "${GREEN}二进制包 grade_monitor 编译完成！${NC}"
    echo -e "你可以通过运行 ${YELLOW}./grade_monitor -port 8000${NC} 手动开启服务。"
}

# 主菜单交互
echo -e "请选择您的安装方案："
echo -e "  ${GREEN}1. 使用 Docker 一键构建与运行 (推荐，最省心)${NC}"
echo -e "  ${GREEN}2. 本地自动安装 Go、编译并配置为 Systemd 常驻服务 (开机自启)${NC}"
echo -e "  ${GREEN}3. 仅在本地进行 Go 编译生成二进制包${NC}"
echo -e "  ${RED}4. 退出安装${NC}"
read -p "请输入数字 [1-4]: " CHOICE

case "$CHOICE" in
    1)
        install_via_docker
        ;;
    2)
        install_via_systemd
        ;;
    3)
        only_compile
        ;;
    4)
        echo "已退出安装。"
        exit 0
        ;;
    *)
        echo -e "${RED}输入无效数字，已退出。${NC}"
        exit 1
        ;;
esac
