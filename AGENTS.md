# AGENTS.md

本文件面向在本仓库里工作的开发者与 agent。终端用户的功能说明见 [`README.md`](README.md)（中文）与 [`docs/README.en.md`](docs/README.en.md)；安装、更新和排障见 [`INSTALLATION.md`](INSTALLATION.md)。

开工前先记住五条：

1. 这是 **DSH bundle 插件**，不是普通 npm 包；仓库只提交源码，运行产物必须本机构建。
2. `index.js`、`client.js`、`lib/`、`web/`、`native/bin/` 都是生成物，不要手改，也不要提交。
3. npm 包只由 `.github/workflows/publish-npm.yml` 在推版本标签时发布；不要在本机手工 `npm publish`，不要在清单里加安装脚本（`preinstall` / `install` / `postinstall` / `prepare`），也不要在文档里引导 `github:` 或仓库 URL 直接安装。
4. Rust 探针是唯一的 OS 探测层。Node 侧不再引入 PowerShell / C# / playerctl / osascript 回退，探针缺失必须是显式错误状态。
5. 用户可见文案必须进对应的 i18n 字典，不写死中文。

## 文档分工

| 文件 | 负责内容 |
|---|---|
| `README.md` | 中文用户文档：功能、界面、截图、安装摘要（优先引导用户让 agent 代装并构建本机组件，手动安装指向 `INSTALLATION.md`） |
| `docs/README.en.md` | 英文用户文档，与 `README.md` 内容同步 |
| `INSTALLATION.md` | 唯一的完整安装指南：npm 安装与源码安装、前置条件、构建、`link:` 注册、Rust 探针、更新、卸载、故障恢复 |
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

- 名称 `@ohmykreee/dsh-remote-control`，版本 `1.0.9`，MIT；npm 包由 CI 发布，bundle 行的 `name` 与 `client.js` 的工厂 id 都必须等于这个包名。
- 运行形态：DSH Desktop / `dsh web` 的 Host 进程内加载的 bundle 插件。
- 一个进程里同时存在四层：
  1. **Host**：`src/dsh`（TypeScript，ESM），编译为 `index.js` + `lib/`；
  2. **DSH 侧边栏**：`src/dsh/client`（React，无 JSX），编译后合并为单个 `client.js`；
  3. **手机端**：`src/svelte`（Svelte 5 + Vite），编译为 `web/`；
  4. **原生探针**：`src/rust`（Cargo），编译为 `native/bin/<platform>-<arch>/dsh-probe[.exe]`。
- 目标平台：Windows（完整）、Linux（完整）、macOS（已在 macOS 26 上进行初步测试）；手机端为现代浏览器。
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
| `scripts/check-npm-package.mjs` | 发布前校验：清单策略、构建产物、版本 / 标签一致、tarball 内容 |
| `.github/workflows/` | `checks.yml`（类型检查 + 测试；分支推送 / 手动 / 可复用）、`publish-npm.yml`（推标签发布 npm） |
| `scripts/mock-preview.py` / `browser-shot.mjs` | 本地演示页与无头验证 |
| `scripts/screenshot-device.sh` / `screenshot-compose.py` | 实机整屏采集与对角/分组合成 |
| `src/dsh/index.ts` | Host 入口（`inject` / `apply`） |
| `src/dsh/client/` | 侧边栏（React，`sections/` 为八个设置节，`types.ts` 为线格式） |
| `src/dsh/lib/` | Host 逻辑：`service` `settings` `sessions` `account` `weather.ts` + `weather/`（`open-meteo` / `qweather` / `nmc` / `shared`）`types` `cache` `media-enrich` `probe*` `notifications` `app-mapping` `i18n` |
| `src/svelte/` | 手机端（Svelte 5 + Tailwind v4，`lib/components/` 为页面与卡片） |
| `src/rust/src/` | 探针：`media/`（catalog + 平台 + vendor）、`perf/`、`notifications/`、`volume/`、`location/` |
| `test/` | 6 个按功能分组的 Node 集成测试 |
| `static/` | Vite 公共资源（图标、manifest、字体许可） |
| `docs/` | 英文 README 与截图 |

生成物 `index.js`、`client.js`、`lib/`、`web/`、`native/bin/`、`.build/`、`.mock-web/`、`.probe-tmp/` 均已 gitignore。

## DSH 集成契约

### package.json

```json
{
  "name": "@ohmykreee/dsh-remote-control",
  "publishConfig": { "access": "public", "provenance": true, "registry": "https://registry.npmjs.org/" },
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

清单不写 `"private": true`，也不声明任何安装脚本；`access` / `provenance` / `registry` 属于 npm 发布策略，由 `scripts/check-npm-package.mjs` 在发布前校验。

`cordis.patch.yml` 只做一件事：把 `remote-control` 条目插入 profile 的插件树。`name` 必须是完整包名，DSH 用它在 profile 里解析到这个包。

```yaml
- insert:
    - id: remote-control
      name: '@ohmykreee/dsh-remote-control'
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
| GET/POST | `/dsh-remote-control/api/geocode` | 城市检索；GET 使用已保存的提供商，POST 携带当前编辑中的 provider / 和风天气凭据 |
| POST | `/dsh-remote-control/api/weather/qweather/jwt` | 用设置页当前填写（未保存）的和风天气凭据生成 JWT |
| POST | `/dsh-remote-control/api/weather/qweather/keypair` | 生成首次配置用的 Ed25519 密钥对（私钥返回侧边栏填入，公钥用于控制台） |
| POST | `/dsh-remote-control/api/weather/qweather/sync` | 读取和风天气控制台最近 24 小时统计与尽力获取的本月用量（2 次请求，均计入本地月计数） |
| POST | `/dsh-remote-control/api/weather/refresh` | 桌面侧边栏刷新按钮：重新读取系统位置、绕过地名缓存并刷新天气 |
| POST | `/dsh-remote-control/api/theme` | 同步 DSH 明暗主题 |
| POST | `/dsh-remote-control/api/locale` | 同步 DSH 当前语言 |
| POST | `/dsh-remote-control/api/token/rotate` | 轮换令牌并断开所有设备 |
| POST | `/dsh-remote-control/api/disconnect` | 按客户端 id 断开设备 |

