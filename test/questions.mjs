import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc-questions-'));
process.env.DSH_PROFILE_DIR = profile;
process.env.DSH_REMOTE_CONTROL_PORT = '0';

const { createRemoteControlService } = await import('../lib/service.js');

const sessionId = 'session-question';
const continuedId = 'session-continued';
const now = Date.now();
const questionArgs = {
  questions: [
    {
      id: 'mode',
      question: '选择运行模式',
      header: '运行模式',
      options: [
        { label: '快速（推荐）', description: '优先完成当前请求' },
        { label: '稳定', description: '先补齐测试' },
      ],
    },
  ],
};
const events = [
  { type: 'turn/start', seq: 1, time: now - 2000, data: { turn: 1 } },
  {
    type: 'tool/call',
    seq: 2,
    time: now - 1000,
    data: {
      turn: 1,
      step: 1,
      callId: 'call-1',
      name: 'ask_user_question',
      arguments: JSON.stringify(questionArgs),
    },
  },
];
const continuedEvents = [
  { type: 'turn/start', seq: 1, time: now - 5000, data: { turn: 1 } },
  {
    type: 'tool/call',
    seq: 2,
    time: now - 4000,
    data: {
      turn: 1,
      step: 1,
      callId: 'call-3',
      name: 'ask_user_question',
      arguments: JSON.stringify({
        questions: [{ id: 'c1', question: '继续执行吗？', options: [{ label: '继续' }] }],
      }),
    },
  },
  {
    type: 'tool/result',
    seq: 3,
    time: now - 3000,
    data: {
      message: {
        toolCallId: 'call-3',
        content: [{ type: 'text', text: JSON.stringify({ pending: true, callId: 'call-3', message: 'waiting' }) }],
      },
    },
  },
];

const agent = { id: sessionId, status: 'running' };
const continuedAgent = { id: continuedId, status: 'running' };
const handlers = new Map();
const handlerOptions = new Map();
const serviceCalls = [];

const ctx = {
  get(name) {
    if (name === 'sessions') {
      return {
        list: () => [
          {
            id: sessionId,
            seq: events[events.length - 1].seq,
            snapshotEvents(from) {
              return events.filter((event) => event.seq >= from);
            },
            eventAt(seq) {
              return events.find((event) => event.seq === seq);
            },
            header: { cwd: 'D:\\demo', createdAt: now - 60_000 },
          },
          {
            id: continuedId,
            seq: continuedEvents[continuedEvents.length - 1].seq,
            snapshotEvents(from) {
              return continuedEvents.filter((event) => event.seq >= from);
            },
            eventAt(seq) {
              return continuedEvents.find((event) => event.seq === seq);
            },
            header: { cwd: 'D:\\demo', createdAt: now - 120_000 },
          },
        ],
      };
    }
    if (name === 'agents') {
      return {
        list: () => [agent, continuedAgent],
        get: (id) => (id === sessionId ? agent : id === continuedId ? continuedAgent : undefined),
        currentInitiator: () => agent,
        turnBoundaryOf: () => ({ lastTurn: 1, openTurnStartSeq: 1 }),
      };
    }
    if (name === 'sessionTitle') {
      return {
        get: (session) => ({ title: session.id === continuedId ? '继续会话' : '演示会话' }),
      };
    }
    if (name === 'userQuestions') {
      return {
        answer(owner, callId, answer) {
          serviceCalls.push({ owner, callId, answer });
          return true;
        },
      };
    }
    return undefined;
  },
  on(name, handler, options) {
    handlers.set(name, handler);
    handlerOptions.set(name, options);
    return () => handlers.delete(name);
  },
};

const service = createRemoteControlService(ctx, { log: () => {} });
assert.equal(service.settingsStore.public().notifications.pushQuestions, false);
const info = await service.start();
assert.equal(info.running, true);

