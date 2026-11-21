# 构建、测试与发布

[← AGENTS.md](../../AGENTS.md)

构建脚本在 `scripts/`，CI 在 `.github/workflows/`。所有生成物都在本机产生，不提交、不进仓库。

## 构建入口

`package.json` 不声明任何安装脚本（`preinstall` / `install` / `postinstall` / `prepare`）。

原因：DSH 用 pnpm 安装组合包，pnpm 默认拦下依赖的构建脚本，而 DSH 会把 `Ignored build scripts` 当作失败安装（`build-blocked`，要求批准后重试）。发布清单里只要有一个安装脚本，用户的一次性安装就会卡住。因此构建一律显式执行：

```powershell
pnpm install
pnpm build       # src/dsh + src/svelte
pnpm build:rust  # 可选：原生探针
```

`pnpm build` 的顺序是 `build:dsh` → `build:web`。`build-dsh` 先清理旧的 `index.js`、`client.js`、`lib/`、`.build/`，避免半旧产物；`build-web` 只写 `web/`。不要反过来依赖两者的副作用。

## DSH 公开类型依赖

`devDependencies` 里固定了三个只用于 `import type` 的 DSH 包（`0.2.2-rc.5`）：`@deepseek-ai/dsh-api-session-controller`、`@deepseek-ai/dsh-experimental-api-speech-to-text`、`@deepseek-ai/dsh-experimental-speech-to-text`。

- 它们只用于类型检查；编译后不会出现在 `index.js` / `lib/` 里，运行时也不安装。
- `tsc` 不下载任何包；`pnpm install` 会从 npm 安装这些 devDependencies。CI 不需要安装 DSH Desktop，但需要能访问 registry（或命中 pnpm store）；跳过 devDependencies 安装时，类型检查会因为找不到模块而失败。
- pnpm 的隔离布局只暴露直接依赖；不要依赖 `@deepseek-ai/dsh` 的传递依赖来提供类型，也不要把 `@deepseek-ai/dsh`（CLI，不导出这些服务契约）加进来。
- 升级 DSH 时三个包一起改到同一版本，并同步 README 徽章上的版本。

## build-dsh

`scripts/build-dsh.mjs`：

