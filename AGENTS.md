# AGENTS.md

本文件面向在本仓库里工作的开发者与 agent。终端用户的功能说明见 [`README.md`](README.md)（中文）与 [`docs/README.en.md`](docs/README.en.md)；安装、更新和排障见 [`INSTALLATION.md`](INSTALLATION.md)。

开工前先记住五条：

1. 这是 **DSH bundle 插件**，不是普通 npm 包；仓库只提交源码，运行产物必须本机构建。
2. `index.js`、`client.js`、`lib/`、`web/`、`native/bin/` 都是生成物，不要手改，也不要提交。
3. 不发布 npm 包。不要添加发布步骤，也不要在文档里引导 `github:` 或仓库 URL 直接安装。
4. Rust 探针是唯一的 OS 探测层。Node 侧不再引入 PowerShell / C# / playerctl / osascript 回退，探针缺失必须是显式错误状态。
5. 用户可见文案必须进对应的 i18n 字典，不写死中文。

## 文档分工

| 文件 | 负责内容 |
|---|---|
| `README.md` | 中文用户文档：功能、界面、截图、三步安装摘要 |
| `docs/README.en.md` | 英文用户文档，与 `README.md` 内容同步 |
| `INSTALLATION.md` | 唯一的完整安装指南：前置条件、构建、`link:` 注册、Rust 探针、更新、卸载、故障恢复 |
| `AGENTS.md`（本文件） | 架构、DSH 集成契约、协议、Rust 探针、媒体适配层、构建、测试、CI |

维护约定：

- 功能行为变化同时改两份 README；安装或构建步骤变化改 `INSTALLATION.md`；协议、模块、构建流水线变化改本文件。
- 新增平台、命令、环境变量或限制时，按上表分别更新，不要复制粘贴同一段说明。
- 媒体适配层的完整设计只维护在本文件，不再单独建文档。
- 新增文档文件时同步 `package.json` 的 `files`。

## UI 文案规范

面向终端用户的文字（侧边栏、手机端、README、错误与提示）只回答「这是什么、能做什么、怎么做、有什么限制」，不解释实现方式。

- 只写用户看得见的结果和能做的操作；不写代码路径、模块名、协议名、运行时、数据库、缓存、轮询、归一化、探测、CDP / SMTC / MPRIS / WebSocket / Node.js / Rust 等实现细节。
- 配置项可以写用户需要提供的内容（证书文件、端口、城市、音频文件），但不要解释内部如何处理。
- 提示语尽量一句话；范围和限制只在会影响用户决策时出现，不在 README 里展开机制。
- 错误信息要告诉用户下一步能做什么，不要只抛内部错误名或后端状态。
- 诊断 / 系统信息页可以展示排障需要的版本、路径与平台信息；这些是诊断数据，不是功能说明。
- 新增或修改文案时同步三份字典（侧边栏、Host、手机端），并重新构建对应产物。
- README 只写功能、安装摘要、使用方式、平台支持与已知限制；架构、协议、构建细节放 `AGENTS.md` 与 `INSTALLATION.md`。

## 项目形态

- 名称 `dsh-remote-control`，版本 `1.0.1`，`"private": true`，MIT。
- 运行形态：DSH Desktop / `dsh web` 的 Host 进程内加载的 bundle 插件。
- 一个进程里同时存在四层：
  1. **Host**：`src/dsh`（TypeScript，ESM），编译为 `index.js` + `lib/`；
  2. **DSH 侧边栏**：`src/dsh/client`（React，无 JSX），编译后合并为单个 `client.js`；
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

## 目录

| 路径 | 内容 |
|---|---|
| `locale/` | 插件元信息（`en.json` / `zh.json`） |
| `cordis.patch.yml` | bundle patch：把 `remote-control` 插入 profile 插件树 |
| `scripts/build-{dsh,web,rust}.mjs` | Host / 手机端 / 探针构建 |
| `scripts/mock-preview.py` / `browser-shot.mjs` | 本地演示页与无头验证 |
| `scripts/screenshot-device.sh` / `screenshot-compose.py` | 实机整屏采集与对角/分组合成 |
| `src/dsh/index.ts` | Host 入口（`inject` / `apply`） |
| `src/dsh/client/` | 侧边栏（React，`sections/` 为八个设置节，`types.ts` 为线格式） |
| `src/dsh/lib/` | Host 逻辑：`service` `settings` `sessions` `account` `weather` `media-enrich` `probe*` `notifications` `app-mapping` `i18n` |
| `src/svelte/` | 手机端（Svelte 5 + Tailwind v4，`lib/components/` 为页面与卡片） |
| `src/rust/src/` | 探针：`media/`（catalog + 平台 + vendor）、`perf/`、`notifications/`、`volume/`、`location/` |
| `test/` | 5 个按功能分组的 Node 集成测试 |
| `static/` | Vite 公共资源（图标、manifest、字体许可） |
| `docs/` | 英文 README 与截图 |

