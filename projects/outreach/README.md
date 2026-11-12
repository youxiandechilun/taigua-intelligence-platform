# 私信拓客系统（WhatsApp + 邮件双通道开发信）

独立目录、独立端口、零依赖其它项目。**顾客只用业务前端，所有配置集中在独立的管理后台**。

五大模块（顾客需求逐条对应）：

| 模块 | 页面 | 功能 |
|---|---|---|
| 数据看板 | 数据看板 | 任务回执：今天 WhatsApp 发了多少、回了多少；邮件发了多少、读了多少、回了多少；账号 / 任务状态实时 |
| 账号管理 | WhatsApp 账号 / 邮箱账号 | 多号扫码接入 + 多邮箱接入；发送时**多号轮换**、单号日限，防止单号被封拖垮整体 |
| 任务中心 | AI 找线索 / 开发信任务 | 关键词 + 指定国家 → AI 联网搜索真实客户并核对官网联系方式 → 勾选后调用已登录账号批量发送（群发可指定账号、按国家导入收件人） |
| 留资中心 | 回复收件箱 / 客户管理 / 跟进提醒 | 客户回复**自动进来**（WA 实时推送、邮件每 3 分钟拉取），按关键词自动分 A / B 类；客户 ABC 分级管理；超期未跟进自动提醒 |
| 知识库 | 公司介绍 / 产品介绍 / 常见问题 | 公司档案、产品参数、FAQ 全部落库，AI 写开发信 / 回复客户时引用 |

## 两个入口、两套口令

| 入口 | 给谁用 | 口令 | 能做什么 |
|---|---|---|---|
| `/` 业务控制台 | **顾客** | 顾客口令（管理员在后台设置） | 只用功能：看板 / 账号 / AI 找线索 / 群发 / 留资 / CRM / 知识库。**没有配置入口，拿不到任何密钥** |
| `/admin` 管理后台 | **运营方（你）** | 管理员口令（首次打开自设，≥6 位） | 大模型 Key、检索通道、发送策略、留资规则、顾客口令、数据与运行状态 |

- 顾客 token 与管理员 token 是两种角色：`/api/settings`、`/api/admin/*` 只认管理员；顾客端访问这些接口直接 403。
- 顾客端页面上只显示「AI 已启用 / 未启用」这类状态，不显示任何地址与密钥。

- **`/` 控制台**（console.html）：完整业务界面，风格与泰卦智能智能体框架一致（黑白灰 + 品牌红，海外蓝色带）。
- **`/simple.html` 简易扫码页**：只有扫码登录，调试用。

## 一、运行

```bash
cd whatsapp-console
npm install
npm start          # 默认 http://127.0.0.1:8100
```

Windows 可双击 `start.bat`，Linux 用 `bash start.sh` 或 systemd 常驻。

可选环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `WA_PORT` | 8100 | 监听端口 |
| `WA_HEADLESS` | 1 | 1=无头（Linux 服务器必须），0=显示浏览器窗口 |
| `WA_EXECUTABLE_PATH` | 空 | 指定 Chromium 路径；服务会自动探测系统浏览器，一般不用填 |
| `WA_PROXY` | 空 | 走代理访问 WhatsApp，形如 `http://127.0.0.1:7890` |
| `WA_MOCK` | 0 | 1=演示模式：假二维码 + 模拟上线 + 一键演示数据，给客户看流程用 |
| `MAIL_POLL_SEC` | 180 | 邮箱收信轮询间隔（秒） |
| `CONSOLE_PASSWORD` | 空 | 直接用环境变量设访问口令（也可以在前端「后端配置」里设） |

## 二、快速上手（演示）

1. `WA_MOCK=1 npm start` → 打开页面
2. 看板右上角「**填充演示数据**」→ 3 个 WhatsApp 号、2 个邮箱、任务、回复、客户全部就位
3. 逐页点一遍即可演示完整业务流

## 三、正式使用流程

1. **接入账号**：账号管理 → WhatsApp 扫码 / 邮箱填授权码（QQ/163 需先在邮箱设置开启 SMTP 并生成授权码）
2. **配置后端**：系统 → 后端配置 → 大模型 / 搜索源 / 发送策略 / 访问口令（见下）
3. **AI 找线索**：任务中心 → AI 找线索 → 关键词 + 指定国家（可指定客户类型与条数）→ 开始 AI 搜索（五步过程实时可见：AI 规划检索式 → 联网检索 → 抓官网核对联系方式 → AI 整理打分 → 入库）→ 勾选 → 加入群发任务
4. **发开发信**：开发信任务 → 选通道与账号（多选即轮换）→ 正文（支持 `{{name}} {{co}} {{country}} {{product}} {{moq}} {{company}} {{sender}}` 变量，可用 AI 润色）→ 创建
5. **收留资**：客户回复自动进「回复收件箱」，AI 可起草回复；「进客户管理」一键入库
6. **管客户**：A / B / C 分级、阶段推进、记录跟进；超过 N 天未联系进「跟进提醒」

## 四、后端配置说明（密钥只存服务器）

