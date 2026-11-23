# Host 架构

[← AGENTS.md](../../AGENTS.md)

Host 代码在 `src/dsh/lib`，由 `src/dsh/lib/service.ts` 组合，运行在 DSH Host 进程内。接口与帧格式见 [`protocol.md`](protocol.md)，快速问答见 [`quickqa.md`](quickqa.md)。

## 模块职责

- `service.ts`：组合根，启动 / 关闭 / 重启 LAN 服务、应用设置、`dispose()`。
- `server/*`：`state` 创建运行时对象，`http` 处理 JSON / cookie / CIDR / 同源，`remote` 管 LAN 生命周期与上传，`ws` 是手写 WebSocket 传输，`hub` 管连接 / 推送 / 动作分发，`snapshots` 产快照，`routes` 是侧边栏环回 API。
- `settings/`、`sessions/`、`quickqa/`：设置与迁移、会话与问询、快速问答（见 [`quickqa.md`](quickqa.md)）。
- `weather/`、`cache/`、`notifications/`、`apps/`、`performance/`、`media/enrich`、`account/`、`i18n/`、`shared/`：各自领域服务。

## 生命周期

`service.start()`：

1. 读取设置（`settingsStore` 在创建时已加载）；
2. 创建适配器（媒体 / 音量 / 通知 / 平台）；
3. 启动 LAN HTTP/HTTPS；
4. 把 WebSocket hub attach 到监听器；
5. `initializeInterfaceSelection()`：首次启动把当前可用网卡写成显式 `allowedInterfaces`；
6. 推送循环在第一个客户端连接时启动。

`dispose()` 关闭 quickqa、hub、pending、adapters、appMapping、探针 daemon、cache，最后把 `state.disposed` 置位。`src/dsh/index.ts` 用 `ctx.effect()` 绑定，DSH 卸载 / 重载插件时自动执行。

`restart()` 只用于动态切换 TLS（见下）。

## 数据目录与设置

### 文件

目录优先级：

1. `DSH_PROFILE_DIR/remote-control`
2. `DSH_HOME/remote-control`
3. `~/.dsh/remote-control`

文件为 `settings.json` 与 `cache.json`。写入使用临时文件 + rename 的原子替换。旧 `notification-cache.json` 在首次使用 cache 时惰性迁移，只保留 legacy `apps` 数据。

### schema

当前 `SETTINGS_VERSION = 3`。字段定义以 `src/dsh/lib/settings/index.ts` 的 `RemoteControlSettings` 为准，包括：token / 网卡、主题与语言、温度单位、天气、余额、通知、TLS、导航位置、番茄钟 / 倒计时、快速问答、页面顺序 / 开关、自定网页地址、页面主题色。

修改字段时必须：

- 在 `defaultSettings()` 加默认值；
- 在 `normalize()` 做白名单 / 范围校验，缺失时回落；
- 必要时升 `SETTINGS_VERSION` 并写迁移；
- 同步侧边栏的编辑 / 保存与 `README.md` 的菜单说明；
- 保持旧 `settings.json` 可读。

### 迁移与不变量

