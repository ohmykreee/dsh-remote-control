import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Media pipeline and the Rust probe bridge.
 *
 * Covers timeline enrichment / seek rules, the explicit missing-probe state,
 * and the daemon transport when a native binary is available.
 */

/* ------------------------------------------------------- media enrichment */

const { createMediaEnrichment } = await import('../lib/media-enrich.js');

const enrichment = createMediaEnrichment();
const t0 = Date.now();

function sample(media, sampledAt) {
  return enrichment.enrich({
    ok: true,
    sampledAt,
    media: { canPlayPause: true, canNext: true, canPrevious: true, ...media },
  });
}

const a = await sample({ appId: 'test', title: 'A', artist: 'B', playbackStatus: 'Playing', position: 20, startTime: 0, endTime: 200, lastUpdatedAt: t0 - 1000, canSeek: true }, t0);
assert.equal(a.canSeek, true);
assert.equal(a.timelineSource, 'smtc');
assert.ok(Math.abs(a.position - 21) < 0.05, `first projection ${a.position}`);

const b = await sample({ appId: 'test', title: 'A', artist: 'B', playbackStatus: 'Playing', position: 20, startTime: 0, endTime: 200, lastUpdatedAt: t0 - 1000, canSeek: true }, t0 + 2000);
assert.ok(Math.abs(b.position - 23) < 0.05, `stale timeline projection ${b.position}`);

const c = await sample({ appId: 'test', title: 'A', artist: 'B', playbackStatus: 'Playing', position: 30, startTime: 0, endTime: 200, lastUpdatedAt: t0 + 6000, canSeek: true }, t0 + 6000);
assert.ok(Math.abs(c.position - 30) < 0.05, `external seek correction ${c.position}`);

const d = await sample({ appId: 'test', title: 'A', artist: 'B', playbackStatus: 'Paused', position: 30, startTime: 0, endTime: 200, lastUpdatedAt: t0 + 6000, canSeek: true }, t0 + 8000);
assert.ok(Math.abs(d.position - 30) < 0.05, `pause position ${d.position}`);

const e = await sample({ appId: 'test', title: 'B', artist: 'B', playbackStatus: 'Playing', position: 5, startTime: 0, endTime: 100, lastUpdatedAt: t0 + 10000, canSeek: true }, t0 + 10000);
assert.ok(Math.abs(e.position - 5) < 0.05, `track change ${e.position}`);

const f = await sample({ appId: 'test', title: 'C', artist: 'B', playbackStatus: 'Playing', position: 42, startTime: 0, endTime: 0, lastUpdatedAt: t0 + 12000, canSeek: false }, t0 + 12000);
assert.equal(f.canSeek, false);
assert.equal(f.timelineSource, 'none');

// A NetEase session receives its liked/cover data from Rust; the JS layer only
// projects the timeline and must not invent a duration or enable seeking.
const g = await sample({ appId: 'cloudmusic.exe', title: 'Song', artist: 'Artist', playbackStatus: 'Playing', position: 0, startTime: 0, endTime: 0, lastUpdatedAt: 0, canSeek: false }, t0 + 14000);
assert.equal(g.canSeek, false);
assert.equal(g.timelineSource, 'none');
assert.equal(g.endTime, 0);

const h = await sample({
  appId: 'cloudmusic.exe',
  title: 'Song',
  artist: 'Artist',
  playbackStatus: 'Playing',
  position: 75,
  startTime: 0,
  endTime: 200,
  lastUpdatedAt: 0,
  canSeek: false,
  canLike: true,
  canSetLiked: true,
  liked: true,
  trackId: '42',
  thumbnail: 'data:image/jpeg;base64,AAAA',
}, t0 + 16000);
assert.equal(h.canSeek, false);
assert.ok(Math.abs(h.position - 75) < 0.05, `netease private position ${h.position}`);
assert.equal(h.liked, true);
assert.equal(h.canLike, true);
assert.equal(h.canSetLiked, true);
assert.equal(h.trackId, '42');

const i = await sample({
  appId: 'cloudmusic.exe',
  title: 'Song',
  artist: 'Artist',
  playbackStatus: 'Playing',
  position: 75,
  startTime: 0,
  endTime: 200,
  lastUpdatedAt: 0,
  canSeek: false,
}, t0 + 18000);
assert.ok(i.position > 75.4 && i.position < 77.1, `stale position should advance smoothly, got ${i.position}`);

