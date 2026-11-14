/**
 * Bridge to the native `dsh-probe` sidecar.
 *
 * The sidecar is built per platform/arch into `native/bin/<platform>-<arch>/`
 * by `scripts/build-rust.mjs` (its Rust source lives in `src/rust`). It is the
 * only OS probe layer: there are no PowerShell / playerctl / osascript
 * fallbacks. When the binary is missing this module reports it as unavailable
 * and callers return a clear error state.
 *
 * Environment overrides:
 *   DSH_RC_PROBE=/absolute/path/to/dsh-probe   use a custom binary
 *   DSH_RC_DISABLE_RUST_PROBE=1               force "probe unavailable" (tests)
 *   DSH_RC_TMPDIR=/absolute/path              writable scratch dir for SQLite copies
 */

import { execFile } from 'node:child_process';
import type { ExecFileOptionsWithStringEncoding } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeError } from './util.js';
import type { JsonRecord, ProbeMediaResult } from './types.js';
import { isRecord } from './types.js';
import { ProbeDaemonClient, ProbeDaemonStartError } from './probe-daemon.js';

const ARCH = process.arch;
const DIRECTORY = `${process.platform}-${ARCH}`;
const BINARY = process.platform === 'win32' ? 'dsh-probe.exe' : 'dsh-probe';
const DEFAULT_BINARY = fileURLToPath(new URL(`../native/bin/${DIRECTORY}/${BINARY}`, import.meta.url));
const SCRATCH_DIRECTORY = fileURLToPath(new URL('../.probe-tmp', import.meta.url));
const FAILURE_COOLDOWN_MS = 15_000;
const DAEMON_RETRY_MS = 60_000;
const MAX_BUFFER = 24 * 1024 * 1024;

export interface ProbeInfo {
  available: boolean;
  binary: string;
  platform: NodeJS.Platform;
  arch: string;
  directory: string;
  disabled: boolean;
  error: string | null;
}

export interface ProbeStatus {
  available: boolean;
  binary: string;
  platform: NodeJS.Platform;
  arch: string;
  directory: string;
  error: string | null;
}

/** Platform backends reported by `dsh-probe version`. */
export interface ProbeVersionInfo {
  version: string;
  os: string;
  arch: string;
  media: string;
  volume: string;
  performance: string;
  notifications: string;
  location: string;
}

export interface RunProbeOptions {
  timeout?: number;
}

interface ExecFileResult {
  stdout: string;
  stderr: string;
}

/** `execFile` with an explicit promise shape so callers get string stdout. */
function execFileAsync(
  file: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding,
): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * The DSH sandbox can deny the sidecar writes to the system temp directory when
 * it runs from the plugin workspace. The host creates a workspace-local scratch
 * directory and passes it to the probe for its read-only SQLite copies.
 */
function scratchDirectory(): string | null {
  try {
    mkdirSync(SCRATCH_DIRECTORY, { recursive: true });
    return SCRATCH_DIRECTORY;
  } catch {
    return null;
  }
}

let cachedInfo: ProbeInfo | null = null;
let failureUntil = 0;
let lastFailure: string | null = null;
let daemonClient: ProbeDaemonClient | null = null;
let daemonDisabledUntil = 0;
let exitHookInstalled = false;

/** Resolve (and cache) the sidecar location. Never throws. */
export function probeInfo(): ProbeInfo {
  if (cachedInfo) return cachedInfo;
  const disabled = /^(1|true|yes|on)$/i.test(process.env.DSH_RC_DISABLE_RUST_PROBE || '');
  const override = String(process.env.DSH_RC_PROBE || '').trim();
  const binary = override ? path.resolve(override) : DEFAULT_BINARY;
  let available = false;
  let error: string | null = null;
  if (disabled) {
    error = 'native probe disabled by DSH_RC_DISABLE_RUST_PROBE';
  } else {
    try {
      if (!existsSync(binary)) error = `native probe not built: ${binary}`;
      else if (!statSync(binary).isFile()) error = `native probe path is not a file: ${binary}`;
      else available = true;
    } catch (failure) {
      error = serializeError(failure);
    }
  }
  cachedInfo = {
    available,
    binary,
    platform: process.platform,
    arch: ARCH,
    directory: DIRECTORY,
    disabled,
    error,
  };
  return cachedInfo;
}

