# 安装指南

本插件以 DSH bundle 形式安装，支持 npm 包和源码 `link:` 两种方式。npm 包包含预构建产物；源码安装引用本地目录，注册前必须先完成构建。

| 方式 | 适用场景 | 前置工具 |
|---|---|---|
| npm 包（推荐） | 直接安装和使用 | DSH；构建探针时再准备 Node.js、pnpm、git 与 Rust |
| 源码 + `link:` | 本地修改和开发 | DSH、Node.js、pnpm、git；构建探针时还需要 Rust |

媒体、音量、通知、GPU / 温度和系统定位依赖可选的原生探针 `dsh-probe`。探针不随 npm 包分发，可在插件安装后单独编译；缺少探针不会阻止 DSH 加载插件。

由 DSH agent 代装时，应让它先阅读包内的 [`README.md`](README.md) 和本文档，再按相同步骤执行。以下内容包括手动安装、验证、更新和故障恢复。

## 开始之前

| 项目 | 要求 |
|---|---|
| DSH | 支持第三方 bundle 的 DSH Desktop 或 `dsh web` profile |
| 网络 | 安装时需要访问 npm registry；源码安装还需要 github.com，构建探针还需要 crates.io 与 `static.rust-lang.org` |
| Node.js | `>= 22`，仅源码安装和构建探针需要 |
| pnpm | 10 或更新，仅源码安装和构建探针需要 |
| git | 较新版本，仅源码安装和构建探针需要 |
| Rust | `1.89+` 与对应平台的 C 工具链，仅构建探针需要 |
| 权限 | 安装目录可写；Linux 安装编译工具可能需要 `sudo` |

npm 包已经包含构建好的插件，所以普通安装不需要 Node.js、pnpm、git 或 Rust（除构建原生探针需要 Rust 手动编译）。

## 方式 A：从 npm 安装

### 在 DSH 中安装

1. 打开 **设置 → 插件管理 → 安装插件**。
2. 输入 `@ohmykreee/dsh-remote-control`。需要指定版本时，可写成 `@ohmykreee/dsh-remote-control@1.1.4`。
3. 安装并启用，然后重启 DSH。侧边栏应出现 **远程控制台**。

### 用命令行安装

DSH 未运行时，也可以使用 CLI。Desktop 与 Web profile 二选一：

```powershell
dsh plugin --profile desktop add @ohmykreee/dsh-remote-control
```

```bash
dsh plugin --profile web add @ohmykreee/dsh-remote-control
```

CLI 会把依赖写入所选 profile，并注册 bundle。请确认 `--profile` 与实际运行 DSH 的 profile 一致。安装后重启 DSH；如果侧边栏没有出现 **远程控制台**，到插件管理器确认它已经启用。

