#!/usr/bin/env node
/**
 * Build the `dsh-probe` Rust sidecar and copy it to
 * `native/bin/<platform>-<arch>/dsh-probe[.exe]`.
 *
 * The Rust source lives in `src/rust`; the binary is intentionally gitignored:
 * it is a local build artifact, not part of the repository or the npm package.
 *
 * Usage:
 *   node scripts/build-rust.mjs             release build (recommended)
 *   node scripts/build-rust.mjs --debug     debug build
 *   node scripts/build-rust.mjs --target x86_64-unknown-linux-gnu
 *   node scripts/build-rust.mjs --skip-build  only copy an existing artifact
 *   node scripts/build-rust.mjs --optional    used by postinstall: warn and
 *                                             succeed when Rust is unavailable
 */

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = path.join(root, 'src', 'rust', 'Cargo.toml');
const archNames = { x64: 'x64', arm64: 'arm64', ia32: 'ia32', arm: 'arm' };

const args = process.argv.slice(2);
const debug = args.includes('--debug');
const skipBuild = args.includes('--skip-build');
const optional = args.includes('--optional');
const targetIndex = args.indexOf('--target');
const target = targetIndex >= 0 ? args[targetIndex + 1] : null;
if (targetIndex >= 0 && !target) {
  console.error('--target requires a Rust target triple');
  process.exit(2);
}

function targetTripleParts(triple) {
  if (!triple) return { platform: process.platform, arch: process.arch };
  const lower = triple.toLowerCase();
  let platform;
  if (lower.includes('windows')) platform = 'win32';
  else if (lower.includes('linux')) platform = 'linux';
  else if (lower.includes('darwin') || lower.includes('apple')) platform = 'darwin';
  else {
    console.error(`Unsupported --target triple (expected windows/linux/darwin): ${triple}`);
    process.exit(2);
  }
  let arch;
  if (lower.startsWith('x86_64') || lower.startsWith('amd64')) arch = 'x64';
  else if (lower.startsWith('aarch64') || lower.startsWith('arm64')) arch = 'arm64';
  else if (lower.startsWith('i686') || lower.startsWith('i386')) arch = 'ia32';
  else if (lower.startsWith('armv7') || lower.startsWith('arm')) arch = 'arm';
  else arch = process.arch;
  return { platform, arch: archNames[arch] || arch };
}

const effective = targetTripleParts(target);
const binaryName = effective.platform === 'win32' ? 'dsh-probe.exe' : 'dsh-probe';
const platformDir = `${effective.platform}-${effective.arch}`;
const outputDir = path.join(root, 'native', 'bin', platformDir);
const output = path.join(outputDir, binaryName);

function bail(message, code = 1) {
  if (optional) {
    console.warn(`${message}\nSkipping the optional Rust probe build; the console will report the probe as unavailable.`);
    process.exit(0);
  }
  console.error(message);
  process.exit(code);
}

/**
 * Visual Studio's C++ tools are required for the bundled SQLite build. A normal
 * terminal does not have `cl.exe`'s environment, so locate `vcvars64.bat` and
 * run cargo through it. `DSH_RC_VCVARS` can override the path.
 */
function findVcvars() {
  if (process.platform !== 'win32') return null;
  const override = String(process.env.DSH_RC_VCVARS || '').trim();
  if (override && existsSync(override)) return override;
  if (process.env.VCINSTALLDIR) {
    const candidate = path.join(process.env.VCINSTALLDIR, 'Auxiliary', 'Build', 'vcvars64.bat');
    if (existsSync(candidate)) return candidate;
  }
  const vswhere = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe',
  );
  if (!existsSync(vswhere)) return null;
  try {
    const found = execFileSync(
      vswhere,
      [
        '-latest',
        '-products',
        '*',
        '-requires',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-find',
        'VC\\Auxiliary\\Build\\vcvars64.bat',
      ],
      { encoding: 'utf8', timeout: 15_000 },
    )
      .trim()
      .split(/\r?\n/)[0];
    return found && existsSync(found) ? found : null;
  } catch {
    return null;
  }
}

function quoteArg(value) {
  const text = String(value);
  return /\s/.test(text) ? `"${text}"` : text;
}

function runCargo(buildArgs) {
  const vcvars = findVcvars();
  if (vcvars) {
    console.log(`> MSVC environment: ${vcvars}`);
    // A temporary .cmd file avoids cmd.exe quoting problems with paths that
    // contain spaces (the Visual Studio installation path usually does).
    const script = path.join(root, `.build-rust-${process.pid}.cmd`);
    const lines = [
      '@echo off',
      `call ${quoteArg(vcvars)} >nul`,
      `if errorlevel 1 exit /b 1`,
      [quoteArg(cargo), ...buildArgs.map(quoteArg)].join(' '),
    ];
    try {
      writeFileSync(script, `${lines.join('\r\n')}\r\n`, 'utf8');
      execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', script], {
        cwd: root,
        stdio: 'inherit',
      });
    } finally {
      try {
        unlinkSync(script);
      } catch {
        /* best effort */
      }
    }
    return;
  }
  console.log(`> ${cargo} ${buildArgs.join(' ')}`);
  execFileSync(cargo, buildArgs, { cwd: root, stdio: 'inherit' });
}

if (/^(1|true|yes|on)$/i.test(process.env.DSH_RC_SKIP_RUST_BUILD || '')) {
  console.log('Skipping dsh-probe build (DSH_RC_SKIP_RUST_BUILD is set)');
  process.exit(0);
}

