# 安装、更新与卸载

本项目**只从 GitHub 源码安装**，流程固定为：

```text
git clone  →  pnpm install（构建）  →  用 link: 把构建好的目录注册到 DSH profile
```

没有 npm 包，也不支持把仓库 URL 直接填进插件管理器。本文是唯一安装指南；架构与开发说明见 [`AGENTS.md`](AGENTS.md)，功能说明见 [`README.md`](README.md)。

## 为什么不能直接安装

- 仓库只提交源码。运行时需要的 `index.js`、`client.js`、`lib/`、`web/`、`native/bin/` 全部被 `.gitignore` 忽略，必须在本机构建。
- 用 `github:` / 仓库 URL 安装时，pnpm 把仓库当作 git 依赖，按它的 `prepare` 脚本构建，而且默认还会拦截依赖的构建脚本；本仓库没有 `prepare`，不要指望 `postinstall` 在这种安装方式下生效。结果是一个没有 `index.js` 的包，DSH 启动时会报 `Failed to load plugins` / `import failed`。
- `package.json` 是 `"private": true`，也没有发布到 npm registry，因此按包名安装同样不可行。
- 构建产物和平台相关（Rust 探针按 `platform-arch` 生成），不适合作为通用 npm 包分发。

## 前置条件

| 组件 | 要求 | 说明 |
|---|---|---|
| DSH | 支持第三方 bundle 的版本（已在 `0.2.2-rc.1` 验证） | DSH Desktop 或 `dsh web` profile |
| Node.js | `>= 22` | `package.json` 的 `engines`；CI 使用 `26.7.0` |
| pnpm | 10 或更新（CI 固定 `12.8.1`） | 构建、`postinstall`、profile 安装都依赖它 |
| git | 任意较新版本 | 克隆与更新 |
| 网络 | npm registry、github.com | 首次安装依赖；构建 Rust 还需 crates.io / `static.rust-lang.org` |
| Rust（可选） | Rust `1.89+` + C 工具链 | 只有构建 `dsh-probe` 时才需要；不构建也能安装插件 |
| 权限 | 安装目录可写 | Linux 安装 gcc 需要 `sudo`；Windows 构建探针建议用普通终端，不加沙箱 |

检查：

```powershell
node --version
pnpm --version
git --version
```

`pnpm` 不可用时，可先执行 `npm install -g pnpm`，或 `corepack enable pnpm`。

## 安装步骤

### 1. 克隆到固定目录

选一个长期存在、不会被工作区清理的目录。推荐放在 DSH 自己的目录下：

```powershell
# Windows PowerShell
git clone https://github.com/ohmykreee/dsh-remote-control.git "$env:USERPROFILE\.dsh\plugins-src\dsh-remote-control"
```

```bash
# Linux / macOS
git clone https://github.com/ohmykreee/dsh-remote-control.git "$HOME/.dsh/plugins-src/dsh-remote-control"
```

注意：

- 不要克隆到临时目录、`node_modules` 或会被 agent 清理的 workspace；后面注册的是这个目录的**绝对路径**。
- 路径建议保持 ASCII、无空格。Windows 的 `link:` spec 使用正斜杠更稳，例如 `link:D:/Server_site/dsh-remote-control`。
- 已克隆过时不要重复 clone，用 `git pull --ff-only` 更新后重新构建。

### 2. 构建

```powershell
cd "$env:USERPROFILE\.dsh\plugins-src\dsh-remote-control"
pnpm install
```

`postinstall` 会依次执行：

1. `node scripts/build-dsh.mjs`：`src/dsh` → `index.js`、`client.js`、`lib/**/*.js`；
2. `node scripts/build-web.mjs`：`src/svelte` → `web/`（字体与 CSS 一起打包）；
3. `node scripts/build-rust.mjs --optional`：检测到 `cargo` 时构建原生探针，没有则打印提示并继续。

构建成功的标志是 `pnpm install` 退出码为 0，并且根目录出现 `index.js`、`client.js`、`lib/`、`web/`。Rust 未安装时出现 `Skipping the optional Rust probe build` 是正常现象。

如果不想构建 Rust 探针：

```powershell
$env:DSH_RC_SKIP_RUST_BUILD = '1'
pnpm install
```

```bash
DSH_RC_SKIP_RUST_BUILD=1 pnpm install
```

如果安装时禁用了 lifecycle scripts（`--ignore-scripts` 或 pnpm 的脚本策略），手动补构建：

```powershell
pnpm install --ignore-scripts
pnpm build                 # src/dsh + src/svelte
pnpm build:rust            # 可选：构建原生探针
```

> 不要只在 DSH profile 目录里执行 `pnpm build`：profile 没有 `build` 脚本，会报 `Missing script: "build"`。构建必须在上面这个源码目录里做。

