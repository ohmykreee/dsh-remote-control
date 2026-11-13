/**
 * Dictionaries and locale plumbing for the remote-control page.
 *
 * The panel is rendered inside DSH, so it follows the host locale when the
 * locale service exposes a subscription; the bundled dictionaries remain the
 * fallback when the panel is rendered in isolation (tests, previews).
 */

import { useEffect, useState } from 'react';
import type { LocaleService, Translator } from './types.js';

export const NS = 'dsh-remote-control';

export const zh: Record<string, string> = {
  title: '远程控制台', kicker: 'REMOTE CONSOLE', heading: '远程控制台',
  subtitle: '手机控制台的连接、显示与数据偏好。', running: '运行中', stopped: '未运行',
  refresh: '刷新', save: '保存', saved: '已保存', error: '操作失败', loading: '正在读取设置…',
  pairing: '扫码连接', pairingHint: '手机与电脑连接同一个局域网，扫描二维码即可打开。',
  open: '在电脑上打开', copy: '复制链接', copied: '已复制', connection: '连接',
  menuPlugin: '偏好设置', menuNetwork: '开放网卡', menuAccess: '访问验证', menuTheme: '主题与页面', menuTls: 'HTTPS 证书',
  menuWeather: '天气设置', menuBalance: '余额显示', menuNotifications: '通知设置', menuSystem: '系统信息',
  menuStatus: '服务状态', menuClients: '已连接设备', menuDiagnostics: '诊断信息',
  network: '开放网卡', networkHint: '只有勾选网卡所在网段的设备可以访问控制台。',
  pluginHint: '手机端的访问方式、温度单位、主题、页面顺序与 HTTPS 证书；修改后点击保存设置生效。',
  access: '访问验证', accessHint: '开启后，手机首次打开需要扫描带验证令牌的链接。',
  token: '链接验证', rotate: '刷新令牌', rotateHint: '刷新后已连接设备会断开，需要重新扫码。',
  theme: '主题与页面', themeHint: '选择手机控制台跟随 DSH 主题，或固定亮暗模式。',
  temperatureUnit: '温度单位', temperatureUnitHint: '手机端天气和性能页使用的温度显示单位。', celsius: '摄氏度 (°C)', fahrenheit: '华氏度 (°F)',
  followDsh: '跟随 DSH', light: '浅色', dark: '深色',
  pageOrder: '页面顺序', pageOrderHint: '拖拽调整手机端四个页面的左右顺序；关闭的页面不会在后台轮询。',
  tls: 'HTTPS 证书', tlsHint: '可选。填写 PEM 证书和私钥路径后启用 HTTPS；保存后连接会短暂中断。',
  certPath: '证书路径', keyPath: '私钥路径', saveTls: '保存证书配置',
  tlsOn: 'HTTPS 已启用', tlsOff: 'HTTPS 未启用', tlsError: '证书配置有误，当前仍使用 HTTP',
  weather: '天气设置', weatherHint: '自动定位优先使用本机位置；手动位置可搜索城市，选中后自动填入经纬度。',
  forecastDisplay: '天气卡片显示', hourly: '小时天气', daily: '7 天天气',
  saveSettings: '保存设置', pagePerformance: '性能',
  auto: '本机位置', manual: '手动位置', locationName: '位置名称', latitude: '纬度', longitude: '经度', saveLocation: '保存位置',
  citySearchPlaceholder: '输入城市名搜索',
  citySearchHint: '输入城市名后从下拉结果中选择，纬度和经度会自动填入；也可以直接编辑坐标。',
  locationAutoHint: '本机位置模式下坐标由系统定位提供，切换到「手动位置」后可搜索或填写城市与坐标。',
  citySearching: '正在搜索…',
  cityNoResults: '没有找到匹配的城市',
  citySearchFailed: '城市搜索失败，请稍后重试',
  citySearchUnavailable: '城市搜索接口未加载，请重启 DSH 后重试',
  balance: '余额显示', balanceHint: '选择本周（日历）或最近 7 天（滚动）作为消耗统计窗口。',
  calendar: '本周（日历）', rolling: '最近 7 天（滚动）', lowThreshold: '低余额提醒线',
  lowThresholdHint: '低于这个金额时，手机端余额会显示为红色。留空关闭提醒。', saveThreshold: '保存提醒线',
  notifications: '通知设置', notificationsHint: '所有应用默认接收通知；取消勾选的应用不会显示在手机端。',
  allApps: '全部显示', limit: '显示数量', noApps: '还没有记录到通知应用。',
  status: '服务状态', statusHint: '当前系统服务能力。', clients: '已连接设备', clientsHint: '正在访问控制台的手机或浏览器。', noClients: '当前没有已连接设备。', disconnect: '断开',
  diagnostics: '诊断信息', pluginVersion: '插件版本', protocol: '连接方式', profileName: 'Profile',
  notificationsStatus: '通知', mediaStatus: '媒体', volumeStatus: '音量', weatherStatus: '天气',
  healthy: '正常', unavailable: '不可用', checking: '待检测',
  pageHome: '首页', pageSessions: '会话', pageMusic: '音乐', moveUp: '上移', moveDown: '下移',
  noWebServer: '当前部署没有可用的 webServer。', serviceRunning: '服务运行中', serviceStopped: '服务未运行',
  menuPomodoro: '番茄钟设置',
  connectionHint: '扫码配对、可访问的网卡、访问验证与 HTTPS 证书。',
  preferencesHint: '手机端的温度单位、主题、页面顺序与导航栏位置；修改后点击保存设置生效。',
  navPosition: '导航栏位置',
  navPositionHint: '选择手机控制台导航栏停靠在屏幕的哪一侧。',
  navLeft: '左侧', navRight: '右侧', navTop: '上方', navBottom: '下方',
  pomodoro: '番茄钟设置',
  pomodoroHint: '手机端番茄钟的启用、时长、提示音与循环响铃。',
  pomodoroEnable: '启用番茄钟',
  pomodoroEnableHint: '启用后，时钟下方会出现番茄钟卡片，并可设置专注与休息时长。',
  pomodoroFocus: '专注时长（分钟）',
  pomodoroBreak: '休息时长（分钟）',
  pomodoroSound: '提示音文件',
  pomodoroSoundSection: '提示音',
  pomodoroSoundHint: '留空则使用内置的轻柔提示音；也可以填写本机音频文件路径或 http(s) 链接。',
  pomodoroSoundPlaceholder: '例如：D:\\sounds\\chime.mp3',
  pomodoroLoop: '循环响铃直到停止',
  pomodoroLoopHint: '开启后，时间到的提示音会循环播放，直到在手机端点击「停止响铃」才停止；关闭时只播放一次。',
  peakValley: '显示梁文峰 / 梁文谷',
  peakValleyHint: '在余额卡片右上角显示当前计费时段的胶囊：工作日 9:00–12:00、14:00–18:00 为梁文峰（显示「高峰」和山峰图标）；其余时间、周末及节假日全天为梁文谷（显示「低谷」和月亮图标，价格为高峰的一半）。判断在手机浏览器中完成，节假日数据从 timor.tech 获取。',
  menuAppMapping: '软件映射',
  appMapping: '软件映射',
  appMappingHint: '通知与音乐播放里显示的应用名称。这里是所有在系统里出现过的应用，修改后立即保存，并同时用于手机端通知和音乐来源。',
  sourceNotification: '通知',
  sourceMusic: '音乐',
  resetName: '恢复默认',
  locationPermission: '定位权限',
  locationPermissionHint: 'Windows 定位需要系统隐私授权。点击下面的按钮申请定位权限；如果被拒绝，会自动打开系统「位置」设置页。开启「位置服务」和「允许桌面应用访问你的位置」后重试即可。',
  locationRequest: '请求定位权限',
  locationRequesting: '正在请求…',
  locationAllowed: '定位权限已授予，天气会自动使用本机位置。',
  locationPrivacyDenied: '系统拒绝了定位权限，已打开「位置」设置页；请开启「位置服务」和「允许桌面应用访问你的位置」后重试。',
  locationLowIntegrity: '探针正以低完整性级别运行，Windows 会拒绝定位。请用普通终端重新执行 pnpm build:rust（或参考 INSTALLATION.md 的修复指南）。',
  locationUnspecified: '系统还没有授予定位权限，已打开设置页，请手动开启后重试。',
  locationFailed: '定位权限请求失败，请稍后重试。',
  locationStatus: '当前状态',
  accessAllowed: '已授权', accessDenied: '已拒绝', accessUnspecified: '未授权', accessUnknown: '未知',
  pushQuestions: '推送问询',
  pushQuestionsHint: '开启后，会话进入等待回答时会推送完整的问题和选项。手机控制台的会话页点击该会话，会弹出悬浮框，可直接点选选项或填写自定义回复。',
  tlsEnable: '启用 HTTPS',
  weatherPageHint: '手机端天气的位置来源、显示方式与定位权限。',
  weatherSource: '天气位置',
  forecastDisplayHint: '选择天气卡片展示小时预报还是 7 天预报。',
  balancePageHint: '手机端余额卡片的统计窗口、低余额提醒与峰谷标记。',
  balanceSpend: '消耗统计',
  peakValleyBlock: '梁文峰/谷标记',
  peakValleyToggle: '显示峰谷标记',
  notificationsPageHint: '手机端通知卡片的推送、可见应用与显示数量。',
  notificationApps: '通知应用',
  pushQuestionsToggle: '允许远程回答',
  limitDisplay: '显示数量',
  limitField: '数量',
  notificationLimitHint: '手机端通知卡片最多显示的通知数量（1–20）。',
  appsPageHint: '手机端通知和音乐里显示的应用名称；修改后立即保存。',
  appNamesBlock: '应用名称',
  systemPageHint: '服务运行状态、系统能力、已连接设备与诊断信息。',
  diagnosticsHint: '插件/探针版本、协议、Profile 与运行时信息。',
  performanceStatus: '性能',
  locationCapability: '定位',
  runtime: '系统能力',
  runtimeHint: '原生探针与 Node.js 运行时的版本、平台和平台后端。',
  probeVersion: '探针版本',
  probeBackends: '平台后端',
  probeBinary: '探针路径',
  probeMissing: '探针不可用',
  nodeVersion: 'Node.js 版本',
  nodeV8: 'V8 版本',
  nodeMemory: '内存占用',
  nodePlatform: '平台',
  backendMedia: '媒体',
  backendVolume: '音量',
  backendPerformance: '性能',
  backendNotifications: '通知',
  backendLocation: '定位',
  device: '设备',
  durationSeconds: '秒',
  durationMinutes: '分钟',
  durationHours: '小时',
  durationDays: '天',
  keepOneApp: '至少保留一个通知应用',
  keepOnePage: '至少保留一个页面',
  tlsPathsRequired: '请先填写证书和私钥路径',
};