这些路由挂在 DSH 的 `webServer` 上，继承其访问控制；所有写接口额外校验 `Origin` 与 `Host` 一致（`sameOrigin`），不通过返回 403。

### 浏览器模块工厂

`scripts/build-dsh.mjs` 先编译 `src/dsh/client/index.ts` 及其引用的模块为 CommonJS，再把它们编成一个小型模块表，包装为：

```js
window.__ModuleLoader__.load({
  id: '@ohmykreee/dsh-remote-control',
  factory(require) {
    /* 内部模块表 + 相对 require 解析，最后返回 client/index.js 的 exports */
  },
});
```

`id` 由 `build-dsh.mjs` 从 `package.json` 的 `name` 读入（DSH 用包名解析浏览器入口），不要改成手写常量。客户端源码仍然只产出一个 `client.js`；`require('react')` 由 DSH 模块加载器提供（裸模块名交给外层 `require`，相对路径由内部模块表解析）。不要改成 ESM `import`，也不要手改生成物。

### 本地化

- 插件元信息：`locale/en.json`、`locale/zh.json`，由 `@deepseek-ai/dsh-client-locale` 注入。
- 三份运行时字典结构一致（每种语言一个扁平 `key -> 文案` 对象 + `DICTS`）：`src/dsh/client/i18n.ts`（侧边栏，`en` 必须覆盖 `zh`）、`src/dsh/lib/i18n.ts`（Host 发给手机端的文案）、`src/svelte/lib/i18n.svelte.ts`（手机端，`en` 用 `Record<keyof typeof zh, string>` 声明，漏译是编译错误）。
- `settings.language` 为 `dsh` / `zh` / `en`，默认 `dsh`。`dsh` 精确匹配 DSH 当前 locale id（`zh`、`en`），未命中（如 `ja`、`zh-CN`）回退英语；`resolveLocale()` 在 Host 与面板各有一份同规则实现。
- 侧边栏 `apply()` 订阅 `ctx.locale` 并 `POST /api/locale` 写入 `settings.dshLocale`；Host 的 `public()` 输出解析后的 `settings.locale`，随 `welcome` / `overview` / `settings` 推给手机端。
- 侧边栏用 `useTranslator()` 渲染；手机端 `applySettings()` 调 `setLocale(settings.locale)`，`t()` 读取 `$state` 中的当前语言。修改文案后必须重新构建 `client.js` / `web/`。

## Host 架构

### 生命周期与设置

- `service.start()`：读取设置、创建适配器、启动 LAN HTTP/HTTPS、启动 WebSocket hub、启动推送循环；`dispose()` 关闭服务器、hub、适配器和定时器。`index.ts` 用 `ctx.effect()` 绑定，DSH 卸载 / 重载插件时自动清理。
- 数据目录：`DSH_PROFILE_DIR/remote-control`（优先）或 `DSH_HOME/remote-control`，否则 `~/.dsh/remote-control`；文件为 `settings.json` 与通用 `cache.json`（临时文件 + rename 原子写）。旧 `notification-cache.json` 在首次启动时迁移为 `cache.json`。
- 当前 schema 版本 `2`，字段包括 token、允许网卡、主题、插件语言（`language` / `dshLocale`）、温度单位、天气（提供商 `provider`、共享名称 `name`、按提供商分开的 `locations`、和风天气 `qweather` JWT 凭据 / 月上限 / 刷新间隔）、余额、通知、TLS（`tls.advanced.wakeLock` 控制 HTTPS 下的手机唤醒锁）、导航位置、番茄钟与倒计时（互斥，番茄钟分钟允许两位小数、计时四舍五入到秒，倒计时 1–5 个按分/秒填写的预设）、页面顺序 / 开关。
- 天气旧字段 `weather.latitude` / `weather.longitude` 在 normalize 时迁移到三个提供商的 `locations`，共享 `name` 只保存一次；`qweather.apiHost` 会去掉协议与路径。
- `normalize()` 对每个字段做白名单 / 范围校验，缺失时回落默认值；`update(patch)` 浅合并 + 嵌套对象合并；令牌 24 字节随机 `base64url`，`rotateToken()` 后由 service 断开所有设备。
- 设置对象不含 token；`/api/info`（以及 `/api/settings` 的 `info`）会带配对 URL 和二维码路径，token 只出现在 URL query 中（客户端另存为 cookie）。

### LAN HTTP 服务

`src/dsh/lib/service.ts`：

