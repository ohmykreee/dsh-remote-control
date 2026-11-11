/* DSH Home — deep-blue 1280×800 console. Live WebSocket pushes, no polling. */
(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const PAGE_LABELS = { home: '首页', sessions: '会话', music: '音乐', performance: '性能' };
  const DEFAULT_ORDER = ['home', 'sessions', 'music', 'performance'];

  const ICONS = {
    home: '<path d="m4 10.5 8-6.7 8 6.7V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    music: '<path d="M9 18V6l10-2v11" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.7" stroke="currentColor" stroke-width="1.7"/><circle cx="16.5" cy="15" r="2.7" stroke="currentColor" stroke-width="1.7"/>',
    previous: '<path d="M7 5v14M19 6.5 9.5 12 19 17.5V6.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    next: '<path d="M17 5v14M5 6.5 14.5 12 5 17.5V6.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    play: '<path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor"/>',
    pause: '<path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z" fill="currentColor"/>',
    volume: '<path d="M4 10v4h4l5 4V6l-5 4H4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M16 9.2a4 4 0 0 1 0 5.6M18.5 6.8a7.2 7.2 0 0 1 0 10.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    'volume-off': '<path d="M4 10v4h4l5 4V6l-5 4H4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m16 10 4 4m0-4-4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    sun: '<circle cx="12" cy="12" r="4.1" stroke="currentColor" stroke-width="1.7"/><path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    moon: '<path d="M20 15.2A8.5 8.5 0 0 1 8.8 4a8.7 8.7 0 1 0 11.2 11.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    cloud: '<path d="M6.5 18h10.2a4.3 4.3 0 0 0 .7-8.5A5.5 5.5 0 0 0 7 8.6 4.7 4.7 0 0 0 6.5 18Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    'cloud-sun': '<path d="M15.5 17.5h4a3.4 3.4 0 0 0 .5-6.8 4.6 4.6 0 0 0-8.7-1.4 3.8 3.8 0 0 0 1.7 7.4" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 5.5 8.7 4M4.2 4.8l.9.9M4 9h1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    rain: '<path d="M6.5 15h10.2a4.3 4.3 0 0 0 .7-8.5A5.5 5.5 0 0 0 7 5.6 4.7 4.7 0 0 0 6.5 15Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m8 18-.8 2M12 18l-.8 2M16 18l-.8 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    storm: '<path d="M6.5 14h10.2a4.3 4.3 0 0 0 .7-8.5A5.5 5.5 0 0 0 7 4.6 4.7 4.7 0 0 0 6.5 14Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m12.5 16-3 4h3l-1 3.5 4-5h-3l1-2.5Z" fill="currentColor"/>',
    snow: '<path d="M6.5 15h10.2a4.3 4.3 0 0 0 .7-8.5A5.5 5.5 0 0 0 7 5.6 4.7 4.7 0 0 0 6.5 15Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 18v3M6.8 18.8l2.4 2.4M9.2 18.8l-2.4 2.4M15 18v3M13.8 18.8l2.4 2.4M16.2 18.8l-2.4 2.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
    fog: '<path d="M4 8h11M7 12h13M4 16h12M9 20h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    expand: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    compress: '<path d="M3 8h5V3M21 8h-5V3M16 21v-5h5M8 21v-5H3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    heart: '<path d="M12 20.2 4.8 13a4.8 4.8 0 0 1 6.8-6.8L12 7l.4-.8A4.8 4.8 0 0 1 19.2 13L12 20.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    'heart-filled': '<path d="M12 20.2 4.8 13a4.8 4.8 0 0 1 6.8-6.8L12 7l.4-.8A4.8 4.8 0 0 1 19.2 13L12 20.2Z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
    cpu: '<rect x="7" y="7" width="10" height="10" rx="2.5" stroke="currentColor" stroke-width="1.7"/><path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3M10 10h4v4h-4z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  };

  function icon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">${ICONS[name] || ICONS.cloud}</svg>`;
  }

  const WMO = {
    0: ['晴', 'sun', 'day'],
    1: ['大致晴朗', 'sun', 'day'],
    2: ['局部多云', 'cloud-sun', 'day'],
    3: ['阴天', 'cloud', 'cloud'],
    45: ['有雾', 'fog', 'cloud'],
    48: ['雾凇', 'fog', 'cloud'],
    51: ['毛毛雨', 'rain', 'rain'],
    53: ['毛毛雨', 'rain', 'rain'],
    55: ['较强毛毛雨', 'rain', 'rain'],
    56: ['冻毛毛雨', 'rain', 'rain'],
    57: ['强冻毛毛雨', 'rain', 'rain'],
    61: ['小雨', 'rain', 'rain'],
    63: ['中雨', 'rain', 'rain'],
    65: ['大雨', 'rain', 'rain'],
    66: ['冻雨', 'rain', 'rain'],
    67: ['强冻雨', 'rain', 'rain'],
    71: ['小雪', 'snow', 'rain'],
    73: ['中雪', 'snow', 'rain'],
    75: ['大雪', 'snow', 'rain'],
    77: ['雪粒', 'snow', 'rain'],
    80: ['阵雨', 'rain', 'rain'],
    81: ['较强阵雨', 'rain', 'rain'],
    82: ['强阵雨', 'storm', 'storm'],
    85: ['阵雪', 'snow', 'rain'],
    86: ['强阵雪', 'snow', 'rain'],
    95: ['雷雨', 'storm', 'storm'],
    96: ['雷雨伴冰雹', 'storm', 'storm'],
    99: ['强雷雨伴冰雹', 'storm', 'storm'],
  };

  function weatherInfo(code, isDay) {
    const item = WMO[code] || (isDay ? ['天气', 'sun', 'day'] : ['夜间', 'moon', 'night']);
    return { label: item[0], icon: item[1], skycon: skyconFor(code, isDay), tone: item[2] };
  }

  function skyconFor(code, isDay) {
    switch (Number(code)) {
      case 0: return isDay ? 'CLEAR_DAY' : 'CLEAR_NIGHT';
      case 1:
      case 2: return isDay ? 'PARTLY_CLOUDY_DAY' : 'PARTLY_CLOUDY_NIGHT';
      case 3: return 'CLOUDY';
      case 45:
      case 48: return 'FOG';
      case 51:
      case 53:
      case 55:
      case 56:
      case 57:
      case 61:
      case 66:
      case 67:
      case 80: return 'LIGHT_RAIN';
      case 63:
      case 81: return 'MODERATE_RAIN';
      case 65: return 'HEAVY_RAIN';
      case 71:
      case 77:
      case 85: return 'LIGHT_SNOW';
      case 73:
      case 86: return 'MODERATE_SNOW';
      case 75: return 'HEAVY_SNOW';
      case 82:
      case 95:
      case 96:
      case 99: return 'STORM_RAIN';
      default: return 'CLOUDY';
    }
  }

  function weatherArtSvg(info, isDay) {
    const defs = `<defs>
      <linearGradient id="wx-sun" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#9db4ff"/><stop offset="1" stop-color="#4d6bff"/></linearGradient>
      <linearGradient id="wx-cloud" x1="0" y1="0" x2="0.8" y2="1"><stop stop-color="#eef4ff" stop-opacity=".95"/><stop offset="1" stop-color="#9fb5e8" stop-opacity=".6"/></linearGradient>
    </defs>`;
    const sun = `<g><circle cx="103" cy="54" r="36" fill="#4d6bff" opacity=".14"/><circle cx="103" cy="54" r="24" fill="url(#wx-sun)"/><g stroke="#9db4ff" stroke-width="2.2" stroke-linecap="round" opacity=".8"><path d="M103 16v8M103 84v8M65 54h8M133 54h8M76 27l6 6M124 75l6 6M130 27l-6 6M82 75l-6 6"/></g></g>`;
    const moon = `<g><circle cx="103" cy="56" r="34" fill="#7f94ff" opacity=".1"/><path d="M119 74c-19 9-39-5-39-25 0-8 3-15 9-21-17 5-27 21-22 38 5 18 23 28 40 22 6-2 10-7 12-14Z" fill="#c7d4ff" opacity=".9"/><circle cx="132" cy="34" r="1.8" fill="#c7d4ff" opacity=".7"/><circle cx="84" cy="30" r="1.2" fill="#c7d4ff" opacity=".55"/></g>`;
    const cloud = `<path d="M48 118h59c12 0 22-9 22-21s-10-21-22-21c-2 0-4 .2-6 .7C97 62 84 52 68 52c-20 0-36 15-38 34-10 2-17 10-17 21 0 12 10 21 22 21h13Z" fill="url(#wx-cloud)" opacity=".95"/><path d="M48 118h59c12 0 22-9 22-21s-10-21-22-21c-2 0-4 .2-6 .7C97 62 84 52 68 52c-20 0-36 15-38 34-10 2-17 10-17 21 0 12 10 21 22 21h13Z" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="1.3"/>`;
    const rain = `<g stroke="#6f8dff" stroke-width="3" stroke-linecap="round" opacity=".9"><path d="m58 130-5 12M82 130l-5 12M106 130l-5 12"/></g>`;
    const snow = `<g stroke="#c9d8ff" stroke-width="2.2" stroke-linecap="round" opacity=".9"><path d="M58 128v13M52 131l12 7M64 131l-12 7M104 128v13M98 131l12 7M110 131l-12 7"/></g>`;
    const bolt = `<path d="m101 122-15 24h14l-7 18 22-27h-14l7-15Z" fill="#ffc36e"/>`;
    const fog = `<g stroke="#91a6d7" stroke-width="3" stroke-linecap="round" opacity=".5"><path d="M38 128h104M50 140h78M30 152h108"/></g>`;
    const base = info.icon === 'sun' ? sun + (isDay ? sun : moon) : info.icon === 'moon' ? moon : info.icon === 'fog' ? sun + cloud + fog : info.icon === 'rain' ? sun + cloud + rain : info.icon === 'snow' ? sun + cloud + snow : info.icon === 'storm' ? sun + cloud + bolt : info.icon === 'cloud-sun' ? sun + cloud : cloud;
    return `<svg viewBox="0 0 180 170" xmlns="http://www.w3.org/2000/svg">${defs}${base}</svg>`;
  }

  function setIcons() {
    for (const element of $$('[data-icon]')) element.innerHTML = icon(element.dataset.icon);
  }

  const state = {
    ws: null,
    reconnectDelay: 1000,
    reconnectTimer: null,
    connected: false,
    overview: null,
    media: null,
    mediaReceivedAt: 0,
    temperatureUnit: 'celsius',
    order: [...DEFAULT_ORDER],
    pageOrder: [...DEFAULT_ORDER],
    pageEnabled: { home: true, sessions: true, music: true, performance: true },
    pageNodes: null,
    railNodes: null,
    activeKey: 'home',
    initialKey: null,
    hasNavigated: false,
    seekDragging: false,
    seekHoldUntil: 0,
    seekTarget: 0,
    volumeDragging: false,
    volumeHoldUntil: 0,
    volumeTarget: 0,
    jumpTimer: null,
    suppressScrollUntil: 0,
    toastTimer: null,
  };

  function now() {
    return Date.now();
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function timeAgo(timestamp) {
    if (!Number.isFinite(timestamp)) return '';
    const seconds = Math.max(0, Math.round((now() - timestamp) / 1000));
    if (seconds < 45) return '刚刚';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
    return `${Math.floor(seconds / 86400)} 天前`;
  }

  function formatClock() {
    const date = new Date(now());
    const hour = date.getHours();
    let greeting = '晚上好';
    let period = '晚上';
    if (hour >= 5 && hour < 11) { greeting = '早上好'; period = '早上'; }
    else if (hour >= 11 && hour < 13) { greeting = '中午好'; period = '中午'; }
    else if (hour >= 13 && hour < 18) { greeting = '下午好'; period = '下午'; }
    $('#clock').textContent = `${pad(hour)}:${pad(date.getMinutes())}`;
    $('#clockSeconds').textContent = pad(date.getSeconds());
    $('#greeting').textContent = greeting;
    $('#periodLabel').textContent = period;
    $('#dateLabel').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(date);
  }

  function formatMoney(value, currency = 'CNY') {
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
    const symbol = String(currency || '').toUpperCase() === 'USD' ? '$' : '¥';
    const abs = Math.abs(Number(value));
    const digits = abs > 0 && abs < 1 ? 4 : 2;
    return `${symbol}${Number(value).toFixed(digits).replace(/\.?0+$/, '')}`;
  }

  function currencySymbol(currency) {
    return String(currency || '').toUpperCase() === 'USD' ? '$' : '¥';
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${pad(total % 60)}`;
  }

  function appInitial(name, title) {
    return Array.from(String(name || title || '?').trim())[0]?.toUpperCase() || '?';
  }

  function appGradient(key) {
    let hash = 0;
    for (const char of String(key || 'app')) hash = (hash * 31 + char.charCodeAt(0)) % 360;
    return `linear-gradient(145deg, hsl(${hash} 45% 30%), hsl(${(hash + 46) % 360} 48% 20%))`;
  }

  function sourceLabel(appId) {
    const id = String(appId || '');
    if (/bilibili/i.test(id)) return '哔哩哔哩';
    if (/spotify/i.test(id)) return 'Spotify';
    if (/Music/i.test(id)) return '音乐';
    if (/chrome/i.test(id)) return 'Chrome';
    if (/firefox/i.test(id)) return 'Firefox';
    if (id === 'macOS') return 'macOS';
    if (id.startsWith('org.mpris.MediaPlayer2.')) return id.replace('org.mpris.MediaPlayer2.', '').replace(/[._]/g, ' ');
    return id.split('.').pop().replace(/[._-]/g, ' ') || '媒体';
  }

  function setConnected(connected) {
    state.connected = connected;
    $('#connectionDot').classList.toggle('is-offline', !connected);
    $('#connectionDot').title = connected ? '已连接' : '连接中断';
    $('#offlineNotice').hidden = connected;
    if (connected) {
      state.reconnectDelay = 1000;
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  }

  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { element.hidden = true; }, 2600);
  }

  function send(message) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      toast('正在连接，请稍候');
      return false;
    }
    state.ws.send(JSON.stringify(message));
    return true;
  }

  function applyTheme(theme) {
    document.body.dataset.theme = theme === 'light' ? 'light' : 'dark';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#eef3ff' : '#05070d');
  }

  function normalizedOrder(input) {
    const keys = Array.isArray(input) ? input.filter((key) => DEFAULT_ORDER.includes(key)) : [];
    const order = [...new Set(keys)];
    for (const key of DEFAULT_ORDER) if (!order.includes(key)) order.push(key);
    return order.slice(0, DEFAULT_ORDER.length);
  }

  function enabledOrder(order) {
    const enabled = order.filter((key) => state.pageEnabled[key] !== false);
    if (enabled.length > 0) return enabled;
    return ['home'];
  }

  function pageOffset() {
    return state.order.length > 1 ? 1 : 0;
  }

  function stripCloneIds(root) {
    root.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
  }

  function syncClones() {
    const pager = $('#pager');
    if (!pager) return;
    for (const clone of pager.querySelectorAll('.page-clone')) {
      const source = pager.querySelector(`.page[data-page-key="${clone.dataset.sourceKey}"]:not(.page-clone)`);
      if (!source) continue;
      clone.innerHTML = source.innerHTML;
      stripCloneIds(clone);
    }
  }

  function rebuildClones() {
    const pager = $('#pager');
    if (!pager) return;
    for (const clone of pager.querySelectorAll('.page-clone')) clone.remove();
    const pages = [...pager.querySelectorAll('.page[data-page-key]:not(.page-clone)')];
    if (pages.length < 2) return;
    const first = pages[0];
    const last = pages[pages.length - 1];
    const firstClone = first.cloneNode(true);
    firstClone.classList.add('page-clone');
    firstClone.dataset.sourceKey = first.dataset.pageKey;
    firstClone.dataset.pageKey = '__first-clone';
    firstClone.setAttribute('aria-hidden', 'true');
    stripCloneIds(firstClone);
    const lastClone = last.cloneNode(true);
    lastClone.classList.add('page-clone');
    lastClone.dataset.sourceKey = last.dataset.pageKey;
    lastClone.dataset.pageKey = '__last-clone';
    lastClone.setAttribute('aria-hidden', 'true');
    stripCloneIds(lastClone);
    pager.prepend(lastClone);
    pager.appendChild(firstClone);
  }

  function applyPageOrder(input) {
    const pager = $('#pager');
    if (!pager) return;
    if (!state.pageNodes) {
      state.pageNodes = new Map([...pager.querySelectorAll('.page[data-page-key]')].map((page) => [page.dataset.pageKey, page]));
    }
    if (!state.railNodes) {
      state.railNodes = new Map([...document.querySelectorAll('.rail-button[data-key]')].map((button) => [button.dataset.key, button]));
    }
    const order = enabledOrder(normalizedOrder(input));
    const cloneCount = order.length > 1 ? 2 : 0;
    const same = order.join('|') === state.order.join('|')
      && pager.querySelectorAll('.page[data-page-key]:not(.page-clone)').length === order.length
      && pager.querySelectorAll('.page-clone').length === cloneCount;
    const previousKey = state.activeKey;
    const initialKey = state.initialKey && order.includes(state.initialKey) ? state.initialKey : null;
    if (!same) {
      state.order = order;
      for (const clone of pager.querySelectorAll('.page-clone')) clone.remove();
      for (const page of pager.querySelectorAll('.page[data-page-key]')) page.remove();
      for (const key of order) {
        const page = state.pageNodes.get(key);
        if (page) pager.appendChild(page);
      }
      const rail = $('#railTop');
      for (const key of order) {
        const button = state.railNodes.get(key);
        if (button) rail.appendChild(button);
      }
      for (const [key, button] of state.railNodes) {
        button.hidden = !order.includes(key);
      }
      rebuildClones();
    }
    const wanted = initialKey
      ? initialKey
      : !state.hasNavigated
        ? order[0]
        : order.includes(previousKey)
          ? previousKey
          : order[0];
    state.initialKey = null;
    state.hasNavigated = true;
    state.activeKey = wanted;
    updateRail(wanted);
    if (initialKey || !same || wanted !== previousKey) {
      clearTimeout(state.jumpTimer);
      state.jumpTimer = null;
      state.suppressScrollUntil = Date.now() + 220;
      pager.scrollLeft = (order.indexOf(wanted) + pageOffset()) * pager.clientWidth;
      requestAnimationFrame(() => {
        pager.scrollLeft = (order.indexOf(wanted) + pageOffset()) * pager.clientWidth;
      });
    }
  }

  function applySettings(settings) {
    if (!settings) return;
    if (settings.theme) applyTheme(settings.theme);
    if (settings.temperatureUnit) {
      const unit = settings.temperatureUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
      if (unit !== state.temperatureUnit) {
        state.temperatureUnit = unit;
        if (state.overview?.weather) renderWeather(state.overview.weather);
        if (state.overview?.performance) renderPerformance(state.overview.performance);
        const unitLabel = $('#tempUnitLabel');
        if (unitLabel) unitLabel.textContent = `${temperatureUnitLabel()} 最高`;
      }
    }
    if (settings.pageOrder) state.pageOrder = normalizedOrder(settings.pageOrder);
    if (settings.pageEnabled) state.pageEnabled = { ...state.pageEnabled, ...settings.pageEnabled };
    if (settings.pageOrder || settings.pageEnabled) applyPageOrder(state.pageOrder);
  }

  function updateRail(key) {
    for (const button of $$('.rail-button')) button.classList.toggle('is-active', button.dataset.key === key);
    document.body.dataset.page = key;
  }

  function goTo(key, smooth = true) {
    const index = state.order.indexOf(key);
    if (index < 0) return;
    state.hasNavigated = true;
    state.activeKey = key;
    updateRail(key);
    const pager = $('#pager');
    clearTimeout(state.jumpTimer);
    state.jumpTimer = null;
    state.suppressScrollUntil = Date.now() + (smooth ? 620 : 120);
    pager.scrollTo({ left: (index + pageOffset()) * pager.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  }

  function isFahrenheit() {
    return state.temperatureUnit === 'fahrenheit';
  }

  function temperatureUnitLabel() {
    return isFahrenheit() ? '°F' : '°C';
  }

  function toDisplayTemperature(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return isFahrenheit() ? number * 9 / 5 + 32 : number;
  }

  function formatTemperature(value, digits = 0) {
    const number = toDisplayTemperature(value);
    if (number === null) return '--';
    return `${digits > 0 ? number.toFixed(digits) : Math.round(number)}${temperatureUnitLabel()}`;
  }

  function renderWeather(weather) {
    const unit = temperatureUnitLabel();
    if (!weather || weather.ok === false) {
      $('#temperature').innerHTML = `--<span>${unit}</span>`;
      $('#condition').textContent = '天气暂不可用';
      $('#weatherLocation').textContent = '当前位置';
      $('#weatherHighLow').textContent = '-- / --';
      $('#weatherFeels').textContent = '--';
      $('#weatherHumidity').textContent = '--';
      $('#weatherWind').textContent = '--';
      $('#weatherArt').innerHTML = '<img src="/weather-icons/CLOUDY.svg" alt="">';
      $('#clockWatermark').innerHTML = '';
      $('#weatherHourly').innerHTML = '';
      $('#weatherHourly').className = 'hourly';
      $('#weatherExtra').innerHTML = '';
      return;
    }
    const current = weather.current || {};
    const daily = weather.daily || {};
    const info = weatherInfo(current.code, current.isDay);
    const art = `<img src="/weather-icons/${info.skycon}.svg" alt="">`;
    const mainTemperature = toDisplayTemperature(current.temperature);
    $('#weatherArt').innerHTML = art;
    $('#clockWatermark').innerHTML = icon(info.icon);
    $('#temperature').innerHTML = mainTemperature === null
      ? `--<span>${unit}</span>`
      : `${Math.round(mainTemperature)}<span>${unit}</span>`;
    $('#condition').textContent = info.label;
    $('#weatherLocation').textContent = weather.location?.name || '当前位置';
    $('#weatherHighLow').textContent = `${formatTemperature(daily.high)} / ${formatTemperature(daily.low)}`;
    $('#weatherFeels').textContent = formatTemperature(current.feelsLike);
    $('#weatherHumidity').textContent = `${Math.round(current.humidity ?? 0)}%`;
    $('#weatherWind').textContent = `${Math.round(current.windSpeed ?? 0)} km/h`;

    const hourly = Array.isArray(weather.hourly) ? weather.hourly.slice(0, 6) : [];
    const dailyForecast = Array.isArray(weather.dailyForecast) ? weather.dailyForecast.slice(0, 7) : [];
    const hourlyBox = $('#weatherHourly');
    if (weather.forecastMode === 'daily' && dailyForecast.length > 0) {
      hourlyBox.className = 'hourly is-daily';
      hourlyBox.innerHTML = dailyForecast.map((day, index) => {
        const date = new Date(day.date);
        const dayInfo = weatherInfo(day.code, true);
        const label = index === 0 ? '今天' : new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date);
        return `<div class="hour-chip${index === 0 ? ' is-now' : ''}"><span>${label}</span>${icon(dayInfo.icon)}<b>${formatTemperature(day.high)}</b><small>${formatTemperature(day.low)}</small></div>`;
      }).join('');
    } else {
      hourlyBox.className = 'hourly';
      hourlyBox.innerHTML = hourly.map((hour, index) => {
        const date = new Date(hour.time);
        const hInfo = weatherInfo(hour.code, date.getHours() >= 6 && date.getHours() < 18);
        return `<div class="hour-chip${index === 0 ? ' is-now' : ''}"><span>${index === 0 ? '现在' : `${pad(date.getHours())}时`}</span>${icon(hInfo.icon)}<b>${formatTemperature(hour.temperature)}</b></div>`;
      }).join('');
    }

    const sunrise = weather.daily?.sunrise ? new Date(weather.daily.sunrise) : null;
    const sunset = weather.daily?.sunset ? new Date(weather.daily.sunset) : null;
    const sunriseText = sunrise && !Number.isNaN(sunrise.getTime()) ? `${pad(sunrise.getHours())}:${pad(sunrise.getMinutes())}` : '--:--';
    const sunsetText = sunset && !Number.isNaN(sunset.getTime()) ? `${pad(sunset.getHours())}:${pad(sunset.getMinutes())}` : '--:--';
    const high = weather.daily?.tomorrowHigh;
    const low = weather.daily?.tomorrowLow;
    const tomorrow = high != null && low != null ? `${formatTemperature(high)} / ${formatTemperature(low)}` : '--';
    $('#weatherExtra').innerHTML = `<span>${icon('sun')}日出 <b>${sunriseText}</b></span><span>${icon('moon')}日落 <b>${sunsetText}</b></span><span>${icon('cloud')}明日 <b>${tomorrow}</b></span>`;
  }

  function renderNotifications(notifications) {
    const list = Array.isArray(notifications?.notifications) ? notifications.notifications : [];
    $('#notificationCount').textContent = String(list.length);
    if (notifications?.available === false) {
      $('#notificationList').innerHTML = `<div class="empty-state">${icon('cloud')}<h3>通知不可用</h3><p>${esc(notifications.reason || '当前系统无法读取通知')}</p></div>`;
      return;
    }
    if (list.length === 0) {
      $('#notificationList').innerHTML = `<div class="empty-state">${icon('cloud')}<h3>暂无通知</h3><p>新的系统通知会出现在这里。</p></div>`;
      return;
    }
    $('#notificationList').innerHTML = list.map((item) => {
      const avatar = item.avatar ? `<img src="${esc(item.avatar)}" alt="" loading="lazy">` : esc(appInitial(item.appName, item.title));
      return `<div class="notification-row">
        <div class="notification-avatar" style="background:${item.avatar ? 'transparent' : appGradient(item.appKey)}">${avatar}</div>
        <div class="notification-body">
          <span class="notification-app">${esc(item.appName || '通知')}</span>
          <p class="notification-title">${esc(item.title || '')}</p>
          ${item.body ? `<p class="notification-text">${esc(item.body)}</p>` : ''}
        </div>
        <span class="notification-time">${timeAgo(item.receivedAt)}</span>
      </div>`;
    }).join('');
  }

  function renderAccount(account) {
    const balance = account?.balance;
    const card = $('.balance-card');
    if (!account || account.available === false || !account.signedIn) {
      $('#balanceCurrency').textContent = '¥';
      $('#balanceValue').textContent = '—';
      $('#balanceCaption').textContent = account?.balance?.error || '未登录账号';
      $('#balanceAlert').hidden = true;
      card.classList.remove('is-low');
      $('#todaySpend').textContent = '—';
      $('#periodSpend').textContent = '—';
      $('#spendLabel').textContent = '本周';
      $('#spendCaption').textContent = '—';
      $('#spendChart').innerHTML = '';
      return;
    }
    const currency = balance?.currency || account.usage?.currency || 'CNY';
    $('#balanceCurrency').textContent = currencySymbol(currency);
    $('#balanceValue').textContent = balance?.balance != null && Number.isFinite(Number(balance.balance))
      ? Number(balance.balance).toFixed(2)
      : '—';
    $('#balanceCaption').textContent = balance?.state === 'ready'
      ? `充值 ${formatMoney(balance.paid, currency)} · 赠送 ${formatMoney(balance.bonus, currency)}`
      : balance?.error || '正在同步余额';
    const low = Boolean(account.lowBalance);
    card.classList.toggle('is-low', low);
    $('#balanceAlert').hidden = !low;
    $('#balanceAlertText').textContent = low ? `余额低于提醒线 ${formatMoney(account.lowThreshold, currency)}` : '';

    const usage = account.usage || {};
    const today = usage.state === 'ready' ? usage.today : null;
    const spend = usage.state === 'ready' ? usage.spend : null;
    $('#todaySpend').textContent = usage.state === 'ready' ? formatMoney(today, usage.currency || currency) : '—';
    $('#periodSpend').textContent = usage.state === 'ready' ? formatMoney(spend, usage.currency || currency) : '—';
    $('#spendLabel').textContent = usage.spendLabel || '本周';

    const daily = Array.isArray(usage.daily) ? usage.daily : [];
    const max = Math.max(0, ...daily.map((day) => Number(day.cost) || 0));
    $('#spendChart').innerHTML = daily.map((day, index) => {
      const height = max > 0 ? Math.max(3, Math.round(((Number(day.cost) || 0) / max) * 100)) : 3;
      return `<div class="spend-bar${index === daily.length - 1 ? ' is-today' : ''}" title="${esc(day.label)} ${formatMoney(day.cost, usage.currency || currency)}"><i style="height:${height}%"></i><span>${esc(day.label)}</span></div>`;
    }).join('');

    $('#spendCaption').textContent = usage.state === 'ready'
      ? `${usage.spendLabel || '本周'}累计 · 近 7 日柱状图按当日最高值归一`
      : usage.state === 'expired'
        ? '登录已过期，请回到 DSH 重新登录'
        : usage.error || '用量暂时不可用';
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let index = 0;
    let size = bytes;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
  }

  function formatUptime(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (days > 0) return `${days}天 ${hours}小时`;
    if (hours > 0) return `${hours}小时 ${minutes}分`;
    return `${minutes}分钟`;
  }

  function renderPerformance(data) {
    if (!data) return;
    const cpu = data.cpu || {};
    const memory = data.memory || {};
    const gpu = data.gpu || {};
    const cpuUsage = Number(cpu.usage);
    $('#cpuUsage').textContent = Number.isFinite(cpuUsage) ? Math.round(cpuUsage) : '—';
    $('#cpuRing').style.setProperty('--p', Number.isFinite(cpuUsage) ? Math.max(0, Math.min(100, cpuUsage)) : 0);
    $('#cpuModel').textContent = cpu.model || '处理器';
    $('#cpuCores').textContent = `${cpu.cores ?? '—'} 核心`;
    $('#cpuSpeed').textContent = cpu.speed ? `${(Number(cpu.speed) / 1000).toFixed(1)} GHz` : '—';
    $('#cpuUptime').textContent = formatUptime(cpu.uptime);

    const memoryPercent = Number(memory.percent);
    $('#memoryPercent').textContent = Number.isFinite(memoryPercent) ? `${Math.round(memoryPercent)}%` : '—%';
    $('#memoryUsed').textContent = formatBytes(memory.used);
    $('#memoryTotal').textContent = `/ ${formatBytes(memory.total)}`;
    $('#memoryBar').style.width = `${Number.isFinite(memoryPercent) ? Math.max(0, Math.min(100, memoryPercent)) : 0}%`;
    $('#memoryNote').textContent = Number.isFinite(Number(memory.free)) ? `空闲 ${formatBytes(memory.free)}` : '内存读数不可用';

    const gpuUsage = Number(gpu.utilization);
    $('#gpuName').textContent = gpu.name || '未检测到独立显卡';
    $('#gpuUsage').textContent = Number.isFinite(gpuUsage) ? Math.round(gpuUsage) : '—';
    $('#gpuUsageChip').textContent = Number.isFinite(gpuUsage) ? `${Math.round(gpuUsage)}%` : '—%';
    $('#gpuRing').style.setProperty('--p', Number.isFinite(gpuUsage) ? Math.max(0, Math.min(100, gpuUsage)) : 0);
    $('#gpuMemory').textContent = gpu.memoryUsed ? formatBytes(gpu.memoryUsed) : '—';
    $('#gpuMemoryTotal').textContent = gpu.memoryTotal ? `/ ${formatBytes(gpu.memoryTotal)}` : '/ —';
    const gpuMemoryPercent = Number(gpu.memoryPercent);
    $('#gpuMemoryChip').textContent = Number.isFinite(gpuMemoryPercent) ? `${Math.round(gpuMemoryPercent)}%` : '—%';
    $('#gpuBar').style.width = `${Number.isFinite(gpuMemoryPercent) ? Math.max(0, Math.min(100, gpuMemoryPercent)) : 0}%`;
    $('#gpuNote').textContent = gpu.ok === false
      ? gpu.error || 'GPU 读数不可用'
      : gpu.driver ? `驱动 ${gpu.driver}` : 'GPU 读数';
    $('#vramNote').textContent = '显存占用';

    const temperatures = Array.isArray(data.temperatures) ? data.temperatures : [];
    const tempUnit = temperatureUnitLabel();
    $('#tempCount').textContent = `${temperatures.length} 个传感器`;
    $('#tempUnitLabel').textContent = `${tempUnit} 最高`;
    const list = $('#tempList');
    const hero = $('.temp-hero');
    let maxTemp = -Infinity;
    if (temperatures.length === 0) {
      list.innerHTML = '<p class="perf-note">系统没有暴露可读的温度传感器</p>';
    } else {
      list.innerHTML = temperatures.map((item) => {
        const value = Number(item.celsius);
        if (Number.isFinite(value)) maxTemp = Math.max(maxTemp, value);
        const tone = value >= 85 ? ' is-critical' : value >= 70 ? ' is-hot' : '';
        const level = Number.isFinite(value) ? Math.max(3, Math.min(100, value)) : 0;
        const display = toDisplayTemperature(value);
        const shown = display === null ? '—' : `${display.toFixed(1)}${tempUnit}`;
        return `<div class="temp-row${tone}"><span class="temp-name">${esc(item.name || '设备')}</span><span class="temp-level"><i style="width:${level}%"></i></span><b>${shown}</b></div>`;
      }).join('');
    }
    $('#tempMax').textContent = Number.isFinite(maxTemp) ? Math.round(toDisplayTemperature(maxTemp)) : '—';
    $('#tempHeat').style.width = `${Number.isFinite(maxTemp) ? Math.max(0, Math.min(100, maxTemp)) : 0}%`;
    hero.classList.toggle('is-hot', Number.isFinite(maxTemp) && maxTemp >= 70);
    hero.classList.toggle('is-critical', Number.isFinite(maxTemp) && maxTemp >= 85);
  }

  function renderSessions(sessions, error) {
    const list = Array.isArray(sessions) ? sessions : [];
    const counts = { running: 0, question: 0, error: 0, done: 0 };
    for (const session of list) if (counts[session.status] !== undefined) counts[session.status] += 1;
    $('#runningCount').textContent = counts.running;
    $('#questionCount').textContent = counts.question;
    $('#errorCount').textContent = counts.error;
    $('#doneCount').textContent = counts.done;
    $('#questionCount').parentElement.classList.toggle('is-question', counts.question > 0);
    $('#errorCount').parentElement.classList.toggle('is-error', counts.error > 0);
    const badge = $('#sessionsBadge');
    badge.hidden = counts.question + counts.error === 0;
    badge.classList.toggle('is-error', counts.error > 0);
    $('#sessionSubtitle').textContent = list.length ? `${list.length} 个活动会话` : '暂无活动会话';

    if (error) {
      $('#sessionList').innerHTML = `<div class="empty-state">${icon('layers')}<h3>会话读取失败</h3><p>${esc(error)}</p></div>`;
      return;
    }
    if (list.length === 0) {
      $('#sessionList').innerHTML = `<div class="empty-state">${icon('layers')}<h3>暂无会话</h3><p>在 DSH 中开始一个会话后会出现在这里。</p></div>`;
      return;
    }
    const labels = { running: '运行中', question: '等待回答', error: '错误', done: '已结束' };
    $('#sessionList').innerHTML = list.map((session) => {
      const status = ['running', 'question', 'error', 'done'].includes(session.status) ? session.status : 'done';
      const preview = session.error || session.pending?.question || session.preview || session.cwd || '暂无消息';
      const meta = [session.cwd, session.turn ? `第 ${session.turn} 轮` : '', session.isSubagent ? '子任务' : ''].filter(Boolean);
      return `<article class="session-card is-${status}">
        <div class="session-icon">${esc(Array.from(session.title || '新')[0] || '新')}</div>
        <div class="session-main">
          <h3 class="session-title">${esc(session.title || '新会话')}</h3>
          <p class="session-preview">${esc(preview)}</p>
          <div class="session-meta">${meta.map((item) => `<span>${esc(item)}</span>`).join('')}</div>
        </div>
        <div class="session-side">
          <span class="status-badge is-${status}"><i></i>${labels[status]}</span>
          <span class="session-time">${timeAgo(session.lastActiveAt)}</span>
        </div>
      </article>`;
    }).join('');
  }

  function renderOverview(overview) {
    if (!overview) return;
    state.overview = overview;
    if (overview.settings) applySettings(overview.settings);
    renderWeather(overview.weather);
    renderNotifications(overview.notifications);
    renderAccount(overview.account);
    renderSessions(overview.sessions, overview.sessionsError);
    if (overview.performance) renderPerformance(overview.performance);
    syncClones();
  }

  function updateMediaProgress() {
    const media = state.media?.media?.media;
    if (!media || state.seekDragging) return;
    const held = Date.now() < state.seekHoldUntil;
    if (held && state.seekTarget > 0) {
      const max = Math.max(1, Number($('#seek').max) || 1);
      $('#seek').value = String(state.seekTarget);
      $('#seek').style.setProperty('--p', `${(state.seekTarget / max) * 100}%`);
      $('#elapsed').textContent = formatDuration(state.seekTarget);
      return;
    }
    const duration = Math.max(0, Number(media.endTime) - Number(media.startTime || 0));
    let position = Number(media.position) || 0;
    if (String(media.playbackStatus).toLowerCase() === 'playing') position += (Date.now() - state.mediaReceivedAt) / 1000;
    position = duration > 0 ? Math.min(duration, Math.max(0, position)) : Math.max(0, position);
    const seek = $('#seek');
    if (duration > 0) {
      seek.value = String(position);
      seek.style.setProperty('--p', `${(position / duration) * 100}%`);
    } else {
      seek.style.setProperty('--p', '0%');
    }
    $('#elapsed').textContent = formatDuration(position);
    $('#duration').textContent = formatDuration(duration);
  }

  function renderVolume(volume) {
    if (!volume || state.volumeDragging) return;
    if (Date.now() < state.volumeHoldUntil) {
      const held = Math.max(0, Math.min(1, state.volumeTarget));
      $('#volume').value = String(held);
      $('#volume').style.setProperty('--p', `${held * 100}%`);
      $('#volumeLabel').textContent = `${Math.round(held * 100)}%`;
      return;
    }
    const value = Math.max(0, Math.min(1, Number(volume.volume ?? 0.5)));
    $('#volume').value = String(value);
    $('#volume').style.setProperty('--p', `${value * 100}%`);
    $('#volumeLabel').textContent = `${Math.round(value * 100)}%`;
    $('#muteButton').innerHTML = icon(volume.muted ? 'volume-off' : 'volume');
  }

  function renderMedia(payload) {
    state.media = payload;
    state.mediaReceivedAt = Date.now();
    const media = payload?.media?.media || null;
    const shell = $('#coverShell');
    const backdrop = $('#musicBackdrop');
    if (!media) {
      shell.classList.remove('has-art');
      shell.classList.remove('has-media');
      $('#coverFallbackText').textContent = '没有正在播放的媒体';
      $('#albumArt').removeAttribute('src');
      backdrop.style.backgroundImage = '';
      $('#trackTitle').textContent = '未在播放';
      $('#trackArtist').textContent = payload?.media?.error || '在电脑上打开播放器后，这里会显示当前媒体。';
      $('#trackAlbum').textContent = 'NOW PLAYING';
      $('#musicSource').textContent = '媒体';
      $('#playButton').innerHTML = icon('play');
      $('#seek').disabled = true;
      $('#seek').title = '播放进度';
      $('#previousButton').disabled = true;
      $('#nextButton').disabled = true;
      $('#elapsed').textContent = '0:00';
      $('#duration').textContent = '0:00';
      $('#seek').value = '0';
      $('#seek').style.setProperty('--p', '0%');
      $('#musicNote').textContent = '音量控制作用于系统输出';
      $('#likeButton').hidden = true;
      renderVolume(payload?.volume);
      return;
    }
    const isPlaying = String(media.playbackStatus).toLowerCase() === 'playing';
    const seekable = Boolean(media.canSeek) && media.positionReported === true;
    const likeButton = $('#likeButton');
    likeButton.hidden = !media.canLike;
    likeButton.classList.toggle('is-liked', media.liked === true);
    likeButton.innerHTML = `${icon(media.liked === true ? 'heart-filled' : 'heart')}<span>${media.liked === true ? '已喜欢' : '喜欢'}</span>`;
    likeButton.title = media.likeWritable ? '设置红心' : '网易云未开启本地控制接口，无法修改红心';
    shell.classList.add('has-media');
    $('#coverFallbackText').textContent = '正在播放';
    $('#seek').disabled = !seekable || Number(media.endTime) <= 0;
    $('#seek').title = seekable ? '播放进度' : '当前播放器仅上报进度，不支持拖动';
    $('#previousButton').disabled = !media.canPrevious;
    $('#nextButton').disabled = !media.canNext;
    $('#playButton').innerHTML = icon(isPlaying ? 'pause' : 'play');
    $('#playButton').setAttribute('aria-label', isPlaying ? '暂停' : '播放');
    $('#trackTitle').textContent = media.title || '未命名媒体';
    $('#trackArtist').textContent = media.artist || media.albumArtist || '未知艺术家';
    $('#trackAlbum').textContent = media.album ? media.album.toUpperCase() : 'NOW PLAYING';
    $('#musicSource').textContent = sourceLabel(media.appId);
    $('#musicNote').textContent = seekable
      ? '音量控制作用于系统输出'
      : '仅显示播放进度，不支持拖动 · 音量可调';
    if (media.thumbnail) {
      $('#albumArt').src = media.thumbnail;
      shell.classList.add('has-art');
      backdrop.style.backgroundImage = `url("${media.thumbnail.replace(/"/g, '\\"')}")`;
    } else {
      shell.classList.remove('has-art');
      $('#albumArt').removeAttribute('src');
      backdrop.style.backgroundImage = '';
    }
    $('#seek').max = String(Math.max(1, Number(media.endTime) || 0));
    updateMediaProgress();
    renderVolume(payload?.volume);
  }

  function renderMediaError(error) {
    toast(error);
  }

  function handleMessage(message) {
    switch (message?.type) {
      case 'welcome':
        setConnected(true);
        applySettings(message.settings);
        break;
      case 'overview':
        setConnected(true);
        renderOverview(message.data);
        break;
      case 'weather':
        if (state.overview) state.overview.weather = message.data;
        renderWeather(message.data);
        break;
      case 'notifications':
        if (state.overview) state.overview.notifications = message.data;
        renderNotifications(message.data);
        break;
      case 'sessions':
        if (state.overview) state.overview.sessions = message.data;
        renderSessions(message.data);
        break;
      case 'account':
        if (state.overview) state.overview.account = message.data;
        renderAccount(message.data);
        break;
      case 'media':
        setConnected(true);
        renderMedia(message.data);
        break;
      case 'performance':
        if (state.overview) state.overview.performance = message.data;
        renderPerformance(message.data);
        break;
      case 'settings':
        applySettings(message.data);
        syncClones();
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
    if (message?.type !== 'settings' && message?.type !== 'welcome') syncClones();
  }

  function connect() {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let socket;
    try {
      socket = new WebSocket(`${scheme}//${location.host}/ws`);
    } catch {
      scheduleReconnect();
      return;
    }
    state.ws = socket;
    socket.addEventListener('open', () => {
      setConnected(true);
      socket.send(JSON.stringify({ type: 'settings' }));
    });
    socket.addEventListener('message', (event) => {
      try {
        handleMessage(JSON.parse(event.data));
      } catch {
        /* ignore malformed frames */
      }
    });
    socket.addEventListener('close', () => {
      state.ws = null;
      setConnected(false);
      scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      try { socket.close(); } catch { /* ignore */ }
    });
  }

  function scheduleReconnect() {
    if (state.reconnectTimer) return;
    const delay = state.reconnectDelay;
    state.reconnectDelay = Math.min(8000, Math.round(delay * 1.6));
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      connect();
    }, delay);
  }

  function restoreUrl() {
    if (location.search.includes('token=') || location.search.includes('page=')) {
      try { history.replaceState({}, '', location.pathname); } catch { /* ignore */ }
    }
  }

  function isFullscreen() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function updateFullscreenButton() {
    const button = $('#fullscreenButton');
    if (!button) return;
    button.innerHTML = icon(isFullscreen() ? 'compress' : 'expand');
    button.title = isFullscreen() ? '退出全屏' : '进入全屏';
    button.setAttribute('aria-label', button.title);
  }

  async function toggleFullscreen() {
    try {
      if (isFullscreen()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else {
        const root = document.documentElement;
        if (root.requestFullscreen) await root.requestFullscreen();
        else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
        else toast('当前浏览器不支持全屏');
      }
    } catch {
      toast('当前浏览器不允许全屏');
    }
    setTimeout(updateFullscreenButton, 120);
  }

  function bind() {
    for (const button of $$('.rail-button')) {
      button.addEventListener('click', () => goTo(button.dataset.key));
    }
    $('#playButton').addEventListener('click', () => send({ type: 'action', action: 'playpause' }));
    $('#fullscreenButton').addEventListener('click', () => void toggleFullscreen());
    document.addEventListener('fullscreenchange', updateFullscreenButton);
    document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
    $('#previousButton').addEventListener('click', () => send({ type: 'action', action: 'previous' }));
    $('#nextButton').addEventListener('click', () => send({ type: 'action', action: 'next' }));
    $('#muteButton').addEventListener('click', () => send({ type: 'action', action: 'mute' }));
    $('#likeButton').addEventListener('click', () => {
      const media = state.media?.media?.media;
      if (!media) return;
      if (!media.likeWritable) {
        toast('网易云未开启本地控制接口，暂不能修改红心');
        return;
      }
      send({ type: 'action', action: 'like', value: media.liked !== true });
    });

    $('#seek').addEventListener('pointerdown', () => { state.seekDragging = true; });
    $('#seek').addEventListener('input', () => {
      state.seekDragging = true;
      const value = Number($('#seek').value) || 0;
      const max = Math.max(1, Number($('#seek').max) || 1);
      $('#seek').style.setProperty('--p', `${(value / max) * 100}%`);
      $('#elapsed').textContent = formatDuration(value);
    });
    $('#seek').addEventListener('change', () => {
      const value = Number($('#seek').value) || 0;
      state.seekDragging = false;
      state.seekTarget = value;
      state.seekHoldUntil = Date.now() + 2600;
      $('#elapsed').textContent = formatDuration(value);
      send({ type: 'action', action: 'seek', value });
    });
    $('#seek').addEventListener('pointerup', () => setTimeout(() => { state.seekDragging = false; updateMediaProgress(); }, 220));

    $('#volume').addEventListener('pointerdown', () => { state.volumeDragging = true; });
    $('#volume').addEventListener('input', () => {
      state.volumeDragging = true;
      const value = Number($('#volume').value) || 0;
      $('#volume').style.setProperty('--p', `${value * 100}%`);
      $('#volumeLabel').textContent = `${Math.round(value * 100)}%`;
    });
    $('#volume').addEventListener('change', () => {
      const value = Number($('#volume').value) || 0;
      state.volumeDragging = false;
      state.volumeTarget = value;
      state.volumeHoldUntil = Date.now() + 2200;
      send({ type: 'action', action: 'volume', value });
    });

    let frame = 0;
    $('#pager').addEventListener('scroll', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (Date.now() < state.suppressScrollUntil) return;
        const pager = $('#pager');
        const count = state.order.length;
        const raw = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
        let key = null;
        let jumpTo = null;
        if (count < 2) {
          key = state.order[0];
        } else if (raw <= 0) {
          key = state.order[count - 1];
          jumpTo = count;
        } else if (raw >= count + 1) {
          key = state.order[0];
          jumpTo = 1;
        } else {
          key = state.order[raw - 1];
        }
        if (key && key !== state.activeKey) {
          state.activeKey = key;
          state.hasNavigated = true;
          updateRail(key);
        }
        if (jumpTo !== null && !state.jumpTimer) {
          state.jumpTimer = setTimeout(() => {
            state.jumpTimer = null;
            const currentRaw = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
            const stillAtEdge = jumpTo === count ? currentRaw <= 0 : currentRaw >= count + 1;
            if (!stillAtEdge) return;
            pager.style.scrollSnapType = 'none';
            state.suppressScrollUntil = Date.now() + 220;
            pager.scrollLeft = jumpTo * pager.clientWidth;
            requestAnimationFrame(() => requestAnimationFrame(() => {
              pager.style.scrollSnapType = '';
            }));
          }, 150);
        } else if (jumpTo !== null && state.jumpTimer) {
          clearTimeout(state.jumpTimer);
          state.jumpTimer = setTimeout(() => {
            state.jumpTimer = null;
            const currentRaw = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
            const stillAtEdge = jumpTo === count ? currentRaw <= 0 : currentRaw >= count + 1;
            if (!stillAtEdge) return;
            pager.style.scrollSnapType = 'none';
            state.suppressScrollUntil = Date.now() + 220;
            pager.scrollLeft = jumpTo * pager.clientWidth;
            requestAnimationFrame(() => requestAnimationFrame(() => {
              pager.style.scrollSnapType = '';
            }));
          }, 150);
        } else if (jumpTo === null && state.jumpTimer) {
          clearTimeout(state.jumpTimer);
          state.jumpTimer = null;
        }
      });
    });

    window.addEventListener('resize', () => {
      const pager = $('#pager');
      state.suppressScrollUntil = Date.now() + 160;
      pager.scrollLeft = (state.order.indexOf(state.activeKey) + pageOffset()) * pager.clientWidth;
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) connect();
        else send({ type: 'refresh' });
      }
    });
  }

  function init() {
    setIcons();
    bind();
    updateFullscreenButton();
    formatClock();
    setInterval(formatClock, 1000);
    setInterval(updateMediaProgress, 900);
    const params = new URLSearchParams(location.search);
    const page = params.get('page');
    if (DEFAULT_ORDER.includes(page)) state.initialKey = page;
    applyTheme('dark');
    connect();
    restoreUrl();
    window.__DSH_REMOTE__ = state;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
