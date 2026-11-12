/** Live DSH sessions, their status, and pending question/approval tracking. */

import { isRecord } from './types.js';
import type { DshContext, DshEventHandler, JsonRecord } from './types.js';
import { basename, finiteNumber, serializeError } from './util.js';

/** Console status of one session row, ranked in this order. */
export type SessionStatus = 'question' | 'running' | 'error' | 'done';

/** One option of a pending user question. */
export interface PublicQuestionOption {
  label: string;
  description: string;
}

/** One pending user question with the complete selectable answer surface. */
export interface PublicQuestion {
  id: string;
  question: string;
  header: string;
  detail: string;
  options: PublicQuestionOption[];
  multiSelect: boolean;
}

/** One answer item of a pending question batch. */
export interface PendingAnswerItem {
  id: string;
  selected: string[];
  custom?: string;
}

/** Complete structured answer batch, one item per question. */
export interface PendingAnswer {
  answers: PendingAnswerItem[];
}

/** Result of forwarding one remote answer to the waiting question. */
export interface PendingAnswerResult {
  ok: boolean;
  error?: string;
}

/** One pending question or approval blocking a session. */
export interface PendingInfo {
  kind: 'question' | 'approval';
  question: string;
  header?: string;
  detail?: string;
  count?: number;
  since?: number;
  /** Stable identity the remote console echoes when it answers. */
  requestId?: string;
  /** Complete question batch; empty for approvals. */
  questions?: PublicQuestion[];
  /** Whether the remote console can submit an answer for this request. */
  answerable?: boolean;
}

/** Pending question/approval tracking shared by the overview and the session pushes. */
export interface PendingTracker {
  snapshot(sessionId: string): PendingInfo[];
  /** Forward a remote answer to the live waterfall or the continued-question service. */
  respond(sessionId: string, requestId: string, answer: PendingAnswer): Promise<PendingAnswerResult>;
  /** Register a question reconstructed from the session log as answerable. */
  adopt(sessionId: string, info: PendingInfo, agent: unknown): void;
  /** Drop continued-question handles whose tool call the log says settled. */
  pruneContinued(sessionId: string, settledCallIds: ReadonlySet<string>): void;
  /** True while a just-settled question must not be re-adopted from a stale log. */
  isSettled(sessionId: string, callId: string): boolean;
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
  /** Start time of the currently open turn, read from the DSH session log. */
  runningSince: number | null;
  error: string;
  pending: {
    kind: PendingInfo['kind'];
    question: string;
    header: string;
    detail: string;
    since: number;
    count: number;
    requestId: string;
    questions: PublicQuestion[];
    answerable: boolean;
  } | null;
  isSubagent: boolean;
  /** Parent session id for a subagent session (durable lineage). */
  parentId: string;
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
  eventAt?(seq: number): SessionEvent | undefined;
  header?: { cwd?: string; createdAt?: number; origin?: string; parentSession?: string };
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
  turnBoundaryOf?(session: SessionLike): {
    lastTurn?: number | string;
    openTurnStartSeq?: number | string | null;
  } | null | undefined;
}

/** Minimal `sessionTitle` service. */
interface SessionTitleService {
  get?(session: SessionLike): { title?: string } | null | undefined;
}

/** The part of `userQuestions` used to answer a continued question. */
interface UserQuestionsService {
  answer?(agent: unknown, callId: string, answer: PendingAnswer): boolean;
}

/** Failure details of the last `turn/end`, as carried by a session event. */
interface TurnErrorReason extends JsonRecord {
  kind?: string;
  error?: { message?: string };
}

type HandleMode = 'live' | 'continued' | 'unavailable';

/** One answer path for a pending question. */
interface QuestionHandle {
  sessionId: string;
  requestId: string;
  callId: string;
  agent: unknown;
  questions: PublicQuestion[];
  mode: HandleMode;
  resolve?: (answer: PendingAnswer) => void;
  promise?: Promise<PendingAnswer>;
  /** Removes the matching pending row from this session's snapshot. */
  removeInfo?: () => void;
}

/** Options for {@link createPendingTracker}. */
export interface PendingTrackerOptions {
  /** Called shortly after the pending set changes, so the console can refresh. */
  onChange?: () => void;
}

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

