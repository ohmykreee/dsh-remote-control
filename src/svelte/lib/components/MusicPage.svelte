<script lang="ts">
  import { app } from '../state.svelte';
  import { sourceLabel } from '../format';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import Radio from '@lucide/svelte/icons/radio';
  import MusicControls from './MusicControls.svelte';
  import MusicCover from './MusicCover.svelte';

  const payload = $derived(app.media);
  const media = $derived(payload?.media?.media ?? null);
  const volume = $derived(payload?.volume ?? null);
  const thumbnail = $derived(media?.thumbnail || media?.thumbnailUrl || '');
  const source = $derived(media ? String(media.appName || '').trim() || sourceLabel(media.appId) : '媒体');
</script>

{#if thumbnail}
  <img
    class="music-backdrop"
    src={thumbnail}
    alt=""
    aria-hidden="true"
    draggable="false"
    referrerpolicy="no-referrer"
  />
{/if}
<div class="music-wash" aria-hidden="true"></div>

<div class="music-layout">
  <div class="music-visual">
    <MusicCover {media} />
    <div class="mt-4 flex max-w-full items-center gap-2">
      <Badge
        variant="outline"
        class="h-9 max-w-full gap-2 border-border bg-card/55 px-3.5 text-[14px] font-medium text-muted-foreground backdrop-blur-md"
      >
        <Radio class="size-4 text-brand" strokeWidth={1.8} />
        <span class="truncate">{source}</span>
      </Badge>

    </div>
  </div>

  <MusicControls {payload} {media} {volume} />
</div>

<style>
  .music-backdrop {
    position: absolute;
    top: -80px;
    left: -80px;
    z-index: 0;
    width: calc(100% + 160px);
    height: calc(100% + 160px);
    object-fit: cover;
    filter: blur(55px) saturate(1.2);
    opacity: 0.42;
    pointer-events: none;
  }

  .music-wash {
    position: absolute;
    inset: 0;
    z-index: 1;
    background:
      radial-gradient(85% 120% at 12% 50%, color-mix(in srgb, var(--brand) 14%, transparent), transparent 58%),
      linear-gradient(90deg, color-mix(in srgb, var(--background) 52%, transparent), color-mix(in srgb, var(--background) 82%, transparent) 58%, var(--background) 100%),
      linear-gradient(0deg, var(--background), transparent 44%);
    pointer-events: none;
  }

  .music-layout {
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: minmax(0, 0.86fr) minmax(0, 1.14fr);
    align-items: center;
    gap: clamp(22px, 4vw, 52px);
    width: 100%;
    height: 100%;
    padding: clamp(16px, 3vw, 34px) clamp(16px, 3.5vw, 42px);
  }

  .music-visual {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: center;
  }

  .music-visual :global(.cover-shell) {
    width: min(100%, clamp(210px, 43vh, 330px));
    border-radius: clamp(18px, 3vh, 28px);
  }

  @media (max-height: 760px) {
    .music-layout {
      gap: 24px;
      padding: 14px 24px;
    }
  }

  @media (orientation: portrait) {
    .music-layout {
      grid-template-columns: 1fr;
      height: auto;
      min-height: 100%;
      gap: 24px;
      padding: 26px 20px;
    }

    .music-visual :global(.cover-shell) {
      width: min(72vw, 320px);
    }
  }
</style>
