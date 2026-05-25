"""
CloudMarking 云阅卷 — Web 后端
FastAPI + ddddocr OCR + Telegram 通知
"""
import os
import re
import json
import time
import uuid
import base64
import hashlib
import threading
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from collections import defaultdict

# ── Timezone ─────────────────────────────────────────────
CST = timezone(timedelta(hours=8))  # UTC+08:00 中国标准时间
from typing import Optional

from fastapi import FastAPI, HTTPException, Form, Query, Request, Cookie, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
import requests

# ── Logging ──────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cloudmarking")

# ── Constants ────────────────────────────────────────────
BASE = "http://sxoma.com:8088/CloudMarking"
BASE2 = "http://sxoma.com:8088/CloudAnalysis"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
SESSION_TTL = 1800  # 30 分钟无活动则过期

# Rate limiting
LOGIN_RATE_WINDOW = 300  # 5 分钟窗口
MAX_LOGIN_ATTEMPTS_IP = 20
MAX_LOGIN_ATTEMPTS_USERNAME = 5

# ── OCR ──────────────────────────────────────────────────
try:
    import ddddocr

    _ocr = ddddocr.DdddOcr(show_ad=False)
    HAS_OCR = True
except ImportError:
    _ocr = None
    HAS_OCR = False

# ── Config ───────────────────────────────────────────────
CONFIG_FILE = Path(__file__).parent / "config.json"
_config_lock = threading.Lock()

CONFIG_DEFAULTS = {
    "org_id": "",
    "username": "",
    "password": "",
    "tg_token": "",
    "tg_chat_id": "",
    "monitor_enabled": False,
    "monitor_interval": 3600,
    "last_hash": "",
    "last_check": "",
    "last_scores": None,
    "last_error": "",
    "consecutive_failures": 0,
    "api_key": "",
}


def load_config():
    try:
        if CONFIG_FILE.exists():
            cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            for k, v in CONFIG_DEFAULTS.items():
                cfg.setdefault(k, v)
            return cfg
    except Exception:
        pass
    return dict(CONFIG_DEFAULTS)


def save_config(cfg):
    with _config_lock:
        CONFIG_FILE.write_text(
            json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8"
        )


def get_api_key():
    """获取或自动生成管理 API 密钥"""
    cfg = load_config()
    key = cfg.get("api_key", "")
    if not key:
        key = uuid.uuid4().hex
        cfg["api_key"] = key
        save_config(cfg)
        logger.info(f"已生成管理 API 密钥: {key[:8]}...")
    return key


# ── Session store ────────────────────────────────────────
# { sid: { "http": requests.Session, "logged_in": bool, "exam_params": dict, "_at": float } }
sessions: dict = {}

# ── Rate limiting store ──────────────────────────────────
_login_attempts: dict = {
    "ip": defaultdict(list),       # "ip": [(timestamp, username), ...]
    "username": defaultdict(list),  # "username": [(timestamp, ip), ...]
}
_rate_lock = threading.Lock()

# ── FastAPI app ──────────────────────────────────────────
APP_ROOT = os.environ.get("APP_ROOT_PATH", "")
app = FastAPI(
    title="CloudMarking 云阅卷",
    version="1.2.0",
    root_path=APP_ROOT,
    servers=[{"url": APP_ROOT}] if APP_ROOT else None,
)


# ═══════════════════════════════════════════════════════
#  Security Headers Middleware
# ═══════════════════════════════════════════════════════

@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = (
        "camera=(), microphone=(), geolocation=()"
    )
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; "
        "connect-src 'self' https://static.cloudflareinsights.com; "
        "font-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )
    return response


# ── Helpers ──────────────────────────────────────────────


def _debug_dump(label: str, data: dict):
    """Log top-level keys and nested structures of API response for debugging."""
    def _shape(obj, depth=0):
        if depth > 2:
            return "..."
        if isinstance(obj, dict):
            return {k: _shape(v, depth + 1) for k, v in obj.items()}
        if isinstance(obj, list):
            if not obj:
                return []
            return [_shape(obj[0], depth + 1), f"... ({len(obj)} items)"]
        if isinstance(obj, str):
            return obj[:80] + ("..." if len(obj) > 80 else "")
        return type(obj).__name__

    try:
        logger.info(
            f"[DEBUG] {label}: {json.dumps(_shape(data), ensure_ascii=False, indent=2)}"
        )
    except Exception:
        logger.info(f"[DEBUG] {label}: (dump failed)")


# ═══════════════════════════════════════════════════════
#  Auth Dependencies
# ═══════════════════════════════════════════════════════


def _session(sid: str) -> requests.Session:
    """验证会话存在并刷新 TTL"""
    if sid not in sessions:
        raise HTTPException(404, "会话不存在或已过期，请刷新页面")

    s = sessions[sid]
    s["_at"] = time.time()
    return s["http"]


def _require_login(sid: str) -> requests.Session:
    """验证会话已登录"""
    http = _session(sid)
    if not sessions[sid].get("logged_in"):
        raise HTTPException(401, "请先登录")
    return http


def _require_admin(
    admin_token: str = Cookie(None, alias="admin_token"),
) -> None:
    """验证管理 API 密钥 (来自 Cookie)"""
    if not admin_token or admin_token != get_api_key():
        raise HTTPException(401, "管理认证失败，请刷新页面重试")