/** Normalise one question option from either the service or tool vocabulary. */
function normalizeOption(raw: unknown): PublicQuestionOption | null {
  const record: JsonRecord = isRecord(raw) ? raw : {};
  const label = asText(record.label).trim();
  if (!label) return null;
  return {
    label: label.slice(0, 300),
    description: asText(record.description).trim().slice(0, 1000),
  };
}

/** Normalise one question from either the service or tool vocabulary. */
function normalizeQuestion(raw: unknown, index: number): PublicQuestion | null {
  if (!isRecord(raw)) return null;
  const id = asText(raw.id).trim() || `q${index + 1}`;
  const question = asText(raw.question).trim();
  if (!question) return null;
  const rawOptions: unknown[] = Array.isArray(raw.options) ? raw.options : [];
  const options: PublicQuestionOption[] = [];
  for (const item of rawOptions.slice(0, 30)) {
    const option = normalizeOption(item);
    if (option) options.push(option);
  }
  return {
    id: id.slice(0, 200),
    question: question.slice(0, 3000),
    header: asText(raw.header).trim().slice(0, 200),
    detail: asText(raw.detail).slice(0, 8000),
    options,
    multiSelect: raw.multiSelect === true || raw.multi_select === true,
  };
}

/** Read a complete question batch off an event or request payload. */
function parseQuestionList(raw: unknown): PublicQuestion[] {
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  const questions: PublicQuestion[] = [];
  for (let index = 0; index < list.length && questions.length < 20; index += 1) {
    const question = normalizeQuestion(list[index], index);
    if (question) questions.push(question);
  }
  return questions;
}

/** Read a question batch off a recorded `ask_user_question` arguments string. */
function parseQuestionArguments(raw: unknown): PublicQuestion[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parseQuestionList(parsed.questions) : [];
  } catch {
    /* malformed partial tool arguments are common while streaming */
    return [];
  }
}

/** Normalise an untrusted answer batch from the remote console. */
export function parsePendingAnswer(raw: unknown): PendingAnswer | null {
  if (!isRecord(raw) || !Array.isArray(raw.answers)) return null;
  const answers: PendingAnswerItem[] = [];
  for (const item of raw.answers.slice(0, 20)) {
    if (!isRecord(item)) return null;
    const id = asText(item.id).trim();
    if (!id) return null;
    const selected: string[] = [];
    if (Array.isArray(item.selected)) {
      for (const label of item.selected.slice(0, 30)) {
        const text = asText(label).trim();
        if (text) selected.push(text.slice(0, 300));
      }
    }
    const custom = asText(item.custom).trim();
    const answer: PendingAnswerItem = { id: id.slice(0, 200), selected };
    if (custom) answer.custom = custom.slice(0, 4000);
    answers.push(answer);
  }
  return { answers };
}

function recentEvents(session: SessionLike, count = 160): SessionEvent[] {
  try {
    const seq = Number(session.seq);
    const from = Math.max(0, seq - count);
    return session.snapshotEvents?.(from) ?? [];
  } catch {
    return [];
  }
}

/** Whether a `tool/result` left the question answerable as a continued request. */
function isContinuedResult(event: SessionEvent): boolean {
  const message: JsonRecord = isRecord(event.data?.message) ? (event.data?.message as JsonRecord) : {};
  const blocks: unknown[] = Array.isArray(message.content) ? message.content : [];
  for (const block of blocks) {
    if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') continue;
    try {
      const parsed: unknown = JSON.parse(block.text);
      if (isRecord(parsed) && parsed.pending === true) return true;
    } catch {
      /* a recorded answer is not JSON we can use here */
    }
  }
  const error: JsonRecord = isRecord(event.data?.error) ? (event.data?.error as JsonRecord) : {};
  const code = asText(error.code);
  return code === 'TOOL_OUTCOME_UNKNOWN' || code === 'tool-outcome-unknown';
}

interface AnswerWaitState {
  pending: PendingInfo | null;
  settledCallIds: Set<string>;
}

/**
 * Find the latest `ask_user_question` call that is still open or continued.
 * A call with a plain tool result is settled and no longer represents a wait.
 */
