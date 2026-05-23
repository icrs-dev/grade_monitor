#!/bin/bash
#
# 云阅卷平台 (CloudMarking → CloudAnalysis) - 学生自动登录并查看成绩脚本
# 支持 Telegram Bot 通知
#
# 网站: http://sxoma.com:8088/CloudMarking/
# 分析平台: http://sxoma.com:8088/CloudAnalysis/
#
# 用法:
#   ./student_login.sh -o <组织代码> -u <学籍号> -p <密码>
#   ./student_login.sh -o 1003 -u 20280349 -p 20281710 -c <验证码>
#   ./student_login.sh -o 1003 -u 20280349 -p 20281710 -c <验证码> -t <bot_token> -d <chat_id>
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/telegram.conf"
TMPDIR="${SCRIPT_DIR}/.tmp"
mkdir -p "$TMPDIR"

COOKIE_JAR="${TMPDIR}/cookies.txt"
CAPTCHA_IMG="${TMPDIR}/captcha.png"
TMP="${TMPDIR}/response.html"
DATA_DIR="${TMPDIR}/data"
mkdir -p "$DATA_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
BASE="http://sxoma.com:8088/CloudMarking"
BASE2="http://sxoma.com:8088/CloudAnalysis"

# ============================================================
# 参数解析
# ============================================================
ORG=""; USER=""; PASS=""; CAPTCHA=""
TG_TOKEN=""; TG_CHAT_ID=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -o|--org)       ORG="$2"; shift 2 ;;
        -u|--user)      USER="$2"; shift 2 ;;
        -p|--pass)      PASS="$2"; shift 2 ;;
        -c|--captcha)   CAPTCHA="$2"; shift 2 ;;
        -t|--tg-token)  TG_TOKEN="$2"; shift 2 ;;
        -d|--tg-chat)   TG_CHAT_ID="$2"; shift 2 ;;
        -h|--help)
            echo "用法: $0 [选项]"
            echo ""
            echo "登录选项:"
            echo "  -o, --org       组织代码 (SLID)"
            echo "  -u, --user      学籍号 (考生号)"
            echo "  -p, --pass      密码"
            echo "  -c, --captcha   验证码 (4位)"
            echo ""
            echo "Telegram 通知选项:"
            echo "  -t, --tg-token  Telegram Bot Token"
            echo "  -d, --tg-chat   Telegram Chat ID"
            echo "  (未指定则读取 telegram.conf, 没有则跳过通知)"
            echo ""
            echo "可用组织代码:"
            echo "  1001 - 八十九中教育集团（旧）"
            echo "  1003 - 西安市第八十九中学"
            echo "  1004 - 西安市汇知中学"
            echo "  1005 - 分校东(38)"
            echo "  1006 - 分校西(大明宫)"
            echo "  9999 - 西工大附中"
            echo ""
            echo "Telegram 配置:"
            echo "  在脚本同目录创建 telegram.conf:"
            echo "    TG_TOKEN=your_bot_token"
            echo "    TG_CHAT_ID=your_chat_id"
            exit 0
            ;;
        *) echo -e "${RED}未知参数: $1${NC}"; exit 1 ;;
    esac
done

# ============================================================
# Telegram 配置加载
# ============================================================
if [[ -z "$TG_TOKEN" || -z "$TG_CHAT_ID" ]]; then
    if [[ -f "$CONFIG_FILE" ]]; then
        source "$CONFIG_FILE" 2>/dev/null || . "$CONFIG_FILE" 2>/dev/null
        TG_TOKEN="${TG_TOKEN:-}"
        TG_CHAT_ID="${TG_CHAT_ID:-}"
    fi
fi

TG_ENABLED=false
if [[ -n "$TG_TOKEN" && -n "$TG_CHAT_ID" ]]; then
    TG_ENABLED=true
fi

# ============================================================
# Telegram 发送函数
# ============================================================
tg_send() {
    if [[ "$TG_ENABLED" != "true" ]]; then
        return 0
    fi
    local text="$1"
    curl -s -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
        -H "Content-Type: application/json" \
        -d "$(python -c "
import json, sys
msg = {'chat_id': '$TG_CHAT_ID', 'text': sys.argv[1], 'parse_mode': 'HTML'}
print(json.dumps(msg, ensure_ascii=False))
" "$text" 2>/dev/null)" \
        > /dev/null 2>&1 || true
}

