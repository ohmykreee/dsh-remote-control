# Rust 原生探针（dsh-probe）

[← AGENTS.md](../../AGENTS.md)

`src/rust` 是唯一的 OS 探测层。Host 通过 `src/dsh/lib/probe/` 启动它；没有 PowerShell / C# / playerctl / osascript 回退。媒体适配规则见 [`media.md`](media.md)。

## 架构

- crate `dsh-probe`，版本与 `package.json` 一致；产物 `native/bin/<platform>-<arch>/dsh-probe[.exe]`，不提交、不进 npm 包。
- 每个功能目录（`media/`、`perf/`、`notifications/`、`volume/`、`location/`）按同一方式分层：
  - `mod.rs`：命令行、JSON 外形、平台模块选择；
  - `windows.rs` / `linux.rs` / `macos.rs`：完整平台逻辑；
  - 平台缺失能力由平台文件返回明确错误，不在 `mod.rs` 里写 `cfg` 分支。
- 媒体在平台层之上再做 vendor 调度：平台文件识别应用后调 `vendor::resolve`，命中 vendor 进入客户端逻辑，未命中才走系统 API。
- macOS 性能用 `libc` + `mach2` 的 `host_statistics`（CPU tick）与 `sysctl`（内存 / 频率），不链接 CoreFoundation / IOKit，所以构建不需要完整 Xcode SDK（Command Line Tools 即可）。
- macOS 媒体通过 `dlopen` + Objective-C runtime 调私有 MediaRemote（`MRNowPlayingController`），不链接 Apple 框架。

## 命令行契约

```text
dsh-probe version
dsh-probe daemon
dsh-probe media read [--app-id ID] [--player DEST] [--no-thumbnail] [--all]
dsh-probe media playpause|next|previous|seek [--position SECONDS] [--app-id ID] [--player DEST]
dsh-probe media like [--value true|false] [--app-id ID] [--player DEST]
dsh-probe media cdp
dsh-probe volume read
dsh-probe volume set --value 0.0..1.0
dsh-probe volume toggle|mute
dsh-probe performance
dsh-probe notifications [--limit 1..20]
dsh-probe notifications watch [--limit 1..20]
dsh-probe location
dsh-probe location request [--open-settings]
```

- 一次性命令输出一行 JSON。探针内部错误返回 `{"ok":false,...}` 且退出码 0，方便 Node 读取；参数 / 用法错误退出码 2。
- `dsh-probe --help` / `help` 是命令与参数的最新来源；上面的列表只是概览。
- `--player DEST` 用于在多个 MPRIS 播放器间指定目标；它只影响本次调用，没有“记住上次选择”的隐式状态。
- `notifications watch` 是 Linux 长进程，逐行输出快照；Node 负责重启与冷却。

## daemon 协议

`dsh-probe daemon` 通过 stdin/stdout 按行收发 JSON，不开 socket。

```text
<- {"event":"ready","ok":true,"protocol":1,"version":"1.1.2","pid":1234}
-> {"id":1,"argv":["performance"]}
<- {"id":1,"ok":true,"result":{...}}
```

- `protocol` 为 `1`；Node 端 `DAEMON_PROTOCOL_VERSION` 必须与 Rust 的 `PROTOCOL_VERSION` 一致，不一致或起不来就回退一次性进程。
- 请求按到达顺序在**同一个线程**串行处理，平台采样器缓存（sysinfo、PDH、D-Bus、WinRT）因此保持热态。
- 请求超时 1–60 s；空闲 60 s 自动退出（`DSH_RC_PROBE_DAEMON_IDLE_MS` 可调，5 s–30 min）；崩溃后 60 s 内不再尝试 daemon。
- `notifications watch` 这种长流**不能**走 daemon：必须由 `notifications/index.ts` 直接 `spawn()`，否则会把串行 daemon 卡死。
- 只读命令可在 daemon 崩溃后重放；写操作（播放控制、音量、like、位置请求）不重放。

## Node 桥

`src/dsh/lib/probe/`：

- `index.ts`：按 `process.platform` / `process.arch` 定位二进制，`DSH_RC_PROBE` 可覆盖；`DSH_RC_DISABLE_RUST_PROBE` 强制不可用（测试用）。`execFile` 取 stdout 中**最后一个以 `{` 开头的行**解析；15 s 失败冷却；临时目录默认仓库 `.probe-tmp/`，`DSH_RC_TMPDIR` 可覆盖。
- `daemon.ts`：daemon 启动、按 id 匹配响应、超时、崩溃 / 退出处理；只读命令可重放。
- `adapter.ts`：只调用 Rust 媒体 / 音量命令，失败直接返回错误，不静默回退。媒体缓存 1.4 s、音量缓存 3 s、错误缓存 5 s，命中时带 `cached: true`。
- 封面：SMTC / MPRIS 的 data URL 或 `file://` 由探针处理；HTTP(S) 封面由 Node 的 `materializeThumbnail()` 下载（3.5 s 超时、4 MiB 上限、只接受 `image/*`，CDP 封面 URL 跳过下载交给浏览器）。
- `performance/index.ts`、`notifications/index.ts`、`apps/index.ts` 的投影见 [`host.md`](host.md)。