| 配置 | 内容 | 不配会怎样 |
|---|---|---|
| 大模型 | Base URL + Key + 模型名（OpenAI / DeepSeek / 通义 / 智谱 / vLLM 均可，需带 `/v1`） | AI 润色 / AI 回复草稿不可用，其余功能不受影响 |
| AI 在线搜索 | 检索通道密钥（Serper / Tavily，推荐）+ 可选第三方数据源接口。大模型用上面那张卡片 | 不配密钥也能用免费检索源（慢、易限流）；**不配大模型时 AI 退化为「检索 + 官网抓取」，无匹配度打分** |
| 发送策略 | WA 单号日限 / 间隔区间 / 每号连发几条换号 / 失败换号 / 邮箱日限 | 默认值已按保守参数设置 |
| 留资规则 | 首次跟进间隔、超期提醒天数、A 类关键词（命中即升 A） | 默认 3 天 / 7 天 |
| 访问口令 | 首次打开会要求设置；改口令在「后端配置」最下方 | 不设则任何人可访问，**建议必设** |

## 五、数据与备份

全部数据在一个文件里：`data/db.json`（账号、线索、发送记录、回复、客户、知识库、配置）。**备份这个文件即可**。
WhatsApp 登录态在 `data/sessions/`，删掉需要重新扫码。

## 六、部署（宝塔）

1. 上传整个目录（**不要传 `node_modules`**），站点目录如 `/www/wwwroot/taikua-console`
2. `npm install`（国内服务器装浏览器慢时：`PUPPETEER_DOWNLOAD_BASE_URL=https://cdn.npmmirror.com/binaries/chrome-for-testing npm install`）
3. 装系统依赖：`apt-get install -y chromium fonts-noto-cjk libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2`
4. 宝塔「Node 项目」添加：启动文件 `server.js`，端口 8100，PM2 守护；或已有站点加反向代理到 `127.0.0.1:8100`（**必须**在反代配置里加 `proxy_buffering off; proxy_cache off; proxy_read_timeout 3600s; proxy_set_header Connection ''; proxy_http_version 1.1;`，否则实时推送会被 Nginx 憋住）
5. 外网务必走 80/443 反代，**不要直开 8100 端口**
6. 部署后先打开 `/admin` 设置管理员口令，再在「访问控制」里给顾客端设口令；生产环境记得 `WA_HEADLESS=1`
7. 忘了管理员口令：编辑 `data/db.json` 删掉 `auth.admin` 字段重启，再进 `/admin` 重设

## 七、接口一览（前端已全部接好，二开对接用）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` / `/api/auth/password` | 登录 / 改口令（Bearer token） |
| GET | `/api/overview` | 看板全量统计 |
| GET/POST/DELETE | `/api/wa` | WhatsApp 账号列表 / 新建(出二维码) / 删除 |
| POST | `/api/wa/:id/start` `/stop` `/mock-online` | 启动 / 停止 / 演示上线 |
| GET | `/api/wa/:id/chats` | 读取该号全部联系人 |
| POST | `/api/wa/:id/send` | 单发 `{to, text}` |
| GET/POST/PUT/DELETE | `/api/mail` | 邮箱账号管理；`POST /api/mail/test` 测连接 |
| POST | `/api/mail/:id/check` | 立即收信（正常由后台自动轮询） |
| POST | `/api/ai/search` | **AI 在线搜索** `{keyword, country, audience, limit, save}` → `{jobId}`，异步执行 |
| GET | `/api/ai/search/:id` | 查询搜索进度与结果（steps / summary / results 含 match 与 AI 判断） |
| GET | `/api/ai/search/latest` | 最近一次搜索（页面刷新后恢复用） |
| GET/POST | `/api/ai/health` `/api/ai/test-search` | AI 与检索通道状态 / 测试检索通道 |
| POST | `/api/leads/search` | 旧版同步找线索（兼容保留） |
| GET/POST/DELETE | `/api/leads` `/import` `/clear` | 线索池管理 / 粘贴导入 |
| GET/POST | `/api/campaigns` | 任务列表 / 创建（channel=wa\|mail） |
| POST | `/api/campaigns/:id/pause` `/resume` `/stop` | 任务控制 |
| GET | `/api/replies` `/api/customers` `/api/followups` | 留资 / 客户 / 跟进提醒 |
| GET/PUT | `/api/kb` `/api/kb/company` `/api/kb/products` `/api/kb/faq` | 知识库 |
| GET/PUT | `/api/settings` | **仅管理员**：大模型 / 检索 / 策略 / 留资规则（密钥只写不读） |
| GET | `/api/admin/storage` | **仅管理员**：数据文件大小、会话数、运行时长 |
| POST | `/api/admin/login` `/api/admin/password` | 后台登录（首次即设置口令）/ 改管理员口令 |
| POST | `/api/admin/customer-password` | **仅管理员**：设置 / 关闭顾客端访问口令 |
| GET | `/api/public/config` | 顾客端只读状态（AI 是否启用等，不含任何密钥） |
| POST | `/api/settings/test-llm` `/api/llm/draft` | 大模型测试 / 生成文案 |
| GET | `/api/events` | SSE 实时推送 |
| GET | `/t/:trackId.gif` | 邮件已读追踪像素 |

## 八、风险与边界（务必告知客户）

- WhatsApp 非官方通道有封号风险，**账号由客户自备、封号风险客户承担**；系统设计目标是"封了不慌"（多号轮换 + 掉线标红 + 断点续发），不是"永不封号"
- 「AI 找线索」搜索的是**公开网页上的邮箱 / 电话**，AI 只做整理与打分、不允许编造联系方式；要量与精准度就配 Serper/Tavily 检索密钥或第三方数据源
- 邮件送达率取决于客户域名认证（SPF / DKIM），新域名先少量预热
- 涉及收件人所在国的商业信息法规（欧盟 GDPR/PECR、美国 TCPA 等）由客户自行合规
