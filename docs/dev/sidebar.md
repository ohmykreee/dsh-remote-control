# DSH 侧边栏（React）

[← AGENTS.md](../../AGENTS.md)

侧边栏源码在 `src/dsh/client`，编译成单个 `client.js`，由 DSH 模块加载器执行。bundle / 入口契约见 [`architecture.md`](architecture.md)，快速问答设置页见 [`quickqa.md`](quickqa.md)。

## 代码形态

- 不用 JSX，统一 `React.createElement`（`h`，见 `ui.ts`）；React 由 DSH loader 提供。
- 入口 `index.ts` 注入 `slots` / `locale` / `theme`，注册：
  - `sidebar.panellist` 的图标入口（`PanelIcon`）；
  - `main` 面板（`RemotePanel`）；
  - 三份字典（`ctx.locale.register`）。
- 语言与主题同步都在 `apply()` 的 `ctx.effect()` 里：`POST /api/locale`、`POST /api/theme`；卸载时反注册。
- `api.ts` 是环回 API 封装；`types.ts` 是线格式；`logic.ts` 是纯函数（草稿合并、保存补丁、页面顺序、模型选择）；`styles.ts` 是全部 CSS；`sections/` 是九个设置节。

## 面板状态机

`panel.ts`：

- 加载 `/api/settings` 后进入 `SettingsPayload`；失败显示错误，不阻塞其他节。
- 所有编辑先写入 `staged`（`DraftState`），`buildSettingsView(saved, staged)` 合成显示值；点「保存设置」才 `POST /api/settings` 一次性提交（`buildSavePatch`）。
- 即时请求（不进 `DraftState`）：应用改名、主题同步、令牌轮换、断开设备。
- 刷新服务器统计（`refresh`）不能丢掉未保存的草稿。
- 菜单固定为九节：连接、偏好设置、快速问答、番茄钟 / 倒计时、天气设置、余额显示、通知设置、软件映射、系统信息。
- 窗口窄于 767px 时导航由 `matchMedia` 切换为原生 `<select>`。

### 提示内跳转

- 部分 hint 用 `LinkedHint`（`ui.ts`）在句子里嵌入跳转短语：短语的文案单独放在 i18n 字段（如 `secureContextLink`），句子用 `{字段名}` 占位；`HINT_LINKS` 统一声明占位字段对应的目标设置。
- 链接只比周围 hint 多一条下划线，颜色 / 字号 / 字重一致，没有 hover 效果；点击后 `PanelApi.jump()` 切到目标节，滚动到带 `data-drc-anchor` 的行 / 分组标题，并加 `drc-flash`。闪烁层由 `::before` 绝对定位铺满卡片整行，CSS 闪三次后自行透明；重复跳转时移除再添加 class 重启动画。新增跳转目标时同时补 `JumpTarget`、`JUMP_SECTIONS`、锚点和 `HINT_LINKS`。

### 草稿与保存

- 设置页只改 `staged`，不直接发请求；保存补丁由 `buildSavePatch()` 统一构造，避免各节自己拼 JSON。
- 无失焦自动 clamp 的手动输入统一由 `checkDraftIssues()` 校验（证书 / 私钥路径在 HTTPS 开启时必填、可信反向代理、和风天气 ID / 主机 / 私钥、提示音路径 / 链接）。任一项不合格时禁用 **保存设置** 并显示横幅；分钟 / 倒计时预设、低余额提醒线、通知显示数量、自定网页地址、和风天气月调用上限 / 刷新间隔在失焦时才 clamp，不参与禁用保存。
- 应用改名、令牌轮换、断开设备是独立按钮，点击即发请求并刷新快照。
- 保存后的语言要立即 `setPluginLanguage()` 重绘；不要等下一次 `hydrate()`。

## 各节要点

### 连接

- 配对二维码、控制台地址、打开 / 复制。
- 网卡列表：保存时提交显式网卡名，不提交 `null`。
- 访问验证开关与轮换；轮换会断开所有设备。
- TLS 开关要求证书 / 私钥路径已填；保存后 Host 可能动态重启，页面保留在旧地址。HTTPS 开启但路径为空时输入框标红并阻止保存。
- HTTPS 证书卡片内还有「可信反向代理 IP」：英文逗号分隔的 IP / 网段，格式不合格时提示并阻止保存。
- 「高级功能」卡片始终显示；唤醒锁开关独立于 HTTPS，不要和 TLS 开关联动。

### 偏好设置

