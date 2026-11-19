import { setLocale, t } from './i18n.svelte';
import { DEFAULT_ORDER, normalizeOrder } from './pages';
import { clearQuickQaImage, handleQuickQaMessage, quickQa, quickQaPendingSession, quickQaSyncSettings } from './quickqa.svelte';
import {
  DEFAULT_COUNTDOWN_PRESETS,
  normalizeCountdown,
  normalizeNavPosition,
  normalizePomodoro,
} from './settings-normalize';
import { setWakeLockEnabled } from './wake-lock';
import { configureLive, connectLive, disposeLive, isLiveOpen, sendLive } from './ws';
import type {
  ConsoleSettings,
  ConsoleState,
  MediaPayload,
  OverviewData,
  QuestionAnswerItem,
  ServerMessage,
  SessionItem,
} from './types';

/**
 * Shared live state for the mobile console.
 *
 * Svelte 5 runes make this plain object deeply reactive, so every page (and its
 * infinite-loop clone) renders from the same WebSocket snapshot without the
 * old imperative `syncClones()` DOM copying.
 */
export const app: ConsoleState = $state({
  online: null,
  theme: 'dark',
  temperatureUnit: 'celsius',
  pushQuestions: false,
  navPosition: 'left',
  pomodoro: { enabled: false, focusMinutes: 25, breakMinutes: 5, soundPath: '', loopAlarm: false },
  countdown: { enabled: false, presets: [...DEFAULT_COUNTDOWN_PRESETS] },
  quickqa: {
    voiceReady: false,
    defaultWorkspaceId: '',
    defaultWorkspaceTitle: '',
    pinned: [],
    pushQuestions: false,
    allowImages: false,
  },
  balanceDisplay: { showPeakValley: true, spendWindow: 'calendar' },
  pageOrder: [...DEFAULT_ORDER],
  pageEnabled: { home: true, sessions: true, quickqa: true, music: true, performance: true },
  pageRevision: 0,

  overview: null,
  weather: null,
  notifications: null,
  account: null,
  sessions: [],
  sessionsError: null,
  performance: null,

  media: null,
  clockNow: Date.now(),

  volumeDragging: false,
  volumeInput: 0.2,
  volumeTarget: 0.2,

  toastVisible: false,
  toastMessage: '',

  activeKey: 'home',
  initialKey: null,
  hasNavigated: false,
  fullscreen: false,
  answerSessionId: null,
});

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function setOnline(value: boolean | null): void {
  app.online = value;
}

export function toast(message: string): void {
  app.toastMessage = String(message || '');
  app.toastVisible = true;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    app.toastVisible = false;
  }, 2600);
}

export function sendAction(action: string, value?: number | boolean): boolean {
  const message = { type: 'action' as const, action, ...(value !== undefined ? { value } : {}) };
  if (!sendLive(message)) {
    toast(t('connecting'));
    return false;
  }
  return true;
}

interface AnswerWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const answerWaiters = new Map<string, AnswerWaiter>();

function answerKey(sessionId: string, requestId: string): string {
  return `${sessionId}\u0000${requestId}`;
}

/** Open the quick-reply sheet for a session waiting on a question. */
export function openQuestion(sessionId: string): void {
  const session = app.sessions.find((item) => item.id === sessionId);
  if (!session) return;
  if (!app.pushQuestions) {
    toast(t('pushQuestionsOff'));
    return;
  }
  if (session.pending?.kind === 'approval') {
    toast(t('approvalPending'));
    return;
  }
  if (session.pending?.answerable === false) {
    toast(t('answerInDsh'));
    return;
  }
  if (!session.pending?.questions?.length) {
    toast(t('answerInDsh'));
    return;
  }
  app.answerSessionId = sessionId;
}

/** Close the quick-reply sheet without answering. */
export function closeQuestion(): void {
  app.answerSessionId = null;
}

