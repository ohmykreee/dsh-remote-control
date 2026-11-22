# 媒体适配层

[← AGENTS.md](../../AGENTS.md)

媒体读取与控制在 Rust 探针里，Node 只做归一化与界面投影。探针总体结构见 [`probe.md`](probe.md)。

## vendor-first

`dsh-probe` 的媒体读取顺序：

1. **识别当前播放软件**：SMTC AUMID / 进程 / MPRIS / bundle id。
2. **命中 vendor** → `src/rust/src/media/vendor/<client>.rs`：
   - 所有 vendor 都先尝试完整系统会话（元数据、播放状态、时间轴、控制与 seek）；
   - 只有系统会话缺失或不完整时，才用 CDP / 窗口标题 / Cider / UIA 补齐；
   - 网易云：系统会话完整时 CDP 只补红心；不完整时 CDP 补精确进度和红心；系统完全缺失时 CDP 提供歌曲信息 / 封面（页面内已加载图片的 data URL）/ 播放控制；两者都不可用时窗口 + UIA 兜底，仍取不到就返回空。
3. **未命中 vendor**（浏览器、未知播放器）→ 直接使用系统媒体接口（Windows SMTC / Linux MPRIS / macOS MediaRemote）。

**不访问任何外部 Web API。** 封面来自 SMTC `Thumbnail`、MPRIS `mpris:artUrl`、网易云 CDP 页面数据或 Cider 的本地文件；网易云 CDP 模式下由页面把已加载的封面编码成 `data:` URL。歌曲信息不通过网易云 / QQ 音乐等网络接口查询，也不从客户端本地缓存目录读文件补封面。