# ============================================================
# 辅助函数
# ============================================================
header() { echo -e "\n${CYAN}============================================${NC}"; echo -e "${CYAN}  $*${NC}"; echo -e "${CYAN}============================================${NC}"; }

# ============================================================
# Step 1: 首页获取 Cookie
# ============================================================
header "Step 1: 连接 CloudMarking 首页"

curl -s -c "$COOKIE_JAR" -H "User-Agent: $UA" "$BASE/" > /dev/null
grep -q . "$COOKIE_JAR" 2>/dev/null || { echo -e "${RED}连接失败!${NC}"; exit 1; }
echo -e "${GREEN}会话已建立${NC}"

# ============================================================
# Step 2: 获取组织列表 (如未指定)
# ============================================================
if [[ -z "$ORG" ]]; then
    header "Step 2: 获取组织列表"
    ORG_JSON=$(curl -s -b "$COOKIE_JAR" \
        -H "User-Agent: $UA" \
        -H "X-Requested-With: XMLHttpRequest" \
        "$BASE/system_xsloginsllist.do")

    echo "$ORG_JSON" | python -c "
import sys,json
d=json.load(sys.stdin)
if d.get('res'):
 for i in d['list_result']:
  print(f'  [{i[\"SLID\"]}] {i.get(\"SLMC\",\"\")}')
" 2>/dev/null || echo "$ORG_JSON"
    echo ""
    read -r -p "$(echo -e "${GREEN}组织代码: ${NC}")" ORG
fi

# ============================================================
# Step 3: 输入学籍号和密码
# ============================================================
[[ -z "$USER" ]] && read -r -p "$(echo -e "${GREEN}学籍号: ${NC}")" USER
[[ -z "$PASS" ]] && read -r -s -p "$(echo -e "${GREEN}密码: ${NC}")" PASS && echo ""

if [[ -z "$ORG" || -z "$USER" || -z "$PASS" ]]; then
    echo -e "${RED}组织代码、学籍号、密码缺一不可!${NC}"
    exit 1
fi

# ============================================================
# Step 4: 获取验证码 (ddddocr OCR 自动识别)
# ============================================================
CAPTCHA_AUTO=false

