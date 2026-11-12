import type { ClientMessage, ServerMessage } from './types';

/**
 * Small reconnecting WebSocket client for `/ws`.
 *
 * The console uses the same-origin `/ws` endpoint and receives every live
 * snapshot through it; no HTTP polling is involved.
 */
export interface LiveHandlers {
  onOpen?: () => void;
  onMessage?: (message: ServerMessage) => void;
  onClose?: () => void;
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let handlers: LiveHandlers = {};
let disposed = false;

export function configureLive(nextHandlers: LiveHandlers): void {
  handlers = nextHandlers || {};
}

export function isLiveOpen(): boolean {
  return socket?.readyState === WebSocket.OPEN;
}

export function sendLive(message: ClientMessage): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

export function connectLive(): void {
  disposed = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let next: WebSocket;
  try {
    next = new WebSocket(`${scheme}//${location.host}/ws`);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = next;
  next.addEventListener('open', () => {
    reconnectDelay = 1000;
    handlers.onOpen?.();
  });
  next.addEventListener('message', (event) => {
    try {
      handlers.onMessage?.(JSON.parse(event.data as string) as ServerMessage);
    } catch {
      /* ignore malformed frames */
    }
  });
  next.addEventListener('close', () => {
    if (socket === next) socket = null;
    handlers.onClose?.();
    scheduleReconnect();
  });
  next.addEventListener('error', () => {
    try {
      next.close();
    } catch {
      /* ignore */
    }
  });
}

function scheduleReconnect(): void {
  if (disposed || reconnectTimer) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(8000, Math.round(delay * 1.6));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectLive();
  }, delay);
}

export function refreshLive(): void {
  if (!isLiveOpen()) connectLive();
  else sendLive({ type: 'refresh' });
}

export function disposeLive(): void {
  disposed = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const current = socket;
  socket = null;
  try {
    current?.close();
  } catch {
    /* ignore */
  }
}