// CDP-only NetEase reports progress and transport control, but never a
// seekable timeline. Only an explicitly seekable system session may seek.
const cdp = await sample({
  appId: 'cloudmusic.exe',
  title: 'CDP Song',
  artist: 'Artist',
  playbackStatus: 'Playing',
  position: 10,
  startTime: 0,
  endTime: 100,
  lastUpdatedAt: 0,
  canSeek: true,
  provider: 'private',
  providerDetail: 'netease-cdp',
}, t0 + 19000);
assert.equal(cdp.canSeek, false);
assert.equal(cdp.timelineSource, 'private');

// IsPlaybackPositionEnabled alone is not enough: a player may advertise seek
// support yet never report a position. Require an actual position report.
const j = await sample({ appId: 'test', title: 'D', artist: 'B', playbackStatus: 'Playing', position: 0, startTime: 0, endTime: 200, lastUpdatedAt: t0 + 20000, canSeek: true }, t0 + 20000);
assert.equal(j.canSeek, false);
assert.equal(j.positionReported, false);

const k = await sample({ appId: 'test', title: 'D', artist: 'B', playbackStatus: 'Playing', position: 5, startTime: 0, endTime: 200, lastUpdatedAt: t0 + 22000, canSeek: true }, t0 + 22000);
assert.equal(k.canSeek, true);
assert.equal(k.positionReported, true);

// The private tier is display-only: even if a private adapter (incorrectly)
// advertised seek, the Node layer must not enable the seek bar.
const l = await sample({
  appId: 'cloudmusic.exe',
  title: 'Private Song',
  artist: 'Artist',
  playbackStatus: 'Playing',
  position: 30,
  startTime: 0,
  endTime: 200,
  lastUpdatedAt: t0 + 24000,
  canSeek: true,
  provider: 'private',
  providerDetail: 'window-title+uia',
}, t0 + 24000);
assert.equal(l.canSeek, false);
assert.equal(l.timelineSource, 'private');
assert.equal(l.provider, 'private');
assert.equal(l.providerDetail, 'window-title+uia');
assert.ok(Math.abs(l.position - 30) < 0.05, `private progress ${l.position}`);

// UI Automation/AX/AT-SPI progress is read-only as well.
const m = await sample({
  appId: 'WeSing.exe',
  title: 'Karaoke',
  artist: '',
  playbackStatus: 'Paused',
  position: 42,
  startTime: 0,
  endTime: 300,
  lastUpdatedAt: t0 + 26000,
  canSeek: true,
  provider: 'accessibility',
  providerDetail: 'window-title+uia',
}, t0 + 26000);
assert.equal(m.canSeek, false);
assert.equal(m.timelineSource, 'accessibility');

/* --------------------------------------------------------- missing probe */

// Resolve the probe to a path that cannot exist so this test exercises the
// "not built" failure state in lib/probe.js.
process.env.DSH_RC_PROBE = path.join(os.tmpdir(), 'dsh-rc-missing-probe-binary');
delete process.env.DSH_RC_DISABLE_RUST_PROBE;

const { probeInfo, probeStatus, runProbe, resetProbeCache, shutdownProbeDaemon } = await import('../lib/probe.js');

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

/* ---------------------------------------------------------- daemon bridge */

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
  console.log('media: timeline and missing probe OK; daemon skipped (native probe not built)');
} else {
  // Resolve the freshly built binary in a clean cache, then exercise the daemon.
  process.env.DSH_RC_PROBE = binary;
  delete process.env.DSH_RC_DISABLE_RUST_PROBE;
  delete process.env.DSH_RC_DISABLE_PROBE_DAEMON;
  resetProbeCache();

  assert.equal(probeInfo().available, true);
  assert.equal(probeInfo().binary, path.resolve(binary));

  try {
    const version = await runProbe(['version']);
    assert.equal(version.ok, true);
    assert.equal(version.name, 'dsh-probe');

    const capability = await readProbeCapability();
    assert.equal(capability.ok, true);
    assert.equal(typeof capability.version, 'string');
    assert.ok(capability.version.length > 0);
    assert.equal(typeof capability.backends?.media, 'string');
    assert.ok(String(capability.backends?.media).length > 0);

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
  console.log('media: timeline, missing probe, and daemon bridge OK');
}