### 3. 校验构建产物

```powershell
Test-Path index.js, client.js, lib, web\index.html
node --input-type=module -e "import('./index.js').then(m => console.log(Object.keys(m)))"
```

预期：四个路径都存在；Node 输出的数组包含 `inject` 和 `apply`。`index.js` 缺失时不要继续安装。

也可以再跑一次静态检查（可选，需要 devDependencies）：

```powershell
pnpm check
```

### 4. 注册到 DSH

**推荐顺序：先构建，再安装/启用。** 未构建的 bundle 一旦被启用，DSH 启动会直接报 import 错误。

#### 方式 A：DSH 插件管理器（推荐）

1. 打开 DSH 设置 → 插件管理 → 安装插件。
2. 选择“从本地目录/路径安装”，spec 填：

   ```text
   link:D:/Server_site/dsh-remote-control
   ```

   把路径换成第 1 步的绝对路径；Linux/macOS 示例：`link:/home/you/.dsh/plugins-src/dsh-remote-control`。
3. 安装并启用，然后重启 DSH（或重新加载插件）。

如果使用 DSH 里的 agent 代装，让它调用插件管理器的 `install_bundle`，target 同样是上面的 `link:` spec。

#### 方式 B：DSH CLI（DSH 未运行时）

```powershell
dsh plugin --profile desktop add "link:D:/Server_site/dsh-remote-control"
```

```bash
dsh plugin --profile web add "link:$HOME/.dsh/plugins-src/dsh-remote-control"
```

`desktop` 对应 DSH Desktop，`web` 对应 `dsh web`。CLI 只负责把包加入 profile 依赖；如果插件管理器里没有自动出现，请在插件管理器里启用一次，或确认 profile 的 `package.json` 中 `dsh.profile.bundles` 已包含 `dsh-remote-control`。DSH 正在运行时优先用方式 A，避免 profile 文件锁。

安装后 profile 里应能看到类似：

```json
{
  "dependencies": {
    "dsh-remote-control": "link:D:/Server_site/dsh-remote-control"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-remote-control"]
    }
  }
}
```

### 5. 验收

1. 重启 DSH 后打开设置，侧边栏应出现 **远程控制台**。
2. 进入「连接」页，能看到二维码、控制台地址和「链接验证」开关。
3. 手机与电脑在同一局域网，扫码打开控制台；页面、`/assets/` 资源和 WebSocket 都应正常。
4. 在「系统信息」里确认服务状态为运行中，并检查 `dsh-probe` 与 Node.js 能力及版本；媒体/音量/通知等能力若显示不可用，见下面的 Rust 探针一节。

常见问题：手机打开返回 401，说明访问链接缺少令牌。重新扫描二维码，或使用「连接」页复制的完整地址。

## Rust 原生探针（可选）

探针 `dsh-probe` 提供媒体、音量、性能/GPU/温度、通知和系统定位。不构建探针不会影响安装和插件加载，只影响这些系统能力：

| 未构建探针时 | 状态 |
|---|---|
| 时钟、番茄钟、天气（IP/时区回退）、会话、余额、设置、配对、HTTPS | 可用 |
| 媒体、音量、通知 | 显示“探针不可用” |
| GPU、温度 | 空/错误状态 |
| CPU、内存 | Node 的 `os.cpus()` / `os.totalmem()` 兜底 |
| 系统定位 | 回退 IP / 时区 |

### Windows

需要 Rust（MSVC 工具链）和 Visual Studio Build Tools 的“使用 C++ 的桌面开发”组件（构建会编译内置 SQLite）。

```powershell
# 在普通 PowerShell 中执行，不要用被沙箱限制的终端
node scripts/build-rust.mjs
# 产物：native\bin\win32-x64\dsh-probe.exe
```

构建目录要由当前用户正常写入。如果在 DSH 沙箱/低完整性终端里构建过，`.build`、`lib` 可能带上拒绝删除的 ACL，之后 `pnpm build` 会因无法清理旧产物而报 `EPERM`；遇到时在普通终端删除 `.build` 后重试。

脚本会自动查找并加载 `vcvars64.bat`；可用 `DSH_RC_VCVARS` 指定路径。等价手动命令（需在 Developer PowerShell 中）：

```powershell
cargo build --release --manifest-path src/rust/Cargo.toml
```

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

MPRIS 需要会话 D-Bus；GeoClue2 需要 `geoclue2` 服务和桌面授权；音量后端按 `wpctl` → `pactl` → `amixer` 顺序探测；NVIDIA 需要 `nvidia-smi`（可选）。

### macOS

```bash
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
node scripts/build-rust.mjs
```

