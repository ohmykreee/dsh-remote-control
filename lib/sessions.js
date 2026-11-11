/** Live DSH sessions, their status, and pending question/approval tracking. */

import { basename, finiteNumber } from './util.js';

function messageText(message) {
  if (!message) return '';
  const blocks = Array.isArray(message.content) ? message.content : Array.isArray(message) ? message : [];
  const parts = [];
  for (const block of blocks) {
    if (typeof block === 'string') parts.push(block);
    else if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function parseQuestionArguments(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return '';
  try {
    const parsed = JSON.parse(raw);
    const first = parsed?.questions?.[0];
    if (first && typeof first.question === 'string') return first.question;
  } catch {
    /* malformed partial tool arguments are common while streaming */
  }
  return '';
}

function recentEvents(session, count = 60) {
  try {
    const seq = Number(session.seq);
    const from = Math.max(0, seq - count);
    return session.snapshotEvents(from) ?? [];
  } catch {
    return [];
  }
}

function findAnswerWait(events) {
  const calls = new Map();
  for (const event of events) {
    if (event?.type === 'tool/call') {
      calls.set(String(event.data?.callId ?? ''), event);
    } else if (event?.type === 'tool/result') {
      calls.delete(String(event.data?.toolCallId ?? event.data?.message?.toolCallId ?? ''));
    }
  }
  for (const event of [...calls.values()].reverse()) {
    if (event?.data?.name === 'ask_user_question') {
      return {
        kind: 'question',
        question: parseQuestionArguments(event.data?.arguments) || '正在等待你的回答',
        since: event.time ?? Date.now(),
      };
    }
  }
  return null;
}

export function createPendingTracker(ctx) {
  const bySession = new Map();
  let serial = 0;

  function add(sessionId, info) {
    if (!sessionId) return null;
    const token = `${Date.now()}-${++serial}`;
    let bucket = bySession.get(sessionId);
    if (!bucket) {
      bucket = new Map();
      bySession.set(sessionId, bucket);
    }
    bucket.set(token, info);
    return () => {
      const current = bySession.get(sessionId);
      if (!current) return;
      current.delete(token);
      if (current.size === 0) bySession.delete(sessionId);
    };
  }

  function snapshot(sessionId) {
    const bucket = bySession.get(sessionId);
    if (!bucket) return [];
    return [...bucket.values()].sort((a, b) => (b.since ?? 0) - (a.since ?? 0));
  }

  function wrap(kind, extract) {
    return async function pendingRequest(request, next) {
      const sessionId =
        request?.agent?.id ||
        this?.id ||
        ctx.get?.('agents')?.currentInitiator?.()?.id ||
        undefined;
      const info = extract(request);
      const remove = sessionId ? add(sessionId, { kind, ...info, since: Date.now() }) : null;
      try {
        return await next();
      } finally {
        remove?.();
      }
    };
  }

  const disposers = [];
  if (typeof ctx.on === 'function') {
    disposers.push(
      ctx.on(
        'user-questions/request',
        wrap('question', (request) => {
          const first = request?.questions?.[0];
          return {
            question: first?.question || '正在等待你的回答',
            header: first?.header || '',
            detail: first?.detail || '',
            count: request?.questions?.length ?? 1,
          };
        }),
      ),
    );
    disposers.push(
      ctx.on(
        'approval/request',
        wrap('approval', (request) => {
          const localized = request?.displayReason?.zh || request?.displayReason?.en;
          return {
            question: localized || request?.reason || `需要允许 ${request?.toolName || '工具'} 执行`,
            header: request?.toolName || '',
            detail: '',
            count: 1,
          };
        }),
      ),
    );
  }

  return {
    snapshot,
    dispose() {
      for (const dispose of disposers) {
        try {
          dispose?.();
        } catch {
          /* ignore */
        }
      }
      disposers.length = 0;
      bySession.clear();
    },
  };
}

export function collectSessions(ctx, pendingTracker) {
  const sessions = ctx.get?.('sessions')?.list?.() ?? [];
  const agents = ctx.get?.('agents');
  const agentList = agents?.list?.() ?? [];
  const agentById = new Map(agentList.map((agent) => [String(agent.id), agent]));
  const titleService = ctx.get?.('sessionTitle');
  const now = Date.now();
  const result = [];

  for (const session of sessions) {
    const id = String(session.id);
    const agent = agentById.get(id) || agents?.get?.(id);
    const events = recentEvents(session);
    const lastEvent = events.length > 0 ? events[events.length - 1] : null;
    const lastActiveAt = finiteNumber(lastEvent?.time, null) ?? finiteNumber(session.header?.createdAt, now) ?? now;
    const pending = pendingTracker?.snapshot(id) ?? [];
    const fallbackPending = pending.length === 0 && agent?.status === 'running' ? findAnswerWait(events) : null;

    let title = '';
    try {
      title = titleService?.get?.(session)?.title || '';
    } catch {
      /* title projection may not be ready */
    }
    let preview = '';
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i]?.type === 'assistant/message') {
        preview = messageText(events[i].data?.message);
        if (preview) break;
      }
    }
    if (!preview) {
      for (let i = events.length - 1; i >= 0; i -= 1) {
        if (events[i]?.type === 'user/message') {
          preview = messageText(events[i].data);
          if (preview) break;
        }
      }
    }
    if (!title) {
      for (let i = events.length - 1; i >= 0; i -= 1) {
        if (events[i]?.type === 'user/message') {
          title = messageText(events[i].data);
          if (title) break;
        }
      }
    }
    const cwd = session.header?.cwd || '';
    if (!title) title = basename(cwd) || '新会话';

    let lastTurnStart = null;
    let lastTurnEnd = null;
    for (const event of events) {
      if (event?.type === 'turn/start') lastTurnStart = event;
      else if (event?.type === 'turn/end') lastTurnEnd = event;
    }
    const errorReason = lastTurnEnd
      && (!lastTurnStart || Number(lastTurnEnd.seq) > Number(lastTurnStart.seq))
      && ['error', 'blocked'].includes(lastTurnEnd.data?.reason?.kind)
      ? lastTurnEnd.data.reason
      : null;

    let turn = 0;
    try {
      turn = finiteNumber(agents?.turnBoundaryOf?.(session)?.lastTurn, 0) ?? 0;
    } catch {
      /* turn projection may not exist in a minimal composition */
    }

    let model = '';
    try {
      const current = agent?.model?.current?.();
      if (current?.provider && current?.model) model = `${current.provider} / ${current.model}`;
    } catch {
      /* optional */
    }

    const isQuestion = pending.length > 0 || Boolean(fallbackPending);
    const isRunning = agent?.status === 'running';
    const status = isQuestion ? 'question' : isRunning ? 'running' : errorReason ? 'error' : 'done';
    const primaryPending = pending[0] || fallbackPending || null;
    const errorMessage = errorReason?.kind === 'error'
      ? errorReason.error?.message || '本轮运行出错'
      : errorReason?.kind === 'blocked'
        ? '本轮被阻止'
        : '';

    result.push({
      id,
      title: String(title).slice(0, 120),
      preview: String(preview).slice(0, 180),
      cwd: basename(cwd) || '',
      cwdPath: cwd,
      createdAt: finiteNumber(session.header?.createdAt, now) ?? now,
      lastActiveAt,
      turn,
      model,
      status,
      agentStatus: agent?.status || 'inactive',
      error: errorMessage,
      pending: primaryPending
        ? {
            kind: primaryPending.kind,
            question: String(primaryPending.question || '').slice(0, 220),
            header: String(primaryPending.header || '').slice(0, 80),
            detail: String(primaryPending.detail || '').slice(0, 260),
            since: finiteNumber(primaryPending.since, now) ?? now,
            count: finiteNumber(primaryPending.count, 1) ?? 1,
          }
        : null,
      isSubagent: session.header?.origin === 'subagent',
    });
  }

  const rank = { question: 0, running: 1, error: 2, done: 3 };
  result.sort((a, b) => {
    const byStatus = (rank[a.status] ?? 3) - (rank[b.status] ?? 3);
    if (byStatus !== 0) return byStatus;
    return b.lastActiveAt - a.lastActiveAt;
  });
  return result;
}
