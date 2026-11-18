export type PageKey = 'home' | 'sessions' | 'quickqa' | 'music' | 'performance';
export type TemperatureUnit = 'celsius' | 'fahrenheit';
export type Theme = 'dark' | 'light';
export type NavPosition = 'left' | 'right' | 'top' | 'bottom';

export interface PomodoroSettings {
  enabled: boolean;
  focusMinutes: number;
  breakMinutes: number;
  soundPath: string;
  loopAlarm: boolean;
}

export interface CountdownSettings {
  enabled: boolean;
  /** One to five quick-select durations, in seconds. */
  presets: number[];
}

export interface ConsoleSettings {
  theme?: string;
  /** Console language resolved by the Host (`zh` or `en`). */
  locale?: string;
  temperatureUnit?: string;
  pushQuestions?: boolean;
  navPosition?: string;
  balance?: { spendWindow?: string; lowThreshold?: number | null; showPeakValley?: boolean };
  pomodoro?: Partial<PomodoroSettings>;
  countdown?: Partial<CountdownSettings>;
  tls?: { enabled?: boolean; advanced?: { wakeLock?: boolean } };
  quickqa?: QuickQaSettings;
  pageOrder?: string[];
  pageEnabled?: Partial<Record<PageKey, boolean>>;
}

/** Quick Q&A configuration pushed with the settings snapshot. */
export interface QuickQaSettings {
  voiceReady?: boolean;
  defaultWorkspaceId?: string;
  defaultWorkspaceTitle?: string;
  pinned?: Array<{ id: string; title: string; path: string }>;
  pushQuestions?: boolean;
}

export interface QuickQaPending {
  kind?: string;
  question?: string;
  header?: string;
  detail?: string;
  requestId?: string;
  answerable?: boolean;
  count?: number;
  questions?: SessionQuestion[];
  pushEnabled?: boolean;
}

export interface WeatherCurrent {
  code?: number;
  temperature?: number;
  feelsLike?: number;
  humidity?: number;
  windSpeed?: number;
  isDay?: boolean;
}

export interface WeatherDaily {
  high?: number;
  low?: number;
  sunrise?: string;
  sunset?: string;
  tomorrowHigh?: number;
  tomorrowLow?: number;
}

export interface WeatherHour {
  time?: string;
  code?: number;
  temperature?: number;
}

export interface WeatherDay {
  date?: string;
  code?: number;
  high?: number;
  low?: number;
}

export interface WeatherAirQuality {
  aqi?: number;
  display?: string;
  level?: number | null;
  category?: string | null;
  primaryPollutant?: string | null;
}

export interface WeatherData {
  ok?: boolean;
  provider?: string;
  /** `nameFallback` means the Host could not resolve a real place name. */
  location?: { name?: string; nameFallback?: boolean };
  current?: WeatherCurrent;
  daily?: WeatherDaily;
  hourly?: WeatherHour[];
  dailyForecast?: WeatherDay[];
  airQuality?: WeatherAirQuality | null;
  forecastMode?: string;
}

export interface NotificationItem {
  id?: string;
  appKey?: string;
  appName?: string;
  title?: string;
  body?: string;
  avatar?: string;
  receivedAt?: number;
}

export interface NotificationsData {
  available?: boolean;
  reason?: string | null;
  notifications?: NotificationItem[];
}

export interface SessionQuestionOption {
  label: string;
  description?: string;
}

export interface SessionQuestion {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  options?: SessionQuestionOption[];
  multiSelect?: boolean;
}

export interface SessionPending {
  kind?: string;
  question?: string;
  header?: string;
  detail?: string;
  count?: number;
  since?: number;
  requestId?: string;
  questions?: SessionQuestion[];
  answerable?: boolean;
}

export interface SessionItem {
  id?: string;
  title?: string;
  status?: string;
  error?: string;
  pending?: SessionPending;
  preview?: string;
  cwd?: string;
  turn?: number;
  isSubagent?: boolean;
  /** Parent session id for a subagent dispatched by another agent. */
  parentId?: string;
  /** Open turn start time from DSH, used for the live running duration. */
  runningSince?: number | null;
  lastActiveAt?: number;
  /** Local placeholder used while a quick-Q&A inquiry waits for its first snapshot. */
  syntheticQuickQa?: boolean;
}

export interface BalanceInfo {
  currency?: string;
  balance?: number;
  paid?: number;
  bonus?: number;
  state?: string;
  error?: string;
}

export interface UsageDay {
  label?: string;
  cost?: number;
}

export interface UsageInfo {
  currency?: string;
  state?: string;
  today?: number;
  spend?: number;
  spendLabel?: string;
  daily?: UsageDay[];
  error?: string;
}

export interface AccountData {
  available?: boolean;
  signedIn?: boolean;
  lowBalance?: boolean;
  lowThreshold?: number;
  balance?: BalanceInfo;
  usage?: UsageInfo;
}

