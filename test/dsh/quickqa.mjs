import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc-quickqa-'));
process.env.DSH_PROFILE_DIR = profile;
process.env.DSH_REMOTE_CONTROL_PORT = '0';

const { createRemoteControlService } = await import('../../lib/service.js');

const workspaces = [
  { id: 'ws-default', title: '默认工作区', path: 'D:\\demo\\default' },
  { id: 'ws-pin', title: '置顶工作区', path: 'D:\\demo\\pin' },
];
let voicePhase = 'standby';
let lastTurn = 0;
let sessionSerial = 0;
let activeSession = '';
const createCalls = [];
const promptCalls = [];
const promptSignals = [];
const followRequests = [];
const modelSelections = [];
const permissionCalls = [];
const resolverCalls = [];
const transcribeCalls = [];

// Mirrors the official public `speechController` contract: catalog() reports
// readiness plus limits, transcribe() accepts canonical base64 WAV.
const speechController = {
  catalog: () => ({
    providers: [{
      id: 'sensevoice-local',
      name: 'SenseVoice 本地识别',
      languages: ['zh', 'en'],
      preparation: { phase: voicePhase },
    }],
    selection: { providerId: 'sensevoice-local', language: 'zh' },
    maxAudioBytes: 4 * 1024 * 1024,
    maxDurationSeconds: 120,
  }),
  transcribe: async (request) => {
    transcribeCalls.push({ ...request });
    return { text: '这是语音转写的问题', audioSeconds: 1.4, inferenceSeconds: 0.2 };
  },
};

const sessionController = {
  async modelCatalog() {
    return {
      default: { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'high' },
      routableProviders: ['deepseek'],
      groups: [{
        id: 'deepseek',
        name: 'DeepSeek',
        models: [{
          id: 'deepseek-flash',
          name: 'DeepSeek Flash',
          reasoning: {
            efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
            defaultEffort: 'high',
          },
        }],
      }, {
        id: 'textonly',
        name: 'Text Only',
        models: [{ id: 'text-model', name: 'Text Model' }],
      }],
      failures: [],
    };
  },
  async create(request) {
    createCalls.push(request);
    sessionSerial += 1;
    activeSession = `s-quickqa-${sessionSerial}`;
    return { sessionId: activeSession, agentPreset: request.agentPreset };
  },
  async prompt(request, signal) {
    promptCalls.push(request);
    promptSignals.push(signal);
    lastTurn += 1;
    return { accepted: true };
  },
  async *follow(request, signal) {
    followRequests.push(request);
    const turn = lastTurn;
    const firstAttempt = `attempt-${turn}-1`;
    const finalAttempt = `attempt-${turn}-2`;
    yield {
      type: 'snapshot',
      records: [
        { type: 'event', event: { type: 'turn/start', seq: 1, time: Date.now(), data: { turn } } },
      ],
    };
    // The first model attempt has visible prose, then a tool call. The Host
    // must forward the prose, ignore the tool chunk, and start the next
    // attempt on a fresh line.
    yield {
      type: 'assistant-stream',
      frame: {
        type: 'start',
        attemptId: firstAttempt,
        revision: 1,
        startedAfterSeq: 0,
        turn,
        step: 0,
      },
    };
    yield {
      type: 'assistant-stream',
      frame: {
        type: 'chunk',
        attemptId: firstAttempt,
        revision: 1,
        index: 0,
        time: Date.now(),
        chunk: {
          type: 'text-chunks',
          time0: Date.now(),
          index: 0,
          dt: [],
          texts: ['我先确认一下。'],
        },
      },
    };
    yield {
      type: 'assistant-stream',
      frame: {
        type: 'chunk',
        attemptId: firstAttempt,
        revision: 1,
        index: 1,
        time: Date.now(),
        chunk: {
          type: 'tool-call-chunks',
          time0: Date.now(),
          index: 1,
          dt: [],
          id: 'tool-1',
          name: 'read_file',
          args: ['{}'],
        },
      },
    };
    yield {
      type: 'assistant-stream',
      frame: { type: 'end', attemptId: firstAttempt, revision: 1, index: 2, outcome: { kind: 'abandoned' } },
    };
    yield {
      type: 'assistant-stream',
      frame: {
        type: 'start',
        attemptId: finalAttempt,
        revision: 1,
        startedAfterSeq: 0,
        turn,
        step: 1,
      },
    };
    yield {
      type: 'assistant-stream',
      frame: {
        type: 'chunk',
        attemptId: finalAttempt,
        revision: 1,
        index: 0,
        time: Date.now(),
        chunk: {
          type: 'text-chunks',
          time0: Date.now(),
          index: 0,
          dt: [],
          texts: [`第 ${turn} 轮回答`],
        },
      },
    };
    yield {
      type: 'event',
      event: {
        type: 'assistant/message',
        seq: 2,
        time: Date.now(),
        data: {
          turn,
          message: { role: 'assistant', content: [{ type: 'text', text: `第 ${turn} 轮回答` }] },
        },
      },
    };
    yield {
      type: 'event',
      event: {
        type: 'turn/end',
        seq: 3,
        time: Date.now(),
        data: { turn, reason: { kind: 'completed' } },
      },
    };
    if (signal.aborted) return;
  },
};