macOS 仅提供源码级实现，未在实机或 CI 验证；GPU/温度不实现，定位回退 IP。UI Automation / AX 读进度需要给运行 `dsh-probe` 的父进程授予「辅助功能」权限。

### 网易云音乐 CDP（可选，红心/精确进度）

新版网易云客户端的 SMTC 只提供歌曲信息和播放状态，不汇报播放进度。若希望手机端显示精确进度并支持点击红心，需要让网易云带 Chromium 远程调试端口启动。SMTC 可用时 CDP 只补进度和红心，播放/暂停/切歌仍由 SMTC 控制；SMTC 完全不可用时 CDP 会接管歌曲信息、封面和播放控制。

1. 完全退出网易云音乐（包括托盘图标）。
2. 右键桌面快捷方式 →「属性」→「目标」，在末尾追加（注意前面有空格）：
   ```text
   /remote-debugging-port=2015
   ```
   也可以直接运行：
   ```powershell
   & 'C:\Program Files\Netease\CloudMusic\cloudmusic.exe' /remote-debugging-port=2015
   ```
3. 启动后访问 `http://127.0.0.1:2015/json`，能看到 `orpheus://orpheus/pub/app.html` 页面即成功。
4. 重启 DSH（或等待下一次媒体轮询）。音乐页会显示精确进度；登录网易云后红心徽标变为可点击。若网易云没有向系统注册 SMTC，歌曲信息、封面和播放控制会自动走 CDP。

如果使用其他端口，在启动 DSH 前设置环境变量 `DSH_RC_NETEASE_CDP_PORT`（探针继承该变量）。Linux/macOS 版网易云若支持同样的调试参数也可这样启动：探针会先读取 MPRIS/Now Playing，检测到 CDP 后按平台合并进度/红心。未开启 CDP 时，进度回退到原有的窗口/UIA 探测逻辑，红心显示为未知且不可点击——不会读取本地数据库里的红心状态；如果连窗口/UIA 也不可用，媒体卡会显示为空。

CDP 只监听本机回环地址，插件只读取当前页面 DOM、点击红心/播放控制，不调用外部数据接口、不导出 Cookie。若不再需要，删除快捷方式里的参数并重启网易云即可关闭端口。

### 验证探针

```powershell
.\native\bin\win32-x64\dsh-probe.exe version
```

```bash
./native/bin/linux-x64/dsh-probe version
```

应输出一行 JSON，包含 `"ok": true` 和 `"name": "dsh-probe"`。之后重启 DSH，或在「系统信息」里确认能力状态。

### Windows 低完整性工作区（定位被拒绝）

Windows 只允许 Medium 完整性及以上的进程访问定位。如果插件目录曾经由沙箱/低完整性进程创建，目录会带上 `Low Mandatory Level`，`dsh-probe.exe` 继承后以 Low 完整性运行，WinRT 会直接返回 `Denied` —— 此时即使「位置服务」和「允许桌面应用访问你的位置」都已开启也无法定位。

判断：

```powershell
icacls .                              # 出现 "Mandatory Label\Low Mandatory Level" 即命中
native\bin\win32-x64\dsh-probe.exe location request   # 返回 "lowIntegrity": true
```

自动修复：`node scripts/build-rust.mjs` 会检测到 Low 标签，把项目根目录提升到 Medium，并在必要时删除/重建生成的 `native/`（不会改动源码或其它 ACL）。如果父目录本身是 Low（提升需要 `SeRelabelPrivilege`），脚本会打印提示；这时用管理员 PowerShell 执行：

```powershell
icacls "D:\path\to\dsh-remote-control" /setintegritylevel "(OI)(CI)Medium" /T
node scripts/build-rust.mjs
```

或者把插件安装到没有 Low 标签的普通目录（例如 `%LOCALAPPDATA%` 下的 DSH 插件目录）后重新构建。修复后 `dsh-probe location` 应直接返回坐标；若仍被拒绝，再到「天气设置 → 请求定位权限」按提示开启系统隐私开关。

## 更新

因为 profile 链接的是源码目录，更新不需要重新安装：

```powershell
$Repo = "D:\path\to\dsh-remote-control"    # 换成第 1 步的克隆目录
git -C $Repo pull --ff-only
pnpm -C $Repo install
```

然后重启 DSH（或在插件管理器里重新加载插件）。如果 `pnpm-lock.yaml` 有变化，`pnpm install` 会同步依赖；如果只改了文档，不需要重启。

## 卸载

1. 在 DSH 插件管理器中卸载/禁用 **远程控制台**。
2. DSH 无法启动或需要手动清理时，编辑对应 profile 的 `package.json`（Windows 默认 `%USERPROFILE%\.dsh\profiles\desktop\package.json`，Web profile 为 `~/.dsh/profiles/web/package.json`）：
   - 从 `dsh.profile.bundles` 中删除 `"dsh-remote-control"`；
   - 从 `dependencies` 中删除 `"dsh-remote-control"`；
   - 在该 profile 目录执行一次 `pnpm install`，然后重启 DSH。
