# 泰卦智能平台

泰卦智能平台是一个开发中的多商户 AI 业务平台，包含统一主站、电销、社媒矩阵和私信拓客。独立站纳入开发计划。

本仓库公开当前开发快照，适合阅读源码、继续开发和本机验证。当前功能与验证状态见下表。

## 工程组成

| 工程 | 技术 | 当前状态 |
| --- | --- | --- |
| `projects/platform` | Flask、SQLite | 已增加主站身份、一次性 SSO 票据、点数冻结与结算、加密配置接口，管理页面开发中 |
| `projects/telephony` | Next.js、Express、Prisma、PostgreSQL、Redis、Go | 已有电销业务及平台接入，线路和企业微信集中配置仍在接入 |
| `projects/social` | Vue、Flask、浏览器执行器 | 国内及海外矩阵、商户隔离、任务与发布计费开发中，回归仍有一项失败 |
| `projects/outreach` | Express、JavaScript ESM | 国内人工联系工作台、海外邮箱与 WhatsApp、主站接入及计费开发中 |
| 独立站 | 待实现 | 建站、产品、多语言、SEO、GEO、询盘及客户管理属于后续开发范围 |

平台管理员统一管理产品授权、外部服务配置及点数规则。国内微信联系采用人工确认任务，提供候选名单、文案、结果登记及跟进能力。

## 本机启动主站

需要 Python 3.11 及以上版本。以下命令从仓库根目录运行。

```bash
python scripts/manage.py platform install
python scripts/manage.py platform migrate
python scripts/manage.py platform run
```

首次安装自动生成本机 `.env`、内部访问密钥、配置加密密钥及随机管理员密码。管理员工号和密码由本机 `.env` 的 `TAIGUA_ADMIN_STAFF`、`TAIGUA_ADMIN_PASSWORD` 保存。

主站默认访问地址为 `http://127.0.0.1:18000`，管理员入口为 `/ht`，商户入口为 `/qt`。运行数据位于 `data/persistent`，命令与应用日志位于 `logs`。

主站验证命令如下。

```bash
python scripts/manage.py platform check
```

测试在临时 SQLite 数据库和回环 HTTP 服务中创建合成商户。需要本机联调账号时，可在开发主站运行期间执行下列命令。

```bash
python scripts/seed_development.py
```

合成商户资料保存在 `data/temporary/development-identities.json`，包含本机随机密码和会话信息。

## 其他模块

- 电销的依赖与定向启动说明位于 `projects/telephony/本地启动说明.md`，需要 Node.js、PostgreSQL、Redis，语音桥另需 Go 及线路环境。
- 社媒原工程说明位于 `projects/social/README.md`，其上游功能说明需结合当前开发状态阅读。
- 拓客原工程说明位于 `projects/outreach/README.md`，后端使用 ESM，通过 `npm ci` 安装依赖。
- 统一平台契约和需求矩阵位于 `docs/02_开发/泰卦智能平台开发文档.md`。文档中的实施状态以当前代码和实际验证结果为准。

业务系统通过 `TAIGUA_PLATFORM_URL`、`INTERNAL_API_KEY` 和 `TAIGUA_AGENT_SLUG` 接入主站。子系统各自的运行端口、数据库和签名密钥按对应工程配置。

## 已有验证与待完成工作

公开快照建立前，主站新增的 15 项真实 HTTP 检查通过，覆盖一次性票据、停用与退出失效、Cookie 来源校验、并发扣费、幂等冲突、冻结、部分结算、取消释放、日限额、租户账单隔离及配置加密。

拓客完成了 9 项本机 HTTP 回归，外部模型、邮箱、WhatsApp 和 CRM 使用本地模拟服务。电销完成部分真实主站及 PostgreSQL 集成检查，录音使用合成 WAV。电销的服务端和前端曾构建通过，之后的集中配置变更仍需复验。

社媒最近一次完整回归记录为 79 项通过、9 项跳过及 1 项失败。失败涉及执行中取消后接收迟到发布回执的行为，仍需同步测试并复验。社媒最新页面变更也需要重新构建验证。

主站配置页面、商户级配置覆盖、部分国内社媒功能、独立站及整体部署验收仍在开发计划中。真实电话拨打、社媒账号发布、邮件、WhatsApp、企业微信和模型供应商调用需配置对应服务后验证。

## 公开源码范围

仓库包含当前应用源码、依赖锁文件、迁移、测试及开发说明。本机环境变量、密钥、数据库、客户名单、录音、浏览器会话、日志、依赖目录及构建产物由忽略规则排除。

各模块保留上游作者、许可证及修改记录。原有部署脚本包含历史环境约定，使用前应按自己的路径、域名及服务配置调整。

## 开源许可

仓库新增的平台集成代码和文档采用 Apache License 2.0。各子工程与第三方文件保留其原有许可证，具体归属及许可范围见根目录 `NOTICE`、`projects/social/NOTICE` 和对应 `LICENSE` 文件。