def _check_rate_limit(request: Request, username: str):
    """登录频率限制检查，超限抛出 HTTPException(429)"""
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    window_start = now - LOGIN_RATE_WINDOW

    with _rate_lock:
        # 清理过期记录
        _login_attempts["ip"][ip] = [
            (ts, un)
            for ts, un in _login_attempts["ip"][ip]
            if ts > window_start
        ]
        _login_attempts["username"][username] = [
            (ts, i)
            for ts, i in _login_attempts["username"][username]
            if ts > window_start
        ]

        ip_count = len(_login_attempts["ip"][ip])
        if ip_count >= MAX_LOGIN_ATTEMPTS_IP:
            logger.warning(f"IP 频率限制触发: {ip} ({ip_count} 次)")
            raise HTTPException(429, "登录尝试过于频繁，请稍后再试")

        uname_count = len(_login_attempts["username"][username])
        if uname_count >= MAX_LOGIN_ATTEMPTS_USERNAME:
            logger.warning(f"用户名频率限制触发: {username} ({uname_count} 次)")
            raise HTTPException(429, "该账号登录尝试过于频繁，请稍后再试")

        _login_attempts["ip"][ip].append((now, username))
        _login_attempts["username"][username].append((now, ip))


def _sanitize_telegram_html(text: str) -> str:
    """移除危险 HTML 标签，仅保留 Telegram 安全标签"""
    dangerous = (
        r"<\s*(script|iframe|object|embed|link|style|meta|applet"
        r"|form|input|base|frame|frameset|head|html|body)"
        r"[^>]*>.*?<\s*/\s*\1\s*>"
        r"|"
        r"<(script|iframe|object|embed|link|style|meta|applet"
        r"|form|input|base|frame|frameset|head|html|body)[^>]*/?>"
    )
    sanitized = re.sub(dangerous, "", text, flags=re.IGNORECASE | re.DOTALL)
    if len(sanitized) > 4096:
        sanitized = sanitized[:4096]
    return sanitized


def _parse_sso(body: str):
    """Extract SSO tokens from CloudMarking login response."""
    yhzh = re.search(r'var yhzh\s*=\s*"([^"]+)"', body)
    txmy = re.search(r'var txmy\s*=\s*"([^"]+)"', body)
    njdm = re.search(r'var njdm\s*=\s*"([^"]+)"', body)
    if not (yhzh and txmy and njdm):
        yhzh = re.search(r"yhzh\s*=\s*'([^']+)'", body)
        txmy = re.search(r"txmy\s*=\s*'([^']+)'", body)
        njdm = re.search(r"njdm\s*=\s*'([^']+)'", body)
    if not (yhzh and txmy and njdm):
        snippet = body[:600]
        logger.error(f"SSO parse failed. Body preview: {snippet}")
        raise HTTPException(500, f"登录响应异常，未找到SSO跳转参数")
    return yhzh.group(1), txmy.group(1), njdm.group(1)


# ═══════════════════════════════════════════════════════
#  Monitor Thread
# ═══════════════════════════════════════════════════════

_monitor_thread: Optional[threading.Thread] = None


