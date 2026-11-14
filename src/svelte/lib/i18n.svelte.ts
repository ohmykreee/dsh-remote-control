/**
 * Console translations.
 *
 * Each shipped language is one flat key -> text object so adding a language
 * later only means appending another object to {@link DICTS}. The `en` object
 * is typed against the keys of `zh`, so a missing English translation is a
 * compile error rather than a Chinese string leaking into the English UI.
 */

import type { PageKey } from './types';

export type LocaleCode = 'zh' | 'en';

export const SUPPORTED_LOCALES: readonly LocaleCode[] = ['zh', 'en'];

export const zh = {
  // Shell
  offline: '正在重新连接…',
  refreshing: '正在刷新',
  fullscreenUnsupported: '当前浏览器不支持全屏',
  fullscreenDenied: '当前浏览器不允许全屏',
  navLabel: '页面导航',
  pagesLabel: '页面',
  refreshPage: '刷新页面状态',
  fullscreenEnter: '进入全屏',
  fullscreenExit: '退出全屏',
  errorSessions: '有错误会话',
  pendingQuestions: '有待回答问题',

  // Pages
  pageHome: '首页',
  pageSessions: '会话',
  pageMusic: '音乐',
  pagePerformance: '性能',

  // Toasts and question actions
  connecting: '正在连接，请稍候',
  actionFailed: '操作失败',
  serviceError: '服务异常',
  pushQuestionsOff: '「推送问询」已关闭，请在 DSH 的通知设置中开启',
  approvalPending: '该会话正在等待批准，请在 DSH 中处理',
  answerInDsh: '这个问题需要在 DSH 中回答',
  connectionLost: '连接已断开，请稍后重试',
  answerReplaced: '答复已被新的回答替换',
  answerTimeout: '回答超时，请重试',
  answerFailed: '回答失败',

  // Time and clock
  greetingMorning: '早上好',
  greetingNoon: '中午好',
  greetingAfternoon: '下午好',
  greetingEvening: '晚上好',
  periodMorning: '早上',
  periodNoon: '中午',
  periodAfternoon: '下午',
  periodEvening: '晚上',
  justNow: '刚刚',
  minutesAgo: '{count} 分钟前',
  hoursAgo: '{count} 小时前',
  daysAgo: '{count} 天前',
  uptimeDays: '{days}天 {hours}小时',
  uptimeHours: '{hours}小时 {minutes}分',
  uptimeMinutes: '{minutes}分钟',

  // Solar terms
  termMinorCold: '小寒',
  termMajorCold: '大寒',
  termStartOfSpring: '立春',
  termRainWater: '雨水',
  termAwakening: '惊蛰',
  termSpringEquinox: '春分',
  termClearAndBright: '清明',
  termGrainRain: '谷雨',
  termStartOfSummer: '立夏',
  termGrainFull: '小满',
  termGrainInEar: '芒种',
  termSummerSolstice: '夏至',
  termMinorHeat: '小暑',
  termMajorHeat: '大暑',
  termStartOfAutumn: '立秋',
  termEndOfHeat: '处暑',
  termWhiteDew: '白露',
  termAutumnEquinox: '秋分',
  termColdDew: '寒露',
  termFrostDescent: '霜降',
  termStartOfWinter: '立冬',
  termMinorSnow: '小雪',
  termMajorSnow: '大雪',
  termWinterSolstice: '冬至',

  // Weather
  weather: '天气',
  weatherUnavailable: '天气暂不可用',
  tryLater: '稍后再试',
  currentLocation: '当前位置',
  customLocation: '自定义位置',
  highLow: '最高 / 最低',
  feelsLike: '体感',
  humidity: '湿度',
  windSpeed: '风速',
  today: '今天',
  now: '现在',
  hourLabel: '{hour}时',
  sunrise: '日出',
  sunset: '日落',
  tomorrow: '明日',
  weatherFallback: '天气',
  weatherNight: '夜间',

  // Weather codes (WMO)
  wmoClear: '晴',
  wmoMostlyClear: '大致晴朗',
  wmoPartlyCloudy: '局部多云',
  wmoOvercast: '阴天',
  wmoFog: '有雾',
  wmoRimeFog: '雾凇',
  wmoDrizzle: '毛毛雨',
  wmoDenseDrizzle: '较强毛毛雨',
  wmoFreezingDrizzle: '冻毛毛雨',
  wmoHeavyFreezingDrizzle: '强冻毛毛雨',
  wmoLightRain: '小雨',
  wmoRain: '中雨',
  wmoHeavyRain: '大雨',
  wmoFreezingRain: '冻雨',
  wmoHeavyFreezingRain: '强冻雨',
  wmoLightSnow: '小雪',
  wmoSnow: '中雪',
  wmoHeavySnow: '大雪',
  wmoSnowGrains: '雪粒',
  wmoRainShowers: '阵雨',
  wmoHeavyRainShowers: '较强阵雨',
  wmoViolentRainShowers: '强阵雨',
  wmoSnowShowers: '阵雪',
  wmoHeavySnowShowers: '强阵雪',
  wmoThunderstorm: '雷雨',
  wmoThunderstormHail: '雷雨伴冰雹',
  wmoSevereThunderstorm: '强雷雨伴冰雹',

  // Notifications
  notifications: '通知',
  notificationsUnavailable: '通知暂不可用',
  noNotifications: '暂无通知',
  noNotificationsHint: '新的通知会显示在这里',
  notificationFallback: '通知',

  // Sessions
  conversations: '会话',
  sessionLoading: '正在读取',
  sessionCount: '{count} 个会话',
  sessionCountOne: '1 个会话',
  noActiveSessions: '暂无活动会话',
  statusRunning: '运行中',
  statusQuestion: '等待回答',
  statusError: '错误',
  statusDone: '已结束',
  noMessage: '暂无消息',
  turnLabel: '第 {turn} 轮',
  subagent: '子代理',
  needsAttention: '需要处理',
  answer: '回答',
  answerSession: '回答会话 {title}',
  newSession: '新会话',
  sessionLoadFailed: '会话暂时无法加载',
  noSessions: '暂无会话',
  noSessionsHint: '新的会话会显示在这里',

  // Music
  nothingPlaying: '没有播放内容',
  unknownArtist: '未知艺术家',
  chooseSong: '选择一首歌开始播放',
  like: '喜欢',
  unlike: '取消喜欢',
  previousTrack: '上一首',
  nextTrack: '下一首',
  play: '播放',
  pause: '暂停',
  mute: '静音',
  volume: '音量',
  nowPlaying: '正在播放',
  albumCover: '专辑封面',
  mediaFallback: '媒体',
  musicSource: '音乐',
  sourceBilibili: '哔哩哔哩',

  // Seek bar
  playProgress: '播放进度',
  progressUnavailable: '进度信息不可用',
  progressReadOnly: '当前进度仅展示',

  // Performance
  cpuMemory: 'CPU / 内存',
  gpuMemory: '显卡 / 显存',
  currentStatus: '当前状态',
  threadCount: '{count} 线程',
  threadCountOne: '1 线程',
  currentFrequency: '当前频率',
  runningTime: '运行时间',
  memoryUsed: '已用',
  memoryFree: '可用',
  unavailableShort: '暂不可用',
  noDiscreteGpu: '未检测到独立显卡',
  driverLabel: '驱动',
  driverValue: '驱动 {name}',
  driverUnknown: '驱动版本未知',
  driverNone: '驱动 —',
  coreClock: '核心频率',
  memoryClock: '显存频率',
  temperatures: '温度',
  itemCount: '{count} 个',
  noTemperature: '暂无温度读数',
  maxTemperature: '最高温度',
  notProvided: '未提供',
  device: '设备',

  // Balance and spending
  accountBalance: '账户余额',
  syncing: '正在同步',
  signedOut: '未登录账号',
  topUpBonus: '充值 {paid} · 赠送 {bonus}',
  peakHours: '高峰时段',
  offpeakHours: '低谷时段',
  peak: '高峰',
  offpeak: '低谷',
  belowThreshold: '低于提醒线 {amount}',
  usage: '消费',
  last7DaysShort: '近 7 日',
  todaySpend: '今日',
  thisWeek: '本周',
  last7Days: '最近 7 天',

  // Pomodoro
  pomodoro: '番茄钟',
  focusDone: '专注完成',
  breakDone: '休息结束',
  focus: '专注',
  rest: '休息',
  stopAlarm: '停止响铃',
  startBreak: '开始休息',
  startFocus: '开始专注',
  start: '开始',
  switchPhase: '切换专注 / 休息',
  roundCount: '{count} 个',
  resetPomodoro: '重置番茄钟',
  reset: '重置',

  // Countdown
  countdown: '倒计时',
  countdownFinished: '时间到',
  confirmEnd: '确认结束',
  resetCountdown: '重置倒计时',
  countdownPresets: '倒计时预设',

  // Question sheet
  sessionQuestion: '会话提问',
  questionCount: '{count} 个问题',
  questionCountOne: '1 个问题',
  chooseOption: '选择一项，或填写自定义回复',
  close: '关闭',
  recommended: '推荐',
  otherAnswer: '其他回答…',
  typeAnswer: '输入回答…',
  customReply: '自定义回复',
  sendAnswer: '发送回答',
  skipQuestion: '跳过此题',
  skippedNote: '将作为未回答提交',
  sendingEllipsis: '正在发送…',
  canMultiAnswer: '可多选或填写自定义回复',
  cancel: '取消',
  sending: '发送中…',
  answered: '已回复',
  questionEnded: '当前问题已经结束',
  answerEveryQuestion: '请先回答每一道问题，或选择跳过',
} as const;