- **天气**：旧的 `weather.latitude` / `weather.longitude` 会迁移到三个提供商的 `locations`；共享的 `name` 只保存一次。`auto` 模式下的 `(0, 0)` 视为无效坐标并落为 `null`；`manual` 模式保留 0。`qweather.apiHost` 会去掉协议与路径。`qweather.monthlyLimit` 为 1–`Number.MAX_SAFE_INTEGER` 的整数，避免配额减法越过安全整数范围；`refreshMinutes` 按用户输入的正整数 1–1440 保存，不再按月上限上调，过低只在侧边栏用红字提示可能超额。
- **网卡**：首次启动检测到至少一个可用网卡时，把当前网卡名写成显式列表并设 `interfacesInitialized`；之后新增网卡默认不勾选。`normalize()` 仍接受 `null`（表示全部）以兼容旧文件；侧边栏保存时总是提交显式列表。
- **唤醒锁**：`tls.advanced.wakeLock` 是独立开关，挂在 TLS 组下只是历史原因，不根据 `tls.enabled` 推导；手机端无论 HTTPS 开关如何都原样收到它。
- **可信反向代理**：`tls.trustedProxies` 是 IP / CIDR 列表，由 `shared/proxy.ts` 归一化（只接受英文逗号分隔，IPv4 CIDR 归约到网络地址）。加载旧文件时丢弃无效项；设置请求里出现无效项则整单拒绝，不能静默保存成更短的列表。
- **番茄钟 / 倒计时**：互斥；手改文件同时开启时保留番茄钟。番茄钟分钟允许两位小数；倒计时预设 1–5 个，按分 / 秒填写。
- **页面**：`custom` 固定在末尾且默认关闭；全部页面关闭时回退 `home`。`customPageUrl` 裸主机补 `https://`，只接受 http(s)，留空时手机端用内置地址。
- **页面主题色**：`pageThemeColor` 只接受不透明 `#rgb` / `#rrggbb`，统一保存为小写六位；非法值、带 alpha 的值和留空都归一化为空字符串，表示手机端保持内置配色（颜色推导见 [`mobile.md`](mobile.md#页面主题色)）。
- **快速问答**：`profiles` 只为默认 / 置顶工作区保存 `agentPreset` / `permissionPreset`；未置顶的工作区不保存。
- **令牌**：24 字节随机 `base64url`。设置对象不含 token；`/api/info` 与 `/api/settings` 的 `info` 会带配对 URL / 二维码路径，token 只出现在 URL query，客户端存为 cookie。轮换有两条路径：`/api/token/rotate` 换新并断开全部设备；`/api/disconnect` 在访问验证开启时先断目标再换新，把新令牌通过 `/ws` 推给剩下的设备（见 [`protocol.md`](protocol.md)）。
- **更新**：`update(patch)` 浅合并 + 嵌套对象合并；`applySettings()` 还会做下面这些副作用。

### `applySettings()` 的副作用

`src/dsh/lib/service.ts`：

- 删除补丁里的 `token` / `tokenRotatedAt`，令牌只能通过 `/api/token/rotate` 或 `/api/disconnect` 轮换。
- 官方语音输入未就绪时丢弃 `quickqa` 补丁，防止旧页面覆盖已保存配置。
- QWeather 的 `apiHost` / `credentialId` / `projectId` / `developerId` 变化时清零本地月计数；打开控制台同步或身份变化时立即 `syncConsole()`。
- `tokenEnabled` 或网卡列表变化时断开所有 WebSocket。
- `tls.trustedProxies` 变化不重启监听；已连接设备在下次 `hub.info()` 时用新列表重新解析显示 IP。
- TLS 的 `enabled` / `certPath` / `keyPath` 变化时走 `restart()`；否则只 `recomputeUrls()`。
- 推 `settings`，并按页面开关补推通知 / 天气 / 余额 / 会话 / 媒体 / 性能。

## LAN HTTP / HTTPS

### 端口与绑定

- 默认 `38765`，`DSH_REMOTE_CONTROL_PORT` 可覆盖。
- 绑定 `0.0.0.0`。
- 端口候选顺序：上次实际绑定的端口 → 首选端口 → 随机可用端口。切换协议时优先复用上次端口，因此 HTTPS 开关只改变地址的协议 / 主机，端口通常不变。
- 重启后如果首选端口被占用，才换随机端口。

### TLS

- 读取 PEM 证书与私钥；配置无效（路径缺失、读取失败、证书不合法）时回退 HTTP，并在 `info.tls.error` 报告，不阻塞启动。
- HTTPS 生效后从证书 SAN（回退 CN）取第一个具体域名作为 `primaryUrl`；通配符域名与纯 IP 证书不用。`urls` 仍保留各网卡 IP 供诊断。
- **动态切换 TLS 必须走 `service.restart()`**，顺序是：

  1. `hub.closeAll()` 让手机收到关闭帧；
  2. `hub.dispose()` 拆掉旧监听器上的 upgrade 监听；
  3. `remote.stop()`；
  4. `remote.start()`；
  5. 新 server 重新 `hub.attach()`。

  原因：`server.close()` 不会等待已经升级成 `/ws` 的 socket，`remote.stop()` 自己记录每条 `connection` socket 并在关闭前逐个 `destroy()`；`createWebSocketHub` 又绑定具体 server 实例，不重新 attach 会让重启后的 `/ws` 完全不可用。
- 切换后手机页面仍在旧地址，需要用新协议地址重新打开；不做自动跳转。

### 可信反向代理与真实客户端 IP

- 配置在 `tls.trustedProxies`（IP 或 CIDR，英文逗号分隔）。只有 TCP 对端地址命中该列表时，WebSocket 握手里的真实 IP 头才会被读取；其他来源一律使用 socket 地址。
- 读取优先级在 `src/dsh/lib/shared/proxy.ts`：`CF-Connecting-IP` → `True-Client-IP` → `X-Real-IP` → `Fastly-Client-IP` → `X-Client-IP` → `X-Forwarded-For` → `Forwarded` → `X-Original-Forwarded-For` → `X-Cluster-Client-IP` → `X-Forwarded`。链式头从右向左跳过可信代理，取第一个不可信地址；全部可信时取最左项。
- 该地址只用于「系统信息 → 已连接设备」的显示，以及 `clients` 快照；**不参与** `ipAllowed`、token / cookie 校验或同源检查，避免伪造头改变访问控制。
- `hub.info()` 每次都会用当前配置重新解析，因此修改可信列表后无需断开设备。`WebSocketClientInfo.userAgent` 原样来自握手，用于侧边栏悬停提示。

### 静态资源与鉴权

- 静态文件来自 `web/`：页面、`/assets/`、字体、`/manifest.webmanifest`、`/icon.svg`。路径有白名单。
- `tokenEnabled` 时，页面、静态资源、`/ws`、提示音与快速问答上传需要 `?token=` 或 `dsh_rc` cookie；失败返回 401 页面或 JSON。
- `/api/disconnect` 在 `tokenEnabled` 下把「关闭一台设备 + 轮换令牌 + 通知其余设备」当作一步：在关闭前先记下目标之外的客户端 id（断开后剩余的列表），关闭与发送都是同步的，目标设备不会在轮换前挤回 hub；随后轮换令牌并按 id 逐个发送 `token` 帧（每个连接恰好一次，不使用广播），设备用新令牌重签 cookie，全程不断线。
- `/api/health` 与 `/favicon.ico` 不需要 token，但仍受 IP / 网卡白名单限制。
- 回环地址始终放行；实现只解析 IPv4，IPv6 客户端会被拒绝。
- 网卡白名单按 CIDR 判断，先于 token 检查。

### 请求体与响应

- **64 KiB** 是侧边栏环回 JSON 的上限（`http.ts` 的 `BODY_LIMIT`），不是 LAN 接口的限制。
- LAN 只有两个二进制上传：录音硬上限 8 MiB（同时受官方语音 Remote 的 `maxAudioBytes` 约束），图片硬上限 20 MiB（校验媒体类型与文件头）。LAN 没有通用 JSON body 接口。
- JSON 响应带 `no-store`。

### 动作链路

媒体 / 音量动作：

1. `hub` 校验动作名；
2. `adapters.media.control(action, value)` 调探针；
3. 先回 `action-result`（成功 / 失败）；
4. 成功后立即广播新的 `media` 快照。

不要改成只广播快照或静默吞错。

## 会话与远程问询

`src/dsh/lib/sessions/index.ts` 依赖 DSH 的 `sessions`、`agents`、`sessionTitle`、`userQuestions` 服务，并通过公开的 `sessionController.state()` 读取每个活会话的运行状态；同时监听 `user-questions/request`、`approval/request` 瀑布事件。

- `collectSessions()` 把 DSH 会话投影成 `SessionSummary`：标题、cwd、状态、运行起始时间、子代理父子关系、待回答 / 待审批、错误。运行状态取 `sessionController.state()` 的 `running` / `active`；状态排序为 `question > running > error > done`。
- `createPendingTracker()` 在 `user-questions/request` 上以 **`prepend`** 注册：DSH Web 客户端会转发同一瀑布，如果它先运行会 hold 住请求，tracker 就看不到实时问题。先注册自己的处理器，再通过 `next()` 交给正常回答者。
- 远程回答与 DSH 本地回答通过 `Promise.race` 竞争，谁先结束用谁；远程赢了之后 DSH 的提问卡片可能仍显示，需要在 DSH 里手动关闭，这是 DSH Web 客户端的已知行为。
- 已超时但仍可回答的 continued 提问通过 `userQuestions.answer(agent, callId, answer)` 提交；从会话日志重建的待处理项通过 `adopt()` 补登记。
- 已结算问题要抑制重新 adopt：`settledCalls` 60 s、`settledSessions` 6 s。没有这层抑制，已回答的问题会从旧日志里“复活”。
- `notifications.pushQuestions` 为 false 时，`sessions` 快照剥离问题内容与 `answerable`，服务端也拒绝 `answer-question`。
- 远程回答只处理正常用户问题（`ask_user_question`）；工具审批不提供远程按钮，仍需在 DSH 中处理。

## 其他 Host 服务

### 天气与缓存

`weather/index.ts` 的规则：

- 定位优先走探针（Windows WinRT / Linux GeoClue2），失败用时区兜底。
- 自动模式用系统坐标；地名优先用系统 API 返回值。选中 QWeather 且可用时用 QWeather GeoAPI 反查；否则用 BigDataCloud 免费反查。失败时载荷带 `location.nameFallback: true`，客户端本地化「当前位置」，不要比较中文字符串。
- 提供商 `nmc` / `open-meteo` / `qweather`；手动与自动位置共用一套解析；三个提供商各自保存经纬度 / 站点 / Location ID。
- QWeather 只走 JWT（API Host + 凭据 ID + 项目 ID + 开发者 ID + Ed25519 私钥），短期 token 自动续签。
- **只有自然月配额耗尽才切换提供商**：中国城市切 NMC，国外或 NMC 无站点切 Open-Meteo；普通请求失败不切换。每次请求先写 `cache.json` 的自然月计数并预留调用数。
- 控制台同步最多每 3 小时一次，在天气查询前读 `finance/v1/summary` 与 `metrics/v1/stats`；两次请求也计入本地月计数。免费额度没有自然月接口，本月计数以本地累计为准。
- 当天空气质量统一归一化为 `airQuality`，无数据为 `null`。

`cache/index.ts` 保存：QWeather 月计数（Asia/Shanghai 月份）、NMC 城市目录（30 天）、控制台快照、最近一次反地理结果（坐标变化 < ~0.01° 且 30 天内复用）。桌面侧边栏刷新会清反地理缓存。

### 通知与应用映射

- Windows / macOS 一次性读取；Linux 启动 `dsh-probe notifications watch` 长进程并按行更新。
- Linux 的 watch 必须用 `spawn()` 直接启动，不走常驻 probe daemon：daemon 是单线程串行的，长流会把它卡死。
- 字段归一化、应用筛选、数量限制在 Node 侧；Windows 的 `appName` 与 `appKey` 不是同一个东西，中文名由 Node 映射。
- `notifications.enabledApps` 非空时，快照发现新的通知来源应用会追加到列表并立即持久化，当前轮即可推送；为空表示全部应用（含新应用）。
- `apps/index.ts`：应用历史 + 默认名称 + 用户改名 + 旧缓存迁移（优先 `cache.json`，兼容旧 `notification-cache.json`）。

### 性能与媒体

- `performance/index.ts` 只采用 Rust `performance` 载荷；探针缺失时仅用 `os.cpus()` / `os.totalmem()` 兜底 CPU / 内存，GPU / 温度为空。
- `media/enrich.ts` 统一媒体字段、`provider` / `providerDetail`、进度平滑与 seek 判定。可拖动 seek 必须同时满足 `provider === 'system'`、时间轴完整、`positionReported` 等证据；CDP / 私有 / 无障碍来源不出现可拖动进度条。细节见 [`media.md`](media.md)。
- `account/index.ts`：DSH 账户余额与用量，支持「本周 / 最近 7 天」窗口和低余额标记。
- `shared/qr.ts`：`qrcode-generator` 生成配对 SVG。

## 安全模型

- LAN：token（query / cookie）、可选网卡 CIDR 白名单、可选 HTTPS、`Origin` / `Host` 同源检查、静态路径白名单、两个上传的硬上限。`sameOrigin` 在没有 `Origin` 时放行，不要把它当完整 CSRF 防护。
- 侧边栏：依赖 DSH `webServer` 的环回访问控制，并额外做 `sameOrigin`。
- 设置与映射只存本机；仓库不包含路径、令牌、证书、和风私钥或通知内容。和风私钥会通过环回 `/api/settings` 返回侧边栏用于回填，但不会随手机端 `welcome` / `settings` 下发。
- `/api/token/rotate` 会断开全部 WebSocket；`/api/disconnect` 只断目标设备并轮换令牌，其余连接保留，新令牌经 `/ws` 下发。关闭 token 后页面与 `/ws` 不再要求 token，但网卡白名单仍生效。
- 实现是 IPv4-only；新增 IPv6 支持时要同时改 CIDR 判断、`ipAllowed()` 与测试。

## 测试

改 Host 后至少跑 `pnpm test`。相关文件：

- `test/dsh/smoke.mjs`：启动、静态资源、CSP、WebSocket、TLS 切换、端口复用。
- `test/dsh/questions.mjs`：问询开关、远程回答往返、关闭后剥离。
- `test/dsh/settings.mjs`：语言解析、设置迁移 / 校验、公开快照、字典对齐。
- `test/dsh/quickqa.mjs`：见 [`quickqa.md`](quickqa.md)。
- `test/dsh/media.mjs`：媒体缓存、seek、daemon。
- `test/dsh/notifications.mjs`、`weather.mjs`：通知映射、天气迁移 / 配额 / 城市。