class MonitorThread(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self._stop = threading.Event()
        self._running = False

    @property
    def running(self):
        return self._running and not self._stop.is_set()

    def stop(self):
        self._stop.set()

    def run(self):
        self._running = True
        logger.info("监测线程已启动")
        while not self._stop.is_set():
            cfg = load_config()
            if not cfg.get("monitor_enabled"):
                logger.info("监测已被配置禁用，退出线程")
                break

            try:
                self._do_check(cfg)
                cfg["consecutive_failures"] = 0
                cfg["last_error"] = ""
            except Exception as e:
                cfg["consecutive_failures"] = cfg.get("consecutive_failures", 0) + 1
                cfg["last_error"] = str(e)
                logger.error(
                    f"监测检查失败 (连续 {cfg['consecutive_failures']} 次): {e}"
                )
                if "FATAL" in str(e):
                    cfg["monitor_enabled"] = False
                    save_config(cfg)
                    if cfg.get("tg_token") and cfg.get("tg_chat_id"):
                        self._send_tg(
                            cfg,
                            f"<b>CloudMarking 监测已停用</b>\n{cfg['last_error']}",
                        )
                    break
                if (
                    cfg["consecutive_failures"] >= 3
                    and cfg.get("tg_token")
                    and cfg.get("tg_chat_id")
                ):
                    self._send_tg(
                        cfg,
                        f"<b>CloudMarking 监测告警</b>\n连续 {cfg['consecutive_failures']} 次检查失败\n最近错误: {e}",
                    )

            save_config(cfg)
            self._stop.wait(cfg.get("monitor_interval", 3600))

        self._running = False
        cfg = load_config()
        cfg["monitor_enabled"] = False
        save_config(cfg)
        logger.info("监测线程已停止")

    # ── Full auto-login + check ──────────────────────────

    def _do_check(self, cfg):
        now_str = datetime.now(CST).isoformat()
        sess = requests.Session()
        sess.headers.update({"User-Agent": UA})

        # 1. 首页 Cookie
        sess.get(f"{BASE}/", timeout=15)

        # 2. 验证码 + OCR (最多重试 3 次)
        captcha = self._get_captcha(sess)

        # 3. 登录
        resp = sess.post(
            f"{BASE}/xslogin.do",
            data={
                "slid": cfg["org_id"],
                "ksid": cfg["username"],
                "ksmm": cfg["password"],
                "xs_yzm": captcha,
                "dlfs": "1",
            },
            timeout=20,
        )
        body = resp.text

        if re.search(r"验证码错误|验证码不正确|验证码已过期", body):
            raise Exception("验证码错误 (自动识别失败)")
        if re.search(r"密码错误|密码不正确", body):
            cfg["monitor_enabled"] = False
            raise Exception("FATAL: 密码错误，监测已停用")
        if re.search(r"用户不存在|账号不存在|考生不存在|学籍号不存在", body):
            cfg["monitor_enabled"] = False
            raise Exception("FATAL: 学籍号不存在，监测已停用")

        # 4. SSO 跳转
        yhzh, txmy, njdm = _parse_sso(body)
        sess.get(
            f"{BASE2}/sixslogin.do?yhzh={yhzh}&txmy={txmy}&njdm={njdm}", timeout=15
        )

        # 5. 获取考试列表
        resp = sess.post(
            f"{BASE2}/stunavi_getNavi.do",
            data={"ksid": "", "njdm": ""},
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": f"{BASE2}/web/stu/navi.jsp",
            },
            timeout=15,
        )
        exam_data = resp.json()
        if not exam_data.get("res"):
            raise Exception(f"获取考试列表失败: {exam_data.get('msg', '')}")

        stu = exam_data.get("kshengjcxx", {})
        exams = exam_data.get("lcksxx", [])

        # 6. 获取每场考试详情
        all_scores = []
        for e in exams:
            resp = sess.post(
                f"{BASE2}/stuckfx_getStuNavi.do",
                data={
                    "ksdm": e.get("KSDM", ""),
                    "kldm": e.get("KLDM", ""),
                    "ksid": stu.get("KSID", ""),
                    "bjdm": stu.get("BJDM", ""),
                    "njdm": stu.get("NJDM", ""),
                    "kmdm": "",
                },
                headers={
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": f"{BASE2}/web/stu/ckfx.jsp",
                },
                timeout=15,
            )
            score = resp.json()
            if score.get("res"):
                _debug_dump(f"monitor score '{e.get('KSMC','')}'", score)
                all_scores.append(
                    {
                        "exam_name": e.get("KSMC", ""),
                        "exam_date": (e.get("KSSJ", "") or "")[:10],
                        "data": score,
                    }
                )

        # 7. 计算哈希 + 变化检测
        hash_input = json.dumps(
            all_scores, sort_keys=True, ensure_ascii=False, default=str
        )
        new_hash = hashlib.md5(hash_input.encode()).hexdigest()
        old_hash = cfg.get("last_hash", "")
        changed = old_hash and new_hash != old_hash

        # 8. 构建缓存
        cached_scores = []
        for item in all_scores:
            d = item["data"]
            bj = d.get("bjcjjizhi", {})
            cj = d.get("cjpmbrkm", {})
            cached_scores.append(
                {
                    "exam_name": item["exam_name"],
                    "exam_date": item["exam_date"],
                    "total_score": cj.get("ZF", ""),
                    "class_rank": cj.get("BJPM", ""),
                    "grade_rank": cj.get("JFPM", ""),
                    "total_students": bj.get("ZRS", ""),
                    "subjects": [
                        {
                            "name": km.get("KMMC", ""),
                            "score": km.get("KSCJ", ""),
                            "class_rank": km.get("BJPM", ""),
                            "grade_rank": km.get("NJPM", ""),
                        }
                        for km in d.get("gkksxx", [])
                    ],
                }
            )

        cfg["last_hash"] = new_hash
        cfg["last_check"] = now_str
        cfg["last_scores"] = {
            "student": {
                "name": stu.get("XM", ""),
                "id": stu.get("KSID", ""),
                "grade": stu.get("NJMC", ""),
                "class": stu.get("BJMC", ""),
            },
            "school": exam_data.get("zzmc", ""),
            "exams": cached_scores,
        }

        if changed and cfg.get("tg_token") and cfg.get("tg_chat_id"):
            self._notify_changes(cfg, all_scores)

        logger.info(f"监测检查完成 hash={new_hash[:8]} changed={changed}")

    # ── Captcha OCR with retry ───────────────────────────

    def _get_captcha(self, sess):
        for attempt in range(3):
            resp = sess.get(
                f"{BASE}/image.jsp?rnd={int(time.time() * 1000)}", timeout=15
            )
            img_bytes = resp.content
            if HAS_OCR:
                try:
                    result = _ocr.classification(img_bytes)
                    if result and len(result) == 4 and result.isalnum():
                        return result
                except Exception:
                    pass
            if attempt < 2:
                time.sleep(5)
        raise Exception("验证码 OCR 识别失败 (已重试 3 次)")

    # ── Telegram notification on changes ─────────────────

    def _notify_changes(self, cfg, all_scores):
        for item in all_scores:
            d = item["data"]
            bj = d.get("bjcjjizhi", {})
            cj = d.get("cjpmbrkm", {})
            lines = []
            lines.append(f'<b>{item["exam_name"]}</b>')
            lines.append(
                f'总分: {cj.get("ZF","?")}  '
                f'班排: {cj.get("BJPM","?")}/{bj.get("ZRS","?")}  '
                f'级排: {cj.get("JFPM","?")}'
            )
            subs = []
            for km in d.get("gkksxx", []):
                subs.append(
                    f'{km["KMMC"]}:{km["KSCJ"]}(B{km["BJPM"]}/G{km["NJPM"]})'
                )
            lines.append(" | ".join(subs))
            xdb = cj.get("XDBRKMMC", "")
            if xdb:
                lines.append(f"弱势: {xdb}")
            changes = []
            for gk in d.get("grgkpwlist", d.get("bckscjkmlist", [])):
                diff = gk.get("CJL", 0)
                sign = "+" if diff > 0 else ("-" if diff < 0 else "=")
                changes.append(f'{gk["KMMC"]}{sign}{abs(diff)*100:.0f}%')
            if changes:
                lines.append("变化: " + " ".join(changes))
            self._send_tg(cfg, "\n".join(lines))

    def _send_tg(self, cfg, text):
        try:
            requests.post(
                f'https://api.telegram.org/bot{cfg["tg_token"]}/sendMessage',
                json={
                    "chat_id": cfg["tg_chat_id"],
                    "text": text,
                    "parse_mode": "HTML",
                },
                timeout=15,
            )
        except Exception as e:
            logger.error(f"Telegram 发送失败: {e}")


def get_monitor() -> Optional[MonitorThread]:
    global _monitor_thread
    return _monitor_thread if (_monitor_thread and _monitor_thread.running) else None


# ═══════════════════════════════════════════════════════
#  API Endpoints
# ═══════════════════════════════════════════════════════


