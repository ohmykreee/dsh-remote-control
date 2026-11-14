<p align="center">
  <img src="icon.svg" alt="dsh-remote-control" width="80" height="80">
</p>

<h1 align="center">dsh-remote-control</h1>

<div align="center">
  <p><strong>把局域网里的手机变成 DSH 的触屏中控台</strong></p>
  <p><em>A touch-first LAN console for DeepSeek Harness</em></p>

  <p>
    <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat&logo=deepseek&logoColor=white" alt="由 dsh 驱动"></a>
    <a href="https://github.com/ohmykreee/dsh-remote-control/actions/workflows/checks.yml"><img src="https://github.com/ohmykreee/dsh-remote-control/actions/workflows/checks.yml/badge.svg" alt="Checks"></a>
    <img src="https://img.shields.io/badge/version-v1.0.0-4D6BFE?style=flat" alt="v1.0.0">
    <img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-4D6BFE?style=flat" alt="Windows / Linux / macOS">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat" alt="MIT 许可证"></a>
  </p>

  <p>
    安装步骤 → <a href="INSTALLATION.md">INSTALLATION.md</a>
  </p>

  <p>
    <strong>简体中文</strong> · <a href="docs/README.en.md">English</a>
  </p>
</div>

---

手机与电脑在同一局域网时，用手机浏览器打开控制台地址，就能在触屏上操作 DSH：看时钟、天气和系统通知，盯住会话与余额，控制正在播放的音乐和系统音量，也能在会话等你回答时直接回复。插件跑在 DSH Desktop / `dsh web` 的 Host 进程里，手机端通过 WebSocket 接收快照，页面不用刷新。

## 界面

四页各管一件事：

| 页面 | 内容 |
|---|---|
| 首页 | 大号时钟与日期、当前天气和小时 / 7 天预报、番茄钟或倒计时、系统通知 |
| 会话 | 账户余额、今日 / 本周消费、作为卡片背景的 7 日消费柱、实时会话与子代理、远程回答 |
| 音乐 | 全屏模糊封面、歌曲信息、进度与 seek、上一首 / 下一首、播放暂停、系统音量与静音、网易云红心 |
| 性能 | CPU / 内存与 GPU / 显存圆环、频率与运行时间、最高温度与传感器列表 |

<p align="center">
  <img src="docs/screenshots/zh/overview.png" alt="首页、会话、音乐与性能" width="1000">
  <br>
  <em>首页 / 会话 / 音乐 / 性能（左上 / 右上 / 左下 / 右下）。每张截图沿右上到左下分割：上方暗色，下方亮色。</em>
</p>

<p align="center">
  <img src="docs/screenshots/zh/question.png" alt="远程提问" width="640">
  <br>
  <em>远程提问：选项、推荐标记与自定义回复。</em>
</p>

- 四页可左右循环滑动，一次手势最多前进 / 后退一页；页面顺序、开关与导航栏位置（左 / 右 / 上 / 下）在 DSH 设置页配置。
- 关闭的页面不出现在手机导航栏，也不再轮询对应数据。
- 横屏下每页固定一屏高，通知、会话、温度传感器列表在卡片内部滚动；竖屏才允许整页上下滚动。
- 手机端提供简体中文与英文。选择 **跟随 DSH** 时精确匹配 DSH 当前语言，没有对应翻译时使用英语。
- 小屏优先使用放大字号与至少 44 px 的触控目标，不使用 hover 过渡或缩放动画。
- 左下角有快速刷新与全屏按钮。

## 安装

仓库只提交源码：`index.js`、`client.js`、`lib/`、`web/`、`native/bin/` 都在本机构建时生成。因此本项目**只支持从 GitHub 源码安装**——clone、构建，再用 `link:` 把源码目录注册到 DSH profile。没有 npm 包，也不要把仓库地址直接填进插件管理器。

前置：DSH（支持第三方 bundle，已在 `0.2.2-rc.1` 验证）、Node.js `>= 22`、pnpm、git；Rust 只在构建原生探针时需要。

```bash
git clone https://github.com/ohmykreee/dsh-remote-control.git
cd dsh-remote-control
pnpm install
```

`pnpm install` 的 `postinstall` 会依次构建 Host、手机端和可选的 Rust 探针。

```bash
# DSH Desktop；dsh web 用 --profile web
dsh plugin --profile desktop add "link:/path/to/dsh-remote-control"
```

Windows 的 spec 建议用正斜杠，例如 `link:D:/path/to/dsh-remote-control`；也可以直接在 DSH 插件管理器里选择从本地路径安装。注册后重启 DSH，侧边栏会出现 **远程控制台**。