- 程序化读取 `tsconfig.dsh.json` 与 `tsconfig.dsh-client.json`，先输出到 `.build/host` / `.build/client`，再复制到根目录。
- `index.js` 加生成标记；`client.js` 合并为内部模块表，包装成 `window.__ModuleLoader__` 工厂（见 [`architecture.md`](architecture.md#侧边栏模块工厂)）。
- `terser` 压缩 `index.js`、`client.js`、`lib/**/*.js`；Host / lib 按 ESM，`client.js` 按 classic script。
- 编译诊断非零退出，不写半成品。

## build-web

`scripts/build-web.mjs` 直接 `import { build } from 'vite'`，不依赖 `node_modules/.bin`。

`vite.config.js`：`root = src/svelte`、`publicDir = static`、`outDir = web`、`assetsDir = assets`、`emptyOutDir: true`、`target: es2022`、无 sourcemap；字体 / manifest / 图标随构建打包。

## build-rust

`scripts/build-rust.mjs`：

- 默认 release，可用 `--debug`；`--target` 交叉指定；`--skip-build` 只复制已有产物；`--optional` 在没有 cargo 时警告并以 0 退出。
- 目标三元组决定输出目录；产物复制到 `native/bin/<platform>-<arch>/dsh-probe[.exe]`。
- Windows 自动加载 `vcvars64.bat`（`DSH_RC_VCVARS` 可覆盖），构建后执行 `ensureMediumIntegrity()` 修复 Low 标签。
- `DSH_RC_SKIP_RUST_BUILD=1` 可跳过。

## 生成物

| 产物 | 来源 |
|---|---|
| `index.js` | `src/dsh/index.ts` |
| `lib/**/*.js` | `src/dsh/lib/**` |
| `client.js` | `src/dsh/client/**` |
| `web/` | `src/svelte/**` + `static/**` |
| `native/bin/<platform>-<arch>/dsh-probe[.exe]` | `src/rust/**` |

以上全部 gitignore。`.build/`、`.mock-web/`、`.probe-tmp/` 也是运行时 / 预览产物，不要提交。

## 测试

### 目录约定

- `test/dsh/`：Host 集成测试，`pnpm test`（Node，直接跑 `.mjs`）。
- `test/svelte/`：手机端纯函数单元测试，`pnpm test:unit`（`vitest run`）。
- `vitest.config.ts`：`environment: node`，只扫 `test/svelte/**/*.test.ts`，`$lib` 指向 `src/svelte/lib`。
- 一个测试文件对应一类功能；新增断言优先并入已有文件，不要按单个特性拆新脚本。

Host 集成测试（`test/dsh/`）：`smoke`（启动 / TLS / WS / 静态 / 可信反向代理校验）、`questions`（问询）、`quickqa`（快速问答）、`settings`（设置 / 语言）、`proxy`（可信代理范围与真实 IP 头解析）、`media`（seek / daemon）、`notifications`、`weather`。各文件的具体断言以测试代码为准。

约定：

- Host 测试用临时 `DSH_PROFILE_DIR`，不要碰真实 profile。
- 没有构建探针时，`media.mjs` 的 daemon 用例会跳过；不要把它改成强制失败。
- 同一进程内切换探针路径要调 `resetProbeCache()`。
- 单个文件可以直接 `node test/dsh/quickqa.mjs` 跑。

手机端单元测试（`test/svelte/`）：`session-tree`、`pages`、`media`、`billing`、`settings-normalize`、`quickqa-image`；具体断言以测试代码为准。

- 只测无 runes、无 DOM 的纯函数；导入源码写 `.ts` 后缀。
- 个别测试会 stub `window` / `navigator`；不要依赖真实浏览器。
- 计时器、WebSocket、`billing.svelte.ts` 的 rune / 网络逻辑没有单元覆盖，用 `pnpm shot` / mock 预览验证。

### mock 预览与无头截图

```powershell
# 带演示数据的预览（?page=...&sheet=1；--locale en；--theme dark|light；--freeze-clock）
python scripts/mock-preview.py --web web --port 4173

# 无头截图（自动启动 mock preview；--timer countdown|pomodoro、--locale en、--click/--settle）
pnpm shot -- --timer countdown --out .mock-web/countdown.png
```

`browser-shot.mjs` 用 `playwright-core` 驱动本机 Edge / Chrome：默认打开 `?page=home`，输出到 `.mock-web/<page>-<timer>-<locale>.png`；`--browser` / `DSH_BROWSER_PATH` 可指定浏览器。仅本地验证，不进 CI。

## 文档截图

文档截图必须是**实机屏幕截图**：把控制台真正显示在目标设备屏幕上，再截取整屏。不要用 headless 浏览器的 `--screenshot` 输出充当 README 截图。数据可以用 `mock-preview.py`，但渲染和采集都要发生在实机屏幕上。

| 工具 | 用途 |
|---|---|
| `scripts/mock-preview.py` | 生成带演示数据的预览；`--locale zh/en`、`--theme dark/light`、`--freeze-clock` |
| `scripts/screenshot-device.sh` | 在目标设备上以 kiosk 浏览器显示 URL，再截整屏（KDE 用 Spectacle，wlroots 用 grim，X11 用 ImageMagick `import`）；`MIC_PERMISSION=1` 预授权麦克风 |
| `scripts/screenshot-compose.py` | 把 dark/light 整屏截图按右上→左下对角合成，并输出 `overview.png`、`media.png`、`quickqa.png` 与 `pages/*.png` |

流程：`pnpm build:web` → 启动暗色 / 亮色两个预览（端口与 `--out` 分开，都加 `--freeze-clock`）→ 在设备上逐页截整屏（home / sessions / music / performance / quickqa / answer；answer 用 `&quickqa=result`；快速问答加 `MIC_PERMISSION=1`）→ `screenshot-compose.py` 合成到 `docs/screenshots/zh|en` → README 只引用分组后的 `overview.png` / `media.png` / `quickqa.png`。

通过 SSH 在设备上运行时，调用方自己提供会话环境（`XDG_RUNTIME_DIR`、`WAYLAND_DISPLAY`、`DBUS_SESSION_BUS_ADDRESS`）。脚本不保存主机名、账号或密码。

## CI

`.github/workflows/checks.yml`：单个 Ubuntu job，分支推送、手动触发、以及被 `publish-npm.yml` 通过 `workflow_call` 复用时都跑同一套检查。

- 固定 Node `26.7.0`、pnpm `12.8.1`、Rust `1.99.1`（含 rustfmt）；
- 缓存 cargo registry（key 为 `src/rust/Cargo.lock` 哈希）；
- 步骤顺序：`pnpm ci` → `pnpm check` → `pnpm build` → `cargo fmt --all -- --check` → `cargo check --all-targets` → `node scripts/build-rust.mjs` → `pnpm test` → `pnpm test:unit` → `cargo test --all-targets`；
- `push` 只监听分支（`branches: ['**']`），标签由发布流程负责，避免同一个标签把门禁跑两遍；
- CI 只覆盖 Linux；Windows / macOS 以本地验证为准，macOS 只在 macOS 26 上做过初步测试。

## 发布

`.github/workflows/publish-npm.yml` 把包发到 `@ohmykreee/dsh-remote-control`。

- 触发：推 `v[0-9]*` 标签；`workflow_dispatch` 手动运行默认 dry run（`inputs.dry-run`），取消勾选才真正上传。
- 门禁：`jobs.checks` 是 `uses: ./.github/workflows/checks.yml`，检查不过不发布。
- 构建：只跑 `pnpm build:dsh` 与 `pnpm build:web`；探针是平台相关的本机构建产物，不进 npm 包。
- 校验：`node scripts/check-npm-package.mjs --tag <tag>` 验证产物、清单策略、版本 / 标签一致、版本三处同步（`package.json` / `src/dsh/lib/shared/util.ts` 的 `VERSION` / `src/rust/Cargo.toml`）和 tarball 内容；上限 25 MiB / 5000 条目，禁止 `test/`、`.github/`、`native/`、`src/rust/target/` 等路径。
- 发布：`npm publish --provenance --access public --tag latest|next`（预发布版本走 `next`）。认证用 npm Trusted Publishing（OIDC），工作流里没有 token / secret：job 带 `id-token: write` 并在 `npm` environment 下运行。
- 首次发布（一次性引导）：trusted publisher 只能为已存在的包配置，先用维护者账号交互式发布一个占位版本建立包记录（`0.0.0-bootstrap`，`--tag bootstrap`），再到 npm 设置页配置 trusted publisher（owner `ohmykreee`、repo `dsh-remote-control`、workflow `publish-npm.yml`、environment `npm`）。配置后 48 小时内必须完成首次发布。之后的版本只走标签发布，不要在本机手工发布正式版本。工作流头注释有更完整的 npm 政策说明。
- 包内容：编译产物（`index.js` / `client.js` / `lib/` / `web/`）+ 源码（`src/**`、构建脚本、配置、README / INSTALLATION / AGENTS / docs）；`test/`、`.github/`、`native/bin/`、`src/rust/target/` 不进包。

## 提交前

```powershell
pnpm check
pnpm build
pnpm test
pnpm test:unit
```

改 Rust 再跑：

```powershell
cargo fmt --manifest-path src/rust/Cargo.toml -- --check
cargo test --manifest-path src/rust/Cargo.toml
pnpm build:rust
```

提交里不要带 `index.js`、`client.js`、`lib/`、`web/`、`native/bin/`。
