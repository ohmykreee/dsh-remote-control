import { DEFAULT_ORDER, enabledOrder, normalizeOrder } from './pages';
import { configureLive, connectLive, disposeLive, sendLive } from './ws';
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
  navPosition: 'left',
  pomodoro: { enabled: false, focusMinutes: 25, breakMinutes: 5, soundPath: '', loopAlarm: false },
  balanceDisplay: { showPeakValley: true },
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
  mediaReceivedAt: 0,
  mediaNow: 0,
  clockNow: Date.now(),

  seekDragging: false,
  seekInput: 0,
  seekTarget: 0,
  seekHoldUntil: 0,
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
    toast('正在连接，请稍候');
    return false;
  }
  return true;
}

export function applyTheme(theme: string): void {
  app.theme = theme === 'light' ? 'light' : 'dark';
}

export function applySettings(settings: ConsoleSettings | undefined): void {
  if (!settings) return;
  if (settings.theme) applyTheme(settings.theme);
  if (settings.temperatureUnit) {
    app.temperatureUnit = settings.temperatureUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  }
  if (settings.navPosition) app.navPosition = normalizeNavPosition(settings.navPosition);
  if (settings.pomodoro) app.pomodoro = normalizePomodoro(settings.pomodoro, app.pomodoro);
  if (settings.balance) app.balanceDisplay = { showPeakValley: settings.balance.showPeakValley !== false };
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
  app.mediaReceivedAt = Date.now();
  app.mediaNow = app.mediaReceivedAt;
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
      if (!message.ok) toast(message.error || '操作失败');
      break;
    case 'error':
      toast(message.error || '服务异常');
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

/** One shared second tick and one shared media-projection tick. */
export function startTicks(): () => void {
  app.clockNow = Date.now();
  app.mediaNow = Date.now();
  const clockTimer = setInterval(() => {
    app.clockNow = Date.now();
  }, 1000);
  const mediaTimer = setInterval(() => {
    app.mediaNow = Date.now();
  }, 900);
  return () => {
    clearInterval(clockTimer);
    clearInterval(mediaTimer);
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
