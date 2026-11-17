#!/usr/bin/env node
/**
 * Guard the npm release.
 *
 * `publish-npm.yml` only runs after `checks.yml` passed, but a green test run
 * says nothing about what the registry will actually receive: the manifest may
 * still be private, the build artifacts may be missing, the package may declare
 * install scripts that pnpm refuses to run, or the tag may disagree with the
 * version. This script asserts all of that and then inspects the real tarball
 * through `npm pack --dry-run`, so a bad release fails before the upload.
 *
 * Usage:
 *   node scripts/check-npm-package.mjs                # manifest + artifacts + tarball
 *   node scripts/check-npm-package.mjs --tag v1.0.8   # also require a matching tag
 *   node scripts/check-npm-package.mjs --no-pack      # skip the tarball inspection
 *
 * Exit code 0 means the checkout is publishable; 1 lists every problem found.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const tagIndex = args.indexOf('--tag');
const tag = tagIndex >= 0 ? String(args[tagIndex + 1] || '').trim() : '';
const skipPack = args.includes('--no-pack');

if (tagIndex >= 0 && !tag) {
  console.error('--tag requires the pushed tag name, e.g. --tag v1.0.8');
  process.exit(2);
}

/** Files the plugin cannot run without; every one of them is a build artifact. */
const REQUIRED_ARTIFACTS = [
  'index.js',
  'client.js',
  'lib/service.js',
  'lib/probe.js',
  'web/index.html',
  'locale/en.json',
  'locale/zh.json',
  'cordis.patch.yml',
  'icon.svg',
];

/** Files a consumer needs to read the docs and build the optional Rust probe. */
const REQUIRED_SOURCES = [
  'package.json',
  'README.md',
  'INSTALLATION.md',
  'LICENSE',
  'src/dsh/index.ts',
  'src/dsh/lib/probe.ts',
  'src/svelte/main.ts',
  'src/rust/Cargo.toml',
  'src/rust/src/main.rs',
  'scripts/build-rust.mjs',
  'scripts/build-dsh.mjs',
  'scripts/build-web.mjs',
  'vite.config.js',
  'tsconfig.dsh.json',
];

/** Path prefixes that must never reach the registry. */
const FORBIDDEN_PREFIXES = [
  'node_modules/',
  '.git/',
  '.github/',
  '.build/',
  '.mock-web/',
  '.probe-tmp/',
  'native/',
  'src/rust/target/',
  'test/',
  '.vscode/',
  '.idea/',
];

/** Path suffixes that must never reach the registry (local runtime state). */
const FORBIDDEN_SUFFIXES = ['.pem', '.key', '.p12', '.pfx', '.log', 'settings.json', 'notification-cache.json'];

const MAX_UNPACKED_BYTES = 25 * 1024 * 1024;
const MAX_ENTRIES = 5000;

const problems = [];
const checks = [];

function fail(message, hint) {
  problems.push(hint ? `${message}\n    ${hint}` : message);
}

function pass(summary) {
  checks.push(summary);
}

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
}

function exists(relative) {
  try {
    return statSync(path.join(root, relative)).isFile();
  } catch {
    return false;
  }
}

function search(relative, pattern) {
  if (!exists(relative)) return null;
  const match = pattern.exec(readFileSync(path.join(root, relative), 'utf8'));
  return match ? match[1] : null;
}

// ---------------------------------------------------------------- manifest
let manifest;
try {
  manifest = readJson('package.json');
} catch (error) {
  console.error(`cannot read package.json: ${error.message}`);
  process.exit(1);
}

const name = String(manifest.name || '');
const version = String(manifest.version || '');

