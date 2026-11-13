import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// Resolve the probe to a path that cannot exist so this test exercises the
// "not built" failure state in lib/probe.js.
process.env.DSH_RC_PROBE = path.join(os.tmpdir(), 'dsh-rc-missing-probe-binary');
delete process.env.DSH_RC_DISABLE_RUST_PROBE;

const { probeInfo, probeStatus, runProbe } = await import('../lib/probe.js');

const info = probeInfo();
assert.equal(info.available, false);
assert.match(String(info.error), /native probe not built/);
assert.equal(probeStatus().available, false);
assert.match(String(probeStatus().error), /native probe not built/);

await assert.rejects(() => runProbe(['version']), /native probe not built|native probe unavailable/);

// Runtime diagnostics must report the missing probe without fabricating a
// version, while the Node.js half stays available.
const { readNodeCapability, readProbeCapability } = await import('../lib/runtime.js');
const probeCapability = await readProbeCapability();
assert.equal(probeCapability.available, false);
assert.equal(probeCapability.ok, false);
assert.equal(probeCapability.version, null);
assert.equal(probeCapability.backends, null);
assert.match(String(probeCapability.error), /native probe not built/);
const nodeCapability = readNodeCapability();
assert.equal(nodeCapability.ok, true);
assert.match(nodeCapability.version, /^v\d+/);
assert.ok(nodeCapability.memory.rss > 0);
assert.ok(nodeCapability.uptimeSeconds >= 0);

// A missing sidecar must fail cleanly: no JavaScript fallback adapter exists.
const { createProbeMediaAdapter } = await import('../lib/probe-adapter.js');
const adapter = createProbeMediaAdapter({ label: 'test' });
const state = await adapter.getState();
assert.equal(state.media.ok, false);
assert.equal(state.media.available, false);
assert.equal(state.media.media, null);
assert.equal(state.media.backend, 'rust');
assert.match(String(state.media.error), /native probe not built/);
assert.equal(state.volume.ok, false);
assert.equal(state.volume.available, false);
assert.equal(state.volume.backend, 'rust');
await assert.rejects(() => adapter.control('playpause'), /native probe not built|native probe unavailable/);
await assert.rejects(() => adapter.control('like'), /不支持修改红心|native probe not built|native probe unavailable/);

console.log('probe bridge ok');
