export type PageKey = 'home' | 'sessions' | 'music' | 'performance';
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

export interface ConsoleSettings {
  theme?: string;
  temperatureUnit?: string;
  pushQuestions?: boolean;
  navPosition?: string;
  balance?: { spendWindow?: string; lowThreshold?: number | null; showPeakValley?: boolean };
  pomodoro?: Partial<PomodoroSettings>;
  pageOrder?: string[];
  pageEnabled?: Partial<Record<PageKey, boolean>>;
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

export interface WeatherData {
  ok?: boolean;
  location?: { name?: string };
  current?: WeatherCurrent;
  daily?: WeatherDaily;
  hourly?: WeatherHour[];
  dailyForecast?: WeatherDay[];
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
  balanceDisplay: { showPeakValley: boolean };
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
  mediaReceivedAt: number;
  mediaNow: number;
  clockNow: number;

  seekDragging: boolean;
  seekInput: number;
  seekTarget: number;
  seekHoldUntil: number;
  volumeDragging: boolean;
  volumeInput: number;
  volumeTarget: number;
  volumeHoldUntil: number;

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
  | { type: 'answer-question'; sessionId: string; requestId: string; answers: QuestionAnswerItem[] };

export interface ServerMessage {
  type?: string;
  data?: unknown;
  settings?: ConsoleSettings;
  ok?: boolean;
  error?: string;
  sessionId?: string;
  requestId?: string;
}
