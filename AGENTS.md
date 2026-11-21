# AGENTS.md

本文件面向在本仓库工作的开发者与 agent。终端用户文档见 [`README.md`](README.md) 与 [`docs/README.en.md`](docs/README.en.md)；安装、更新与排障见 [`INSTALLATION.md`](INSTALLATION.md)。

**先读本页的硬规则和文档地图，再按需打开 `docs/dev/` 下对应的文件。** 不要一开始通读全部文档。

## 硬规则（先记住）

1. 这是 **DSH bundle 插件**，不是普通 npm 包。仓库只提交源码；`index.js`、`client.js`、`lib/`、`web/`、`native/bin/` 必须在本机构建。
2. 上述路径以及 `.build/`、`.mock-web/`、`.probe-tmp/` 都是生成物：不要手改，也不要提交。
3. npm 包只由 `.github/workflows/publish-npm.yml` 在推版本标签时发布。不要在本机手工 `npm publish`；不要在清单里加 `preinstall` / `install` / `postinstall` / `prepare`；不要在文档里引导 `github:` 或仓库 URL 直接安装。
4. Rust 探针是唯一的 OS 探测层。Node 侧不要引入 PowerShell / C# / playerctl / osascript 回退；探针缺失必须是显式的「不可用」状态。唯一例外：`performance` 在探针缺失时用 `os.cpus()` / `os.totalmem()` 兜底 CPU / 内存。
5. 用户可见文案必须进 i18n 字典；不写死中文。改文案时同步侧边栏、Host、手机端三份运行时字典，并重新构建对应产物。
6. 媒体客户端专属逻辑（CDP、红心、私有控制、页面身份、封面）只能放在 `src/rust/src/media/vendor/<client>.rs` 和 `vendor/mod.rs` 的分派里；平台层、`media/mod.rs` 与 Node 侧不得出现 `App::Xxx` 特例。
7. 所有实现 DSH 客户端行为的功能（快速问答、侧边栏、会话与问询等）都只经 DSH 公开服务与事件，不读内部实现：快速问答用 `speechController` / `sessionController` / `llm` / `permissionPresets` 等，会话与问询用 `sessions` / `agents` / `userQuestions`，侧边栏用 `locale` / `theme` / `slots`。通过 `ctx.get` / `ctx.on` 或 `ctx` 上注入的服务解析并做结构校验；不要 import DSH 内部模块、读 provider 注册表、绕过服务直连模型 / DSH HTTP API，也不要复制 DSH 客户端的私有实现。**在创造模式下查公开调用点**：先用 `cordis_inspect_list` 看当前有哪些 Inspect Provider，再用 `cordis_inspect_query` 按 `platform` + `provider` + `method` 查询——Host 的 `Service` / `Event` 给出服务方法、可选 / 硬依赖的访问方式与事件签名，Client 的 `Service` / `Event` / `Slots` 给出侧边栏可用的服务、事件与插槽契约，`Config` / `Theme` 分别给出插件配置 schema 与主题令牌；以返回的声明为准。Inspect 没有投影的成员（例如通过 module augmentation 加到 `Agent` 上的运行时面）要回到已安装版本的公开类型声明确认，不要从私有实现猜测；需要查已安装文档 / 源码时加载 `dsh-doc` 技能。
8. 在创造模式（Creator）下，构建完成后可以用 `plugin_manager` 禁用再重新启用本插件，让 DSH 重新加载产物：`list_plugins` 找到本插件条目，`set_plugin` 先 `enabled: false` 再 `enabled: true`。这会重启 Host 半（LAN 服务、WebSocket）并断开手机连接；先 `pnpm build`，改过 `client.js` 时重载后刷新 DSH 页面。只在本仓库的 Creator 会话里这样做，不要在日常使用中反复开关。

## 文档地图

