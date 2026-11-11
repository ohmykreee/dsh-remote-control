/** Chooses the native notification and media adapters for the current OS. */

import { createMediaService as createWindowsMedia } from '../media.js';
import { createNotificationService as createWindowsNotifications } from '../notifications.js';
import { createLinuxMedia, createLinuxNotifications } from './linux.js';
import { createMacMedia, createMacNotifications } from './macos.js';

const LABELS = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
};

export function createPlatformAdapters(options = {}) {
  const platform = process.platform;
  if (platform === 'win32') {
    return {
      platform,
      label: LABELS[platform],
      notifications: createWindowsNotifications(options),
      media: createWindowsMedia(),
      dispose() {},
    };
  }
  if (platform === 'darwin') {
    return {
      platform,
      label: LABELS[platform],
      notifications: createMacNotifications(options),
      media: createMacMedia(),
      dispose() {},
    };
  }
  if (platform === 'linux') {
    const notifications = createLinuxNotifications(options);
    return {
      platform,
      label: LABELS[platform],
      notifications,
      media: createLinuxMedia(),
      dispose() {
        notifications.dispose?.();
      },
    };
  }
  return {
    platform,
    label: LABELS[platform] || platform,
    notifications: {
      async getNotifications() {
        return { available: false, reason: `No notification adapter for ${platform}`, notifications: [], apps: [] };
      },
      status() {
        return { available: false, reason: `No notification adapter for ${platform}`, count: 0, updatedAt: null };
      },
    },
    media: {
      async getState() {
        return {
          ok: false,
          media: { ok: false, available: false, media: null, error: `No media adapter for ${platform}` },
          volume: { ok: false, volume: 0.5, muted: false, error: `No media adapter for ${platform}` },
        };
      },
      async control() {
        throw new Error(`No media adapter for ${platform}`);
      },
      status() {
        return { media: { ok: false, available: false, error: `No media adapter for ${platform}` }, volume: { ok: false, error: `No media adapter for ${platform}` } };
      },
    },
    dispose() {},
  };
}