生成物 `index.js`、`client.js`、`lib/`、`web/`、`native/bin/`、`.build/`、`.mock-web/`、`.probe-tmp/` 均已 gitignore。

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
- `export async function apply(ctx)`：创建并启动 `createRemoteControlService(ctx, { log })`，用 `ctx.effect()` 注册 `service.dispose()`，在 `ctx.get('webServer')` 上注册侧边栏路由，并记录启动失败、TLS 降级和监听端口。
- 路由是 `kind: 'exact'`，每个路由都用 `ctx.effect()` 注册，插件卸载时自动反注册。

### 侧边栏路由

| 方法 | 路径 | 处理 |
|---|---|---|
| GET | `/dsh-remote-control/api/info` | 服务状态、地址、二维码路径、能力 |
| GET/HEAD | `/dsh-remote-control/qr.svg` | 配对二维码（SVG） |
| GET | `/dsh-remote-control/api/settings` | 设置 + 网卡 + 应用映射 + 诊断 + 能力 |
| POST | `/dsh-remote-control/api/settings` | 批量应用设置 |
| POST | `/dsh-remote-control/api/apps` | 应用改名 / 恢复默认 |
| POST | `/dsh-remote-control/api/location` | 调探针 `location request`，成功则清定位缓存 |
| GET | `/dsh-remote-control/api/geocode?q=` | Open-Meteo 城市检索 |
| POST | `/dsh-remote-control/api/theme` | 同步 DSH 明暗主题 |
| POST | `/dsh-remote-control/api/locale` | 同步 DSH 当前语言 |
| POST | `/dsh-remote-control/api/token/rotate` | 轮换令牌并断开所有设备 |
| POST | `/dsh-remote-control/api/disconnect` | 按客户端 id 断开设备 |

这些路由挂在 DSH 的 `webServer` 上，继承其访问控制；所有写接口额外校验 `Origin` 与 `Host` 一致（`sameOrigin`），不通过返回 403。

### 浏览器模块工厂

`scripts/build-dsh.mjs` 先编译 `src/dsh/client/index.ts` 及其引用的模块为 CommonJS，再把它们编成一个小型模块表，包装为：

```js
window.__ModuleLoader__.load({
  id: 'dsh-remote-control',
  factory(require) {
    /* 内部模块表 + 相对 require 解析，最后返回 client/index.js 的 exports */
  },
});
```

客户端源码仍然只产出一个 `client.js`；`require('react')` 由 DSH 模块加载器提供（裸模块名交给外层 `require`，相对路径由内部模块表解析）。不要改成 ESM `import`，也不要手改生成物。

### 本地化

- 插件元信息：`locale/en.json`、`locale/zh.json`，由 `@deepseek-ai/dsh-client-locale` 注入。
- 三份运行时字典结构一致（每种语言一个扁平 `key -> 文案` 对象 + `DICTS`）：`src/dsh/client/i18n.ts`（侧边栏，`en` 必须覆盖 `zh`）、`src/dsh/lib/i18n.ts`（Host 发给手机端的文案）、`src/svelte/lib/i18n.svelte.ts`（手机端，`en` 用 `Record<keyof typeof zh, string>` 声明，漏译是编译错误）。
- `settings.language` 为 `dsh` / `zh` / `en`，默认 `dsh`。`dsh` 精确匹配 DSH 当前 locale id（`zh`、`en`），未命中（如 `ja`、`zh-CN`）回退英语；`resolveLocale()` 在 Host 与面板各有一份同规则实现。
- 侧边栏 `apply()` 订阅 `ctx.locale` 并 `POST /api/locale` 写入 `settings.dshLocale`；Host 的 `public()` 输出解析后的 `settings.locale`，随 `welcome` / `overview` / `settings` 推给手机端。
- 侧边栏用 `useTranslator()` 渲染；手机端 `applySettings()` 调 `setLocale(settings.locale)`，`t()` 读取 `$state` 中的当前语言。修改文案后必须重新构建 `client.js` / `web/`。

## Host 架构

### 生命周期与设置

- `service.start()`：读取设置、创建适配器、启动 LAN HTTP/HTTPS、启动 WebSocket hub、启动推送循环；`dispose()` 关闭服务器、hub、适配器和定时器。`index.ts` 用 `ctx.effect()` 绑定，DSH 卸载 / 重载插件时自动清理。
- 数据目录：`DSH_PROFILE_DIR/remote-control`（优先）或 `DSH_HOME/remote-control`，否则 `~/.dsh/remote-control`；文件为 `settings.json`（临时文件 + rename 原子写）。
- 当前 schema 版本 `1`，字段包括 token、允许网卡、主题、插件语言（`language` / `dshLocale`）、温度单位、天气、余额、通知、TLS、导航位置、番茄钟与倒计时（互斥，番茄钟分钟允许两位小数、计时四舍五入到秒，倒计时 1–5 个按分/秒填写的预设）、页面顺序 / 开关。
- `normalize()` 对每个字段做白名单 / 范围校验，缺失时回落默认值；`update(patch)` 浅合并 + 嵌套对象合并；令牌 24 字节随机 `base64url`，`rotateToken()` 后由 service 断开所有设备。
- 设置对象不含 token；`/api/info`（以及 `/api/settings` 的 `info`）会带配对 URL 和二维码路径，token 只出现在 URL query 中（客户端另存为 cookie）。