const ctx = {
  get(name) {
    if (name === 'speechController') return speechController;
    if (name === 'sessionController') return sessionController;
    if (name === 'workspaces' || name === 'workspaceRegistry') return {
      list: () => workspaces,
      get: (id) => workspaces.find((workspace) => workspace.id === id),
    };
    if (name === 'agents') {
      return {
        get: (id) => (id === activeSession
          ? { id, model: { select: (selection) => modelSelections.push({ id, ...selection }) } }
          : undefined),
        turnBoundaryOf: () => ({ lastTurn }),
      };
    }
    if (name === 'sessions') {
      return {
        list: () => [],
        get: (id) => (id === activeSession ? { id } : undefined),
      };
    }
    if (name === 'permissionPresets') {
      return {
        catalog: () => ({
          options: [
            { value: 'read-only', name: 'Read Only' },
            { value: 'workspace-write', name: 'Workspace Write' },
            { value: 'full-access', name: 'Full access' },
            { value: 'auto', name: 'Auto review' },
          ],
          defaultPreset: 'workspace-write',
        }),
        set: (session, name) => permissionCalls.push({ sessionId: session.id, name }),
      };
    }
    if (name === 'agentPresets') {
      return {
        list: async () => [
          { id: 'standard', name: 'Standard' },
          { id: 'creator', name: 'Creator' },
        ],
      };
    }
    if (name === 'llm') {
      return {
        resolveCallConfig: async (config) => {
          resolverCalls.push(config);
          return config;
        },
        resolveModelInfo: async (_provider, model) => ({
          id: model,
          name: model,
          inputModalities: model === 'text-model' ? ['text'] : ['text', 'image'],
        }),
      };
    }
    return undefined;
  },
  on() {
    return () => {};
  },
};

const service = createRemoteControlService(ctx, { log: () => {} });
service.settingsStore.update({
  quickqa: {
    model: { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'high' },
    defaultWorkspaceId: 'ws-default',
    pinnedWorkspaceIds: ['ws-pin'],
    profiles: {
      'ws-default': { agentPreset: 'standard', permissionPreset: 'workspace-write' },
      'ws-pin': { agentPreset: '', permissionPreset: 'auto' },
      'ws-extra': { agentPreset: 'creator', permissionPreset: 'full-access' },
    },
  },
});
assert.deepEqual(
  Object.keys(service.settingsStore.get().quickqa.profiles).sort(),
  ['ws-default', 'ws-pin'],
  'profiles are pruned to the default and pinned workspaces',
);
const info = await service.start();
assert.equal(info.running, true);

function readResponse() {
  const chunks = [];
  return {
    status: 0,
    headers: {},
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      if (body !== undefined) chunks.push(Buffer.from(body));
    },
    json() {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    },
  };
}

