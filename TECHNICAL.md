# CloudMarking 云阅卷 — 技术文档

> 版本: 1.2.0 &emsp; 后端: FastAPI &emsp; 前端: React + TypeScript + Tailwind CSS &emsp; 部署: Docker

## 目录

- [1. 系统概述](#1-系统概述)
- [2. 系统架构](#2-系统架构)
- [3. 后端设计](#3-后端设计)
  - [3.1 技术栈](#31-技术栈)
  - [3.2 会话管理](#32-会话管理)
  - [3.3 API 参考](#33-api-参考)
  - [3.4 登录流程](#34-登录流程)
  - [3.5 错误处理](#35-错误处理)
- [4. 前端设计](#4-前端设计)
  - [4.1 组件结构](#41-组件结构)
  - [4.2 状态管理](#42-状态管理)
  - [4.3 UI 设计系统](#43-ui-设计系统)
  - [4.4 交互流程](#44-交互流程)
- [5. 部署](#5-部署)
  - [5.1 Docker 部署](#51-docker-部署)
  - [5.2 手动部署](#52-手动部署)
  - [5.3 反向代理](#53-反向代理)
- [6. 配置](#6-配置)
- [7. 故障排除](#7-故障排除)

---

## 1. 系统概述

CloudMarking 云阅卷是一个学生成绩自动查询系统，对接 [云阅卷平台](http://sxoma.com:8088/CloudMarking/)，提供 Web 界面完成从登录到成绩展示的完整流程，支持验证码 OCR 自动识别和 Telegram Bot 通知。

**核心能力：**

- 自动获取可用学校/组织列表
- 学生登录（自动 OCR 识别验证码）
- 历史考试列表及排名概览
- 单科详细成绩（分数、班排、级排、班均分、级均分）
- 较上次考试变化趋势
- 班级排名分布速览
- Telegram Bot 成绩推送

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                      User Browser                        │
│  ┌───────────────────────────────────────────────────┐  │
│  │              static/index.html (SPA)               │  │
│  │   Tailwind CSS + Vanilla JS  |  Glass Morphism UI  │  │
│  └──────────────────────┬────────────────────────────┘  │
└─────────────────────────┼───────────────────────────────┘
                          │ fetch()  JSON
┌─────────────────────────┼───────────────────────────────┐
│                Docker Container (python:3.11-slim)       │
│                          │                               │
│  ┌───────────────────────▼──────────────────────────┐   │
│  │                server.py (FastAPI)                │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │   │
│  │  │ Session  │  │  OCR     │  │  Telegram    │   │   │
│  │  │ Manager  │  │ (ddddocr)│  │  Sender      │   │   │
│  │  └──────────┘  └──────────┘  └──────────────┘   │   │
│  └──────────────────────┬──────────────────────────┘   │
└─────────────────────────┼───────────────────────────────┘
                          │  requests (Cookie Jar)
┌─────────────────────────┼───────────────────────────────┐
│                     External APIs                        │
│  ┌──────────────────┐  ┌──────────────────────────┐     │
│  │ CloudMarking     │  │ Telegram Bot API         │     │
│  │ sxoma.com:8088   │  │ api.telegram.org         │     │
│  └──────────────────┘  └──────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

**数据流概要：**

1. 前端通过 `fetch()` 向 `server.py` 发送请求
2. `server.py` 维护 `requests.Session` 对象，代理所有对云阅卷平台的 HTTP 调用
3. Cookie 自动保存在 `requests.Session` 中，无需前端参与
4. 验证码图片以 Base64 Data URI 形式返回前端直接渲染
5. 成绩数据经后端解析、结构化后以 JSON 返回前端展示

## 3. 后端设计

### 3.1 技术栈

| 组件 | 选型 | 说明 |
|------|------|------|
| Web 框架 | FastAPI | 自动 OpenAPI 文档，类型校验 |
| ASGI 服务器 | uvicorn | 轻量，生产可用 |
| HTTP 客户端 | requests | 自带 Cookie 持久化 |
| OCR 引擎 | ddddocr | 4 位验证码识别，准确率高 |
| 运行环境 | Python 3.11 | |

**依赖清单** (`requirements.txt`)：

```
fastapi>=0.100.0
uvicorn>=0.23.0
requests>=2.28.0
ddddocr>=1.4.0
python-multipart>=0.0.6
```

### 3.2 会话管理

系统使用内存字典存储用户会话，以 UUID 作为会话标识。

**数据结构：**

```python
sessions = {
    "<uuid>": {
        "http": requests.Session,   # Cookie 持久化的 HTTP 会话
        "logged_in": bool,          # 是否已登录
        "exam_params": dict | None, # 缓存的考试元数据
        "_at": float,               # 最后活动时间戳
    }
}
```

**生命周期：**

```
  POST /api/session           POST /api/login           GET /api/scores/{n}
  ──────────────────▶        ───────────────▶         ──────────────────▶
  创建会话                    标记 logged_in=True       刷新 _at
  _at = now                                              _at = now

  超时清理 (SESSION_TTL=1800s):
  每次 create_session() 调用时，自动删除 _at 超过 30 分钟的会话
```

**设计要点：**

- Cookie 由 `requests.Session` 自动管理，前端无需感知
- 会话 TTL 为 30 分钟，任何 API 调用都会刷新
- 清理操作在创建新会话时惰性执行，无需后台线程
- 单用户场景足够；多用户场景需替换为 Redis 等外部存储

### 3.3 API 参考

所有 API 均返回 `application/json`。错误响应格式：`{"detail": "错误描述"}`。

---

#### `POST /api/session`

创建会话，访问云阅卷首页获取初始 Cookie。

**响应：**

```json
{
  "session_id": "a1b2c3d4e5f6..."
}
```

**状态码：** `200` 成功 \| `502` 云阅卷平台不可达

---

#### `GET /api/organizations`

获取可用学校列表。无需会话。

**响应：**

```json
{
  "orgs": [
    {"id": "1003", "name": "西安市第八十九中学"},
    {"id": "1004", "name": "西安市汇知中学"}
  ]
}
```

**状态码：** `200` 成功 \| `502` 平台不可达

---

#### `POST /api/captcha`

获取验证码图片及 OCR 识别结果。

**请求：** `multipart/form-data`

| 参数 | 类型 | 说明 |
|------|------|------|
| session_id | string | 会话 ID |

**响应：**

```json
{
  "captcha_image": "data:image/png;base64,iVBORw0KG...",
  "captcha_text": "AB3X",
  "ocr_available": true
}
```

- `captcha_image`: 可直接赋给 `<img src="...">` 的 Data URI
- `captcha_text`: OCR 识别结果，为空表示识别失败（用户手动输入）
- `ocr_available`: ddddocr 是否已安装

**状态码：** `200` 成功 \| `404` 会话不存在 \| `502` 获取失败

---

#### `POST /api/login`

学生登录 + SSO 跳转。

**请求：** `multipart/form-data`

| 参数 | 类型 | 说明 |
|------|------|------|
| session_id | string | 会话 ID |
| org_id | string | 组织代码 |
| username | string | 学籍号 |
| password | string | 密码 |
| captcha | string | 验证码（4位） |

**响应：**

```json
{"status": "ok", "message": "登录成功"}
```

**状态码：** `200` 成功 \| `400` 验证码错误 / 密码错误 / 学籍号不存在 \| `404` 会话不存在 \| `502` 请求失败

---

#### `GET /api/exams`

获取考试列表和学生信息。

**请求：** Query 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| session_id | string | 会话 ID |

**响应：**

```json
{
  "student": {
    "name": "张三",
    "id": "20280349",
    "grade": "高一",
    "class": "3"
  },
  "school": "西安市第八十九中学",
  "exam_count": 2,
  "exams": [
    {
      "ksdm": "exam_code",
      "kldm": "category_code",
      "name": "2025-2026学年第二学期高一期中考试",
      "date": "2025-11-15",
      "class_rank": "49",
      "grade_rank": "368",
      "subjects": "化学 历史 地理"
    }
  ]
}
```

**状态码：** `200` 成功 \| `401` 未登录 \| `404` 会话不存在

---

#### `GET /api/scores/{exam_index}`

获取单次考试详细成绩。`exam_index` 从 0 开始，对应 `/api/exams` 返回的 `exams` 数组索引。

**请求：** Query 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| session_id | string | 会话 ID |

**响应：**

```json
{
  "exam_name": "2025-2026学年第二学期高一期中考试",
  "summary": {
    "total_score": "237.0",
    "class_rank": "49",
    "grade_rank": "368",
    "total_students": "63",
    "class_max": "276.0",
    "class_avg": "245.63",
    "class_min": "200.0"
  },
  "subjects": [
    {
      "name": "化学",
      "score": "86",
      "class_rank": "52",
      "grade_rank": "302",
      "class_avg": "89.7",
      "grade_avg": "85.3"
    }
  ],
  "strengths": "化学",
  "weaknesses": "历史,地理",
  "changes": [
    {"subject": "化学", "diff": 0.0687, "direction": "up"},
    {"subject": "历史", "diff": -0.0003, "direction": "down"}
  ],
  "classmates": [
    {"name": "李四", "total": "276.0"},
    {"name": "张三", "total": "237.0"}
  ]
}
```

**状态码：** `200` 成功 \| `400` 未获取考试列表 \| `404` 编号不存在

---

#### `POST /api/telegram`

发送 Telegram 通知。

**请求：** `multipart/form-data`

| 参数 | 类型 | 说明 |
|------|------|------|
| session_id | string | 会话 ID |
| exam_index | int | 考试编号 |
| tg_token | string | Bot Token |
| tg_chat_id | string | Chat ID |

**响应：**

```json
{"status": "ok", "message": "Telegram 通知发送成功"}
```

**Telegram 消息格式：**

```
2025-2026学年第二学期高一期中考试(合格考)
总分: 237.0  班排: 49/63  级排: 368
化学:86(B52/G302) | 历史:77(B41/G532) | 地理:74(B42/G586)
弱势: 历史,地理
变化: 化学+7% 历史-0% 地理+1%
```

### 3.4 登录流程

```
前端                         server.py                    CloudMarking
 │                              │                              │
 │  POST /api/session           │                              │
 │─────────────────────────────▶│                              │
 │                              │  GET /                       │
 │                              │─────────────────────────────▶│
 │                              │  ◀─── Set-Cookie: JSESSIONID │
 │  ◀─── session_id             │                              │
 │                              │                              │
 │  POST /api/captcha           │                              │
 │─────────────────────────────▶│                              │
 │                              │  GET /image.jsp              │
 │                              │─────────────────────────────▶│
 │                              │  ◀─── PNG bytes               │
 │                              │  ddddocr.classification()    │
 │  ◀─── {base64, ocr_text}    │                              │
 │                              │                              │
 │  POST /api/login             │                              │
 │─────────────────────────────▶│                              │
 │                              │  POST /xslogin.do            │
 │                              │  (slid, ksid, ksmm, xs_yzm) │
 │                              │─────────────────────────────▶│
 │                              │  ◀─── HTML (含 SSO 参数)      │
 │                              │  提取 yhzh, txmy, njdm       │
 │                              │  GET /sixslogin.do?...       │
 │                              │─────────────────────────────▶│
 │                              │  ◀─── 302 → CloudAnalysis    │
 │  ◀─── {status: "ok"}        │                              │
```

### 3.5 错误处理

**错误响应格式（FastAPI 自动生成）：**

```json
{"detail": "错误描述信息"}
```

**错误分类：**

| HTTP 状态码 | 含义 | 示例 |
|-------------|------|------|
| 400 | 客户端输入错误 | 验证码错误、密码错误、学籍号不存在 |
| 401 | 未登录 | 直接请求 `/api/exams` 而未登录 |
| 404 | 资源不存在 | 会话过期、考试编号越界 |
| 502 | 上游不可达 | 云阅卷平台宕机或网络不通 |

**前端处理策略：**

- 400 错误：在对应步骤卡片内展示红色错误提示
- 401/404：提示用户刷新页面重新开始
- 502：Toast 提示平台不可用，建议稍后重试
- 所有错误均不会导致页面崩溃，用户可从上一步重试

## 4. 前端设计

### 4.1 组件结构

```
index.html (SPA)
├── <header>                 # 标题栏
├── Step Indicator           # 4 步进度条 (选校 → 登录 → 验证码 → 成绩)
├── Step 1: 选校             # 玻璃拟态卡片网格
├── Step 2: 登录信息         # 学籍号 + 密码表单
├── Step 3: 验证码           # 验证码图片 + 输入框
├── Step 4: 成绩结果
│   ├── Student Info Bar     # 姓名、学号、学校、年级班级
│   ├── Exam List            # 考试卡片列表（点击展开详情）
│   ├── Score Detail Panel   # 统计卡片 + 科目表格 + 变化badge + 排名速览
│   └── Telegram Panel       # 可折叠的 Bot Token / Chat ID 配置
└── Toast                    # 全局浮动通知
```

### 4.2 状态管理

前端使用全局对象 `S` 维护应用状态，无框架依赖：

```javascript
const S = {
  sid: null,           // 后端会话 ID
  orgs: [],            // 学校列表缓存
  orgId: null,         // 选中的学校 ID
  orgName: null,       // 选中的学校名称
  exams: [],           // 考试列表
  currentExamIdx: -1,  // 当前查看的考试索引
};
```

**状态流转：**

```
[Step 1] 选校 → S.orgId / S.orgName
[Step 2] 输入账号密码
[Step 3] 获取验证码 → S.sid (首次创建会话)
         登录成功 → exams 查询结果写入 S.exams
[Step 4] 点击考试 → S.currentExamIdx 更新 → 触发成绩加载
         退出登录 → 重置 S.sid / S.exams → 回到 Step 1
```

### 4.3 UI 设计系统

**CSS 变量（玻璃拟态核心）：**

```css
:root {
  --glass-bg:        rgba(255,255,255,0.10);  /* 卡片背景 */
  --glass-border:    rgba(255,255,255,0.18);  /* 边框 */
  --glass-highlight: rgba(255,255,255,0.25);  /* 高光 */
  --glass-shadow:    0 8px 32px rgba(0,0,0,0.18); /* 投影 */
}
```

**组件样式类：**

| 类名 | 用途 | 关键属性 |
|------|------|----------|
| `.glass` | 主卡片容器 | `backdrop-filter: blur(16px) saturate(140%)` |
| `.glass-card` | 子卡片（组织、考试） | `backdrop-filter: blur(12px)`, hover 上浮效果 |
| `.glass-input` | 表单输入框 | 半透明背景 + focus 紫光 |
| `.glass-btn` | 按钮 | 渐变紫背景 + hover 发光 |
| `.glass-btn.success` | Telegram 发送按钮 | 绿色渐变 |
| `.glass-btn.danger` | 预留危险操作 | 红色渐变 |
| `.step-dot` | 步骤圆点 | 三种状态：active(紫光) / done(绿色) / 默认(灰色) |
| `.badge-up/down/flat` | 变化趋势标签 | 绿涨 / 红跌 / 灰平 |
| `.score-table` | 成绩表格 | 半透明分隔线 + hover 高亮 |

**背景设计：**

- 基础: `linear-gradient(135deg, #0f0c29, #1a1a4e, #24243e, #0f0c29)` 深色渐变
- 光晕: 3 层 `radial-gradient` 叠加（紫、蓝、粉），固定定位不随滚动

**字体：** `SF Pro Display` > `PingFang SC` > `Microsoft YaHei` > 系统默认

**响应式：** 基于 Tailwind `sm:` 断点（640px），移动端单列、桌面端多列

### 4.4 交互流程

```
页面加载
  │
  ▼
GET /api/organizations ──────── 加载学校列表
  │
  ▼
用户点击学校卡片 ─────────────── 进入 Step 2
  │
  ▼
用户输入学籍号 + 密码
  │
  ▼
POST /api/session (首次) ───── 创建会话
POST /api/captcha ──────────── 获取验证码 + OCR
  │
  ▼
OCR 成功 → 自动填充，用户确认
OCR 失败 → 用户手动输入
  │
  ▼
POST /api/login ────────────── 登录
  │
  ├─ 验证码错误 → 清空 sid → 重新获取验证码
  ├─ 密码错误 → 提示 → 留在 Step 3
  └─ 成功 →
        │
        ▼
      GET /api/exams ────────── 加载考试列表 + 学生信息
        │
        ▼
      用户点击某次考试
        │
        ▼
      GET /api/scores/{idx} ──── 加载详细成绩
        │
        ▼
      [可选] 展开 Telegram 面板 → 填写 Token + Chat ID → 发送通知
```

## 5. 部署

### 5.1 Docker 部署（推荐）

**前置条件：** Docker Engine 20.10+ 或 Docker Desktop

```bash
# 克隆项目
cd /path/to/tool

# 构建镜像
#   国内用户: docker compose build --build-arg USE_CN_MIRROR=true
#   海外用户: docker compose build
docker compose build

# 启动服务（后台运行，自动重启）
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

**端口：** `8000`（可通过 `docker-compose.yml` 修改）

**健康检查：** 容器每 30 秒自检 `http://localhost:8000/`，连续 3 次失败后 Docker 自动重启容器。

**镜像体积优化要点：**
- 基础镜像 `python:3.11-slim`（约 50MB 压缩后）
- apt 层和 pip 层合并，减少层数
- `--no-install-recommends` 跳过非必需包
- 安装后清理 apt 缓存

### 5.2 手动部署

```bash
# 1. 安装 Python 3.11+
python --version

# 2. 安装系统依赖 (ddddocr 需要)
# Debian/Ubuntu:
sudo apt install -y libgl1 libglib2.0-0 libsm6 libxext6 libxrender-dev

# 3. 安装 Python 依赖
pip install -r requirements.txt

# 4. 启动服务
python server.py
# 监听 http://0.0.0.0:8000
```

### 5.3 反向代理

**Nginx 配置示例：**

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

> 注意：云阅卷平台使用 HTTP (非 HTTPS)，且监听非标准端口 8088，请确保服务器出站规则允许访问 `sxoma.com:8088`。

## 6. 配置

**Telegram 通知：**

Telegram 配置通过前端 UI 直接输入，无需配置文件。获取方式：

1. Telegram 搜索 `@BotFather`，发送 `/newbot`，按提示创建机器人，获得 **HTTP API Token**
2. Telegram 搜索 `@userinfobot`，发送 `/start`，获得你的 **Chat ID**
3. 先给刚创建的 Bot 发一条任意消息（Telegram 限制：Bot 不能主动发起对话）

**验证码 OCR：**

- Docker 部署时 `ddddocr` 自动安装
- 手动部署时 `pip install ddddocr` 即可
- 若未安装 OCR 引擎，验证码将无自动识别，需用户手动输入

**会话 TTL：**

- 默认 30 分钟（`SESSION_TTL = 1800`）
- 修改 `server.py:53` 即可调整

## 7. 故障排除

### 容器无法启动

```bash
# 查看构建日志
docker compose build --no-cache

# 查看运行日志
docker compose logs cloudmarking

# 常见原因:
#   1. 容器内无法访问 sxoma.com:8088 → 检查 DNS/防火墙
#   2. ddddocr 安装失败 → 检查 pip 镜像是否可达
```

### 验证码识别失败

```
现象: 验证码显示 "OCR 识别失败，请手动输入"
原因: ddddocr 未安装或识别准确率不足
处理: 手动输入图片中的 4 位验证码即可
```

### 登录后无考试记录

```
现象: 登录成功但考试列表为空
原因: 该学生账户下暂无考试数据
处理: 确认云阅卷平台上有该学生的考试记录
```

### 会话频繁过期

```
现象: 操作中途提示 "会话不存在或已过期"
原因: 超过 30 分钟无操作
处理: 刷新页面重新开始；可调大 SESSION_TTL
```

### Telegram 发送失败

```
常见 Telegram API 错误:
  "chat not found"    → Bot 未给该用户发过消息，先手动发一条
  "unauthorized"      → Token 错误
  "Bad Request"       → Chat ID 格式错误（应为纯数字字符串）
```

---

## 附录

### 支持的学校

| 组织代码 | 学校 |
|----------|------|
| 1001 | 八十九中教育集团（旧） |
| 1003 | 西安市第八十九中学 |
| 1004 | 西安市汇知中学 |
| 1005 | 分校东(38) |
| 1006 | 分校西(大明宫) |
| 9999 | 西工大附中 |

### 文件清单

```
tool/
├── server.py              # FastAPI 后端服务
├── static/
│   └── index.html         # 前端 SPA
├── requirements.txt       # Python 依赖
├── Dockerfile             # Docker 镜像定义
├── docker-compose.yml     # Docker Compose 配置
├── .dockerignore          # Docker 构建排除
├── student_login.sh       # [保留] 原始命令行脚本
├── telegram.conf          # [保留] Telegram 配置模板
└── README.md              # [保留] 项目介绍
```
