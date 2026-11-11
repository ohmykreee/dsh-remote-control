/** Minimal RFC 6455 WebSocket server for the LAN console. */

import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE_BYTES = 256 * 1024;
const HEARTBEAT_MS = 25_000;
const STALE_MS = 70_000;

function normalizeIp(value) {
  const ip = String(value || '');
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function deviceLabel(userAgent) {
  const ua = String(userAgent || '');
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return '浏览器';
}

function frame(opcode, payload = Buffer.alloc(0)) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

function closeFrame(code = 1000, reason = '') {
  const text = Buffer.from(String(reason), 'utf8');
  const payload = Buffer.alloc(2 + text.length);
  payload.writeUInt16BE(code, 0);
  text.copy(payload, 2);
  return frame(0x8, payload);
}

export function createWebSocketHub(options) {
  const server = options.server;
  const pathname = options.path || '/ws';
  const authorize = options.authorize || (() => ({ ok: true }));
  const onConnection = options.onConnection || (() => {});
  const onMessage = options.onMessage || (() => {});
  const onClose = options.onClose || (() => {});
  const clients = new Map();
  let disposed = false;

  function sendRaw(client, buffer) {
    try {
      if (!client.socket.destroyed && client.socket.writable) client.socket.write(buffer);
    } catch {
      client.close(1011, 'write failed');
    }
  }

  function send(client, value) {
    try {
      sendRaw(client, frame(0x1, Buffer.from(JSON.stringify(value), 'utf8')));
    } catch {
      /* ignore serialization issues */
    }
  }

  function broadcast(value, predicate = null) {
    const payload = Buffer.from(JSON.stringify(value), 'utf8');
    for (const client of clients.values()) {
      if (predicate && !predicate(client)) continue;
      sendRaw(client, frame(0x1, payload));
    }
  }

  function closeClient(client, code = 1000, reason = '') {
    if (!client || client.closed) return;
    client.closed = true;
    try {
      client.socket.write(closeFrame(code, reason));
    } catch {
      /* ignore */
    }
    try {
      client.socket.end();
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        client.socket.destroy();
      } catch {
        /* ignore */
      }
    }, 100).unref?.();
    clients.delete(client.id);
    onClose(client);
  }

  function handleMessage(client, opcode, payload) {
    if (opcode === 0x8) {
      closeClient(client, 1000, 'bye');
      return;
    }
    if (opcode === 0x9) {
      sendRaw(client, frame(0xa, payload));
      return;
    }
    if (opcode === 0xa) {
      client.lastPong = Date.now();
      return;
    }
    if (opcode !== 0x1) {
      closeClient(client, 1003, 'text frames only');
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(payload.toString('utf8'));
    } catch {
      send(client, { type: 'error', error: 'invalid message' });
      return;
    }
    client.lastSeen = Date.now();
    try {
      onMessage(client, parsed);
    } catch (error) {
      send(client, { type: 'error', error: String(error?.message || error) });
    }
  }

  function consume(client, chunk) {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    if (client.buffer.length > MAX_MESSAGE_BYTES + 14) {
      closeClient(client, 1009, 'message too large');
      return;
    }
    while (client.buffer.length >= 2) {
      const first = client.buffer[0];
      const second = client.buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (!fin) {
        closeClient(client, 1003, 'fragmented frames unsupported');
        return;
      }
      if (length === 126) {
        if (client.buffer.length < 4) return;
        length = client.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (client.buffer.length < 10) return;
        const big = client.buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE_BYTES)) {
          closeClient(client, 1009, 'message too large');
          return;
        }
        length = Number(big);
        offset = 10;
      }
      if (!masked) {
        closeClient(client, 1002, 'client frames must be masked');
        return;
      }
      if (length > MAX_MESSAGE_BYTES) {
        closeClient(client, 1009, 'message too large');
        return;
      }
      if (client.buffer.length < offset + 4 + length) return;
      const mask = client.buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(client.buffer.subarray(offset, offset + length));
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3];
      client.buffer = client.buffer.subarray(offset + length);
      handleMessage(client, opcode, payload);
    }
  }

  function handleUpgrade(req, socket, head) {
    if (disposed) {
      socket.destroy();
      return;
    }
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== pathname) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || !req.headers['sec-websocket-key']) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const decision = authorize(req, url);
    if (!decision?.ok) {
      const status = decision?.status || 403;
      socket.write(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(String(req.headers['sec-websocket-key']) + GUID)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.setNoDelay?.(true);
    const client = {
      id: crypto.randomUUID(),
      socket,
      ip: normalizeIp(req.socket.remoteAddress),
      userAgent: String(req.headers['user-agent'] || ''),
      label: deviceLabel(req.headers['user-agent']),
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      lastPong: Date.now(),
      buffer: Buffer.alloc(0),
      closed: false,
      send: (value) => send(client, value),
      close: (code, reason) => closeClient(client, code, reason),
    };
    clients.set(client.id, client);
    socket.on('data', (chunk) => consume(client, chunk));
    socket.on('error', () => closeClient(client, 1011, 'socket error'));
    socket.on('close', () => closeClient(client, 1000, 'closed'));
    if (head?.length) consume(client, head);
    try {
      onConnection(client);
    } catch (error) {
      send(client, { type: 'error', error: String(error?.message || error) });
      closeClient(client, 1011, 'connection failed');
    }
  }

  server.on('upgrade', handleUpgrade);

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const client of clients.values()) {
      if (now - client.lastPong > STALE_MS) {
        closeClient(client, 1001, 'stale');
        continue;
      }
      sendRaw(client, frame(0x9, Buffer.alloc(0)));
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  function info() {
    return [...clients.values()]
      .map((client) => ({
        id: client.id,
        label: client.label,
        ip: client.ip,
        connectedAt: client.connectedAt,
        lastSeen: client.lastSeen,
      }))
      .sort((a, b) => b.connectedAt - a.connectedAt);
  }

  function dispose() {
    disposed = true;
    clearInterval(heartbeat);
    server.off('upgrade', handleUpgrade);
    for (const client of [...clients.values()]) closeClient(client, 1001, 'server restart');
    clients.clear();
  }

  return {
    broadcast,
    closeAll(reason = 'server restart') {
      for (const client of [...clients.values()]) closeClient(client, 1001, reason);
    },
    close(id, reason = 'closed by host') {
      const client = clients.get(id);
      if (client) closeClient(client, 1001, reason);
    },
    info,
    size: () => clients.size,
    send,
    dispose,
  };
}
