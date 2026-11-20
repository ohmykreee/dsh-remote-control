# 快速问答

[← AGENTS.md](../../AGENTS.md)

快速问答把手机录音变成一次 DSH 会话。它横跨 Host、侧边栏和手机端，涉及官方语音、会话、模型、权限与附件服务。接口帧见 [`protocol.md`](protocol.md)，手机端结构见 [`mobile.md`](mobile.md)。

## 链路

```text
手机麦克风
  └─ POST /api/quickqa/transcribe（WAV，16 kHz 单声道 PCM16）
       └─ speechController.transcribe() → 文本
            └─ WS quickqa-ask（文本，可选 imageId）
                 └─ sessionController.create / prompt
                      └─ follow({ assistantStream: true })
                           └─ quickqa-state / quickqa-delta / quickqa-pending
```

图片单独上传到 `/api/quickqa/attachment`，只暂存内存；转写成功后才随 `quickqa-ask` 提交。

## Host 模块

`src/dsh/lib/quickqa/`：

| 文件 | 责任 |
|---|---|
| `voice.ts` | 官方 `speechController` 桥、就绪判定、录音上限、转写 |
| `catalog.ts` | 模型 / 工作区 / 模式 / 权限目录，`imageInput` 判定 |
| `image.ts` | 一次性图片暂存 |
| `index.ts` | 每客户端运行态、提问、流式回答、问询、停止、附件认领 |

### 语音（`voice.ts`）

- **只经官方公开的 `speechController`**（`catalog()` / `transcribe()`），不读内部 provider 注册表，不做 provider 回退。WAV 头、字节数、时长上限由官方控制器校验。
- 就绪判定取选中 provider 的 `preparation.phase`。`ready` / `standby` / `waking` 算**就绪**；但 `waking` 表示已有一个转写请求持有唤醒，新的上传只能接受 `ready` / `standby`，`waking` 时上传返回可重试的 409。不要把「就绪」误当成「可上传」。
- `transcribeAudio()` 把 WAV 编码成 base64，调 `speechController.transcribe({ audioBase64, providerId, language }, signal)`；`signal` 必须有。
- 没有 catalog 时回退 8 MiB / 60 s 的录音上限；上传路由还会再受硬上限 8 MiB 约束。

### 目录（`catalog.ts`）

- 模型：`sessionController.modelCatalog()`；缺失时回退 `llm` + `agentDefaultModel`。
- 工作区：`workspaceRegistry`；模式 / 权限：`agentPresets.list()`、`permissionPresets.catalog()`。
- 目录缓存 15 s；语音就绪状态每次实时读取，不缓存。
- `imageInput` 是**三态**语义：模型显式声明 `inputModalities` 且不含 `image` 才是纯文本；未声明、缺字段或 `resolveModelInfo()` 抛错都按“未知 / 可接受图片”处理。不要在 UI 里把“未知”显示成“纯文本”。

### 图片（`image.ts`）

- 支持 PNG / JPEG / WebP / GIF；20 MiB 上限；校验文件头与声明类型一致。
- 只在内存中暂存，不写磁盘；10 分钟后丢弃未认领的图片。
- `take(id)` 是一次性的：同一图片只能被一个 prompt 认领。
- 上传接口在 `allowImages` 关闭或当前生效模型不支持图片时直接返回 409；但**提问时的模型校验才是权威**，上传时的目录可能已过期。

### 运行态（`index.ts`）

每个 WebSocket 客户端一个 `QuickQaRun`：`sessionId`、`workspaceId`、模型选择、`busy`、`abort`、`turnId`、pending 签名。

新问题：

1. `sessionController.create({ workspaceId, agentPreset })` 建会话；
2. `agent.model.select()` 只改该会话的模型，不写 DSH 默认值；选择失败只记日志，回退会话默认；
3. `permissionPresets.set(session, name)` 设权限行为；
4. `sessionController.prompt({ requestId, sessionId, mode: 'queue', content }, signal)`。**第二个 `AbortSignal` 参数是必需的**；
5. `content` 是文本块，加可选的官方图片块 `{ type: 'image', mediaType, data }`；Host 先用 `llm.resolveModelInfo()` 确认模型接受图片；
6. `follow({ address: { kind: 'session', sessionId }, assistantStream: true }, signal)`。

`quickqa-ask` 的校验顺序（不要随意调整）：

1. 文本非空；
2. 语音就绪；
3. 当前 run 不忙；
4. 带 `sessionId` 时必须匹配当前 run；
5. 带 `imageId` 时 `allowImages` 必须开启，且 `take()` 成功；
6. 有 `sessionId` 走追问，否则建新会话。

### 流式回答

- 只转发可见文本：`text-chunks`、`text-delta`，以及包装过的 `{ type: 'chunk', chunk: { type: 'text-delta' } }`。`reasoning-*` 与全部 tool-call 内容丢弃。
- 每次新的 assistant attempt（例如工具调用之后）另起一段（`\n\n`），工具调用前的可见说明会保留。
- `follow()` 开头的 `snapshot` 可能带 `assistantStream.activeAttempt.stream`；`adoptAssistantBaseline()` 先补发已产生的文本，避免丢字或重复。
- 轮次结束时用最终 `assistant/message` 校准：只有在流式文本末尾缺少最终文本时才追加；带 tool-call 的最终消息会被丢弃。**流式文本不会被回写修正**。
- 没有收到任何流帧时，回退到 `streamAnswer()`：按固定节奏分块发 `quickqa-delta`，结束时发 `done`；空回答带 `empty: true`。
- `follow` 超时 15 分钟；pending 每 500 ms 轮询一次并推 `quickqa-pending`。

