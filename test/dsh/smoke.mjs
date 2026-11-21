import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc-smoke-'));
process.env.DSH_PROFILE_DIR = profile;

const { createRemoteControlService, certificateDomain } = await import('../../lib/service.js');

// Public test certificate only; no private key is stored in the repository.
const certificate = `-----BEGIN CERTIFICATE-----
MIIDWjCCAkKgAwIBAgIQP7AURvOziINK/zELWrZ21DANBgkqhkiG9w0BAQsFADAj
MSEwHwYDVQQDDBhkc2gtY29uc29sZS5leGFtcGxlLnRlc3QwHhcNMjYxMTE4MDkx
MzM0WhcNMzExMTE4MDkyMzM0WjAjMSEwHwYDVQQDDBhkc2gtY29uc29sZS5leGFt
cGxlLnRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDUrsEe/JYW
wT7F8YRhI5RvDWDGGEDRxzT3hVidorCa36PwXuLo22DfknXgJ/IImW8M2Z6rft2q
x2TsPFxVchonl9jtclKddMYY5ivSbXmFCYo7xppVMC1MNgRcaDRcZ/L/+IzIB3DK
4s4tfbY7+xMiV+S8SzN409HQ07zQntFBYUUrC3e1+U3mmbV5gpuYnkA3opcnQwEl
67izVSkgkuAHIa/LLWIk7Sdr9FDFoge6iTfJ67UqM54iLxYdLMVZiBvYlDjv2dvw
kHAdXWUwvOTbz6aekvGA1h1s9fGOxOkY4tzsGwCtRv2jxdEpY/xipiU1WsSOlM1/
zfp2tcEk8dn5AgMBAAGjgYkwgYYwDgYDVR0PAQH/BAQDAgWgMB0GA1UdJQQWMBQG
CCsGAQUFBwMCBggrBgEFBQcDATA2BgNVHREELzAtghhkc2gtY29uc29sZS5leGFt
cGxlLnRlc3SCEWRzaC1jb25zb2xlLmxvY2FsMB0GA1UdDgQWBBRTZ/n8Mzbh22TW
T1gjAvtRY2hBqTANBgkqhkiG9w0BAQsFAAOCAQEAsmuy7wiBJCnPvYBdVkGPOKgc
wKVN2cLytIckp5uQHprcHr7NxJdlQ7OzZj6l3QfTeaQOQTtn5NABJCFnESz62y6X
ATmYjJ0jZTf5OXuon/xTpCI+8b0QsIqCxV+nsIdH4Oy8rUkKtmAnKn7EoAHNruyg
arkrBD/0yeVTI7UY+NUABnHp7YRbz7BJuCDQBR5XArO2GsvbhP2b377eIdehwXlp
4FTlf7i0V+fADMclVxg80Up80oEtsrigs1RcYQ6HcqCX4A9KOdUZc0DxvPD1p8bA
3a0cPsk+pIg1XTlwpEL8AJ+14JM3bOVGXNIlmB168bnrH6rDwrS4nDvDjN4Krg==
-----END CERTIFICATE-----`;

// Pairing prefers a concrete DNS name from the TLS certificate over interface IPs.
assert.equal(certificateDomain(certificate), 'dsh-console.example.test');
assert.equal(certificateDomain('not a certificate'), null);

const ctx = {
  get(name) {
    if (name === 'sessions') return { list: () => [] };
    if (name === 'agents') {
      return { list: () => [], get: () => undefined, turnBoundaryOf: () => ({ lastTurn: 0 }) };
    }
    if (name === 'sessionTitle') return { get: () => undefined };
    if (name === 'deepseekAccount') {
      return {
        async getState() {
          return { status: 'signed-out' };
        },
        async getBalance() {
          return null;
        },
        async getPlatformSession() {
          return null;
        },
      };
    }
    return undefined;
  },
  on() {
    return () => {};
  },
};

const service = createRemoteControlService(ctx, { log: () => {} });
const info = await service.start();
assert.equal(info.running, true);
assert.ok(info.port > 0);
assert.ok(info.routes.remote.includes('token='));
assert.ok(info.qrPath.includes('token='));

const base = `http://127.0.0.1:${info.port}`;
const health = await fetch(`${base}/api/health`).then((response) => response.json());
assert.equal(health.ok, true);

const unauthorized = await fetch(`${base}/`);
assert.equal(unauthorized.status, 401);

const page = await fetch(`${base}/?token=${encodeURIComponent(service.settingsStore.get().token)}`);
assert.equal(page.status, 200);
const pageCsp = page.headers.get('content-security-policy') || '';
assert.match(pageCsp, /img-src[^;]*https:/);
assert.match(pageCsp, /img-src[^;]*http:/);
assert.match(pageCsp, /frame-src[^;]*https:/);
assert.match(pageCsp, /frame-src[^;]*http:/);
const pageText = await page.text();
assert.match(pageText, /DSH Home/);

