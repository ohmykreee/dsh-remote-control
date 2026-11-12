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