@app.post("/api/session")
def create_session():
    """建立会话，获取初始 Cookie"""
    now = time.time()
    expired = [
        sid
        for sid, v in sessions.items()
        if now - v.get("_at", 0) > SESSION_TTL
    ]
    for sid in expired:
        del sessions[sid]
    if expired:
        logger.info(f"清理 {len(expired)} 个过期会话")

    sid = uuid.uuid4().hex
    http = requests.Session()
    http.headers.update({"User-Agent": UA})
    try:
        http.get(f"{BASE}/", timeout=15)
    except requests.RequestException as e:
        raise HTTPException(502, f"无法连接云阅卷平台: {e}")

    sessions[sid] = {
        "http": http,
        "logged_in": False,
        "exam_params": None,
        "_at": now,
    }
    logger.info(f"会话已创建: {sid[:8]}...")
    return {"session_id": sid}


@app.get("/api/organizations")
def get_organizations():
    """获取可用学校/组织列表"""
    http = requests.Session()
    http.headers.update({"User-Agent": UA})
    try:
        http.get(f"{BASE}/", timeout=15)
        resp = http.get(
            f"{BASE}/system_xsloginsllist.do",
            headers={"X-Requested-With": "XMLHttpRequest"},
            timeout=15,
        )
        data = resp.json()
        if data.get("res"):
            orgs = [
                {"id": o["SLID"], "name": o.get("SLMC", o.get("SLID", ""))}
                for o in data["list_result"]
            ]
            return {"orgs": orgs}
        return {"orgs": [], "error": data.get("msg", "获取组织列表失败")}
    except requests.RequestException as e:
        raise HTTPException(502, f"连接云阅卷平台失败: {e}")


@app.post("/api/captcha")
def get_captcha(session_id: str = Form(...)):
    """获取验证码图片 (base64) + OCR 自动识别结果"""
    http = _session(session_id)
    try:
        resp = http.get(
            f"{BASE}/image.jsp?rnd={int(time.time() * 1000)}", timeout=15
        )
        img_bytes = resp.content
        b64 = base64.b64encode(img_bytes).decode()

        ct = resp.headers.get("Content-Type", "image/png")
        if "jpeg" in ct or "jpg" in ct:
            prefix = "data:image/jpeg;base64,"
        elif "gif" in ct:
            prefix = "data:image/gif;base64,"
        else:
            prefix = "data:image/png;base64,"

        captcha_text = ""
        if HAS_OCR:
            try:
                result = _ocr.classification(img_bytes)
                if result and len(result) == 4 and result.isalnum():
                    captcha_text = result
            except Exception:
                pass

        return {
            "captcha_image": f"{prefix}{b64}",
            "captcha_text": captcha_text,
            "ocr_available": HAS_OCR,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"获取验证码失败: {e}")


@app.post("/api/login")
def login(
    session_id: str = Form(...),
    org_id: str = Form(...),
    username: str = Form(...),
    password: str = Form(...),
    captcha: str = Form(...),
    request: Request = None,
):
    """学生登录 + SSO 跳转到 CloudAnalysis (含频率限制)"""
    _check_rate_limit(request, username)

    http = _session(session_id)

    try:
        resp = http.post(
            f"{BASE}/xslogin.do",
            data={
                "slid": org_id,
                "ksid": username,
                "ksmm": password,
                "xs_yzm": captcha,
                "dlfs": "1",
            },
            timeout=20,
        )
    except requests.RequestException as e:
        raise HTTPException(502, f"登录请求失败: {e}")

    body = resp.text

    if re.search(r"验证码错误|验证码不正确|验证码已过期", body):
        raise HTTPException(400, "验证码错误，请重新获取")
    if re.search(r"密码错误|密码不正确", body):
        raise HTTPException(400, "密码错误")
    if re.search(r"用户不存在|账号不存在|考生不存在|学籍号不存在", body):
        raise HTTPException(400, "学籍号不存在")

    yhzh, txmy, njdm = _parse_sso(body)

    sso_url = f"{BASE2}/sixslogin.do?yhzh={yhzh}&txmy={txmy}&njdm={njdm}"
    try:
        http.get(sso_url, timeout=15)
    except requests.RequestException as e:
        raise HTTPException(502, f"SSO 跳转失败: {e}")

    sessions[session_id]["logged_in"] = True
    sessions[session_id]["sso"] = {"yhzh": yhzh, "txmy": txmy, "njdm": njdm}

    return {"status": "ok", "message": "登录成功"}


@app.get("/api/exams")
def get_exams(session_id: str = Query(...)):
    """获取考试列表 (需已登录)"""
    http = _require_login(session_id)

    try:
        resp = http.post(
            f"{BASE2}/stunavi_getNavi.do",
            data={"ksid": "", "njdm": ""},
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": f"{BASE2}/web/stu/navi.jsp",
            },
            timeout=15,
        )
        data = resp.json()
    except requests.RequestException as e:
        raise HTTPException(502, f"获取考试列表失败: {e}")

    if not data.get("res"):
        raise HTTPException(400, data.get("msg", "获取考试列表失败"))

    stu = data.get("kshengjcxx", {})
    exams = data.get("lcksxx", [])

    exam_list = []
    for e in exams:
        exam_list.append(
            {
                "ksdm": e.get("KSDM", ""),
                "kldm": e.get("KLDM", ""),
                "name": e.get("KSMC", ""),
                "date": (e.get("KSSJ", "") or "")[:10],
                "class_rank": e.get("BJPM", ""),
                "grade_rank": e.get("JFPM", ""),
                "subjects": (e.get("BCKSKM", "") or "").replace("_", " "),
            }
        )

    exam_params = {
        "ksid": stu.get("KSID", ""),
        "bjdm": stu.get("BJDM", ""),
        "njdm": stu.get("NJDM", ""),
        "exams": exam_list,
    }
    sessions[session_id]["exam_params"] = exam_params

    return {
        "student": {
            "name": stu.get("XM", ""),
            "id": stu.get("KSID", ""),
            "grade": stu.get("NJMC", ""),
            "class": stu.get("BJMC", ""),
        },
        "school": data.get("zzmc", ""),
        "exam_count": len(exam_list),
        "exams": exam_list,
    }


