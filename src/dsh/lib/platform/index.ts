/** Wires the Rust probe into the platform-independent service interfaces. */

import { createNotificationService } from '../notifications.js';
import { createProbeMediaAdapter } from '../probe-adapter.js';

const LABELS: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
};

export interface PlatformAdaptersOptions {
  limit?: number;
}

export interface PlatformAdapters {
  platform: NodeJS.Platform;
  label: string;
  notifications: ReturnType<typeof createNotificationService>;
  media: ReturnType<typeof createProbeMediaAdapter>;
  dispose(): void;
}

/**
 * Media, volume and notifications all come from `dsh-probe`. There is no
 * per-platform JavaScript fallback: a missing/unsupported probe is surfaced as
 * an error payload by the adapters themselves.
 */
export function createPlatformAdapters(options: PlatformAdaptersOptions = {}): PlatformAdapters {
  const platform = process.platform;
  const label = LABELS[platform] || platform;
  const notifications = createNotificationService({ limit: options.limit });
  const media = createProbeMediaAdapter({ label });
  return {
    platform,
    label,
    notifications,
    media,
    dispose() {
      notifications.dispose?.();
    },
  };
}
