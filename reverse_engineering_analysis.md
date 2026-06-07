# CloudMarking & CloudAnalysis API 接口规范说明

本篇技术文档详述了平台在学生端登录、成绩查询、单科明细获取和试卷答题卡图片定位时所使用的核心后端 API 接口。

---

## 1. 全局配置与请求头
所有的 AJAX 接口在向后端发送请求时，必须包含以下请求头配置，否则可能导致接口报 `403` 或被系统拦截认定为会话超时：
* `Content-Type`: `application/x-www-form-urlencoded`
* `X-Requested-With`: `XMLHttpRequest`
* `User-Agent`: (推荐使用标准 PC 端浏览器 User-Agent)
* `Referer`: `http://sxoma.com:8088/CloudAnalysis/web/stu/...` (对应功能页面的 URL 地址)

---

## 2. 接口列表与技术规约

### 2.1 获取学校实例列表
* **接口地址**：`http://sxoma.com:8088/CloudMarking/system_xsloginsllist.do`
* **请求方式**：`POST`
* **接口说明**：返回当前系统上所有可用的学校实例。
* **请求体**：无 (Empty Body)
* **响应格式 (JSON)**：
  ```json
  {
    "res": true,
    "list_result": [
      { "SLID": "1001", "SLMC": "八十九中教育集团（旧）" },
      { "SLID": "1003", "SLMC": "西安市第八十九中学" }
      // ... 其他实例
    ]
  }
  ```

---

### 2.2 学生登录验证
* **接口地址**：`http://sxoma.com:8088/CloudMarking/xslogin.do`
* **请求方式**：`POST`
* **请求参数**：
  | 参数名 | 类型 | 说明 |
  | :--- | :--- | :--- |
  | `slid` | string | 学校实例代码 (如 `1003`) |
  | `ksid` | string | 学籍号/考生号 (如 `20280349`) |
  | `ksmm` | string | 登录密码 (明文) |
  | `xs_yzm` | string | 4位图片验证码 |
  | `dlfs` | string | 登录方式 (`1` 代表网页网页端，`4` 代表移动端) |

* **响应格式 (HTML)**：
  验证成功时返回包含 Javascript 跳转脚本的 HTML：
  ```html
  <script type="text/javascript">
      window.onload=function(){ jump(); }
      function jump(){
          var yhzh = "452367351B3F8452ADC647F9BFECBF29";
          var txdz = "http://sxoma.com:8088/CloudAnalysis/";
          var txmy = "E9A7E6041FE258A013C0AAA9311C8409";
          var njdm = "1228";
          var reqLocation = "sixslogin.do";
          window.location.href = txdz+"/"+reqLocation+"?yhzh="+yhzh+"&txmy="+txmy+"&njdm="+njdm;
      }
  </script>
  ```
  *注意：该跳转用于同步建立 `/CloudAnalysis` 系统的 Session。客户端必须紧接着访问 `window.location.href` 中指向的 URL，以在分析系统域下写入新的 `JSESSIONID` Cookie。*

---

### 2.3 提取学生历次考试与概览
* **接口地址**：`http://sxoma.com:8088/CloudAnalysis/stunavi_getNavi.do`
* **请求方式**：`POST`
* **接口说明**：提供登录学生的基础个人资料及所有参加过的考试概览。
* **请求参数**：
  | 参数名 | 类型 | 说明 |
  | :--- | :--- | :--- |
  | `ksid` | string | 学籍号 (留空时，后端自动从 Session 缓存中读取) |
  | `njdm` | string | 年级代码 (留空时，后端自动从 Session 缓存中读取) |

* **响应格式 (JSON)**：
  ```json
  {
    "res": true,
    "zzmc": "西安市第八十九中学",
    "kshengjcxx": {
      "KSID": "20280349",
      "XM": "孟诩迪",
      "NJMC": "高2028届",
      "BJMC": "3",
      "NJDM": "1228",
      "BJDM": 3
    },
    "lcksxx": [
      {
        "KSDM": "379",
        "KLDM": "1",
        "KSMC": "89高一诊断性检测3",
        "KSSJ": "2026-06-02T00:00:00",
        "BCKSKM": "1_语文,2_数学,5_英语,81_物理,82_化学,83_生物",
        "JFPM": 61,
        "BJPM": 5
      }
      // ... 更多考试记录
    ]
  }
  ```

---

### 2.4 查看成绩分析与逐题细项得分
* **接口地址**：`http://sxoma.com:8088/CloudAnalysis/stuckfx_getStuByKm.do`
* **请求方式**：`POST`
* **接口说明**：用于调取特定考试、特定科目的详细分数与答题卡小题得分。
* **请求参数**：
  | 参数名 | 类型 | 说明 |
  | :--- | :--- | :--- |
  | `ksdm` | string | 考试代码 (如 `379`) |
  | `kldm` | string | 分类代码 (如 `1`) |
  | `ksid` | string | 学籍号 (如 `20280349`) |
  | `bjdm` | string | 班级代码 (如 `3`) |
  | `njdm` | string | 年级代码 (如 `1228`) |
  | `kmdm` | string | 科目代码 (例如 `82` 代表化学，`0` 代表全科) |

* **响应格式 (JSON)**：
  关键数据结构包含在 `kmxtxq` 列表中，列出了各题目的满分与学生个人得分率：
  ```json
  {
    "res": true,
    "cjpmbrkm": {
      "KMCJ": 88.0,
      "BJPM": 25,
      "JFPM": 137
    },
    "kmxtxq": [
      {
        "STBH": "1",
        "STMC": "选择1",
        "STMF": "3.00",
        "GRDF": "3.00",
        "BJDFL": "0.9833",
        "NJDFL": "0.9300"
      }
      // ... 其他各小题得分数据
    ]
  }
  ```

---

### 2.5 获取答卷扫描参数及全图地址
* **接口地址**：`http://sxoma.com:8088/CloudAnalysis/stuckzd_getStuckzd.do`
* **请求方式**：`POST`
* **接口说明**：用于取得答卷各题型切割图像基准地址、条码绑定关系及答卷图像整页数量。
* **请求参数**：
  | 参数名 | 类型 | 说明 |
  | :--- | :--- | :--- |
  | `ksdm` | string | 考试代码 (如 `355`) |
  | `kldm` | string | 分类代码 (如 `1`) |
  | `ksid` | string | 学籍号 (如 `20280349`) |
  | `kmdm` | string | 科目代码 (如 `82`) |

* **响应格式 (JSON)**：
  通过返回的 `kskmtxxx` 和 `xskmcjxx` 可以构建出答卷的扫描大图地址：
  ```json
  {
    "res": true,
    "kskmtxxx": {
      "DYTXDZ": "http://111.21.50.4:4088/Examimg/1001/888/82/",
      "TXSL": 2
    },
    "xskmcjxx": {
      "DYBMH": "733102104230327413540140",
      "OMR": "C,C,B,A,C..." // 客观题填涂情况
    }
  }
  ```

#### 扫描大图 URL 拼接公式：
根据接口数据，学生所填写的物理答题纸整页图像的 URL 的构造关系如下：
```
URL_i = {DYTXDZ} + {DYBMH} + "/" + {DYBMH} + "_full_" + {i} + ".jpg"
```
*其中，`i` 范围在 `1` 到 `TXSL` (图片总数) 之间。若 `DYBMH` 字段为空值，则中间的文件夹和文件名前缀留空，形式为 `{DYTXDZ}//_full_{i}.jpg`。*