| 文档 | 内容 | 什么时候读 |
|---|---|---|
| [`docs/dev/architecture.md`](docs/dev/architecture.md) | bundle/入口/模块工厂、目录、i18n 数据流 | 改 `package.json`、Host 入口、`client.js` 包装、locale 时 |
| [`docs/dev/host.md`](docs/dev/host.md) | Host 生命周期、设置 schema 与迁移、LAN HTTP/HTTPS、鉴权、会话问询、天气/缓存/通知等服务 | 改 `src/dsh/lib` 大部分逻辑时 |
| [`docs/dev/protocol.md`](docs/dev/protocol.md) | 侧边栏环回 API、LAN 上传、WebSocket 帧、推送周期与语义 | 改接口、消息、推送或鉴权时 |
| [`docs/dev/quickqa.md`](docs/dev/quickqa.md) | 语音→转写→DSH 会话→流式回答→图片附件的跨层契约 | 改快速问答的 Host、侧边栏或手机端时 |
| [`docs/dev/mobile.md`](docs/dev/mobile.md) | Svelte 手机端结构、状态机、计时器、iframe、浏览器限制 | 改 `src/svelte` 时 |
| [`docs/dev/sidebar.md`](docs/dev/sidebar.md) | React 侧边栏设置页、`DraftState`、样式令牌 | 改 `src/dsh/client` 时 |
| [`docs/dev/probe.md`](docs/dev/probe.md) | Rust 探针分层、命令、daemon、Node 桥、平台矩阵 | 改 `src/rust` 或 `src/dsh/lib/probe` 时 |
| [`docs/dev/media.md`](docs/dev/media.md) | vendor-first 媒体适配、选择与 seek 规则、客户端扩展点 | 改媒体读取 / 控制时 |
| [`docs/dev/build-test.md`](docs/dev/build-test.md) | 构建脚本、测试、CI、发布、文档截图 | 构建、测试、发版、截图时 |

用户文档：`README.md` 与 `docs/README.en.md` 只写功能、安装摘要、使用方式与用户可感知的限制；`INSTALLATION.md` 是唯一的完整安装指南。不要把这些内容重复搬进 `docs/dev/`。

## 仓库形态

| 层 | 源码 | 运行产物 |
|---|---|---|
| Host | `src/dsh`（TypeScript，ESM） | `index.js` + `lib/` |
| DSH 侧边栏 | `src/dsh/client`（React，无 JSX） | 单个 `client.js` |
| 手机端 | `src/svelte`（Svelte 5 + Vite） | `web/` |
| 原生探针 | `src/rust`（Cargo） | `native/bin/<platform>-<arch>/dsh-probe[.exe]` |

```text
DSH Desktop / dsh web
└─ bundle: @ohmykreee/dsh-remote-control
   ├─ index.js ── lib/service.js ── LAN HTTP/HTTPS :38765 + /ws ── web/
   │             ├─ lib/server/* ── 鉴权 / 静态资源 / 上传 / 快照
   │             ├─ lib/quickqa/* ── 语音转写 → DSH 会话
   │             └─ lib/probe/* ── child_process ── native/bin/.../dsh-probe
   └─ client.js ── DSH webServer 环回路由 /dsh-remote-control/*
```

Host 与侧边栏通过 DSH `webServer` 的环回路由通信；手机端走插件自己监听的 LAN 端口。两条链路互不复用。

目标平台：Windows 完整、Linux 完整、macOS 仅初步测试（macOS 26）；手机端为现代浏览器。Node `>= 22`（CI 固定 `26.7.0`，pnpm `12.8.1`，Rust `1.99.1`）。

## 常用命令

```powershell
pnpm install
pnpm build        # build:dsh → build:web，生成 Host + 侧边栏 + 手机端
pnpm check        # tsc（Host / 侧边栏 / 单元测试）+ svelte-check
pnpm test         # test/dsh 下的 Host 集成测试
pnpm test:unit    # test/svelte 下的手机端纯函数测试
pnpm build:rust   # 可选；构建本机探针
```

Rust 侧：`cargo fmt --manifest-path src/rust/Cargo.toml -- --check`、`cargo test --manifest-path src/rust/Cargo.toml`。完整命令与 CI 顺序见 [`docs/dev/build-test.md`](docs/dev/build-test.md)。

## 改动检查清单

