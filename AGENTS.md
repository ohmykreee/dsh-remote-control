# AGENTS.md

本文件面向在本仓库里工作的开发者与 agent。终端用户的功能说明见 [`README.md`](README.md)，安装、更新和排障见 [`INSTALLATION.md`](INSTALLATION.md)。

在改代码前先记住三条：

1. 这是 **DSH bundle 插件**，不是普通 npm 包；仓库只提交源码，运行产物必须本机构建。
2. `index.js`、`client.js`、`lib/`、`web/`、`native/bin/` 都是生成物，不要手改，也不要在提交里加入它们。
3. 用户不会从 npm 安装。不要添加 npm 发布步骤，也不要在文档里引导 `github:` 直接安装。

## 文档分工与维护规则

| 文件 | 负责内容 | 不该出现的内容 |
|---|---|---|
| `README.md` | 插件介绍、截图、用户可见功能 | 安装命令、协议、构建细节 |
| `INSTALLATION.md` | 唯一的安装方式（clone → build → `link:`）、探针构建、更新、卸载、故障恢复 | 架构设计、开发流程 |
| `AGENTS.md`（本文件） | 架构、DSH 集成、协议、Rust 探针、媒体适配层、构建、测试、CI、已知缺口 | 面向终端用户的功能推销 |

维护约定：

- 功能行为变化改 `README.md`；安装或构建步骤变化改 `INSTALLATION.md`；协议、模块、构建流水线变化改本文件。
- 媒体适配层的完整设计只维护在本文件，不再单独建文档。
- 新增平台、命令、环境变量或限制时，三份文档按上表各自更新，不要复制粘贴同一段说明。
- `package.json` 的 `files` 只影响打包元数据；本项目不发布 npm 包，改文档时保持其与仓库文件一致即可。

## 项目形态

- 名称：`dsh-remote-control`，版本 `1.0.0`，`"private": true`，MIT。
- 运行形态：DSH Desktop / `dsh web` 的 Host 进程内加载的 bundle 插件。
- 一个进程里同时存在四层：
  1. **Host**：`src/dsh`（TypeScript，ESM），编译为 `index.js` + `lib/`；
  2. **DSH 侧边栏**：`src/dsh/client`（React，无 JSX；types/i18n/api/logic/ui/sections/panel 分模块），编译后合并为单个 `client.js`；
  3. **手机端**：`src/svelte`（Svelte 5 + Vite），编译为 `web/`；
  4. **原生探针**：`src/rust`（Cargo），编译为 `native/bin/<platform>-<arch>/dsh-probe[.exe]`。
- 目标平台：Windows（完整）、Linux（完整）、macOS（源码级，未实测）；手机端为现代浏览器。
- Node 要求 `>= 22`；CI 固定 Node `26.7.0`、pnpm `12.8.1`、Rust `1.99.1`。

## 运行拓扑

```text
DSH Desktop / dsh web
└─ profile bundle: dsh-remote-control
   ├─ index.js（Host 入口，inject webServer）
   │  ├─ lib/service.js ── LAN HTTP + WebSocket :38765 ── web/（手机 Svelte）
   │  ├─ lib/settings.js ── DSH_HOME（或 DSH_PROFILE_DIR）/remote-control/settings.json
   │  └─ lib/probe.js ── child_process ── native/bin/<platform>-<arch>/dsh-probe
   └─ client.js（DSH 侧边栏 React 页面）── /dsh-remote-control/api/*
```

Host 与浏览器端（侧边栏）通过 DSH 自带 `webServer` 的环回路由通信；手机端走插件自己监听的 LAN 端口。两条链路互不复用。

## DSH 集成契约

### package.json

```json
{
  "main": "./index.js",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-locale"]
    }
  }
}
```

`cordis.patch.yml` 只做一件事：把 `remote-control` 条目插入 profile 的插件树。

```yaml
- insert:
    - id: remote-control
      name: dsh-remote-control
```

### Host 入口

`src/dsh/index.ts`：

- `export const inject = ['webServer']`；
- `export async function apply(ctx)`：
  - 创建并启动 `createRemoteControlService(ctx, { log })`；
  - 用 `ctx.effect()` 注册 `service.dispose()`；
  - 在 `ctx.get('webServer')` 上注册侧边栏路由；
  - 记录启动失败、TLS 降级和监听端口。
- 路由是 `kind: 'exact'`，每个路由都用 `ctx.effect()` 注册，插件卸载时自动反注册。

### 侧边栏路由

| 方法 | 路径 | 处理 |
|---|---|---|
| GET | `/dsh-remote-control/api/info` | 服务状态、地址、二维码路径、能力 |
| GET/HEAD | `/dsh-remote-control/qr.svg` | 配对二维码（SVG） |
| GET | `/dsh-remote-control/api/settings` | 设置 + 网卡 + 应用映射 + 诊断 + dsh-probe/Node.js 能力 |
| POST | `/dsh-remote-control/api/settings` | 批量应用设置 |
| POST | `/dsh-remote-control/api/apps` | 应用改名/恢复默认 |
| POST | `/dsh-remote-control/api/location` | 调探针 `location request`，成功则清定位缓存 |
| POST | `/dsh-remote-control/api/theme` | 同步 DSH 明暗主题 |
| POST | `/dsh-remote-control/api/token/rotate` | 轮换令牌并断开所有设备 |
| POST | `/dsh-remote-control/api/disconnect` | 按客户端 id 断开设备 |

这些路由挂在 DSH 的 `webServer` 上，继承其访问控制；所有写接口额外校验 `Origin` 与 `Host` 一致（`sameOrigin`），不通过返回 403。

### 浏览器模块工厂

`scripts/build-dsh.mjs` 先编译 `src/dsh/client/index.ts` 及其引用的所有模块为 CommonJS，再把它们编成一个小型模块表，包装为：

```js
window.__ModuleLoader__.load({
  id: 'dsh-remote-control',
  factory(require) {
    /* 内部模块表 + 相对 require 解析，最后返回 client/index.js 的 exports */
  },
});
```

拆分后的客户端源码仍然只产出一个 `client.js`；不要手改生成物。`require('react')` 由 DSH 的模块加载器提供（裸模块名直接交给外层 `require`，相对路径由内部模块表解析）；不要改成 ESM `import`。

### 本地化

`locale/en.json`、`locale/zh.json` 提供插件元信息（标题、描述），由 `@deepseek-ai/dsh-client-locale` 注入。侧边栏内部的中英文案在 `src/dsh/client/i18n.ts` 的 `zh` / `en` 字典里；面板通过 `useTranslator()` 跟随 DSH 当前语言，修改后需要重新构建 `client.js`。