- 默认端口 `38765`，可用 `DSH_REMOTE_CONTROL_PORT` 覆盖；绑定 `0.0.0.0`；端口占用时回退随机可用端口。
- 可选 HTTPS：读取 PEM 证书 / 私钥；配置无效时回退 HTTP，并在 `info.tls.error` 报告。HTTPS 生效后从证书 SAN（回退 CN）取第一个具体域名作为 `primaryUrl`，扫码与配对链接优先使用该域名；`urls` 仍保留各网卡 IP 供诊断。
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
| `welcome` | 公开设置快照（含 HTTPS 状态与 `tls.advanced.wakeLock`，不含证书 / 私钥路径） |
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
- `weather.ts`：系统定位（Windows WinRT / Linux GeoClue2，经探针）→ 时区兜底；自动模式使用系统 API 的坐标，地名按当前提供商决定：系统 API 自带名称优先；选中的是 QWeather 且可用时用 QWeather GeoAPI 反查；选中的是 NMC / Open-Meteo，或 QWeather 未配置 / 额度不足时用原有的 BigDataCloud 免费反向地理接口兜底（不新增天气提供商）；失败显示「当前位置」。提供商按 `nmc` / `open-meteo` / `qweather` 调度，手动位置与自动位置共用一套解析，三个提供商各自保存经纬度 / 站点 / Location ID。QWeather 只走 JWT（API Host + 凭据 ID + 项目 ID + 开发者 ID + Ed25519 私钥，短期 token 自动续签）；每次请求先写入 `cache.json` 的自然月计数并预留调用数，达到上限才切换到 NMC（中国城市）或 Open-Meteo（国外 / NMC 无站点），普通请求失败不切换。开启控制台同步时，在 QWeather 天气查询前读取 `finance/v1/summary` 与 `metrics/v1/stats`，最多每 3 小时一次，并把这次两次控制台请求计入本地月计数；财务汇总的 `availableResourcePlans[].utilized` 只是资源包已用量，免费额度没有自然月接口，因此本月计数以本地累计为准，控制台能返回月用量时作为参考显示，返回不了则在设置页提示。Open-Meteo / QWeather / NMC 的当天空气质量统一归一化为 `airQuality`，没有数据时为 null。
- `weather/open-meteo.ts` / `weather/qweather.ts` / `weather/nmc.ts` / `weather/shared.ts`：三个提供商、公共 HTTP / 天气代码映射 / AQI 归一化；天气载荷与 `WeatherService` 契约统一放在 `types.ts`。NMC 城市目录缓存在 `cache.json`，首次整表抓取后复用 30 天。
- `cache.ts`：通用运行时缓存，文件 `cache.json`；保存 QWeather 自然月调用计数、NMC 城市目录、控制台快照与最近一次反向地理结果；坐标变化小于约 0.01° 且 30 天内复用，桌面侧边栏刷新按钮会清除并重新反查。并保留旧 `notification-cache.json` 的 `apps` 数据用于迁移。
- `performance.ts`：只采用 Rust `performance` 载荷；探针缺失时仅用 `os.cpus()` / `os.totalmem()`。
- `media-enrich.ts`：统一媒体字段、`provider` / `providerDetail`、进度平滑和 seek 判定。
- `notifications.ts`：Windows/macOS 一次性读取；Linux 启动 `notifications watch` 长进程并按行更新；字段归一化、应用筛选与数量限制在 Node 侧。
- `app-mapping.ts`：应用历史 + 默认名称 + 用户改名 + 旧缓存迁移（优先读 `cache.json`，兼容旧 `notification-cache.json`）；`/api/apps` 写接口。
- `qr.ts`：`qrcode-generator` 生成配对 SVG。

### 安全模型

- LAN 端：token（query / cookie）、可选网卡 CIDR 白名单、可选 HTTPS、Origin 校验、静态路径白名单、64 KiB body 限制；CSP 的 `img-src` 允许 http(s) 远程封面 / 头像。
- 侧边栏端：依赖 DSH `webServer` 的环回访问控制，并额外做 `sameOrigin`。
- 设置与映射文件只存本机；仓库不包含路径、令牌、证书、和风天气私钥或通知内容。和风天气私钥会通过环回 `/api/settings` 返回给侧边栏用于回填，但不会随手机端 `welcome` / `settings` 下发。
- 轮换 token 会断开全部 WebSocket；关闭 token 后 `/` 与 `/ws` 不再要求 token，但网卡白名单仍生效。

## 手机端（Svelte）

- 入口：`src/svelte/index.html` → `src/svelte/main.ts` → `App.svelte`。
- Vite `root = src/svelte`，`publicDir = static`，`build.outDir = web`，`assetsDir = assets`，`emptyOutDir = true`，`target = es2022`。
- 技术栈：Svelte 5 runes + Vite 8 + Tailwind CSS v4 + shadcn-svelte（bits-ui）+ Lucide。图标一律使用 Lucide。
- 页面：`HomePage`、`SessionsPage`、`MusicPage`、`PerformancePage`；导航 `Rail`；业务组件包括时钟、天气、通知、余额、消费、CPU/内存、GPU、温度、计时、会话列表、问询对话框（`QuestionSheet`）、Toast 等。
- 状态：`state.svelte.ts` 持有 WebSocket 快照与设置；`ws.ts` 负责重连；`media.ts` 做媒体投影；`session-tree.ts` 组装父子会话；`pomodoro.svelte.ts` / `countdown.svelte.ts` 各自持有计时并共用 `timer-alarm.svelte.ts`（页面标题 / favicon 提示、`tabAlert` 响应式状态，以及循环响铃时的持续振动）；`wake-lock.ts` 按 `settings.tls.advanced.wakeLock` 在 HTTPS 页面申请屏幕唤醒锁，页面隐藏时释放、回到前台重新申请；`billing.svelte.ts` 负责峰谷与节假日；`format.ts` / `weather.ts` / `pages.ts` 为纯工具。
- i18n：`applySettings()` 从 `settings.locale` 调 `setLocale()`；所有组件和 `format.ts` / `weather.ts` 通过 `t()` 取文案，日期格式化使用 `localeTag()`，切换语言无需刷新。`zh` 为基准字典。
- 视觉：`Panel` 包装 shadcn Card 作为统一容器；按钮、Badge、Slider、Dialog、ScrollArea 优先用 `$lib/components/ui`；只在组件原有 class 上覆盖样式，无 hover 过渡 / 缩放。
- 性能页占用率使用 `RadialGauge` 圆环；右侧温度保留大号最高温度与热区背景列表。
- 音乐封面支持 data URL 和 http(s) URL，用 `<img referrerpolicy="no-referrer">` 渲染并把封面地址加入 CSP `img-src`；后端未返回封面时显示占位，不伪造。
- 音乐进度：`SeekBar.svelte` 视觉同 shadcn Slider，但拖动轨道自行实现，用 100 ms 本地时钟推进以避免快照拉回；松手只提交一次 seek；播放时显示 SVG 正弦波，暂停 / 拖动 / 无时间轴时收平；`canSeek=false` 用只读轨道，无时间轴时固定 100% 并显示 `--:--`。后端快照的 `position` 比上一份低超过 1 s 时视为播放器内手动 seek 并重新锚定（可拖动与只读轨道都适用）；重复 / 缓存的同值快照不会触发回退。
- 天气卡片：`airQuality` 有值时把 AQI 与等级放在体感 / 湿度 / 风速同一行，没有数据时整项隐藏；NMC 没有逐小时数据时 `WeatherPanel` 自动改用 7 天预报，不显示空行。
- 分页：每页 `scroll-snap-stop: always`，一次手势最多前进 / 后退一页；页面顺序与开关来自设置，关闭的页面不渲染、不轮询。
- 字体：`@fontsource-variable/inter`、`noto-sans-sc`、`jetbrains-mono` 由 Vite 打进 `web/assets/`，不依赖手机系统字体；许可见 `web/fonts/LICENSE.txt`。
- 手机端只读会话；`pushQuestions` 开启后才显示回答入口。