适配思路参考 [Widdit/now-playing-service](https://github.com/Widdit/now-playing-service)（MIT）的 `GetMusicStatus`；Rust 侧为独立实现。

## 多会话选择

多个软件同时暴露媒体会话时：

- Windows 排序：`(playing, vendor priority, current session, complete timeline, tier, enumeration order)`；
- Linux：`(playing, vendor priority, request order)`；
- macOS：只有系统当前会话，通常一条。

vendor 优先级为：网易云、QQ、酷狗、酷我、汽水、全民 K 歌、Spotify、Apple Music、YouTube Music。浏览器和未识别的系统应用共用最低的系统 API 优先级。

因此：

- 高优先级软件暂停时，正在播放的浏览器 / 其他应用会接替；
- 都在播放时按优先级选择；
- `media read --all` 返回同一顺序的 `sessions` 数组，`media` 是第一项；日常 Node 调用只用单条 `media`。

播放器滚动标题可能在 DOM 中出现两遍；`Media::finish()` 只折叠完全相同的重复两半（以及 ` - ` / ` · ` 等分隔形式），不影响正常的重复歌名。

## 完整系统会话与 seek

“完整系统会话”必须同时满足：

- 有标题；
- 播放状态不是 `Closed`；
- `EndTime > StartTime > 0`；
- 播放器允许定位（SMTC `IsPlaybackPositionEnabled` / MPRIS `CanSeek`）；
- 对 `SmtcPolicy::VerifyPosition` 的客户端还要求实际收到过非零 `Position`。

`VerifyPosition` 不只用于“旧版 QQ / 酷狗”：网易云、QQ、酷狗、酷我、汽水、全民 K 歌都使用它。网易云的 SMTC 有元数据和控制、但不报告进度，所以进度来自窗口 / UIA / CDP。

seek 规则：

| 来源 | 进度条展示 | 可拖动 seek |
|---|---|---|
| 完整系统会话 | 是 | **是** |
| CDP-only 页面（没有系统会话） | 是 | **否**（只提供进度与播放控制） |
| 系统会话不完整（Windows `providerDetail = smtc-partial`） | 是（若有时长） | 否 |
| 私有接口 | 是（若有时长） | 默认否；只有适配器显式声明实时可写时才可 |
| UI Automation / AX / AT-SPI | 是 | **否** |

注意：

- 网易云 CDP 内部能执行页面滑块的 seek，但探针**从不声明** `can_seek=true`；Node 也不会发 seek。不要因为“技术上能点”就打开拖动。
- `private_realtime` 是所有生产调用点都传 `false` 的预留开关，不是现成能力。
- `smtc-partial` 是 Windows 的 `providerDetail` 字符串；Linux / macOS 用的是 `mpris` / `mediaremote` 等。
- Node 侧 `media/enrich.ts` 会再次校验 `provider === 'system'`、时间轴和位置证据；CDP、私有、无障碍来源不会出现可拖动进度条。手机端 `isSeekable()` 还要求 `positionReported === true`。

## 传输控制

传输控制走 `vendor::control`：

- 只有网易云 vendor 处理 CDP 传输；其他客户端与浏览器统一使用平台系统控制闭包。
- 新增私有控制时在 `vendor::control` 加分派臂，不要改平台层。
- 平台层必须先确认目标 app 与当前媒体 / 系统会话一致；不能因为目标没有 SMTC / MPRIS 就转而控制 Windows / macOS 的“当前”播放器。
- 系统信息页的媒体详情直接显示后端返回的 `providerDetail`（无媒体时显示平台媒体后端），不做前端翻译。

## 代码结构

- `src/rust/src/media/vendor/<client>.rs`：每个客户端的私有接口 / 窗口标题解析。`netease.rs` 包含文件内部实现的 CDP 协议栈、webpack store 读取、进度、红心、完整媒体 / 控制桥；`apple_music.rs` 包含 Cider 的 `title.txt`。vendor 只通过 `vendor/mod.rs` 的参数拿到平台类型，不直接引用平台模块。
- `src/rust/src/media/catalog.rs`：应用识别、进程 / AUMID 映射、进度文本解析、`SmtcPolicy`、`APP_PRIORITY` 和 seek 策略。
- `src/rust/src/media/windows/`：SMTC、窗口 / 进程枚举、Core Audio 会话状态、UI Automation 文本树扫描。
- `src/rust/src/media/linux.rs` / `macos.rs`：MPRIS / MediaRemote 系统接口及平台相关无障碍兜底。通用 UIA / AX 扫描留在平台层。
- `src/rust/src/media/macos/mediaremote.rs`：`dlopen` + Objective-C runtime 调私有 MediaRemote（`MRNowPlayingController`），不链接 Apple 框架。

## 各客户端行为

| 客户端 | Windows | Linux | macOS |
|---|---|---|---|
| 网易云音乐 | 完整系统会话优先；不完整时 CDP 补进度 / 红心，系统缺失时 CDP 全量，否则窗口标题 + UIA | 完整 MPRIS 优先；不完整时 CDP 补进度 / 红心，MPRIS 缺失时 CDP 全量 | 完整 MediaRemote / AppleScript 优先；不完整时 CDP 补进度 / 红心，系统源缺失时 CDP 全量 |
| QQ 音乐 | SMTC（需真实位置）→ 窗口标题 | MPRIS | MediaRemote / AppleScript |
| 酷狗 / 酷我 | SMTC（需真实位置）→ 窗口标题（滚动标题修正） | MPRIS | MediaRemote / AppleScript |
| 汽水音乐 | SMTC（需真实位置） | MPRIS | MediaRemote / AppleScript |
| 全民 K 歌 | SMTC（需真实位置）→ 窗口标题 + UIA 进度 | MPRIS | MediaRemote |
| Spotify | SMTC（可信）→ 窗口标题 | MPRIS | MediaRemote → AppleScript |
| Apple Music | SMTC（可信）→ Cider `title.txt` | MPRIS | MediaRemote → AppleScript → Cider → AX 进度 |
| YouTube Music | SMTC（可信，含浏览器桥接） | MPRIS | MediaRemote / AppleScript |
| 其他应用 / 浏览器 | SMTC | MPRIS | MediaRemote / AppleScript |

「SMTC（需真实位置）」= `SmtcPolicy::VerifyPosition`：只有会话真的报告过位置才当作完整会话；否则保留可用的 SMTC 元数据，改用私有窗口标题和 UIA 补进度，避免“进度条停在 0 却可以拖动”。

## 新增 vendor / 高级控制

**规则：不要把“网易云”当成通用层的特例。** 任何客户端专属行为（CDP、红心、私有控制、页面身份、封面 URL）只能出现在 `media/vendor/<client>.rs` 与 `vendor/mod.rs` 的分派里；`media/mod.rs`、`windows.rs` / `linux.rs` / `macos.rs`、`catalog.rs`（除档案数据）、Node 侧都不得出现 `App::Xxx` 判断或直接 `use` 某个 vendor 模块。平台层只回答“当前是哪个 App”，能力问题通过 `vendor::*` 函数询问。

新增一个客户端（或给已有客户端加 like / 私有 seek）时：

1. `catalog.rs`：加 `App` 枚举值、`PROFILES` 条目（进程名 / id 关键字 / `SmtcPolicy` / 私有层 / UIA）和 `APP_PRIORITY` 顺序；`PROFILES` 的顺序同时是识别优先级。
2. `media/vendor/<client>.rs`：实现该客户端自己的私有读取与控制。like 提供 `pub fn like(liked: Option<bool>) -> Result<...>`；页面型控制提供 `control` 与页面身份解析；不要改通用 `Media` 的字段语义。
3. `vendor/mod.rs` 分派：`parse_title`、`resolve`、`control`、`fallback_media`、`fallback_for_app`、`handles_without_system_session`、`like`、`diagnostic`、`page_identity` 按需加 `App::Xxx` 分支。命令层与平台层保持不动。
4. `Media` 已有通用字段：`liked` / `can_like` / `can_set_liked` / `track_id`；新客户端直接填这些字段，Node 的 `canSetLiked` 与 like 按钮无需按客户端改。
5. `vendor::page_identity` / `PageIdentity`：系统 AUMID / bundle id 不可识别时，由 vendor 页面提供身份；新增页面型客户端时扩展这里，而不是在平台层写字符串匹配。
6. 测试：在 `vendor/mod.rs` 的分派测试里加“已知 vendor / 未知 vendor / 无当前媒体”三种断言；不要在平台测试里写死客户端名。

**分层检查**：新增一个 QQ / 酷狗的 like 时，改动应只落在 `catalog.rs`、`vendor/<client>.rs` 与 `vendor/mod.rs`；如果还要改平台层或 Node 侧，说明特例写错了层。

### CDP 注意事项

- CDP 协议栈是 `netease.rs` 的文件内部实现（`CdpConnection` / `cdp_evaluate` 等不对外导出），不是通用库。新增需要 CDP 的 vendor 时，不要假设可以复用，也不要把网易云的 CDP 逻辑上移到通用层：要么先抽成独立通用 CDP 模块（架构改动，需要同步更新本文件），要么在目标 vendor 文件内实现自己的私有桥。
- 客户端专属的 JS 表达式必须留在自己的 vendor 文件。
- 从页面 webpack runtime 取 store 时，`webpackJsonp.push` 只传 `[[chunkId], { moduleId: factory }]` 不会执行 factory；必须再传第三参数 `[[moduleId]]`（webpack 4 的 executeModules）。标题 / 歌手 / 专辑 / 封面 URL / trackId 只从 store 取；红心状态优先取 `async:hostResource.likeTrackIds`（客户端自己把它当作喜欢列表全集，`likeTrackCount` 直接取 `length`），列表为空或不可用时才回退到播放条按钮。DOM 仅用于进度、播放状态和红心按钮。详细注释在 `netease.rs` 的 `CDP_STORE_HELPER` 上方。
- 封面字节由页面自己产生：优先取已渲染的大尺寸同专辑图片，否则通过客户端的 `orpheus://cache` 图片缓存协议取 UI 同款 336px 变体，页面用 `fetch` 读字节、按魔数判定格式后 `btoa` 编码成 data URL 随媒体快照返回；探针不落盘、不另开 HTTP 客户端。`thumbnailUrl` 仍作为兜底保留。
- 封面只能来自系统 API 或该客户端自己的页面数据，不从本地图片缓存目录读文件。

## Node 侧

`src/dsh/lib/media/enrich.ts`：

- 统一 `PublicMedia` 字段、`provider` / `providerDetail`、`timelineSource`（`smtc` / `private` / `accessibility` / `none`）。
- 探针允许返回空标题；`enrich.ts` 用 Host 字典的 `mediaUntitled` 补显示名。
- 进度平滑、seek 判定、`positionReported`；重复 / 缓存的同值快照不触发回退。
- 可拖动 seek 只信任 `provider === 'system'` + 完整时间轴 + 位置证据。

`src/dsh/lib/probe/adapter.ts` 负责媒体 / 音量缓存与失败显式报错；封面 HTTP(S) 下载在 Node 侧（3.5 s / 4 MiB / `image/*`）。细节见 [`probe.md`](probe.md#node-桥)。
