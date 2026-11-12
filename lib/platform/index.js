/** Wires the Rust probe into the platform-independent service interfaces. */

import { createProbeMediaAdapter } from '../probe-adapter.js';
import { createNotificationService } from '../notifications.js';

const LABELS = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
};

/**
 * Media, volume and notifications all come from `dsh-probe`. There is no
 * per-platform JavaScript fallback: a missing/unsupported probe is surfaced as
 * an error payload by the adapters themselves.
 */
export function createPlatformAdapters(options = {}) {
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
