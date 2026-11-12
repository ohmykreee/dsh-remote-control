/**
 * Shared Host-side contracts for the remote console.
 *
 * These types describe the small part of the DSH Host runtime this plugin
 * touches, plus the payloads that cross module boundaries (probe results,
 * media snapshots, notifications, WebSocket frames). They are deliberately
 * structural: DSH services are resolved by name through `ctx.get`, so every
 * consumer validates the shape it needs at runtime.
 */

import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';

/** Minimal logger sink the Host may expose through `ctx.logger`. */
export interface DshLogger {
  info(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}

export type DshLoggerFactory = (id: string) => DshLogger;

/** A DSH lifecycle hook handler (`user-questions/request`, `approval/request`). */
export type DshEventHandler = (request: unknown, next: () => Promise<unknown>) => Promise<unknown>;

/** Registration options accepted by the Cordis event bus. */
export interface DshEventListenerOptions {
  /** Run this listener before listeners registered earlier on the same event. */
  prepend?: boolean;
}

/**
 * The subset of the Cordis plugin context this plugin uses. Everything is
 * optional so the service can also run against a minimal composition in tests.
 */
export interface DshContext {
  logger?: DshLoggerFactory | DshLogger;
  get?: (name: string) => unknown;
  on?: (
    event: string,
    handler: DshEventHandler,
    options?: DshEventListenerOptions | boolean,
  ) => (() => void) | void;
  effect?: (fn: () => (() => void) | void, label?: string) => unknown;
}

/** One connected phone/browser as tracked by the WebSocket hub. */
export interface WebSocketClient {
  readonly id: string;
  readonly ip: string;
  readonly userAgent: string;
  readonly label: string;
  readonly connectedAt: number;
  lastSeen: number;
  send(value: unknown): void;
  close(code?: number, reason?: string): void;
}

export interface WebSocketClientInfo {
  id: string;
  label: string;
  ip: string;
  connectedAt: number;
  lastSeen: number;
}

export interface WebSocketAuthorizeDecision {
  ok: boolean;
  status?: number;
}

export interface WebSocketHubOptions {
  server: HttpServer | HttpsServer;
  path?: string;
  authorize?: (req: IncomingMessage, url: URL) => WebSocketAuthorizeDecision | undefined;
  onConnection?: (client: WebSocketClient) => void;
  onMessage?: (client: WebSocketClient, message: unknown) => void;
  onClose?: (client: WebSocketClient) => void;
}

export interface WebSocketHub {
  broadcast(value: unknown, predicate?: ((client: WebSocketClient) => boolean) | null): void;
  closeAll(reason?: string): void;
  close(id: string, reason?: string): void;
  info(): WebSocketClientInfo[];
  size(): number;
  send(client: WebSocketClient, value: unknown): void;
  dispose(): void;
}

/** Loose JSON object used while normalising untrusted payloads. */
export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Raw `dsh-probe media read` payload (already enriched by Rust). */
export interface ProbeMedia extends JsonRecord {
  appId?: string;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  playbackStatus?: string;
  autoRepeatMode?: string;
  shuffleActive?: boolean;
  position?: number | string | null;
  startTime?: number | string | null;
  endTime?: number | string | null;
  minSeekTime?: number | string | null;
  maxSeekTime?: number | string | null;
  lastUpdatedAt?: number | string | null;
  canPlayPause?: boolean;
  canNext?: boolean;
  canPrevious?: boolean;
  canSeek?: boolean;
  canLike?: boolean;
  canSetLiked?: boolean;
  thumbnail?: string | null;
  thumbnailType?: string | null;
  thumbnailUrl?: string | null;
  liked?: boolean | null;
  trackId?: string | number | null;
  estimatedDuration?: boolean;
  /** `system` (SMTC/MPRIS/MediaRemote), `private` or `accessibility`. */
  provider?: string;
  providerDetail?: string | null;
}

/** Normalised media metadata handed to the browser. */
export interface PublicMedia {
  appId: string;
  /** Display name resolved from the plugin's application mapping. */
  appName: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  playbackStatus: string;
  autoRepeatMode: string;
  shuffleActive: boolean;
  position: number;
  startTime: number;
  endTime: number;
  minSeekTime: number;
  maxSeekTime: number;
  lastUpdatedAt: number | null;
  canPlayPause: boolean;
  canNext: boolean;
  canPrevious: boolean;
  canSeek: boolean;
  /** Which layer supplied the media payload. */
  provider: 'system' | 'private' | 'accessibility';
  providerDetail: string | null;
  thumbnail: string | null;
  thumbnailUrl: string | null;
  thumbnailType: string | null;
  liked: boolean | null;
  canLike: boolean;
  canSetLiked: boolean;
  trackId: string | number | null;
  estimatedDuration: boolean;
  sampledAt: number;
  positionReported?: boolean;
  timelineSource?: 'smtc' | 'private' | 'accessibility' | 'none';
}

/** Raw probe envelope: `{ ok, media, sampledAt }` plus backend-specific extras. */
export interface ProbeMediaResult extends JsonRecord {
  media?: ProbeMedia | null;
  sampledAt?: number | string | null;
  available?: boolean;
}

export interface ProbeVolumeResult extends JsonRecord {
  volume?: number | string | null;
  muted?: boolean;
}

export interface ProbeLocationResult extends JsonRecord {
  latitude?: number | string | null;
  longitude?: number | string | null;
  accuracy?: number | string | null;
  source?: string;
}

/** One OS notification as reported by `dsh-probe notifications`. */
export interface NotificationItem {
  id?: string;
  appKey?: string;
  appName?: string;
  title?: string;
  body?: string;
  avatar?: string | null;
  hasImage?: boolean;
  receivedAt?: number;
  isGroup?: boolean;
  [key: string]: unknown;
}

/** Aggregated per-application notification counts. */
export interface NotificationApp {
  key: string;
  name: string;
  count: number;
  [key: string]: unknown;
}

/** Raw `dsh-probe notifications` snapshot. */
export interface NotificationPayload extends JsonRecord {
  ok?: boolean;
  available?: boolean;
  reason?: string | null;
  source?: string | null;
  liveOnly?: boolean;
  notifications?: NotificationItem[];
  apps?: NotificationApp[];
  updatedAt?: number;
}

/** Browser-facing notification view after app filtering. */
export interface NotificationView {
  available: boolean;
  reason: string | null;
  liveOnly: boolean;
  notifications: NotificationItem[];
  apps: NotificationApp[];
  enabledApps: string[];
  updatedAt: number;
}