### 停止、重置、断开

- `quickqa-stop`：递增 `turnId`、`abort.abort()`、调用官方 `sessionController.cancel({ sessionId })`，回 `quickqa-state done` + `stopped: true`。旧轮次的迟到帧因 `turnId` 不匹配被丢弃；会话保留，可继续追问或开新会话。
- `quickqa-reset`：中止当前轮次并删除 run；不动 DSH 会话本身。
- WebSocket 断开 / 插件卸载：`detach()` 取消该客户端的 turn；`dispose()` 还会清空图片。
- 结束原因 `error` / `blocked` / `interrupted` / `aborted` / 缺少 `turn/end` 都转成 `quickqa-state error`，不是「已中断」。

### 问询

- 运行期间每 500 ms 读 `pending.snapshot(sessionId)`，通过 `quickqa-pending` 推送。
- `notifications.pushQuestions` 关闭时只发通用提示，不泄露问题内容。
- 用户问题可直接用既有 `answer-question` 通道回答；权限询问仅展示，仍需在 DSH 处理。
- 状态推送里 `quickqa-state.question` 回显本次识别文本，手机聊天卡用它显示用户问题与多轮上下文。

## 设置契约

`settings.quickqa`：

- `model`：`provider` / `model` / `reasoningEffort`；
- `defaultWorkspaceId`、`pinnedWorkspaceIds`（数组顺序就是手机端顺序）；
- `profiles`：只为默认 / 置顶工作区保存 `agentPreset` / `permissionPreset`；
- `allowImages`。

规则：

- 保存时只保留默认与置顶工作区的 profile；未置顶的工作区不保存模式。
- `allowImages` 的公开值是 `settings.quickqa.allowImages && 当前生效模型支持图片`；手机端据此决定是否显示附件按钮。
- 官方语音输入未就绪时，`applySettings()` 丢弃 `quickqa` 补丁；侧边栏保留已保存值，但禁用后续控件。
- 模型 / 模式 / 权限的显示名直接用 Host API 返回值，不额外翻译。

## 侧边栏（`sections/quickqa.ts`）

- 第一块显示官方语音输入提供商与就绪状态；未就绪时后面的模型 / 工作区 / 图片控件禁用，但保留已保存值。
- 模型：提供商 + 模型两个下拉，下面保留思考强度。
- 工作区：默认工作区固定勾选；置顶工作区可拖动排序，未勾选不可拖且排在置顶之下。
- 图片开关只在 `imageInput === true` 时可用；未知支持视为关闭并禁用；保存时若模型显式 `false` 强制关闭。
- 所有编辑先进入 `DraftState`，点「保存设置」一次性提交；应用改名、令牌轮换、断开设备是即时请求。

## 手机端（`QuickQaPage.svelte` + `quickqa.*.ts`）

- 首次录音成功后立即进入聊天卡；转写阶段也保持卡片，不回到初始界面。
- 麦克风授权只能从专门的授权按钮发起；未授权时大圆钮禁用。
- 图片只保留在浏览器内存（对象 URL），转写成功后才上传；选中后仍可关闭更换。
- 收到任何带 `error` 的 `quickqa-state`：清空当前会话、退回初始界面，只显示错误文案，不提供重试按钮；下一次按住麦克风开新会话。
- `quickqa-stop` 的中断按钮只在思考阶段显示；输出阶段隐藏底部按钮，完成后恢复。
- 设置推送里 `allowImages !== true` 时，手机端丢弃已暂存的图片。

### 伴侣桥接

伴侣可在页面脚本执行前向顶层页面注入冻结对象 `window.__DSH_COMPANION__`：

```ts
{
  version: 1,
  platform: 'windows' | 'linux' | 'macos',
  capabilities: { vrScreenshot: true },
  captureVrScreenshot(): Promise<Blob>, // image/png
}
```

- 晚注入时页面监听 `dsh-companion-ready`。
- 只在 `captureVrScreenshot` 是函数时启用：剪贴板按钮换成截图按钮，调用 `captureVrScreenshot()`；等待期间按钮禁用并显示加载态。
- 取不到图或调用失败只提示 `quickQaImageCompanionFailed`，**不回退剪贴板**，否则用户不知道拿到的是哪张图。
- 普通浏览器没有该对象，保持剪贴板逻辑。
- 该桥接只属于手机端：侧边栏与 Host 不展示、不推送相关状态；文案只进手机端字典。

## 不变量

- `speechController` / `sessionController` / `llm` / `permissionPresets` 都是公开服务；不要绕过它们读内部注册表。
- `sessionController.prompt()` 的第二个参数是 `AbortSignal`，缺了会在停止 / 超时时无法真正中止。
- `follow({ assistantStream: true })` 是进程内逐块流；不要改成轮询整段回答，除非同时处理超时、停止和 attempt 分隔。
- 图片 id 是一次性的；认领失败不能重试同一个 id。
- `quickqa` 设置未就绪时不要保存；Host 会丢弃补丁，但 UI 仍应禁用。

## 测试

- `test/dsh/quickqa.mjs`：目录、就绪门槛（`waking` 可读不可传）、`imageInput`、模型 / 模式 / 权限落到会话、提问与追问、音频 / 图片上传、一次性 `imageId`、纯文本模型拒绝、流式帧与 attempt 分隔、停止 / 取消。
- `test/svelte/quickqa-image.test.ts`：图片 MIME / 扩展名归一化、伴侣桥接检测、缺省 PNG、失败传播。