- 第一组是插件语言：跟随 DSH / 简体中文 / English。
- 温度单位、主题（跟随 DSH / 浅色 / 深色）。
- 「主题与页面」卡片在主题分段控件下有一条分割线，下面是页面主题色：标题下用一行 hint 说明手机端页面使用该颜色作为主题色；原生 `<input type="color">` 选色，未设置时只显示取色块，预览手机端当前主题的内置强调色（`defaultPageThemeColor()`），保存空值即保持默认配色。选过颜色后才显示十六进制值与「恢复默认颜色」。颜色写入 `StagedSettings.pageThemeColor`，随页面配置一起保存；不要写进 `DraftState`。
- 页面顺序：可拖动排序，末尾是「自定网页」；自定网页地址存在 `DraftState.customPageUrl`，随页面配置一起保存；页面关闭时输入框禁用。地址留空或失焦时校验失败会清空，手机端随后使用内置地址（`kre3.net`），侧边栏不写死该默认值。
- 导航栏位置 `left` / `right` / `top` / `bottom`。

### 快速问答

见 [`quickqa.md`](quickqa.md#侧边栏sectionsquickqats)：

- 语音未就绪时后续控件禁用但保留保存值；
- 模型 / 思考强度、工作区置顶与模式、图片开关的可用条件；
- 保存时只保留默认 / 置顶工作区的 profile。

### 天气

- 排列顺序：定位权限 → 数据提供商 → 和风天气 JWT（仅选中时）→ 位置 → 显示方式。
- 位置只提供城市搜索；匹配到的坐标 / 站点 ID 只显示为提示，不提供名称 / 经纬度输入框。
- 城市搜索用 `POST /api/geocode` 携带当前编辑中的 provider 与和风凭据，因此切换提供商后不必先保存。
- 和风天气分组可生成 Ed25519 密钥对、填入私钥、显示 / 复制公钥；JWT 由 Host 按请求生成。
- 月调用上限为正整数，最大为 `Number.MAX_SAFE_INTEGER`；小数、负数、非数字失焦后回到默认 47500，超过上限回到上限。
- 刷新间隔低于调用上限算出的最小值时仍按用户输入保存，输入框不标红，只在下方显示红色提示可能超出月调用上限。0、小数、负数、非数字或超过 1440 的失焦后回到默认 30。
- NMC 没有逐小时预报，显示方式强制为 7 天；切换提供商时保存补丁也要把 `forecastMode` 归一化。
- 系统信息页的天气状态 detail 显示实际使用的提供商。

### 通知与软件映射

- 通知：应用开关、数量上限、远程回答开关。数量上限不在 1–20 时，失焦后回到默认值 5。
- 软件映射：应用列表上方提供本地搜索，按已保存的应用名称或应用 ID 实时过滤；只过滤当前 UI，不发请求。改名 / 恢复默认是即时请求。

### 系统信息

- 服务状态：通知、媒体、音量、性能、定位、天气。
- 已连接设备：显示 label / IP / 在线时长，可断开单个客户端；设备名旁的感叹号图标在悬停时显示原始 User-Agent。访问验证开启时按钮文案是「断开并轮换」，因为 Host 会同时轮换令牌；文案跟随已保存的开关，不是草稿状态。
- 诊断信息：协议、profile、插件版本、探针版本 / 路径 / 错误、Node 版本 / V8 / 平台 / 内存。
- 媒体详情直接显示后端返回的 `providerDetail`（无媒体时显示平台媒体后端），不在前端翻译。

## 样式

- `styles.ts` 按 DSH 设置页的 188px 导航、54px 顶栏、卡片分组与 14px 行文字实现。
- 只读取 `--dsw-*` 令牌；`--drc-*` 仅为旧版 DSH 缺失令牌提供回退。不要复制宿主颜色值。
- 按钮、Badge、Slider、Dialog、ScrollArea 等优先复用已有 UI 组件；只在组件原有 class 上覆盖样式。
- 没有 hover 过渡 / 缩放动画。

## 本地化

- 用 `useTranslator()` 渲染；字典在 `i18n.ts`，`DICTS` 固定为 `{ zh, en }`。
- `en` 是 `Record<string, string>`，缺键会在运行时回退到 key 或英文；新增文案时人工核对两份字典。Host 与手机端有编译 / 测试约束，侧边栏没有。
- 改文案后重新构建 `client.js`，否则面板仍用旧字典。
- 模式 / 权限行为的显示名直接使用 Host API 返回值，不在侧边栏翻译。

## 检查

- `pnpm check` 包含 `tsconfig.dsh-client.json` 的 `tsc --noEmit`；没有单独的侧边栏单元测试。
- 改设置字段时同步 `types.ts`、`logic.ts` 的 `buildSavePatch` / `buildSettingsView`、对应 `sections/*` 和 `README.md` 菜单说明。
