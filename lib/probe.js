/**
 * Bridge to the native `dsh-probe` sidecar.
 *
 * The sidecar is built per platform/arch into `native/bin/<platform>-<arch>/`
 * by `scripts/build-rust.mjs`. It is the only OS probe layer: there are no
 * PowerShell / playerctl / osascript fallbacks. When the binary is missing this
 * module reports it as unavailable and callers return a clear error state.
 *
 * Environment overrides:
 *   DSH_RC_PROBE=/absolute/path/to/dsh-probe   use a custom binary
 *   DSH_RC_DISABLE_RUST_PROBE=1               force "probe unavailable" (tests)
 *   DSH_RC_TMPDIR=/absolute/path              writable scratch dir for SQLite copies
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { serializeError } from './util.js';

const execFileAsync = promisify(execFile);
const ARCH = process.arch;
const DIRECTORY = `${process.platform}-${ARCH}`;
const BINARY = process.platform === 'win32' ? 'dsh-probe.exe' : 'dsh-probe';
const DEFAULT_BINARY = fileURLToPath(new URL(`../native/bin/${DIRECTORY}/${BINARY}`, import.meta.url));
const SCRATCH_DIRECTORY = fileURLToPath(new URL('../.probe-tmp', import.meta.url));
const FAILURE_COOLDOWN_MS = 15_000;
const MAX_BUFFER = 24 * 1024 * 1024;

/**
 * The DSH sandbox can deny the sidecar writes to the system temp directory when
 * it runs from the plugin workspace. The host creates a workspace-local scratch
 * directory and passes it to the probe for its read-only SQLite copies.
 */
function scratchDirectory() {
  try {
    mkdirSync(SCRATCH_DIRECTORY, { recursive: true });
    return SCRATCH_DIRECTORY;
  } catch {
    return null;
  }
}

let cachedInfo = null;
let failureUntil = 0;
let lastFailure = null;

/** Resolve (and cache) the sidecar location. Never throws. */
export function probeInfo() {
  if (cachedInfo) return cachedInfo;
  const disabled = /^(1|true|yes|on)$/i.test(process.env.DSH_RC_DISABLE_RUST_PROBE || '');
  const override = String(process.env.DSH_RC_PROBE || '').trim();
  const binary = override ? path.resolve(override) : DEFAULT_BINARY;
  let available = false;
  let error = null;
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
export function probeStatus() {
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

function extractJson(stdout) {
  const lines = String(stdout || '').split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line.startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch {
      /* keep looking upwards */
    }
  }
  return null;
}

function failureMessage(error) {
  const stderr = error?.stderr ? String(error.stderr).trim() : '';
  if (stderr) return stderr.slice(0, 800);
  return serializeError(error);
}

/**
 * Run a sidecar subcommand and return its JSON payload.
 *
 * Throws only when the process cannot run or produces no JSON; a well-formed
 * `{ ok: false }` payload is returned so callers can show its error.
 */
export async function runProbe(args, options = {}) {
  const info = probeInfo();
  if (!info.available) throw new Error(info.error || 'native probe unavailable');
  if (Date.now() < failureUntil) {
    throw new Error(`native probe temporarily unavailable: ${lastFailure || 'previous failure'}`);
  }
  const timeout = Number.isFinite(Number(options.timeout)) ? Number(options.timeout) : 15_000;
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
    const parsed = extractJson(error?.stdout);
    if (parsed) return parsed;
    lastFailure = failureMessage(error);
    failureUntil = Date.now() + FAILURE_COOLDOWN_MS;
    const wrapped = new Error(`dsh-probe ${args.join(' ')} failed: ${lastFailure}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

/**
 * MPRIS can return an HTTP(S) artwork URL. The sidecar has no HTTP client, so
 * download the image here and convert it to a data URL.
 */
export async function materializeThumbnail(result) {
  const media = result?.media;
  if (!media || media.thumbnail || !media.thumbnailUrl) return result;
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