### LAN HTTP 服务

`src/dsh/lib/service.ts`：

- 默认端口 `38765`，可用 `DSH_REMOTE_CONTROL_PORT` 覆盖；绑定 `0.0.0.0`；端口占用时回退随机可用端口。
- 可选 HTTPS：读取 PEM 证书 / 私钥；配置无效时回退 HTTP，并在 `info.tls.error` 报告。
- 静态文件：`web/` 下的页面、`/assets/`、字体、`/manifest.webmanifest`、`/icon.svg`。
- 鉴权：`tokenEnabled` 时，`/`、静态资源和 `/ws` 需要 `?token=` 或 `dsh_rc` cookie；失败返回 401 页面；`/api/pomodoro/sound` 只对已授权页面开放。
- 网卡限制：`allowedInterfaces` 为 null 表示全部；否则按 CIDR 匹配来源 IP，回环地址始终放行。
- 请求体上限 64 KiB；JSON 响应带 `no-store`。
- 媒体 / 音量动作通过 `adapters.media.control()` 发给探针，结果以 `action-result` 回给发起端，然后广播新的 `media` 快照。

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
| `action-result` | 媒体 / 音量动作结果 |
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

- `collectSessions()` 把 DSH 会话投影成手机端结构：标题、cwd、状态、运行起始时间、子代理父子关系、待回答 / 待审批信息、错误。
- `createPendingTracker()` 在 `user-questions/request` 上以 `prepend` 注册处理器，把问题转发给手机端；已超时但仍可回答的 continued 提问通过 `userQuestions.answer(agent, callId, answer)` 提交；从会话日志重建的待处理项通过 `adopt()` 补登记。
- `notifications.pushQuestions` 为 false 时，`sessions` 快照会剥离问题内容和 `answerable`，服务端也拒绝 `answer-question`。
- 远程回答只处理 DSH 的正常用户问题（`ask_user_question`）；工具审批不提供远程按钮，仍需在 DSH 中处理。
- DSH 自己的提问卡片仍会显示，远程回答后可能需要手动关闭，这是 DSH Web 客户端当前行为。

### 其他 Host 服务

- `account.ts`：DSH 账户余额与用量，支持「本周 / 最近 7 天」窗口和低余额标记。
- `weather.ts`：系统定位（Windows WinRT / Linux GeoClue2，经探针）→ IP 定位（ipwho.is）→ 时区兜底；Open-Meteo 预报与城市检索（裸中文市名会补「市」重查）；缓存与清空。
- `performance.ts`：只采用 Rust `performance` 载荷；探针缺失时仅用 `os.cpus()` / `os.totalmem()`。
- `media-enrich.ts`：统一媒体字段、`provider` / `providerDetail`、进度平滑和 seek 判定。
- `notifications.ts`：Windows/macOS 一次性读取；Linux 启动 `notifications watch` 长进程并按行更新；字段归一化、应用筛选与数量限制在 Node 侧。
- `app-mapping.ts`：应用历史 + 默认名称 + 用户改名 + 旧 `notification-cache.json` 迁移；`/api/apps` 写接口。
- `qr.ts`：`qrcode-generator` 生成配对 SVG。

### 安全模型

- LAN 端：token（query / cookie）、可选网卡 CIDR 白名单、可选 HTTPS、Origin 校验、静态路径白名单、64 KiB body 限制；CSP 的 `img-src` 允许 http(s) 远程封面 / 头像。
- 侧边栏端：依赖 DSH `webServer` 的环回访问控制，并额外做 `sameOrigin`。
- 设置与映射文件只存本机；仓库不包含路径、令牌、证书或通知内容。
- 轮换 token 会断开全部 WebSocket；关闭 token 后 `/` 与 `/ws` 不再要求 token，但网卡白名单仍生效。

## 手机端（Svelte）

