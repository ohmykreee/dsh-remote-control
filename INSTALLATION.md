# 安装、更新与卸载

两种安装方式：

| 方式 | 适合 | 得到什么 |
|---|---|---|
| A. 从 npm 安装（推荐） | 只想用 | 编译好的插件，装完即可配对使用；媒体、音量、通知、GPU / 温度与系统定位需要另在本机构建一次组件 |
| B. 源码 + `link:` | 改代码、参与开发 | 全部功能，构建一次即可 |

功能说明见 [`README.md`](README.md)，架构与开发说明见 [`AGENTS.md`](AGENTS.md)。

## 前置条件

| 组件 | 要求 | 说明 |
|---|---|---|
| DSH | 支持第三方 bundle（已在 `0.2.2-rc.1` 验证） | DSH Desktop 或 `dsh web` profile |
| 网络 | npm registry；方式 B 还要 github.com | 构建 Rust 探针还需 crates.io / `static.rust-lang.org` |
| Node.js | `>= 22` | 方式 B 与构建探针需要；方式 A 不需要 |
| pnpm | 10 或更新（CI 固定 `12.8.1`） | 方式 B 需要；DSH 安装插件时用它自己的 pnpm |
| git | 任意较新版本 | 方式 B 与构建探针需要 |
| Rust（可选） | `1.89+` + C 工具链 | 只有构建 `dsh-probe` 时需要；不构建也能安装插件 |
| 权限 | 安装目录可写 | Linux 安装 gcc 需要 `sudo`；Windows 构建探针建议用普通终端 |

## 方式 A：从 npm 安装（推荐）

插件已经发布到 npm，DSH 的插件管理器完成下载与安装，不需要 Node.js、pnpm 或 git。

**方式 A-1：DSH 插件管理器**

1. 打开 DSH 设置 → 插件管理 → 安装插件。
2. 填包名 `@ohmykreee/dsh-remote-control`（可加版本，如 `@ohmykreee/dsh-remote-control@1.0.4`）。
3. 安装并启用，重启 DSH（或重新加载插件）。侧边栏会出现 **远程控制台**。

**方式 A-2：DSH CLI（DSH 未运行时）**

```powershell
dsh plugin --profile desktop add @ohmykreee/dsh-remote-control
```

```bash
dsh plugin --profile web add @ohmykreee/dsh-remote-control
```

`desktop` 对应 DSH Desktop，`web` 对应 `dsh web`。安装后 profile 的 `package.json` 会包含：

```json
{
  "dependencies": { "@ohmykreee/dsh-remote-control": "^1.0.4" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@ohmykreee/dsh-remote-control"] } }
}
```

装好即可使用：时钟、天气、通知、会话、余额、远程回答、音乐信息、音量与性能页。