if [[ -z "$CAPTCHA" ]]; then
    header "Step 3: 获取验证码"

    curl -s -b "$COOKIE_JAR" \
        -H "User-Agent: $UA" \
        "$BASE/image.jsp?rnd=$(date +%s%N)" -o "$CAPTCHA_IMG"

    echo -e "${YELLOW}验证码图片已下载${NC}"

    # ============================================================
    # 尝试 ddddocr OCR 自动识别
    # ============================================================
    OCR_RESULT=$(python -c "
import sys
with open(sys.argv[1], 'rb') as f:
    img_bytes = f.read()
try:
    import ddddocr
    ocr = ddddocr.DdddOcr(show_ad=False)
    result = ocr.classification(img_bytes)
    if result and len(result) == 4 and result.isalnum():
        print(result)
    else:
        print('')
except ImportError:
    print('__IMPORT_ERROR__')
except Exception as e:
    print('')
" "$CAPTCHA_IMG" 2>&1)

    if [[ "$OCR_RESULT" == "__IMPORT_ERROR__" ]]; then
        echo -e "${YELLOW}  ddddocr 未安装, 正在自动安装...${NC}"
        python -m pip install ddddocr -q 2>&1 | tail -1

        OCR_RESULT=$(python -c "
import sys
with open(sys.argv[1], 'rb') as f:
    img_bytes = f.read()
import ddddocr
ocr = ddddocr.DdddOcr(show_ad=False)
result = ocr.classification(img_bytes)
print(result if (result and len(result)==4 and result.isalnum()) else '')
" "$CAPTCHA_IMG" 2>&1)
    fi

    if [[ -n "$OCR_RESULT" && ${#OCR_RESULT} -eq 4 ]]; then
        CAPTCHA="$OCR_RESULT"
        CAPTCHA_AUTO=true
        echo -e "${GREEN}  OCR 自动识别成功: ${BOLD}${CAPTCHA}${NC}"

        # 快速确认：显示图片供人工核验
        (explorer "$(cygpath -w "$CAPTCHA_IMG" 2>/dev/null || echo "$CAPTCHA_IMG")" 2>/dev/null || xdg-open "$CAPTCHA_IMG" 2>/dev/null || open "$CAPTCHA_IMG" 2>/dev/null) &
        read -r -t 5 -p "$(echo -e "${YELLOW}  验证码: [${CAPTCHA}] 回车确认 / 输入覆盖 (5秒超时自动确认): ${NC}")" USER_INPUT || true
        echo ""
        if [[ -n "$USER_INPUT" ]]; then
            CAPTCHA="$USER_INPUT"
            CAPTCHA_AUTO=false
        fi
    else
        # OCR 失败, 手动输入
        echo -e "${YELLOW}  OCR 识别失败, 请手动输入${NC}"
        (explorer "$(cygpath -w "$CAPTCHA_IMG" 2>/dev/null || echo "$CAPTCHA_IMG")" 2>/dev/null || xdg-open "$CAPTCHA_IMG" 2>/dev/null || open "$CAPTCHA_IMG" 2>/dev/null) &
        echo -e "${YELLOW}  验证码图片: ${CAPTCHA_IMG}${NC}"
        read -r -p "$(echo -e "${GREEN}  验证码 (4位): ${NC}")" CAPTCHA
    fi
fi

[[ -z "$CAPTCHA" || ${#CAPTCHA} -ne 4 ]] && { echo -e "${RED}验证码必须为4位!${NC}"; exit 1; }

# ============================================================
# Step 5: 学生登录 CloudMarking
# ============================================================
header "Step 4: 学生登录 CloudMarking"
echo -e "  组织: ${ORG}  学籍号: ${USER}  验证码: ${CAPTCHA}"

curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -H "User-Agent: $UA" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "slid=${ORG}" \
    --data-urlencode "ksid=${USER}" \
    --data-urlencode "ksmm=${PASS}" \
    --data-urlencode "xs_yzm=${CAPTCHA}" \
    --data-urlencode "dlfs=1" \
    "$BASE/xslogin.do" -o "$TMP"

BODY=$(cat "$TMP")

# 检测登录失败
if echo "$BODY" | grep -qiE "验证码错误|验证码不正确|验证码已过期"; then
    MSG="登录失败: 验证码错误!"
    echo -e "${RED}${MSG}${NC}"
    tg_send "CloudMarking ${MSG}"
    exit 1
elif echo "$BODY" | grep -qiE "密码错误|密码不正确"; then
    MSG="登录失败: 密码错误!"
    echo -e "${RED}${MSG}${NC}"
    tg_send "CloudMarking ${MSG}"
    exit 1
elif echo "$BODY" | grep -qiE "用户不存在|账号不存在|考生不存在|学籍号不存在"; then
    MSG="登录失败: 学籍号不存在!"
    echo -e "${RED}${MSG}${NC}"
    tg_send "CloudMarking ${MSG}"
    exit 1
fi

# 提取 SSO 跳转参数 (用 python 替代 grep -P 提高兼容性)
YHZH=$(python -c "import re,sys;m=re.search(r'var yhzh = \"([^\"]+)\"',sys.stdin.read());print(m.group(1) if m else '')" <<< "$BODY")
TXMY=$(python -c "import re,sys;m=re.search(r'var txmy = \"([^\"]+)\"',sys.stdin.read());print(m.group(1) if m else '')" <<< "$BODY")
NJDM=$(python -c "import re,sys;m=re.search(r'var njdm = \"([^\"]+)\"',sys.stdin.read());print(m.group(1) if m else '')" <<< "$BODY")

if [[ -z "$YHZH" || -z "$TXMY" || -z "$NJDM" ]]; then
    echo -e "${RED}登录响应异常, 未找到SSO参数!${NC}"
    echo "$BODY" | head -c 500
    exit 1
fi

echo -e "${GREEN}登录成功! 获取到 SSO 令牌${NC}"

# ============================================================
# Step 6: SSO 跳转到 CloudAnalysis
# ============================================================
header "Step 5: SSO 跳转到 CloudAnalysis"

SSO_URL="${BASE2}/sixslogin.do?yhzh=${YHZH}&txmy=${TXMY}&njdm=${NJDM}"
curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -H "User-Agent: $UA" -L "$SSO_URL" -o "$TMP"

echo -e "${GREEN}已进入 CloudAnalysis 平台${NC}"
echo "$COOKIE_JAR" > "$DATA_DIR/cookie_path"

# ============================================================
# Step 7: 获取考试列表
# ============================================================
header "Step 6: 获取考试列表"

EXAM_JSON=$(curl -s -b "$COOKIE_JAR" \
    -H "User-Agent: $UA" \
    -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" \
    -H "X-Requested-With: XMLHttpRequest" \
    -H "Referer: ${BASE2}/web/stu/navi.jsp" \
    --data-urlencode "ksid=" \
    --data-urlencode "njdm=" \
    "${BASE2}/stunavi_getNavi.do")

echo "$EXAM_JSON" > "$DATA_DIR/exam_list.json"

python << PYEOF
import json

with open('$DATA_DIR/exam_list.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

if not data.get('res'):
    print('获取考试列表失败:', data.get('msg', ''))
    exit(1)

stu = data['kshengjcxx']
print(f'  姓名:   {stu["XM"]}')
print(f'  学籍号: {stu["KSID"]}')
print(f'  学校:   {data.get("zzmc","")}')
print(f'  年级:   {stu["NJMC"]}  班级: {stu["BJMC"]}班')
print()

exams = data.get('lcksxx', [])
if not exams:
    print('  暂无考试记录')
    exit(0)

print(f'  共 {len(exams)} 次考试:')
print()
for i, e in enumerate(exams):
    print(f'  [{i+1}] {e["KSMC"]}')
    print(f'      日期: {e["KSSJ"][:10]}  班级排名: {e["BJPM"]}  年级排名: {e["JFPM"]}')
    print(f'      科目: {e["BCKSKM"].replace("_"," ").replace(",",", ")}')
    print()

with open('$DATA_DIR/exam_params.json', 'w', encoding='utf-8') as f:
    json.dump({
        'ksid': stu['KSID'],
        'bjdm': stu['BJDM'],
        'njdm': stu['NJDM'],
        'exams': [{'ksdm': e['KSDM'], 'kldm': e['KLDM'], 'name': e['KSMC']} for e in exams]
    }, f, ensure_ascii=False)
PYEOF

[[ $? -ne 0 ]] && { echo -e "${RED}解析失败${NC}"; exit 1; }

# ============================================================
# Step 8: 查看详细成绩
# ============================================================
EXAM_COUNT=$(python -c "import json; d=json.load(open('$DATA_DIR/exam_params.json')); print(len(d['exams']))")

if [[ "$EXAM_COUNT" -gt 1 ]]; then
    echo ""
    echo -e "${YELLOW}输入考试编号查看详细成绩 (1-${EXAM_COUNT}), 输入 0 查看全部, 直接回车查看最新:${NC}"
    read -r CHOICE
    [[ -z "$CHOICE" ]] && CHOICE=1
else
    CHOICE=1
fi

fetch_score() {
    local KSDM=$1 KLDM=$2
    curl -s -b "$COOKIE_JAR" \
        -H "User-Agent: $UA" \
        -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" \
        -H "X-Requested-With: XMLHttpRequest" \
        -H "Referer: ${BASE2}/web/stu/ckfx.jsp" \
        --data-urlencode "ksdm=${KSDM}" \
        --data-urlencode "kldm=${KLDM}" \
        --data-urlencode "ksid=$(python -c "import json;print(json.load(open('$DATA_DIR/exam_params.json'))['ksid'])")" \
        --data-urlencode "bjdm=$(python -c "import json;print(json.load(open('$DATA_DIR/exam_params.json'))['bjdm'])")" \
        --data-urlencode "njdm=$(python -c "import json;print(json.load(open('$DATA_DIR/exam_params.json'))['njdm'])")" \
        --data-urlencode "kmdm=" \
        "${BASE2}/stuckfx_getStuNavi.do"
}

# ============================================================
# 成绩展示 + Telegram 通知 (统一 Python 处理)
# ============================================================

if [[ "$CHOICE" == "0" ]]; then
    # 获取全部考试成绩
    python -c "
import json
with open('$DATA_DIR/exam_params.json', 'r') as f:
    params = json.load(f)
for i in range(len(params['exams'])):
    print(i)
" > "$DATA_DIR/indices.txt"

    while IFS= read -r idx; do
        python -c "
import json
with open('$DATA_DIR/exam_params.json','r') as f:
    p = json.load(f)
e = p['exams'][$idx]
print(f'{e[\"ksdm\"]}|{e[\"kldm\"]}|{e[\"name\"]}')
" > "$DATA_DIR/current.txt"
        IFS='|' read -r KSDM KLDM NAME < "$DATA_DIR/current.txt"
        fetch_score "$KSDM" "$KLDM" > "$DATA_DIR/score_$idx.json"
    done < "$DATA_DIR/indices.txt"

    # 显示 + 生成 Telegram 消息
    python << PYEOF
import json, os

data_dir = '$DATA_DIR'
with open(f'{data_dir}/exam_params.json', 'r') as f:
    params = json.load(f)

tg_lines = []
all_output = []

for idx, exam in enumerate(params['exams']):
    sf = f'{data_dir}/score_{idx}.json'
    if not os.path.exists(sf):
        continue
    with open(sf, 'r', encoding='utf-8') as f:
        d = json.load(f)
    if not d.get('res'):
        continue

    bj = d.get('bjcjjizhi', {})
    cj = d.get('cjpmbrkm', {})

    out = []
    out.append(f'============================================')
    out.append(f'  {exam["name"]}')
    out.append(f'============================================')
    out.append(f'  总分: {cj.get("ZF","?")}  班排: {cj.get("BJPM","?")}/{bj.get("ZRS","?")}  级排: {cj.get("JFPM","?")}')
    out.append(f'  班最高: {bj.get("ZGF","?")}  班平均: {bj.get("PJF","?")}  班最低: {bj.get("ZDF","?")}')
    out.append('')
    out.append(f'  {"科目":<6} {"分数":<6} {"班排":<6} {"级排":<8} {"班均分":<8} {"级均分":<8}')
    out.append(f'  {"-"*58}')
    for km in d.get('gkksxx', []):
        out.append(f'  {km["KMMC"]:<6} {km["KSCJ"]:<6} {km["BJPM"]:<6} {km["NJPM"]:<8} {km["BJPJF"]:<8} {km["NJPJF"]:<8}')
    out.append('')
    jdb = cj.get('JDBRKMMC','')
    xdb = cj.get('XDBRKMMC','')
    if jdb: out.append(f'  优势科目: {jdb}')
    if xdb: out.append(f'  弱势科目: {xdb}')
    for item in d.get('grgkpwlist', d.get('bckscjkmlist', [])):
        diff = item.get('CJL', 0)
        label = 'up' if diff > 0 else ('down' if diff < 0 else '-')
        out.append(f'  {item["KMMC"]}: {label} {diff:+.2%}')

    all_output.append('\n'.join(out))

    # Telegram message (compact)
    tg = []
    tg.append(f'<b>{exam["name"]}</b>')
    tg.append(f'总分: {cj.get("ZF","?")}  班排: {cj.get("BJPM","?")}/{bj.get("ZRS","?")}  级排: {cj.get("JFPM","?")}')
    subs = []
    for km in d.get('gkksxx', []):
        subs.append(f'{km["KMMC"]}:{km["KSCJ"]}(B{km["BJPM"]}/G{km["NJPM"]})')
    tg.append(' | '.join(subs))
    if jdb: tg.append(f'优势: {jdb}')
    if xdb: tg.append(f'弱势: {xdb}')
    changes = []
    for item in d.get('grgkpwlist', d.get('bckscjkmlist', [])):
        diff = item.get('CJL', 0)
        label = '+' if diff > 0 else ('-' if diff < 0 else '=')
        changes.append(f'{item["KMMC"]}{label}{abs(diff)*100:.0f}%')
    if changes:
        tg.append('变化: ' + ' '.join(changes))
    tg_lines.append('\n'.join(tg))

for out in all_output:
    print(out)
    print()

# 保存 Telegram 消息
with open(f'{data_dir}/tg_message.txt', 'w', encoding='utf-8') as f:
    f.write('\n\n'.join(tg_lines))
PYEOF

else
    python -c "
import json
with open('$DATA_DIR/exam_params.json','r') as f:
    p = json.load(f)
e = p['exams'][$((CHOICE - 1))]
print(f'{e[\"ksdm\"]}|{e[\"kldm\"]}|{e[\"name\"]}')
" > "$DATA_DIR/current.txt"
    IFS='|' read -r KSDM KLDM NAME < "$DATA_DIR/current.txt"

    fetch_score "$KSDM" "$KLDM" > "$DATA_DIR/score_0.json"

    python << PYEOF
import json

with open('$DATA_DIR/score_0.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

if not d.get('res'):
    print('获取成绩失败:', d.get('msg',''))
    exit()

bj = d.get('bjcjjizhi', {})
cj = d.get('cjpmbrkm', {})

print()
print(f'============================================')
print(f'  $NAME')
print(f'============================================')
print(f'  总分: {cj.get("ZF","?")}  班排: {cj.get("BJPM","?")}/{bj.get("ZRS","?")}  级排: {cj.get("JFPM","?")}')
print(f'  班最高: {bj.get("ZGF","?")}  班平均: {bj.get("PJF","?")}  班最低: {bj.get("ZDF","?")}')
print()
print(f'  {"科目":<6} {"分数":<6} {"班排":<6} {"级排":<8} {"班均分":<8} {"级均分":<8}')
print(f'  {"-"*58}')
for km in d.get('gkksxx', []):
    print(f'  {km["KMMC"]:<6} {km["KSCJ"]:<6} {km["BJPM"]:<6} {km["NJPM"]:<8} {km["BJPJF"]:<8} {km["NJPJF"]:<8}')
print()
jdb = cj.get('JDBRKMMC','')
xdb = cj.get('XDBRKMMC','')
if jdb: print(f'  优势科目: {jdb}')
if xdb: print(f'  弱势科目: {xdb}')
for item in d.get('grgkpwlist', d.get('bckscjkmlist', [])):
    diff = item.get('CJL', 0)
    label = 'up' if diff > 0 else ('down' if diff < 0 else '-')
    print(f'  {item["KMMC"]}: {label} {diff:+.2%}')

bx = d.get('bjstucjxx', [])
if bx:
    my_zf = cj.get('ZF', 0)
    sorted_bx = sorted(bx, key=lambda x: x.get('ZF', 0), reverse=True)
    print(f'\n  班级排名详情 (共{len(bx)}人):')
    print(f'  前5名: ', end='')
    for s in sorted_bx[:5]:
        print(f'{s["XM"]}({s["ZF"]}) ', end='')
    print()

# 生成 Telegram 消息
tg = []
tg.append(f'<b>$NAME</b>')
tg.append(f'总分: {cj.get("ZF","?")}  班排: {cj.get("BJPM","?")}/{bj.get("ZRS","?")}  级排: {cj.get("JFPM","?")}')
subs = []
for km in d.get('gkksxx', []):
    subs.append(f'{km["KMMC"]}:{km["KSCJ"]}(B{km["BJPM"]}/G{km["NJPM"]})')
tg.append(' | '.join(subs))
if jdb: tg.append(f'优势: {jdb}')
if xdb: tg.append(f'弱势: {xdb}')
changes = []
for item in d.get('grgkpwlist', d.get('bckscjkmlist', [])):
    diff = item.get('CJL', 0)
    label = '+' if diff > 0 else ('-' if diff < 0 else '=')
    changes.append(f'{item["KMMC"]}{label}{abs(diff)*100:.0f}%')
if changes:
    tg.append('变化: ' + ' '.join(changes))

with open('$DATA_DIR/tg_message.txt', 'w', encoding='utf-8') as f:
    f.write('\n\n'.join(tg))
PYEOF
fi

# ============================================================
# Step 9: 发送 Telegram 通知
# ============================================================
if [[ "$TG_ENABLED" == "true" ]] && [[ -f "$DATA_DIR/tg_message.txt" ]]; then
    header "Step 7: 发送 Telegram 通知"
    TG_TEXT=$(cat "$DATA_DIR/tg_message.txt")
    RESULT=$(curl -s -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
        -H "Content-Type: application/json" \
        -d "$(python -c "
import json, sys
with open('$DATA_DIR/tg_message.txt', 'r', encoding='utf-8') as f:
    text = f.read()
msg = {'chat_id': '$TG_CHAT_ID', 'text': text, 'parse_mode': 'HTML'}
print(json.dumps(msg, ensure_ascii=False))
")" 2>/dev/null)

    if echo "$RESULT" | python -c "import sys,json;d=json.load(sys.stdin);sys.exit(0 if d.get('ok') else 1)" 2>/dev/null; then
        echo -e "${GREEN}Telegram 通知发送成功!${NC}"
    else
        echo -e "${RED}Telegram 发送失败:${NC}"
        echo "$RESULT" | head -c 500
    fi
fi

echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  完成${NC}"
echo -e "${CYAN}============================================${NC}"
if [[ "$TG_ENABLED" != "true" ]]; then
    echo -e "${YELLOW}  提示: 创建 telegram.conf 即可启用 Telegram 通知${NC}"
    echo -e "${YELLOW}  格式: TG_TOKEN=xxx  TG_CHAT_ID=xxx${NC}"
fi
