/** Browser half: sidebar launcher and the native-style remote-console settings page. */
window.__ModuleLoader__.load({
  id: 'dsh-remote-control',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useState, useCallback, useRef } = React;

    const NS = 'dsh-remote-control';
    const PANEL_ID = 'remote-control';
    const SETTINGS_URL = '/dsh-remote-control/api/settings';
    const THEME_URL = '/dsh-remote-control/api/theme';
    const TOKEN_URL = '/dsh-remote-control/api/token/rotate';
    const DISCONNECT_URL = '/dsh-remote-control/api/disconnect';

    const PAGE_LABELS = { home: '首页', sessions: '会话', music: '音乐' };
    const PAGE_ORDER = ['home', 'sessions', 'music', 'performance'];
    const normalizePageOrder = (input) => {
      const keys = Array.isArray(input) ? input.filter((key) => PAGE_ORDER.includes(key)) : [];
      const order = [...new Set(keys)];
      for (const key of PAGE_ORDER) if (!order.includes(key)) order.push(key);
      return order.slice(0, PAGE_ORDER.length);
    };

    const CSS = `
      .drc-page {
        height: 100%;
        max-height: none;
        min-height: 0;
        display: flex;
        flex-direction: column;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-base);
        overflow: hidden;
      }
      .drc-head {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding: 18px 26px 14px;
      }
      .drc-kicker {
        display: none;
      }
      .drc-head h1 {
        margin: 0 0 2px;
        font-size: 21px;
        line-height: 1.12;
        letter-spacing: -.025em;
        font-weight: 620;
      }
      .drc-head p {
        margin: 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 11.5px;
        line-height: 1.5;
      }
      .drc-head-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
      .drc-body {
        flex: 1 1 auto;
        min-height: 0;
        display: grid;
        grid-template-columns: 216px minmax(0, 1fr);
        border-top: 1px solid var(--dsw-alias-border-l1);
        overflow: hidden;
      }
      .drc-menu {
        min-height: 0;
        overflow-y: auto;
        padding: 12px 10px 20px;
        border-right: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-1);
      }
      .drc-menu-group { margin-bottom: 12px; }
      .drc-menu-parent {
        display: block;
        padding: 8px 10px 5px;
        color: var(--dsw-alias-label-secondary);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .1em;
        text-transform: uppercase;
      }
      .drc-menu-item {
        width: 100%;
        min-height: 38px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 10px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font-size: 12px;
        text-align: left;
        cursor: pointer;
      }
      .drc-menu-item svg { width: 16px; height: 16px; flex: 0 0 auto; color: var(--dsw-alias-label-secondary); }
      .drc-menu-item:hover { background: var(--dsw-alias-bg-layer-2); }
      .drc-menu-item.is-active {
        background: var(--dsw-alias-bg-layer-2);
        box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary);
        font-weight: 620;
      }
      .drc-menu-item.is-active svg { color: var(--dsw-alias-brand-primary); }
      .drc-main {
        min-height: 0;
        overflow-y: auto;
        padding: 20px 26px 44px;
        scrollbar-width: thin;
      }
      .drc-main::-webkit-scrollbar { width: 8px; }
      .drc-main::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l2); border-radius: 999px; }
      .drc-section { max-width: 760px; }
      .drc-section h2 { margin: 0; font-size: 18px; letter-spacing: -.02em; font-weight: 620; }
      .drc-desc { margin: 5px 0 14px; color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.6; }
      .drc-card {
        margin-top: 12px;
        padding: 16px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 14px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .drc-card + .drc-card { margin-top: 10px; }
      .drc-card h3 { margin: 0 0 4px; font-size: 13px; font-weight: 600; }
      .drc-muted { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.55; }
      .drc-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 10px 0;
        border-top: 1px solid var(--dsw-alias-border-l1);
      }
      .drc-row:first-of-type { border-top: 0; padding-top: 2px; }
      .drc-row-title { font-size: 12px; font-weight: 600; }
      .drc-row-desc { margin-top: 3px; color: var(--dsw-alias-label-secondary); font-size: 10.5px; line-height: 1.5; }
      .drc-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .drc-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        min-height: 34px;
        padding: 0 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 9px;
        background: transparent;
        color: var(--dsw-alias-label-primary);
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
      }
      .drc-btn:hover { background: var(--dsw-alias-bg-layer-2); }
      .drc-btn.is-primary { border-color: transparent; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
      .drc-btn.is-danger { border-color: transparent; background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); color: var(--dsw-alias-state-error-primary); }
      .drc-btn:disabled { opacity: .45; cursor: default; }
      .drc-toggle {
        width: 42px; height: 24px; padding: 0; border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px; background: var(--dsw-alias-bg-layer-2); position: relative; cursor: pointer; flex: 0 0 auto;
      }
      .drc-toggle i {
        position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
        background: var(--dsw-alias-label-secondary); transition: left .16s ease, background .16s ease;
      }
      .drc-toggle.is-on { border-color: transparent; background: var(--dsw-alias-brand-primary); }
      .drc-toggle.is-on i { left: 21px; background: var(--dsw-alias-bg-base); }
      .drc-seg { display: inline-flex; width: auto; max-width: 100%; flex-wrap: wrap; gap: 4px; padding: 4px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); }
      .drc-seg button {
        min-height: 31px; padding: 0 10px; border: 0; border-radius: 7px; background: transparent;
        color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 550; cursor: pointer;
      }
      .drc-seg button.is-active { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); font-weight: 650; }
      .drc-fields { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
      .drc-field { display: flex; flex-direction: column; gap: 5px; flex: 1 1 190px; min-width: 0; }
      .drc-field span { color: var(--dsw-alias-label-secondary); font-size: 10px; }
      .drc-field input {
        width: 100%; height: 36px; padding: 0 10px; box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
        background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
        outline: none; font-size: 11.5px;
      }
      .drc-field input:focus { border-color: var(--dsw-alias-brand-primary); }
      .drc-list { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
      .drc-list-row {
        display: flex; align-items: center; gap: 9px; padding: 7px 9px;
        border-radius: 8px; background: var(--dsw-alias-bg-layer-2); font-size: 11.5px;
      }
      .drc-list-row label { display: flex; align-items: center; gap: 9px; flex: 1; cursor: pointer; }
      .drc-code { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 9.5px; }
      .drc-qr {
        display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
      }
      .drc-qr-frame {
        width: 164px; height: 164px; flex: 0 0 auto; padding: 7px; box-sizing: border-box;
        border-radius: 12px; background: #fff; display: grid; place-items: center;
        box-shadow: 0 8px 24px rgba(0,0,0,.14);
      }
      .drc-qr-frame img { width: 150px; height: 150px; display: block; image-rendering: pixelated; }
      .drc-qr-copy { min-width: 220px; flex: 1 1 280px; }
      .drc-url {
        display: block; margin-top: 10px; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px; color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.45;
        word-break: break-all; overflow-wrap: anywhere; white-space: pre-wrap; max-height: 62px; overflow: hidden;
      }
      .drc-apps { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .drc-app {
        display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 10px;
        border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
        background: transparent; color: var(--dsw-alias-label-secondary); font-size: 10.5px; cursor: pointer;
      }
      .drc-app.is-on { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent); }
      .drc-app i { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-secondary); }
      .drc-app.is-on i { background: var(--dsw-alias-brand-primary); }
      .drc-order-row { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); font-size: 11.5px; cursor: grab; transition: opacity .15s ease, border-color .15s ease; touch-action: none; }
      .drc-order-row.is-dragging { position: absolute; width: 0; height: 0; min-height: 0; margin: 0; padding: 0; border: 0; opacity: 0; visibility: hidden; overflow: hidden; pointer-events: none; transition: none; }
      .drc-order-row b { width: 18px; color: var(--dsw-alias-label-secondary); font-family: ui-monospace, monospace; font-size: 10px; font-weight: 500; }
      .drc-order-row .drc-order-label { flex: 1; }
      .drc-drag-handle { color: var(--dsw-alias-label-secondary); font-size: 12px; letter-spacing: -2px; cursor: grab; }
      .drc-order-placeholder { height: 37px; display: flex; align-items: center; gap: 8px; padding: 0 10px; border: 1px dashed var(--dsw-alias-brand-primary, #4d6bff); border-radius: 8px; background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bff) 9%, transparent); pointer-events: none; }
      .drc-order-placeholder-title { color: var(--dsw-alias-brand-primary, #4d6bff); font-size: 11.5px; font-weight: 600; }
      .drc-order-placeholder .drc-drag-handle { color: var(--dsw-alias-brand-primary, #4d6bff); cursor: grabbing; }
      body.drc-sorting,
      body.drc-sorting * { user-select: none !important; cursor: grabbing !important; }
      .drc-order-end { height: 14px; }
      .drc-status-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 11.5px; }
      .drc-status-row:first-child { border-top: 0; }
      .drc-status { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 10.5px; }
      .drc-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
      .drc-dot.ok { background: var(--dsw-alias-state-success-primary); }
      .drc-dot.bad { background: var(--dsw-alias-state-error-primary); }
      .drc-client { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 10px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
      .drc-client strong { display: block; font-size: 11.5px; font-weight: 620; }
      .drc-client small { display: block; margin-top: 2px; color: var(--dsw-alias-label-secondary); font-size: 9.5px; font-family: ui-monospace, monospace; }
      .drc-banner { margin: 0 26px 8px; padding: 9px 11px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; font-size: 11px; }
      .drc-banner.is-error { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent); }
      .drc-banner.is-ok { color: var(--dsw-alias-state-success-primary); }
      .drc-facts { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 8px; color: var(--dsw-alias-label-secondary); font-size: 10.5px; }
      @media (max-width: 760px) {
        .drc-body { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
        .drc-menu { display: flex; gap: 14px; overflow-x: auto; overflow-y: hidden; border-right: 0; border-bottom: 1px solid var(--dsw-alias-border-l1); padding: 8px 10px; }
        .drc-menu-group { margin-bottom: 0; display: flex; align-items: center; gap: 4px; }
        .drc-menu-parent { padding: 0 6px; white-space: nowrap; }
        .drc-menu-item { width: auto; white-space: nowrap; }
        .drc-head { padding: 16px 18px 10px; }
        .drc-main { padding: 16px 18px 36px; }
      }
    `;

    const zh = {
      title: '远程控制台', kicker: 'REMOTE CONSOLE', heading: '远程控制台',
      subtitle: '手机控制台的连接、显示与数据偏好。', running: '运行中', stopped: '未运行',
      refresh: '刷新', save: '保存', saved: '已保存', error: '操作失败', loading: '正在读取设置…',
      pairing: '扫码连接', pairingHint: '手机与电脑连接同一个局域网，扫描二维码即可打开。',
      open: '在电脑上打开', copy: '复制链接', copied: '已复制', connection: '连接',
      menuPlugin: '插件设置', menuNetwork: '开放网卡', menuAccess: '访问验证', menuTheme: '主题与页面', menuTls: 'HTTPS 证书',
      menuWeather: '天气设置', menuBalance: '余额显示', menuNotifications: '通知设置', menuSystem: '系统信息',
      menuStatus: '服务状态', menuClients: '已连接设备', menuDiagnostics: '诊断信息',
      network: '开放网卡', networkHint: '只有勾选网卡所在网段的设备可以访问控制台。',
      pluginHint: '手机端的访问方式、温度单位、主题、页面顺序与 HTTPS 证书；修改后点击保存设置生效。',
      access: '访问验证', accessHint: '开启后，手机首次打开需要扫描带验证令牌的链接。',
      token: '链接验证', rotate: '立即刷新验证令牌', rotateHint: '刷新后已连接设备会断开，需要重新扫码。',
      theme: '主题与页面', themeHint: '选择手机控制台跟随 DSH 主题，或固定亮暗模式。',
      temperatureUnit: '温度单位', temperatureUnitHint: '手机端天气和性能页使用的温度显示单位。', celsius: '摄氏度 (°C)', fahrenheit: '华氏度 (°F)',
      followDsh: '跟随 DSH', light: '浅色', dark: '深色',
      pageOrder: '页面顺序', pageOrderHint: '拖拽调整手机端四个页面的左右顺序；关闭的页面不会在后台轮询。',
      tls: 'HTTPS 证书', tlsHint: '可选。填写 PEM 证书和私钥路径后启用 HTTPS；保存后连接会短暂中断。',
      certPath: '证书路径', keyPath: '私钥路径', saveTls: '保存证书配置',
      tlsOn: 'HTTPS 已启用', tlsOff: 'HTTPS 未启用', tlsError: '证书配置有误，当前仍使用 HTTP',
      weather: '天气设置', weatherHint: '自动定位优先使用本机位置；也可以固定一个城市。',
      forecastDisplay: '天气卡片显示', hourly: '小时天气', daily: '7 天天气',
      saveSettings: '保存设置', pagePerformance: '性能',
      auto: '本机位置', manual: '手动位置', locationName: '位置名称', latitude: '纬度', longitude: '经度', saveLocation: '保存位置',
      balance: '余额显示', balanceHint: '控制手机端 7 天消耗的计算方式和低余额提醒。',
      calendar: '本周（日历）', rolling: '最近 7 天（滚动）', lowThreshold: '低余额提醒线',
      lowThresholdHint: '低于这个金额时，手机端余额会显示为红色。留空关闭提醒。', saveThreshold: '保存提醒线',
      notifications: '通知设置', notificationsHint: '本地缓存出现过的通知应用；未勾选的应用不会显示在手机端。',
      allApps: '全部显示', limit: '显示数量', noApps: '还没有记录到通知应用。',
      status: '服务状态', statusHint: '当前系统服务能力。', clients: '已连接设备', clientsHint: '正在访问控制台的手机或浏览器。', noClients: '当前没有已连接设备。', disconnect: '断开',
      diagnostics: '诊断信息', systemName: '系统', version: '版本', protocol: '连接方式', clientCount: '设备数量',
      notificationsStatus: '通知', mediaStatus: '媒体', volumeStatus: '音量', weatherStatus: '天气',
      healthy: '正常', unavailable: '不可用', checking: '待检测',
      pageHome: '首页', pageSessions: '会话', pageMusic: '音乐', moveUp: '上移', moveDown: '下移',
      noWebServer: '当前部署没有可用的 webServer。', serviceRunning: '服务运行中', serviceStopped: '服务未运行',
    };
    const en = { ...zh, title: 'Remote control', heading: 'Remote control', subtitle: 'Connection, display, and data preferences for the phone console.', running: 'Running', stopped: 'Stopped', refresh: 'Refresh', save: 'Save', saved: 'Saved', error: 'Action failed', loading: 'Reading settings…', pairing: 'Scan to connect', pairingHint: 'Connect the phone to the same LAN and scan the QR code.', open: 'Open on this computer', copy: 'Copy link', copied: 'Copied', connection: 'Connection', menuPlugin: 'Plugin settings', menuNetwork: 'Open interfaces', menuAccess: 'Access verification', menuTheme: 'Theme & pages', menuTls: 'HTTPS certificate', menuWeather: 'Weather', menuBalance: 'Balance display', menuNotifications: 'Notifications', menuSystem: 'System information', menuStatus: 'Service status', menuClients: 'Connected devices', menuDiagnostics: 'Diagnostics', network: 'Open network interfaces', networkHint: 'Only devices on the checked interface subnets can access the console.', pluginHint: 'Access, temperature unit, theme, page order, and HTTPS for the phone console; changes apply after Save.', access: 'Access verification', accessHint: 'When enabled, the first open requires a link with a verification token.', token: 'Link verification', rotate: 'Rotate verification token', rotateHint: 'Rotating disconnects existing devices; scan again to reconnect.', theme: 'Theme & pages', themeHint: 'Follow DSH, or force light or dark mode on the phone console.', temperatureUnit: 'Temperature unit', temperatureUnitHint: 'Temperature unit used by the phone weather and performance pages.', celsius: 'Celsius (°C)', fahrenheit: 'Fahrenheit (°F)', followDsh: 'Follow DSH', light: 'Light', dark: 'Dark', pageOrder: 'Page order', pageOrderHint: 'Drag to reorder the four phone pages; disabled pages stop polling.', tls: 'HTTPS certificate', tlsHint: 'Optional. Provide PEM certificate and key paths, then enable HTTPS. Saving briefly drops connections.', certPath: 'Certificate path', keyPath: 'Private key path', saveTls: 'Save certificate', tlsOn: 'HTTPS enabled', tlsOff: 'HTTPS disabled', tlsError: 'Certificate error; still serving HTTP', weather: 'Weather', weatherHint: 'Automatic uses this computer location; or pin a city.', auto: 'This computer', manual: 'Manual', locationName: 'Location name', latitude: 'Latitude', longitude: 'Longitude', saveLocation: 'Save location', balance: 'Balance display', balanceHint: 'Choose the 7-day spend mode and the low-balance warning.', calendar: 'This week (calendar)', rolling: 'Last 7 days (rolling)', lowThreshold: 'Low-balance warning', lowThresholdHint: 'Show the phone balance in red below this amount. Leave empty to disable.', saveThreshold: 'Save warning', notifications: 'Notifications', notificationsHint: 'Seen apps are cached locally. Unchecked apps are hidden on the phone.', allApps: 'Show all', limit: 'Visible count', noApps: 'No notification apps recorded yet.', status: 'Service status', statusHint: 'Current system service capabilities.', clients: 'Connected devices', clientsHint: 'Phones or browsers currently using the console.', noClients: 'No device is connected.', disconnect: 'Disconnect', diagnostics: 'Diagnostics', systemName: 'System', version: 'Version', protocol: 'Transport', clientCount: 'Devices', notificationsStatus: 'Notifications', mediaStatus: 'Media', volumeStatus: 'Volume', weatherStatus: 'Weather', healthy: 'Healthy', unavailable: 'Unavailable', checking: 'Not checked', pageHome: 'Home', pageSessions: 'Sessions', pageMusic: 'Music', moveUp: 'Move up', moveDown: 'Move down', noWebServer: 'This deployment has no webServer.', serviceRunning: 'Service running', serviceStopped: 'Service stopped', forecastDisplay: 'Weather card', hourly: 'Hourly', daily: '7 days', saveSettings: 'Save settings', pagePerformance: 'Performance' };

    const C = {
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      border: 'var(--dsw-alias-border-l1)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      accent: 'var(--dsw-alias-brand-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
    };

    function PanelIcon({ size = 20, active = false }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, style: { display: 'block', color: active ? C.accent : 'currentColor' } },
        h('rect', { x: 4.2, y: 2.8, width: 15.6, height: 18.4, rx: 4, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('path', { d: 'M9.3 18.1h5.4', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
        h('circle', { cx: 12, cy: 10.5, r: 3.5, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('path', { d: 'M2.6 8.2c-1 1.1-1.5 2.3-1.5 3.6 0 1.4.5 2.6 1.5 3.7M21.4 8.2c1 1.1 1.5 2.3 1.5 3.6 0 1.4-.5 2.6-1.5 3.7', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', opacity: 0.7 }),
      );
    }

    const MENU_ICONS = {
      link: '<path d="M9.5 14.5 14.5 9.5M7.1 16.9a3.5 3.5 0 0 1 0-5l2.1-2.1M16.9 7.1a3.5 3.5 0 0 1 0 5l-2.1 2.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
      sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="16" cy="7" r="2.4" stroke="currentColor" stroke-width="1.7"/><circle cx="8" cy="17" r="2.4" stroke="currentColor" stroke-width="1.7"/>',
      cloud: '<path d="M6.5 18h10.2a4.3 4.3 0 0 0 .7-8.5A5.5 5.5 0 0 0 7 8.6 4.7 4.7 0 0 0 6.5 18Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
      wallet: '<rect x="3.5" y="6" width="17" height="13" rx="3" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 10h17M16 14.5h2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
      bell: '<path d="M6 10a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6ZM10 20h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
      info: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v6M12 7.2v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    };

    function MenuIcon({ name }) {
      return h('svg', { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, dangerouslySetInnerHTML: { __html: MENU_ICONS[name] || MENU_ICONS.info } });
    }

    function Toggle({ checked, onChange, label }) {
      return h('button', { type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, className: `drc-toggle${checked ? ' is-on' : ''}`, onClick: () => onChange(!checked) }, h('i'));
    }

    function Seg({ options, value, onChange }) {
      return h('div', { className: 'drc-seg' }, options.map((option) => h('button', { key: option.value, type: 'button', className: value === option.value ? 'is-active' : '', onClick: () => onChange(option.value) }, option.label)));
    }

    function Btn({ children, onClick, primary = false, danger = false, disabled = false }) {
      return h('button', { type: 'button', className: `drc-btn${primary ? ' is-primary' : ''}${danger ? ' is-danger' : ''}`, onClick, disabled }, children);
    }

    function Field({ label, value, onChange, placeholder, inputMode }) {
      return h('label', { className: 'drc-field' }, h('span', null, label), h('input', { value: value ?? '', placeholder, inputMode, onChange: (event) => onChange(event.target.value) }));
    }

    function Row({ title, description, children }) {
      return h('div', { className: 'drc-row' },
        h('div', { style: { minWidth: 0 } }, h('div', { className: 'drc-row-title' }, title), description ? h('div', { className: 'drc-row-desc' }, description) : null),
        h('div', { style: { flex: '0 0 auto' } }, children),
      );
    }

    function StatusRow({ label, value }) {
      const state = value === true ? 'ok' : value === false ? 'bad' : '';
      return h('div', { className: 'drc-status-row' }, h('span', null, label), h('span', { className: 'drc-status' }, h('i', { className: `drc-dot ${state}` }), state === 'ok' ? '正常' : state === 'bad' ? '不可用' : '待检测'));
    }

    function duration(ms) {
      const seconds = Math.max(0, Math.floor(ms / 1000));
      if (seconds < 60) return `${seconds} 秒`;
      if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
      return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
    }

    function RemotePanel() {
      const t = (key) => zh[key] ?? en[key] ?? key;
      const [data, setData] = useState(null);
      const [loading, setLoading] = useState(true);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState('');
      const [notice, setNotice] = useState('');
      const [copied, setCopied] = useState(false);
      const [section, setSection] = useState('connection');
      const [draft, setDraft] = useState({ certPath: '', keyPath: '', locationName: '', latitude: '', longitude: '', threshold: '', notificationLimit: '5' });
      const [selectedInterfaces, setSelectedInterfaces] = useState([]);
      const [selectedApps, setSelectedApps] = useState([]);
      const [staged, setStaged] = useState({});
      const [draggingKey, setDraggingKey] = useState(null);
      const [dragIndex, setDragIndex] = useState(null);
      const orderListRef = useRef(null);
      const dragCleanupRef = useRef(null);

      useEffect(() => () => {
        dragCleanupRef.current?.();
        dragCleanupRef.current = null;
      }, []);

      const hydrate = useCallback((payload) => {
        if (!payload?.settings) return;
        setData(payload);
        setStaged({});
        const names = [...new Set((payload.interfaces ?? []).map((entry) => entry.name))];
        setSelectedInterfaces(payload.settings.allowedInterfaces === null ? names : [...payload.settings.allowedInterfaces]);
        const appKeys = (payload.apps ?? []).map((app) => app.key);
        const enabled = payload.settings.notifications?.enabledApps ?? [];
        setSelectedApps(enabled.length ? enabled.filter((key) => appKeys.includes(key)) : appKeys);
        setDraft({
          certPath: payload.settings.tls?.certPath ?? '',
          keyPath: payload.settings.tls?.keyPath ?? '',
          locationName: payload.settings.weather?.name ?? '',
          latitude: payload.settings.weather?.latitude ?? '',
          longitude: payload.settings.weather?.longitude ?? '',
          threshold: payload.settings.balance?.lowThreshold ?? '',
          notificationLimit: String(payload.settings.notifications?.limit ?? 5),
        });
      }, []);

      const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
          const response = await fetch(SETTINGS_URL, { credentials: 'same-origin', cache: 'no-store' });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
          hydrate(payload);
        } catch (err) {
          setError(String(err?.message || err));
        } finally {
          setLoading(false);
        }
      }, [hydrate]);

      const save = useCallback(async (patch) => {
        setBusy(true);
        setError('');
        try {
          const response = await fetch(SETTINGS_URL, {
            method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
          hydrate(payload);
          setNotice(t('saved'));
          setTimeout(() => setNotice(''), 1600);
        } catch (err) {
          setError(String(err?.message || err));
        } finally {
          setBusy(false);
        }
      }, [hydrate, t]);

      const stage = useCallback((patch) => {
        setStaged((current) => {
          const merge = (left, right) => {
            const next = { ...(left || {}) };
            for (const [key, value] of Object.entries(right || {})) {
              if (value && typeof value === 'object' && !Array.isArray(value)) next[key] = merge(next[key], value);
              else next[key] = value;
            }
            return next;
          };
          return merge(current, patch);
        });
      }, []);

      useEffect(() => { void load(); }, [load]);

      const copy = async () => {
        const url = data?.info?.routes?.remote || '';
        if (!url) return;
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          setError(t('error'));
        }
      };

      const rotate = async () => {
        setBusy(true);
        try {
          const response = await fetch(TOKEN_URL, { method: 'POST', credentials: 'same-origin' });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
          hydrate(payload);
          setNotice(t('saved'));
        } catch (err) {
          setError(String(err?.message || err));
        } finally {
          setBusy(false);
        }
      };

      const disconnect = async (id) => {
        try {
          const response = await fetch(DISCONNECT_URL, {
            method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
          setData((current) => (current ? { ...current, clients: payload.clients ?? [] } : current));
        } catch (err) {
          setError(String(err?.message || err));
        }
      };

      const toggleApp = (key) => {
        const all = (data?.apps ?? []).map((app) => app.key);
        const next = new Set(selectedApps);
        if (next.has(key)) next.delete(key); else next.add(key);
        if (next.size === 0) {
          setNotice('至少保留一个通知应用');
          setTimeout(() => setNotice(''), 1600);
          return;
        }
        setSelectedApps([...next]);
      };

      const toggleInterface = (name) => {
        setSelectedInterfaces((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
      };

      if (loading) return h('div', { style: { padding: 32, color: C.muted, fontSize: 12 } }, t('loading'));
      if (!data) return h('div', { style: { padding: 32, maxWidth: 680 } }, h('h1', null, t('heading')), h('p', { style: { color: C.error, fontSize: 12 } }, error || t('noWebServer')), h(Btn, { primary: true, onClick: () => void load() }, t('refresh')));

      const baseSettings = data.settings;
      const settings = {
        ...baseSettings,
        ...staged,
        weather: { ...baseSettings.weather, ...staged.weather },
        balance: { ...baseSettings.balance, ...staged.balance },
        notifications: { ...baseSettings.notifications, ...staged.notifications },
        tls: { ...baseSettings.tls, ...staged.tls },
        pageEnabled: { ...baseSettings.pageEnabled, ...staged.pageEnabled },
      };
      const info = data.info || {};
      const apps = data.apps || [];
      const clients = data.clients || [];
      const order = normalizePageOrder(settings.pageOrder ?? PAGE_ORDER);
      const labels = { home: t('pageHome'), sessions: t('pageSessions'), music: t('pageMusic'), performance: t('pagePerformance') };

      const computeInsertIndex = (clientY) => {
        const list = orderListRef.current;
        if (!list) return 0;
        const rows = [...list.querySelectorAll('.drc-order-row:not(.is-dragging)')];
        for (let index = 0; index < rows.length; index += 1) {
          const rect = rows[index].getBoundingClientRect();
          if (clientY < rect.top + rect.height / 2) return index;
        }
        return rows.length;
      };

      const startOrderDrag = (key, event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (event.target.closest('button, input, a, select, textarea')) return;
        event.preventDefault();
        const pointerId = event.pointerId;
        const startX = event.clientX;
        const startY = event.clientY;
        const originalIndex = order.indexOf(key);
        let started = false;

        const finish = (upEvent) => {
          if (upEvent.pointerId !== pointerId) return;
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', finish);
          window.removeEventListener('pointercancel', finish);
          document.body.classList.remove('drc-sorting');
          dragCleanupRef.current = null;
          if (!started || upEvent.type === 'pointercancel') {
            setDraggingKey(null);
            setDragIndex(null);
            return;
          }
          const remaining = order.filter((item) => item !== key);
          const insertAt = Math.max(0, Math.min(computeInsertIndex(upEvent.clientY), remaining.length));
          const next = [...remaining.slice(0, insertAt), key, ...remaining.slice(insertAt)];
          if (next.join('|') !== order.join('|')) stage({ pageOrder: next });
          setDraggingKey(null);
          setDragIndex(null);
        };

        const onMove = (moveEvent) => {
          if (moveEvent.pointerId !== pointerId) return;
          if (!started) {
            if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
            started = true;
            setDraggingKey(key);
            setDragIndex(originalIndex);
            document.body.classList.add('drc-sorting');
          }
          moveEvent.preventDefault();
          const next = computeInsertIndex(moveEvent.clientY);
          setDragIndex((current) => (current === next ? current : next));
        };

        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
        dragCleanupRef.current = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', finish);
          window.removeEventListener('pointercancel', finish);
          document.body.classList.remove('drc-sorting');
        };
      };

      const togglePage = (key) => {
        const next = { ...settings.pageEnabled, [key]: !settings.pageEnabled?.[key] };
        if (!Object.values(next).some(Boolean)) {
          setNotice('至少保留一个页面');
          setTimeout(() => setNotice(''), 1600);
          return;
        }
        stage({ pageEnabled: next });
      };

      const saveAll = () => {
        const nextOrder = [...order];
        const nextWeather = {
          ...settings.weather,
          name: draft.locationName,
          latitude: draft.latitude === '' ? null : Number(draft.latitude),
          longitude: draft.longitude === '' ? null : Number(draft.longitude),
        };
        const patch = {
          allowedInterfaces: selectedInterfaces.length === [...new Set((data.interfaces ?? []).map((entry) => entry.name))].length ? null : selectedInterfaces,
          tokenEnabled: settings.tokenEnabled,
          temperatureUnit: settings.temperatureUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
          theme: settings.theme,
          pageOrder: nextOrder,
          pageEnabled: settings.pageEnabled,
          tls: { enabled: Boolean(settings.tls?.enabled), certPath: draft.certPath, keyPath: draft.keyPath },
          weather: nextWeather,
          balance: { spendWindow: settings.balance?.spendWindow ?? 'calendar', lowThreshold: draft.threshold === '' ? null : Number(draft.threshold) },
          notifications: {
            enabledApps: selectedApps.length === (data.apps ?? []).length ? [] : selectedApps,
            limit: Number(draft.notificationLimit),
          },
        };
        void save(patch);
      };

      const sectionHead = (title, desc) => h('div', null, h('h2', null, title), h('p', { className: 'drc-desc' }, desc));

      const renderConnection = () => h('div', { className: 'drc-section' },
        sectionHead(t('pairing'), ''),
        h('div', { className: 'drc-card' },
          h('p', { className: 'drc-desc' }, t('pairingHint')),
          h('div', { className: 'drc-qr' },
            h('div', { className: 'drc-qr-frame' }, h('img', { src: info.qrPath, alt: t('pairing'), width: 150, height: 150 })),
            h('div', { className: 'drc-qr-copy' },
              h('div', { className: 'drc-actions', style: { marginTop: 0 } },
                h(Btn, { primary: true, disabled: !info.routes?.remote, onClick: () => window.open(info.routes?.remote || '', '_blank', 'noopener,noreferrer') }, t('open')),
                h(Btn, { disabled: !info.routes?.remote, onClick: () => void copy() }, copied ? t('copied') : t('copy')),
              ),
              h('code', { className: 'drc-url' }, info.routes?.remote || '—'),
              info.tls?.error ? h('p', { className: 'drc-muted', style: { color: C.error, marginTop: 8 } }, `${t('tlsError')}: ${info.tls.error}`) : null,
            ),
          ),
        ),
      );

      const networkBlock = () => h('div', { className: 'drc-card' },
        h('h3', null, t('network')),
        h('p', { className: 'drc-desc' }, t('networkHint')),
        h('div', { className: 'drc-list' },
          (data.interfaces ?? []).map((entry) => h('div', { className: 'drc-list-row', key: `${entry.name}-${entry.address}` },
            h('label', null,
              h('input', { type: 'checkbox', checked: selectedInterfaces.includes(entry.name), onChange: () => toggleInterface(entry.name) }),
              h('span', null, entry.name),
            ),
            h('span', { className: 'drc-code' }, entry.cidr || entry.address),
          )),
        ),
      );

      const accessBlock = () => h('div', { className: 'drc-card' },
        h(Row, { title: t('token'), description: t('rotateHint') }, h(Toggle, { checked: settings.tokenEnabled, label: t('token'), onChange: (checked) => stage({ tokenEnabled: checked }) })),
        h('div', { className: 'drc-actions' }, h(Btn, { danger: true, onClick: () => void rotate(), disabled: busy }, t('rotate'))),
      );

      const unitBlock = () => h('div', { className: 'drc-card' },
        h('h3', null, t('temperatureUnit')),
        h('p', { className: 'drc-desc' }, t('temperatureUnitHint')),
        h(Seg, {
          options: [
            { value: 'celsius', label: t('celsius') },
            { value: 'fahrenheit', label: t('fahrenheit') },
          ],
          value: settings.temperatureUnit ?? 'celsius',
          onChange: (value) => stage({ temperatureUnit: value }),
        }),
      );

      const orderRows = () => {
        const rows = [];
        const remaining = draggingKey ? order.filter((key) => key !== draggingKey) : order;
        const rawIndex = draggingKey ? (dragIndex == null ? order.indexOf(draggingKey) : dragIndex) : -1;
        const insertAt = draggingKey ? Math.max(0, Math.min(rawIndex, remaining.length)) : -1;
        let visualIndex = 0;
        const placeholder = () => h('div', { className: 'drc-order-placeholder', key: 'order-placeholder' },
          h('span', { className: 'drc-drag-handle', 'aria-hidden': 'true' }, '⋮⋮'),
          h('span', { className: 'drc-order-placeholder-title' }, labels[draggingKey] || ''),
        );

        for (const key of order) {
          if (key === draggingKey) {
            // Stay mounted (never unmount the card mid-drag) but take it out
            // of layout; the dashed placeholder marks the insertion point.
            rows.push(h('div', {
              className: 'drc-order-row is-dragging',
              key,
            },
            h('span', { className: 'drc-drag-handle', 'aria-hidden': 'true' }, '⋮⋮'),
            h('b', null, ''),
            h('span', { className: 'drc-order-label' }, labels[key]),
            h(Toggle, { checked: settings.pageEnabled?.[key] !== false, label: labels[key], onChange: () => togglePage(key) }),
            ));
            continue;
          }
          if (draggingKey && remaining.indexOf(key) === insertAt) rows.push(placeholder());
          visualIndex += 1;
          rows.push(h('div', {
            className: 'drc-order-row',
            key,
            onPointerDown: (event) => startOrderDrag(key, event),
          },
          h('span', { className: 'drc-drag-handle', 'aria-hidden': 'true' }, '⋮⋮'),
          h('b', null, String(visualIndex)),
          h('span', { className: 'drc-order-label' }, labels[key]),
          h(Toggle, { checked: settings.pageEnabled?.[key] !== false, label: labels[key], onChange: () => togglePage(key) }),
          ));
        }
        if (draggingKey && insertAt >= remaining.length) rows.push(placeholder());
        rows.push(h('div', { className: 'drc-order-end', key: 'order-end' }));
        return rows;
      };

      const themeBlock = () => h('div', { className: 'drc-card' },
        h('h3', null, t('theme')),
        h('p', { className: 'drc-desc' }, t('themeHint')),
        h(Seg, { options: [{ value: 'dsh', label: t('followDsh') }, { value: 'light', label: t('light') }, { value: 'dark', label: t('dark') }], value: settings.theme, onChange: (value) => stage({ theme: value }) }),
        h('h3', { style: { marginTop: 16 } }, t('pageOrder')),
        h('p', { className: 'drc-desc' }, t('pageOrderHint')),
        h('div', { className: 'drc-list', ref: orderListRef }, orderRows()),
      );

      const tlsBlock = () => h('div', { className: 'drc-card' },
        h(Row, { title: t('tls'), description: t('tlsHint') }, h(Toggle, {
          checked: settings.tls?.enabled, label: t('tls'), onChange: (checked) => {
            if (checked && (!draft.certPath || !draft.keyPath)) { setError('请先填写证书和私钥路径'); return; }
            stage({ tls: { enabled: checked } });
          },
        })),
        h('div', { className: 'drc-fields' },
          h(Field, { label: t('certPath'), value: draft.certPath, onChange: (value) => setDraft((current) => ({ ...current, certPath: value })), placeholder: 'C:\\certs\\fullchain.pem' }),
          h(Field, { label: t('keyPath'), value: draft.keyPath, onChange: (value) => setDraft((current) => ({ ...current, keyPath: value })), placeholder: 'C:\\certs\\privkey.pem' }),
        ),
        h('div', { className: 'drc-actions' },
          h('span', { className: 'drc-muted' }, settings.tls?.enabled ? (info.tls?.active ? t('tlsOn') : t('tlsError')) : t('tlsOff')),
        ),
      );

      const renderWeather = () => h('div', { className: 'drc-section' },
        sectionHead(t('weather'), ''),
        h('div', { className: 'drc-card' },
          h('p', { className: 'drc-desc' }, t('weatherHint')),
          h(Seg, { options: [{ value: 'auto', label: t('auto') }, { value: 'manual', label: t('manual') }], value: settings.weather?.mode ?? 'auto', onChange: (value) => stage({ weather: { mode: value } }) }),
          h('h3', { style: { marginTop: 16 } }, t('forecastDisplay')),
          h(Seg, { options: [{ value: 'hourly', label: t('hourly') }, { value: 'daily', label: t('daily') }], value: settings.weather?.forecastMode ?? 'hourly', onChange: (value) => stage({ weather: { forecastMode: value } }) }),
          h('div', { className: 'drc-fields' },
            h(Field, { label: t('locationName'), value: draft.locationName, onChange: (value) => setDraft((current) => ({ ...current, locationName: value })), placeholder: '例如：示例城市' }),
            h(Field, { label: t('latitude'), value: draft.latitude, onChange: (value) => setDraft((current) => ({ ...current, latitude: value })), placeholder: '0.0000', inputMode: 'decimal' }),
            h(Field, { label: t('longitude'), value: draft.longitude, onChange: (value) => setDraft((current) => ({ ...current, longitude: value })), placeholder: '0.0000', inputMode: 'decimal' }),
          ),
        ),
      );

      const renderBalance = () => h('div', { className: 'drc-section' },
        sectionHead(t('balance'), ''),
        h('div', { className: 'drc-card' },
          h('p', { className: 'drc-desc' }, t('balanceHint')),
          h(Seg, { options: [{ value: 'calendar', label: t('calendar') }, { value: 'rolling', label: t('rolling') }], value: settings.balance?.spendWindow ?? 'calendar', onChange: (value) => stage({ balance: { spendWindow: value } }) }),
          h('div', { className: 'drc-fields' }, h(Field, { label: t('lowThreshold'), value: draft.threshold, onChange: (value) => setDraft((current) => ({ ...current, threshold: value })), placeholder: '例如：5', inputMode: 'decimal' })),
          h('p', { className: 'drc-desc' }, t('lowThresholdHint')),
        ),
      );

      const renderNotifications = () => h('div', { className: 'drc-section' },
        sectionHead(t('notifications'), ''),
        h('div', { className: 'drc-card' },
          h('p', { className: 'drc-desc' }, t('notificationsHint')),
          apps.length === 0 ? h('p', { className: 'drc-muted' }, t('noApps')) : h('div', { className: 'drc-apps' }, apps.map((app) => h('button', { key: app.key, type: 'button', className: `drc-app${selectedApps.includes(app.key) ? ' is-on' : ''}`, onClick: () => toggleApp(app.key) }, h('i'), app.name))),
          h('div', { className: 'drc-actions' },
            h(Btn, { onClick: () => setSelectedApps(apps.map((app) => app.key)) }, t('allApps')),
          ),
          h('div', { className: 'drc-fields' },
            h(Field, { label: t('limit'), value: draft.notificationLimit, onChange: (value) => setDraft((current) => ({ ...current, notificationLimit: value })), placeholder: '5', inputMode: 'numeric' }),
          ),
        ),
      );

      const renderPlugin = () => h('div', { className: 'drc-section' },
        sectionHead(t('menuPlugin'), t('pluginHint')),
        networkBlock(),
        accessBlock(),
        unitBlock(),
        themeBlock(),
        tlsBlock(),
      );

      const statusBlock = () => h('div', { className: 'drc-card' },
        h('h3', null, t('status')),
        h('p', { className: 'drc-desc' }, t('statusHint')),
        h(StatusRow, { label: t('notificationsStatus'), value: data.capabilities?.notifications?.available }),
        h(StatusRow, { label: t('mediaStatus'), value: data.capabilities?.media?.available ?? data.capabilities?.media?.ok }),
        h(StatusRow, { label: t('volumeStatus'), value: data.capabilities?.volume?.available ?? data.capabilities?.volume?.ok }),
        h(StatusRow, { label: t('weatherStatus'), value: data.capabilities?.weather?.ok }),
      );

      const clientsBlock = () => h('div', { className: 'drc-card' },
        h('h3', null, t('clients')),
        h('p', { className: 'drc-desc' }, t('clientsHint')),
        clients.length === 0 ? h('p', { className: 'drc-muted' }, t('noClients')) : h('div', { className: 'drc-list' }, clients.map((client) => h('div', { className: 'drc-client', key: client.id }, h('div', null, h('strong', null, client.label || '设备'), h('small', null, `${client.ip} · ${duration(Date.now() - client.connectedAt)}`)), h(Btn, { danger: true, onClick: () => void disconnect(client.id) }, t('disconnect'))))),
      );

      const diagnosticsBlock = () => h('div', { className: 'drc-card' },
        h('h3', null, t('diagnostics')),
        h('div', { className: 'drc-facts' },
          h('span', null, `${t('systemName')} · ${data.diagnostics?.platformLabel || info.platformLabel || '—'}`),
          h('span', null, `${t('version')} · ${data.diagnostics?.version || info.version || '—'}`),
          h('span', null, `${t('protocol')} · ${data.diagnostics?.protocol || info.protocol || 'http'}`),
          h('span', null, `${t('clientCount')} · ${clients.length}`),
        ),
      );

      const renderSystem = () => h('div', { className: 'drc-section' },
        sectionHead(t('menuSystem'), t('statusHint')),
        statusBlock(),
        clientsBlock(),
        diagnosticsBlock(),
      );

      const content = section === 'connection' ? renderConnection()
        : section === 'plugin' ? renderPlugin()
          : section === 'weather' ? renderWeather()
            : section === 'balance' ? renderBalance()
              : section === 'notifications' ? renderNotifications()
                : renderSystem();

      const menu = [
        { key: 'connection', label: t('connection'), icon: 'link' },
        { key: 'plugin', label: t('menuPlugin'), icon: 'sliders' },
        { key: 'weather', label: t('menuWeather'), icon: 'cloud' },
        { key: 'balance', label: t('menuBalance'), icon: 'wallet' },
        { key: 'notifications', label: t('menuNotifications'), icon: 'bell' },
        { key: 'system', label: t('menuSystem'), icon: 'info' },
      ];

      return h('div', { className: 'drc-page' },
        h('style', null, CSS),
        h('header', { className: 'drc-head' },
          h('div', null, h('h1', null, t('heading')), h('p', null, t('subtitle'))),
          h('div', { className: 'drc-head-actions' },
            h('span', { className: 'drc-status' }, h('i', { className: `drc-dot ${info.running ? 'ok' : 'bad'}` }), info.running ? t('serviceRunning') : t('serviceStopped')),
            h(Btn, { primary: true, onClick: saveAll, disabled: busy }, t('saveSettings')),
            h(Btn, { disabled: !info.routes?.remote, onClick: () => window.open(info.routes?.remote || '', '_blank', 'noopener,noreferrer') }, t('open')),
            h(Btn, { onClick: () => void load(), disabled: busy }, t('refresh')),
          ),
        ),
        error ? h('div', { className: 'drc-banner is-error' }, `${t('error')}: ${error}`) : null,
        notice ? h('div', { className: 'drc-banner is-ok' }, notice) : null,
        h('div', { className: 'drc-body' },
          h('aside', { className: 'drc-menu' },
            menu.map((item) => h('button', { key: item.key, type: 'button', className: `drc-menu-item${section === item.key ? ' is-active' : ''}`, onClick: () => setSection(item.key) },
              h(MenuIcon, { name: item.icon }),
              item.label,
            )),
          ),
          h('main', { className: 'drc-main' }, content),
        ),
      );
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-remote-control: dictionaries');
      ctx.effect(() => {
        let active = true;
        const sync = (snapshot) => {
          if (!active) return;
          const scheme = snapshot?.active?.colorScheme || ctx.theme?.getTheme?.()?.active?.colorScheme;
          if (!scheme) return;
          void fetch(THEME_URL, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: scheme }) }).catch(() => {});
        };
        sync(ctx.theme?.getTheme?.());
        const off = ctx.on?.('theme/change', sync);
        return () => { active = false; try { off?.(); } catch { /* ignore */ } };
      }, 'dsh-remote-control: theme sync');
      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 12, label: () => t('title') }, PanelIcon)), 'dsh-remote-control: sidebar launcher');
      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, RemotePanel)), 'dsh-remote-control: settings panel');
    }

    return { inject: ['slots', 'locale', 'theme'], apply, __test: { zh, en, PanelIcon, RemotePanel } };
  },
});