## 目录

```text
index.js                  生成物：Host 入口（gitignore）
client.js                 生成物：DSH 侧边栏模块工厂（gitignore）
lib/                      生成物：Host 逻辑（gitignore）
web/                      生成物：手机端页面、字体、天气图标（gitignore）
native/bin/               生成物：Rust 探针二进制（gitignore）
locale/                   DSH 侧边栏本地化资源
icon.svg                  插件图标
cordis.patch.yml          bundle patch
package.json              插件元数据、依赖、脚本、DSH 契约
vite.config.js            Vite + Svelte 构建配置
svelte.config.js          Svelte 预处理器配置
tsconfig.json             Svelte 端 TypeScript / svelte-check
tsconfig.dsh.json         Host 编译配置（src/dsh → index.js + lib/）
tsconfig.dsh-client.json  浏览器端编译配置（src/dsh/client/index.ts + 模块 → client.js）
scripts/build-dsh.mjs     编译 src/dsh，写 index.js / client.js / lib/，并把客户端模块合并成单一工厂
scripts/build-web.mjs     以编程方式调用 Vite，输出 web/
scripts/build-rust.mjs    编译 src/rust，产物写 native/bin/
src/dsh/index.ts          Host 入口（inject / apply）
src/dsh/client/index.ts   DSH 侧边栏入口（inject / apply / slot 注册）
src/dsh/client/types.ts   Host/Client 线格式与 PanelApi 契约
src/dsh/client/i18n.ts    zh/en 字典、宿主语言跟随
src/dsh/client/api.ts     环回 API、JSON 请求与错误解析
src/dsh/client/logic.ts   草稿/合并/保存载荷/格式化等纯函数
src/dsh/client/ui.ts      React 原语（Toggle/Seg/Btn/Field/Row/StatusRow）
src/dsh/client/styles.ts  DSH 设置页风格 CSS（仅使用 --dsw-* 令牌）
src/dsh/client/icons.ts   侧边栏与菜单图标
src/dsh/client/panel.ts   面板状态机、动作、拖拽与外壳
src/dsh/client/sections/  连接/偏好/番茄钟/天气/余额/通知/映射/系统各节
src/dsh/lib/service.ts    HTTP/WebSocket、配对、设置、推送、静态资源
src/dsh/lib/ws.ts         最小 RFC6455 WebSocket 服务
src/dsh/lib/settings.ts   设置持久化、校验、令牌轮换
src/dsh/lib/sessions.ts   DSH 会话、子代理关系、待回答/待审批追踪与远程回答
src/dsh/lib/account.ts    余额、今日/7 日用量
src/dsh/lib/weather.ts    系统/IP 定位、Open-Meteo、小时/7 天预报
src/dsh/lib/performance.ts Rust performance 载荷（仅 CPU/内存 JS 兜底）
src/dsh/lib/media-enrich.ts 媒体归一化、进度平滑、seek 规则
src/dsh/lib/probe.ts      探针定位、执行、JSON 解析、临时目录
src/dsh/lib/runtime.ts    dsh-probe/Node.js 系统能力载荷
src/dsh/lib/probe-daemon.ts 常驻探针的 stdio 请求/响应客户端与回退
src/dsh/lib/probe-adapter.ts Rust 媒体/音量适配器（无回退）
src/dsh/lib/notifications.ts Rust 通知服务（Linux watch / 其他一次性）
src/dsh/lib/app-mapping.ts 应用历史与软件映射
src/dsh/lib/qr.ts         二维码 SVG
src/dsh/lib/util.ts       路径、版本、时间、转义等纯函数
src/dsh/lib/types.ts      共享 Host 类型
src/dsh/lib/platform/index.ts 组装媒体与通知适配器
src/svelte/               手机端 Svelte 5 + TypeScript
src/svelte/lib/           状态、WebSocket、格式化、图标、媒体投影
src/svelte/lib/components/ 页面与卡片组件
src/svelte/styles/        全局颜色令牌与基础样式
src/rust/src/cli.rs       命令行解析与 JSON 信封
src/rust/src/daemon.rs    常驻模式：stdin/stdout 按行请求/响应
src/rust/src/media/       媒体适配层（catalog + 平台实现 + 无障碍）
src/rust/src/media/vendor/      各客户端私有适配（网易云、QQ、酷狗、酷我、汽水、全民K歌、Spotify、Apple Music、YouTube Music）
src/rust/src/perf/        性能采样
src/rust/src/notifications/ 通知读取/监视
src/rust/src/volume/      音量
src/rust/src/location/    定位
src/rust/tests/cli.rs     CLI 端到端测试
test/                     Node 集成测试（8 个 .mjs）
static/                   Vite 公共资源（图标、manifest、字体许可、天气图标）
docs/screenshots/         手机端截图（仅图片）
.probe-tmp/               探针只读 SQLite 副本的临时目录（运行时生成）
```

## Host 架构

### 生命周期

`service.start()` 负责：读取设置、创建适配器、启动 LAN HTTP/HTTPS 服务、启动 WebSocket hub、启动推送循环。`dispose()` 关闭服务器、hub、适配器和定时器。`index.ts` 用 `ctx.effect()` 绑定这个生命周期，因此 DSH 卸载/重载插件时会自动清理。

### 设置

`src/dsh/lib/settings.ts`：

- 数据目录：`DSH_PROFILE_DIR/remote-control`（优先）或 `DSH_HOME/remote-control`，否则 `~/.dsh/remote-control`；
- 文件：`settings.json`（原子写：临时文件 + rename）；
- 当前 schema 版本 `1`，字段包括 token、允许网卡、主题、温度单位、天气、余额、通知、TLS、导航位置、番茄钟、页面顺序/开关；
- `normalize()` 对每个字段做白名单/范围校验，缺失时回落到默认值；
- `update(patch)` 做浅合并 + 嵌套对象合并，`save()` 重写整个文件；
- 令牌 24 字节随机 `base64url`；`rotateToken()` 轮换后由 service 断开所有设备。

设置对象本身不含 token；`/api/info`（以及 `/api/settings` 里的 `info` 字段）会带配对 URL 和二维码路径，响应里的 token 只出现在这些 URL 的 query 中（客户端另存为 cookie）。

### LAN HTTP 服务

`src/dsh/lib/service.ts`：