function findAnswerWait(events: SessionEvent[]): AnswerWaitState {
  interface CallState {
    event: SessionEvent;
    result: SessionEvent | null;
    requestId: string;
  }
  const calls = new Map<string, CallState>();
  const order: string[] = [];

  for (const event of events) {
    if (event?.type === 'tool/call' && event.data?.name === 'ask_user_question') {
      const requestId = String(event.data?.callId ?? '');
      if (!requestId) continue;
      calls.set(requestId, { event, result: null, requestId });
      order.push(requestId);
    } else if (event?.type === 'tool/result') {
      const data: JsonRecord = isRecord(event.data) ? event.data : {};
      const message: JsonRecord = isRecord(data.message) ? data.message : {};
      const requestId = String(data.toolCallId ?? message.toolCallId ?? '');
      const call = calls.get(requestId);
      if (call) call.result = event;
    } else if (event?.type === 'user/message') {
      const data: JsonRecord = isRecord(event.data) ? event.data : {};
      const source: JsonRecord = isRecord(data.source) ? data.source : {};
      if (source.kind !== 'user-question-reply') continue;
      const requestId = String(source.callId ?? '');
      const call = calls.get(requestId);
      if (call) call.result = event;
    }
  }

  const settledCallIds = new Set<string>();
  let pending: PendingInfo | null = null;
  for (const requestId of order) {
    const call = calls.get(requestId);
    if (!call) continue;
    const continued = call.result !== null && isContinuedResult(call.result);
    const settled = call.result !== null && !continued;
    if (settled) {
      settledCallIds.add(requestId);
      continue;
    }
    const questions = parseQuestionArguments(call.event.data?.arguments);
    const first = questions[0] ?? null;
    pending = {
      kind: 'question',
      question: first?.question || '正在等待你的回答',
      header: first?.header || '',
      detail: first?.detail || '',
      count: questions.length || 1,
      since: finiteNumber(call.event.time, Date.now()) ?? Date.now(),
      requestId,
      questions,
      answerable: continued,
    };
  }
  return { pending, settledCallIds };
}