const token = encodeURIComponent(service.settingsStore.get().token);
const scriptPath = pageText.match(/\/assets\/[^"']+\.js/)?.[0];
assert.ok(scriptPath, 'built page references a Vite JS asset');
const scriptAsset = await fetch(`${base}${scriptPath}?token=${token}`);
assert.equal(scriptAsset.status, 200);
assert.match(scriptAsset.headers.get('content-type') || '', /text\/javascript/);
assert.equal(scriptAsset.headers.get('cache-control'), 'no-store');
const stylePath = pageText.match(/\/assets\/[^"']+\.css/)?.[0];
assert.ok(stylePath, 'built page references a Vite CSS asset');
const styleAsset = await fetch(`${base}${stylePath}?token=${token}`);
assert.equal(styleAsset.status, 200);
assert.match(styleAsset.headers.get('content-type') || '', /text\/css/);
const missingAsset = await fetch(`${base}/assets/does-not-exist.js?token=${token}`);
assert.equal(missingAsset.status, 404);
const traversal = await fetch(`${base}/assets/..%2F..%2Fsettings.json?token=${token}`);
assert.notEqual(traversal.status, 200);

// The console ships one stylesheet per chunk, so the font faces live in
// whichever sheet the entry owns rather than necessarily the first one listed.
const stylePaths = [...new Set([...pageText.matchAll(/\/assets\/[^"']+\.css/g)].map((match) => match[0]))];
const styleText = (await Promise.all(
  stylePaths.map(async (item) => (await fetch(`${base}${item}?token=${token}`)).text()),
)).join('\n');
assert.match(styleText, /@font-face/);
assert.match(styleText, /font-family:\s*['"]?Inter Variable/);
const rawFontUrl = styleText.match(/url\((['"]?)([^)'"]+\.woff2)\1\)/)?.[2];
assert.ok(rawFontUrl, 'bundled CSS references a woff2 font');
const fontPath = rawFontUrl.startsWith('/') ? rawFontUrl : `/assets/${rawFontUrl.replace(/^\.\//, '')}`;
const fontFile = await fetch(`${base}${fontPath}?token=${token}`);
assert.equal(fontFile.status, 200);
assert.match(fontFile.headers.get('content-type') || '', /font\/woff2/);
assert.match(fontFile.headers.get('cache-control') || '', /immutable/);

const wsUrl = `ws://127.0.0.1:${info.port}/ws?token=${encodeURIComponent(service.settingsStore.get().token)}`;
const messages = await new Promise((resolve, reject) => {
  const collected = [];
  const socket = new WebSocket(wsUrl);
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error(`WebSocket timeout; got ${collected.map((item) => item.type).join(', ')}`));
  }, 20_000);
  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(event.data);
      collected.push(message);
      if (message.type === 'overview') {
        clearTimeout(timer);
        socket.close();
        resolve(collected);
      }
    } catch {
      /* ignore */
    }
  });
  socket.addEventListener('error', () => {
    clearTimeout(timer);
    reject(new Error('WebSocket failed'));
  });
});

assert.ok(messages.some((message) => message.type === 'welcome'));
const welcome = messages.find((message) => message.type === 'welcome');
assert.equal(welcome.now, undefined);
assert.equal(welcome.settings.temperatureUnit, 'celsius');
assert.equal(welcome.settings.customPageUrl, '');
assert.deepEqual(welcome.settings.tls, { enabled: false, advanced: { wakeLock: false } });
assert.equal('certPath' in welcome.settings.tls, false);
const overview = messages.find((message) => message.type === 'overview');
assert.ok(overview);
assert.equal(overview.data.now, undefined);
assert.equal(overview.data.timezoneOffset, undefined);
assert.equal(overview.data.settings.temperatureUnit, 'celsius');
assert.equal(overview.data.sessions.length, 0);
assert.equal(overview.data.account.signedIn, false);
assert.ok(overview.data.weather);
assert.deepEqual(overview.data.settings.pageOrder, ['home', 'sessions', 'quickqa', 'music', 'performance', 'custom']);
assert.deepEqual(overview.data.settings.pageEnabled, {
  home: true,
  sessions: true,
  quickqa: true,
  music: true,
  performance: true,
  custom: false,
});
assert.equal(overview.data.settings.customPageUrl, '');

/* ----------------------------- settings reach the phone without HTTPS */

// The wake-lock switch is stored and delivered independently of the HTTPS
// switch: over plain HTTP the saved value still rides along in `welcome`, and
// the phone decides at request time whether the browser grants the lock.
await withTimeout(
  service.applySettings({ tls: { advanced: { wakeLock: true } } }),
  10_000,
  'enabling the wake lock over HTTP',
);
assert.equal(service.settingsStore.get().tls.enabled, false);
assert.equal(service.settingsStore.get().tls.advanced.wakeLock, true);

const wakeWelcome = await new Promise((resolve, reject) => {
  const socket = new WebSocket(wsUrl);
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error('wake-lock welcome timeout'));
  }, 15_000);
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type !== 'welcome') return;
    clearTimeout(timer);
    socket.close();
    resolve(message.settings.tls);
  });
  socket.addEventListener('error', () => {
    clearTimeout(timer);
    reject(new Error('wake-lock welcome failed'));
  });
});
assert.deepEqual(wakeWelcome, { enabled: false, advanced: { wakeLock: true } });

await withTimeout(
  service.applySettings({ tls: { advanced: { wakeLock: false } } }),
  10_000,
  'restoring the wake lock default',
);

/* ------------------------------------------ trusted reverse proxies */

// Malformed input is rejected before the store changes; valid input is stored
// canonically so the system information page can match the socket address.
await assert.rejects(
  withTimeout(
    service.applySettings({ tls: { trustedProxies: '127.0.0.1，10.0.0.0/8' } }),
    10_000,
    'rejecting a full-width comma',
  ),
  /可信反向代理|trusted reverse proxy/i,
);
assert.deepEqual(service.settingsStore.get().tls.trustedProxies, []);
await assert.rejects(
  withTimeout(
    service.applySettings({ tls: { trustedProxies: ['127.0.0.1', 'not-an-ip'] } }),
    10_000,
    'rejecting a malformed entry',
  ),
  /可信反向代理|trusted reverse proxy/i,
);
assert.deepEqual(service.settingsStore.get().tls.trustedProxies, []);
await withTimeout(
  service.applySettings({ tls: { trustedProxies: '127.0.0.1, 10.0.0.0/8' } }),
  10_000,
  'saving trusted reverse proxies',
);
assert.deepEqual(service.settingsStore.get().tls.trustedProxies, ['127.0.0.1', '10.0.0.0/8']);
await withTimeout(
  service.applySettings({ tls: { trustedProxies: [] } }),
  10_000,
  'clearing trusted reverse proxies',
);

/* ---------------------------------------------- dynamic HTTPS switching */

/** Resolve once a fresh `/ws` connection has received `welcome`. */
function openSocket(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      reject(new Error(`WebSocket timeout on port ${port}`));
    }, 15_000);
    socket.addEventListener('message', (event) => {
      if (JSON.parse(event.data).type === 'welcome') {
        clearTimeout(timer);
        resolve(socket);
      }
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`WebSocket failed on port ${port}`));
    });
  });
}