- 入口：`src/svelte/index.html` → `src/svelte/main.ts` → `App.svelte`。
- Vite `root = src/svelte`，`publicDir = static`，`build.outDir = web`，`assetsDir = assets`，`emptyOutDir = true`，`target = es2022`。
- 技术栈：Svelte 5 runes + Vite 8 + Tailwind CSS v4 + shadcn-svelte（bits-ui）+ Lucide。图标一律使用 Lucide。
- 页面：`HomePage`、`SessionsPage`、`MusicPage`、`PerformancePage`；导航 `Rail`；业务组件包括时钟、天气、通知、余额、消费、CPU/内存、GPU、温度、计时、会话列表、问询对话框（`QuestionSheet`）、Toast 等。
- 状态：`state.svelte.ts` 持有 WebSocket 快照与设置；`ws.ts` 负责重连；`media.ts` 做媒体投影；`session-tree.ts` 组装父子会话；`pomodoro.svelte.ts` / `countdown.svelte.ts` 各自持有计时并共用 `timer-alarm.svelte.ts`（页面标题 / favicon 提示与 `tabAlert` 响应式状态，主页 tab 复用它显示绿色提示点）；`billing.svelte.ts` 负责峰谷与节假日；`format.ts` / `weather.ts` / `pages.ts` 为纯工具。
- i18n：`applySettings()` 从 `settings.locale` 调 `setLocale()`；所有组件和 `format.ts` / `weather.ts` 通过 `t()` 取文案，日期格式化使用 `localeTag()`，切换语言无需刷新。`zh` 为基准字典。
- 视觉：`Panel` 包装 shadcn Card 作为统一容器；按钮、Badge、Slider、Dialog、ScrollArea 优先用 `$lib/components/ui`；只在组件原有 class 上覆盖样式，无 hover 过渡 / 缩放。
- 性能页占用率使用 `RadialGauge` 圆环；右侧温度保留大号最高温度与热区背景列表。
- 音乐封面支持 data URL 和 http(s) URL，用 `<img referrerpolicy="no-referrer">` 渲染并把封面地址加入 CSP `img-src`；后端未返回封面时显示占位，不伪造。
- 音乐进度：`SeekBar.svelte` 视觉同 shadcn Slider，但拖动轨道自行实现，用 100 ms 本地时钟推进以避免快照拉回；松手只提交一次 seek；播放时显示 SVG 正弦波，暂停 / 拖动 / 无时间轴时收平；`canSeek=false` 用只读轨道，无时间轴时固定 100% 并显示 `--:--`。
- 分页：每页 `scroll-snap-stop: always`，一次手势最多前进 / 后退一页；页面顺序与开关来自设置，关闭的页面不渲染、不轮询。
- 字体：`@fontsource-variable/inter`、`noto-sans-sc`、`jetbrains-mono` 由 Vite 打进 `web/assets/`，不依赖手机系统字体；许可见 `web/fonts/LICENSE.txt`。
- 手机端只读会话；`pushQuestions` 开启后才显示回答入口。

## DSH 侧边栏（React）

- `src/dsh/client` 用 `React.createElement`（`h`）而不是 JSX；React 由 DSH loader 提供。
- 入口 `src/dsh/client/index.ts` 向 DSH 注册设置页（slot），菜单包含：连接、偏好设置、番茄钟 / 倒计时、天气设置、余额显示、通知设置、软件映射、系统信息。
- 所有设置先进入 `DraftState`，点「保存设置」才 `POST /api/settings` 一次性提交；应用改名、主题同步、令牌轮换、断开设备是即时请求。
- 偏好设置的第一个设置组是 **插件语言**（跟随 DSH / 简体中文 / English）；保存后 `hydrate()` 调 `setPluginLanguage()` 立即重绘，Host 同时把解析后的 `locale` 推给手机端。
- 主题：`theme = dsh` 时跟随 DSH 的 `dshTheme`，由 `/api/theme` 同步；也可固定 light/dark。
- 样式集中在 `src/dsh/client/styles.ts`：按 DSH 设置页的 188px 导航、54px 顶栏、卡片分组与 14px 行文字实现，只读取 `--dsw-*` 令牌，不复制宿主颜色值；`--drc-*` 仅为旧版 DSH 缺失令牌提供回退。
- 窗口窄于 767px 时导航由 `matchMedia` 切换为原生 `<select>`。
- 系统信息页读取 `/api/settings` 的 `capabilities.probe` / `capabilities.node` 与 `diagnostics.profile`，把探针版本、路径、Node.js 版本、V8、平台、内存合并到「诊断信息」卡片。

## Rust 原生探针（dsh-probe）

### 架构与二进制

- 唯一 OS 探测层：媒体、音量、性能 / GPU / 温度、通知、定位。Node 不保留 PowerShell / C# / playerctl / osascript 回退。
- 源码 `src/rust`（crate `dsh-probe`，版本 `1.0.1`）。每个功能目录（`media/`、`perf/`、`notifications/`、`volume/`、`location/`）都按同一方式分层：`mod.rs` 只做命令行、JSON 外形和平台模块选择；`windows.rs` / `linux.rs` / `macos.rs` 各自实现完整平台逻辑。缺失能力由平台文件返回明确错误，不在 `mod.rs` 里写 `cfg` 分支。
- 媒体层在平台层之上做 vendor 调度：平台文件识别应用后调用 `vendor::resolve`，命中 vendor 进入对应客户端逻辑，未命中才回到系统 API。
- 产物：`native/bin/<platform>-<arch>/dsh-probe[.exe]`，例如 `win32-x64`、`linux-x64`、`darwin-arm64`。
- `src/dsh/lib/probe.ts` 按 `process.platform` / `process.arch` 定位，`DSH_RC_PROBE` 可覆盖；找不到时所有调用返回明确的「不可用」错误。
- 每条命令输出一行 JSON；探针内部错误返回 `{"ok":false,...}` 且退出码 0（便于 Node 读取），参数错误退出码 2。
- `notifications watch`（Linux）是长进程，逐行输出快照，Node 负责重启与冷却。
- 支持常驻 `daemon` 模式：Node 通过 stdin/stdout 按行发送命令与接收同一格式 JSON；daemon 起不来或不支持时回退一次性进程。

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