if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(name)) {
  fail(`package name is not a publishable scoped name: ${JSON.stringify(name)}`);
}
if (manifest.private === true) {
  fail('package.json still declares "private": true, which npm refuses to publish');
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`version is not a release semver: ${JSON.stringify(version)}`);
}
for (const field of ['description', 'license']) {
  if (!String(manifest[field] || '').trim()) fail(`package.json has no "${field}"`);
}
if (!String(manifest.repository?.url || '').includes('github.com/ohmykreee/dsh-remote-control')) {
  fail('package.json repository.url must be the GitHub repository, or npm cannot attest provenance');
}
if (manifest.publishConfig?.access !== 'public') {
  fail('publishConfig.access must be "public": scoped packages default to restricted');
}
if (manifest.publishConfig?.registry !== 'https://registry.npmjs.org/') {
  fail('publishConfig.registry must be https://registry.npmjs.org/ so a mirror can never receive the release');
}
if (manifest.publishConfig?.provenance !== true) {
  fail('publishConfig.provenance must be true to attach the build attestation');
}
if (!String(manifest.engines?.node || '').trim()) {
  fail('package.json has no engines.node');
}

// pnpm 11 blocks dependency lifecycle scripts by default, and DSH reports that
// as a failed install ("build-blocked") that has to be approved and retried.
// Shipping an install script would therefore break the one-step install this
// package exists for, so the published manifest must not declare any.
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];
const declaredScripts = Object.keys(manifest.scripts || {}).filter((key) => INSTALL_SCRIPTS.includes(key));
if (declaredScripts.length > 0) {
  fail(
    `package.json declares install-time scripts: ${declaredScripts.join(', ')}`,
    'DSH installs bundles with pnpm, which blocks dependency scripts; the install would fail with pendingBuilds. Build with `pnpm build` instead.',
  );
}
if (String(manifest.dsh?.bundle?.patch || '') !== './cordis.patch.yml') {
  fail('package.json dsh.bundle.patch must point at ./cordis.patch.yml');
}

const patchName = search('cordis.patch.yml', /name:\s*['"]?([^'"\s]+)/);
if (patchName === null) {
  fail('cordis.patch.yml has no bundle name; the row would not resolve');
} else if (patchName !== name) {
  fail(
    `cordis.patch.yml registers ${JSON.stringify(patchName)} but the package is ${JSON.stringify(name)}`,
    'the bundle row name must resolve to this package, so both must match',
  );
}

// ------------------------------------------------------------------ layout
const missingArtifacts = REQUIRED_ARTIFACTS.filter((file) => !exists(file));
if (missingArtifacts.length > 0) {
  fail(`missing build artifacts: ${missingArtifacts.join(', ')}`, 'run `pnpm build` (Host + phone console) before publishing');
}
const missingSources = REQUIRED_SOURCES.filter((file) => !exists(file));
if (missingSources.length > 0) {
  fail(`missing published sources: ${missingSources.join(', ')}`, 'restore the file or update the `files` allowlist');
}

const clientId = search('client.js', /__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/);
if (clientId === null) {
  fail(
    'client.js does not register a window.__ModuleLoader__ factory with a string id',
    'rebuild with `pnpm build:dsh`; DSH resolves the client entry by that id',
  );
} else if (clientId !== name) {
  fail(
    `client.js registers the browser factory as ${JSON.stringify(clientId)} but the package is ${JSON.stringify(name)}`,
    'rebuild with `pnpm build:dsh`; DSH resolves the client entry under the package name',
  );
}

// ------------------------------------------------------------ version sync
const sourceVersion = search('src/dsh/lib/util.ts', /export const VERSION = '([^']+)'/);
if (sourceVersion !== version) {
  fail(
    `src/dsh/lib/util.ts reports VERSION=${JSON.stringify(sourceVersion)} but package.json is ${version}`,
    'update the Host version constant in the same commit as the version bump',
  );
}
const cargoVersion = search('src/rust/Cargo.toml', /^version = "([^"]+)"/m);
if (cargoVersion !== version) {
  fail(
    `src/rust/Cargo.toml is version ${JSON.stringify(cargoVersion)} but package.json is ${version}`,
    'bump the probe crate in the same commit as the package version',
  );
}