完整的前置条件、探针构建、更新、卸载与故障恢复见 [`INSTALLATION.md`](INSTALLATION.md)。

## 连接

- 打开侧边栏 **远程控制台 → 连接**，用手机扫描配对二维码，或复制页面上的控制台地址。手机与电脑需要在同一局域网。
- 默认启用随机访问令牌，地址里的 `?token=` 会在手机上换成 cookie；缺少令牌会返回 401 页面。令牌可以关闭或轮换，轮换会断开所有已连接设备。
- 可以只允许指定网卡 / 子网访问，回环地址始终放行。
- 可选 HTTPS：填写 PEM 证书与私钥路径；证书无效时回退 HTTP，并在连接页显示错误。
- 默认端口 `38765`，可用 `DSH_REMOTE_CONTROL_PORT` 覆盖；端口被占用时回退到随机可用端口。

## 设置

侧边栏 **远程控制台** 的菜单：

| 菜单 | 内容 |
|---|---|
| 连接 | 二维码、控制台地址、开放网卡、链接验证、HTTPS 证书 |
| 偏好设置 | 插件语言、温度单位、主题、页面顺序与开关、导航栏位置 |
| 番茄钟/倒计时 | 启用开关（互斥）、专注 / 休息时长、1–5 个倒计时预设、提示音 |
| 天气设置 | 自动 / 手动位置、城市搜索、小时 / 7 天显示、请求定位权限 |
| 余额显示 | 本周 / 最近 7 天、低余额提醒线、高峰 / 低谷胶囊 |
| 通知设置 | 按应用开关、显示数量（1–20）、推送问询 |
| 软件映射 | 修改应用显示名称或恢复默认 |
| 系统信息 | 服务状态、探针 / Node.js、Profile、已连接设备、诊断 |

设置先在面板里暂存，点右上角 **保存设置** 后一次性提交；应用改名、主题同步、令牌轮换和断开设备是即时操作。

## 番茄钟与倒计时

两者都显示在手机端时钟与天气之间，**互斥**，只能启用一个；关闭后会从手机端整个卸载。计时只在手机浏览器里运行，刷新或关闭页面会丢失当前计时。

| | 番茄钟 | 倒计时 |
|---|---|---|
| 配置 | 专注 / 休息时长，可选「循环响铃直到停止」 | 1–5 个秒级预设（1–86400 秒），默认 3 个 |
| 结束 | 播放提示音，可循环到手动停止 | 卡片变红并显示「时间到」，必须点「确认结束」 |
| 操作 | 开始、暂停、重置 | 选预设、开始、暂停、重置；结束后重置与选预设不可用 |

- 提示音可在 DSH 中配置本机音频文件或 http(s) 链接，留空使用内置的轻柔琶音；倒计时与番茄钟共用。
- 时间到时浏览器标签页会显示绿色提示点，倒计时还会触发手机振动（浏览器支持时）。

## 天气

- 自动模式优先使用系统定位；被拒绝或不可用时回退 IP 定位（`https://ipwho.is/`），再失败使用时区兜底。
- Windows 定位可能被系统隐私开关阻挡。设置页 **天气设置 → 请求定位权限** 会发起申请；被拒绝时自动打开「位置」设置页，授权成功后立即清空定位缓存并刷新天气。
- 手动模式可搜索城市并自动填入名称、纬度与经度，也可以直接编辑坐标；省略行政后缀的城市名（如「厦门」）会自动补「市」再查一次。
- 城市搜索与预报都走 Open-Meteo，由 Host 代理请求，不需要 API Key。温度单位支持摄氏度与华氏度，切换后天气、预报与性能页传感器统一使用完整单位符号。
- 自动模式（本机位置）下，手动位置输入框不可编辑。

## 会话与余额

- 余额来自 DSH 账户接口；用量支持 **本周**（周一 00:00 至今）与 **最近 7 天**（今天及之前 6 个自然日）两种统计窗口。
- 会话页显示近 7 日每日消费柱，柱子直接作为消费卡背景，最高金额日为 100% 高度。
- 会话状态包括运行中（绿）、等待回答（黄）、错误（红）与已结束；导航图标在等待回答或错误时显示黄 / 红提醒点。
- 子代理会话嵌套在派发它的主代理卡片内并向右缩进；运行中的会话显示 DSH 提供的累计已运行时间。
- 余额卡片右上角有高峰 / 低谷胶囊：工作日北京时间 9:00–12:00、14:00–18:00 为高峰（山峰图标）；其余时间、周末与法定节假日为低谷（月亮图标，价格为高峰的一半）。时段判断在手机浏览器中完成，节假日以 timor.tech 返回的数据为准；胶囊可在「余额显示」中关闭。

