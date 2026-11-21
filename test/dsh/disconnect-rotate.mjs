import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-rc-disconnect-'));
process.env.DSH_PROFILE_DIR = profile;

const { createRemoteControlService } = await import('../../lib/service.js');

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
const base = `http://127.0.0.1:${info.port}`;
const wsBase = `ws://127.0.0.1:${info.port}/ws`;

const token0 = service.settingsStore.get().token;

/** Resolve once a socket has received `welcome`. */
function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      reject(new Error('WebSocket timeout'));
    }, 20_000);
    socket.addEventListener('message', (event) => {
      if (JSON.parse(event.data).type !== 'welcome') return;
      clearTimeout(timer);
      resolve(socket);
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('WebSocket failed'));
    });
  });
}

function waitForClose(socket) {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve(1000);
      return;
    }
    socket.addEventListener('close', (event) => resolve(event.code));
  });
}

/**
 * Every `token` frame one socket receives within `ms`.
 *
 * The Host writes the replacements synchronously inside the disconnect request,
 * so a short window proves both delivery and that it happens exactly once.
 */
function tokenFrames(socket, ms) {
  return new Promise((resolve) => {
    const frames = [];
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'token') frames.push(message);
    };
    socket.addEventListener('message', onMessage);
    setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      resolve(frames);
    }, ms);
  });
}

function mockRequest(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]);
  req.method = 'POST';
  req.url = '/dsh-remote-control/api/disconnect';
  req.headers = {};
  return req;
}

function mockResponse() {
  const chunks = [];
  return {
    status: 0,
    headers: {},
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      if (body !== undefined) chunks.push(Buffer.from(body));
    },
    json() {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    },
  };
}

/** Ask the Host to disconnect one client exactly like the sidebar route does. */
async function disconnect(id) {
  const res = mockResponse();
  await service.handleDisconnect(mockRequest({ id }), res);
  return { status: res.status, payload: res.json() };
}

/* --------------------------------- rotation on a per-device disconnect */

const first = await openSocket(`${wsBase}?token=${encodeURIComponent(token0)}`);
const firstId = service.getInfo().clients[0].id;

const second = await openSocket(`${wsBase}?token=${encodeURIComponent(token0)}`);
const secondId = service.getInfo().clients.find((client) => client.id !== firstId)?.id;
assert.ok(secondId, 'the second console shows up with its own id');

const third = await openSocket(`${wsBase}?token=${encodeURIComponent(token0)}`);
const thirdId = service.getInfo().clients
  .find((client) => client.id !== firstId && client.id !== secondId)?.id;
assert.ok(thirdId, 'the third console shows up with its own id');

const thirdClosed = waitForClose(third);
const framesForFirst = tokenFrames(first, 800);
const framesForSecond = tokenFrames(second, 800);

const result = await disconnect(thirdId);
assert.equal(result.status, 200);
assert.equal(await thirdClosed, 1001, 'the selected console receives a going-away close');

const [gotFirst, gotSecond] = await Promise.all([framesForFirst, framesForSecond]);
const token1 = service.settingsStore.get().token;
assert.notEqual(token1, token0, 'disconnecting with verification on rotates the token');
assert.equal(gotFirst.length, 1, 'the first remaining console is told exactly once');
assert.equal(gotSecond.length, 1, 'the second remaining console is told exactly once');
assert.equal(gotFirst[0].token, token1);
assert.equal(gotSecond[0].token, token1);
assert.equal(first.readyState, WebSocket.OPEN, 'the first remaining console keeps its live socket');
assert.equal(second.readyState, WebSocket.OPEN, 'the second remaining console keeps its live socket');

// The sidebar gets a fresh payload so the pairing URL / QR code stop carrying
// the old token.
assert.ok(result.payload.settings, 'the disconnect response is the full settings payload');
assert.deepEqual(
  new Set(result.payload.clients.map((client) => client.id)),
  new Set([firstId, secondId]),
);
assert.ok(result.payload.info.routes.remote.includes(`token=${encodeURIComponent(token1)}`));

// The old credential is dead everywhere: no page, no socket.
assert.equal((await fetch(`${base}/?token=${encodeURIComponent(token0)}`)).status, 401);
assert.equal((await fetch(`${base}/?token=${encodeURIComponent(token1)}`)).status, 200);
await assert.rejects(openSocket(`${wsBase}?token=${encodeURIComponent(token0)}`));

// The refreshed cookie is what keeps a reload working; the phone reissues it
// with a HEAD on the console root that still carries the old cookie.
const refreshed = await fetch(`${base}/?token=${encodeURIComponent(token1)}`, {
  method: 'HEAD',
  headers: { cookie: `dsh_rc=${encodeURIComponent(token0)}` },
});
assert.equal(refreshed.status, 200);
const reissued = refreshed.headers.get('set-cookie') || '';
assert.ok(reissued.includes(`dsh_rc=${token1}`), 'the response replaces the stale pairing cookie');
assert.match(reissued, /HttpOnly/);

// A console that presents the rotated token in the handshake reconnects
// without pairing again, exactly like the phone after a network blip.
const rebound = await openSocket(`${wsBase}?token=${encodeURIComponent(token1)}`);
assert.ok(rebound);

/* ------------------------- no rotation while verification is off */

await service.applySettings({ tokenEnabled: false });
await waitForClose(first);
await waitForClose(second);
await waitForClose(rebound);
const openToken = service.settingsStore.get().token;

const plainFirst = await openSocket(`${wsBase}`);
const plainFirstId = service.getInfo().clients[0].id;
const plainSecond = await openSocket(`${wsBase}`);
const targetId = service.getInfo().clients.find((client) => client.id !== plainFirstId).id;
assert.ok(targetId, 'the console opened second owns the other id');

const framesWithoutVerification = tokenFrames(plainFirst, 500);
const plainResult = await disconnect(targetId);
assert.equal(plainResult.status, 200);
assert.equal(plainResult.payload.settings, undefined, 'a disconnect without verification stays lightweight');
assert.deepEqual(await framesWithoutVerification, [], 'no token frame without verification');
assert.equal(service.settingsStore.get().token, openToken, 'the token is untouched when verification is off');
assert.equal(plainFirst.readyState, WebSocket.OPEN, 'the console that stays connected is undisturbed');

plainFirst.close();
plainSecond.close();
await waitForClose(plainFirst);
await waitForClose(plainSecond);

await service.stop();
service.dispose();
fs.rmSync(profile, { recursive: true, force: true });
console.log('disconnect-rotate ok');