@app.get("/api/scores/{exam_index}")
def get_scores(
    exam_index: int, session_id: str = Query(...),
):
    """获取单次考试的详细成绩 (需已登录)"""
    http = _require_login(session_id)
    params = sessions[session_id].get("exam_params")
    if not params:
        raise HTTPException(400, "请先获取考试列表")

    exams = params["exams"]
    if exam_index < 0 or exam_index >= len(exams):
        raise HTTPException(404, f"考试编号 {exam_index} 不存在")

    exam = exams[exam_index]
    try:
        resp = http.post(
            f"{BASE2}/stuckfx_getStuNavi.do",
            data={
                "ksdm": exam["ksdm"],
                "kldm": exam["kldm"],
                "ksid": params["ksid"],
                "bjdm": params["bjdm"],
                "njdm": params["njdm"],
                "kmdm": "",
            },
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": f"{BASE2}/web/stu/ckfx.jsp",
            },
            timeout=15,
        )
        data = resp.json()
    except requests.RequestException as e:
        raise HTTPException(502, f"获取成绩失败: {e}")

    _debug_dump("get_scores raw", data)

    if not data.get("res"):
        raise HTTPException(400, data.get("msg", "获取成绩失败"))

    bj = data.get("bjcjjizhi", {})
    cj = data.get("cjpmbrkm", {})

    subjects = []
    for km in data.get("gkksxx", []):
        subjects.append(
            {
                "name": km.get("KMMC", ""),
                "score": km.get("KSCJ", ""),
                "class_rank": km.get("BJPM", ""),
                "grade_rank": km.get("NJPM", ""),
                "class_avg": km.get("BJPJF", ""),
                "grade_avg": km.get("NJPJF", ""),
            }
        )

    strengths = cj.get("JDBRKMMC", "")
    weaknesses = cj.get("XDBRKMMC", "")

    changes = []
    for item in data.get("grgkpwlist", data.get("bckscjkmlist", [])):
        diff = item.get("CJL", 0)
        changes.append(
            {
                "subject": item.get("KMMC", ""),
                "diff": diff,
                "direction": "up" if diff > 0 else ("down" if diff < 0 else "flat"),
            }
        )

    classmates = data.get("bjstucjxx", [])

    return {
        "exam_name": exam["name"],
        "summary": {
            "total_score": cj.get("ZF", ""),
            "class_rank": cj.get("BJPM", ""),
            "grade_rank": cj.get("JFPM", ""),
            "total_students": bj.get("ZRS", ""),
            "class_max": bj.get("ZGF", ""),
            "class_avg": bj.get("PJF", ""),
            "class_min": bj.get("ZDF", ""),
        },
        "subjects": subjects,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "changes": changes,
        "classmates": [
            {"name": s.get("XM", ""), "total": s.get("ZF", "")}
            for s in sorted(
                classmates, key=lambda x: x.get("ZF", 0) or 0, reverse=True
            )[:10]
        ],
    }


@app.get("/api/scores/all")
def get_all_scores(session_id: str = Query(...)):
    """批量获取所有考试的详细成绩 (需已登录)"""
    http = _require_login(session_id)
    params = sessions[session_id].get("exam_params")
    if not params:
        raise HTTPException(400, "请先获取考试列表")

    exams = params["exams"]
    results = []
    for idx, exam in enumerate(exams):
        try:
            resp = http.post(
                f"{BASE2}/stuckfx_getStuNavi.do",
                data={
                    "ksdm": exam["ksdm"],
                    "kldm": exam["kldm"],
                    "ksid": params["ksid"],
                    "bjdm": params["bjdm"],
                    "njdm": params["njdm"],
                    "kmdm": "",
                },
                headers={
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": f"{BASE2}/web/stu/ckfx.jsp",
                },
                timeout=15,
            )
            data = resp.json()
        except requests.RequestException as e:
            logger.warning(f"获取考试 {exam['name']} 成绩失败: {e}")
            results.append(
                {
                    "exam_name": exam["name"],
                    "exam_date": exam.get("date", ""),
                    "error": str(e),
                }
            )
            continue

        if not data.get("res"):
            results.append(
                {
                    "exam_name": exam["name"],
                    "exam_date": exam.get("date", ""),
                    "error": data.get("msg", "获取成绩失败"),
                }
            )
            continue

        cj = data.get("cjpmbrkm", {})
        bj = data.get("bjcjjizhi", {})

        subjects = []
        for km in data.get("gkksxx", []):
            subjects.append(
                {
                    "name": km.get("KMMC", ""),
                    "score": km.get("KSCJ", ""),
                    "class_rank": km.get("BJPM", ""),
                    "grade_rank": km.get("NJPM", ""),
                    "class_avg": km.get("BJPJF", ""),
                    "grade_avg": km.get("NJPJF", ""),
                }
            )

        results.append(
            {
                "exam_name": exam["name"],
                "exam_date": exam.get("date", ""),
                "total_score": cj.get("ZF", ""),
                "class_rank": cj.get("BJPM", ""),
                "grade_rank": cj.get("JFPM", ""),
                "total_students": bj.get("ZRS", ""),
                "subjects": subjects,
            }
        )

    return {
        "student": {
            "name": params.get("student_name", ""),
        },
        "exams": results,
    }