## 载荷

字段以 Rust 的 `Serialize` 结构与 Node 的 `src/dsh/lib/shared/types.ts` 为准，两边必须同步。只记语义：

- **媒体**：`provider` / `providerDetail` 是来源契约（`smtc-partial`、`smtc+cdp`、`netease-cdp` 等），用于封面下载、网易云控制路由与系统信息显示；`canSeek` 是“允许拖动”的授权，不是“能定位”的报告；`liked` / `canLike` / `canSetLiked` / `trackId` 当前由网易云填充。
- **通知**：`source` / `liveOnly` / `apps` 是筛选依据；Windows 的 `appName` 是裁剪后的主 id，中文名由 Node 映射；macOS 在 Rust 侧生成名称。
- **性能**：不支持的 GPU 整个 `gpu` 为 `null`；CPU / 内存缺字段为 0，失败时可能为 `null`；`backend` 不是稳定 ID。
- **音量**：`volume` 为 0..1；失败时回 0.5，调用方看 `ok` / `available`。
- **位置**：权限请求额外带 `access` / `allowed` / `lowIntegrity` / `openedSettings` / `reason`。

## 平台后端

| 能力 | Windows | Linux | macOS |
|---|---|---|---|
| 媒体读取 / 控制 | vendor-first → 未命中时 WinRT SMTC；UIA 只读兜底 | vendor-first；网易云 MPRIS + CDP，其他 MPRIS | vendor-first；MediaRemote / AppleScript |
| 封面 | SMTC `Thumbnail` → data URL；网易云 SMTC 或 CDP URL | `file://` / `data:` 直接读取；HTTP(S) 由 Node 下载 | MediaRemote 不返回封面；网易云 CDP 页面提供封面 URL |
| 音量 | Core Audio | `wpctl` → `pactl` → `amixer` | `osascript` |
| CPU / 内存 / 频率 | sysinfo + PDH + 注册表 | sysinfo + `/proc` + cpufreq | `host_statistics` + `sysctl` |
| GPU / 温度 | DXGI + PDH + WDDM D3DKMT + 磁盘温度 | `nvidia-smi` 或 AMD/Intel sysfs + hwmon；Intel 利用率需可选 `intel-gpu-tools` | 不实现 |
| 通知 | 通知中心 SQLite | `org.freedesktop.Notifications` D-Bus 监视（zbus） | 通知中心 SQLite |
| 位置 | WinRT Geolocation | GeoClue2 | 时区兜底（CoreLocation 需应用包，探针明确报不可用） |

Windows / Linux 为完整支持；macOS 只在 macOS 26 上做过初步测试，GPU / 温度不可用。

## Windows 低完整性

Windows 只允许 Medium 完整性及以上的进程访问定位。插件目录被低完整性进程创建时，`dsh-probe.exe` 会继承 Low 标签，WinRT 直接返回 `Denied`。`scripts/build-rust.mjs` 会尝试把目录提升到 Medium 并重建 `native/`；父目录为 Low 时需要管理员 `icacls`。代码侧不要移除 `ensureMediumIntegrity()`；面向用户的步骤在 `INSTALLATION.md`。

## 环境变量

| 变量 | 作用 |
|---|---|
| `DSH_RC_PROBE` | 指定自定义 `dsh-probe` 绝对路径 |
| `DSH_RC_DISABLE_RUST_PROBE` | `1` 强制标记探针不可用（测试） |
| `DSH_RC_TMPDIR` | 覆盖只读 SQLite 副本的临时目录（默认 `.probe-tmp/`） |
| `DSH_RC_DISABLE_PROBE_DAEMON` | `1` / `false` 等关闭常驻 daemon，只用一次性进程 |
| `DSH_RC_PROBE_DAEMON_IDLE_MS` | daemon 空闲退出时间，5 s–30 min，默认 60 s |
| `DSH_RC_VCVARS` | 覆盖 Windows 构建的 `vcvars64.bat` 路径 |
| `DSH_RC_SKIP_RUST_BUILD` | `1` 跳过 `build-rust.mjs` |
| `DSH_RC_NETEASE_CDP_PORT` | 网易云远程调试端口（默认 `2015`） |
| `DSH_REMOTE_CONTROL_PORT` | 覆盖 LAN 控制台端口（默认 `38765`） |

## 测试

```powershell
cargo fmt --manifest-path src/rust/Cargo.toml -- --check
cargo test --manifest-path src/rust/Cargo.toml
cargo check --manifest-path src/rust/Cargo.toml --features macos-check
pnpm build:rust
```

- 单元测试在各模块内；`macos-check` 只验证 macOS 模块的语法 / 类型，不代表在 Mac 上测过。
- `test/dsh/media.mjs` 覆盖真实 daemon 的并发、重启、禁用与平台能力；没有构建探针时相关用例会跳过。
- `test/dsh/media.mjs` 里切换探针路径要调 `resetProbeCache()`（测试专用）。
