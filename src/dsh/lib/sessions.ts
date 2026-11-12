/** Live DSH sessions, their status, and pending question/approval tracking. */

import { isRecord } from './types.js';
import type { DshContext, DshEventHandler, JsonRecord } from './types.js';
import { basename, finiteNumber } from './util.js';

/** Console status of one session row, ranked in this order. */
export type SessionStatus = 'question' | 'running' | 'error' | 'done';

/** One pending question or approval blocking a session. */
export interface PendingInfo {
  kind: 'question' | 'approval';
  question: string;
  header?: string;
  detail?: string;
  count?: number;
  since?: number;
}

/** Pending question/approval tracking shared by the overview and the session pushes. */
export interface PendingTracker {
  snapshot(sessionId: string): PendingInfo[];
  dispose(): void;
}

/** One row of the console session list. */
export interface SessionSummary {
  id: string;
  title: string;
  preview: string;
  cwd: string;
  cwdPath: string;
  createdAt: number;
  lastActiveAt: number;
  turn: number;
  model: string;
  status: SessionStatus;
  agentStatus: string;
  error: string;
  pending: {
    kind: PendingInfo['kind'];
    question: string;
    header: string;
    detail: string;
    since: number;
    count: number;
  } | null;
  isSubagent: boolean;
}

/** One event as returned by `session.snapshotEvents`. */
interface SessionEvent {
  type?: string;
  seq?: number | string;
  time?: number;
  data?: JsonRecord;
}

/** Minimal session shape read by `collectSessions`. */
interface SessionLike {
  id: string | number;
  seq?: number | string;
  snapshotEvents?(from: number): SessionEvent[];
  header?: { cwd?: string; createdAt?: number; origin?: string };
}

/** Minimal `sessions` service: only the list projection is used. */
interface SessionService {
  list?(): SessionLike[];
}

interface AgentModel {
  provider?: string;
  model?: string;
}

/** Minimal agent shape: id, status, and the model label. */
interface AgentLike {
  id?: string;
  status?: string;
  model?: { current?(): AgentModel | null } | null;
}

/** Minimal `agents` service. */
interface AgentService {
  list?(): AgentLike[];
  get?(id: string): AgentLike | undefined;
  currentInitiator?(): AgentLike | undefined;
  turnBoundaryOf?(session: SessionLike): { lastTurn?: number | string } | null | undefined;
}

/** Minimal `sessionTitle` service. */
interface SessionTitleService {
  get?(session: SessionLike): { title?: string } | null | undefined;
}

/** Failure details of the last `turn/end`, as carried by a session event. */
interface TurnErrorReason extends JsonRecord {
  kind?: string;
  error?: { message?: string };
}

/** Fields an event handler extracts from one pending request. */
type PendingDetails = {
  question: string;
  header: string;
  detail: string;
  count: number;
};

function isTurnErrorReason(value: unknown): value is TurnErrorReason {
  return isRecord(value);
}