/** Availability plus the most recent failure, for diagnostics payloads. */
export function probeStatus(): ProbeStatus {
  const info = probeInfo();
  const coolingDown = Date.now() < failureUntil;
  return {
    available: info.available && !coolingDown,
    binary: info.binary,
    platform: info.platform,
    arch: info.arch,
    directory: info.directory,
    error: info.error || (coolingDown ? lastFailure : null),
  };
}

let versionCache: { until: number; value: ProbeVersionInfo | null } | null = null;

/**
 * Read the probe's build identity and platform backends.
 *
 * This is a diagnostics read, so it deliberately bypasses the shared failure
 * cooldown: a broken `version` response must not make media/performance look
 * unavailable. Results are cached briefly because the settings page may be
 * opened repeatedly.
 */
export async function probeVersion(): Promise<ProbeVersionInfo | null> {
  if (versionCache && Date.now() < versionCache.until) return versionCache.value;
  const info = probeInfo();
  if (!info.available) {
    versionCache = { until: Date.now() + 30_000, value: null };
    return null;
  }
  try {
    const scratch = scratchDirectory();
    const { stdout } = await execFileAsync(info.binary, ['version'], {
      timeout: 2_500,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
      env: scratch ? { ...process.env, DSH_RC_TMPDIR: scratch } : process.env,
    });
    const payload = extractJson(stdout);
    if (!payload || payload.ok === false) throw new Error('dsh-probe version returned no payload');
    const value: ProbeVersionInfo = {
      version: String(payload.version || ''),
      os: String(payload.os || ''),
      arch: String(payload.arch || ''),
      media: String(payload.media || ''),
      volume: String(payload.volume || ''),
      performance: String(payload.performance || ''),
      notifications: String(payload.notifications || ''),
      location: String(payload.location || ''),
    };
    versionCache = { until: Date.now() + 30_000, value };
    return value;
  } catch {
    versionCache = { until: Date.now() + 15_000, value: null };
    return null;
  }
}

function extractJson(stdout: unknown): JsonRecord | null {
  const lines = String(stdout || '').split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line.startsWith('{')) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) return parsed;
    } catch {
      /* keep looking upwards */
    }
  }
  return null;
}

function failureMessage(error: unknown): string {
  let stderrValue: unknown;
  if (error instanceof Error) stderrValue = (error as Error & { stderr?: unknown }).stderr;
  else if (isRecord(error)) stderrValue = error.stderr;
  const stderr = stderrValue ? String(stderrValue).trim() : '';
  if (stderr) return stderr.slice(0, 800);
  return serializeError(error);
}

/** Commands that only read state and are safe to replay after a daemon crash. */
function isReadOnlyCommand(args: string[]): boolean {
  const command = args[0];
  if (command === 'version' || command === 'performance' || command === 'perf') return true;
  if (command === 'notifications' || command === 'notification') return args[1] !== 'watch';
  if (command === 'location') return args[1] !== 'request';
  if (command === 'media') {
    const action = args[1] || 'read';
    return action === 'read';
  }
  if (command === 'volume') {
    const action = args[1] || 'read';
    return action === 'read';
  }
  return false;
}

function daemonAllowed(): boolean {
  if (Date.now() < daemonDisabledUntil) return false;
  return !/^(0|false|no|off)$/i.test(process.env.DSH_RC_DISABLE_PROBE_DAEMON || '');
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    daemonClient?.kill();
  });
}

function ensureDaemon(info: ProbeInfo): ProbeDaemonClient {
  if (!daemonClient) {
    const scratch = scratchDirectory();
    const env = scratch ? { ...process.env, DSH_RC_TMPDIR: scratch } : process.env;
    daemonClient = new ProbeDaemonClient(info.binary, env);
    installExitHook();
  }
  return daemonClient;
}

function dropDaemon(): void {
  const client = daemonClient;
  daemonClient = null;
  client?.shutdown();
}

/** Stop the daemon on plugin unload; the next probe call starts a fresh one. */
export function shutdownProbeDaemon(): void {
  dropDaemon();
}

/**
 * Test seam: forget the cached sidecar path and daemon state so one process can
 * exercise the missing, one-shot and daemon paths against different binaries.
 */