@app.post("/api/telegram")
def send_telegram(
    session_id: str = Form(...),
    exam_index: int = Form(...),
    tg_token: str = Form(...),
    tg_chat_id: str = Form(...),
):
    """发送 Telegram 通知 (需已登录)"""
    http = _require_login(session_id)

    cfg = load_config()
    if not tg_token or "***" in tg_token:
        tg_token = cfg.get("tg_token", "")
    if not tg_chat_id or "***" in tg_chat_id:
        tg_chat_id = cfg.get("tg_chat_id", "")
    if not tg_token or not tg_chat_id:
        raise HTTPException(400, "Telegram Token 或 Chat ID 未配置")

    params = sessions[session_id].get("exam_params")
    if not params:
        raise HTTPException(400, "请先获取考试列表")

    exams = params["exams"]
    if exam_index < 0 or exam_index >= len(exams):
        raise HTTPException(404, "考试编号不存在")

    exam = exams[exam_index]

    try:
        resp = http.post(
            f"{BASE2}/stuckfx_getStuNavi.do",
            data={
                "ksdm": exam["ksdm"],
                "kldm": exam["kldm"],
                "ksid": params["ksid"],
                "bjdm": params["bjdm"],
                "njdm": params["njdm"],
                "kmdm": "",
            },
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Referer": f"{BASE2}/web/stu/ckfx.jsp",
            },
            timeout=15,
        )
        data = resp.json()
    except requests.RequestException as e:
        raise HTTPException(502, f"获取成绩失败: {e}")

    if not data.get("res"):
        raise HTTPException(400, "获取成绩失败")

    bj = data.get("bjcjjizhi", {})
    cj = data.get("cjpmbrkm", {})

    lines = []
    lines.append(f'<b>{exam["name"]}</b>')
    lines.append(
        f'总分: {cj.get("ZF","?")}  '
        f'班排: {cj.get("BJPM","?")}/{bj.get("ZRS","?")}  '
        f'级排: {cj.get("JFPM","?")}'
    )

    subs = []
    for km in data.get("gkksxx", []):
        subs.append(f'{km["KMMC"]}:{km["KSCJ"]}(B{km["BJPM"]}/G{km["NJPM"]})')
    lines.append(" | ".join(subs))

    jdb = cj.get("JDBRKMMC", "")
    xdb = cj.get("XDBRKMMC", "")
    if jdb:
        lines.append(f"优势: {jdb}")
    if xdb:
        lines.append(f"弱势: {xdb}")

    changes = []
    for item in data.get("grgkpwlist", data.get("bckscjkmlist", [])):
        diff = item.get("CJL", 0)
        sign = "+" if diff > 0 else ("-" if diff < 0 else "=")
        changes.append(f'{item["KMMC"]}{sign}{abs(diff)*100:.0f}%')
    if changes:
        lines.append("变化: " + " ".join(changes))

    text = "\n".join(lines)

    try:
        tg_resp = requests.post(
            f"https://api.telegram.org/bot{tg_token}/sendMessage",
            json={"chat_id": tg_chat_id, "text": text, "parse_mode": "HTML"},
            timeout=15,
        )
        result = tg_resp.json()
        if result.get("ok"):
            return {"status": "ok", "message": "Telegram 通知发送成功"}
        else:
            raise HTTPException(
                400, f'发送失败: {result.get("description", "未知错误")}'
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Telegram API 调用失败: {e}")


@app.post("/api/telegram/send")
def send_telegram_cached(
    text: str = Form(...),
    tg_token: str = Form(""),
    tg_chat_id: str = Form(""),
    _admin: None = Depends(_require_admin),
):
    """发送自定义文本到 Telegram (需管理认证，含内容过滤)"""
    cfg = load_config()
    if not tg_token or "***" in tg_token:
        tg_token = cfg.get("tg_token", "")
    if not tg_chat_id or "***" in tg_chat_id:
        tg_chat_id = cfg.get("tg_chat_id", "")
    if not tg_token or not tg_chat_id:
        raise HTTPException(400, "Telegram Token 或 Chat ID 未配置")

    # 内容安全过滤
    sanitized = _sanitize_telegram_html(text)
    if sanitized != text:
        logger.warning("Telegram 消息内容已被过滤")

    try:
        tg_resp = requests.post(
            f"https://api.telegram.org/bot{tg_token}/sendMessage",
            json={
                "chat_id": tg_chat_id,
                "text": sanitized,
                "parse_mode": "HTML",
            },
            timeout=15,
        )
        result = tg_resp.json()
        if result.get("ok"):
            return {"status": "ok", "message": "发送成功"}
        raise HTTPException(
            400, f'发送失败: {result.get("description", "未知错误")}'
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Telegram API 调用失败: {e}")


# ═══════════════════════════════════════════════════════
#  Config API (需管理认证)
# ═══════════════════════════════════════════════════════


@app.post("/api/config")
def save_config_api(
    org_id: str = Form(""),
    username: str = Form(""),
    password: str = Form(""),
    tg_token: str = Form(""),
    tg_chat_id: str = Form(""),
    monitor_enabled: bool = Form(False),
    monitor_interval: int = Form(3600),
    last_scores: str = Form(""),
    _admin: None = Depends(_require_admin),
):
    """保存配置 (需管理认证)"""
    cfg = load_config()
    if org_id:
        cfg["org_id"] = org_id
    if username:
        cfg["username"] = username
    if password and "***" not in password:
        cfg["password"] = password
    if tg_token and "***" not in tg_token:
        cfg["tg_token"] = tg_token
    cfg["tg_chat_id"] = tg_chat_id
    cfg["monitor_enabled"] = monitor_enabled
    if monitor_interval >= 600:
        cfg["monitor_interval"] = monitor_interval
    if last_scores:
        try:
            cfg["last_scores"] = json.loads(last_scores)
        except json.JSONDecodeError:
            pass
    save_config(cfg)
    logger.info("配置已更新")
    return {"status": "ok"}


@app.post("/api/config/scores")
def save_scores_cache(
    last_scores: str = Form(...),
    _admin: None = Depends(_require_admin),
):
    """仅更新 last_scores 缓存 (需管理认证)"""
    cfg = load_config()
    try:
        cfg["last_scores"] = json.loads(last_scores)
    except json.JSONDecodeError:
        raise HTTPException(400, "last_scores JSON 解析失败")
    save_config(cfg)
    return {"status": "ok"}


@app.get("/api/config")
def get_config():
    """读取配置 (敏感字段已脱敏)"""
    cfg = load_config()
    masked = dict(cfg)
    # 完全隐藏密码 (">>>" 用于前端识别脱敏值)
    masked["password"] = "***"
    # Token 仅显示最后 4 位用于识别
    t = masked.get("tg_token", "")
    if t:
        masked["tg_token"] = "***" + t[-4:]
    # 不暴露 api_key
    masked.pop("api_key", None)
    return masked


# ═══════════════════════════════════════════════════════
#  Monitor API (需管理认证)
# ═══════════════════════════════════════════════════════


@app.get("/api/monitor/status")
def monitor_status():
    """获取监测状态"""
    global _monitor_thread
    cfg = load_config()
    running = bool(get_monitor())
    interval = cfg.get("monitor_interval", 3600)
    last_check = cfg.get("last_check", "")
    next_check = ""
    if running and last_check:
        try:
            lc = datetime.fromisoformat(last_check)
            next_check = (lc + timedelta(seconds=interval)).isoformat()
        except Exception:
            pass
    return {
        "running": running,
        "monitor_enabled": cfg.get("monitor_enabled", False),
        "monitor_interval": interval,
        "last_check": last_check,
        "next_check": next_check,
        "last_hash": cfg.get("last_hash", "")[:8],
        "last_error": cfg.get("last_error", ""),
        "consecutive_failures": cfg.get("consecutive_failures", 0),
        "has_scores": cfg.get("last_scores") is not None,
        "last_scores": cfg.get("last_scores"),
    }


@app.post("/api/monitor/start")
def monitor_start(_admin: None = Depends(_require_admin)):
    """启动监测 (需管理认证)"""
    global _monitor_thread
    cfg = load_config()
    if (
        not cfg.get("org_id")
        or not cfg.get("username")
        or not cfg.get("password")
    ):
        raise HTTPException(
            400, "请先保存登录凭据 (org_id/username/password)"
        )
    if not HAS_OCR:
        raise HTTPException(400, "ddddocr 未安装，无法自动识别验证码")

    if get_monitor():
        return {"status": "ok", "message": "监测已在运行中"}

    cfg["monitor_enabled"] = True
    cfg["consecutive_failures"] = 0
    save_config(cfg)

    _monitor_thread = MonitorThread()
    _monitor_thread.start()
    logger.info("监测线程已启动")
    return {"status": "ok", "message": "监测已启动"}


@app.post("/api/monitor/stop")
def monitor_stop(_admin: None = Depends(_require_admin)):
    """停止监测 (需管理认证)"""
    global _monitor_thread
    cfg = load_config()
    cfg["monitor_enabled"] = False
    save_config(cfg)

    t = _monitor_thread
    if t:
        t.stop()
        _monitor_thread = None
    return {"status": "ok", "message": "监测已停止"}


@app.post("/api/monitor/check")
def monitor_check_now(_admin: None = Depends(_require_admin)):
    """立即执行一次检查 (需管理认证)"""
    cfg = load_config()
    if (
        not cfg.get("org_id")
        or not cfg.get("username")
        or not cfg.get("password")
    ):
        raise HTTPException(400, "请先保存登录凭据")
    if not HAS_OCR:
        raise HTTPException(400, "ddddocr 未安装，无法自动识别验证码")

    mt = MonitorThread()
    try:
        mt._do_check(cfg)
        cfg["consecutive_failures"] = 0
        cfg["last_error"] = ""
        save_config(cfg)
        return {
            "status": "ok",
            "message": "检查完成",
            "changed": cfg.get("last_hash") != cfg.get("_prev_hash", ""),
        }
    except Exception as e:
        cfg["last_error"] = str(e)
        cfg["consecutive_failures"] = cfg.get("consecutive_failures", 0) + 1
        save_config(cfg)
        raise HTTPException(500, str(e))


# ═══════════════════════════════════════════════════════
#  Bing Daily Image API (公开)
# ═══════════════════════════════════════════════════════

BING_API = "https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1"
BING_BASE = "https://cn.bing.com"


@app.get("/api/bing/daily")
def bing_daily():
    """获取 Bing 每日一图"""
    try:
        resp = requests.get(BING_API, timeout=10)
        data = resp.json()
        img = data["images"][0] if data.get("images") else None
        if not img:
            raise HTTPException(502, "Bing API 返回数据为空")
        return {
            "title": img.get("title", ""),
            "copyright": img.get("copyright", ""),
            "copyright_link": img.get("copyrightlink", ""),
            "date": img.get("enddate", ""),
            "image_url": f"{BING_BASE}{img['url']}",
            "wallpaper_url": f"{BING_BASE}{img['url']}",
            "base_url": f"{BING_BASE}{img.get('urlbase', '')}",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"获取 Bing 每日一图失败: {e}")


@app.get("/bing")
def bing_markdown_page():
    """Bing 每日一图 — Markdown 格式输出页面"""
    try:
        resp = requests.get(BING_API, timeout=10)
        data = resp.json()
        img = data["images"][0] if data.get("images") else None
        if not img:
            return HTMLResponse("<h1>Bing API 返回数据为空</h1>", status_code=502)

        image_url = f"{BING_BASE}{img['url']}"
        title = img.get("title", "Bing 每日一图")
        copyright_text = img.get("copyright", "")
        copyright_link = img.get("copyrightlink", "")
        end_date = img.get("enddate", "")

        date_str = (
            f"{end_date[:4]}-{end_date[4:6]}-{end_date[6:8]}"
            if len(end_date) >= 8
            else end_date
        )

        html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bing 每日一图</title>
<style>
  :root {{
    --bg: #1a1a2e;
    --card: #16213e;
    --text: #e0e0e0;
    --muted: #8892b0;
    --accent: #64ffda;
    --border: rgba(255,255,255,0.08);
  }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    background: var(--bg);
    color: var(--text);
    font-family: "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif;
    display: flex; justify-content: center; align-items: center;
    min-height: 100vh; padding: 20px;
  }}
  .container {{
    max-width: 800px; width: 100%;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 20px; overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,0.4);
  }}
  .img-wrap {{
    position: relative; width: 100%;
    background: #000;
  }}
  .img-wrap img {{
    width: 100%; display: block;
    border-bottom: 1px solid var(--border);
  }}
  .img-wrap .date-tag {{
    position: absolute; top: 16px; right: 16px;
    background: rgba(0,0,0,0.55); backdrop-filter: blur(8px);
    color: #fff; padding: 4px 14px; border-radius: 20px;
    font-size: 13px; border: 1px solid rgba(255,255,255,0.15);
  }}
  .content {{ padding: 28px 32px; }}
  .content h1 {{
    font-size: 22px; font-weight: 700; color: #ccd6f6;
    margin-bottom: 8px; line-height: 1.4;
  }}
  .content .copyright {{
    font-size: 14px; color: var(--muted); margin-bottom: 20px;
    line-height: 1.6;
  }}
  .content .copyright a {{
    color: var(--accent); text-decoration: none;
  }}
  .content .copyright a:hover {{ text-decoration: underline; }}
  .meta {{
    display: flex; flex-wrap: wrap; gap: 12px;
  }}
  .meta a, .meta button {{
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 20px; border-radius: 10px;
    font-size: 14px; font-weight: 600; text-decoration: none;
    transition: all 0.25s; cursor: pointer;
    border: 1px solid var(--border);
  }}
  .btn-dl {{
    background: rgba(100,255,218,0.1); color: var(--accent);
    border-color: rgba(100,255,218,0.25);
  }}
  .btn-dl:hover {{ background: rgba(100,255,218,0.18); }}
  .btn-copy {{
    background: rgba(255,255,255,0.05); color: #ccd6f6;
  }}
  .btn-copy:hover {{ background: rgba(255,255,255,0.1); }}
  .btn-back {{
    background: rgba(255,255,255,0.05); color: var(--muted);
  }}
  .btn-back:hover {{ background: rgba(255,255,255,0.1); }}
  .toast {{
    position: fixed; top: 24px; left: 50%; transform: translateX(-50%);
    background: var(--accent); color: #1a1a2e;
    padding: 10px 24px; border-radius: 12px; font-size: 14px; font-weight: 600;
    opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 100;
  }}
  .toast.show {{ opacity: 1; }}