- 媒体：基础字段（`appId`、`title`、`artist`、`album`、`albumArtist`、`trackNumber`、`playbackStatus`、`autoRepeatMode`、`shuffleActive`、`position`、`startTime` / `endTime`、`minSeekTime` / `maxSeekTime`、`lastUpdatedAt`）、控制位（`canPlayPause` / `canNext` / `canPrevious` / `canSeek`）、封面（`thumbnail`、`thumbnailType`、`thumbnailError`、`thumbnailUrl`）、来源（`provider` / `providerDetail`）与网易云 `liked` / `canLike` / `canSetLiked` / `trackId`。
- 通知：`available`、`reason`、`source`、`liveOnly`、`notifications[]`（`id`、`appKey`、`appName`、`title`、`body`、`avatar`、`hasImage`、`receivedAt`、`isGroup`）、`apps[]`、`updatedAt`。Windows 的 `appName` 与 `appKey` 相同，中文名由 Node 映射生成。
- 性能：`cpu`（`usage`、`model`、`cores`、`physicalCores`、`speedMhz`、`baseMhz`、`uptime`）、`memory`、`gpu`（`name`、`driver`、`adapters`、`utilization`、`memoryUsed` / `memoryTotal` / `memoryPercent`、核心 / 显存频率、`temperatureCelsius`、`powerPercent`、`fanRpm`）、`temperatures[]`、`backend`、`sampledAt`；不支持的字段为 `null`。
- 位置：`ok`、`available`、`latitude`、`longitude`、`accuracy`、`source`、`error`；权限载荷另含 `access`、`allowed`、`lowIntegrity`、`openedSettings`、`reason`。

### Node 桥与环境变量

- `probe.ts`：定位二进制、`execFile`、取最后一行 JSON、15 s 失败冷却、`DSH_RC_TMPDIR` 临时目录（默认仓库 `.probe-tmp/`）；优先复用常驻 daemon，启动失败回退一次性进程。
- `probe-daemon.ts`：daemon 启动、按 id 匹配响应、超时、崩溃 / 退出处理；只读命令可在崩溃后重放，写操作不重放。
- `probe-adapter.ts`：只调用 Rust 媒体 / 音量命令，失败直接返回错误，不静默回退；CDP 封面 URL 保留给控制端浏览器加载。
- `performance.ts` / `notifications.ts` / `app-mapping.ts`：见上文 Host 服务。
- `service.ts` 的 `/api/location`：调用 `location request`，成功时清缓存并刷新天气。

| 变量 | 作用 |
|---|---|
| `DSH_RC_PROBE` | 指定自定义 `dsh-probe` 绝对路径 |
| `DSH_RC_DISABLE_RUST_PROBE` | `1` 强制标记探针不可用（测试用） |
| `DSH_RC_TMPDIR` | 覆盖只读 SQLite 副本的临时目录 |
| `DSH_RC_VCVARS` | 覆盖 Windows 构建的 `vcvars64.bat` 路径 |
| `DSH_RC_SKIP_RUST_BUILD` | `1` 跳过 `pnpm install` 中的探针构建 |
| `DSH_RC_NETEASE_CDP_PORT` | 网易云远程调试端口（默认 `2015`） |
| `DSH_REMOTE_CONTROL_PORT` | 覆盖 LAN 控制台端口（默认 `38765`） |

### 平台后端

| 能力 | Windows | Linux | macOS |
|---|---|---|---|
| 媒体读取 / 控制 | vendor-first → 未命中时 WinRT SMTC；UIA 仅只读兜底 | vendor-first；网易云 MPRIS+CDP，其他 MPRIS | vendor-first；`nowplaying-cli` / AppleScript |
| 封面 | SMTC `Thumbnail` → data URL；网易云 SMTC 或 CDP URL | `file://` / `data:` 直接读取；HTTP(S) 由 Node 下载 | `nowplaying-cli` artwork |
| 音量 | Core Audio | `wpctl` → `pactl` → `amixer` | `osascript`（未测试） |
| CPU / 内存 / 频率 | sysinfo + PDH + 注册表 | sysinfo + `/proc` + cpufreq | sysinfo + `sysctl`（未测试） |
| GPU / 温度 | DXGI + PDH + WDDM D3DKMT + 磁盘温度 | `nvidia-smi` 或 AMD sysfs + hwmon | 不实现 |
| 通知 | 通知中心 SQLite | `org.freedesktop.Notifications` D-Bus 监视（zbus） | 通知中心 SQLite（未测试） |
| 位置 | WinRT Geolocation | GeoClue2 | 回退 IP |

### Windows 低完整性

