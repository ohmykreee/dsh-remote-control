# 手机端（Svelte）

[← AGENTS.md](../../AGENTS.md)

手机端源码在 `src/svelte`，构建到 `web/`，由 Host 的 LAN 端口提供。帧格式见 [`protocol.md`](protocol.md)，快速问答见 [`quickqa.md`](quickqa.md)。

## 入口与构建

- `src/svelte/index.html` → `main.ts` → `App.svelte`。
- Vite：`root = src/svelte`、`publicDir = static`、`build.outDir = web`、`assetsDir = assets`、`emptyOutDir = true`、`target = es2022`、无 sourcemap。
- 技术栈：Svelte 5 runes + Vite 8 + Tailwind CSS v4 + shadcn-svelte（bits-ui）+ Lucide。
- 字体由 `@fontsource-variable/*` 打进 `web/assets/`，不依赖手机系统字体；许可见 `web/fonts/LICENSE.txt`。

## 页面与导航

- 页面：`HomePage`、`SessionsPage`、`QuickQaPage`、`MusicPage`、`PerformancePage`、`CustomPage`；导航在 `Rail.svelte`。
- 页面顺序与开关来自 `settings.pageOrder` / `pageEnabled`；关闭的页面不渲染、不轮询。
- 分页容器在 `App.svelte`：每页 `scroll-snap-stop: always`，一次手势最多前进 / 后退一页；首尾克隆页用于无限循环。
- 深链 `?page=<key>` 只在初始加载时生效；`restoreUrl()` 会把 `token=` / `page=` 从地址栏清掉，避免 token 留在历史记录里。
- 横屏固定一屏高，通知 / 会话 / 温度列表在卡片内滚动；竖屏整页滚动。
- 左下角刷新 / 全屏按钮；导航位置支持 `left` / `right` / `top` / `bottom`。

## 状态模块

| 模块 | 规则 |
|---|---|
| `state.svelte.ts` | 持有 WebSocket 快照、设置、页面状态；`applySettings()` 应用语言 / 主题 / 计时器 / 唤醒锁 / 自定义地址 |
| `ws.ts` | 连接与重连；`sendLive()` 在断开时返回 false |
| `media.ts` | 播放状态、可 seek 判定、进度钳制 |
| `session-tree.ts` | 父子会话分组、孤儿 / 环路兜底 |
| `quickqa.svelte.ts` | 快速问答阶段、选区、流式回答、问询浮层 |
| `quickqa-audio.ts` | 默认麦克风采集、电平、16 kHz 单声道 PCM16 WAV、上传转写 |
| `quickqa-image.ts` | 剪贴板 / 媒体选择器 / 伴侣截图、MIME 归一化、上传、预览 URL |
| `image-zoom.ts` | `photoswipe` 灯箱 |
| `pomodoro.svelte.ts` / `countdown.svelte.ts` | 各自的计时状态机；共用 `timer-engine.ts` 与 `timer-alarm.svelte.ts` |
| `wake-lock.ts` | 屏幕唤醒锁 |
| `reduced-motion.svelte.ts` | 镜像 `prefers-reduced-motion` |
| `billing.svelte.ts` / `billing.ts` | 峰谷 / 节假日；`billing.ts` 是纯规则 |
| `settings-normalize.ts` / `pages.ts` / `format.ts` / `weather.ts` | 纯函数工具 |

### 回答往返

`submitQuestionAnswer()` 发 `answer-question` 后等 12 s 的 `answer-result`；超时或 socket 断开时 reject 所有等待者，避免问询面板永远转圈。

### 计时器

- 番茄钟与倒计时互斥；Host 侧也强制，手机端仍要镜像一次。
- 计时用绝对 `endsAt` 加 250 ms tick 计算，页面切换不会丢时间。
- 所有页面克隆（首尾克隆）各持一个 `timer-engine` 引用；最后一个释放才停表，避免克隆页卸载时误停。
- 后台标签会节流计时器，`timer-engine` 在 `visibilitychange` 时立刻补一次 tick。
- 提示音：番茄钟可循环，倒计时响到用户确认结束；非 URL 路径走 `/api/pomodoro/sound`，远程音频依赖 CSP `media-src`。
- 手机端只在浏览器里计时，刷新 / 关闭页面即丢失。

### 音乐进度

- `SeekBar.svelte` 视觉同 shadcn Slider，但拖动轨道自行实现；100 ms 本地时钟推进，松手只提交一次 seek。
- `canSeek` 只是其中一个条件：`isSeekable()` 还要求 `positionReported === true`（Host 在 `media/enrich.ts` 里设置）；两者都满足才可拖动。
- 后端快照的 `position` 比上一份低超过 1 s，视为播放器内手动 seek 并重新锚定；重复 / 缓存的同值快照不会触发。
- 无可拖动时间轴时用只读轨道：无时间轴显示 100% 与 `--:--`；有进度但不可 seek 时只展示进度。
- 播放波形的静止值用 `scaleY(0.001)`，不要用 0——singular scale 会把路径裁掉。
- 每页只挂载可见的进度条时钟（`IntersectionObserver`），离屏页面不跑 10 Hz 更新。