export type MessageKey = keyof typeof zh;

export const en: Record<MessageKey, string> = {
  // Shell
  offline: 'Reconnecting…',
  refreshing: 'Refreshing',
  fullscreenUnsupported: 'This browser does not support fullscreen',
  fullscreenDenied: 'Fullscreen is blocked in this browser',
  navLabel: 'Page navigation',
  pagesLabel: 'Pages',
  refreshPage: 'Refresh page data',
  fullscreenEnter: 'Enter fullscreen',
  fullscreenExit: 'Exit fullscreen',
  errorSessions: 'Sessions with errors',
  pendingQuestions: 'Questions waiting',

  // Pages
  pageHome: 'Home',
  pageSessions: 'Sessions',
  pageMusic: 'Music',
  pagePerformance: 'Performance',

  // Toasts and question actions
  connecting: 'Connecting, please wait',
  actionFailed: 'Action failed',
  serviceError: 'Service error',
  pushQuestionsOff: 'Pushed inquiries are off; turn them on in DSH notification settings',
  approvalPending: 'This session is waiting for approval; handle it in DSH',
  answerInDsh: 'Answer this question in DSH',
  connectionLost: 'Connection lost; try again shortly',
  answerReplaced: 'This reply was replaced by a newer answer',
  answerTimeout: 'The answer timed out; try again',
  answerFailed: 'Answer failed',

  // Time and clock
  greetingMorning: 'Good morning',
  greetingNoon: 'Good afternoon',
  greetingAfternoon: 'Good afternoon',
  greetingEvening: 'Good evening',
  periodMorning: 'Morning',
  periodNoon: 'Noon',
  periodAfternoon: 'Afternoon',
  periodEvening: 'Evening',
  justNow: 'just now',
  minutesAgo: '{count} min ago',
  hoursAgo: '{count} h ago',
  daysAgo: '{count} d ago',
  uptimeDays: '{days}d {hours}h',
  uptimeHours: '{hours}h {minutes}m',
  uptimeMinutes: '{minutes} min',

  // Solar terms
  termMinorCold: 'Minor Cold',
  termMajorCold: 'Major Cold',
  termStartOfSpring: 'Start of Spring',
  termRainWater: 'Rain Water',
  termAwakening: 'Awakening of Insects',
  termSpringEquinox: 'Spring Equinox',
  termClearAndBright: 'Clear and Bright',
  termGrainRain: 'Grain Rain',
  termStartOfSummer: 'Start of Summer',
  termGrainFull: 'Grain Full',
  termGrainInEar: 'Grain in Ear',
  termSummerSolstice: 'Summer Solstice',
  termMinorHeat: 'Minor Heat',
  termMajorHeat: 'Major Heat',
  termStartOfAutumn: 'Start of Autumn',
  termEndOfHeat: 'End of Heat',
  termWhiteDew: 'White Dew',
  termAutumnEquinox: 'Autumn Equinox',
  termColdDew: 'Cold Dew',
  termFrostDescent: 'Frost Descent',
  termStartOfWinter: 'Start of Winter',
  termMinorSnow: 'Minor Snow',
  termMajorSnow: 'Major Snow',
  termWinterSolstice: 'Winter Solstice',

  // Weather
  weather: 'Weather',
  weatherUnavailable: 'Weather unavailable',
  tryLater: 'Try again later',
  currentLocation: 'Current location',
  customLocation: 'Custom location',
  highLow: 'High / Low',
  feelsLike: 'Feels like',
  humidity: 'Humidity',
  windSpeed: 'Wind',
  today: 'Today',
  now: 'Now',
  hourLabel: '{hour}:00',
  sunrise: 'Sunrise',
  sunset: 'Sunset',
  tomorrow: 'Tomorrow',
  weatherFallback: 'Weather',
  weatherNight: 'Night',

  // Weather codes (WMO)
  wmoClear: 'Clear',
  wmoMostlyClear: 'Mostly clear',
  wmoPartlyCloudy: 'Partly cloudy',
  wmoOvercast: 'Overcast',
  wmoFog: 'Fog',
  wmoRimeFog: 'Rime fog',
  wmoDrizzle: 'Drizzle',
  wmoDenseDrizzle: 'Dense drizzle',
  wmoFreezingDrizzle: 'Freezing drizzle',
  wmoHeavyFreezingDrizzle: 'Heavy freezing drizzle',
  wmoLightRain: 'Light rain',
  wmoRain: 'Rain',
  wmoHeavyRain: 'Heavy rain',
  wmoFreezingRain: 'Freezing rain',
  wmoHeavyFreezingRain: 'Heavy freezing rain',
  wmoLightSnow: 'Light snow',
  wmoSnow: 'Snow',
  wmoHeavySnow: 'Heavy snow',
  wmoSnowGrains: 'Snow grains',
  wmoRainShowers: 'Rain showers',
  wmoHeavyRainShowers: 'Heavy rain showers',
  wmoViolentRainShowers: 'Violent rain showers',
  wmoSnowShowers: 'Snow showers',
  wmoHeavySnowShowers: 'Heavy snow showers',
  wmoThunderstorm: 'Thunderstorm',
  wmoThunderstormHail: 'Thunderstorm with hail',
  wmoSevereThunderstorm: 'Severe thunderstorm with hail',

  // Notifications
  notifications: 'Notifications',
  notificationsUnavailable: 'Notifications unavailable',
  noNotifications: 'No notifications',
  noNotificationsHint: 'New notifications appear here',
  notificationFallback: 'Notification',

  // Sessions
  conversations: 'Sessions',
  sessionLoading: 'Loading',
  sessionCount: '{count} sessions',
  sessionCountOne: '1 session',
  noActiveSessions: 'No active sessions',
  statusRunning: 'Running',
  statusQuestion: 'Waiting',
  statusError: 'Error',
  statusDone: 'Done',
  noMessage: 'No messages yet',
  turnLabel: 'Turn {turn}',
  subagent: 'Subagent',
  needsAttention: 'Needs attention',
  answer: 'Answer',
  answerSession: 'Answer session {title}',
  newSession: 'New session',
  sessionLoadFailed: 'Sessions cannot load right now',
  noSessions: 'No sessions',
  noSessionsHint: 'New sessions appear here',

  // Music
  nothingPlaying: 'Nothing playing',
  unknownArtist: 'Unknown artist',
  chooseSong: 'Pick a song to start playing',
  like: 'Like',
  unlike: 'Unlike',
  previousTrack: 'Previous track',
  nextTrack: 'Next track',
  play: 'Play',
  pause: 'Pause',
  mute: 'Mute',
  volume: 'Volume',
  nowPlaying: 'Now playing',
  albumCover: 'Album cover',
  mediaFallback: 'Media',
  musicSource: 'Music',
  sourceBilibili: 'Bilibili',

  // Seek bar
  playProgress: 'Playback position',
  progressUnavailable: 'Progress unavailable',
  progressReadOnly: 'Position is display-only',

  // Performance
  cpuMemory: 'CPU / Memory',
  gpuMemory: 'GPU / VRAM',
  currentStatus: 'Current status',
  threadCount: '{count} threads',
  threadCountOne: '1 thread',
  currentFrequency: 'Frequency',
  runningTime: 'Uptime',
  memoryUsed: 'Used',
  memoryFree: 'Free',
  unavailableShort: 'Unavailable',
  noDiscreteGpu: 'No discrete GPU detected',
  driverLabel: 'Driver',
  driverValue: 'Driver {name}',
  driverUnknown: 'Driver version unknown',
  driverNone: 'Driver —',
  coreClock: 'Core clock',
  memoryClock: 'Memory clock',
  temperatures: 'Temperatures',
  itemCount: '{count}',
  noTemperature: 'No temperature readings',
  maxTemperature: 'Max temperature',
  notProvided: 'Not provided',
  device: 'Device',

  // Balance and spending
  accountBalance: 'Balance',
  syncing: 'Syncing',
  signedOut: 'Not signed in',
  topUpBonus: 'Top-up {paid} · Bonus {bonus}',
  peakHours: 'Peak hours',
  offpeakHours: 'Off-peak hours',
  peak: 'Peak',
  offpeak: 'Off-peak',
  belowThreshold: 'Below alert line {amount}',
  usage: 'Usage',
  last7DaysShort: 'Last 7 days',
  todaySpend: 'Today',
  thisWeek: 'This week',
  last7Days: 'Last 7 days',

  // Pomodoro
  pomodoro: 'Pomodoro',
  focusDone: 'Focus complete',
  breakDone: 'Break over',
  focus: 'Focus',
  rest: 'Break',
  stopAlarm: 'Stop ringing',
  startBreak: 'Start break',
  startFocus: 'Start focus',
  start: 'Start',
  switchPhase: 'Switch focus / break',
  roundCount: '{count}',
  resetPomodoro: 'Reset pomodoro',
  reset: 'Reset',

  // Countdown
  countdown: 'Countdown',
  countdownFinished: 'Time is up',
  confirmEnd: 'Confirm end',
  resetCountdown: 'Reset countdown',
  countdownPresets: 'Countdown presets',

  // Question sheet
  sessionQuestion: 'Session question',
  questionCount: '{count} questions',
  questionCountOne: '1 question',
  chooseOption: 'Choose an option or type a reply',
  close: 'Close',
  recommended: 'Recommended',
  otherAnswer: 'Other answer…',
  typeAnswer: 'Type an answer…',
  customReply: 'Custom reply',
  sendAnswer: 'Send answer',
  skipQuestion: 'Skip this question',
  skippedNote: 'Submitted as unanswered',
  sendingEllipsis: 'Sending…',
  canMultiAnswer: 'Select options or type a reply',
  cancel: 'Cancel',
  sending: 'Sending…',
  answered: 'Answered',
  questionEnded: 'This question has already ended',
  answerEveryQuestion: 'Answer every question first, or skip it',
};

