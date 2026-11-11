import assert from 'node:assert/strict';
import { createMediaService } from '../lib/media.js';

const service = createMediaService();
const enrich = service.__test.enrichMedia;
const t0 = Date.now();

function sample(media, sampledAt) {
  return enrich({ ok: true, sampledAt, media: { canPlayPause: true, canNext: true, canPrevious: true, ...media } });
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

// NetEase's private progress report must never be seekable.
const g = await sample({ appId: 'cloudmusic.exe', title: '__dsh_missing_track__', artist: 'nobody', playbackStatus: 'Playing', position: 0, startTime: 0, endTime: 0, lastUpdatedAt: 0, canSeek: false }, t0 + 14000);
assert.equal(g.canSeek, false);
assert.equal(g.timelineSource, 'netease');
assert.ok(g.endTime > 0, `netease fallback duration ${g.endTime}`);

const h = await sample({ appId: 'cloudmusic.exe', title: '__dsh_missing_track_2__', artist: 'nobody', playbackStatus: 'Playing', position: 75, startTime: 0, endTime: 0, lastUpdatedAt: 0, canSeek: false }, t0 + 16000);
assert.equal(h.canSeek, false);
assert.ok(Math.abs(h.position - 75) < 0.05, `netease private position ${h.position}`);

const i = await sample({ appId: 'cloudmusic.exe', title: '__dsh_missing_track_2__', artist: 'nobody', playbackStatus: 'Playing', position: 75, startTime: 0, endTime: 0, lastUpdatedAt: 0, canSeek: false }, t0 + 18000);
assert.ok(i.position > 75.4 && i.position < 77.1, `netease stale position should advance smoothly, got ${i.position}`);

// IsPlaybackPositionEnabled alone is not enough: a player may advertise seek
// support yet never report a position. Require an actual position report.
const j = await sample({ appId: 'test', title: 'D', artist: 'B', playbackStatus: 'Playing', position: 0, startTime: 0, endTime: 200, lastUpdatedAt: t0 + 20000, canSeek: true }, t0 + 20000);
assert.equal(j.canSeek, false);
assert.equal(j.positionReported, false);

const k = await sample({ appId: 'test', title: 'D', artist: 'B', playbackStatus: 'Playing', position: 5, startTime: 0, endTime: 200, lastUpdatedAt: t0 + 22000, canSeek: true }, t0 + 22000);
assert.equal(k.canSeek, true);
assert.equal(k.positionReported, true);

// NetEase can advertise a duration + seek support without ever reporting a
// position. That still must stay display-only.
const l = await sample({ appId: 'cloudmusic.exe', title: '__dsh_missing_track_3__', artist: 'nobody', playbackStatus: 'Playing', position: 0, startTime: 0, endTime: 200, lastUpdatedAt: t0 + 24000, canSeek: true }, t0 + 24000);
assert.equal(l.canSeek, false);
assert.equal(l.positionReported, false);
assert.equal(l.timelineSource, 'netease');

const m = await sample({ appId: 'cloudmusic.exe', title: '__dsh_missing_track_3__', artist: 'nobody', playbackStatus: 'Playing', position: 10, startTime: 0, endTime: 200, lastUpdatedAt: t0 + 26000, canSeek: true }, t0 + 26000);
assert.equal(m.canSeek, true);
assert.equal(m.positionReported, true);

await assert.rejects(() => service.control('seek', 10), /不支持拖动/);

console.log('media progress ok');
