import { setLocale, t } from './i18n.svelte';
import { DEFAULT_ORDER, enabledOrder, normalizeOrder } from './pages';
import { configureLive, connectLive, disposeLive, isLiveOpen, sendLive } from './ws';
import type {
  AccountData,
  ConsoleSettings,
  ConsoleState,
  MediaPayload,
  NavPosition,
  NotificationsData,
  OverviewData,
  PerformanceData,
  PomodoroSettings,
  QuestionAnswerItem,
  ServerMessage,
  SessionItem,
  WeatherData,
} from './types';

const NAV_POSITIONS: readonly NavPosition[] = ['left', 'right', 'top', 'bottom'];

export function normalizeNavPosition(value: unknown): NavPosition {
  return NAV_POSITIONS.includes(value as NavPosition) ? (value as NavPosition) : 'left';
}

export function normalizePomodoro(input: Partial<PomodoroSettings> | undefined, base: PomodoroSettings): PomodoroSettings {
  const minutes = (value: unknown, fallback: number, max: number): number => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.max(1, Math.min(max, number)) : fallback;
  };
  return {
    enabled: input?.enabled === true,
    focusMinutes: minutes(input?.focusMinutes, base.focusMinutes, 180),
    breakMinutes: minutes(input?.breakMinutes, base.breakMinutes, 120),
    soundPath: typeof input?.soundPath === 'string' ? input.soundPath : base.soundPath,
    loopAlarm: input?.loopAlarm === true,
  };
}

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
  balanceDisplay: { showPeakValley: true, spendWindow: 'calendar' },
  pageOrder: [...DEFAULT_ORDER],
  pageEnabled: { home: true, sessions: true, music: true, performance: true },
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
  volumeHoldUntil: 0,

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
  if (settings.balance) {
    app.balanceDisplay = {
      showPeakValley: settings.balance.showPeakValley !== false,
      spendWindow: settings.balance.spendWindow === 'rolling' ? 'rolling' : 'calendar',
    };
  }
  let pageChanged = false;
  if (settings.pageOrder) {
    app.pageOrder = normalizeOrder(settings.pageOrder);
    pageChanged = true;
  }
  if (settings.pageEnabled) {
    app.pageEnabled = { ...app.pageEnabled, ...settings.pageEnabled };
    pageChanged = true;
  }
  if (pageChanged) app.pageRevision += 1;
}

function applyOverview(data: OverviewData | undefined): void {
  if (!data) return;
  app.overview = data;
  applySettings(data.settings);
  app.weather = data.weather ?? null;
  app.notifications = data.notifications ?? null;
  app.account = data.account ?? null;
  app.sessions = Array.isArray(data.sessions) ? data.sessions : [];
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
      applyOverview(message.data as OverviewData | undefined);
      break;
    case 'weather':
      app.weather = (message.data as WeatherData | undefined) ?? null;
      break;
    case 'notifications':
      app.notifications = (message.data as NotificationsData | undefined) ?? null;
      break;
    case 'sessions':
      app.sessions = Array.isArray(message.data) ? (message.data as SessionItem[]) : [];
      app.sessionsError = null;
      break;
    case 'account':
      app.account = (message.data as AccountData | undefined) ?? null;
      break;
    case 'media':
      setOnline(true);
      applyMedia(message.data as MediaPayload | undefined);
      break;
    case 'performance':
      app.performance = (message.data as PerformanceData | undefined) ?? null;
      break;
    case 'settings':
      applySettings(message.data as ConsoleSettings | undefined);
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
    },
  });
  connectLive();
}

export function stopLive(): void {
  disposeLive();
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
}

export { enabledOrder, normalizeOrder };