function deferredAnswer(): { promise: Promise<PendingAnswer>; resolve: (answer: PendingAnswer) => void } {
  let resolve!: (answer: PendingAnswer) => void;
  const promise = new Promise<PendingAnswer>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function isTimedOutError(error: unknown): boolean {
  return isRecord(error) && (error.code === 'ASK_TIMED_OUT' || error.name === 'UserQuestionError' && error.code === 'ASK_TIMED_OUT');
}

function validateAnswer(questions: PublicQuestion[], answer: PendingAnswer): string | null {
  if (answer.answers.length !== questions.length) {
    return `回答数量不匹配：需要 ${questions.length} 项，收到 ${answer.answers.length} 项`;
  }
  const seen = new Set<string>();
  for (const item of answer.answers) {
    if (!item.id || seen.has(item.id)) return '回答项重复或缺少问题编号';
    seen.add(item.id);
    const question = questions.find((candidate) => candidate.id === item.id);
    if (!question) return '回答项不属于当前问题';
    if (question.multiSelect !== true && item.selected.length > 1) return '单选题只能选择一个选项';
    for (const label of item.selected) {
      if (!question.options.some((option) => option.label === label)) return '选择的选项已不在问题中';
    }
  }
  for (const question of questions) {
    if (!seen.has(question.id)) return '回答缺少问题';
  }
  return null;
}

export function createPendingTracker(ctx: DshContext, options: PendingTrackerOptions = {}): PendingTracker {
  const bySession = new Map<string, Map<string, PendingInfo>>();
  const handles = new Map<string, QuestionHandle>();
  /** `${sessionId}\0${callId}` → time the answer was sent. */
  const settledCalls = new Map<string, number>();
  /** Session-level suppression for a live request that settled without a call id. */
  const settledSessions = new Map<string, number>();
  const SETTLED_TTL = 60_000;
  const SESSION_SETTLED_TTL = 6_000;
  let serial = 0;
  let notifyTimer: ReturnType<typeof setTimeout> | null = null;

  function handleKey(sessionId: string, requestId: string): string {
    return `${sessionId}\u0000${requestId}`;
  }

  function notify(): void {
    if (!options.onChange || notifyTimer) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      try {
        options.onChange?.();
      } catch {
        /* pushing must never break the request path */
      }
    }, 40);
    notifyTimer.unref?.();
  }

  function pruneSettled(now: number): void {
    for (const [key, at] of settledCalls) if (now - at > SETTLED_TTL) settledCalls.delete(key);
    for (const [key, at] of settledSessions) if (now - at > SESSION_SETTLED_TTL) settledSessions.delete(key);
  }

  function markSettled(sessionId: string, callId: string): void {
    const now = Date.now();
    pruneSettled(now);
    settledSessions.set(sessionId, now);
    if (callId) settledCalls.set(handleKey(sessionId, callId), now);
  }

  function isSettled(sessionId: string, callId: string): boolean {
    const now = Date.now();
    pruneSettled(now);
    if (!sessionId) return false;
    if (callId && settledCalls.has(handleKey(sessionId, callId))) return true;
    const sessionAt = settledSessions.get(sessionId);
    return sessionAt !== undefined && now - sessionAt <= SESSION_SETTLED_TTL;
  }

  function add(sessionId: string | undefined, info: PendingInfo): (() => void) | null {
    if (!sessionId) return null;
    const token = `${Date.now()}-${++serial}`;
    let bucket = bySession.get(sessionId);
    if (!bucket) {
      bucket = new Map<string, PendingInfo>();
      bySession.set(sessionId, bucket);
    }
    bucket.set(token, info);
    notify();
    return () => {
      const current = bySession.get(sessionId);
      if (!current) return;
      current.delete(token);
      if (current.size === 0) bySession.delete(sessionId);
      notify();
    };
  }

  function snapshot(sessionId: string): PendingInfo[] {
    const bucket = bySession.get(sessionId);
    if (!bucket) return [];
    return [...bucket.values()].sort((a, b) => (b.since ?? 0) - (a.since ?? 0));
  }

  function removeHandle(key: string): QuestionHandle | null {
    const handle = handles.get(key);
    if (!handle) return null;
    handles.delete(key);
    return handle;
  }

  function adopt(sessionId: string, info: PendingInfo, agent: unknown): void {
    const requestId = info.requestId || '';
    if (!requestId || !sessionId) return;
    const key = handleKey(sessionId, requestId);
    if (handles.has(key) || isSettled(sessionId, requestId)) return;
    handles.set(key, {
      sessionId,
      requestId,
      callId: requestId,
      agent,
      questions: info.questions ?? [],
      mode: info.answerable === true ? 'continued' : 'unavailable',
    });
  }

  function pruneContinued(sessionId: string, settledCallIds: ReadonlySet<string>): void {
    let changed = false;
    for (const [key, handle] of [...handles]) {
      if (handle.sessionId !== sessionId) continue;
      if (handle.mode === 'live') continue;
      if (!handle.callId || !settledCallIds.has(handle.callId)) continue;
      handles.delete(key);
      handle.removeInfo?.();
      changed = true;
    }
    if (changed) notify();
  }

  async function respond(sessionId: string, requestId: string, answer: PendingAnswer): Promise<PendingAnswerResult> {
    const key = handleKey(sessionId, requestId);
    const handle = handles.get(key);
    if (!handle) return { ok: false, error: '这个问题已经结束或不在等待回答' };
    if (handle.mode === 'unavailable') return { ok: false, error: '这个问题需要在 DSH 中回答' };
    const invalid = validateAnswer(handle.questions, answer);
    if (invalid) return { ok: false, error: invalid };

    if (handle.mode === 'live' && handle.resolve) {
      const resolve = handle.resolve;
      handle.resolve = undefined;
      markSettled(sessionId, handle.callId);
      resolve(answer);
      handle.removeInfo?.();
      removeHandle(key);
      notify();
      return { ok: true };
    }

    if (!handle.callId) {
      removeHandle(key);
      handle.removeInfo?.();
      notify();
      return { ok: false, error: '缺少问题编号，无法回答' };
    }
    const service = ctx.get?.('userQuestions') as UserQuestionsService | undefined;
    if (!service?.answer) return { ok: false, error: '当前 DSH 不支持远程回答' };
    try {
      const accepted = service.answer(handle.agent, handle.callId, answer);
      if (!accepted) {
        markSettled(sessionId, handle.callId);
        removeHandle(key);
        handle.removeInfo?.();
        notify();
        return { ok: false, error: '这个问题已经不再等待回答' };
      }
      markSettled(sessionId, handle.callId);
      removeHandle(key);
      handle.removeInfo?.();
      notify();
      return { ok: true };
    } catch (error) {
      const code = isRecord(error) ? asText(error.code) : '';
      if (code === 'CALLER_NOT_LIVE' || code === 'DELEGATED_CALLER') {
        markSettled(sessionId, handle.callId);
        removeHandle(key);
        handle.removeInfo?.();
        notify();
      }
      return { ok: false, error: serializeError(error) };
    }
  }

  function wrapApproval(): DshEventHandler {
    return async function pendingRequest(this: unknown, request, next) {
      const self = this as { id?: string } | undefined;
      const agents = ctx.get?.('agents') as AgentService | undefined;
      const body: JsonRecord = isRecord(request) ? request : {};
      const requestAgent: JsonRecord | null = isRecord(body.agent) ? body.agent : null;
      const requestAgentId = requestAgent && typeof requestAgent.id === 'string' ? requestAgent.id : undefined;
      const sessionId = requestAgentId || self?.id || agents?.currentInitiator?.()?.id || undefined;
      const display: JsonRecord = isRecord(body.displayReason) ? body.displayReason : {};
      const localized = asText(display.zh) || asText(display.en);
      const info: PendingInfo = {
        kind: 'approval',
        question: localized || asText(body.reason) || `需要允许 ${asText(body.toolName) || '工具'} 执行`,
        header: asText(body.toolName),
        detail: '',
        count: 1,
        since: Date.now(),
        requestId: `approval-${Date.now()}-${++serial}`,
        questions: [],
        answerable: false,
      };
      const remove = add(sessionId, info);
      try {
        return await next();
      } finally {
        remove?.();
      }
    };
  }

  function wrapQuestion(): DshEventHandler {
    return async function pendingRequest(this: unknown, request, next) {
      const self = this as { id?: string } | undefined;
      const agents = ctx.get?.('agents') as AgentService | undefined;
      const body: JsonRecord = isRecord(request) ? request : {};
      const requestAgent: JsonRecord | null = isRecord(body.agent) ? body.agent : null;
      const requestAgentId = requestAgent && typeof requestAgent.id === 'string' ? requestAgent.id : undefined;
      const sessionId = requestAgentId || self?.id || agents?.currentInitiator?.()?.id || undefined;
      const agent = requestAgent || (sessionId ? agents?.get?.(sessionId) : undefined);
      const questions = parseQuestionList(body.questions);
      const first = questions[0] ?? null;
      const wait: JsonRecord = isRecord(body.wait) ? body.wait : {};
      const callId = asText(wait.callId);
      const requestId = callId || `question-${Date.now()}-${++serial}`;
      const info: PendingInfo = {
        kind: 'question',
        question: first?.question || '正在等待你的回答',
        header: first?.header || '',
        detail: first?.detail || '',
        count: questions.length || 1,
        since: Date.now(),
        requestId,
        questions,
        answerable: true,
      };
      const deferred = deferredAnswer();
      const handle: QuestionHandle = {
        sessionId: sessionId || '',
        requestId,
        callId,
        agent,
        questions,
        mode: 'live',
        resolve: deferred.resolve,
        promise: deferred.promise,
      };
      if (sessionId) handle.removeInfo = add(sessionId, info) ?? undefined;
      handles.set(handleKey(sessionId || '', requestId), handle);
      notify();

      // Forward to the normal DSH answerer as well. The remote answer and the
      // DSH answer race; whichever settles first is returned through the
      // standard `user-questions/request` waterfall. This keeps DSH's own
      // question card visible (it may remain until closed there, which is
      // expected DSH client behavior).
      const delegated = Promise.resolve().then(() => next());
      // The DSH answerer is abandoned when a remote answer wins; its eventual
      // settlement must not surface as an unhandled rejection.
      delegated.catch(() => {});
      let settled = false;
      try {
        const race = await Promise.race([
          deferred.promise.then((answer) => ({ kind: 'remote' as const, answer })),
          delegated.then((outcome) => ({ kind: 'local' as const, outcome: outcome as unknown as PendingAnswer })),
        ]);
        settled = true;
        if (callId) markSettled(sessionId || '', callId);
        return race.kind === 'remote' ? race.answer : race.outcome;
      } catch (error) {
        if (wait.timed === true && callId && isTimedOutError(error)) {
          // The foreground wait became a continued question. Keep the row and
          // let `userQuestions.answer` accept the remote answer from now on.
          handle.mode = 'continued';
          handle.resolve = undefined;
          notify();
          throw error;
        }
        markSettled(sessionId || '', callId);
        handles.delete(handleKey(sessionId || '', requestId));
        handle.removeInfo?.();
        notify();
        throw error;
      } finally {
        if (settled) {
          markSettled(sessionId || '', callId);
          handles.delete(handleKey(sessionId || '', requestId));
          handle.removeInfo?.();
          notify();
        }
      }
    };
  }

  const disposers: Array<(() => void) | void> = [];
  if (typeof ctx.on === 'function') {
    // Prepend: the DSH Web client forwards this waterfall to the browser. If
    // its listener ran first, it would hold the request and this tracker would
    // never see a live question. Running first lets us track the request and
    // then delegate to the normal answerer through `next()`.
    disposers.push(ctx.on('user-questions/request', wrapQuestion(), { prepend: true }));
    disposers.push(ctx.on('approval/request', wrapApproval(), { prepend: true }));
  }

  return {
    snapshot,
    respond,
    adopt,
    pruneContinued,
    isSettled,
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
      if (notifyTimer) {
        clearTimeout(notifyTimer);
        notifyTimer = null;
      }
      bySession.clear();
      handles.clear();
      settledCalls.clear();
      settledSessions.clear();
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
    const wait = findAnswerWait(events);
    pendingTracker?.pruneContinued(id, wait.settledCallIds);
    const tracked = pendingTracker?.snapshot(id) ?? [];
    let fallbackPending: PendingInfo | null = null;
    if (tracked.length === 0 && agent?.status === 'running' && wait.pending) {
      const requestId = wait.pending.requestId || '';
      if (!pendingTracker?.isSettled(id, requestId)) {
        fallbackPending = wait.pending;
        pendingTracker?.adopt(id, fallbackPending, agent);
      }
    }
    const pending = tracked.length > 0 ? tracked : fallbackPending ? [fallbackPending] : [];

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

    // Prefer the DSH projection's open-turn marker; fall back to the recent
    // event window so the console can show a live elapsed time while running.
    let runningSince: number | null = null;
    try {
      const boundary = agents?.turnBoundaryOf?.(session);
      const openSeq = finiteNumber(boundary?.openTurnStartSeq, null);
      if (openSeq !== null) {
        runningSince = finiteNumber(session.eventAt?.(openSeq)?.time, null);
      }
    } catch {
      /* boundary projection may not be available */
    }
    if (runningSince === null && agent?.status === 'running' && lastTurnStart) {
      runningSince = finiteNumber(lastTurnStart.time, null);
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

    const isQuestion = pending.length > 0;
    const isRunning = agent?.status === 'running';
    const status: SessionStatus = isQuestion ? 'question' : isRunning ? 'running' : errorReason ? 'error' : 'done';
    const primaryPending = pending[0] || null;
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
      runningSince,
      error: errorMessage,
      pending: primaryPending
        ? {
            kind: primaryPending.kind,
            question: String(primaryPending.question || '').slice(0, 220),
            header: String(primaryPending.header || '').slice(0, 80),
            detail: String(primaryPending.detail || '').slice(0, 260),
            since: finiteNumber(primaryPending.since, now) ?? now,
            count: finiteNumber(primaryPending.count, 1) ?? 1,
            requestId: String(primaryPending.requestId || ''),
            questions: primaryPending.questions ?? [],
            answerable: primaryPending.answerable === true,
          }
        : null,
      isSubagent: session.header?.origin === 'subagent',
      parentId: session.header?.parentSession ? String(session.header.parentSession) : '',
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