/** Submit one complete answer batch and wait for the Host acknowledgement. */
export function submitQuestionAnswer(
  sessionId: string,
  requestId: string,
  answers: QuestionAnswerItem[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isLiveOpen()) {
      reject(new Error(t('connectionLost')));
      return;
    }
    const key = answerKey(sessionId, requestId);
    const previous = answerWaiters.get(key);
    if (previous) {
      clearTimeout(previous.timer);
      answerWaiters.delete(key);
      previous.reject(new Error(t('answerReplaced')));
    }
    const timer = setTimeout(() => {
      const waiter = answerWaiters.get(key);
      if (!waiter) return;
      answerWaiters.delete(key);
      waiter.reject(new Error(t('answerTimeout')));
    }, 12_000);
    answerWaiters.set(key, { resolve, reject, timer });
    if (!sendLive({ type: 'answer-question', sessionId, requestId, answers })) {
      answerWaiters.delete(key);
      clearTimeout(timer);
      reject(new Error(t('connectionLost')));
    }
  });
}

/**
 * Fail every in-flight answer. Once the socket is gone the `answer-result`
 * frame can no longer arrive, so waiting for the 12 s timeout would leave the
 * inquiry sheet disabled behind a spinner.
 */
function failAnswerWaiters(): void {
  if (answerWaiters.size === 0) return;
  const error = new Error(t('connectionLost'));
  for (const waiter of answerWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
  answerWaiters.clear();
}

export function applyTheme(theme: string): void {
  app.theme = theme === 'light' ? 'light' : 'dark';
}

export function applySettings(settings: ConsoleSettings | undefined): void {
  if (!settings) return;
  if (settings.theme) applyTheme(settings.theme);
  setLocale(settings.locale);
  if (settings.temperatureUnit) {
    app.temperatureUnit = settings.temperatureUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  }
  app.pushQuestions = settings.pushQuestions === true;
  if (settings.navPosition) app.navPosition = normalizeNavPosition(settings.navPosition);
  if (settings.pomodoro) app.pomodoro = normalizePomodoro(settings.pomodoro, app.pomodoro);
  if (settings.countdown) app.countdown = normalizeCountdown(settings.countdown, app.countdown);
  // The Host enforces this too; mirror it so a stale or hand-built snapshot can
  // never render both timer cards at once.
  if (app.pomodoro.enabled) app.countdown.enabled = false;
  else if (app.countdown.enabled) app.pomodoro.enabled = false;
  if (settings.quickqa) {
    app.quickqa = {
      ...app.quickqa,
      ...settings.quickqa,
      pinned: Array.isArray(settings.quickqa.pinned) ? settings.quickqa.pinned : app.quickqa.pinned,
    };
    // A disabled setting removes the pending preview so the next question
    // cannot carry an image the Host would reject.
    if (app.quickqa.allowImages !== true) clearQuickQaImage();
    quickQaSyncSettings();
  }
  setWakeLockEnabled(settings.tls?.advanced?.wakeLock === true);
  if (settings.balance) {
    app.balanceDisplay = {
      showPeakValley: settings.balance.showPeakValley !== false,
      spendWindow: settings.balance.spendWindow === 'rolling' ? 'rolling' : 'calendar',
    };
  }
  // Every settings push carries the full page configuration, so only a real
  // change may bump the revision: bumping unconditionally re-runs the pager's
  // scroll reconciliation while the user may be swiping.
  let pageChanged = false;
  if (settings.pageOrder) {
    const nextOrder = normalizeOrder(settings.pageOrder);
    if (nextOrder.join('|') !== app.pageOrder.join('|')) {
      app.pageOrder = nextOrder;
      pageChanged = true;
    }
  }
  if (settings.pageEnabled) {
    const nextEnabled = { ...app.pageEnabled, ...settings.pageEnabled };
    if (DEFAULT_ORDER.some((key) => (nextEnabled[key] ? true : false) !== app.pageEnabled[key])) {
      app.pageEnabled = nextEnabled;
      pageChanged = true;
    }
  }
  if (pageChanged) app.pageRevision += 1;
}

function withQuickQaSession(sessions: SessionItem[]): SessionItem[] {
  const overlay = quickQaPendingSession();
  if (!overlay) return sessions;
  if (sessions.some((session) => session.id === overlay.id && session.pending)) return sessions;
  if (sessions.some((session) => session.id === overlay.id)) {
    return sessions.map((session) => session.id === overlay.id
      ? { ...session, pending: overlay.pending }
      : session);
  }
  return [...sessions, overlay];
}

function applyOverview(data: OverviewData | undefined): void {
  if (!data) return;
  app.overview = data;
  applySettings(data.settings);
  app.weather = data.weather ?? null;
  app.notifications = data.notifications ?? null;
  app.account = data.account ?? null;
  app.sessions = withQuickQaSession(Array.isArray(data.sessions) ? data.sessions : []);
  app.sessionsError = data.sessionsError || null;
  if (data.performance) app.performance = data.performance;
}

function applyMedia(payload: MediaPayload | undefined): void {
  app.media = payload ?? null;
}

function handleMessage(message: ServerMessage): void {
  switch (message?.type) {
    case 'welcome':
      setOnline(true);
      applySettings(message.settings);
      break;
    case 'overview':
      setOnline(true);
      applyOverview(message.data);
      break;
    case 'weather':
      app.weather = message.data ?? null;
      break;
    case 'notifications':
      app.notifications = message.data ?? null;
      break;
    case 'sessions':
      app.sessions = withQuickQaSession(Array.isArray(message.data) ? message.data : []);
      app.sessionsError = null;
      break;
    case 'account':
      app.account = message.data ?? null;
      break;
    case 'media':
      setOnline(true);
      applyMedia(message.data);
      break;
    case 'performance':
      app.performance = message.data ?? null;
      break;
    case 'settings':
      applySettings(message.data);
      break;
    case 'action-result':
      if (!message.ok) toast(message.error || t('actionFailed'));
      break;
    case 'answer-result': {
      const key = answerKey(message.sessionId || '', message.requestId || '');
      const waiter = answerWaiters.get(key);
      if (!waiter) break;
      answerWaiters.delete(key);
      clearTimeout(waiter.timer);
      if (message.ok) waiter.resolve();
      else waiter.reject(new Error(message.error || t('answerFailed')));
      break;
    }
    case 'quickqa-state':
    case 'quickqa-delta':
    case 'quickqa-pending':
      handleQuickQaMessage(message);
      break;
    case 'error':
      toast(message.error || t('serviceError'));
      break;
    default:
      break;
  }
}

export function startLive(): void {
  configureLive({
    onOpen() {
      setOnline(true);
      sendLive({ type: 'settings' });
    },
    onMessage: handleMessage,
    onClose() {
      setOnline(false);
      failAnswerWaiters();
    },
  });
  connectLive();
}

export function stopLive(): void {
  disposeLive();
  failAnswerWaiters();
}

/** One shared second tick for the clock; media progress is owned by SeekBar. */
export function startTicks(): () => void {
  app.clockNow = Date.now();
  const clockTimer = setInterval(() => {
    app.clockNow = Date.now();
  }, 1000);
  return () => {
    clearInterval(clockTimer);
  };
}

export function restoreUrl(): void {
  if (location.search.includes('token=') || location.search.includes('page=')) {
    try {
      history.replaceState({}, '', location.pathname);
    } catch {
      /* ignore */
    }
  }
}

export function exposeState(): void {
  window.__DSH_REMOTE__ = app;
  // The local preview harness uses this handle to seed Quick Q&A states (an
  // attached image, a chat bubble preview) that no WebSocket frame can carry.
  window.__DSH_QUICKQA__ = quickQa;
}