/** Every shipped dictionary, keyed by locale code. */
export const DICTS: Record<LocaleCode, Record<MessageKey, string>> = { zh, en };

/** Reactive console language; starts at the English fallback. */
export const i18n = $state<{ locale: LocaleCode }>({ locale: 'en' });

// The served HTML declares Chinese; point `<html lang>` at the actual
// fallback before the first settings snapshot can change it.
if (typeof document !== 'undefined') {
  document.documentElement.lang = 'en-US';
}

/** Host locale tag used for Intl formatting. */
export function localeTag(): string {
  return i18n.locale === 'zh' ? 'zh-CN' : 'en-US';
}

/** True when the console is rendering Chinese. */
export function isChinese(): boolean {
  return i18n.locale === 'zh';
}

/** Apply a language pushed by the Host settings snapshot. */
export function setLocale(value: unknown): void {
  const next: LocaleCode = value === 'zh' ? 'zh' : 'en';
  if (next === i18n.locale) return;
  i18n.locale = next;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = localeTag();
  }
}

/** Translate one key through the active dictionary, then English. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = DICTS[i18n.locale][key] ?? en[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Page label shared by the rail, the pager and the accessibility tree. */
export function pageLabel(key: PageKey): string {
  if (key === 'home') return t('pageHome');
  if (key === 'sessions') return t('pageSessions');
  if (key === 'music') return t('pageMusic');
  return t('pagePerformance');
}