try {
  const optionsRes = readResponse();
  await service.handleQuickQaOptions({ method: 'GET', url: '/dsh-remote-control/api/quickqa', headers: {} }, optionsRes);
  assert.equal(optionsRes.status, 200);
  const options = optionsRes.json();
  assert.equal(options.ok, true);
  assert.equal(options.voice.ready, true);
  assert.equal(options.workspaces.length, 2);
  assert.equal(options.modes.some((mode) => mode.id === 'standard'), true);
  assert.equal(options.permissions.options.some((option) => option.value === 'auto'), true);
  assert.equal(options.settings.defaultWorkspaceId, 'ws-default');
  const modelGroups = options.model.groups;
  assert.equal(
    modelGroups.find((group) => group.id === 'deepseek').models[0].imageInput,
    true,
    'an image-capable route is reported through the LLM seam',
  );
  assert.equal(
    modelGroups.find((group) => group.id === 'textonly').models[0].imageInput,
    false,
    'a text-only route is reported as not accepting images',
  );
  assert.equal(service.settingsStore.get().quickqa.allowImages, false, 'attachments start off');

  const token = encodeURIComponent(service.settingsStore.get().token);
  const socket = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${token}`);
  const inbox = [];
  const waiters = new Set();
  socket.addEventListener('message', (event) => {
    try {
      inbox.push(JSON.parse(event.data));
    } catch {
      return;
    }
    for (const waiter of [...waiters]) waiter();
  });
  function waitFor(predicate, timeout = 15_000) {
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const index = inbox.findIndex(predicate);
        if (index < 0) return false;
        const [message] = inbox.splice(index, 1);
        cleanup();
        resolve(message);
        return true;
      };
      const cleanup = () => {
        clearTimeout(timer);
        waiters.delete(attempt);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`message timeout; got ${inbox.map((message) => message.type).join(', ')}`));
      }, timeout);
      waiters.add(attempt);
      attempt();
    });
  }

  const welcome = await waitFor((message) => message.type === 'welcome');
  assert.equal(welcome.settings.quickqa.voiceReady, true);
  assert.equal(welcome.settings.quickqa.defaultWorkspaceId, 'ws-default');
  assert.equal(welcome.settings.quickqa.pinned.length, 1);
  assert.equal(welcome.settings.quickqa.allowImages, false);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const uploadImage = (body = png, type = 'image/png') => fetch(
    `http://127.0.0.1:${info.port}/api/quickqa/attachment?token=${token}`,
    { method: 'POST', headers: { 'content-type': type }, body },
  );
  const disabledUpload = await uploadImage();
  assert.equal(disabledUpload.status, 409, 'uploads are refused while the setting is off');

  await service.applySettings({ quickqa: { allowImages: true } });
  const attachmentSettings = await waitFor((message) => message.type === 'settings');
  assert.equal(attachmentSettings.data.quickqa.allowImages, true);
  const unsupportedType = await uploadImage(Buffer.from('not an image'), 'text/plain');
  assert.equal(unsupportedType.status, 415);
  const mismatchedBytes = await uploadImage(Buffer.from('not really a png'));
  assert.equal(mismatchedBytes.status, 400);
  const imageUpload = await uploadImage();
  assert.equal(imageUpload.status, 200);
  const imagePayload = await imageUpload.json();
  assert.equal(imagePayload.ok, true);
  assert.equal(imagePayload.mediaType, 'image/png');
  assert.equal(imagePayload.bytes, png.length);
  assert.equal(typeof imagePayload.id, 'string');
  assert.ok(imagePayload.id.length > 10);

  socket.send(JSON.stringify({ type: 'quickqa-ask', text: '你好，介绍一下自己', workspaceId: 'ws-default' }));
  await waitFor((message) => message.type === 'quickqa-state' && message.phase === 'thinking');
  const done = await waitFor((message) => message.type === 'quickqa-state' && message.phase === 'done');
  assert.equal(done.sessionId, 's-quickqa-1');
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].workspaceId, 'ws-default');
  assert.equal(createCalls[0].agentPreset, 'standard');
  assert.equal(modelSelections.length, 1);
  assert.deepEqual(modelSelections[0], {
    id: 's-quickqa-1',
    provider: 'deepseek',
    model: 'deepseek-flash',
    reasoningEffort: 'high',
  });
  assert.deepEqual(permissionCalls[0], { sessionId: 's-quickqa-1', name: 'workspace-write' });
  assert.equal(promptCalls.length, 1);
  assert.equal(typeof promptSignals[0]?.throwIfAborted, 'function', 'prompt receives a cancellation signal');
  assert.deepEqual(promptCalls[0].content, [{ type: 'text', text: '你好，介绍一下自己' }]);
  assert.equal(promptCalls[0].mode, 'queue');
  const answerDeltas = inbox.filter((message) => message.type === 'quickqa-delta').map((message) => message.text).join('');
  assert.match(answerDeltas, /第 1 轮回答/);
  assert.equal(followRequests.length, 1);
  assert.equal(followRequests[0].assistantStream, true, 'live assistant stream frames are requested');
  assert.equal(
    answerDeltas,
    '我先确认一下。\n\n第 1 轮回答',
    'intermediate prose is forwarded, tool chunks are skipped, and the next attempt starts on a new line',
  );

  // Follow-up keeps the same session and advances to the next turn.
  socket.send(JSON.stringify({ type: 'quickqa-ask', text: '再补充一点', sessionId: 's-quickqa-1' }));
  await waitFor((message) => message.type === 'quickqa-state' && message.phase === 'thinking');
  const done2 = await waitFor((message) => message.type === 'quickqa-state' && message.phase === 'done');
  assert.equal(done2.sessionId, 's-quickqa-1');
  assert.equal(promptCalls.length, 2);
  assert.equal(promptCalls[1].mode, 'queue');
  assert.deepEqual(promptCalls[1].content, [{ type: 'text', text: '再补充一点' }]);

  // One uploaded image travels with the next follow-up and is claimed once.
  socket.send(JSON.stringify({
    type: 'quickqa-ask',
    text: '这张图里是什么',
    sessionId: 's-quickqa-1',
    imageId: imagePayload.id,
  }));
  await waitFor((message) => message.type === 'quickqa-state' && message.phase === 'thinking');
  await waitFor((message) => message.type === 'quickqa-state' && message.phase === 'done');
  assert.equal(promptCalls.length, 3);
  assert.deepEqual(promptCalls[2].content, [
    { type: 'text', text: '这张图里是什么' },
    { type: 'image', mediaType: 'image/png', data: png.toString('base64') },
  ]);

  socket.send(JSON.stringify({
    type: 'quickqa-ask',
    text: '再用一次旧图片',
    sessionId: 's-quickqa-1',
    imageId: imagePayload.id,
  }));
  const expiredImage = await waitFor((message) => message.type === 'quickqa-state' && message.phase === 'error');
  assert.match(expiredImage.error, /图片|image/i);
  assert.equal(promptCalls.length, 3, 'a claimed image id cannot be reused');

  // A text-only model rejects an already-uploaded image before creating a new
  // Session, and refuses new uploads once the saved model changes.
  const modelGateUpload = await uploadImage();
  assert.equal(modelGateUpload.status, 200);
  const modelGateImage = await modelGateUpload.json();
  await service.applySettings({ quickqa: { model: { provider: 'textonly', model: 'text-model', reasoningEffort: '' } } });
  const textOnlySettings = await waitFor((message) => message.type === 'settings');
  assert.equal(textOnlySettings.data.quickqa.allowImages, false, 'an unsupported model hides the attach controls');
  const textOnlyUpload = await uploadImage();
  assert.equal(textOnlyUpload.status, 409, 'an unsupported model also refuses a new upload');
  const createdBefore = createCalls.length;
  socket.send(JSON.stringify({
    type: 'quickqa-ask',
    text: '文字模型可以看图吗',
    workspaceId: 'ws-default',
    imageId: modelGateImage.id,
  }));
  const modelRejected = await waitFor((message) => message.type === 'quickqa-state' && message.phase === 'error');
  assert.match(modelRejected.error, /不支持图片|does not accept images/i);
  assert.equal(createCalls.length, createdBefore, 'the image gate runs before Session creation');
  await service.applySettings({ quickqa: { model: { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'high' } } });
  await waitFor((message) => message.type === 'settings');

  // Audio upload reaches the same provider and returns its transcript.
  const audio = Buffer.alloc(128, 0);
  audio.write('RIFF', 0, 'ascii');
  audio.write('WAVE', 8, 'ascii');
  const transcript = await fetch(`http://127.0.0.1:${info.port}/api/quickqa/transcribe?token=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'audio/wav' },
    body: audio,
  });
  assert.equal(transcript.status, 200);
  assert.equal((await transcript.json()).text, '这是语音转写的问题');
  assert.equal(transcribeCalls.length, 1, 'the upload goes through the public speech controller');
  assert.equal(transcribeCalls[0].providerId, 'sensevoice-local');
  assert.equal(transcribeCalls[0].language, 'zh');
  assert.equal(
    Buffer.from(transcribeCalls[0].audioBase64, 'base64').length,
    audio.length,
    'the controller receives the uploaded bytes as base64',
  );

  // An idle-reclaimed worker reports `waking` while it starts for the request in
  // flight; treating that as unavailable would flip the phone mid-transcription.
  voicePhase = 'waking';
  const wakingRes = readResponse();
  await service.handleQuickQaOptions({ method: 'GET', url: '/dsh-remote-control/api/quickqa', headers: {} }, wakingRes);
  assert.equal(wakingRes.json().voice.ready, true, 'waking stays available during idle wake-up');
  const wakingUpload = await fetch(`http://127.0.0.1:${info.port}/api/quickqa/transcribe?token=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'audio/wav' },
    body: audio,
  });
  assert.equal(
    wakingUpload.status,
    409,
    'a second upload during wake-up stays retriable instead of failing inside the provider',
  );
  voicePhase = 'standby';

  // A not-ready official plugin gates new asks, uploads, and saved settings.
  voicePhase = 'unprepared';
  socket.send(JSON.stringify({ type: 'quickqa-ask', text: '还能问吗', workspaceId: 'ws-default' }));
  const rejected = await waitFor((message) => message.type === 'quickqa-state' && message.phase === 'error');
  assert.match(rejected.error, /语音输入|voice input/i);
  const rejectedUpload = await fetch(`http://127.0.0.1:${info.port}/api/quickqa/transcribe?token=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'audio/wav' },
    body: audio,
  });
  assert.equal(rejectedUpload.status, 409);

  const before = service.settingsStore.get().quickqa;
  await service.applySettings({ quickqa: { defaultWorkspaceId: 'ws-pin' } });
  assert.deepEqual(service.settingsStore.get().quickqa, before);

  socket.close();
  console.log('quickqa ok');
} finally {
  await service.stop();
  service.dispose();
  fs.rmSync(profile, { recursive: true, force: true });
}