- 默认端口 `38765`，可用 `DSH_REMOTE_CONTROL_PORT` 覆盖；绑定 `0.0.0.0`；端口占用时回退到随机可用端口；
- 可选 HTTPS：读取 PEM 证书/私钥；配置无效时回退 HTTP 并在 `info.tls.error` 中报告；
- 静态文件：`web/` 下的页面、`/assets/`、字体、天气图标、`/manifest.webmanifest`、`/icon.svg`；
- 鉴权：`tokenEnabled` 时，`/`、静态资源和 `/ws` 需要 `?token=` 或 `dsh_rc` cookie；失败返回 401 页面；`/api/pomodoro/sound` 只对已授权页面开放；
- 网卡限制：`allowedInterfaces` 为 null 表示全部；否则按 CIDR 匹配来源 IP，回环地址始终放行；
- 请求体上限 64 KiB；JSON 响应带 `no-store`；
- 媒体/音量动作通过 `adapters.media.control()` 发给探针，结果以 `action-result` 回给发起端，然后广播新的 `media` 快照。

### WebSocket 协议

路径 `/ws`；握手校验 `Origin` 与 `Host` 一致，并要求 token（query 或 cookie）。

服务端 → 手机端：

| type | 内容 |
|---|---|
| `welcome` | 公开设置快照 |
| `overview` | 会话、天气、通知、余额、性能、设置聚合 |
| `clients` | 已连接设备列表 |
| `sessions` / `notifications` / `account` / `weather` / `media` / `performance` | 增量快照 |
| `settings` | 设置变化 |
| `action-result` | 媒体/音量动作结果 |
| `answer-result` | 远程回答结果 |
| `error` | 初始化失败 |
| `pong` | 心跳回应 |

手机端 → 服务端：

| type | 内容 |
|---|---|
| `action` | `playpause` / `next` / `previous` / `seek` / `like` / `volume` / `mute`，可带 `value` |
| `answer-question` | `sessionId`、`requestId`、结构化答案 |
| `refresh` | 重发初始快照 |
| `settings` | 请求设置快照 |
| `ping` | 心跳 |

推送循环（有客户端时）：

| 数据 | 周期 | 页面开关 |
|---|---|---|
| sessions | 1.5 s | `pageEnabled.sessions` |
| notifications | 2.5 s | `pageEnabled.home` |
| media | 2.2 s | `pageEnabled.music` |
| account | 30 s | `pageEnabled.sessions` |
| weather | 5 min | `pageEnabled.home` |
| performance | 2.5 s | `pageEnabled.performance` |

没有客户端时循环停止；页面关闭时跳过对应推送。`sendInitial()` 在连接时发送 `welcome`、`overview`、已启用页面的 `media` / `performance`、`clients`。

### 会话与远程问询

`src/dsh/lib/sessions.ts` 依赖 DSH 的 `sessions`、`agents`、`sessionTitle`、`userQuestions` 服务，并监听 `user-questions/request`、`approval/request` 瀑布事件：

- `collectSessions()` 把 DSH 会话投影成手机端结构：标题、cwd、状态、运行起始时间、子代理父子关系、待回答/待审批信息、错误；
- `createPendingTracker()` 维护待处理项：
  - 正常瀑布：在 `user-questions/request` 上以 `prepend` 注册处理器，把问题转发给手机端；
  - 已超时但仍可回答的 continued 提问：通过 `userQuestions.answer(agent, callId, answer)` 提交；
  - 从会话日志重建的待处理项通过 `adopt()` 补登记；
- `notifications.pushQuestions` 为 false 时，`sessions` 快照会剥离问题内容和 `answerable`，服务端也拒绝 `answer-question`；
- 远程回答只处理 DSH 的正常用户问题（`ask_user_question`）；工具审批（approval）不提供远程按钮，仍需在 DSH 中处理；
- DSH 自己的提问卡片仍会显示，远程回答后可能需要手动关闭，这是 DSH Web 客户端当前行为。

### 其他 Host 服务

- `account.ts`：DSH 账户余额与用量，支持“本周/最近 7 天”窗口和低余额标记。
- `weather.ts`：系统定位（Windows WinRT / Linux GeoClue2，经探针）→ IP 定位（ipwho.is）→ 时区兜底；Open-Meteo 预报；缓存与清空。
- `performance.ts`：只采用 Rust `performance` 载荷；探针缺失时仅用 `os.cpus()` / `os.totalmem()`。
- `media-enrich.ts`：统一媒体字段、`provider` / `providerDetail`、进度平滑和 seek 判定；手机端与 Host 共用规则。
- `notifications.ts`：Windows/macOS 一次性读取；Linux 启动 `notifications watch` 长进程并按行更新；字段归一化、应用筛选、数量限制在 Node 侧。
- `app-mapping.ts`：应用历史 + 默认名称 + 用户改名 + 旧 `notification-cache.json` 迁移；`/api/apps` 写接口。
- `qr.ts`：`qrcode-generator` 生成配对 SVG。
- `probe-adapter.ts`：只调用探针媒体/音量命令，不保留 PowerShell / playerctl / osascript 回退。

### 安全模型

- LAN 端：token（query/cookie）、可选网卡 CIDR 白名单、可选 HTTPS、Origin 校验、静态路径白名单、64 KiB body 限制。
- 侧边栏端：依赖 DSH `webServer` 的环回访问控制，并额外做 `sameOrigin`。
- 设置与映射文件只存本机；仓库不包含路径、令牌、证书或通知内容。
- 轮换 token 会断开全部 WebSocket；关闭 token 后 `/` 与 `/ws` 不再要求 token，但网卡白名单仍生效。

## 手机端（Svelte）

- 入口：`src/svelte/index.html` → `src/svelte/main.ts` → `App.svelte`。
- Vite `root = src/svelte`，`publicDir = static`，`build.outDir = web`，`assetsDir = assets`，`emptyOutDir = true`，`target = es2022`。
- 页面：`HomePage`、`SessionsPage`、`MusicPage`、`PerformancePage`；导航 `Rail`；卡片组件包括时钟、天气、通知、余额、消费、CPU/内存、GPU、温度、番茄钟、会话列表、统计、问题悬浮框（`QuestionSheet`）、Toast、水印等。
- 状态：`state.svelte.ts` 持有 WebSocket 快照与设置；`ws.ts` 负责重连；`media.ts` 做媒体投影；`session-tree.ts` 组装父子会话；`pomodoro.svelte.ts` 计时/提示音；`billing.svelte.ts` 峰谷与节假日；`format.ts` / `weather.ts` / `icons.ts` / `pages.ts` 为纯工具。
- 字体：`@fontsource-variable/inter`、`noto-sans-sc`、`jetbrains-mono` 在构建时由 Vite 打进 `web/assets/`，不依赖手机系统字体；许可见 `web/fonts/LICENSE.txt`。
- 页面顺序/导航位置来自设置；关闭的页面不渲染、不轮询。
- 手机端只读会话；`pushQuestions` 开启后才显示回答入口。

