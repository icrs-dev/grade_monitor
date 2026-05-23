# CloudMarking 云阅卷 - 学生成绩自动查询

自动登录 [云阅卷平台](http://sxoma.com:8088/CloudMarking/) 并获取考试成绩，支持 Terminal 展示和 Telegram Bot 通知。

## 功能

- 自动获取可用学校/组织列表
- 学生登录（需手动输入验证码）
- 列出所有历史考试及排名概览
- 查看单科详细成绩（分数、班排、级排、班均分、级均分）
- 较上次考试变化趋势
- 班级排名分布
- **Telegram Bot 通知** — 成绩推送到手机

## 快速开始

```bash
# 交互式（推荐首次使用）
./student_login.sh

# 命令行参数
./student_login.sh -o 1003 -u 20280349 -p 20281710

# 全自动（含验证码）
./student_login.sh -o 1003 -u 20280349 -p 20281710 -c ABCD
```

## 参数说明

| 参数               | 说明                 |
| ---------------- | ------------------ |
| `-o, --org`      | 组织代码（学校 SLID）      |
| `-u, --user`     | 学籍号 / 考生号          |
| `-p, --pass`     | 密码                 |
| `-c, --captcha`  | 验证码（4位），不提供则交互式输入  |
| `-t, --tg-token` | Telegram Bot Token |
| `-d, --tg-chat`  | Telegram Chat ID   |
| `-h, --help`     | 查看帮助和可用组织列表        |

## 依赖

- `bash`
- `curl`
- `python` (Python 3)
- 以上均为系统自带，无需额外安装

## 登录流程

脚本自动完成以下步骤：

```
1. GET  CloudMarking/                  → 获取 JSESSIONID
2. POST CloudMarking/xslogin.do        → 学生登录，获取 SSO 令牌
3. GET  CloudAnalysis/sixslogin.do     → 302 跳转到学生主页
4. POST CloudAnalysis/stunavi_getNavi.do      → 获取考试列表
5. POST CloudAnalysis/stuckfx_getStuNavi.do   → 获取单次详细成绩
```

## Telegram 通知

### 配置方式

**方式一：配置文件（推荐）**

编辑 `telegram.conf`：

```ini
TG_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TG_CHAT_ID=987654321
```

**方式二：命令行参数**

```bash
./student_login.sh -o 1003 -u 20280349 -p 20281710 \
  -t "123456:ABC..." -d "987654321"
```

### 获取 Bot Token 和 Chat ID

1. Telegram 搜索 **@BotFather**，发送 `/newbot`，按提示创建机器人，获得 HTTP API Token
2. Telegram 搜索 **@userinfobot**，发送 `/start`，获得你的 Chat ID
3. **先给你刚创建的 Bot 发一条任意消息**（Telegram 限制：Bot 不能主动发起对话）

### 通知示例

成绩查询成功后，Telegram 会收到：

```
2025-2026学年第二学期高一期中考试(合格考)
总分: 237.0  班排: 49/63  级排: 368
化学:86(B52/G302) | 历史:77(B41/G532) | 地理:74(B42/G586)
弱势: 历史,地理
变化: 化学+7% 历史-0% 地理+1%
```

## 输出示例

```
============================================
  2025-2026学年第二学期高一期中考试(合格考)
============================================
  总分: 237.0  班排: 49/63  级排: 368
  班最高: 276.0  班平均: 245.63  班最低: 200.0

  科目   分数   班排   级排     班均分
  ------------------------------------------------------------
  化学   86     52     302      89.7
  历史   77     41     532      78.83
  地理   74     42     586      77.11

  弱势科目: 历史,地理
  化学: up +6.87%
  历史: down -0.03%
  地理: up +1.36%
```

## 可用学校

| 组织代码 | 学校          |
| ---- | ----------- |
| 1001 | 八十九中教育集团（旧） |
| 1003 | 西安市第八十九中学   |
| 1004 | 西安市汇知中学     |
| 1005 | 分校东(38)     |
| 1006 | 分校西(大明宫)    |
| 9999 | 西工大附中       |

## 定时运行

配合 cron 或 Windows 任务计划程序可实现定时查分：

```bash
# Linux/Mac crontab - 每天早上8点执行（需解决验证码问题）
# 0 8 * * * /path/to/student_login.sh -o 1003 -u 账号 -p 密码
```

## Nginx 反代部署

### 独立子域名

```nginx
server {
    listen 443 ssl http2;
    server_name cloudmarking.your-domain.com;

    ssl_certificate     /etc/ssl/certs/cloudmarking.pem;
    ssl_certificate_key /etc/ssl/private/cloudmarking.key;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

```bash
# 启动后端
python server.py
# 或 Docker:
docker compose up -d
```

### 子目录部署

```nginx
location /cloudmarking/ {
    proxy_pass http://127.0.0.1:8000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

启动时设置环境变量：

```bash
# 直接运行
APP_ROOT_PATH=/cloudmarking python server.py

# Docker Compose (.env 文件)
echo "APP_ROOT_PATH=/cloudmarking" > .env
docker compose up -d
```

前端会自动检测子目录路径，无需额外配置。详细配置见 `nginx.conf`。

## License

MIT