const enOverrides: Record<string, string> = {
  title: 'Remote control', heading: 'Remote control', subtitle: 'Connection, display, and data preferences for the phone console.', running: 'Running', stopped: 'Stopped', refresh: 'Refresh', save: 'Save', saved: 'Saved', error: 'Action failed', loading: 'Reading settings…', pairing: 'Scan to connect', pairingHint: 'Connect the phone to the same LAN and scan the QR code.', open: 'Open on this computer', copy: 'Copy link', copied: 'Copied', connection: 'Connection', menuPlugin: 'Preferences', menuNetwork: 'Open interfaces', menuAccess: 'Access verification', menuTheme: 'Theme & pages', menuTls: 'HTTPS certificate', menuWeather: 'Weather', menuBalance: 'Balance display', menuNotifications: 'Notifications', menuSystem: 'System information', menuStatus: 'Service status', menuClients: 'Connected devices', menuDiagnostics: 'Diagnostics', network: 'Open network interfaces', networkHint: 'Only devices on the checked interface subnets can access the console.', pluginHint: 'Access, temperature unit, theme, page order, and HTTPS for the phone console; changes apply after Save.', access: 'Access verification', accessHint: 'When enabled, the first open requires a link with a verification token.', token: 'Link verification', rotate: 'Refresh token', rotateHint: 'Rotating disconnects existing devices; scan again to reconnect.', theme: 'Theme & pages', themeHint: 'Follow DSH, or force light or dark mode on the phone console.', temperatureUnit: 'Temperature unit', temperatureUnitHint: 'Temperature unit used by the phone weather and performance pages.', celsius: 'Celsius (°C)', fahrenheit: 'Fahrenheit (°F)', followDsh: 'Follow DSH', light: 'Light', dark: 'Dark', pageOrder: 'Page order', pageOrderHint: 'Drag to reorder the four phone pages; disabled pages stop polling.', tls: 'HTTPS certificate', tlsHint: 'Optional. Provide PEM certificate and key paths, then enable HTTPS. Saving briefly drops connections.', certPath: 'Certificate path', keyPath: 'Private key path', tlsOn: 'HTTPS is enabled', tlsOff: 'HTTPS is not enabled', tlsError: 'Certificate configuration is invalid; still using HTTP', weather: 'Weather', weatherHint: 'Automatic location uses this computer first; Manual location lets you search for a city and fills the coordinates when you pick one.', forecastDisplay: 'Weather card', hourly: 'Hourly', daily: '7-day', saveSettings: 'Save settings', pagePerformance: 'Performance', auto: 'This computer', manual: 'Manual location', locationName: 'Location name', citySearchPlaceholder: 'Search for a city', citySearchHint: 'Type a city and pick a suggestion to fill latitude and longitude automatically; you can also edit the coordinates directly.', locationAutoHint: 'This-computer mode uses the system location; switch to Manual location to search or enter a city and coordinates.', citySearching: 'Searching…', cityNoResults: 'No matching city found', citySearchFailed: 'City search failed; try again later', citySearchUnavailable: 'City search is not loaded; restart DSH and retry', latitude: 'Latitude', longitude: 'Longitude', balance: 'Balance display', balanceHint: 'Choose this calendar week or the rolling last 7 days as the spend window.', calendar: 'This week (calendar)', rolling: 'Last 7 days (rolling)', lowThreshold: 'Low-balance threshold', lowThresholdHint: 'Below this amount the phone balance turns red. Leave empty to disable the alert.', notifications: 'Notifications', notificationsHint: 'Every app is included by default; unchecked apps are hidden on the phone.', allApps: 'Select all', limit: 'Display limit', noApps: 'No notification apps recorded yet.', status: 'Service status', statusHint: 'Capabilities of the current system service.', clients: 'Connected devices', clientsHint: 'Phones or browsers currently viewing the console.', noClients: 'No devices are connected.', disconnect: 'Disconnect', diagnostics: 'Diagnostics', pluginVersion: 'Plugin version', protocol: 'Transport', profileName: 'Profile', notificationsStatus: 'Notifications', mediaStatus: 'Media', volumeStatus: 'Volume', weatherStatus: 'Weather', healthy: 'Healthy', unavailable: 'Unavailable', checking: 'Checking', pageHome: 'Home', pageSessions: 'Sessions', pageMusic: 'Music', noWebServer: 'This deployment has no usable webServer.', serviceRunning: 'Service running', serviceStopped: 'Service stopped', connectionHint: 'Pairing, reachable interfaces, access verification, and the HTTPS certificate.', preferencesHint: 'Temperature unit, theme, page order, and navigation placement for the phone console; save to apply.', navPosition: 'Navigation bar', navPositionHint: 'Choose which screen edge hosts the phone console navigation bar.', navLeft: 'Left', navRight: 'Right', navTop: 'Top', navBottom: 'Bottom', pomodoro: 'Pomodoro', pomodoroHint: 'Enable, duration, alert sound, and looping for the phone pomodoro.', pomodoroEnable: 'Enable pomodoro', pomodoroEnableHint: 'Show a pomodoro card below the clock and set focus and break lengths.', pomodoroFocus: 'Focus minutes', pomodoroBreak: 'Break minutes', pomodoroSound: 'Alert sound file', pomodoroSoundSection: 'Alert sound', pomodoroSoundHint: 'Leave empty for the built-in gentle chime, or use a local audio file path or http(s) URL.', pomodoroSoundPlaceholder: 'e.g. D:\\sounds\\chime.mp3', pomodoroLoop: 'Loop until stopped', pomodoroLoopHint: 'When enabled, the end-of-timer sound repeats until you click Stop ringing on the phone. When disabled, it plays once.', peakValley: 'Show peak / valley', peakValleyHint: 'Show a tariff capsule in the top-right of the balance card header: weekdays 9:00–12:00 and 14:00–18:00 show Peak with a mountain icon (Liang Wenfeng); all other times, weekends, and holidays show Off-peak with a moon icon (Liang Wengu, half price). The browser judges this and loads holiday data from timor.tech.', menuAppMapping: 'App names', appMapping: 'App names', appMappingHint: 'Display names used by notifications and media. Every app seen on this system is listed; a rename saves immediately and applies to both phone notifications and the music source label.', sourceNotification: 'Notification', sourceMusic: 'Music', resetName: 'Reset', locationPermission: 'Location permission', locationPermissionHint: 'Windows location access needs a privacy grant. The button asks for permission; when it is denied, the system Location settings page opens. Enable "Location services" and "Let desktop apps access your location", then retry.', locationRequest: 'Request location access', locationRequesting: 'Requesting…', locationAllowed: 'Location access granted; weather will use this computer position.', locationPrivacyDenied: 'Windows denied location access and the Settings page was opened; enable "Location services" and "Let desktop apps access your location", then retry.', locationLowIntegrity: 'The probe is running at low integrity, which Windows rejects for location. Rebuild it from a normal terminal (pnpm build:rust) or follow the INSTALLATION.md repair guide.', locationUnspecified: 'Location access has not been granted yet; the Settings page was opened.', locationFailed: 'The location permission request failed; try again later.', locationStatus: 'Current status', accessAllowed: 'Allowed', accessDenied: 'Denied', accessUnspecified: 'Not granted', accessUnknown: 'Unknown', pushQuestions: 'Push inquiries', pushQuestionsHint: 'When enabled, a session waiting for an answer pushes the complete question and options. Tapping that session on the phone opens a floating sheet where you can choose an option or type a custom reply.', tlsEnable: 'Enable HTTPS', weatherPageHint: 'Location source, display mode, and location permission for the phone weather page.', weatherSource: 'Weather location', forecastDisplayHint: 'Choose hourly or 7-day forecast for the weather card.', balancePageHint: 'Spend window, low-balance alert, and peak/off-peak marker for the phone balance card.', balanceSpend: 'Spend window', peakValleyBlock: 'Peak / off-peak marker', peakValleyToggle: 'Show peak/off-peak marker', notificationsPageHint: 'Push questions, visible apps, and display limit for phone notifications.', notificationApps: 'Notification apps', pushQuestionsToggle: 'Allow remote answers', limitDisplay: 'Display limit', limitField: 'Count', notificationLimitHint: 'Maximum number of notifications shown on the phone card (1–20).', appsPageHint: 'App names shown in phone notifications and media; changes save immediately.', appNamesBlock: 'App names', systemPageHint: 'Service status, system capabilities, connected devices, and diagnostics.', diagnosticsHint: 'Plugin/probe versions, transport, profile, and runtime details.', probeVersion: 'Probe version', probeBackends: 'Platform backends', probeBinary: 'Probe path', probeMissing: 'Probe unavailable', nodeVersion: 'Node.js version', nodeV8: 'V8 version', nodeMemory: 'Memory', nodePlatform: 'Platform', backendMedia: 'Media', backendVolume: 'Volume', backendPerformance: 'Performance', backendNotifications: 'Notifications', backendLocation: 'Location', performanceStatus: 'Performance', locationCapability: 'Location', runtime: 'System capabilities', runtimeHint: 'Versions, platforms, and platform backends of the native probe and the Node.js runtime.', device: 'Device', durationSeconds: 'sec', durationMinutes: 'min', durationHours: 'h', durationDays: 'd', keepOneApp: 'Keep at least one notification app', keepOnePage: 'Keep at least one page', tlsPathsRequired: 'Fill in the certificate and private key paths first', saveTls: 'Save certificate', saveLocation: 'Save location', saveThreshold: 'Save threshold',
};

export const en: Record<string, string> = { ...zh, ...enOverrides };

let localeService: LocaleService | null = null;

/** Remember the host locale service so the panel can follow its locale. */
export function configureLocale(service: LocaleService): void {
  localeService = service;
}

/** Bundled dictionary lookup used before the host locale service is ready. */
export function fallbackTranslate(key: string): string {
  return zh[key] ?? en[key] ?? key;
}

/** Translate one key through DSH, falling back to the bundled dictionaries. */
export function translate(key: string): string {
  if (!localeService) return fallbackTranslate(key);
  try {
    return localeService.bind(NS)(key) || fallbackTranslate(key);
  } catch {
    return fallbackTranslate(key);
  }
}

/**
 * React hook that re-renders the panel when DSH changes locale. The translator
 * itself reads the current locale on every call, so only a version tick is
 * needed here.
 */
export function useTranslator(): Translator {
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!localeService?.subscribe) return;
    return localeService.subscribe(() => setVersion((value) => value + 1));
  }, []);
  return translate;
}
