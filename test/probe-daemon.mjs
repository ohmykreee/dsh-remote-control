import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BINARY = process.platform === 'win32' ? 'dsh-probe.exe' : 'dsh-probe';
const binary = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'native',
  'bin',
  `${process.platform}-${process.arch}`,
  BINARY,
);

if (!existsSync(binary)) {
  console.log('probe daemon: skipped (native probe not built)');
  process.exit(0);
}

// Resolve the freshly built binary before importing the bridge, whose probe
// location is cached on first use.
process.env.DSH_RC_PROBE = binary;
delete process.env.DSH_RC_DISABLE_RUST_PROBE;
delete process.env.DSH_RC_DISABLE_PROBE_DAEMON;

const { runProbe, probeInfo, shutdownProbeDaemon } = await import('../lib/probe.js');

assert.equal(probeInfo().available, true);
assert.equal(probeInfo().binary, path.resolve(binary));

try {
  const version = await runProbe(['version']);
  assert.equal(version.ok, true);
  assert.equal(version.name, 'dsh-probe');

  // The second sample must reuse the daemon's sysinfo baseline; only its shape
  // is asserted here because timing belongs to the benchmark, not this test.
  const first = await runProbe(['performance'], { timeout: 20_000 });
  assert.equal(first.ok, true);
  assert.equal(typeof first.cpu?.usage, 'number');
  assert.equal(typeof first.memory?.total, 'number');

  const second = await runProbe(['performance'], { timeout: 20_000 });
  assert.equal(second.ok, true);
  assert.equal(typeof second.cpu?.usage, 'number');

  const [volume, again] = await Promise.all([
    runProbe(['volume', 'read']),
    runProbe(['version']),
  ]);
  assert.equal(typeof volume.ok, 'boolean');
  assert.equal(again.name, 'dsh-probe');

  shutdownProbeDaemon();

  // A shutdown must not poison the bridge: the next call starts a new daemon.
  const afterShutdown = await runProbe(['version']);
  assert.equal(afterShutdown.name, 'dsh-probe');
  shutdownProbeDaemon();

  // The explicit one-shot switch still works (used for diagnosis/fallback).
  process.env.DSH_RC_DISABLE_PROBE_DAEMON = '1';
  const oneShot = await runProbe(['version']);
  assert.equal(oneShot.name, 'dsh-probe');
  delete process.env.DSH_RC_DISABLE_PROBE_DAEMON;
  shutdownProbeDaemon();
} finally {
  shutdownProbeDaemon();
}

console.log('probe daemon ok');
