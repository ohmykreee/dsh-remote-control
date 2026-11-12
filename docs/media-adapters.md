# 媒体适配层（Windows / Linux / macOS）

`dsh-probe` 的媒体读取按固定优先级选择数据来源，并严格区分「展示进度」和「可拖动 seek」：

1. **系统媒体接口**
   - Windows：WinRT SMTC（`GlobalSystemMediaTransportControlsSessionManager`）
   - Linux：MPRIS 2 over D-Bus
   - macOS：MediaRemote / `nowplaying-cli`
2. **软件私有接口**
   - 本机窗口标题（Win32 `EnumWindows`）、Cider 的 `Plugins/title.txt`、
     网易云客户端本地 SQLite 数据库/封面缓存等
3. **UI Automation / 无障碍树**（下下策，只读）
   - Windows：UI Automation `Text` 控件
   - macOS：`System Events` UI scripting（受辅助功能权限控制）
   - Linux：MPRIS 已覆盖受支持的原生客户端，因此未启用 AT-SPI 树遍历

**不访问任何外部 Web API。** 封面来自 SMTC `Thumbnail`、MPRIS `mpris:artUrl`
或本地缓存；歌曲信息不通过网易云/QQ 音乐等网络接口查询。

适配思路参考了 [Widdit/now-playing-service](https://github.com/Widdit/now-playing-service)
（MIT）的 `GetMusicStatus` 实现，特别是各客户端的窗口标题修正、音频会话
播放状态判断和网易云/全民 K 歌的 UI Automation 进度文本格式；Rust 侧为独立实现。

## 代码结构

- `src/rust/src/vendor/<client>.rs`：每个客户端的私有接口/窗口标题解析
  （`netease.rs` 还包含本地 SQLite 与封面缓存；`apple_music.rs` 包含 Cider
  的 `title.txt`）。
- `src/rust/src/media/catalog.rs`：应用识别、进程/AUMID 映射、进度文本解析和
  seek 策略。
- `src/rust/src/media/windows/`：Windows 平台的 SMTC、窗口/进程枚举、Core Audio
  会话状态、UI Automation 文本树扫描。
- `src/rust/src/media/linux.rs` / `macos.rs`：MPRIS / MediaRemote 系统接口及
  平台相关的无障碍兜底。通用 UIA/AX 扫描留在平台层，因为它是全应用通用的
  树遍历，不包含单个客户端的业务逻辑。

## 为什么需要分层

同一个客户端在不同版本/系统上暴露的能力并不一致：

- Spotify、Apple Music、YouTube Music、浏览器通常提供完整 SMTC/MPRIS，
  播放状态、时间轴、封面和 seek 都可用。
- 网易云、QQ 音乐、酷狗、酷我、汽水、全民 K 歌经常只提供部分信息，
  或者 SMTC 会话存在但播放状态/位置不刷新（只有打开 Windows 媒体浮层才更新）。
- 网易云的 SMTC 提供元数据/播放状态，但不汇报播放进度；部分旧客户端还会
  「声明可 seek」却不回报真实 `Position`。因此既要保留 SMTC 的元数据，又要从
  UIA/本地数据补进度。

因此适配层先判断系统会话是否**完整**，不完整时保留可用的系统元数据，再降级到
私有接口；只有进度仍缺失时才读无障碍树（只读）。

## Seek 规则

| 来源 | 进度条展示 | 可拖动 seek |
|---|---|---|
| 完整系统会话 | 是 | **是** |
| 系统会话不完整（`smtc-partial`） | 是（若有时长） | 否 |
| 私有接口 | 是（若有时长） | 默认否；仅当适配器显式声明实时可写接口时才是 |
| UI Automation / AX / AT-SPI | 是 | **否** |

判定「完整系统会话」需要同时满足：

- 有标题；
- 播放状态不是 `Closed`；
- `EndTime > StartTime > 0`；
- 播放器允许定位（SMTC `IsPlaybackPositionEnabled` / MPRIS `CanSeek`）；
- 对标记为 `VerifyPosition` 的客户端（部分旧版 QQ/酷狗等）还要求实际收到过非零 `Position`。

Node 侧 `media-enrich.ts` 会再次校验 `provider === 'system'`、时间轴和
位置证据；即使 Rust 侧误给了 `canSeek`，私有/无障碍来源也不会出现可拖动进度条。

## 各客户端行为

| 客户端 | Windows | Linux | macOS |
|---|---|---|---|
| 网易云音乐 | SMTC 元数据/状态/控制（MetadataOnly）→ 窗口标题兜底 + 本地 `webdb.dat`/`Statics` + UIA 进度 | MPRIS → 本地客户端数据（尽力） | MPRIS 不适用；`nowplaying-cli`/AppleScript → 本地客户端数据（尽力） |
| QQ 音乐 | SMTC（需真实位置）→ 窗口标题 | MPRIS | `nowplaying-cli`/AppleScript |
| 酷狗音乐 | SMTC（需真实位置）→ 窗口标题（滚动标题修正） | MPRIS | `nowplaying-cli`/AppleScript |
| 酷我音乐 | SMTC（需真实位置）→ 窗口标题（滚动标题修正） | MPRIS | `nowplaying-cli`/AppleScript |
| 汽水音乐 | SMTC（需真实位置） | MPRIS | `nowplaying-cli`/AppleScript |
| 全民 K 歌 | SMTC（需真实位置）→ 窗口标题 + UIA 进度 | MPRIS | `nowplaying-cli` |
| Spotify | SMTC（可信）→ 窗口标题 | MPRIS | `nowplaying-cli` → AppleScript |
| Apple Music | SMTC（可信）→ Cider `title.txt` | MPRIS | `nowplaying-cli` → AppleScript → Cider `title.txt` → AX 进度 |
| YouTube Music | SMTC（可信，含浏览器桥接） | MPRIS（浏览器/桌面客户端） | `nowplaying-cli`/AppleScript |
| 其他应用/浏览器 | SMTC | MPRIS | `nowplaying-cli`/AppleScript |

「SMTC（需真实位置）」不等于禁用 SMTC，而是：只有该会话真的报告了位置时
才把它当作完整系统会话；否则保留可用的 SMTC 元数据，改用私有窗口标题和
UI Automation 补进度，避免出现「进度条永远停在 0 却可以拖动」的假象。

## 载荷字段

除原有 `appId`/`title`/`artist`/`position`/`canSeek` 等字段外，媒体载荷新增：

- `provider`：`system`、`private` 或 `accessibility`。
- `providerDetail`：具体实现，例如 `smtc`、`smtc-partial`、`mpris`、
  `nowplaying`、`applescript`、`window-title`、`cider-title`、
  `window-title+uia`、`cider-title+ax`。

Node 侧 `PublicMedia` 同步暴露这两个字段，并将 `timelineSource` 设为
`smtc`/`private`/`accessibility`/`none`，供界面判断「只展示进度」还是「可拖动」。

## 已知限制

- 私有接口通常是只读的：窗口标题只有「歌名/歌手」，没有可靠的暂停状态和进度。
  播放/暂停优先用 Core Audio 会话状态/峰值判断；静音或独占音频仍可能误判。
- 网易云最新版的 SMTC 只提供元数据/播放状态/控制，不汇报播放进度。适配器将其视为
  `MetadataOnly`：保留 SMTC 的歌曲信息与控制，进度由 UIA/本地数据补齐，永远不把
  SMTC 当作完整时间轴，也不展示 seek。旧版客户端如果仍「声明可 seek」却不回报
  位置，Node 侧的位置证据校验同样会阻止 seek 条出现。
- 网易云/全民 K 歌的 UIA 进度在切歌瞬间可能短暂读不到，此时只展示标题和
  本地时长（网易云）；不会伪造位置。
- 滚动窗口标题（酷狗/酷我）的修正是启发式的，极端标题（歌名本身含 `-`）可能
  需要用户改名或等待客户端刷新标题。
- Linux 的私有层只读取本地客户端数据；受支持的原生客户端都通过 MPRIS 暴露
  完整信息，因此没有启用 AT-SPI 全树遍历。
- macOS 的 AX 读进度需要给父进程（运行 `dsh-probe` 的终端/DSH）授予
  「辅助功能」权限；未授权时静默返回无进度。