## DSH 侧边栏（React）

- `src/dsh/client` 用 `React.createElement`（`h`）而不是 JSX；模块由 DSH loader 提供 React。
- 入口 `src/dsh/client/index.ts` 向 DSH 注册设置页（slot），菜单包含：连接、偏好设置、番茄钟设置、天气设置、余额显示、通知设置、软件映射、系统信息。
- 所有设置先进入 `DraftState`，点“保存设置”才 `POST /api/settings` 一次性提交；应用改名、主题同步、令牌轮换、断开设备是即时请求。
- 主题：`theme = dsh` 时跟随 DSH 的 `dshTheme`，由 `/api/theme` 同步；也可固定 light/dark。
- 样式集中在 `src/dsh/client/styles.ts`：按 DSH 设置页的 188px 导航、54px 顶栏、卡片分组与 14px 行文字实现，只读取 `--dsw-*` 令牌，不复制宿主颜色值；`--drc-*` 仅为旧版 DSH 缺失令牌提供回退。
- 窗口窄于 767px 时（与样式断点一致）导航由 `matchMedia` 切换为原生 `<select>` 下拉选择器，避免八个横向 tab 无法操作。
- 系统信息页读取 `/api/settings` 的 `capabilities.probe` / `capabilities.node` 与 `diagnostics.profile`：服务状态使用探针后端补充性能/定位能力，并把 Node.js 作为天气链路的详情；`dsh-probe` 版本、探针路径与 Node.js 版本、V8、平台、内存合并到最下面的“诊断信息”卡片，和插件/探针版本、协议、Profile 一起用双列 key-value 排列。

## Rust 原生探针（dsh-probe）

### 架构与二进制

- 唯一 OS 探测层：媒体、音量、性能/GPU/温度、通知、定位。Node 不保留 PowerShell/C#/playerctl/osascript 回退。
- 源码：`src/rust`（Cargo 项目，crate `dsh-probe`，版本 `0.1.0`）。
- 每个功能目录（`media/`、`perf/`、`notifications/`、`volume/`、`location/`）都按同一方式分层：`mod.rs` 只做命令行、JSON 外形和平台模块选择；`windows.rs` / `linux.rs` / `macos.rs` 各自实现完整平台逻辑。平台文件缺失的能力也由该平台文件返回明确错误，不在 `mod.rs` 里写 `cfg` 分支。
- 媒体层在此之上再做 vendor 调度：平台文件识别应用后调用 `vendor::resolve`，命中 vendor 进入对应客户端逻辑，未命中才回到系统 API。
- 产物：`native/bin/<platform>-<arch>/dsh-probe[.exe]`，例如 `win32-x64`、`linux-x64`、`darwin-arm64`。
- `src/dsh/lib/probe.ts` 按 `process.platform` / `process.arch` 定位，`DSH_RC_PROBE` 可覆盖；找不到时所有调用返回明确的“不可用”错误。
- 每条命令输出一行 JSON；探针内部错误返回 `{"ok":false,...}` 且退出码 0（便于 Node 读取），参数错误退出码 2。
- `notifications watch`（Linux）是长进程，逐行输出快照，Node 负责重启与冷却。
- 探针支持常驻 `daemon` 模式：Node 通过 stdin/stdout 按行发送命令与接收同一格式的 JSON；daemon 起不来或不支持时自动回退到一次性进程。

### 命令

```text
dsh-probe version
dsh-probe daemon                                  # Host 内部：stdin/stdout 按行请求
dsh-probe media read [--app-id ID] [--player DEST] [--no-thumbnail]
dsh-probe media playpause|next|previous|seek --position SECONDS [--app-id ID] [--player DEST]
dsh-probe media like [--value true|false] [--app-id ID] [--player DEST]   # NetEase CDP
dsh-probe media cdp                                                       # NetEase CDP diagnostics
dsh-probe volume read
dsh-probe volume set --value 0.0..1.0
dsh-probe volume toggle
dsh-probe performance
dsh-probe notifications [--limit 1..20]
dsh-probe notifications watch [--limit 1..20]   # Linux 流式输出
dsh-probe location
dsh-probe location request [--open-settings]    # 申请定位权限（Windows 会打开设置页）
```

`--player DEST` 用于在多个 MPRIS 播放器之间指定目标（Linux 优先复用上次选择，其次正在播放的播放器）。

### 载荷

媒体：

- 基础字段：`appId`、`title`、`artist`、`album`、`albumArtist`、`trackNumber`、`playbackStatus`、`autoRepeatMode`、`shuffleActive`、`position`、`startTime`、`endTime`、`minSeekTime`、`maxSeekTime`、`lastUpdatedAt`；
- 控制：`canPlayPause`、`canNext`、`canPrevious`、`canSeek`；
- 封面：`thumbnail`、`thumbnailType`、`thumbnailError`、`thumbnailUrl`（Linux MPRIS 的 HTTP(S) 封面交给 Node 下载并转 data URL）；
- 来源：`provider`（`system` / `private` / `accessibility`）、`providerDetail`（`smtc`、`smtc-partial`、`mpris`、`nowplaying`、`applescript`、`window-title`、`cider-title`、`window-title+uia`、`cider-title+ax`、`netease-cdp` 等）；
- 网易云：`liked`（`true`/`false`/`null`）、`canLike`、`canSetLiked`、`trackId`。`liked` 只来自 CDP（客户端带远程调试端口启动）；无 CDP 时为 `null`，不读取本地数据库红心。

通知：`available`、`reason`、`source`、`liveOnly`、`notifications[]`（`id`、`appKey`、`appName`、`title`、`body`、`avatar`、`hasImage`、`receivedAt`、`isGroup`）、`apps[]`（`key`、`name`、`count`）、`updatedAt`。Windows 的 `appName` 与 `appKey` 相同（原始应用标识），中文名由 Node 的软件映射生成。

性能：`cpu`（`usage`、`model`、`cores`、`physicalCores`、`speedMhz`、`baseMhz`、`uptime`）、`memory`、`gpu`（`name`、`driver`、`adapters`、`utilization`、`memoryUsed`、`memoryTotal`、`memoryPercent`、`coreClockMhz`、`coreClockMaxMhz`、`memoryClockMhz`、`temperatureCelsius`、`powerPercent`、`fanRpm`）、`temperatures[]`（`name`、`celsius`）、`backend`、`sampledAt`。不支持的字段为 `null`。