Windows 只允许 Medium 完整性及以上的进程访问定位。插件目录被低完整性进程创建时，`dsh-probe.exe` 会继承 Low 标签，WinRT 直接返回 `Denied`。`build-rust.mjs` 会尝试把目录提升到 Medium 并重建 `native/`；父目录为 Low 时需要管理员 `icacls`。面向用户的步骤在 [`INSTALLATION.md`](INSTALLATION.md)，代码侧不要移除 `ensureMediumIntegrity()`。

## 媒体适配层

`dsh-probe` 的媒体读取是 **vendor-first**：

1. **识别当前播放软件**（SMTC AUMID / 进程 / MPRIS / bundle id）。
2. **命中 vendor 适配** → 进入 `media/vendor/<client>.rs` 的逻辑：网易云在 SMTC 可用时用其元数据 / 封面 / 播放状态 / 传输控制，CDP 补精确进度和红心；SMTC 完全不可用但 CDP 可用时，CDP 从客户端 store 提供歌曲信息、封面 URL、精确进度、红心和播放控制；两者都不可用时窗口 / UIA 兜底，仍取不到就返回空。其他客户端完整系统会话优先，否则窗口标题 / Cider / UIA 私有层。
3. **未命中 vendor**（浏览器、未知播放器）→ 直接使用系统媒体接口（Windows SMTC、Linux MPRIS、macOS MediaRemote）。

**不访问任何外部 Web API。** 封面来自 SMTC `Thumbnail`、MPRIS `mpris:artUrl`、网易云 CDP 歌曲数据里的封面 URL 或本地缓存；歌曲信息不通过网易云 / QQ 音乐等网络接口查询。