## DSH 侧边栏（React）

- `src/dsh/client` 用 `React.createElement`（`h`）而不是 JSX；React 由 DSH loader 提供。
- 入口 `src/dsh/client/index.ts` 向 DSH 注册设置页（slot），菜单包含：连接、偏好设置、番茄钟 / 倒计时、天气设置、余额显示、通知设置、软件映射、系统信息。
- 所有设置先进入 `DraftState`，点「保存设置」才 `POST /api/settings` 一次性提交；应用改名、主题同步、令牌轮换、断开设备是即时请求。
- 连接页始终显示「高级功能」卡片；HTTPS 关闭时卡片内所有开关显示为关闭并禁用，hint 保持不变。当前提供 `tls.advanced.wakeLock` 开关，启用 HTTPS 后保存，手机端会在 HTTPS 页面申请屏幕唤醒锁。
- 软件映射页在应用列表上方提供本地搜索，按已保存的应用名称或应用 ID 实时过滤；只过滤当前 UI，不触发服务端请求。
- 天气设置按「定位权限 → 数据提供商 → 和风天气 JWT（仅选中时）→ 位置 → 显示方式」排列。位置只提供城市搜索，匹配到的经纬度 / 站点 ID 只显示在提示里，不再提供名称 / 经纬度输入框；城市搜索用 POST `/api/geocode` 携带当前编辑中的 provider 与和风凭据，切换提供商后无需先保存即可搜索。和风天气分组可生成 Ed25519 密钥对、填入私钥并显示 / 复制公钥，JWT 由 Host 按请求自动生成。系统信息页的天气状态 detail 显示实际使用的提供商。
- 偏好设置的第一个设置组是 **插件语言**（跟随 DSH / 简体中文 / English）；保存后 `hydrate()` 调 `setPluginLanguage()` 立即重绘，Host 同时把解析后的 `locale` 推给手机端。
- 主题：`theme = dsh` 时跟随 DSH 的 `dshTheme`，由 `/api/theme` 同步；也可固定 light/dark。
- 样式集中在 `src/dsh/client/styles.ts`：按 DSH 设置页的 188px 导航、54px 顶栏、卡片分组与 14px 行文字实现，只读取 `--dsw-*` 令牌，不复制宿主颜色值；`--drc-*` 仅为旧版 DSH 缺失令牌提供回退。
- 窗口窄于 767px 时导航由 `matchMedia` 切换为原生 `<select>`。
- 系统信息页读取 `/api/settings` 的 `capabilities.probe` / `capabilities.node` 与 `diagnostics.profile`，把探针版本、路径、Node.js 版本、V8、平台、内存合并到「诊断信息」卡片。

## Rust 原生探针（dsh-probe）

### 架构与二进制

- 唯一 OS 探测层：媒体、音量、性能 / GPU / 温度、通知、定位。Node 不保留 PowerShell / C# / playerctl / osascript 回退。
- 源码 `src/rust`（crate `dsh-probe`，版本 `1.0.9`）。每个功能目录（`media/`、`perf/`、`notifications/`、`volume/`、`location/`）都按同一方式分层：`mod.rs` 只做命令行、JSON 外形和平台模块选择；`windows.rs` / `linux.rs` / `macos.rs` 各自实现完整平台逻辑。缺失能力由平台文件返回明确错误，不在 `mod.rs` 里写 `cfg` 分支。
- 媒体层在平台层之上做 vendor 调度：平台文件识别应用后调用 `vendor::resolve`，命中 vendor 进入对应客户端逻辑，未命中才回到系统 API。
- macOS 性能采样使用 `libc` + `mach2` 的 `host_statistics`（CPU tick）与 `sysctl`（内存 / 频率），不链接 CoreFoundation / IOKit，因此构建 macOS 探针不需要完整 Xcode SDK（Command Line Tools 即可）。
- 产物：`native/bin/<platform>-<arch>/dsh-probe[.exe]`，例如 `win32-x64`、`linux-x64`、`darwin-arm64`。
- `src/dsh/lib/probe.ts` 按 `process.platform` / `process.arch` 定位，`DSH_RC_PROBE` 可覆盖；找不到时所有调用返回明确的「不可用」错误。
- 每条命令输出一行 JSON；探针内部错误返回 `{"ok":false,...}` 且退出码 0（便于 Node 读取），参数错误退出码 2。
- `notifications watch`（Linux）是长进程，逐行输出快照，Node 负责重启与冷却。
- 支持常驻 `daemon` 模式：Node 通过 stdin/stdout 按行发送命令与接收同一格式 JSON；daemon 起不来或不支持时回退一次性进程。