### 远程回答

开启 **推送问询** 后，等待回答的会话会出现「回答」入口：点击弹出居中的触屏对话框，展示全部问题、选项与自定义回复输入框。单选题点选项即可回复，多选题可多选后提交，也可以填写自定义回复或跳过该题。

- 答案通过 DSH 正常的 `user-questions/request` 瀑布接口回到 Agent；超时后仍可回答的 continued 提问通过 `userQuestions.answer` 提交。
- 只支持 DSH 正常的用户问题（`ask_user_question`）；工具审批仍需在 DSH 中处理，手机端不提供远程审批。
- DSH 自己的提问卡片仍会显示，远程回答后可能需要在该卡片上手动关闭——这是 DSH Web 客户端当前的行为。
- 关闭该开关时，会话页保持只读。

## 音乐

- 已适配网易云音乐、QQ 音乐、酷狗音乐、酷我音乐、汽水音乐、全民 K 歌、Spotify、Apple Music、YouTube Music，以及浏览器 / 其他 SMTC / MPRIS 播放器。
- 媒体读取先识别播放软件：命中内置 vendor 适配时进入对应软件的逻辑，未命中才使用系统接口。系统接口在 Windows 为 WinRT SMTC，Linux 为 MPRIS，macOS 为 `nowplaying-cli` / AppleScript（源码级实现）。
- 音乐页显示专辑封面、全屏模糊背景、歌曲信息、进度、上一首 / 下一首、播放暂停、系统音量与静音；网易云红心在 CDP 可用时可点击切换。封面支持 data URL 与 http(s) URL，后端未返回封面时显示占位。
- 进度条由 `SeekBar` 按 shadcn 控件视觉自实现，用 100 ms 本地时钟推进，不被缓存快照拉回；播放时已走进度显示为向前推进的正弦波，暂停、拖动或时间轴不可用时收平为直线。读不到进度时不伪造。触摸拖动松手后只提交一次 seek。
- 自动 seek 与音量会短暂保持目标值，避免播放器状态回传造成跳回。

**可拖动 seek 的来源**：

| 来源 | 进度条 | 拖动 seek |
|---|---|---|
| 完整系统会话（SMTC / MPRIS / MediaRemote） | 有 | **有** |
| 网易云 CDP-only（SMTC 不存在） | 有 | 否 |
| 系统会话不完整（`smtc-partial`） | 有时长时有 | 否 |
| 私有窗口标题 / Cider 标题 | 有则显示 | 否 |
| UI Automation / AX | 有则显示 | 否 |

判定「完整系统会话」需要标题、有效时间轴（`EndTime > StartTime > 0`）、播放器允许定位，并且实际收到过非零位置；部分旧客户端还会额外校验位置证据。

### 网易云音乐