- **任何 `src/dsh`、`src/svelte`、`static/` 改动**：跑 `pnpm build`；提交里不要带生成物。
- **设置字段**：同时改 `settings/index.ts` 的默认值 / `normalize()` / 迁移、侧边栏编辑与保存、`README.md` 菜单说明；保持旧 `settings.json` 可迁移，必要时升 schema。
- **协议 / 推送**：同时改 `server/hub.ts`、`server/ws.ts`、`src/svelte/lib/types.ts`、`ws.ts`、`state.svelte.ts`，需要时 `quickqa.svelte.ts`，并更新 [`docs/dev/protocol.md`](docs/dev/protocol.md)。
- **平台或媒体客户端**：改 Rust 平台模块与 `media/catalog.rs` / `media/vendor/`，更新 [`docs/dev/media.md`](docs/dev/media.md) 与 [`docs/dev/probe.md`](docs/dev/probe.md) 的矩阵；探针缺失仍要显式报错。
- **用户文案**：同步三份字典（侧边栏、Host、手机端），必要时同步 `locale/*.json`；重新构建 `client.js` / `web/`。
- **提交前**：`pnpm check`、`pnpm build`、`pnpm test`、`pnpm test:unit`；改 Rust 再跑 fmt / test。

## UI 文案规范

面向终端用户的文字（侧边栏、手机端、README、错误与提示）只回答「这是什么、能做什么、怎么做、有什么限制」，不解释实现方式。

- 只写用户看得见的结果和能做的操作；不写代码路径、模块名、协议名、运行时、缓存、轮询、归一化、探测、CDP / SMTC / MPRIS / WebSocket / Node.js / Rust 等实现细节。
- 配置项可以写用户需要提供的内容（证书文件、端口、城市、音频文件），但不要解释内部如何处理。
- 提示语尽量一句话；范围与限制只在影响用户决策时出现，不在 README 里展开机制。
- 错误信息要告诉用户下一步能做什么，不要只抛内部错误名或后端状态。
- 诊断 / 系统信息页可以展示排障需要的版本、路径与平台信息；这些是诊断数据，不是功能说明。

## 文档维护

| 文件 | 负责内容 |
|---|---|
| `README.md` | 中文用户文档：功能、界面、截图、安装摘要、使用方式、平台支持、已知限制 |
| `docs/README.en.md` | 英文用户文档，与 `README.md` 同步 |
| `INSTALLATION.md` | 唯一的完整安装指南：npm / 源码安装、前置条件、构建、`link:` 注册、探针、更新、卸载、故障恢复 |
| `AGENTS.md`（本文件） | 硬规则、文档地图、仓库形态、命令、改动检查清单、文案规范 |
| `docs/dev/*.md` | 按领域拆开的开发细节；只在对应改动时阅读 |

- 文档只记录稳定的行为、契约、约束与设计原因；不要把某次修复、临时要求、TODO 或“刚改了什么”写成备注。修复过程放提交信息 / PR，需求放 issue。
- 功能行为变化同时改两份 README；安装或构建步骤变化改 `INSTALLATION.md`；架构、协议、媒体、探针变化改对应的 `docs/dev/*.md`。
- `docs/dev/` 面向贡献者，可以写实现细节；用户文档不要写。
- `package.json` 的 `files` 已包含 `docs/**` 与 `AGENTS.md`，新增 `docs/dev/` 文件不需要改清单；只有新增根目录文档或新目录时才需要同步 `files`。
- 新增 `docs/dev/` 文件时，在本文件「文档地图」补一行；不要在多个文件里复制同一段说明，链接过去即可。

## 已知限制

- 探针必须在目标机构建；npm 包里没有二进制，缺失时媒体、音量、通知、GPU / 温度、定位显示不可用，CPU / 内存仍可用。
- Windows 定位受低完整性限制；私有层与 UIA / AX 永远不授予 seek；网易云 CDP 也不授予 seek。
- 天气只在 QWeather 配额耗尽时切换提供商，普通请求失败不切换；NMC 只覆盖中国城市；QWeather 需要用户自己的 JWT 凭据。
- 手机端只读会话；工具审批仍需在 DSH 中处理；番茄钟 / 倒计时只在手机浏览器运行。
- 面向用户的完整限制见 [`README.md`](README.md#已知限制)，不要在代码文档里重复。

## 许可证

MIT。Inter、Noto Sans SC、JetBrains Mono 使用 SIL Open Font License 1.1（`static/fonts/LICENSE.txt`，构建后位于 `web/fonts/LICENSE.txt`）。媒体适配层参考的 [Widdit/now-playing-service](https://github.com/Widdit/now-playing-service) 为 MIT。