3. 删除源码目录（第 1 步克隆的位置）。
4. 如需清除配对令牌、页面配置和软件映射，删除 `DSH_HOME/remote-control/`（Windows 默认 `%USERPROFILE%\.dsh\remote-control\`；存在 `DSH_PROFILE_DIR` 时优先使用 `<DSH_PROFILE_DIR>/remote-control/`）。

## 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `Failed to load plugins`、`web boot: 1 entry did not activate`、`dsh-remote-control: import failed` | bundle 已启用，但 `index.js` 不存在或加载失败（最常见：跳过了构建，或用 GitHub/npm 方式安装） | 先按下面的“从加载失败中恢复”移除条目，再重新 clone/构建，最后用 `link:` 注册 |
| `ERR_MODULE_NOT_FOUND` 指向 `index.js` | 同上，构建产物缺失 | 同上 |
| `dsh: pnpm was not found` 或退出码 127 | PATH 中没有 pnpm | 安装 pnpm 或 `corepack enable pnpm`，再重试 |
| `Ignored build scripts` / `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` | pnpm 拦截了依赖的构建脚本；本项目没有 `prepare`，不能依赖 git 安装来构建 | 不要用 git 安装；在源码目录运行 `pnpm install`（根项目的脚本会执行），必要时 `pnpm approve-builds` |
| `spawnSync cargo ENOENT` | 没有 Rust 工具链；这是可选的 | 忽略，或按上文安装 Rust 后重跑 `pnpm build:rust` |
| `native probe not built: .../dsh-probe` | 插件正常，但未构建原生探针 | 按上文构建探针；或接受媒体/音量/通知/GPU/温度/定位不可用 |
| `EPERM` / 无法删除 `.build`、`lib` | 目录带拒绝删除 ACL（曾在沙箱/低完整性终端里构建） | 在普通终端删除 `.build` 后重试；仍失败用管理员重置该目录 ACL |
| `Missing script: "build"` | 在 DSH profile 目录里跑了 `pnpm build` | 回到源码目录构建 |
| 侧边栏没有“远程控制台” | `client.js` 未构建、bundle 未启用，或 DSH 未重启 | 检查 `client.js`，在插件管理器启用并重启 DSH |
| 手机打不开、一直转圈 | 不在同一局域网、防火墙、网卡限制或令牌不对 | 检查「连接」页地址与开放网卡；放行端口；重新扫码 |
| 页面 401 | 地址缺少令牌 | 用二维码/「连接」页复制的完整地址 |
| 系统定位被拒绝 | Windows 隐私开关或低完整性 | 「请求定位权限」；低完整性按上文修复 |
| 端口被占用 | 默认端口 `38765` 被占用 | 设置 `DSH_REMOTE_CONTROL_PORT` 换端口；服务也会回退到随机端口 |

### 从加载失败中恢复

如果 DSH 因为 `dsh-remote-control` 无法 import 而起不来（截图中的 `web boot: 1 entry did not activate`）：

1. 完全退出 DSH。
2. 备份并编辑对应 profile 的 `package.json`，先把 `"dsh-remote-control"` 从 `dsh.profile.bundles` 中移除（只移除这一项，保留其它插件）。这一步只停止加载，不会删除源码。
3. 如果 DSH 仍无法启动，再把 `dependencies` 中的 `"dsh-remote-control": "link:..."` 也移除，并在该 profile 目录执行 `pnpm install`。
4. 启动 DSH，确认能正常进入设置。此时插件已停用，但源码目录还在。
5. 回到源码目录，按“构建”和“校验构建产物”两节重新构建，确认 `index.js`、`client.js`、`lib/`、`web/` 都存在。
6. 重新用 `link:` 注册/启用，重启 DSH。

如果插件管理器的界面还能打开，优先在界面里禁用/卸载，不必手改 profile 文件。

## 不支持的安装方式

| 方式 | 结果 |
|---|---|
| `npm install dsh-remote-control` | 不存在这个 npm 包 |
| `dsh plugin add github:ohmykreee/dsh-remote-control` | pnpm 按 git 依赖的 `prepare` 流程处理；本仓库没有 `prepare`，bundle 无法加载 |
| 把 GitHub 地址直接填进插件安装框 | 同上 |
| 只把构建产物复制到 profile | 不受支持；更新、探针和路径解析都会失效 |
| 在 profile 里只 `pnpm add` 而不注册 bundle | 依赖装上了，但 DSH 不会加载它 |

正确做法始终是：**clone 源码 → 在源码目录构建 → 用 `link:` 注册这个源码目录**。