### 命令

```text
dsh-probe version
dsh-probe daemon                                  # Host 内部：stdin/stdout 按行请求
dsh-probe media read [--app-id ID] [--player DEST] [--no-thumbnail] [--all]
dsh-probe media playpause|next|previous|seek --position SECONDS [--app-id ID] [--player DEST]
dsh-probe media like [--value true|false] [--app-id ID] [--player DEST]   # vendor private like
dsh-probe media cdp                                                       # private-page diagnostics
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

- 媒体：基础字段（`appId`、`title`、`artist`、`album`、`albumArtist`、`trackNumber`、`playbackStatus`、`autoRepeatMode`、`shuffleActive`、`position`、`startTime` / `endTime`、`minSeekTime` / `maxSeekTime`、`lastUpdatedAt`）、控制位（`canPlayPause` / `canNext` / `canPrevious` / `canSeek`）、封面（`thumbnail`、`thumbnailType`、`thumbnailError`、`thumbnailUrl`）、来源（`provider` / `providerDetail`）与 `liked` / `canLike` / `canSetLiked` / `trackId`（字段通用，当前由网易云提供）。`media read --all` 另外返回按优先级排序的 `sessions` 数组；`media` 是第一项（macOS 只有系统当前会话，数组通常只有一条）。
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
| `DSH_RC_SKIP_RUST_BUILD` | `1` 跳过 `build-rust.mjs`（探针构建） |
| `DSH_RC_NETEASE_CDP_PORT` | 网易云远程调试端口（默认 `2015`） |
| `DSH_REMOTE_CONTROL_PORT` | 覆盖 LAN 控制台端口（默认 `38765`） |

### 平台后端

| 能力 | Windows | Linux | macOS |
|---|---|---|---|
| 媒体读取 / 控制 | vendor-first → 未命中时 WinRT SMTC；UIA 仅只读兜底 | vendor-first；网易云 MPRIS+CDP，其他 MPRIS | vendor-first；MediaRemote（`MRNowPlayingController`）/ AppleScript |
| 封面 | SMTC `Thumbnail` → data URL；网易云 SMTC 或 CDP URL | `file://` / `data:` 直接读取；HTTP(S) 由 Node 下载 | MediaRemote 不返回封面；网易云 CDP 页面提供封面 URL |
| 音量 | Core Audio | `wpctl` → `pactl` → `amixer` | `osascript`（已在 macOS 26 上进行初步测试） |
| CPU / 内存 / 频率 | sysinfo + PDH + 注册表 | sysinfo + `/proc` + cpufreq | `host_statistics` + `sysctl`（已在 macOS 26 上进行初步测试） |
| GPU / 温度 | DXGI + PDH + WDDM D3DKMT + 磁盘温度 | `nvidia-smi` 或 AMD/Intel sysfs + hwmon；Intel 利用率需可选 `intel-gpu-tools`（`intel_gpu_top`） | 不实现 |
| 通知 | 通知中心 SQLite | `org.freedesktop.Notifications` D-Bus 监视（zbus） | 通知中心 SQLite（已在 macOS 26 上进行初步测试） |
| 位置 | WinRT Geolocation | GeoClue2 | 时区兜底（CoreLocation 需应用包，探针明确报不可用） |

### Windows 低完整性

Windows 只允许 Medium 完整性及以上的进程访问定位。插件目录被低完整性进程创建时，`dsh-probe.exe` 会继承 Low 标签，WinRT 直接返回 `Denied`。`build-rust.mjs` 会尝试把目录提升到 Medium 并重建 `native/`；父目录为 Low 时需要管理员 `icacls`。面向用户的步骤在 [`INSTALLATION.md`](INSTALLATION.md)，代码侧不要移除 `ensureMediumIntegrity()`。

## 媒体适配层

`dsh-probe` 的媒体读取是 **vendor-first**：

1. **识别当前播放软件**（SMTC AUMID / 进程 / MPRIS / bundle id）。
2. **命中 vendor 适配** → 进入 `media/vendor/<client>.rs` 的逻辑：所有 vendor 都先尝试完整系统会话（元数据、播放状态、时间轴、控制与 seek）；只有系统会话缺失或不完整时，才用 CDP / 窗口标题 / Cider / UIA 补齐。网易云的系统会话完整时 CDP 只补红心；不完整时 CDP 补精确进度和红心，系统完全缺失时 CDP 提供歌曲信息 / 封面 URL / 播放控制；两者都不可用时窗口 / UIA 兜底，仍取不到就返回空。其他客户端完整系统会话优先，否则窗口标题 / Cider / UIA 私有层。
3. **未命中 vendor**（浏览器、未知播放器）→ 直接使用系统媒体接口（Windows SMTC、Linux MPRIS、macOS MediaRemote）。

