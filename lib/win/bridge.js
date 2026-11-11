/**
 * JavaScript bridge to the built-in Windows PowerShell host.
 *
 * No .ps1 file is shipped. Windows Runtime (SMTC / Geolocation) and Core Audio
 * have no stable plain-Node bindings, so the fixed programs live as JS strings
 * in ./scripts.js; this module executes them and parses their JSON output.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { serializeError } from '../util.js';
import { LOCATION_SCRIPT, SMTC_SCRIPT, SYSTEM_SCRIPT, VOLUME_SCRIPT } from './scripts.js';

const execFileAsync = promisify(execFile);

function powershellPath() {
  if (process.platform !== 'win32') return null;
  const root = process.env.SystemRoot || 'C:\\Windows';
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

async function runPowerShell(script, env, timeout = 12_000) {
  const exe = powershellPath();
  if (!exe) throw new Error('Windows PowerShell is not available on this platform');
  try {
    const { stdout } = await execFileAsync(
      exe,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        timeout,
        windowsHide: true,
        maxBuffer: 24 * 1024 * 1024,
        encoding: 'utf8',
        env: { ...process.env, ...env },
      },
    );
    const text = String(stdout).replace(/^\uFEFF/, '').trim();
    if (!text) throw new Error('Windows probe returned no output');
    return JSON.parse(text);
  } catch (error) {
    if (error?.stdout) {
      try {
        return JSON.parse(String(error.stdout).replace(/^\uFEFF/, '').trim());
      } catch {
        /* fall through */
      }
    }
    throw new Error(serializeError(error?.stderr || error));
  }
}

export async function runSmtc(action = 'read', options = {}) {
  const position = Number.isFinite(Number(options.position)) ? Number(options.position) : 0;
  return runPowerShell(SMTC_SCRIPT, {
    DSH_RC_ACTION: String(action),
    DSH_RC_POSITION: String(position),
    DSH_RC_APPID: String(options.appId || ''),
  });
}

export async function runVolume(action = 'read', value = 0) {
  return runPowerShell(VOLUME_SCRIPT, {
    DSH_RC_ACTION: String(action),
    DSH_RC_VALUE: String(Number.isFinite(Number(value)) ? Number(value) : 0),
  });
}

export async function readLocation() {
  return runPowerShell(LOCATION_SCRIPT, {}, 9000);
}

export async function readSystemInfo() {
  return runPowerShell(SYSTEM_SCRIPT, {}, 15_000);
}