if (!existsSync(manifest)) {
  bail(`Cargo manifest not found: ${manifest}`);
}

/**
 * Windows process integrity guard.
 *
 * Windows refuses location access to Low-integrity processes. A workspace that
 * was once created by a sandboxed process can carry a `Low` mandatory label on
 * the project directory; every build artifact inherits it, so `dsh-probe.exe`
 * would run at Low integrity and WinRT geolocation always answers "denied"
 * even when the privacy settings allow desktop apps.
 *
 * Raising a *file* from Low to Medium needs `SeRelabelPrivilege` (admin), but
 * raising a directory to the caller's own level does not, and recreating a
 * generated child directory makes it inherit the parent's Medium label. This
 * repair only runs when a Low label is actually present, so normal checkouts
 * keep their ACLs untouched.
 */
function runIcacls(args) {
  try {
    execFileSync('icacls', args, { stdio: 'ignore', windowsHide: true, timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

function hasLowLabel(target) {
  try {
    const output = execFileSync('icacls', [target], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20_000,
    });
    return /Low Mandatory Level/i.test(output);
  } catch {
    return false;
  }
}

function ensureMediumIntegrity(directory) {
  if (process.platform !== 'win32') return;
  const segments = path.relative(root, directory).split(path.sep).filter(Boolean);
  const targets = [root, ...segments.map((_, index) => path.join(root, ...segments.slice(0, index + 1)))];
  if (!targets.some((target) => existsSync(target) && hasLowLabel(target))) return;

  console.log('> repairing Low integrity labels on the probe build directory');
  if (hasLowLabel(root)) {
    runIcacls([root, '/setintegritylevel', '(OI)(CI)Medium']);
    if (hasLowLabel(root)) {
      console.warn(
        [
          'The workspace directory is still Low integrity after the repair attempt.',
          'Windows needs SeRelabelPrivilege to raise a directory inherited from a parent,',
          'so run the build from a normal (non-sandboxed) terminal, or follow the',
          '"Windows low-integrity workspace" guide in INSTALLATION.md.',
        ].join('\n'),
      );
      return;
    }
  }
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!existsSync(current)) {
      mkdirSync(current, { recursive: true });
      continue;
    }
    runIcacls([current, '/setintegritylevel', '(OI)(CI)Medium']);
    if (!hasLowLabel(current)) continue;
    // Generated directories under native/ can be recreated; the child then
    // inherits the parent's Medium label instead of the stale Low one.
    if (current === path.join(root, 'native') || current.startsWith(`${path.join(root, 'native')}${path.sep}`)) {
      rmSync(current, { recursive: true, force: true });
      mkdirSync(current, { recursive: true });
      if (hasLowLabel(current)) {
        console.warn(`Could not raise the integrity label of ${path.relative(root, current)}; location may be denied.`);
      }
    }
  }
}

function installBinary(sourceFile, targetFile) {
  const deadline = Date.now() + 20_000;
  let lastError = null;
  for (;;) {
    try {
      if (existsSync(targetFile)) rmSync(targetFile, { force: true });
      copyFileSync(sourceFile, targetFile);
      return;
    } catch (error) {
      lastError = error;
      const code = error?.code;
      // Windows locks running executables; the console polls the probe every
      // couple of seconds, so wait for a poll gap instead of failing the build.
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') throw error;
      if (Date.now() >= deadline) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
  throw new Error(
    `could not replace ${path.relative(root, targetFile)} because it is running (${lastError?.message || lastError}); stop the remote console or retry in a moment`,
  );
}

const profile = debug ? 'debug' : 'release';
const cargo = process.env.CARGO || 'cargo';

if (!skipBuild) {
  const buildArgs = ['build', `--${profile}`, '--manifest-path', manifest];
  if (target) buildArgs.push('--target', target);
  try {
    runCargo(buildArgs);
  } catch (error) {
    bail(
      [
        'Rust build failed.',
        'Install the Rust toolchain first: https://rustup.rs',
        'Windows: install "Desktop development with C++" in Visual Studio Build Tools.',
        'Linux: install gcc (or clang) and glibc development headers.',
        `Reason: ${error?.message || error}`,
      ].join('\n'),
      error?.status || 1,
    );
  }
}

const targetDir = path.join(root, 'src', 'rust', 'target');
const source = target
  ? path.join(targetDir, target, profile, binaryName)
  : path.join(targetDir, profile, binaryName);
if (!existsSync(source)) {
  bail(`Built binary not found: ${source}\nRun without --skip-build, or pass the matching --target triple.`);
}

try {
  mkdirSync(outputDir, { recursive: true });
  ensureMediumIntegrity(outputDir);
  installBinary(source, output);
  if (effective.platform !== 'win32') chmodSync(output, 0o755);
} catch (error) {
  bail(`Could not install the Rust probe: ${error?.message || error}`);
}

const size = statSync(output).size;
console.log(`\nCopied ${path.relative(root, source)} -> ${path.relative(root, output)} (${(size / 1024).toFixed(0)} KiB)`);

try {
  const version = execFileSync(output, ['version'], { encoding: 'utf8', timeout: 15_000 }).trim();
  console.log(`Smoke check: ${version}`);
} catch (error) {
  console.warn(`Warning: could not run the built probe: ${error.message}`);
}