位置：`ok`、`available`、`latitude`、`longitude`、`accuracy`、`source`、`error`。

定位权限：`ok`、`available`、`access`（`allowed`/`denied`/`unspecified`/`unknown`）、`allowed`、`lowIntegrity`、`openedSettings`、`reason`（`privacy-denied`/`low-integrity`/`unspecified`/`request-failed`）、`sampledAt`。

### Node 桥

- `probe.ts`：定位二进制、`execFile`、取最后一行 JSON、15 s 失败冷却、`DSH_RC_TMPDIR` 临时目录（默认仓库 `.probe-tmp/`）；优先复用常驻 daemon，启动失败时回退一次性进程。
- `probe-daemon.ts`：常驻探针的启动、按 id 匹配响应、超时、崩溃/退出处理；只读命令可在 daemon 崩溃后重放，写操作不重放。
- `probe-adapter.ts`：只调用 Rust 媒体/音量命令；失败直接返回错误，不静默回退。CDP 封面 URL 保留给控制端浏览器加载，Host 不重复下载。
- `performance.ts`：只用 Rust 载荷；探针缺失时 CPU/内存用 Node 兜底，GPU/温度为空。
- `notifications.ts`：Windows/macOS 一次性，Linux `watch` 长进程。
- `app-mapping.ts`：名称映射；通知与音乐载荷共用。
- `service.ts` 的 `/api/location`：调用 `location request`，成功时清缓存并刷新天气。

环境变量：

| 变量 | 作用 |
|---|---|
| `DSH_RC_PROBE` | 指定自定义 `dsh-probe` 绝对路径 |
| `DSH_RC_DISABLE_RUST_PROBE` | `1` 强制标记探针不可用（测试用） |
| `DSH_RC_TMPDIR` | 覆盖只读 SQLite 副本的临时目录 |
| `DSH_RC_VCVARS` | 覆盖 Windows 构建的 `vcvars64.bat` 路径 |
| `DSH_RC_SKIP_RUST_BUILD` | `1` 跳过 `pnpm install` 中的探针构建 |
| `DSH_RC_NETEASE_CDP_PORT` | 网易云远程调试端口（默认 `2015`；仅在客户端带 `/remote-debugging-port=...` 启动时生效） |
| `DSH_REMOTE_CONTROL_PORT` | 覆盖 LAN 控制台端口（默认 38765） |

### 平台后端

| 能力 | Windows | Linux | macOS |
|---|---|---|---|
| 媒体读取/控制 | vendor-first：网易云 SMTC/CDP 组合、其他已知客户端各自适配 → 未命中时 WinRT SMTC；UI Automation 仅兜底（只读） | vendor-first：已知客户端进入 vendor；网易云 MPRIS+CDP，其他走 MPRIS | vendor-first：已知客户端进入 vendor；网易云 Now Playing/CDP，其他走 `nowplaying-cli`/AppleScript |
| 封面 | SMTC `Thumbnail` 流 → data URL（含 Edge/YouTube）；网易云 SMTC 封面或 CDP 歌曲数据封面 URL（控制端浏览器直接加载并缓存），本地 `Statics` 仅窗口标题兜底 | `file://`/`data:` 直接读取；HTTP(S) 由 Node 下载 | `nowplaying-cli` artwork |
| 音量 | Core Audio `IAudioEndpointVolume` | `wpctl` → `pactl` → `amixer`（Rust 内调用） | `osascript`（Rust 内调用，未测试） |
| 网易云封面/喜欢 | SMTC 开启时封面取 SMTC；CDP-only 时取歌曲数据封面 URL（浏览器直接加载）；红心仅 CDP | 封面取 MPRIS 或 CDP 歌曲数据；红心仅 CDP | 封面取 Now Playing 或 CDP 歌曲数据；红心仅 CDP |
| CPU/内存/频率 | sysinfo + PDH `% Processor Performance` + 注册表 | sysinfo + `/proc/cpuinfo` + cpufreq | sysinfo + `sysctl`（未测试） |
| GPU/温度 | DXGI + PDH GPU 计数器 + WDDM D3DKMT + 磁盘温度 | `nvidia-smi` 或 AMD sysfs + `/sys/class/hwmon` | 不实现 |
| 通知 | 通知中心 SQLite 数据库 | `org.freedesktop.Notifications` D-Bus 监视（zbus） | 通知中心 SQLite 数据库（源码，未测试） |
| 位置 | WinRT Geolocation + `location request` | GeoClue2 | CoreLocation 不适用于无 bundle 的 sidecar，回退 IP |

### Windows 低完整性

Windows 只允许 Medium 完整性及以上的进程访问定位。插件目录被低完整性进程创建时，`dsh-probe.exe` 会继承 Low 标签，WinRT 直接返回 `Denied`。`build-rust.mjs` 会尝试把目录提升到 Medium 并重建 `native/`；父目录为 Low 时需要管理员 `icacls`。面向用户的完整步骤在 [`INSTALLATION.md`](INSTALLATION.md)，代码侧不要移除 `ensureMediumIntegrity()`。

## 媒体适配层

`dsh-probe` 的媒体读取是 **vendor-first**：

1. **识别当前播放软件**（SMTC AUMID / 进程 / MPRIS / bundle id）。
2. **命中 vendor 适配** → 进入 `media/vendor/<client>.rs` 的逻辑：
   - 网易云：SMTC 可用时用其元数据/封面/播放状态/传输控制，CDP 补精确进度和红心；SMTC 完全不可用但 CDP 可用时，CDP 从客户端 store 提供歌曲信息、封面 URL、精确进度、红心和播放控制；两者都不可用时窗口/UIA 兜底，仍取不到就返回空。
   - QQ 音乐、酷狗、酷我、汽水、全民 K 歌、Spotify、Apple Music、YouTube Music：完整系统会话优先（控制与 seek 留在 SMTC/MPRIS），否则窗口标题/Cider/UIA 私有层。
3. **未命中 vendor**（浏览器、未知播放器）→ 直接使用系统媒体接口（Windows SMTC、Linux MPRIS、macOS MediaRemote）。

Windows 平台层只负责识别应用、收集 SMTC/窗口/音频会话并调用 vendor 调度；Linux/macOS 平台层收集 MPRIS/Now Playing 后同样调用 vendor。`vendor::resolve` 接收 `Platform` 和系统媒体，决定最终组合。所有 vendor 都遵循同一模式：私有解析/接口在 `media/vendor/<client>.rs`，平台机制在 `media/`。

