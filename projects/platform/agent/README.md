# 智能体框架页面（agent/）

7 个独立框架页面 + 独立 Flask 服务，**与主站 app.py 完全解耦**：不读 data.db、不校验主站 token、无登录页，打开即功能页。

## 启动

```bash
cd agent
python agent.py        # 端口 8001（AGENT_PORT 环境变量可改）
```

| 地址 | 页面 |
|---|---|
| `/agent/social-cn` | 社媒矩阵（国内版 · 红） |
| `/agent/social-global` | 社媒矩阵（海外版 · 蓝） |
| `/agent/sales-cn` | 电销（国内版 · 红） |
| `/agent/sales-global` | 电销（海外版 · 蓝） |
| `/agent/dm-cn` | 私信拓客（国内版 · 红） |
| `/agent/dm-global` | 私信拓客（海外版 · 蓝） |
| `/agent/site` | 独立站（通用版 · 紫） |

`/` 与 `/agent` 均 302 → `/agent/social-cn`。

## 目录结构

```
agent/
├── agent.py           独立服务（端口 8001），预留 /api/<slug>/<module>/<item> 占位接口
├── *.html × 7         每页只声明 window.AGENT_PAGE 配置
├── common/agent.css   公共样式（黑白灰 + 品牌红，v0.4 已补齐全量组件）
├── common/agent.js    渲染器 + 折叠 + 主题 + 抽屉，顶部 USE_MOCK 开关
└── image/             独立素材包（logo / favicon / 封面 / 空状态图）
```

## 后端接入（最重要）

`common/agent.js` 顶部：

```js
const USE_MOCK = true;   // ← 后端写好后改成 false
```

- `true`：全部用本地确定性演示数据，交互可演示（搜索 / 开关 / 向导 / 发消息），不落库
- `false`：每个功能位请求 `GET /api/<框架>/<模块>/<功能位>`，返回 `{code:0, msg:"ok", data:{...}}` 自动渲染；接口未就绪时回退演示数据并提示

### 视图 ↔ 接口对照

8 种视图按功能位名称自动推断（页面配置可用 `view:` 覆盖）：

| 视图 | 适用 | data 结构 |
|---|---|---|
| `dashboard` | 看板 / 概览 / 报告 | `{ kpis:[{name,value,delta}], trend:[{date,value}], sources:[{name,value}], rows:[...] }` |
| `table` | 名单 / 记录 / 订单 | `{ total:Number, list:[{name,region,source,metric1,metric2,time,stage,active}] }` |
| `accounts` | 账号 / 登录 | `{ list:[{platform,name,account,fans,interactions,online,active}] }` |
| `form` | 配置 / 设置 | `{ values:{ name,scope,freq,owner,note,switches:[[名称,布尔]] } }` |
| `wizard` | 新建外呼 / 框架生成 | `{ staff:[{name,script}], lines:[{name,stock,ok}] }` |
| `chat` | 私信 | `{ conversations:[{name,last,time,unread,color}], messages:[{role,text,time}] }` |
| `kb` | 知识库 / 问答 | `{ list:[{q,a,hits}] }` |
| `grid` | 员工 / 声音 / 网站 | `{ list:[{title,sub,desc,progress,region,ok}] }` |

写操作调用点已埋好并标注方法路径（如 `PUT /api/<slug>/<module>/<item>`、`POST .../start`、`POST .../send`）。

## 配置说明（window.AGENT_PAGE）

```js
{
  slug: 'sales-cn',
  name: '电销（国内）',
  env: 'dom',            // dom=国内版(红) / glb=海外版(蓝) / base=通用版(紫)
  envName: '国内版',
  market: '中国大陆',
  modules: [
    { key: 'call', name: '外呼中心', items: [
      { key: 'new', name: '新建外呼', desc: '…', view: 'wizard' }  // view 可省略（自动推断）
    ]},
    { key: 'dashboard', name: '数据看板', flat: true, items: [...] }  // flat=不显示分组标题
  ]
}
```

- **区域标识**：`env / envName / market` 驱动 5 处标注（顶部色带、侧栏版本条、顶栏标签、标题 chip、浏览器标题）
- **flat: true**：侧栏不出分组标题，子项直接作为一级菜单（面包屑/眉标同步省略模块名）
- **侧栏折叠**：分组默认收起，点标题开合；当前所在分组自动展开

## 页面结构约定

每个 html 只需：引入 `/common/agent.css`、声明 `window.AGENT_PAGE`、引入 `/common/agent.js`。素材引用 `/image/...`，全部相对 agent 服务根路径，方便整体搬到任意子目录或独立域名。