// --------------------------------------------------------------- tag guard
if (tag) {
  const normalized = tag.replace(/^v/, '');
  if (normalized !== version) {
    fail(
      `tag ${JSON.stringify(tag)} does not match package version ${version}`,
      'push the tag for the version that is actually in package.json, e.g. `git tag v1.0.8`',
    );
  } else {
    pass(`tag ${tag} matches version ${version}`);
  }
}

// ------------------------------------------------------------ tarball check
if (!skipPack && problems.length === 0) {
  const npmArgs = ['pack', '--dry-run', '--json', '--ignore-scripts'];
  let stdout;
  try {
    // `execSync` (not `execFileSync`) because npm is a `.cmd` shim on Windows;
    // the command is a constant, so no argument escaping is involved.
    stdout = execSync(`npm ${npmArgs.join(' ')}`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    fail(
      `npm pack --dry-run failed: ${String(error.stderr || error.message).trim().split('\n').slice(-3).join(' ')}`,
      'the tarball cannot be inspected, so the release cannot be verified',
    );
  }
  if (stdout) {
    let report = null;
    const start = stdout.indexOf('[');
    if (start >= 0) {
      try {
        report = JSON.parse(stdout.slice(start))[0] || null;
      } catch {
        report = null;
      }
    }
    if (!report || !Array.isArray(report.files)) {
      fail('could not parse `npm pack --dry-run --json` output');
    } else {
      const packed = new Set(report.files.map((file) => file.path));
      const required = [...REQUIRED_ARTIFACTS, ...REQUIRED_SOURCES, 'web/assets'];
      const missing = required.filter(
        (file) => !packed.has(file) && ![...packed].some((entry) => entry.startsWith(`${file}/`)),
      );
      if (missing.length > 0) {
        fail(
          `the tarball omits: ${missing.join(', ')}`,
          'add the path to package.json `files`; npm leaves out anything not listed there',
        );
      }
      if (![...packed].some((entry) => /^web\/assets\/.+\.js$/.test(entry))) {
        fail('the tarball contains no web/assets/*.js, so the phone console would be blank');
      }
      const leaked = [...packed].filter(
        (entry) =>
          FORBIDDEN_PREFIXES.some((prefix) => entry.startsWith(prefix)) ||
          FORBIDDEN_SUFFIXES.some((suffix) => entry.endsWith(suffix)),
      );
      if (leaked.length > 0) {
        fail(
          `the tarball would ship ${leaked.length} forbidden path(s): ${leaked.slice(0, 5).join(', ')}`,
          'narrow package.json `files`; local build output and runtime state must not be published',
        );
      }
      const unpacked = Number(report.unpackedSize || 0);
      if (unpacked > MAX_UNPACKED_BYTES) {
        fail(
          `the unpacked tarball is ${(unpacked / 1024 / 1024).toFixed(1)} MiB, over the ${MAX_UNPACKED_BYTES / 1024 / 1024} MiB budget`,
          'check for a build directory or screenshot set that slipped into `files`',
        );
      }
      if (report.entryCount > MAX_ENTRIES) {
        fail(`the tarball holds ${report.entryCount} entries, over the ${MAX_ENTRIES} budget`);
      }
      if (missing.length === 0 && leaked.length === 0 && unpacked <= MAX_UNPACKED_BYTES) {
        pass(
          `tarball ${report.filename || `${name}-${version}.tgz`}: ${report.entryCount} files, ` +
            `${(Number(report.size || 0) / 1024 / 1024).toFixed(2)} MiB packed / ` +
            `${(unpacked / 1024 / 1024).toFixed(2)} MiB unpacked`,
        );
      }
    }
  }
}

// -------------------------------------------------------------------- report
if (problems.length > 0) {
  console.error(`\n${name}@${version} is not publishable:\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`${name}@${version} is ready to publish`);
for (const check of checks) console.log(`  ✓ ${check}`);