export function resetProbeCache(): void {
  dropDaemon();
  cachedInfo = null;
  failureUntil = 0;
  lastFailure = null;
  daemonDisabledUntil = 0;
}

/** One-shot fallback used when the daemon is disabled or unsupported. */
async function runProbeOnce(args: string[], timeout: number, info: ProbeInfo): Promise<JsonRecord> {
  const scratch = scratchDirectory();
  try {
    const { stdout, stderr } = await execFileAsync(info.binary, args, {
      timeout,
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
      encoding: 'utf8',
      env: scratch ? { ...process.env, DSH_RC_TMPDIR: scratch } : process.env,
    });
    const parsed = extractJson(stdout);
    if (!parsed) {
      throw new Error(`dsh-probe ${args.join(' ')} returned no JSON${stderr ? `: ${String(stderr).trim().slice(0, 500)}` : ''}`);
    }
    lastFailure = null;
    failureUntil = 0;
    return parsed;
  } catch (error) {
    // A usage error still prints JSON and exits 2; surface that payload.
    const parsed = extractJson((error as { stdout?: unknown } | null)?.stdout);
    if (parsed) return parsed;
    lastFailure = failureMessage(error);
    failureUntil = Date.now() + FAILURE_COOLDOWN_MS;
    const wrapped = new Error(`dsh-probe ${args.join(' ')} failed: ${lastFailure}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

/**
 * Run a sidecar subcommand and return its JSON payload.
 *
 * Uses the persistent daemon when available; falls back to a one-shot process
 * when the daemon cannot start (older binary, spawn failure) or the environment
 * disables it. A request that already reached a running daemon is not replayed
 * unless it is read-only, so media actions cannot be executed twice.
 *
 * Throws only when the process cannot run or produces no JSON; a well-formed
 * `{ ok: false }` payload is returned so callers can show its error.
 */
export async function runProbe(args: string[], options: RunProbeOptions = {}): Promise<JsonRecord> {
  const info = probeInfo();
  if (!info.available) throw new Error(info.error || 'native probe unavailable');
  if (Date.now() < failureUntil) {
    throw new Error(`native probe temporarily unavailable: ${lastFailure || 'previous failure'}`);
  }
  const timeout = Number.isFinite(Number(options.timeout)) ? Number(options.timeout) : 15_000;

  if (daemonAllowed()) {
    try {
      const result = await ensureDaemon(info).request(args, timeout);
      lastFailure = null;
      failureUntil = 0;
      return result;
    } catch (error) {
      const startFailure = error instanceof ProbeDaemonStartError;
      if (startFailure) {
        // Nothing was executed yet, so every command may retry one-shot.
        daemonDisabledUntil = Date.now() + DAEMON_RETRY_MS;
        dropDaemon();
        return runProbeOnce(args, timeout, info);
      }
      daemonDisabledUntil = Date.now() + DAEMON_RETRY_MS;
      dropDaemon();
      if (isReadOnlyCommand(args)) return runProbeOnce(args, timeout, info);
      lastFailure = failureMessage(error);
      const wrapped = new Error(`dsh-probe ${args.join(' ')} failed: ${lastFailure}`);
      wrapped.cause = error;
      throw wrapped;
    }
  }

  return runProbeOnce(args, timeout, info);
}

/**
 * MPRIS can return an HTTP(S) artwork URL. The sidecar has no HTTP client, so
 * download the image here and convert it to a data URL.
 */
export async function materializeThumbnail(result: ProbeMediaResult): Promise<ProbeMediaResult> {
  const media = result?.media;
  if (!media || media.thumbnail || !media.thumbnailUrl) return result;
  // CDP covers are plain image URLs; let the control-end browser fetch and
  // cache them directly instead of downloading the image on every poll.
  if (String(media.providerDetail || '').toLowerCase().includes('cdp')) return result;
  if (!/^https?:\/\//i.test(media.thumbnailUrl)) return result;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(media.thumbnailUrl, { signal: controller.signal });
    if (!response.ok) return result;
    const mime = String(response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!mime.startsWith('image/')) return result;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) return result;
    media.thumbnail = `data:${mime};base64,${bytes.toString('base64')}`;
    media.thumbnailType = mime;
  } catch {
    /* fall back to whatever image the adapter already had */
  } finally {
    clearTimeout(timer);
  }
  return result;
}
