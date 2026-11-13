/**
 * Runtime capability payloads for the sidebar's system-information page.
 *
 * `dsh-probe` and Node.js are reported separately from the media/notification
 * adapters: the adapters describe features, while these describe the two
 * runtimes those features depend on.
 */

import path from 'node:path';
import { probeInfo, probeStatus, probeVersion } from './probe.js';

export interface ProbeBackends {
  media: string;
  volume: string;
  performance: string;
  notifications: string;
  location: string;
}

export interface ProbeCapability {
  ok: boolean;
  available: boolean;
  binary: string;
  platform: string;
  arch: string;
  directory: string;
  disabled: boolean;
  error: string | null;
  version: string | null;
  backends: ProbeBackends | null;
}

export interface NodeCapability {
  ok: boolean;
  version: string;
  v8: string;
  platform: string;
  arch: string;
  pid: number;
  uptimeSeconds: number;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
}

/** Probe availability plus its build identity and platform backends. */
export async function readProbeCapability(): Promise<ProbeCapability> {
  const status = probeStatus();
  const info = probeInfo();
  const version = status.available ? await probeVersion() : null;
  return {
    ok: status.available,
    available: status.available,
    binary: status.binary,
    platform: status.platform,
    arch: status.arch,
    directory: status.directory,
    disabled: info.disabled,
    error: status.error,
    version: version?.version || null,
    backends: version
      ? {
        media: version.media,
        volume: version.volume,
        performance: version.performance,
        notifications: version.notifications,
        location: version.location,
      }
      : null,
  };
}

/** The Host process's Node.js runtime, sampled at request time. */
export function readNodeCapability(): NodeCapability {
  const memory = process.memoryUsage();
  return {
    ok: true,
    version: process.version,
    v8: process.versions.v8 || '',
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
    },
  };
}

/**
 * Current DSH profile name (`web`, `desktop`, `cli`, or a user-defined name).
 *
 * The Desktop host receives the profile directory as a positional argument and
 * does not always export `DSH_PROFILE`, so read the environment first and then
 * fall back to the `profiles/<name>` argument or the profile directory's
 * basename. An empty string means this Host was started without a profile.
 */
export function readProfileName(): string {
  const fromEnv = String(process.env.DSH_PROFILE || '').trim();
  if (fromEnv) return fromEnv;
  const argv = process.argv;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '');
    const match = /(?:^|[\\/])profiles[\\/]([^\\/]+)(?:[\\/]|$)/.exec(arg);
    if (match?.[1]) return match[1];
    if (arg === '--profile' || arg === '-p') {
      const next = String(argv[index + 1] || '').trim();
      if (next) return next;
    }
    if (arg.startsWith('--profile=')) {
      const next = arg.slice('--profile='.length).trim();
      if (next) return next;
    }
  }
  const profileDir = String(process.env.DSH_PROFILE_DIR || '').trim();
  if (profileDir) {
    const base = path.basename(profileDir);
    if (base && base !== '.' && base !== path.sep) return base;
  }
  return '';
}