const handler = handlers.get('user-questions/request');
assert.equal(typeof handler, 'function', 'question waterfall handler registered');
assert.equal(handlerOptions.get('user-questions/request')?.prepend, true, 'question handler runs before the Web client forwarder');

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
function waitFor(predicate, timeout = 20_000) {
  // CI runners can pause the event loop while the media/notification timers
  // fire; an 8 s budget occasionally expired before the next sessions tick.
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

try {
  const welcome = await waitFor((message) => message.type === 'welcome');
  assert.equal(welcome.settings.pushQuestions, false);

  const overview = await waitFor((message) => message.type === 'overview');
  const row = overview.data.sessions.find((session) => session.id === sessionId);
  assert.ok(row, 'session appears in overview');
  assert.equal(row.status, 'question');
  assert.equal(row.pending.requestId, 'call-1');
  assert.equal(row.pending.answerable, false);
  assert.equal(row.pending.questions.length, 0);

  await service.applySettings({ notifications: { pushQuestions: true } });
  const settingsMessage = await waitFor((message) => message.type === 'settings');
  assert.equal(settingsMessage.data.pushQuestions, true);

  // Before the live request arrives the log-based fallback exposes the
  // question text but marks it as DSH-owned (answerable false).
  const withQuestions = await waitFor(
    (message) => message.type === 'sessions'
      && message.data.some((session) => session.id === sessionId && session.pending?.questions?.length > 0),
  );
  const fallbackRow = withQuestions.data.find((session) => session.id === sessionId);
  assert.equal(fallbackRow.pending.answerable, false);
  assert.equal(fallbackRow.pending.questions[0].question, '选择运行模式');

  // A timed/continued question reconstructed from the session log answers
  // through the `userQuestions.answer` service instead of a live waterfall.
  const continuedRow = withQuestions.data.find((session) => session.id === continuedId);
  assert.equal(continuedRow.pending.answerable, true);
  assert.equal(continuedRow.pending.questions[0].question, '继续执行吗？');

  // With a console connected and the setting on, a new legacy question is
  // claimed by the Host and never forwarded to the DSH Web client.
  let nextResolve;
  const nextPromise = new Promise((resolve) => {
    nextResolve = resolve;
  });
  const handled = handler.call(
    { id: sessionId },
    { questions: questionArgs.questions, agent },
    () => nextPromise,
  );
  const livePush = await waitFor(
    (message) => message.type === 'sessions'
      && message.data.some((session) => session.id === sessionId && session.pending?.answerable === true),
  );
  const liveRow = livePush.data.find((session) => session.id === sessionId);
  assert.equal(liveRow.pending.questions[0].question, '选择运行模式');
  assert.equal(liveRow.pending.questions[0].options.length, 2);
  const requestId = liveRow.pending.requestId;
  assert.ok(requestId, 'claimed question carries a request id');

  socket.send(JSON.stringify({
    type: 'answer-question',
    sessionId,
    requestId,
    answers: [{ id: 'mode', selected: ['快速（推荐）'] }],
  }));
  const answered = await waitFor((message) => message.type === 'answer-result' && message.requestId === requestId);
  assert.equal(answered.ok, true);
  assert.deepEqual(await handled, { answers: [{ id: 'mode', selected: ['快速（推荐）'] }] });

  // The service clears the pending row immediately after the answer.
  const cleared = await waitFor(
    (message) => message.type === 'sessions' && message.data.some((session) => session.id === sessionId && !session.pending),
  );
  const clearedRow = cleared.data.find((session) => session.id === sessionId);
  assert.equal(clearedRow.pending, null);
  assert.equal(clearedRow.status, 'running');

  socket.send(JSON.stringify({
    type: 'answer-question',
    sessionId: continuedId,
    requestId: 'call-3',
    answers: [{ id: 'c1', selected: ['继续'] }],
  }));
  const continuedAnswered = await waitFor((message) => message.type === 'answer-result' && message.requestId === 'call-3');
  assert.equal(continuedAnswered.ok, true);
  assert.ok(serviceCalls.some((call) => call.callId === 'call-3'
    && call.answer.answers[0].id === 'c1'
    && call.answer.answers[0].selected[0] === '继续'));
  await waitFor(
    (message) => message.type === 'sessions' && message.data.some((session) => session.id === continuedId && !session.pending),
  );

  // With the setting off, the Host keeps tracking but strips the answer surface.
  await service.applySettings({ notifications: { pushQuestions: false } });
  await waitFor((message) => message.type === 'settings' && message.data.pushQuestions === false);

  let secondResolve;
  const secondNext = new Promise((resolve) => {
    secondResolve = resolve;
  });
  const secondHandled = handler.call(
    { id: sessionId },
    {
      questions: [{ id: 'detail', question: '补充说明？', options: [{ label: '不用' }] }],
      agent,
      wait: { callId: 'call-2', timed: false },
    },
    () => secondNext,
  );

  const hidden = await waitFor(
    (message) => message.type === 'sessions'
      && message.data.some((session) => session.id === sessionId && session.pending?.requestId === 'call-2'),
  );
  const hiddenRow = hidden.data.find((session) => session.id === sessionId);
  assert.equal(hiddenRow.pending.questions.length, 0);
  assert.equal(hiddenRow.pending.answerable, false);

  socket.send(JSON.stringify({
    type: 'answer-question',
    sessionId,
    requestId: 'call-2',
    answers: [{ id: 'detail', selected: ['不用'] }],
  }));
  const rejected = await waitFor((message) => message.type === 'answer-result' && message.requestId === 'call-2');
  assert.equal(rejected.ok, false);
  assert.match(rejected.error || '', /推送问询/);

  nextResolve({ answers: [{ id: 'mode', selected: [] }] });
  secondResolve({ answers: [{ id: 'detail', selected: ['不用'] }] });
  void secondHandled.catch(() => {});
  console.log('questions ok');
} finally {
  socket.close();
  await service.stop();
  service.dispose();
  fs.rmSync(profile, { recursive: true, force: true });
}