同时存在多个软件会话时，选择顺序是 **正在播放 > vendor 优先级 > 当前会话 > 完整时间轴 > tier**。vendor 优先级为网易云、QQ、酷狗、酷我、汽水、全民 K 歌、Spotify、Apple Music、YouTube Music；浏览器和未识别的系统应用共用最低的系统 API 优先级。因此高优先级软件暂停时，正在播放的浏览器/其他应用会接替；都在播放时按优先级选择。`media read --all` 返回按同一顺序排列的 `sessions` 数组，`media` 是其中一个。

播放器滚动标题可能在 DOM 中出现两遍；`Media::finish()` 只折叠完全相同的重复两半（以及 ` - ` / ` · ` 等分隔形式），不影响正常的重复歌名。

传输控制走 `vendor::control`：当前只有网易云 vendor 处理 CDP 传输，其他客户端及浏览器统一使用系统控制闭包；新增私有控制时在 `vendor::control` 加分派臂，不要改平台层。平台层必须先确认目标 app 与当前媒体/系统会话一致，不能因为目标没有 SMTC/MPRIS 就转而控制 Windows/macOS 的“当前”播放器。系统信息页的媒体详情直接显示后端返回的 `providerDetail`（无媒体时显示平台媒体后端），不做前端翻译。

**不访问任何外部 Web API。** 封面来自 SMTC `Thumbnail`、MPRIS `mpris:artUrl` 或网易云 CDP 歌曲数据里的封面 URL；歌曲信息不通过网易云 / QQ 音乐等网络接口查询，也不从客户端本地图片缓存补封面。