- 系统接口可用时，由它提供元数据、封面、播放状态与传输控制；CDP 只补精确进度和红心。
- 系统接口完全不可用但 CDP 可用时，歌曲信息、封面 URL、进度、红心与播放控制全部走 CDP，但 **CDP 不授予 seek**。
- 两者都不可用时回到窗口 / UIA 兜底，仍取不到就返回空，不伪造信息。
- 未开启 CDP 时红心显示为未知，不读取本地数据库。CDP 只监听本机回环地址，不调用外部数据接口、不导出 Cookie。开启方式见 [`INSTALLATION.md`](INSTALLATION.md#网易云音乐-cdp可选红心精确进度)。

不调用外部歌曲 / 封面数据 API：网易云在 SMTC 开启时封面来自 SMTC，CDP-only 时使用客户端歌曲数据里的封面 URL（由控制端浏览器直接加载并缓存），仅窗口标题兜底路径才使用本地缓存。

## 性能

- 左侧两张卡片分别显示 CPU / 内存和 GPU / 显存，占用率使用圆环；下方小卡片显示当前频率、运行时间、已用 / 可用内存、显存和核心 / 显存频率。
- 右侧温度栏保留大号最高温度与传感器热区背景，GPU 核心温度、磁盘温度与 ACPI 热区在同一列表内；传感器多时在卡片内滚动。
- CPU 温度仅能来自 ACPI 热区，未暴露时显示「未提供」，不伪造读数。
- 性能数据由可选的原生探针读取。探针不可用时，CPU / 内存用纯 JS 兜底，GPU 与温度显示为空 / 错误状态；性能页关闭时不执行 GPU / 温度探测。

## 通知与软件映射

- Windows 读取通知中心数据库并原样上报应用标识；Linux 通过 D-Bus 监视通知；macOS 读取通知中心数据库（源码级，未实测）。中文名称由 Node 侧的软件映射生成。
- 插件维护 `app-mapping.json`，记录出现过的应用、来源（通知 / 音乐）、首次 / 最近出现时间与通知计数，并保存用户改写的名称。
- 通知头像支持 data URL 与 http(s) 图片。
- 内置默认名称覆盖常见的 Windows 应用（QQ、哔哩哔哩、Discord、Terminal、VS Code、Edge、Outlook 等），其余按可执行文件名、AUMID、MPRIS 名称自动推导。
- DSH 设置页 **软件映射** 可逐个改名或恢复默认，保存后立即用于手机端通知与音乐来源标签；旧版 `notification-cache.json` 会在首次启动时自动迁移。
- **通知设置** 可为每个应用单独开关通知、限制显示数量（1–20），并控制是否推送问询。

## 安全与隐私

- 默认随机令牌；可关闭或轮换，轮换会断开所有 WebSocket。可限制允许访问的网卡 / 子网，回环地址始终放行。
- 可选 HTTPS；证书无效时回退 HTTP 并显示错误。所有写接口额外校验 `Origin` 与 `Host` 一致，请求体上限 64 KiB。
- 设置保存在 `DSH_HOME/remote-control/settings.json`（存在 `DSH_PROFILE_DIR` 时优先使用该目录）；应用历史与映射保存在同目录 `app-mapping.json`。
- 仓库不包含本机路径、令牌、证书或通知内容，没有遥测。
- 外部请求只出现在显式功能里：天气与城市检索走 Open-Meteo，IP 兜底走 ipwho.is，法定节假日走 timor.tech；其余数据都在局域网内由 Host 提供。

## 平台支持

| 平台 | 支持情况 |
|---|---|
| Windows | 完整支持。Rust 探针提供 SMTC 媒体与控制、Core Audio 音量、DXGI / PDH / WDDM 性能与温度、通知中心、WinRT 定位；无 PowerShell / C# 回退。 |
| Linux | 完整支持。MPRIS、`wpctl` / `pactl` / `amixer` 音量、sysinfo / sysfs 性能、D-Bus 通知监视、GeoClue2 定位；GPU 仅支持 NVIDIA / AMD。 |
| macOS | 源码级实现，未在实机与 CI 验证。提供媒体 / 音量 / 性能 / 通知，GPU 与温度不实现，定位回退 IP。 |
| 手机端 | 现代浏览器，WebSocket 可用；布局优先 1280×800 横屏。 |

## 已知限制

- Rust 探针需要在本机构建，仓库不含二进制；未构建时媒体、音量、通知、GPU 与温度显示「探针不可用」，系统定位回退 IP / 时区，CPU / 内存仍可用。
- Windows 位置需要系统隐私授权与 Medium 完整性；低完整性工作区会永久拒绝定位，需要按安装文档修复。
- 私有媒体层（窗口标题 / Cider 标题）只读：能展示歌曲与进度，但控制仍依赖完整 SMTC / MPRIS；无障碍层永远不授予 seek。
- 网易云 CDP 的 store 依赖页面 webpack runtime，页面刷新后注入不保证成功，此时回退到播放条 DOM；切歌瞬间可能短暂读不到进度。
- 会话页只读；媒体与音量可写；工具审批不能远程处理。
- 番茄钟与倒计时只在手机浏览器标签页中运行，刷新或关闭页面会丢失。
- 布局优先保证 1280×800 横屏；竖屏为紧凑降级。

## 文档

| 文件 | 内容 |
|---|---|
| [`INSTALLATION.md`](INSTALLATION.md) | 安装、构建、原生探针、更新、卸载、故障恢复 |
| [`docs/README.en.md`](docs/README.en.md) | English README |
| [`AGENTS.md`](AGENTS.md) | 架构、协议、构建与测试；面向开发者与 agent |

缺陷与需求走仓库 Issues。

## 许可证

[MIT](LICENSE)。Inter、Noto Sans SC、JetBrains Mono 使用 SIL Open Font License 1.1（`static/fonts/LICENSE.txt`，构建后位于 `web/fonts/LICENSE.txt`）。界面组件来自 MIT 许可的 shadcn-svelte 与 bits-ui，图标来自 ISC 许可的 Lucide；媒体适配层参考的 [Widdit/now-playing-service](https://github.com/Widdit/now-playing-service) 为 MIT。
