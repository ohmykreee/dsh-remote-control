<script lang="ts">
  import { app } from '../state.svelte';
  import { sourceLabel } from '../format';
  import MusicControls from './MusicControls.svelte';
  import MusicCover from './MusicCover.svelte';

  const payload = $derived(app.media);
  const media = $derived(payload?.media?.media ?? null);
  const volume = $derived(payload?.volume ?? null);
  const thumbnail = $derived(media?.thumbnail || media?.thumbnailUrl || '');
  const source = $derived(media ? String(media.appName || '').trim() || sourceLabel(media.appId) : '媒体');
  const backdropImage = $derived(thumbnail ? `url("${thumbnail.replace(/"/g, '\\"')}")` : '');
</script>

<div class="music-backdrop" aria-hidden="true" style:background-image={backdropImage}></div>
<div class="music-wash" aria-hidden="true"></div>
<div class="music-layout">
  <div class="music-visual">
    <MusicCover {media} />
    <div class="source-pill">{source}</div>
  </div>
  <MusicControls {payload} {media} {volume} />
</div>

<style>
.music-backdrop {
position: absolute;
  inset: -80px;
  z-index: 0;
  background:
    radial-gradient(60% 80% at 25% 40%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 68%),
    linear-gradient(145deg, #11182c, var(--bg) 72%);
  background-position: center;
  background-size: cover;
  filter: blur(46px) saturate(1.2);
  opacity: 0.45;
  transform: scale(1.1);
  transition: background-image 0.6s ease;
}

.music-wash {
position: absolute;
  inset: 0;
  z-index: 1;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--bg) 58%, transparent), color-mix(in srgb, var(--bg) 80%, transparent) 56%, var(--bg) 100%),
    linear-gradient(0deg, var(--bg), transparent 30%);
}

.music-layout {
position: relative;
  z-index: 2;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 0.86fr) minmax(0, 1.14fr);
  align-items: center;
  gap: 30px;
  padding: 18px 34px 18px 22px;
}

.music-visual {
display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.source-pill {
padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: color-mix(in srgb, var(--card) 70%, transparent);
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  backdrop-filter: blur(14px);
}

@media (max-height: 760px) {
  .music-layout {
    gap: 24px;
    padding: 12px 26px 12px 18px;
  }
}

@media (orientation: portrait) {
  .music-layout {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 100%;
    gap: 14px;
  }
  .music-layout {
    padding: 22px;
    align-content: center;
  }
}
</style>