适配思路参考 [Widdit/now-playing-service](https://github.com/Widdit/now-playing-service)（MIT）的 `GetMusicStatus` 实现；Rust 侧为独立实现。

### 代码结构

- `src/rust/src/media/vendor/<client>.rs`：每个客户端的私有接口 / 窗口标题解析（`netease.rs` 包含文件内部实现的 CDP 协议栈、webpack store 读取与进度、红心、完整媒体 / 控制桥；`apple_music.rs` 包含 Cider 的 `title.txt`）。vendor 只通过 `vendor/mod.rs` 的参数拿到平台类型，不直接引用平台模块。
- `src/rust/src/media/catalog.rs`：应用识别、进程 / AUMID 映射、进度文本解析、`SmtcPolicy` 和 seek 策略。
- `src/rust/src/media/windows/`：SMTC、窗口 / 进程枚举、Core Audio 会话状态、UI Automation 文本树扫描。
- `src/rust/src/media/linux.rs` / `macos.rs`：MPRIS / MediaRemote 系统接口及平台相关的无障碍兜底。通用 UIA/AX 扫描留在平台层。
- `src/rust/src/media/macos/mediaremote.rs`：通过 `dlopen` + Objective-C runtime 调用私有 MediaRemote（`MRNowPlayingController`），不链接 Apple 框架。

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
| 网易云音乐 | 完整系统会话优先（元数据 / 封面 / 状态 / 进度 / 控制 / seek）；不完整时 CDP 补进度 / 红心，系统缺失时 CDP 全量，否则窗口标题 + UIA | 完整 MPRIS 优先；不完整时 CDP 补进度 / 红心，MPRIS 缺失时 CDP 全量 | 完整 MediaRemote / AppleScript 优先；不完整时 CDP 补进度 / 红心，系统源缺失时 CDP 全量 |
| QQ 音乐 | SMTC（需真实位置）→ 窗口标题 | MPRIS | MediaRemote / AppleScript |
| 酷狗 / 酷我 | SMTC（需真实位置）→ 窗口标题（滚动标题修正） | MPRIS | MediaRemote / AppleScript |
| 汽水音乐 | SMTC（需真实位置） | MPRIS | MediaRemote / AppleScript |
| 全民 K 歌 | SMTC（需真实位置）→ 窗口标题 + UIA 进度 | MPRIS | MediaRemote |
| Spotify | SMTC（可信）→ 窗口标题 | MPRIS | MediaRemote → AppleScript |
| Apple Music | SMTC（可信）→ Cider `title.txt` | MPRIS | MediaRemote → AppleScript → Cider → AX 进度 |
| YouTube Music | SMTC（可信，含浏览器桥接） | MPRIS | MediaRemote / AppleScript |
| 其他应用 / 浏览器 | SMTC | MPRIS | MediaRemote / AppleScript |

「SMTC（需真实位置）」表示只有会话真的报告了位置时才当作完整系统会话；否则保留可用的 SMTC 元数据，改用私有窗口标题和 UIA 补进度，避免「进度条停在 0 却可以拖动」。

Node 侧 `PublicMedia` 同步暴露 `provider` / `providerDetail`，并将 `timelineSource` 设为 `smtc` / `private` / `accessibility` / `none`，供界面判断只展示进度还是可拖动。

### 未来 vendor 扩展点（高级控制）

**规则：不要把“网易云”当成通用层的特例。** 任何客户端专属行为（CDP、红心、私有控制、页面身份、封面 URL）只能出现在 `media/vendor/<client>.rs` 与 `vendor/mod.rs` 的分派里；`media/mod.rs`、`windows.rs` / `linux.rs` / `macos.rs`、`catalog.rs`（除档案数据）、Node 侧都不得出现 `App::Xxx` 判断或直接 `use` 某个 vendor 模块。平台层只回答“当前是哪个 App”，能力问题通过 `vendor::*` 函数询问，不要按客户端名写分支。

新增 QQ 音乐 / 酷狗音乐等高级控制（例如 like）时，按以下扩展点改，不要从一个客户端的现有实现反推通用层：

1. `catalog.rs`：加 `App` 枚举值、`PROFILES` 条目（进程名 / id 关键字 / `SmtcPolicy` / 私有层 / UIA）和 `APP_PRIORITY` 顺序；`PROFILES` 的顺序同时是识别优先级。
2. `media/vendor/<client>.rs`：实现该客户端自己的私有读取与控制。like 提供 `pub fn like(liked: Option<bool>) -> Result<...>`；页面型控制提供 `control` 与页面身份解析；不要改通用 `Media` 的字段语义。
3. `vendor/mod.rs` 分派：`parse_title`、`resolve`、`control`、`fallback_for_app`、`handles_without_system_session`、`like`、`diagnostic` 各加一个 `App::Xxx` 分支。命令层与平台层保持不动。
4. `Media` 已有通用字段：`liked` / `can_like` / `can_set_liked` / `track_id`；新客户端直接填这些字段，Node 的 `canSetLiked` 与 like 按钮无需按客户端改。
5. `vendor::page_identity` / `PageIdentity`：系统 AUMID / bundle id 不可识别时，由 vendor 页面提供身份；新增页面型客户端时扩展这里，而不是在平台层写字符串匹配。
6. 测试：在 `vendor/mod.rs` 的分派测试里加“已知 vendor / 未知 vendor / 无当前媒体”三种断言；不要在平台测试里写死客户端名。

需要 CDP 类私有控制时，注意 **CDP 协议栈目前是 `netease.rs` 的文件内部实现**（`CdpConnection` / `cdp_evaluate` 等不对外导出），不是通用库。新增需要 CDP 的 vendor 时，不要直接假设可以复用，也不要把网易云的 CDP 逻辑上移到通用层：要么先把它抽成独立的通用 CDP 模块（属于架构改动，需要同步改本文件与评审），要么在目标 vendor 文件内实现自己的私有桥。客户端专属的 JS 表达式必须留在自己的 vendor 文件。

从页面 webpack runtime 取 store 时，`webpackJsonp.push` 只传 `[[chunkId], { moduleId: factory }]` 不会执行 factory；必须再传第三参数 `[[moduleId]]`（webpack 4 的 executeModules），否则 `require` 永远拿不到。标题 / 歌手 / 专辑 / 封面 / trackId 只从 store 取，DOM 仅用于进度、播放状态和红心。封面也只能来自系统 API 或该客户端自己的页面数据，不从本地图片缓存补。

评审时先问一句：**如果再加一个 QQ / 酷狗的 like，这次改动需要动几个文件？** 除 `catalog.rs`、`vendor/<client>.rs`、`vendor/mod.rs` 外还要动，就说明特例写错了层。

## 构建与产物

### 构建入口

`package.json` 不声明任何安装脚本（`preinstall` / `install` / `postinstall` / `prepare`）。DSH 用 pnpm 安装组合包，pnpm 默认拦下依赖的构建脚本，而 DSH 会把 `Ignored build scripts` 当作失败安装（`build-blocked`，要求批准后重试）：发布清单里只要有一个安装脚本，用户的一次性安装就会卡住。因此构建一律显式执行：

```powershell
pnpm install
pnpm build       # src/dsh + src/svelte
pnpm build:rust  # 可选：原生探针
```

`pnpm build` 的顺序是 `build-dsh` → `build-web`，不能反：`build-dsh` 先清理旧的 `index.js`、`client.js`、`lib/`、`.build/`，避免半旧产物。

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
pnpm test                       # 下面 6 个按功能分组的 Node 测试
cargo fmt --manifest-path src/rust/Cargo.toml -- --check
cargo test --manifest-path src/rust/Cargo.toml
cargo check --manifest-path src/rust/Cargo.toml --features macos-check
pnpm build:rust
```

### 测试覆盖

一个测试文件对应一类功能，新增断言优先并入已有文件，不要再按单个特性拆新脚本。

- `smoke.mjs`：临时 `DSH_PROFILE_DIR` 启动服务；令牌页面、`/assets/`、图片 CSP、WebSocket welcome/overview、证书域名提取；旧 HTTP overview 路由不存在。
- `questions.mjs`：推送问询开关、远程回答往返、关闭后剥离与拒绝。
- `settings.mjs`：语言精确匹配与回退、`dshLocale` 持久化、Host 字典对齐；倒计时预设与秒级范围、番茄钟两位小数、互斥、公开设置深拷贝、`tls.advanced.wakeLock` 默认与嵌套拷贝。
- `media.mjs`：进度平滑与 seek 规则；探针缺失显式报错；真实 daemon 的并发、重启、禁用与平台能力。探针路径缓存在同一进程内切换时用 `resetProbeCache()`（测试专用）。
- `notifications.mjs`：通知字段归一化与数量限制、应用名称推导与旧缓存迁移、Linux 流式监视。
- `weather.mjs`：v1 → v2 天气设置迁移、按提供商分开的 locations、QWeather 凭据与刷新间隔下限、`cache.json` 迁移 / 月调用计数 / NMC 城市缓存、JWT 结构与 Ed25519 签名校验、密钥对生成、天气代码 / AQI 归一化、NMC 城市匹配。

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

`.github/workflows/checks.yml`：单个 Ubuntu job，分支推送、手动触发、以及被 `publish-npm.yml` 通过 `workflow_call` 复用时都跑同一套检查。

- 固定 Node `26.7.0`、pnpm `12.8.1`、Rust `1.99.1`（含 rustfmt）；
- 缓存 cargo registry（key 为 `src/rust/Cargo.lock` 哈希）；
- 步骤：`pnpm ci` → `pnpm check` → `pnpm build` → `pnpm test` → `node scripts/build-rust.mjs` → `cargo fmt --all -- --check` → `cargo check --all-targets` → `cargo test --all-targets`；
- `push` 只监听分支（`branches: ['**']`）；标签由发布流程负责，避免同一个标签把门禁跑两遍；
- Windows / macOS 行为仍以本地验证为准；macOS 已在 macOS 26 上进行初步测试，目前没有 CI。

`.github/workflows/publish-npm.yml`：把 npm 包发到 `@ohmykreee/dsh-remote-control`。

- 触发：推 `v*` 标签；`workflow_dispatch` 手动运行默认 dry run（`inputs.dry-run`），取消勾选才会真正上传。
- 门禁：`jobs.checks` 是 `uses: ./.github/workflows/checks.yml`，检查不过不发布。
- 构建：只跑 `pnpm build:dsh` 与 `pnpm build:web`；探针是平台相关的本机构建产物，不进 npm 包。
- 校验：`node scripts/check-npm-package.mjs --tag <tag>` 验证产物、清单策略、版本 / 标签一致和 tarball 内容。
- 发布：`npm publish --provenance --access public --tag latest|next`（预发布版本走 `next`）。认证用 npm Trusted Publishing（OIDC），工作流里没有任何 token / secret：job 带 `id-token: write` 并在 `npm` environment 下运行，npm 用这次运行的短期 GitHub 身份换取一次性发布凭据。
- 首次发布（一次性引导）：trusted publisher 只能为已存在的包配置，所以先用维护者账号交互式发布一个占位版本建立包记录（`0.0.0-bootstrap`，`--tag bootstrap`），再到 npm 设置页配 trusted publisher（owner `ohmykreee`、repo `dsh-remote-control`、workflow `publish-npm.yml`、environment `npm`），之后所有版本只走标签发布。新配置必须在 48 小时内完成首次发布，否则过期，所以配置好就尽快打标签。
- npm 政策：scoped 包必须 `publishConfig.access: public`；`publishConfig.registry` 固定 npm 官方源；`publishConfig.provenance: true`；`repository` 必须与 GitHub 仓库一致；trusted publishing 要求 npm CLI `11.5.1+` 与 GitHub 托管 runner（工作流里有前置检查）。首次发布成功后，建议把包的 publishing access 设为「Require two-factor authentication and disallow tokens」。
- 包内容：编译产物（`index.js` / `client.js` / `lib/` / `web/`）+ 源码（`src/**`、构建脚本、配置、README / INSTALLATION / AGENTS / docs）；`test/`、`.github/`、`native/bin/`、`src/rust/target/` 不进包。

一次性引导（只有第一次需要；占位版本只用来在 registry 上创建包记录，正式版本仍由标签发布）：

```bash
mkdir -p /tmp/dsh-rc-bootstrap && cd /tmp/dsh-rc-bootstrap
printf '{"name":"@ohmykreee/dsh-remote-control","version":"0.0.0-bootstrap","license":"MIT"}' > package.json
npm login
npm publish --access public --tag bootstrap
```

## 已知限制

面向用户的限制见 [`README.md`](README.md#已知限制)。实现上还要记住：探针必须在目标机构建，缺失时显式报「探针不可用」；npm 包里没有探针二进制，从 npm 安装的用户开箱只有 CPU / 内存兜底与「探针不可用」状态，完整功能要按 [`INSTALLATION.md`](INSTALLATION.md) 自行编译探针；Windows 定位受低完整性限制；私有层与 UIA / AX 永远不授予 seek，网易云 CDP 也不授予 seek；CDP 依赖页面 webpack runtime，刷新后可能回退到播放条 DOM；番茄钟 / 倒计时只在手机浏览器运行。天气方面：NMC 只覆盖中国城市且没有逐小时预报；QWeather 需要用户自己的 JWT 凭据，月上限达到后只按配额切换到 NMC（中国）/ Open-Meteo（国外或 NMC 无站点），普通请求失败不切换；Open-Meteo 的 AQI 使用 US AQI，QWeather 优先中国 AQI，NMC 使用其自带 AQI。

## 开发约定

- 改 `src/dsh`、`src/svelte` 或 `static/` 后必须重新构建；不要在提交中带 `index.js`、`client.js`、`lib/`、`web/`、`native/bin/`。
- 不要在 `src/dsh/lib` 里重新引入 PowerShell / C# / playerctl / osascript 回退；探针缺失必须是显式错误状态。
- 新增平台能力时同时更新：Rust 平台模块、`平台后端` 矩阵、载荷 / 限制、必要时的 `INSTALLATION.md` 依赖说明。
- 新增客户端适配时：在 `media/catalog.rs` 注册 profile，在 `media/vendor/` 加解析，在本文件客户端表补一行；不要在媒体载荷里伪造进度。
- 新增 vendor 或高级控制（like / 私有 seek / 页面控制）时，只改 `catalog.rs` 档案、`media/vendor/<client>.rs` 和 `vendor/mod.rs` 分派；不要在 `media/mod.rs` 或任何平台文件里写 `App::Xxx` 特例，也不要把“网易云”当作唯一的私有控制客户端。
- 改设置字段时同时更新：`settings.ts` 的 normalize / default、`src/dsh/client` 的编辑 / 保存、`README.md` 菜单说明；保持旧 `settings.json` 可迁移。
- 新增或修改用户可见文案时，同时更新三份扁平字典；不要写死中文。
- 改协议消息时同时更新 `service.ts`、`src/svelte/lib/ws.ts` 和本文件的 WebSocket 表。
- 提交前至少跑：`pnpm check`、`pnpm build`、`pnpm test`；改 Rust 再跑 `cargo fmt --check`、`cargo test`。

## 许可证

MIT。Inter、Noto Sans SC、JetBrains Mono 使用 SIL Open Font License 1.1（`static/fonts/LICENSE.txt`，构建后 `web/fonts/LICENSE.txt`）。媒体适配层参考的 Widdit/now-playing-service 为 MIT。
