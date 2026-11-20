# 接口与协议

[← AGENTS.md](../../AGENTS.md)

本文件覆盖两条链路的所有线格式：侧边栏的环回 API、手机端 LAN 上传、WebSocket 帧与推送语义。Host 内部结构见 [`host.md`](host.md)，快速问答的业务流程见 [`quickqa.md`](quickqa.md)。

**类型源**：浏览器端消息联合类型在 `src/svelte/lib/types.ts`；Host 的发送 / 分发在 `src/dsh/lib/server/hub.ts`；WebSocket 传输在 `src/dsh/lib/server/ws.ts`。改消息时优先让 TypeScript 报错，本文件只记录类型表达不了的语义。

## 侧边栏环回 API

这些路由注册在 DSH `webServer` 上，全部是 `kind: 'exact'`，路径前缀 `/dsh-remote-control`：

| 方法 | 路径 | 处理 |
|---|---|---|
| GET | `/api/info` | 服务状态、地址、二维码路径、能力 |
| GET/HEAD | `/qr.svg` | 配对二维码（SVG） |
| GET | `/api/settings` | 设置 + 网卡 + 应用映射 + 诊断 + 能力 |
| POST | `/api/settings` | 批量应用设置 |
| GET/POST | `/api/quickqa` | 快速问答实时目录（`?refresh=1` 绕过缓存） |
| POST | `/api/apps` | 应用改名 / 恢复默认 |
| POST | `/api/location` | 探针 `location request`，成功后清定位缓存 |
| GET/POST | `/api/geocode` | 城市检索；POST 携带当前编辑中的 provider / 和风凭据 |
| POST | `/api/weather/qweather/jwt` | 用未保存的和风凭据生成 JWT |
| POST | `/api/weather/qweather/keypair` | 生成 Ed25519 密钥对 |
| POST | `/api/weather/qweather/sync` | 读取控制台最近 24 小时统计与尽力获取的本月用量 |
| POST | `/api/weather/refresh` | 重新读取系统位置、绕过地名缓存并刷新天气 |
| POST | `/api/theme` | 同步 DSH 明暗主题 |
| POST | `/api/locale` | 同步 DSH 当前语言 |
| POST | `/api/token/rotate` | 轮换令牌并断开所有设备 |
| POST | `/api/disconnect` | 按客户端 id 断开设备 |

规则：

- 写接口校验 `sameOrigin(req)`，不通过返回 403。**`sameOrigin` 在请求没有 `Origin` 头时返回 true**，这是给非浏览器调用方的兼容口；浏览器请求始终带 `Origin`，不要把它当成完整的 CSRF 边界。
- 请求体是 JSON，上限 64 KiB（`src/dsh/lib/server/http.ts` 的 `BODY_LIMIT`）。这个限制只属于侧边栏环回路由，不是 LAN 上传的限制。
- 路由处理失败返回 JSON `{ ok: false, error }`；不要新增返回 HTML 的 API。

## LAN HTTP

手机端监听在插件自己的端口（默认 `38765`，`DSH_REMOTE_CONTROL_PORT` 可覆盖），绑定 `0.0.0.0`。

### 静态资源与鉴权

- 需要授权的路径：`/`、`/index.html`、`/manifest.webmanifest`、`/icon.svg`、`/assets/*`、`/fonts/*`、`/api/pomodoro/sound`、两个快速问答上传接口、`/ws`。
- 授权方式：`?token=` 或 `dsh_rc` cookie。带 query token 的静态响应会下发 cookie：`HttpOnly; SameSite=Lax; Max-Age=2592000`，HTTPS 时加 `Secure`。
- 例外：`/api/health` 与 `/favicon.ico` 不要求 token，但仍受网卡 / IP 白名单限制。`/api/health` 返回版本与时间，可用于连通性检查。
- 网卡白名单先于 token 检查；回环地址始终放行。实现只解析 IPv4，IPv6 客户端会被拒绝。
- 静态路径有白名单，不做任意文件读取。

### 上传接口

| 方法 | 路径 | 内容 | 限制 |
|---|---|---|---|
| POST | `/api/quickqa/transcribe` | WAV 录音，`audio/wav` 或 `application/octet-stream` | 硬上限 8 MiB；同时受官方语音 Remote 的 `maxAudioBytes` 约束；要求 `sameOrigin` |
| POST | `/api/quickqa/attachment` | 一张 PNG / JPEG / WebP / GIF | 20 MiB；校验媒体类型与文件头；要求 `sameOrigin` |

两者都只接受 POST，都要求 token / cookie 与网卡白名单。LAN 侧没有其他 JSON body 接口。

## WebSocket

路径 `/ws`，握手时：

- 校验网卡 / IP 白名单；
- 如果请求带 `Origin`，必须与 `Host` 同源；没有 `Origin` 时放行（非浏览器客户端）；
- `tokenEnabled` 时要求 query token 或 cookie（浏览器重连只靠 cookie，不会自动把 `?token` 加到 `/ws`）。

传输层是手写的 RFC 6455 子集（`src/dsh/lib/server/ws.ts`），新增消息时必须满足：

