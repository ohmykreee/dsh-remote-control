# 架构与 DSH 集成契约

[← AGENTS.md](../../AGENTS.md)

本文件回答「这个仓库由哪几层组成、DSH 如何加载它、源码怎样变成运行产物」。协议细节见 [`protocol.md`](protocol.md)，构建流水线见 [`build-test.md`](build-test.md)。

## 层与拓扑

四层和运行拓扑见 [`AGENTS.md`](../../AGENTS.md#仓库形态)。本文件只补充契约：Host 与侧边栏走 DSH `webServer` 的环回路由；手机端走插件自己监听的 LAN 端口。两条链路不共用监听器，也不共用鉴权状态。

## bundle 契约

`package.json` 的关键点（完整字段以文件为准）：

- `name` 必须同时出现在清单、`cordis.patch.yml` 的 `name` 和 `client.js` 的工厂 `id`；`scripts/check-npm-package.mjs` 会校验。
- `main` / `exports` 暴露 `index.js`、`client.js`、locale 与 icon。
- `dsh.bundle.patch` 指向 `cordis.patch.yml`；`dsh.client` 为 `platform: web`、`immediately: true`，并注入 `@deepseek-ai/dsh-client-locale`。
- 版本三处必须一致：`package.json`、`src/dsh/lib/shared/util.ts` 的 `VERSION`、`src/rust/Cargo.toml`。发布校验会比对 tag 与版本。
- 清单不写 `"private": true`，不声明任何安装脚本。原因见 [`build-test.md`](build-test.md#构建入口)。
- `publishConfig` 的 `access` / `provenance` / `registry` 是 npm 发布策略，不要改成别的 registry。

`cordis.patch.yml` 只把 `remote-control` 插入 profile 的插件树：

```yaml
- insert:
    - id: remote-control
      name: '@ohmykreee/dsh-remote-control'
```

`id` 是 profile 内的插件 id；`name` 必须是完整包名，DSH 用它解析包。

## Host 入口

`src/dsh/index.ts`：

- `export const inject = ['webServer']`；
- `apply(ctx)` 创建 `createRemoteControlService(ctx, { log })` 并 `start()`；
- 用 `ctx.effect()` 注册 `service.dispose()` 与 `shutdownProbeDaemon()`，DSH 卸载 / 重载插件时自动清理；
- 在 `ctx.get('webServer')` 上注册侧边栏路由，每条路由都用 `ctx.effect()` 绑定；
- 启动失败、TLS 降级、监听端口只写日志，不抛到 DSH 启动流程。

路由是 `kind: 'exact'`。路径常量集中在 `src/dsh/lib/shared/util.ts`；路由表见 [`protocol.md`](protocol.md#侧边栏环回-api)。

## 侧边栏模块工厂

`scripts/build-dsh.mjs` 先编译 `src/dsh/client/index.ts` 及其引用模块为 CommonJS，再把它们编成内部模块表，包装为：

```js
window.__ModuleLoader__.load({
  id: '@ohmykreee/dsh-remote-control',
  factory(require) {
    /* 内部模块表 + 相对 require 解析，最后返回 client/index.js 的 exports */
  },
});
```

- `id` 由构建脚本从 `package.json` 的 `name` 读入，不要改成手写常量。
- `require('react')` 由 DSH 模块加载器提供；裸模块名交给外层 `require`，相对路径由内部模块表解析。
- 客户端源码只产出一个 `client.js`。不要改成 ESM `import`，也不要手改生成物。

侧边栏入口 `src/dsh/client/index.ts` 向 DSH 注册：`sidebar.panellist` 的图标入口与 `main` 面板，并注入 `slots` / `locale` / `theme` 三个服务。详细结构见 [`sidebar.md`](sidebar.md)。

## 本地化数据流

### 字典

- 插件元信息：`locale/en.json`、`locale/zh.json`，由 `@deepseek-ai/dsh-client-locale` 注入。
- 三份运行时字典，结构一致（每种语言一个扁平 `key -> 文案` 对象 + `DICTS`）：
  - `src/dsh/client/i18n.ts`：侧边栏。`en` 是 `Record<string, string>`，键覆盖没有编译约束，缺键回退英文。
  - `src/dsh/lib/i18n/index.ts`：Host 发给手机端的文案。`test/dsh/settings.mjs` 断言 `zh` / `en` 键集合一致。
  - `src/svelte/lib/i18n.svelte.ts`：手机端。`en` 声明为 `Record<MessageKey, string>`，漏译是编译错误。
- `zh` 是基准字典；侧边栏与手机端都先定义 `zh`，英文是缺键回退。

### 语言解析

`settings.language` 为 `dsh` / `zh` / `en`，默认 `dsh`。

`resolveLocale()` 在 Host（`src/dsh/lib/settings/index.ts`）与侧边栏（`src/dsh/client/i18n.ts`）各有一份同规则实现：

- `zh` / `en` 直接生效；
- `dsh` 只精确匹配 DSH 当前 locale id（`zh`、`en`）；`ja`、`zh-CN` 等未命中回退英语。

侧边栏 `apply()` 订阅 `ctx.locale` 并 `POST /api/locale` 写入 `settings.dshLocale`。Host 的公开快照输出解析后的 `settings.locale`，随 `welcome` / `overview` / `settings` 推给手机端；手机端 `applySettings()` 调 `setLocale()`。

改文案后必须重新构建 `client.js` / `web/`，否则运行产物仍是旧字典。

## 目录

| 路径 | 内容 |
|---|---|
| `locale/` | 插件元信息字典 |
| `cordis.patch.yml` | bundle patch |
| `scripts/` | 构建、发布校验、mock 预览、截图、浏览器截图 |
| `.github/workflows/` | `checks.yml`（门禁）、`publish-npm.yml`（发布） |
| `src/dsh/index.ts` | Host 入口 |
| `src/dsh/client/` | 侧边栏（React；`sections/` 为九个设置节） |
| `src/dsh/lib/` | Host 逻辑：`server/`、`quickqa/`、`settings/`、`sessions/`、`account/`、`apps/`、`cache/`、`weather/`、`probe/`、`media/`、`notifications/`、`performance/`、`platform/`、`i18n/`、`shared/` |
| `src/svelte/` | 手机端（`lib/components/` 为页面与卡片） |
| `src/rust/src/` | 探针：`media/`、`perf/`、`notifications/`、`volume/`、`location/` |
| `test/dsh/` | Host 集成测试 |
| `test/svelte/` | 手机端纯函数单元测试 |
| `static/` | Vite 公共资源（图标、manifest、字体许可） |
| `docs/dev/` | 本目录，开发细节 |
| `docs/screenshots/` | README 截图 |

生成物 `index.js`、`client.js`、`lib/`、`web/`、`native/bin/`、`.build/`、`.mock-web/`、`.probe-tmp/` 均已 gitignore，也不应提交。

## 相关文档

- 改设置 / 服务 / 鉴权：[`host.md`](host.md)
- 改接口或消息：[`protocol.md`](protocol.md)
- 改构建、测试、发布：[`build-test.md`](build-test.md)