</style>
</head>
<body>
<div class="toast" id="toast">已复制到剪贴板</div>
<div class="container">
  <div class="img-wrap">
    <img src="{image_url}" alt="{title}">
    <span class="date-tag">{date_str}</span>
  </div>
  <div class="content">
    <h1>{title}</h1>
    <p class="copyright">
      {'<a href="' + copyright_link + '" target="_blank" rel="noopener">' + copyright_text + '</a>' if copyright_link else copyright_text}
    </p>
    <div class="meta">
      <a class="btn-dl" href="{image_url}" download target="_blank" rel="noopener">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        下载原图
      </a>
      <button class="btn-copy" onclick="copyMd()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        复制 Markdown
      </button>
      <a class="btn-back" href="./">返回首页</a>
    </div>
  </div>
</div>
<script>
  function copyMd() {{
    const md = `# {title}\\n\\n> {copyright_text}\\n\\n![{title}]({image_url})\\n\\n📅 {date_str} | [查看原图]({image_url})`;
    navigator.clipboard.writeText(md).then(() => {{
      const t = document.getElementById('toast');
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2000);
    }});
  }}
</script>
</body>
</html>"""
        return HTMLResponse(html)
    except Exception as e:
        return HTMLResponse(f"<h1>获取失败</h1><p>{e}</p>", status_code=502)


# ═══════════════════════════════════════════════════════
#  Debug: raw score response inspector (需已登录)
# ═══════════════════════════════════════════════════════


@app.get("/api/debug/raw-score/{exam_index}")
def debug_raw_score(
    exam_index: int, session_id: str = Query(...),
):
    """Return raw stuckfx_getStuNavi.do response for debugging (需已登录)."""
    http = _require_login(session_id)
    params = sessions[session_id].get("exam_params")
    if not params:
        raise HTTPException(400, "请先获取考试列表")
    exams = params["exams"]
    if exam_index < 0 or exam_index >= len(exams):
        raise HTTPException(404, "考试编号不存在")
    exam = exams[exam_index]
    resp = http.post(
        f"{BASE2}/stuckfx_getStuNavi.do",
        data={
            "ksdm": exam["ksdm"],
            "kldm": exam["kldm"],
            "ksid": params["ksid"],
            "bjdm": params["bjdm"],
            "njdm": params["njdm"],
            "kmdm": "",
        },
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": f"{BASE2}/web/stu/ckfx.jsp",
        },
        timeout=15,
    )
    return JSONResponse(resp.json())


# ═══════════════════════════════════════════════════════
#  Static files & Frontend
# ═══════════════════════════════════════════════════════

STATIC = Path(__file__).parent / "static"
STATIC.mkdir(exist_ok=True)


@app.get("/")
def index():
    """Serve the frontend SPA and set admin auth cookie"""
    index_file = STATIC / "index.html"
    if index_file.exists():
        response = FileResponse(index_file)
    else:
        response = HTMLResponse(
            "<h1>Frontend not found. Create static/index.html</h1>"
        )
    # 设置管理认证 Cookie (非 HttpOnly，前端无需读取)
    response.set_cookie(
        key="admin_token",
        value=get_api_key(),
        path="/",
        samesite="lax",
        secure=False,
        httponly=True,
    )
    return response


# Mount static files after defining / so it doesn't shadow it
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")

# ── Run ──────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    # 启动时自动恢复监测
    cfg = load_config()
    if cfg.get("monitor_enabled") and HAS_OCR:
        if cfg.get("org_id") and cfg.get("username") and cfg.get("password"):
            logger.info("检测到监测已启用，自动恢复...")
            _monitor_thread = MonitorThread()
            _monitor_thread.start()

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