npm 包不声明 `preinstall`、`install`、`postinstall` 或 `prepare` 脚本，安装过程不会自动编译探针。需要媒体、音量、通知、GPU / 温度或系统定位时，继续按 [Rust 原生探针](#rust-原生探针可选) 构建。

## 方式 B：从源码构建并注册

### 1. 克隆到固定目录

```powershell
# Windows PowerShell
git clone https://github.com/ohmykreee/dsh-remote-control.git "$env:USERPROFILE\.dsh\plugins-src\dsh-remote-control"
```

```bash
# Linux / macOS
git clone https://github.com/ohmykreee/dsh-remote-control.git "$HOME/.dsh/plugins-src/dsh-remote-control"
```

请选一个以后不会随意移动或清理的目录，不要放进临时目录、`node_modules` 或 agent 的工作区。路径最好只含 ASCII 字符且不带空格。已经克隆过时，进入目录执行 `git pull --ff-only` 即可，不要重复克隆。

### 2. 构建插件

在刚才的源码目录执行：

```powershell
pnpm install
pnpm build
```

`pnpm build` 生成 Host 入口 `index.js` 与 `lib/`、侧边栏 `client.js`、手机端 `web/`。命令退出码为 0 且这些路径都存在，才算构建完成。必须在源码目录执行；在 DSH profile 目录执行会出现 `Missing script: "build"`。

探针可以现在一起构建，也可以以后补：

```powershell
pnpm build:rust
```

这一步需要 Rust。跳过它不影响插件安装，但媒体、音量、通知、GPU / 温度和系统定位会不可用。

### 3. 注册到 DSH

先完成构建，再注册或启用插件，否则 DSH 会因缺少入口文件而加载失败。

**在插件管理器中：**

1. 打开 **设置 → 插件管理 → 安装插件**。
2. 选择从本地目录或路径安装，输入源码目录的 `link:` 地址，例如：
   - Windows：`link:D:/path/to/dsh-remote-control`
   - Linux / macOS：`link:/home/you/.dsh/plugins-src/dsh-remote-control`
3. 安装并启用，重启 DSH。

Windows 的 `link:` 路径建议使用正斜杠。让 agent 代装时，插件管理器的安装目标也应使用这个 `link:` 地址。

**或者使用 CLI（DSH 未运行时）：**

```powershell
dsh plugin --profile desktop add "link:D:/path/to/dsh-remote-control"
```

```bash
dsh plugin --profile web add "link:$HOME/.dsh/plugins-src/dsh-remote-control"
```

如果插件管理器没有自动显示插件，请手动启用一次，并确认 profile 的 `package.json` 中，`dsh.profile.bundles` 已包含 `@ohmykreee/dsh-remote-control`。DSH 正在运行时优先使用插件管理器，避免同时修改 profile 文件。

## 安装后验证与连接

1. 重启 DSH，打开侧边栏 **远程控制台 → 连接**。页面应显示二维码、控制台地址和链接验证开关。
2. 确保手机与电脑在同一局域网，用手机扫码打开完整地址。
3. 在 **系统信息** 中确认服务正在运行，并查看探针是否可用。

手机返回 401，通常是因为地址缺少验证信息。重新扫码，或使用 **连接** 页复制的完整地址，不要只手动输入 IP 和端口。

## 快速问答前置条件

快速问答需要先启用 DSH 官方 **语音输入** 插件，并在插件详情中下载、加载语音模型。未准备好时，其他页面不受影响。

手机浏览器只有在安全环境中才允许录音，屏幕唤醒锁也有同样要求。请按 [HTTPS 与浏览器安全上下文](#https-与浏览器安全上下文) 配置。

## Rust 原生探针（可选）

探针 `dsh-probe` 负责读取和控制媒体、音量、通知、GPU / 温度及系统定位。它需要在目标电脑上编译，不随 npm 包分发。

不构建也可以正常使用插件：

| 功能 | 没有探针时 |
|---|---|
| 时钟、番茄钟、天气、会话、余额、设置、配对、HTTPS | 正常可用 |
| CPU、内存 | 仍可查看 |
| 媒体、音量、通知 | 显示不可用 |
| GPU、温度 | 无读数或显示错误 |
| 系统定位 | 天气改用时区推断位置 |

**方式 B：** 在源码目录执行 `pnpm build:rust`，完成后重启 DSH，无需设置路径。

**方式 A：** 另找一个固定目录克隆仓库，执行 `pnpm install` 和 `pnpm build:rust`。产物位于 `native/bin/<platform>-<arch>/dsh-probe[.exe]`。把环境变量 `DSH_RC_PROBE` 设置为该文件的绝对路径，然后完全退出并重启 DSH。

- Windows 可在 **系统属性 → 环境变量** 中添加。
- Linux / macOS 可写入当前 shell 的配置文件，并确保启动 DSH 时能读到。
- 不建议直接在 npm 插件目录里构建，因为升级会覆盖其中的产物。

### Windows

安装 Rust MSVC 工具链，以及 Visual Studio Build Tools 中的 **使用 C++ 的桌面开发** 组件。然后在普通 PowerShell 中执行：

```powershell
node scripts/build-rust.mjs
# 64 位产物：native\bin\win32-x64\dsh-probe.exe
```

脚本会寻找并加载 `vcvars64.bat`；找不到时，可用 `DSH_RC_VCVARS` 指定它的路径。不要使用受沙箱或低完整性限制的终端，否则生成的目录可能带有无法删除的权限标记。

### Linux

```bash
# Fedora / RHEL
sudo dnf install -y gcc gcc-c++ make
# Debian / Ubuntu：sudo apt install build-essential

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
node scripts/build-rust.mjs
# 64 位产物：native/bin/linux-x64/dsh-probe
```

媒体控制需要会话 D-Bus；系统定位需要 GeoClue2 服务和桌面授权。音量工具会依次尝试 `wpctl`、`pactl`、`amixer`。NVIDIA 读数需要驱动附带的 `nvidia-smi`，AMD 读数无需额外安装。

#### Intel GPU 利用率（可选）

Intel GPU 的名称和频率可以直接读取；利用率需要 `intel-gpu-tools`：

```bash
# Fedora / RHEL
sudo dnf install -y intel-gpu-tools
# Debian / Ubuntu：sudo apt install intel-gpu-tools
# Arch：sudo pacman -S intel-gpu-tools
```

普通用户通常还要允许它读取性能计数器：

```bash
sudo setcap cap_perfmon+ep /usr/bin/intel_gpu_top
```

未安装或未授权时，只缺少利用率，名称和频率仍可显示。如果不想修改系统工具权限，可以给 DSH 进程授予同样的 capability，或保留空读数。`setcap` 不存在时，Fedora 安装 `libcap`，Debian / Ubuntu 安装 `libcap2-bin`。GPU 名称通常来自 `lspci`（`pciutils`），缺少该命令时会显示通用名称。

### macOS

```bash
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
node scripts/build-rust.mjs
```

macOS 26 已做初步测试。媒体读取无需额外工具，GPU 与温度不可用。若需要读取播放进度，请给运行 `dsh-probe` 的父进程授予 **辅助功能** 权限。

### 验证探针

```powershell
.\native\bin\win32-x64\dsh-probe.exe version
```

```bash
./native/bin/linux-x64/dsh-probe version
```

输出应是一行 JSON，包含 `"ok": true` 和 `"name": "dsh-probe"`。使用 `DSH_RC_PROBE` 时，请直接执行变量所指向的文件。验证后重启 DSH，再到 **系统信息** 查看状态。

### Windows 低完整性目录导致定位被拒绝

Windows 不允许低完整性进程访问定位。如果插件目录由这类进程创建，即使系统定位已经开启，也可能返回 `Denied`。

```powershell
icacls .
native\bin\win32-x64\dsh-probe.exe location request
```

如果第一条结果包含 `Mandatory Label\Low Mandatory Level`，或第二条返回 `"lowIntegrity": true`，重新运行 `node scripts/build-rust.mjs` 通常可以修复。父目录也带低完整性标记时，需要管理员执行：

```powershell
icacls "D:\path\to\dsh-remote-control" /setintegritylevel "(OI)(CI)Medium" /T
node scripts/build-rust.mjs
```

也可以把源码移到没有该标记的普通目录后重新构建。修复目录权限后仍被拒绝，再到 **天气设置 → 请求定位权限** 检查系统隐私授权。

### 网易云音乐 CDP（可选，红心 / 精确进度）

新版网易云音乐默认只提供歌曲信息和播放状态。需要精确进度和手机端红心时，让它带远程调试端口启动：

1. 完全退出网易云音乐，包括托盘图标。
2. 右键桌面快捷方式，打开 **属性**，在 **目标** 末尾追加一个空格和：

   ```text
   /remote-debugging-port=2015
   ```

   也可以直接运行：

   ```powershell
   & 'C:\Program Files\Netease\CloudMusic\cloudmusic.exe' /remote-debugging-port=2015
   ```

3. 打开 `http://127.0.0.1:2015/json`。页面包含 `orpheus://orpheus/pub/app.html` 就说明已经生效。
4. 重启 DSH。音乐页随后会显示精确进度，登录后可以使用红心。

需要换端口时，在启动 DSH 前设置 `DSH_RC_NETEASE_CDP_PORT`。该端口只监听本机回环地址，不导出 Cookie。删除快捷方式里的参数并重启网易云音乐，即可关闭这项功能。未开启时仍可使用常规歌曲信息与播放控制，但红心状态和精确进度可能不可用。

## HTTPS 与浏览器安全上下文

录音和屏幕唤醒锁要求浏览器把页面视为安全环境。`http://localhost` 和 `http://127.0.0.1` 只在浏览器所在设备上有效；手机打开 `http://<局域网 IP>:38765` 通常不符合要求。

可以任选一种办法：

1. **使用 HTTPS 反向代理。** 用 Caddy、Nginx 等转发到插件端口（默认 `38765`），手机打开代理的 `https://` 地址。
2. **给插件配置证书。** 在 **连接** 页填写 PEM 证书与私钥路径并启用 HTTPS。证书必须覆盖手机访问的域名或 IP，自签证书还需要在手机上信任。保存后，用新的 `https://` 地址重新打开控制台。
3. **仅在开发或测试时使用浏览器白名单。**
   - Chrome / Edge：打开 `chrome://flags/#unsafely-treat-insecure-origin-as-secure`，填入 `http://<局域网 IP>:38765`，设为 Enabled，重启浏览器。
   - Firefox：打开 `about:config`，新建字符串 `dom.securecontext.allowlist`，值为 `http://<局域网 IP>:38765`；多个地址用逗号分隔，然后重启浏览器。
   - Safari：没有等价白名单，请使用 HTTPS 或本机 localhost。iOS Safari 也没有这个调试开关。

白名单只对当前设备和浏览器有效，手机浏览器通常无法这样设置，正式使用建议配置 HTTPS。HTTP 切换为 HTTPS 后端口不变，但手机必须重新打开新地址。

## 更新

**npm 安装：** 在 DSH 插件管理器中升级 **远程控制台**，然后重启 DSH。没有升级入口时，可以用 CLI 安装目标版本：

```powershell
dsh plugin --profile desktop add @ohmykreee/dsh-remote-control@1.1.4
```

把 `1.1.4` 换成需要的版本。使用 `DSH_RC_PROBE` 指向外部探针时，插件更新不会影响它。

**源码安装：** 不需要重新注册，拉取并重新构建即可：

```powershell
$Repo = "D:\path\to\dsh-remote-control"  # 换成你的源码目录
git -C $Repo pull --ff-only
pnpm -C $Repo install
pnpm -C $Repo build
```

需要同时更新探针时，再执行 `pnpm -C $Repo build:rust`。最后重启 DSH；只改文档无需重启。

## 卸载

1. 在 DSH 插件管理器中卸载或禁用 **远程控制台**。
2. 如果 DSH 已无法启动，备份并编辑对应 profile 的 `package.json`：从 `dsh.profile.bundles` 和 `dependencies` 中删除 `@ohmykreee/dsh-remote-control`，在该目录执行 `pnpm install`，再启动 DSH。
   - Windows Desktop 默认路径：`%USERPROFILE%\.dsh\profiles\desktop\package.json`
   - Web profile 默认路径：`~/.dsh/profiles/web/package.json`
3. 源码安装可同时删除源码目录；不再需要探针时，移除 `DSH_RC_PROBE` 环境变量。
4. 如需连同链接验证、页面配置和软件映射一起清除，删除 `DSH_HOME/remote-control/`。存在 `DSH_PROFILE_DIR` 时，改删 `<DSH_PROFILE_DIR>/remote-control/`。

## 故障排查

| 现象 | 怎么处理 |
|---|---|
| `Failed to load plugins`、`web boot: 1 entry did not activate`、`import failed` | 源码安装先回源码目录执行 `pnpm build`；仍失败时按下面的恢复步骤处理 |
| `ERR_MODULE_NOT_FOUND` 指向 `index.js` | 构建产物缺失。源码安装重新构建，npm 安装重新安装插件 |
| 插件管理器搜不到 | 直接输入完整包名 `@ohmykreee/dsh-remote-control`，并检查 npm registry 网络 |
| `build-blocked` / `Ignored build scripts` | 本插件没有安装脚本。提示来自其他依赖，确认来源后再决定是否授权 |
| `dsh: pnpm was not found` 或退出码 127 | 安装 pnpm，或执行 `corepack enable pnpm` |
| `spawnSync cargo ENOENT` | Rust 尚未安装或不在 PATH 中；装好后重跑 `pnpm build:rust` |
| `native probe not built` | 按上文构建探针；npm 安装还要设置 `DSH_RC_PROBE` |
| `EPERM`，无法删除 `.build` 或 `lib` | 目录带有异常权限标记。换普通终端删除 `.build` 后重试 |
| `Missing script: "build"` | 当前在 DSH profile 目录，请回到源码目录 |
| 侧边栏没有 **远程控制台** | 检查插件是否启用、`client.js` 是否存在，然后重启 DSH |
| 手机打不开或一直转圈 | 检查同一局域网、防火墙、允许访问的网卡和链接验证；放行端口后重新扫码 |
| 页面返回 401 | 使用二维码或 **连接** 页复制的完整地址 |
| 系统定位被拒绝 | 使用 **请求定位权限**；Windows 低完整性问题按上文修复 |
| 端口被占用 | 服务会自动选择可用端口，也可设置 `DSH_REMOTE_CONTROL_PORT` 指定端口 |

### 从加载失败中恢复

插件管理器还能打开时，直接禁用或卸载即可。否则：

1. 完全退出 DSH。
2. 备份对应 profile 的 `package.json`，从 `dsh.profile.bundles` 中删除 `@ohmykreee/dsh-remote-control`，其他条目不要动。
3. 如果仍无法启动，再从 `dependencies` 删除同一项，在该目录执行 `pnpm install`。
4. 启动 DSH，确认可以进入设置。
5. 源码安装重新执行 `pnpm build`，确认 `index.js`、`client.js`、`lib/`、`web/` 都存在；npm 安装则重新安装插件。
6. 再次注册或启用，重启 DSH。

## 不支持的安装方式

- `npm install -g @ohmykreee/dsh-remote-control`：全局包不属于任何 DSH profile，不会被加载。
- `dsh plugin add github:ohmykreee/dsh-remote-control`，或把 GitHub 地址填进安装框：不会自动构建，插件入口可能不存在。
- 只复制几个构建产物到 profile：升级、路径解析和探针都会出问题。
- 只在 profile 中 `pnpm add`，却不注册 bundle：依赖存在，但 DSH 不会加载。
- 等待安装脚本自动编译探针：插件没有安装脚本，探针需要按上文单独构建。