### 唤醒锁

- `wake-lock.ts` 按 `settings.tls.advanced.wakeLock` 直接请求，不预检 `isSecureContext`；申请失败静默忽略。
- 页面隐藏时释放，回到前台重新申请；设置切换时如请求还在飞，会在结束后重试一次。
- 该开关独立于 HTTPS 开关；Host 原样下发。

## 自定网页 iframe

- 地址来自 `settings.customPageUrl`；裸主机补 `https://`，只接受 http(s)，留空回落到内置地址。
- 手机端页面为 HTTP 时可以直接嵌入 `http://` 地址；切到 HTTPS 后浏览器会按混合内容拦截 `http://` iframe（CSP 的 `frame-src http:` 不能覆盖混合内容规则），Host 不会改写用户填写的协议。
- 目标站点返回 `X-Frame-Options` 或 CSP `frame-ancestors` 限制时同样显示空白，跨域下无法检测。
- iframe 与容器都透明，页面本身无边框 / 圆角 / 阴影；设 `color-scheme: normal`，避免继承控制台深色方案后透明文档被绘制成白底。
- 自定网页默认关闭；关闭时地址输入框保留但禁用。

## 视觉与文案

- `Panel` 包装 shadcn Card 作为统一容器；按钮、Badge、Slider、Dialog、ScrollArea 优先用 `$lib/components/ui`；图标统一 Lucide。
- 只在组件原有 class 上覆盖样式；没有 hover 过渡 / 缩放。
- 开启「减少动态效果」时：导航点按直接换页，音乐进度收平，麦克风电平环与加载动画静止；手势滑动不受影响。
- 文案全部走 `t()`（`i18n.svelte.ts`）；日期用 `localeTag()`；`applySettings()` 调 `setLocale()`，切换语言无需刷新。
- 例外：农历日期与节气只对中文有意义，`format.ts` 在非中文时返回空；`sourceLabel` 里的品牌名不翻译。
- `<html lang>` 初始为 `en-US`，收到第一个设置快照后才切到实际语言；不要在 `index.html` 里写死中文。

## 浏览器限制与 CSP

Host 的 CSP 决定了哪些资源能加载：

- `img-src`：http(s) 远程封面 / 头像，以及 data URL。
- `media-src`：远程提示音。
- `frame-src`：自定网页 iframe 的 http(s) 地址。
- `connect-src`：WebSocket 与节假日 API（`https://timor.tech/api/holiday/year`）。

手机端要记住：

- 麦克风、剪贴板、唤醒锁通常需要安全上下文（HTTPS 或本机回环）。不要在代码里预检 `isSecureContext` 来隐藏入口；直接尝试，失败给可操作提示。
- 混合内容与 `X-Frame-Options` 无法在跨域下探测，不要假装能检测。
- 音乐封面用 `<img referrerpolicy="no-referrer">`；后端没有封面就显示占位，不伪造。
- iframe 使用 `referrerpolicy="no-referrer"`，地址白名单在 `pages.ts` 里只放行 http(s)。

## 快速问答页

页面结构、阶段机、附件与伴侣桥接见 [`quickqa.md`](quickqa.md)。这里只强调与手机端结构相关的规则：

- 麦克风只使用默认输入设备；录音转 16 kHz 单声道 PCM16 WAV 后上传。
- 图片只在浏览器内存里，转写成功后才上传；Host 返回 409 / 413 / 415 时分别按不允许 / 过大 / 格式不支持提示。
- 任何 `quickqa-state` 的 `error` 都会清空当前会话并退回初始页；不要加“重试”按钮，下一次按住麦克风就是新会话。
- 伴侣桥接只属于手机端；相关文案只进手机端字典。

## 测试

`pnpm test:unit`（`vitest run`，配置在 `vitest.config.ts`：`environment: node`，只扫 `test/svelte/**/*.test.ts`，`$lib` 指向 `src/svelte/lib`）。

- 只测无 runes、无 DOM 的纯函数；导入源码时写 `.ts` 后缀。
- 个别测试会 stub `window` / `navigator`（如 `quickqa-image.test.ts`），但不要依赖真实浏览器。
- 计时器、WebSocket、`billing.svelte.ts` 的 rune / 网络逻辑不在单元测试范围内；改这些时用 `pnpm shot` 或 mock 预览验证。
- 相关文件：`session-tree.test.ts`、`pages.test.ts`、`media.test.ts`、`billing.test.ts`、`settings-normalize.test.ts`、`quickqa-image.test.ts`。