适配思路参考 [Widdit/now-playing-service](https://github.com/Widdit/now-playing-service)（MIT）的 `GetMusicStatus` 实现；Rust 侧为独立实现。

### 代码结构

- `src/rust/src/media/vendor/<client>.rs`：每个客户端的私有接口 / 窗口标题解析（`netease.rs` 还包含本地 SQLite 封面 / 时长缓存与 CDP 的进度、红心、完整媒体 / 控制桥；`apple_music.rs` 包含 Cider 的 `title.txt`）。vendor 可以直接调用平台模块暴露的系统辅助。
- `src/rust/src/media/catalog.rs`：应用识别、进程 / AUMID 映射、进度文本解析、`SmtcPolicy` 和 seek 策略。
- `src/rust/src/media/windows/`：SMTC、窗口 / 进程枚举、Core Audio 会话状态、UI Automation 文本树扫描。
- `src/rust/src/media/linux.rs` / `macos.rs`：MPRIS / MediaRemote 系统接口及平台相关的无障碍兜底。通用 UIA/AX 扫描留在平台层。

### Seek 规则

| 来源 | 进度条展示 | 可拖动 seek |
|---|---|---|
| 完整系统会话 | 是 | **是** |
| CDP-only 页面（SMTC 不存在） | 是 | **否**（只提供进度与播放控制） |
| 系统会话不完整（`smtc-partial`） | 是（若有时长） | 否 |
| 私有接口 | 是（若有时长） | 默认否；仅当适配器显式声明实时可写接口时才是 |
| UI Automation / AX / AT-SPI | 是 | **否** |

判定「完整系统会话」需要同时满足：有标题；播放状态不是 `Closed`；`EndTime > StartTime > 0`；播放器允许定位（SMTC `IsPlaybackPositionEnabled` / MPRIS `CanSeek`）；对标记为 `VerifyPosition` 的客户端（部分旧版 QQ / 酷狗等）还要求实际收到过非零 `Position`。

Node 侧 `media-enrich.ts` 会再次校验 `provider === 'system'`、时间轴和位置证据；CDP、其他私有 / 无障碍来源都不会出现可拖动进度条。

### 各客户端行为

| 客户端 | Windows | Linux | macOS |
|---|---|---|---|
| 网易云音乐 | SMTC 元数据 / 封面 / 状态 / 控制 → CDP 进度 / 红心；CDP-only 时 CDP 提供全量信息 / 封面 URL / 播放控制（不授予 seek）；否则窗口标题 + UIA | MPRIS（有效时保留 seek）+ CDP 进度 / 红心；MPRIS 不存在时 CDP 全量（不授予 seek） | `nowplaying-cli` / AppleScript + CDP 进度 / 红心；系统源不存在时 CDP 全量（不授予 seek） |
| QQ 音乐 | SMTC（需真实位置）→ 窗口标题 | MPRIS | `nowplaying-cli` / AppleScript |
| 酷狗 / 酷我 | SMTC（需真实位置）→ 窗口标题（滚动标题修正） | MPRIS | `nowplaying-cli` / AppleScript |
| 汽水音乐 | SMTC（需真实位置） | MPRIS | `nowplaying-cli` / AppleScript |
| 全民 K 歌 | SMTC（需真实位置）→ 窗口标题 + UIA 进度 | MPRIS | `nowplaying-cli` |
| Spotify | SMTC（可信）→ 窗口标题 | MPRIS | `nowplaying-cli` → AppleScript |
| Apple Music | SMTC（可信）→ Cider `title.txt` | MPRIS | `nowplaying-cli` → AppleScript → Cider → AX 进度 |
| YouTube Music | SMTC（可信，含浏览器桥接） | MPRIS | `nowplaying-cli` / AppleScript |
| 其他应用 / 浏览器 | SMTC | MPRIS | `nowplaying-cli` / AppleScript |

「SMTC（需真实位置）」表示只有会话真的报告了位置时才当作完整系统会话；否则保留可用的 SMTC 元数据，改用私有窗口标题和 UIA 补进度，避免「进度条停在 0 却可以拖动」。

Node 侧 `PublicMedia` 同步暴露 `provider` / `providerDetail`，并将 `timelineSource` 设为 `smtc` / `private` / `accessibility` / `none`，供界面判断只展示进度还是可拖动。

## 构建与产物

### postinstall

`pnpm install` 在源码根目录执行：

1. `node scripts/build-dsh.mjs`
2. `node scripts/build-web.mjs`
3. `node scripts/build-rust.mjs --optional`

顺序不能反：`build-dsh` 先清理旧的 `index.js`、`client.js`、`lib/`、`.build/`，避免半旧产物。

### build-dsh

- 程序化读取 `tsconfig.dsh.json` 与 `tsconfig.dsh-client.json`，先输出到 `.build/host` / `.build/client`，再复制到根目录。
- `index.js` 加生成标记；`client.js` 合并为内部模块表，包装成 `window.__ModuleLoader__` 工厂。
- `terser` 压缩 `index.js`、`client.js`、`lib/**/*.js`；Host/lib 按 ESM、`client.js` 按 classic script。编译诊断非零退出，不写半成品。

### build-web

- 直接 `import { build } from 'vite'`，不依赖 `node_modules/.bin`。
- `vite.config.js`：root `src/svelte`、publicDir `static`、outDir `web`、assetsDir `assets`、`emptyOutDir: true`、target `es2022`、无 sourcemap；字体 / manifest / 图标随构建打包。

### build-rust

- 目标三元组决定输出目录，`--target` 可交叉指定；`--optional` 在没有 cargo 时警告并以 0 退出；`--skip-build` 只复制已有产物。
- Windows 自动加载 `vcvars64.bat`（`DSH_RC_VCVARS` 可覆盖），构建后执行 `ensureMediumIntegrity()` 修复 Low 标签。
- 产物输出到 `native/bin/<platform>-<arch>/`，不提交。

### 生成物

`index.js`（Host 入口）、`lib/**/*.js`（Host 逻辑）、`client.js`（侧边栏）、`web/`（手机端）、`native/bin/<platform>-<arch>/dsh-probe`（探针）。

## 测试与 CI

### 本地检查

```powershell
# 手动截图预览（生成带演示数据的页面，可用 ?page=...&sheet=1 打开问询；--locale en 预览英文界面）
python scripts/mock-preview.py --web web --port 4173

# 无头截图（自动启动 mock preview；--timer countdown|pomodoro、--locale en、--click/--settle）
pnpm shot -- --timer countdown --out .mock-web/countdown.png

pnpm check                      # tsc（Host + 浏览器端）+ svelte-check
pnpm build                      # src/dsh + src/svelte
pnpm test                       # 下面 5 个按功能分组的 Node 测试
cargo fmt --manifest-path src/rust/Cargo.toml -- --check
cargo test --manifest-path src/rust/Cargo.toml
cargo check --manifest-path src/rust/Cargo.toml --features macos-check
pnpm build:rust
```

### 测试覆盖

一个测试文件对应一类功能，新增断言优先并入已有文件，不要再按单个特性拆新脚本。

- `smoke.mjs`：临时 `DSH_PROFILE_DIR` 启动服务；令牌页面、`/assets/`、图片 CSP、WebSocket welcome/overview；旧 HTTP overview 路由不存在。
- `questions.mjs`：推送问询开关、远程回答往返、关闭后剥离与拒绝。
- `settings.mjs`：语言精确匹配与回退、`dshLocale` 持久化、Host 字典对齐；倒计时预设与秒级范围、番茄钟两位小数、互斥、公开设置深拷贝。
- `media.mjs`：进度平滑与 seek 规则；探针缺失显式报错；真实 daemon 的并发、重启、禁用与平台能力。探针路径缓存在同一进程内切换时用 `resetProbeCache()`（测试专用）。
- `notifications.mjs`：通知字段归一化与数量限制、应用名称推导与旧缓存迁移、Linux 流式监视。

### 文档截图

文档截图必须是**实机屏幕截图**：把控制台真正显示在目标设备屏幕上，再截取整屏，不要用 headless 浏览器的 `--screenshot` 输出充当 README 截图。截图数据可以用 `mock-preview.py`，但渲染和采集都要发生在实机屏幕上。

| 工具 | 用途 |
|---|---|
| `scripts/mock-preview.py` | 生成带演示数据的预览；`--locale zh/en`、`--theme dark/light`、`--freeze-clock` |
| `scripts/screenshot-device.sh` | 在目标设备上以 kiosk 浏览器显示 URL，再截整屏（KDE 用 Spectacle，wlroots 用 grim，X11 用 ImageMagick `import`） |
| `scripts/screenshot-compose.py` | 把 dark/light 整屏截图按右上→左下对角合成，并输出 `overview.png`、`question.png` 与 `pages/*.png` |

流程：

1. `pnpm build:web`。
2. 启动暗色 / 亮色两个预览（端口与 `--out` 都分开），都加 `--freeze-clock`：
   ```bash
   python scripts/mock-preview.py --web web --out .mock-web/dark  --port 4173 --locale zh --theme dark  --freeze-clock
   python scripts/mock-preview.py --web web --out .mock-web/light --port 4174 --locale zh --theme light --freeze-clock
   ```
   英文换成 `--locale en`，输出目录也换成英文专用目录。
3. 在设备上逐页截两张整屏图：`URL='http://HOST:4173/?page=home' OUT=shots/dark-home.png bash scripts/screenshot-device.sh`；亮色换 `4174`，问题页 URL 加 `&sheet=1`。会话 / 音乐 / 性能同样各截一对。
4. 合成：`python scripts/screenshot-compose.py --input shots --output docs/screenshots/zh`；英文加 `--prefix en-` 并输出到 `docs/screenshots/en`。
5. README 只引用分组后的 `overview.png` 与 `question.png`；分组图里各 tile 之间保留透明间隔。

通过 SSH 在设备上运行时，调用方自己提供会话环境（`XDG_RUNTIME_DIR`、`WAYLAND_DISPLAY`、`DBUS_SESSION_BUS_ADDRESS`）。脚本不保存主机名、账号或密码。

`scripts/browser-shot.mjs`（`pnpm shot`）用 `playwright-core` 驱动本机 Edge/Chrome：默认启动 `mock-preview.py`、打开 `?page=home`，截图到 `.mock-web/<page>-<timer>-<locale>.png`。常用参数 `--timer`、`--locale`、`--width` / `--height`、`--out`、`--click`、`--settle`、`--url`；浏览器按 `--browser` / `DSH_BROWSER_PATH` / 常见路径 / Playwright channel 查找。仅本地验证，不进 CI，也不能作为文档截图。

### CI

`.github/workflows/checks.yml`，仅在 `push` 时运行，单个 Ubuntu job：

- 固定 Node `26.7.0`、pnpm `12.8.1`、Rust `1.99.1`（含 rustfmt）；
- 缓存 cargo registry（key 为 `src/rust/Cargo.lock` 哈希）；
- 步骤：`pnpm ci`（`DSH_RC_SKIP_RUST_BUILD=1`）→ `pnpm check` → `pnpm build` → `pnpm test` → `node scripts/build-rust.mjs` → `cargo fmt --all -- --check` → `cargo check --all-targets` → `cargo test --all-targets`；
- Windows / macOS 行为仍以本地验证为准；macOS 目前没有 CI。

## 已知限制

面向用户的限制见 [`README.md`](README.md#已知限制)。实现上还要记住：探针必须在目标机构建，缺失时显式报「探针不可用」；Windows 定位受低完整性限制；私有层与 UIA / AX 永远不授予 seek，网易云 CDP 也不授予 seek；CDP 依赖页面 webpack runtime，刷新后可能回退到播放条 DOM；番茄钟 / 倒计时只在手机浏览器运行。

## 开发约定

- 改 `src/dsh`、`src/svelte` 或 `static/` 后必须重新构建；不要在提交中带 `index.js`、`client.js`、`lib/`、`web/`、`native/bin/`。
- 不要在 `src/dsh/lib` 里重新引入 PowerShell / C# / playerctl / osascript 回退；探针缺失必须是显式错误状态。
- 新增平台能力时同时更新：Rust 平台模块、`平台后端` 矩阵、载荷 / 限制、必要时的 `INSTALLATION.md` 依赖说明。
- 新增客户端适配时：在 `media/catalog.rs` 注册 profile，在 `media/vendor/` 加解析，在本文件客户端表补一行；不要在媒体载荷里伪造进度。
- 改设置字段时同时更新：`settings.ts` 的 normalize / default、`src/dsh/client` 的编辑 / 保存、`README.md` 菜单说明；保持旧 `settings.json` 可迁移。
- 新增或修改用户可见文案时，同时更新三份扁平字典；不要写死中文。
- 改协议消息时同时更新 `service.ts`、`src/svelte/lib/ws.ts` 和本文件的 WebSocket 表。
- 提交前至少跑：`pnpm check`、`pnpm build`、`pnpm test`；改 Rust 再跑 `cargo fmt --check`、`cargo test`。

## 许可证

MIT。Inter、Noto Sans SC、JetBrains Mono 使用 SIL Open Font License 1.1（`static/fonts/LICENSE.txt`，构建后 `web/fonts/LICENSE.txt`）。媒体适配层参考的 Widdit/now-playing-service 为 MIT。