/** Fail fast instead of hanging the whole test run. */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Changing TLS replaces the LAN listener. The hub must rebind to the new
// listener, the old listener must shut down while a phone is still connected,
// and the pairing port must survive so only the scheme changes.
const live = await openSocket(info.port);
const liveClosed = new Promise((resolve) => {
  live.addEventListener('close', (event) => resolve(event.code));
});

await withTimeout(
  service.applySettings({
    tls: {
      enabled: true,
      certPath: path.join(profile, 'missing-cert.pem'),
      keyPath: path.join(profile, 'missing-key.pem'),
    },
  }),
  10_000,
  'switching to HTTPS',
);

const httpsFallback = service.getInfo();
assert.equal(httpsFallback.tls.configured, true);
assert.equal(httpsFallback.tls.active, false, 'an unreadable certificate keeps the console on HTTP');
assert.ok(httpsFallback.tls.error);
assert.equal(httpsFallback.protocol, 'http');
assert.equal(httpsFallback.port, info.port, 'the pairing port survives the protocol restart');
assert.equal(await withTimeout(liveClosed, 5_000, 'closing the old socket'), 1001);

const reboundHttps = await openSocket(httpsFallback.port);
assert.ok(reboundHttps, 'a WebSocket connects again after the TLS restart');
const reboundHttpsClosed = new Promise((resolve) => {
  reboundHttps.addEventListener('close', (event) => resolve(event.code));
});

await withTimeout(service.applySettings({ tls: { enabled: false } }), 10_000, 'switching back to HTTP');
const httpAgain = service.getInfo();
assert.equal(httpAgain.tls.configured, false);
assert.equal(httpAgain.tls.active, false);
assert.equal(httpAgain.protocol, 'http');
assert.equal(httpAgain.port, info.port);
assert.equal(await withTimeout(reboundHttpsClosed, 5_000, 'closing the HTTPS socket'), 1001);
const reboundHttp = await openSocket(httpAgain.port);
assert.ok(reboundHttp, 'a WebSocket connects again after switching back to HTTP');

// Finish with a normal close handshake so the shutdown path is not racing a
// client that is still writing.
await withTimeout(
  new Promise((resolve) => {
    reboundHttp.addEventListener('close', resolve);
    reboundHttp.close();
  }),
  5_000,
  'closing the HTTP socket',
);

const changedUnit = service.settingsStore.update({ temperatureUnit: 'fahrenheit' });
assert.equal(changedUnit.temperatureUnit, 'fahrenheit');
assert.equal(service.settingsStore.public().temperatureUnit, 'fahrenheit');
service.settingsStore.update({ temperatureUnit: 'celsius' });

const removed = await fetch(`${base}/api/overview`);
assert.equal(removed.status, 404);

await service.stop();
service.dispose();
fs.rmSync(profile, { recursive: true, force: true });
console.log('smoke ok');