/** Narrow an untrusted JSON field to a display string. */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function messageText(message: unknown): string {
  if (!message) return '';
  const record: JsonRecord = isRecord(message) ? message : {};
  const blocks: unknown[] = Array.isArray(record.content) ? record.content : Array.isArray(message) ? message : [];
  const parts: string[] = [];
  for (const block of blocks) {
    if (typeof block === 'string') parts.push(block);
    else if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function parseQuestionArguments(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    const questionList: unknown[] = isRecord(parsed) && Array.isArray(parsed.questions) ? parsed.questions : [];
    const first = isRecord(questionList[0]) ? questionList[0] : null;
    if (first && typeof first.question === 'string') return first.question;
  } catch {
    /* malformed partial tool arguments are common while streaming */
  }
  return '';
}

function recentEvents(session: SessionLike, count = 60): SessionEvent[] {
  try {
    const seq = Number(session.seq);
    const from = Math.max(0, seq - count);
    return session.snapshotEvents?.(from) ?? [];
  } catch {
    return [];
  }
}

function findAnswerWait(events: SessionEvent[]): PendingInfo | null {
  const calls = new Map<string, SessionEvent>();
  for (const event of events) {
    if (event?.type === 'tool/call') {
      calls.set(String(event.data?.callId ?? ''), event);
    } else if (event?.type === 'tool/result') {
      const data: JsonRecord = isRecord(event.data) ? event.data : {};
      const message: JsonRecord = isRecord(data.message) ? data.message : {};
      calls.delete(String(data.toolCallId ?? message.toolCallId ?? ''));
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

export function createPendingTracker(ctx: DshContext): PendingTracker {
  const bySession = new Map<string, Map<string, PendingInfo>>();
  let serial = 0;

  function add(sessionId: string | undefined, info: PendingInfo): (() => void) | null {
    if (!sessionId) return null;
    const token = `${Date.now()}-${++serial}`;
    let bucket = bySession.get(sessionId);
    if (!bucket) {
      bucket = new Map<string, PendingInfo>();
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

  function snapshot(sessionId: string): PendingInfo[] {
    const bucket = bySession.get(sessionId);
    if (!bucket) return [];
    return [...bucket.values()].sort((a, b) => (b.since ?? 0) - (a.since ?? 0));
  }

  function wrap(kind: PendingInfo['kind'], extract: (request: unknown) => PendingDetails): DshEventHandler {
    return async function pendingRequest(this: unknown, request, next) {
      const self = this as { id?: string } | undefined;
      const agents = ctx.get?.('agents') as AgentService | undefined;
      const body: JsonRecord = isRecord(request) ? request : {};
      const requestAgent: JsonRecord | null = isRecord(body.agent) ? body.agent : null;
      const requestAgentId = requestAgent && typeof requestAgent.id === 'string' ? requestAgent.id : undefined;
      const sessionId =
        requestAgentId ||
        self?.id ||
        agents?.currentInitiator?.()?.id ||
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

  const disposers: Array<(() => void) | void> = [];
  if (typeof ctx.on === 'function') {
    disposers.push(
      ctx.on(
        'user-questions/request',
        wrap('question', (request) => {
          const body: JsonRecord = isRecord(request) ? request : {};
          const questionList: unknown[] = Array.isArray(body.questions) ? body.questions : [];
          const first: JsonRecord = isRecord(questionList[0]) ? questionList[0] : {};
          return {
            question: asText(first.question) || '正在等待你的回答',
            header: asText(first.header),
            detail: asText(first.detail),
            count: Array.isArray(body.questions) ? body.questions.length : 1,
          };
        }),
      ),
    );
    disposers.push(
      ctx.on(
        'approval/request',
        wrap('approval', (request) => {
          const body: JsonRecord = isRecord(request) ? request : {};
          const display: JsonRecord = isRecord(body.displayReason) ? body.displayReason : {};
          const localized = asText(display.zh) || asText(display.en);
          return {
            question: localized || asText(body.reason) || `需要允许 ${asText(body.toolName) || '工具'} 执行`,
            header: asText(body.toolName),
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
        if (typeof dispose !== 'function') continue;
        try {
          dispose();
        } catch {
          /* ignore */
        }
      }
      disposers.length = 0;
      bySession.clear();
    },
  };
}

export function collectSessions(ctx: DshContext, pendingTracker?: PendingTracker | null): SessionSummary[] {
  const sessionService = ctx.get?.('sessions') as SessionService | undefined;
  const sessions = sessionService?.list?.() ?? [];
  const agents = ctx.get?.('agents') as AgentService | undefined;
  const agentList = agents?.list?.() ?? [];
  const agentById = new Map<string, AgentLike>(
    agentList.map((agent): [string, AgentLike] => [String(agent.id), agent]),
  );
  const titleService = ctx.get?.('sessionTitle') as SessionTitleService | undefined;
  const now = Date.now();
  const result: SessionSummary[] = [];

  for (const session of sessions) {
    const id = String(session.id);
    const agent = agentById.get(id) || agents?.get?.(id);
    const events = recentEvents(session);
    const lastEvent = events.length > 0 ? events[events.length - 1] : null;
    const lastActiveAt: number = finiteNumber(lastEvent?.time, null) ?? finiteNumber(session.header?.createdAt, now) ?? now;
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

    let lastTurnStart: SessionEvent | null = null;
    let lastTurnEnd: SessionEvent | null = null;
    for (const event of events) {
      if (event?.type === 'turn/start') lastTurnStart = event;
      else if (event?.type === 'turn/end') lastTurnEnd = event;
    }
    const reason = lastTurnEnd?.data?.reason;
    const errorReason = lastTurnEnd
      && isTurnErrorReason(reason)
      && (!lastTurnStart || Number(lastTurnEnd.seq) > Number(lastTurnStart.seq))
      && ['error', 'blocked'].includes(reason.kind ?? '')
      ? reason
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
    const status: SessionStatus = isQuestion ? 'question' : isRunning ? 'running' : errorReason ? 'error' : 'done';
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

  const rank: Record<SessionStatus, number> = { question: 0, running: 1, error: 2, done: 3 };
  result.sort((a, b) => {
    const byStatus = (rank[a.status] ?? 3) - (rank[b.status] ?? 3);
    if (byStatus !== 0) return byStatus;
    return b.lastActiveAt - a.lastActiveAt;
  });
  return result;
}
