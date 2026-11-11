# dsh-remote-control

把同一局域网内的手机浏览器变成 DeepSeek Harness 的触屏中控台。插件运行在 DSH Desktop 的 Host 侧，手机端通过 WebSocket 接收实时状态。

主布局面向 **1280×800 横屏**：左侧导航栏、深蓝配色、大号时钟、分区卡片。手机端没有网站 Logo、标题栏和设置入口，内容直接开始。

## 截图

手机端控制台，1280×800 横屏（截图使用随机生成的演示数据）：

| 首页 | 会话 |
|---|---|
| ![首页](docs/screenshots/home.png) | ![会话](docs/screenshots/sessions.png) |
| **音乐** | **性能** |
| ![音乐](docs/screenshots/music.png) | ![性能](docs/screenshots/performance.png) |

## 页面

| 页面 | 内容 |
|---|---|
| 首页 | 时钟、日期、天气、小时/7 天预报、Windows 通知列表、应用头像 |
| 会话 | 余额、今日/7 日消费、7 日金额背景柱状图、DSH 实时会话、运行/等待/错误/结束状态 |
| 音乐 | 专辑封面、全屏模糊背景、歌曲信息、进度与 seek、上一首/下一首、播放暂停、系统音量、网易云红心、全屏 |
| 性能 | CPU、内存、GPU、显存、系统可读温度传感器 |

- 四页可左右循环滑动：最后一页继续滑到第一页，反向同理。
- 横屏下每页固定为一屏高，通知、会话、温度传感器列表在卡片内部滚动；竖屏才允许整页上下滚动。
- 页面顺序和开关在 DSH 设置页配置；关闭的页面不会出现在手机导航栏，也不会继续轮询对应数据。
- 会话页左侧余额、消费、状态三个卡片在紧凑视口中保持完整可见；会话列表独立滚动。

## DSH 侧边栏

侧边栏入口名为 **远程控制台**，使用 DSH 原生设置页风格：单级左侧菜单、右侧独立滚动内容区。

菜单：

1. **连接**：配对二维码、控制台地址、打开/复制链接。
2. **插件设置**：开放网卡、链接令牌、温度单位、主题、页面顺序与开关、HTTPS 证书。
3. **天气设置**：自动定位或手动位置、小时/7 天显示。
4. **余额显示**：本周/最近 7 天统计、低余额提醒线。
5. **通知设置**：通知应用筛选、显示数量（1–20）。
6. **系统信息**：服务状态、已连接设备、诊断信息。

### 批量保存

所有设置先在本地暂存，修改开关、主题、页面顺序、天气、余额等不会立即提交。点击右上角 **保存设置** 后一次性提交并生效。

页面顺序支持拖拽：

- 拖动时原选项折叠消失，目标位置出现虚线占位。
- 拖到列表底部的投放区可以移动到末尾。
- 每行右侧开关控制该页面是否启用。

## 实时通信

手机端使用原生 WebSocket，地址为 `/ws`，不使用 HTTP 轮询。

- 连接后 Host 发送 `welcome`、`overview`，以及已启用页面对应的 `media` / `performance` 初始快照。
- 会话、通知、余额、天气、媒体、性能由 Host 主动推送。
- 音乐操作（播放暂停、切歌、seek、音量、静音、红心）通过 WebSocket 发送。
- 手机端 HTTP 只用于首次页面、CSS、脚本、字体和天气图标。
- 手机端字体由 Host 自托管：Inter（拉丁与数字）、Noto Sans SC（中文）、JetBrains Mono（数字与等宽）；不依赖手机系统字体。字体许可为 SIL OFL 1.1，见 `web/fonts/LICENSE.txt`。
- 首页时钟、日期与问候语直接读取手机本地时间，WebSocket 不传输电脑时间。
- 没有连接设备时停止推送循环；单页被关闭时跳过该页轮询。

## 天气