- 只处理文本帧，不支持分片；
- 单条消息上限 256 KiB；
- 客户端帧必须带 mask；
- 25 s 发 ping，70 s 没有 pong 视为 stale；
- 没有 permessage-deflate，不要依赖压缩。

### 帧外形

- `welcome` 用 `{ type: 'welcome', settings }`；其余快照用 `{ type, data }`；`error` 用 `{ type: 'error', error }`。不要“统一”这些字段，客户端已按此解析。
- 服务端推送的是**完整快照**，不是增量。`hub.push()` 对序列化结果做等值去重（`force` 时跳过），客户端整体替换对应状态，不做合并。
- `clients` 每次都会强制推送；`welcome` / `overview` 在连接时单独发送。

### 服务端 → 手机端

| type | 内容 |
|---|---|
| `welcome` | 公开设置快照（含 HTTPS 状态与 `tls.advanced.wakeLock`，不含证书 / 私钥路径） |
| `overview` | 会话、天气、通知、余额、性能、设置聚合 |
| `clients` | 已连接设备列表 |
| `sessions` / `notifications` / `account` / `weather` / `media` / `performance` | 完整快照 |
| `settings` | 设置变化；含 `quickqa` 语音就绪状态，官方语音插件就绪状态变化时也会重推 |
| `action-result` | 媒体 / 音量动作结果 |
| `answer-result` | 远程回答结果 |
| `quickqa-state` | 阶段 `thinking` / `streaming` / `done` / `error`；可带 `sessionId`、`workspaceId`、`question`、`error`、`empty`、`stopped` |
| `quickqa-delta` | 可见回答的流式文本片段；思考与工具调用不发；新 attempt 之间以空行分隔 |
| `quickqa-pending` | 快速问答中的用户问询 / 权限询问；`clear: true` 表示结束 |
| `error` | 初始化失败、非法 JSON 或处理器异常 |
| `pong` | 心跳回应 |

`quickqa-*` 的业务语义见 [`quickqa.md`](quickqa.md)，这里只保证帧名与阶段。

### 手机端 → 服务端

| type | 内容 |
|---|---|
| `action` | `playpause` / `next` / `previous` / `seek` / `like` / `volume` / `mute`，可带 `value` |
| `answer-question` | `sessionId`、`requestId`、结构化答案 |
| `quickqa-ask` | `text`；新会话带 `workspaceId`，追问带 `sessionId`；可选 `imageId`（同一问题最多一张） |
| `quickqa-stop` | 中断当前快速问答轮次，保留会话供追问 / 新会话 |
| `quickqa-reset` | 放弃当前快速问答会话 |
| `refresh` | 重发初始快照 |
| `settings` | 请求设置快照 |
| `ping` | 心跳 |

### 推送循环

有客户端时启动；最后一个客户端断开即停止。关闭的页面跳过对应推送。

| 数据 | 周期 | 页面开关 |
|---|---|---|
| sessions | 1.5 s | `pageEnabled.sessions` |
| notifications | 2.5 s | `pageEnabled.home` |
| media | 2.2 s | `pageEnabled.music` |
| account | 30 s | `pageEnabled.sessions` |
| weather | 5 min | `pageEnabled.home` |
| performance | 2.5 s | `pageEnabled.performance` |
| 语音输入就绪状态 | 4 s 检查，变化时重推 `settings` | — |

连接时 `sendInitial()` 的顺序是 `welcome` → `overview` → 已启用页面的 `media` / `performance` → `clients`。`sendInitial` 内部失败会发 `error`。

### 语义约定

- `action`：服务端先校验动作名，再调用 `adapters.media.control()`；成功 / 失败都先回 `action-result`，成功后立刻广播新的 `media` 快照。不要改成只广播快照。
- `answer-question`：`pushQuestions` 关闭时服务端拒绝；只处理正常用户问题，不处理工具审批。
- `quickqa-delta`：只发可见文本。每次新的 assistant attempt（例如工具调用之后）另起一段（`\n\n`），所以工具调用前的说明会保留在最终回答上方。
- `quickqa-state.question`：回显本次识别文本，手机聊天卡用它显示用户问题与多轮上下文。
- `error`：不保证连接关闭；客户端应显示错误并等待下一次快照，不要假设服务端会重连。
- `settings` 与 `welcome`：前者是后续变更，后者只在连接时发一次；两者都不含 token、证书 / 私钥路径。

## 改动清单

改协议时同时改：

1. `src/dsh/lib/server/hub.ts`（发送 / 分发）
2. `src/dsh/lib/server/ws.ts`（只在需要改传输 / 鉴权 / 心跳时）
3. `src/svelte/lib/types.ts`（消息联合类型）
4. `src/svelte/lib/ws.ts`、`state.svelte.ts`（连接与状态）
5. 需要时 `src/svelte/lib/quickqa.svelte.ts`
6. 本文件与相关测试（`test/dsh/smoke.mjs`、`questions.mjs`、`quickqa.mjs`）

`server/remote.ts` 只在改 LAN 鉴权或上传接口时需要动；侧边栏路由在 `server/routes.ts`。
