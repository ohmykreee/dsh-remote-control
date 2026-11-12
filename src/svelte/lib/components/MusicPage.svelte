<script lang="ts">
  import { app } from '../state.svelte';
  import { sourceLabel } from '../format';
  import MusicControls from './MusicControls.svelte';
  import MusicCover from './MusicCover.svelte';

  const payload = $derived(app.media);
  const media = $derived(payload?.media?.media ?? null);
  const volume = $derived(payload?.volume ?? null);
  const thumbnail = $derived(media?.thumbnail || '');
  const source = $derived(media ? sourceLabel(media.appId) : '媒体');
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