export interface PerformanceData {
  cpu?: {
    usage?: number;
    model?: string;
    cores?: number;
    physicalCores?: number;
    speed?: number;
    baseSpeed?: number;
    uptime?: number;
  };
  memory?: {
    total?: number;
    used?: number;
    free?: number;
    percent?: number;
  };
  gpu?: {
    ok?: boolean;
    name?: string;
    utilization?: number;
    memoryUsed?: number;
    memoryTotal?: number;
    memoryPercent?: number;
    coreClockMhz?: number;
    coreClockMaxMhz?: number;
    memoryClockMhz?: number;
    powerPercent?: number;
    fanRpm?: number;
    driver?: string;
    error?: string;
  };
  temperatures?: Array<{ name?: string; celsius?: number }>;
}

export interface MediaInfo {
  appId?: string;
  appName?: string;
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  playbackStatus?: string;
  position?: number;
  startTime?: number;
  endTime?: number;
  canSeek?: boolean;
  positionReported?: boolean;
  canPlayPause?: boolean;
  canNext?: boolean;
  canPrevious?: boolean;
  liked?: boolean;
  canLike?: boolean;
  canSetLiked?: boolean;
  thumbnail?: string | null;
  thumbnailUrl?: string | null;
}

export interface MediaPayload {
  ok?: boolean;
  media?: {
    media?: MediaInfo | null;
    error?: string | null;
  };
  volume?: {
    volume?: number;
    muted?: boolean;
  };
}

export interface OverviewData {
  settings?: ConsoleSettings;
  weather?: WeatherData | null;
  notifications?: NotificationsData | null;
  account?: AccountData | null;
  sessions?: SessionItem[];
  sessionsError?: string | null;
  performance?: PerformanceData | null;
}

export interface QuestionAnswerItem {
  id: string;
  selected: string[];
  custom?: string;
}

export interface ConsoleState {
  online: boolean | null;
  theme: Theme;
  temperatureUnit: TemperatureUnit;
  pushQuestions: boolean;
  navPosition: NavPosition;
  pomodoro: PomodoroSettings;
  countdown: CountdownSettings;
  quickqa: QuickQaSettings;
  balanceDisplay: { showPeakValley: boolean; spendWindow: 'calendar' | 'rolling' };
  pageOrder: PageKey[];
  pageEnabled: Record<PageKey, boolean>;
  pageRevision: number;

  overview: OverviewData | null;
  weather: WeatherData | null;
  notifications: NotificationsData | null;
  account: AccountData | null;
  sessions: SessionItem[];
  sessionsError: string | null;
  performance: PerformanceData | null;

  media: MediaPayload | null;
  clockNow: number;

  volumeDragging: boolean;
  volumeInput: number;
  volumeTarget: number;

  toastVisible: boolean;
  toastMessage: string;

  activeKey: PageKey;
  initialKey: PageKey | null;
  hasNavigated: boolean;
  fullscreen: boolean;
  /** Session id whose pending question sheet is open, or null. */
  answerSessionId: string | null;
}

export type ClientMessage =
  | { type: 'settings' }
  | { type: 'refresh' }
  | { type: 'action'; action: string; value?: number | boolean }
  | { type: 'answer-question'; sessionId: string; requestId: string; answers: QuestionAnswerItem[] }
  | { type: 'quickqa-ask'; text: string; workspaceId?: string; sessionId?: string }
  | { type: 'quickqa-reset' };

/** Phase of one quick Q&A turn, as pushed by the Host. */
export type QuickQaPhase = 'idle' | 'capturing' | 'transcribing' | 'thinking' | 'streaming' | 'done' | 'error';

/**
 * Every frame the Host pushes over `/ws`, discriminated by `type` so a protocol
 * change fails to type-check instead of silently producing `undefined` data.
 */
export type ServerMessage =
  | { type: 'welcome'; settings: ConsoleSettings }
  | { type: 'overview'; data: OverviewData }
  | { type: 'sessions'; data: SessionItem[] }
  | { type: 'notifications'; data: NotificationsData | null }
  | { type: 'account'; data: AccountData | null }
  | { type: 'weather'; data: WeatherData | null }
  | { type: 'media'; data: MediaPayload }
  | { type: 'performance'; data: PerformanceData | null }
  | { type: 'clients'; data: unknown[] }
  | { type: 'settings'; data: ConsoleSettings }
  | { type: 'action-result'; ok: boolean; action?: string; error?: string }
  | { type: 'answer-result'; ok: boolean; sessionId?: string; requestId?: string; error?: string }
  | {
      type: 'quickqa-state';
      phase?: QuickQaPhase;
      sessionId?: string;
      workspaceId?: string;
      question?: string;
      empty?: boolean;
      error?: string;
    }
  | { type: 'quickqa-delta'; text?: string }
  | {
      type: 'quickqa-pending';
      clear?: boolean;
      kind?: string;
      question?: string;
      header?: string;
      detail?: string;
      requestId?: string;
      answerable?: boolean;
      count?: number;
      questions?: SessionQuestion[];
      pushEnabled?: boolean;
    }
  | { type: 'error'; error?: string }
  | { type: 'pong' };