**这个包不含本机探测组件，也不声明任何安装脚本。** DSH 用 pnpm 安装组合包，pnpm 默认不执行依赖的构建脚本，所以「装完自动编译」不会发生。媒体、音量、通知、GPU / 温度与系统定位需要按 [构建原生探针](#rust-原生探针可选) 在本机构建一次；没有它时这些位置显示不可用，其余功能不受影响。

## 方式 B：从源码构建并注册

适合改代码或需要完整功能、又不想单独指定探针路径的场景。

### 1. 克隆到固定目录

```powershell
# Windows PowerShell
git clone https://github.com/ohmykreee/dsh-remote-control.git "$env:USERPROFILE\.dsh\plugins-src\dsh-remote-control"
```

```bash
# Linux / macOS
git clone https://github.com/ohmykreee/dsh-remote-control.git "$HOME/.dsh/plugins-src/dsh-remote-control"
```

不要克隆到临时目录、`node_modules` 或会被 agent 清理的 workspace；后面注册的是这个目录的绝对路径。路径建议保持 ASCII、无空格，Windows 的 `link:` spec 用正斜杠更稳（`link:D:/path/to/dsh-remote-control`）。已克隆过时用 `git pull --ff-only` 更新，不要重复 clone。

### 2. 构建

```powershell
cd "$env:USERPROFILE\.dsh\plugins-src\dsh-remote-control"
pnpm install
pnpm build
```

`pnpm install` 只装依赖，`pnpm build` 编译 Host（`index.js`、`lib/`）与手机端（`web/`）、侧边栏（`client.js`）。退出码为 0 且根目录出现 `index.js`、`client.js`、`lib/`、`web/` 即成功。

探针可选，按需构建：

```powershell
pnpm build:rust
```

没有 Rust 时会失败，跳过这一步也能安装插件，只是媒体、音量、通知、GPU / 温度与系统定位不可用。

> 构建必须在源码目录里做。在 DSH profile 目录执行 `pnpm build` 会报 `Missing script: "build"`。

### 3. 注册到 DSH

**先构建，再安装 / 启用。** 未构建的 bundle 一旦启用，DSH 启动会直接报 import 错误。

**方式 B-1：DSH 插件管理器**

1. 打开 DSH 设置 → 插件管理 → 安装插件。
2. 选择「从本地目录 / 路径安装」，spec 填 `link:D:/path/to/dsh-remote-control`（换成第 1 步的绝对路径；Linux/macOS 示例 `link:/home/you/.dsh/plugins-src/dsh-remote-control`）。
3. 安装并启用，重启 DSH（或重新加载插件）。

如果让 DSH 里的 agent 代装，让它调用插件管理器的 `install_bundle`，target 同样是上面的 `link:` spec。

**方式 B-2：DSH CLI（DSH 未运行时）**

```powershell
dsh plugin --profile desktop add "link:D:/path/to/dsh-remote-control"
```

```bash
dsh plugin --profile web add "link:$HOME/.dsh/plugins-src/dsh-remote-control"
```

CLI 只负责加入 profile 依赖；如果插件管理器里没有自动出现，请在管理器里启用一次，或确认 profile 的 `package.json` 中 `dsh.profile.bundles` 已包含 `@ohmykreee/dsh-remote-control`。DSH 正在运行时优先用管理器，避免 profile 文件锁。

安装后 profile 的 `package.json` 应包含：

```json
{
  "dependencies": { "@ohmykreee/dsh-remote-control": "link:D:/path/to/dsh-remote-control" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@ohmykreee/dsh-remote-control"] } }
}
```

### 4. 验收

1. 重启 DSH 后打开设置，侧边栏应出现 **远程控制台**。
2. 进入「连接」页，能看到二维码、控制台地址和「链接验证」开关。
3. 手机与电脑在同一局域网，扫码打开控制台；页面、`/assets/` 资源和 WebSocket 都应正常。
4. 在「系统信息」里确认服务状态为运行中，并检查 `dsh-probe` 与 Node.js 能力。

手机打开返回 401 说明链接缺少令牌：重新扫码，或使用「连接」页复制的完整地址。

## Rust 原生探针（可选）

探针 `dsh-probe` 提供媒体、音量、性能 / GPU / 温度、通知和系统定位。不构建它不影响插件加载：

| 未构建探针时 | 状态 |
|---|---|
| 时钟、番茄钟、天气（IP / 时区回退）、会话、余额、设置、配对、HTTPS | 可用 |
| 媒体、音量、通知 | 显示「探针不可用」 |
| GPU、温度 | 空 / 错误状态 |
| CPU、内存 | Node 的 `os.cpus()` / `os.totalmem()` 兜底 |
| 系统定位 | 回退 IP / 时区 |

探针是按平台编译的二进制，不随 npm 包分发。方式 B 构建一次即可；继续用方式 A 时按下面两步补上：

1. 把仓库克隆到任意固定目录，`pnpm install` 后执行 `pnpm build:rust`，产物在 `native/bin/<platform>-<arch>/dsh-probe[.exe]`。
2. 把环境变量 `DSH_RC_PROBE` 设为该产物的绝对路径（Windows 在「系统属性 → 环境变量」里添加，Linux / macOS 写进 shell 配置），然后完全退出并重启 DSH。

也可以在 DSH 安装插件的目录里直接构建，但插件一更新就会被覆盖，不推荐。

### Windows

需要 Rust（MSVC 工具链）和 Visual Studio Build Tools 的「使用 C++ 的桌面开发」组件（会编译内置 SQLite）。

```powershell
# 在普通 PowerShell 中执行，不要用被沙箱限制的终端
node scripts/build-rust.mjs
# 产物：native\bin\win32-x64\dsh-probe.exe
```

脚本会自动查找并加载 `vcvars64.bat`，可用 `DSH_RC_VCVARS` 指定路径。如果在沙箱 / 低完整性终端里构建过，`.build`、`lib` 可能带上拒绝删除的 ACL，之后 `pnpm build` 会报 `EPERM`；在普通终端删除 `.build` 后重试即可。等价手动命令（Developer PowerShell）：`cargo build --release --manifest-path src/rust/Cargo.toml`。

### Linux

```bash
# Fedora / RHEL
sudo dnf install -y gcc gcc-c++ make
# Debian / Ubuntu: sudo apt install build-essential

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
node scripts/build-rust.mjs
# 产物：native/bin/linux-x64/dsh-probe
```

MPRIS 需要会话 D-Bus；GeoClue2 需要 `geoclue2` 服务和桌面授权；音量按 `wpctl` → `pactl` → `amixer` 顺序探测；NVIDIA 需要 `nvidia-smi`（可选）。

### macOS

```bash
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
node scripts/build-rust.mjs
```

macOS 仅提供源码级实现，未在实机或 CI 验证；GPU / 温度不实现；AX 读进度需要给运行 `dsh-probe` 的父进程授予「辅助功能」权限。

### 网易云音乐 CDP（可选，红心/精确进度）

新版网易云的 SMTC 只提供歌曲信息与播放状态，不汇报进度。若需要手机端显示精确进度并点击红心，让网易云带 Chromium 远程调试端口启动。

1. 完全退出网易云音乐（包括托盘图标）。
2. 右键桌面快捷方式 →「属性」→「目标」，在末尾追加（前面有空格）：
   ```text
   /remote-debugging-port=2015
   ```
   或直接运行：
   ```powershell
   & 'C:\Program Files\Netease\CloudMusic\cloudmusic.exe' /remote-debugging-port=2015
   ```
3. 访问 `http://127.0.0.1:2015/json`，能看到 `orpheus://orpheus/pub/app.html` 即成功。
4. 重启 DSH（或等下一次媒体轮询）。音乐页会显示精确进度；登录后红心可点击。

其他端口在启动 DSH 前设置 `DSH_RC_NETEASE_CDP_PORT`（探针继承该变量）。SMTC 可用时 CDP 只补进度和红心，传输控制仍走 SMTC；SMTC 不可用时 CDP 接管歌曲信息、封面与播放控制。未开启 CDP 时，进度回退到窗口 / UIA，红心显示为未知且不读取本地数据库。CDP 只监听回环地址，不调用外部数据接口、不导出 Cookie；删除快捷方式参数并重启网易云即可关闭。

### 验证探针

```powershell
.\native\bin\win32-x64\dsh-probe.exe version
```

```bash
./native/bin/linux-x64/dsh-probe version
```

应输出一行 JSON，包含 `"ok": true` 和 `"name": "dsh-probe"`。之后重启 DSH，或在「系统信息」里确认能力状态。用 `DSH_RC_PROBE` 指向其他位置时，同样可以直接执行那个路径验证。

### Windows 低完整性工作区（定位被拒绝）

Windows 只允许 Medium 完整性及以上的进程访问定位。插件目录若由低完整性进程创建，会带上 `Low Mandatory Level`，`dsh-probe.exe` 继承后 WinRT 直接返回 `Denied`，即使系统位置开关已打开。

```powershell
icacls .                                              # 出现 "Mandatory Label\Low Mandatory Level" 即命中
native\bin\win32-x64\dsh-probe.exe location request   # 返回 "lowIntegrity": true
```

`node scripts/build-rust.mjs` 会自动把项目根目录提升到 Medium，并在必要时重建 `native/`。父目录本身是 Low 时需要管理员执行：

```powershell
icacls "D:\path\to\dsh-remote-control" /setintegritylevel "(OI)(CI)Medium" /T
node scripts/build-rust.mjs
```

也可以把插件放到没有 Low 标签的普通目录（如 `%LOCALAPPDATA%`）重新构建。修复后仍被拒绝，再到「天气设置 → 请求定位权限」开启系统隐私开关。

## 更新

**方式 A：** 在 DSH 插件管理器里升级 **远程控制台**；没有升级入口时，用 CLI 装一次目标版本：

```powershell
dsh plugin --profile desktop add @ohmykreee/dsh-remote-control@1.0.4   # 换成目标版本
```

更新后重启 DSH。插件目录里的 `native/bin` 不随包更新，用 `DSH_RC_PROBE` 指向外部探针时无需重建。

**方式 B：** profile 链接的是源码目录，更新不需要重新安装：

```powershell
$Repo = "D:\path\to\dsh-remote-control"    # 换成第 1 步的克隆目录
git -C $Repo pull --ff-only
pnpm -C $Repo install
pnpm -C $Repo build
```

探针也要重编时再加 `pnpm -C $Repo build:rust`。然后重启 DSH（或在插件管理器里重新加载插件）。只改文档不需要重启。

## 卸载

1. 在 DSH 插件管理器中卸载 / 禁用 **远程控制台**。
2. DSH 无法启动或需要手动清理时，编辑对应 profile 的 `package.json`（Windows 默认 `%USERPROFILE%\.dsh\profiles\desktop\package.json`，Web profile 为 `~/.dsh/profiles/web/package.json`）：从 `dsh.profile.bundles` 和 `dependencies` 中删除 `"@ohmykreee/dsh-remote-control"`，在该 profile 目录执行 `pnpm install`，然后重启 DSH。
3. 方式 B 还要删除源码目录。
4. 如需清除令牌、页面配置和软件映射，删除 `DSH_HOME/remote-control/`（存在 `DSH_PROFILE_DIR` 时优先使用 `<DSH_PROFILE_DIR>/remote-control/`）。

## 故障排查

| 现象 | 处理 |
|---|---|
| `Failed to load plugins`、`web boot: 1 entry did not activate`、`import failed` | bundle 已启用但 `index.js` 缺失或加载失败。方式 B 先 `pnpm build`；仍失败时按「从加载失败中恢复」处理 |
| `ERR_MODULE_NOT_FOUND` 指向 `index.js` | 构建产物缺失：方式 B 重新构建；方式 A 重新安装插件 |
| 插件管理器里搜不到本插件 | 直接填完整包名 `@ohmykreee/dsh-remote-control`；确认网络能访问 npm registry |
| 安装时报 `build-blocked` / `Ignored build scripts` | 本插件不声明安装脚本。待批准的脚本来自其他包，确认来源后再决定是否授权 |
| `dsh: pnpm was not found` 或退出码 127 | 安装 pnpm 或 `corepack enable pnpm`（DSH 自带的 pnpm 不经过 `PATH` 时会用到） |
| `spawnSync cargo ENOENT` | 没有 Rust 工具链，这是可选的；安装后重跑 `pnpm build:rust` |
| `native probe not built` | 未构建探针：按上文构建并（方式 A）设置 `DSH_RC_PROBE`。媒体 / 音量 / 通知 / GPU / 温度 / 定位会不可用 |
| `EPERM` / 无法删除 `.build`、`lib` | 目录带拒绝删除 ACL；在普通终端删除 `.build` 后重试 |
| `Missing script: "build"` | 在 DSH profile 目录里构建；回到源码目录 |
| 侧边栏没有「远程控制台」 | 检查 bundle 是否启用、`client.js` 是否存在，重启 DSH |
| 手机打不开 / 一直转圈 | 检查同一局域网、防火墙、开放网卡与令牌；放行端口后重新扫码 |
| 页面 401 | 地址缺少令牌；用二维码或「连接」页复制的完整地址 |
| 系统定位被拒绝 | 用「请求定位权限」；低完整性按上文修复 |
| 端口被占用 | 设置 `DSH_REMOTE_CONTROL_PORT`；服务也会回退随机端口 |

### 从加载失败中恢复

1. 完全退出 DSH。
2. 备份并编辑对应 profile 的 `package.json`，从 `dsh.profile.bundles` 移除 `"@ohmykreee/dsh-remote-control"`（只移除这一项）。若 DSH 仍无法启动，再从 `dependencies` 移除并在该目录执行 `pnpm install`。
3. 启动 DSH，确认能进入设置。插件已停用。
4. 方式 B：回到源码目录重新构建，确认 `index.js`、`client.js`、`lib/`、`web/` 都存在。方式 A：重新安装插件。
5. 重新注册 / 启用，重启 DSH。

插件管理器还能打开时，优先在界面里禁用 / 卸载。

## 不支持的安装方式

| 方式 | 结果 |
|---|---|
| `npm install -g @ohmykreee/dsh-remote-control` | 全局包不属于任何 profile，DSH 不会加载 |
| `dsh plugin add github:ohmykreee/dsh-remote-control` | 走 git 依赖，不会构建，缺 `index.js` 时 bundle 无法加载 |
| 把 GitHub 地址填进插件安装框 | 同上 |
| 只复制构建产物到 profile | 更新、探针和路径解析都会失效 |
| 在 profile 里只 `pnpm add` 而不注册 bundle | 依赖装上了，但 DSH 不会加载 |
| 指望 `npm install` / 插件安装时自动编译探针 | 包不声明安装脚本，pnpm 也不会执行依赖的构建脚本 |

正确做法：**从 DSH 插件管理器安装 npm 包**，或者 **clone 源码 → 在源码目录构建 → 用 `link:` 注册这个目录**。