- 自动模式优先使用 Windows 定位，失败后使用 IP 定位，再失败使用时区兜底。
- 手动模式保存名称、纬度、经度。
- 温度单位支持摄氏度（°C）与华氏度（°F）；在 DSH 插件设置的「温度单位」中切换后，天气、小时/7 天预报以及性能页传感器统一使用完整单位符号。
- 天气数据来自 Open-Meteo，无需 API Key。
- 图标来自 [`hasscc/tianqi`](https://github.com/hasscc/tianqi) 使用的彩云动态图标集：
  - 大天气图标为无描边填充样式。
  - 小时/7 天小图标和背景水印为静态线框样式。

## 余额与会话

- 余额来自 DSH 账户接口。
- 用量支持两种统计窗口：
  - **本周**：周一 00:00 至今。
  - **最近 7 天**：今天及之前 6 个自然日。
- 会话页显示近 7 日每日消费柱状图；柱子直接作为消费卡背景，最高金额日为 100% 高度。
- 会话状态包括：运行中（绿）、等待回答（黄）、错误（红）、已结束。
- 会话导航图标在等待回答或错误时显示黄/红提醒点。

## 音乐与网易云

- Windows SMTC 提供当前媒体、播放状态、封面、进度和可用控制。
- 只有 SMTC 报告完整时间轴、允许定位，并且实际收到过非零播放位置时，进度条才可拖动；网易云的私有进度/估算时间轴只显示进度，不可 seek。
- 进度按 SMTC 的 `Position` 与 `LastUpdatedTime` 投影，并对轮询间的偏差做平滑修正，避免进度条回跳。
- 网易云封面从客户端本地 `Statics` 图片缓存读取，不调用网易云 URL 接口，也不提取 Cookie。
- 网易云喜欢的歌曲状态从客户端本地数据库读取。
- 网易云不通过 SMTC 报告时间轴时：
  - 能匹配本地曲目时使用本地时长。
  - 匹配不到时使用 4 分钟估算时间轴，并由播放时钟推进。
- 自动 seek/音量会短暂保持目标值，避免播放器状态回传造成跳回。
- 可选红心写入：如果网易云以 `--remote-debugging-port=9229`（或 `DSH_NETEASE_DEBUG_PORT` 指定的端口）启动，按钮可通过客户端本地 DevTools 接口写入喜欢状态；否则只显示本地状态。

## 性能

- 布局：左侧上方为 CPU / 内存组合卡，下方为 GPU / 显存组合卡，右侧单列显示温度传感器。
- CPU 使用率：Node `os.cpus()` 差分计算。
- 内存：Node `os.totalmem()` / `os.freemem()`。
- GPU 使用率、显存：Windows GPU 性能计数器，主显卡和总显存从显示适配器与注册表读取。
- 温度：枚举 ACPI 热区，以及可选的 LibreHardwareMonitor / OpenHardwareMonitor 传感器。
- 系统没有暴露温度传感器时，页面显示“0 个传感器”，不会伪造读数。
- 性能页关闭时不执行 GPU/温度探测。

## 安全

- 默认生成随机访问令牌，可关闭或轮换；轮换会断开现有设备。
- 可只允许指定网卡的子网访问；回环地址始终放行。
- 可选 HTTPS：填写 PEM 证书和私钥路径；无效证书会回退 HTTP 并显示错误。
- 设置保存在 `DSH_HOME/remote-control/settings.json`（存在 `DSH_PROFILE_DIR` 时优先使用该目录）。
- 通知应用缓存保存在同目录 `notification-cache.json`。
- 仓库不包含本机路径、令牌、证书或通知内容。

## Windows 桥接

Windows 的 SMTC、Core Audio 和 WinRT 定位没有稳定的纯 Node API：

- `lib/win/scripts.js` 以 JS 字符串保存固定的 PowerShell 探针。
- `lib/win/bridge.js` 调用系统自带 PowerShell，解析 JSON 输出。
- 其余 Host 逻辑、HTTP/TLS、WebSocket、通知数据库、账户解析均为 JavaScript。

需要引入原生 Node 扩展；当前实现选择零依赖的系统桥接。

## 平台

- **Windows**：通知中心、SMTC、Core Audio、Geolocation、GPU/温度。
- **macOS**：通知、媒体适配器。
- **Linux**：GNOME/KDE 通知与媒体适配器；不同发行版能力不同。
- 手机端：现代浏览器，WebSocket 可用。

## 目录

```text
index.js                Host 入口、DSH webServer 路由
client.js               DSH 侧边栏设置页
lib/service.js          HTTP/WebSocket、配对、设置、推送
lib/ws.js               最小 RFC6455 WebSocket 服务
lib/account.js          余额、今日/7 日用量
lib/sessions.js         DSH 会话与待回答/错误状态
lib/weather.js          定位、Open-Meteo、7 天预报
lib/performance.js      CPU/内存/GPU/温度
lib/netease.js          网易云本地封面/红心/时长
lib/notifications.js    Windows 通知中心读取
lib/win/bridge.js       Windows 系统桥接
lib/win/scripts.js      Windows 探针（JS 字符串）
web/                    1280×800 手机端控制台
web/fonts/              自托管字体（Inter / Noto Sans SC / JetBrains Mono）
web/weather-icons/      彩云天气图标
docs/                   1280×800 手机端控制台截图
vendor/qrcode.cjs       配对二维码
```

## 开发检查

```powershell
node --check index.js
node --check client.js
node --check web/app.js
node test/smoke.mjs
node test/media-progress.mjs
```

`test/smoke.mjs` 使用临时 `DSH_PROFILE_DIR` 启动服务，检查令牌页面、WebSocket welcome/overview，并确认旧 HTTP overview 路由不存在。

## 已知限制

- SMTC 封面依赖播放器暴露缩略图；网易云使用本地缓存兜底。
- 网易云红心写入依赖本地调试端口；未开启时仅显示状态。
- 温度取决于主板/驱动是否暴露传感器。
- 手机端布局优先保证 1280×800 横屏；竖屏使用紧凑降级布局。
- 会话页只读；媒体和音量可写。

## 许可证

MIT。`web/fonts/` 下的 Inter、Noto Sans SC、JetBrains Mono 使用 SIL Open Font License 1.1，完整许可见 `web/fonts/LICENSE.txt`。
