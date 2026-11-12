<script lang="ts">
  import type { MediaInfo } from '../types';
  import Icon from './Icon.svelte';

  let { media }: { media: MediaInfo | null } = $props();

  const thumbnail = $derived(media?.thumbnail || '');
  const fallbackText = $derived(media ? '正在播放' : '没有正在播放的媒体');
</script>

<div class="cover-shell" class:has-art={Boolean(thumbnail)} class:has-media={Boolean(media)}>
  <div class="cover-fallback"><Icon name="music" /><small>{fallbackText}</small></div>
  <img class="cover-art" src={thumbnail || undefined} alt="专辑封面" draggable="false">
</div>

<style>
.cover-shell {
position: relative;
  width: min(100%, 350px);
  aspect-ratio: 1;
  border-radius: 26px;
  overflow: hidden;
  background:
    radial-gradient(80% 80% at 30% 20%, color-mix(in srgb, var(--accent) 30%, transparent), transparent 62%),
    var(--card-2);
  border: 1px solid var(--line-strong);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.42);
}

.cover-art {
position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: none;
}

.cover-shell.has-art .cover-art {
display: block;
}

.cover-shell.has-art .cover-fallback {
display: none;
}

.cover-fallback {
position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--muted);
  font-size: 11px;
}

.cover-fallback :global(svg) {
width: 54px;
  height: 54px;
  color: var(--accent-2);
  opacity: 0.8;
}

.cover-fallback small {
font-size: 11px;
}

@media (max-height: 760px) {
  .cover-shell {
    width: min(100%, 250px);
    border-radius: 23px;
  }
}

@media (orientation: portrait) {
  .cover-shell {
    width: min(76vw, 380px);
  }
}
</style>