**不访问任何外部 Web API。** 封面来自 SMTC `Thumbnail`、MPRIS `mpris:artUrl`、网易云 CDP 歌曲数据里的封面 URL 或本地缓存；歌曲信息不通过网易云/QQ 音乐等网络接口查询。

适配思路参考了 [Widdit/now-playing-service](https://github.com/Widdit/now-playing-service)（MIT）的 `GetMusicStatus` 实现，特别是各客户端的窗口标题修正、音频会话播放状态判断和网易云/全民 K 歌的 UI Automation 进度文本格式；Rust 侧为独立实现。

### 代码结构

- `src/rust/src/media/vendor/<client>.rs`：每个客户端的私有接口/窗口标题解析（`netease.rs` 还包含本地 SQLite 封面/时长缓存与 CDP 的进度、红心、完整媒体/控制桥；`apple_music.rs` 包含 Cider 的 `title.txt`）。vendor 可以直接调用平台模块暴露的系统辅助（如 `platform::system_valid`），不需要复制系统 API 逻辑。
- `src/rust/src/media/catalog.rs`：应用识别、进程/AUMID 映射、进度文本解析、`SmtcPolicy` 和 seek 策略。
- `src/rust/src/media/windows/`：Windows 的 SMTC、窗口/进程枚举、Core Audio 会话状态、UI Automation 文本树扫描。
- `src/rust/src/media/linux.rs` / `macos.rs`：MPRIS / MediaRemote 系统接口及平台相关的无障碍兜底。通用 UIA/AX 扫描留在平台层，因为它是全应用通用的树遍历，不包含单个客户端的业务逻辑。

### 为什么需要分层

同一个客户端在不同版本/系统上暴露的能力并不一致：

- Spotify、Apple Music、YouTube Music、浏览器通常提供完整 SMTC/MPRIS，播放状态、时间轴、封面和 seek 都可用。
- 网易云、QQ 音乐、酷狗、酷我、汽水、全民 K 歌经常只提供部分信息，或者 SMTC 会话存在但播放状态/位置不刷新（只有打开 Windows 媒体浮层才更新）。
- 网易云的 SMTC 提供元数据/播放状态，但不汇报播放进度；部分旧客户端还会「声明可 seek」却不回报真实 `Position`。客户端带 `/remote-debugging-port=2015` 启动时，CDP 从客户端 store 和内部播放进度流提供精确进度、歌曲信息与红心状态/切换；未开启 CDP 时进度回退到窗口标题 / UI Automation 文本，红心不读取本地数据库。

因此适配层先识别播放软件并进入 vendor 策略；vendor 内部决定完整系统会话、私有接口或 CDP 的组合；只有未命中 vendor（浏览器/未知播放器）时才直接使用系统 API。无障碍树只作为 vendor 内部的最后兜底，且永远只读。

### Seek 规则

| 来源 | 进度条展示 | 可拖动 seek |
|---|---|---|
| 完整系统会话 | 是 | **是** |
| CDP-only 页面（SMTC 不存在） | 是 | **否**（只提供进度与播放控制） |
| 系统会话不完整（`smtc-partial`） | 是（若有时长） | 否 |
| 私有接口 | 是（若有时长） | 默认否；仅当适配器显式声明实时可写接口时才是 |
| UI Automation / AX / AT-SPI | 是 | **否** |

判定「完整系统会话」需要同时满足：

- 有标题；
- 播放状态不是 `Closed`；
- `EndTime > StartTime > 0`；
- 播放器允许定位（SMTC `IsPlaybackPositionEnabled` / MPRIS `CanSeek`）；
- 对标记为 `VerifyPosition` 的客户端（部分旧版 QQ/酷狗等）还要求实际收到过非零 `Position`。

Node 侧 `media-enrich.ts` 会再次校验 `provider === 'system'`、时间轴和位置证据；CDP、其他私有/无障碍来源都不会出现可拖动进度条，只有明确可 seek 的系统会话才会保留 seek。

### 各客户端行为

| 客户端 | Windows | Linux | macOS |
|---|---|---|---|
| 网易云音乐 | SMTC 元数据/封面/状态/控制（MetadataOnly）→ CDP 进度/红心；SMTC 不存在且 CDP 可用时 CDP 提供全量信息/封面 URL/播放控制（不授予 seek）；两者都不可用时窗口标题 + UIA；仍无则空 | MPRIS（有效时保留其 seek）+ CDP 进度/红心；MPRIS 不存在时 CDP 全量（不授予 seek） | `nowplaying-cli`/AppleScript（有效时保留控制）+ CDP 进度/红心；系统源不存在时 CDP 全量（不授予 seek） |
| QQ 音乐 | SMTC（需真实位置）→ 窗口标题 | MPRIS | `nowplaying-cli`/AppleScript |
| 酷狗音乐 | SMTC（需真实位置）→ 窗口标题（滚动标题修正） | MPRIS | `nowplaying-cli`/AppleScript |
| 酷我音乐 | SMTC（需真实位置）→ 窗口标题（滚动标题修正） | MPRIS | `nowplaying-cli`/AppleScript |
| 汽水音乐 | SMTC（需真实位置） | MPRIS | `nowplaying-cli`/AppleScript |
| 全民 K 歌 | SMTC（需真实位置）→ 窗口标题 + UIA 进度 | MPRIS | `nowplaying-cli` |
| Spotify | SMTC（可信）→ 窗口标题 | MPRIS | `nowplaying-cli` → AppleScript |
| Apple Music | SMTC（可信）→ Cider `title.txt` | MPRIS | `nowplaying-cli` → AppleScript → Cider `title.txt` → AX 进度 |
| YouTube Music | SMTC（可信，含浏览器桥接） | MPRIS（浏览器/桌面客户端） | `nowplaying-cli`/AppleScript |
| 其他应用/浏览器 | SMTC | MPRIS | `nowplaying-cli`/AppleScript |

「SMTC（需真实位置）」不等于禁用 SMTC，而是：只有该会话真的报告了位置时才把它当作完整系统会话；否则保留可用的 SMTC 元数据，改用私有窗口标题和 UI Automation 补进度，避免出现「进度条永远停在 0 却可以拖动」的假象。

### 载荷字段

除基础媒体字段外，`provider` 为 `system`、`private` 或 `accessibility`；`providerDetail` 为具体实现。Node 侧 `PublicMedia` 同步暴露这两个字段，并将 `timelineSource` 设为 `smtc`/`private`/`accessibility`/`none`，供界面判断「只展示进度」还是「可拖动」。

### 已知限制

- 私有接口通常是只读的：窗口标题只有「歌名/歌手」，没有可靠的暂停状态和进度。播放/暂停优先用 Core Audio 会话状态/峰值判断；静音或独占音频仍可能误判。
- 网易云最新版的 SMTC 只提供元数据/播放状态/控制，不汇报播放进度。适配器将其视为 `MetadataOnly`：SMTC 可用时进度和红心走 CDP；SMTC 完全不可用时若 CDP 可用，歌曲信息/封面/进度/红心/播放控制全部走 CDP，但 CDP 不授予 seek；两者都不可用才退回窗口/UIA，仍取不到返回空。
- Windows 上部分网易云版本用 `Microsoft.AutoGenerated.{GUID}` 作为 SMTC AUMID，而不是 `cloudmusic.exe`。适配器会用当前 CDP store 的标题/歌手与该未知会话匹配，匹配成功后仍进入网易云 vendor 路径，红心和进度不会丢失。
- 网易云/全民 K 歌的 UIA 进度在切歌瞬间可能短暂读不到，此时只展示标题和本地时长（网易云）；不会伪造位置。
- 滚动窗口标题（酷狗/酷我）的修正是启发式的，极端标题（歌名本身含 `-`）可能需要等待客户端刷新标题。
- Linux 的私有层只读取本地客户端数据；受支持的原生客户端都通过 MPRIS 暴露完整信息，因此没有启用 AT-SPI 全树遍历。
- macOS 的 AX 读进度需要给父进程（运行 `dsh-probe` 的终端/DSH）授予「辅助功能」权限；未授权时静默返回无进度。

## 构建与产物

### postinstall

`pnpm install` 在源码根目录执行：

1. `node scripts/build-dsh.mjs`
2. `node scripts/build-web.mjs`
3. `node scripts/build-rust.mjs --optional`

顺序不能反：`build-dsh` 先清理旧的 `index.js`、`client.js`、`lib/`、`.build/`，避免半旧产物。

### build-dsh

- 用 TypeScript 编译器程序化读取 `tsconfig.dsh.json` 和 `tsconfig.dsh-client.json`；
- 输出先写到 `.build/host` 与 `.build/client`，再复制到根目录；
- `index.js` 前置生成标记；`client.js` 把 `.build/client/client/**/*.js` 合并为内部模块表，再包装为 `window.__ModuleLoader__` 工厂（相对 `require` 由模块表解析，裸模块交给 loader）；
- 最后用 `terser` 压缩 `index.js`、`client.js` 和 `lib/**/*.js`；Host/lib 按 ESM 处理，`client.js` 按 classic script 处理，压缩后再补生成标记；
- 任何编译诊断都会以非零退出，不会写入半成品（先 clean 再写）。

### build-web

- `build-web.mjs` 直接 `import { build } from 'vite'`，不依赖 `node_modules/.bin`；
- 配置见 `vite.config.js`：root `src/svelte`、publicDir `static`、outDir `web`、assetsDir `assets`、`emptyOutDir: true`、target `es2022`、无 sourcemap；
- 字体、天气图标、manifest、图标随构建复制/打包。

### build-rust

- 目标三元组决定输出目录；`--target` 可交叉指定；
- `--optional` 供 postinstall 使用：没有 cargo 时警告并以 0 退出；
- `--skip-build` 只复制已存在的产物；
- Windows 自动查找并加载 `vcvars64.bat`（`DSH_RC_VCVARS` 可覆盖）；
- Windows 构建后执行 `ensureMediumIntegrity()` 修复 Low 标签；
- 产物目录 `native/bin/<platform>-<arch>/`，不提交。

### 生成物清单

| 生成物 | 来源 | 用途 |
|---|---|---|
| `index.js` | `src/dsh/index.ts` | Host 入口 |
| `lib/**/*.js` | `src/dsh/lib` | Host 逻辑 |
| `client.js` | `src/dsh/client`（合并） | DSH 侧边栏模块 |
| `web/` | `src/svelte` + `static/` | 手机端页面与资源 |
| `native/bin/<platform>-<arch>/dsh-probe` | `src/rust` | 系统探针 |

## 测试与 CI

### 本地检查

```powershell
pnpm check                      # tsc（Host + 浏览器端）+ svelte-check
pnpm build                      # src/dsh + src/svelte
pnpm test                       # 下面 8 个 Node 测试
node test/smoke.mjs
node test/media-progress.mjs
node test/probe-bridge.mjs
node test/probe-daemon.mjs
node test/notifications.mjs
node test/notification-watch.mjs
node test/app-mapping.mjs
node test/questions.mjs
cargo fmt --manifest-path src/rust/Cargo.toml -- --check
cargo test --manifest-path src/rust/Cargo.toml
cargo check --manifest-path src/rust/Cargo.toml --features macos-check
pnpm build:rust
```

测试覆盖：

- `smoke.mjs`：临时 `DSH_PROFILE_DIR` 启动服务，检查令牌页面、`/assets/`、WebSocket welcome/overview，确认旧 HTTP overview 路由不存在；
- `media-progress.mjs`：进度平滑与 seek 规则；
- `probe-bridge.mjs`：探针缺失时媒体/音量/运行时能力返回错误状态，且没有静默回退；
- `probe-daemon.mjs`：真实二进制 daemon 的 version/performance/volume 请求、并发请求、关闭后重启与禁用开关，以及 `dsh-probe` 版本/平台后端能力；
- `notifications.mjs`：字段归一化、数量限制、应用聚合、探针缺失载荷；
- `notification-watch.mjs`：假探针验证 Linux 流式监视逐行解析；
- `app-mapping.mjs`：默认名称/自动推导、来源记录、改名/恢复默认、持久化、旧缓存迁移；
- `questions.mjs`：推送问询开关、会话快照问题内容、远程回答 WebSocket 往返、关闭后剥离与拒绝。

### CI

`.github/workflows/checks.yml`，仅在 `push` 时运行，单个 Ubuntu job：

- 固定 Node `26.7.0`、pnpm `12.8.1`、Rust `1.99.1`（含 rustfmt）；
- 缓存 cargo registry（key 为 `src/rust/Cargo.lock` 哈希）；
- 步骤：`pnpm ci`（`DSH_RC_SKIP_RUST_BUILD=1`）→ `pnpm check` → `pnpm build` → `pnpm test` → `node scripts/build-rust.mjs` → `cargo fmt --all -- --check` → `cargo check --all-targets` → `cargo test --all-targets`；
- Windows/macOS 行为仍以本地验证为准；macOS 目前没有 CI。

## 平台矩阵

- **Windows**：Rust SMTC + Core Audio + DXGI/PDH/WDDM D3DKMT 性能 + 磁盘温度 + 通知中心数据库 + WinRT Geolocation；无 PowerShell/C# 回退。
- **Linux**：Rust MPRIS（zbus）、`wpctl`/`pactl`/`amixer` 音量、sysinfo + `/proc` + sysfs/hwmon 性能、D-Bus 通知监视、GeoClue2 位置。
- **macOS**：Rust 媒体/音量/性能/通知源码（`nowplaying-cli`/AppleScript/通知数据库），未实机验证；GPU/温度不实现；位置回退 IP。
- **手机端**：现代浏览器，WebSocket 可用；布局优先 1280×800 横屏，竖屏为紧凑降级。

已验证环境（旧记录，新增改动需重新验证）：

- Windows 11 26H2（build 26300，x86_64-pc-windows-msvc，Rust 1.99.1）：构建/测试通过；SMTC 媒体与控制、SMTC 封面（Edge/YouTube，data URL）、Core Audio 音量、DXGI/PDH + WDDM D3DKMT GPU（RX 7800 XT：核心频率 1.5 GHz、显存频率 2.4 GHz、46 °C）、两块 NVMe/SATA 磁盘温度（57 °C / 46 °C）、通知中心（含头像）、WinRT 位置调用与 `location request` 均验证。
- Fedora 45 KDE（x86_64，Rust 1.99.1）：构建/测试通过；MPRIS、wpctl 音量、sysinfo/温度、GeoClue2 位置、`notify-send` → D-Bus 通知监视均返回有效数据。
- macOS 未测试。

## 已知缺口与限制

- Rust 探针需要在目标机器上构建；仓库不包含二进制。未构建时不会回退 JavaScript 探针，媒体/音量/性能/通知会显示“探针不可用”。
- Windows 的 CPU 温度只能来自 ACPI 热区；主板不暴露时温度栏显示「未提供」，GPU/磁盘温度不受影响。未接入 LibreHardwareMonitor/OpenHardwareMonitor 内核驱动。
- Windows 位置需要系统隐私授权；`location request` 被拒绝时会打开「位置」设置页。低完整性工作区会永久拒绝定位，需按 `INSTALLATION.md` 修复。
- Linux 只读取 NVIDIA（`nvidia-smi`）和 AMD（sysfs）GPU；Intel 核显不显示利用率。温度取决于 `hwmon`；通知监视依赖 D-Bus `BecomeMonitor` 权限，部分加固系统会拒绝。
- macOS 媒体/音量/性能/通知/位置均为源码级实现，未测试；GPU/温度不实现；CoreLocation 不适用于无 bundle 的 sidecar；AX 进度需要辅助功能权限。
- NetEase 本地数据库 schema 随客户端版本变化；匹配不到曲目时封面/时长为空，不伪造。
- 私有层（窗口标题/Cider 标题文件）只读：可展示歌曲与进度，但不提供播放/暂停/切歌/seek 控制；控制仍依赖完整 SMTC/MPRIS。例外是网易云 CDP：SMTC 不存在时它从客户端 store 提供全量媒体、封面 URL 和播放控制，但**不授予 seek**；SMTC 存在时只补进度/红心。播放/暂停用 Core Audio 会话状态/峰值判断，系统静音或独占音频时可能误判。
- UI Automation（Windows）与 AX（macOS）只用于补齐只读进度，永远不授予 seek；Windows UIA 每次读取有 800 ms 超时，macOS AX 有 1.5 s 超时；切歌瞬间读不到进度时只展示标题。
- 酷狗/酷我的滚动窗口标题使用启发式修正，歌名本身含 `-` 等极端标题可能解析不完美；Linux 原生客户端由 MPRIS 覆盖。
- SMTC 封面依赖播放器暴露缩略图。SMTC 开启时网易云封面只取 SMTC；CDP-only 时把歌曲数据封面 URL 交给控制端浏览器直接加载并缓存；本地 `Statics` 缓存仅供窗口标题兜底路径。
- 无系统 API、无 vendor 私有接口、无 UI Automation 时，`media read` 返回 `ok: true, available: true, media: null`（空媒体）；Node 清空媒体卡，不伪造占位信息。
- 网易云 CDP 的歌曲标题/歌手/专辑/时长/播放状态/进度来自客户端 store 与内部 audio progress 流，不依赖页面 DOM；只有红心按钮（store 不暴露）使用 DOM，并按可见按钮选择以适配迷你、展开和评论区布局。
- 会话页只读；媒体和音量可写；开启「推送问询」后才能远程回答用户问题。
- 「推送问询」默认关闭；只支持 DSH 正常的用户问题（`ask_user_question`），工具审批仍需在 DSH 中处理。远程回答后 DSH 自己的提问卡片可能需要手动关闭。
- 手机端布局优先保证 1280×800 横屏；竖屏使用紧凑降级布局。
- 构建产物不入库、不发布 npm；安装必须从 GitHub 源码构建后用 `link:` 注册。

## 开发约定

- 改 `src/dsh`、`src/svelte` 或 `static/` 后必须重新构建；不要在提交中带 `index.js`、`client.js`、`lib/`、`web/`、`native/bin/`。
- 不要在 `src/dsh/lib` 里重新引入 PowerShell / C# / playerctl / osascript 回退；探针缺失必须是显式错误状态。
- 新增平台能力时同时更新：Rust 平台模块、`platform` 矩阵、`AGENTS.md` 的载荷/限制、必要时的 `INSTALLATION.md` 依赖说明。
- 新增客户端适配时：在 `media/catalog.rs` 注册 profile，在 `media/vendor/` 加解析，在 `AGENTS.md` 的客户端表补一行；不要在媒体载荷里伪造进度。
- 改设置字段时同时更新：`settings.ts` 的 normalize/default、`src/dsh/client` 的编辑/保存、`README.md` 菜单说明；保持旧 `settings.json` 可迁移。
- 改协议消息时同时更新 `service.ts`、`src/svelte/lib/ws.ts`、本文件的 WebSocket 表。
- 新增文档文件时同步 `package.json` 的 `files`，并按“文档分工”放置内容。
- 提交前至少跑：`pnpm check`、`pnpm build`、`pnpm test`；改 Rust 再跑 `cargo fmt --check`、`cargo test`。

## 许可证

MIT。Inter、Noto Sans SC、JetBrains Mono 使用 SIL Open Font License 1.1（`static/fonts/LICENSE.txt`，构建后 `web/fonts/LICENSE.txt`）。媒体适配层参考的 Widdit/now-playing-service 为 MIT。
