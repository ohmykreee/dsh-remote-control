import assert from 'node:assert/strict';
import { createMediaEnrichment } from '../lib/media-enrich.js';

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
  liked: true,
  trackId: '42',
  thumbnail: 'data:image/jpeg;base64,AAAA',
}, t0 + 16000);
assert.equal(h.canSeek, false);
assert.ok(Math.abs(h.position - 75) < 0.05, `netease private position ${h.position}`);
assert.equal(h.liked, true);
assert.equal(h.canLike, true);
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

// IsPlaybackPositionEnabled alone is not enough: a player may advertise seek
// support yet never report a position. Require an actual position report.
const j = await sample({ appId: 'test', title: 'D', artist: 'B', playbackStatus: 'Playing', position: 0, startTime: 0, endTime: 200, lastUpdatedAt: t0 + 20000, canSeek: true }, t0 + 20000);
assert.equal(j.canSeek, false);
assert.equal(j.positionReported, false);

const k = await sample({ appId: 'test', title: 'D', artist: 'B', playbackStatus: 'Playing', position: 5, startTime: 0, endTime: 200, lastUpdatedAt: t0 + 22000, canSeek: true }, t0 + 22000);
assert.equal(k.canSeek, true);
assert.equal(k.positionReported, true);

console.log('media progress ok');
