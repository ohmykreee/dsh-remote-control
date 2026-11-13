<script lang="ts">
  import { app, sendAction } from '../state.svelte';
  import type { MediaInfo, MediaPayload } from '../types';
  import { clampVolume, isPlaying } from '../media';
  import { Slider } from '$lib/components/ui/slider/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { cn } from '$lib/utils.js';
  import SeekBar from './SeekBar.svelte';
  import SkipBack from '@lucide/svelte/icons/skip-back';
  import SkipForward from '@lucide/svelte/icons/skip-forward';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import Heart from '@lucide/svelte/icons/heart';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import VolumeX from '@lucide/svelte/icons/volume-x';

  let {
    payload,
    media,
    volume,
  }: {
    payload: MediaPayload | null;
    media: MediaInfo | null;
    volume: { volume?: number; muted?: boolean } | null;
  } = $props();

  const playing = $derived(isPlaying(media));
  const loaded = $derived(payload !== null);
  const previousDisabled = $derived(media ? !media.canPrevious : loaded);
  const nextDisabled = $derived(media ? !media.canNext : loaded);

  const displayVolume = $derived.by(() => {
    if (app.volumeDragging) return clampVolume(app.volumeInput);
    if (Date.now() < app.volumeHoldUntil) return clampVolume(app.volumeTarget);
    return volume ? clampVolume(volume.volume ?? 0.5) : 0.5;
  });
  const volumePercent = $derived(Math.round(displayVolume * 100));

  function handleVolumeInput(value: number): void {
    app.volumeDragging = true;
    app.volumeInput = clampVolume(value / 100);
  }

  function handleVolumeCommit(value: number): void {
    app.volumeDragging = false;
    app.volumeTarget = clampVolume(value / 100);
    app.volumeHoldUntil = Date.now() + 2200;
    sendAction('volume', app.volumeTarget);
  }

  function handleLike(): void {
    if (!media?.canSetLiked || typeof media.liked !== 'boolean') return;
    sendAction('like', !media.liked);
  }
</script>

<div class="music-controls">
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <p class="eyebrow">{media?.album || 'NOW PLAYING'}</p>
      <h1 class="track-title">{media?.title || '没有播放内容'}</h1>
      <p class="track-artist">
        {media ? media.artist || media.albumArtist || '未知艺术家' : '选择一首歌开始播放'}
      </p>
    </div>

    {#if typeof media?.liked === 'boolean'}
      <Button
        variant="outline"
        size="icon"
        class={cn(
          'mt-1 size-12 shrink-0 rounded-full border-border bg-card/50 text-muted-foreground shadow-none backdrop-blur-md hover:bg-secondary hover:text-foreground',
          media.liked && 'border-danger/25 bg-danger-soft text-danger hover:bg-danger-soft hover:text-danger',
        )}
        disabled={!media.canSetLiked}
        title={media.liked ? '取消喜欢' : '喜欢'}
        aria-label={media.liked ? '取消喜欢' : '喜欢'}
        onclick={handleLike}
      >
        <Heart class={cn('size-[22px]', media.liked && 'fill-current')} strokeWidth={1.8} />
      </Button>
    {/if}
  </div>

  <SeekBar {media} onSeek={(value) => sendAction('seek', value)} />

  <div class="transport">
    <Button
      variant="outline"
      size="icon"
      class="transport-button size-[58px] rounded-full border-border bg-card/50 text-foreground shadow-none backdrop-blur-md hover:bg-secondary"
      type="button"
      aria-label="上一首"
      disabled={previousDisabled}
      onclick={() => sendAction('previous')}
    >
      <SkipBack class="size-[24px]" strokeWidth={1.7} />
    </Button>

    <Button
      size="icon"
      class="play-button size-[72px] rounded-full border border-brand/35 bg-primary text-primary-foreground shadow-none hover:bg-primary/90"
      type="button"
      aria-label={playing ? '暂停' : '播放'}
      onclick={() => sendAction('playpause')}
    >
      {#if playing}
        <Pause class="size-[30px] fill-current" strokeWidth={1.5} />
      {:else}
        <Play class="ml-1 size-[30px] fill-current" strokeWidth={1.5} />
      {/if}
    </Button>

    <Button
      variant="outline"
      size="icon"
      class="transport-button size-[58px] rounded-full border-border bg-card/50 text-foreground shadow-none backdrop-blur-md hover:bg-secondary"
      type="button"
      aria-label="下一首"
      disabled={nextDisabled}
      onclick={() => sendAction('next')}
    >
      <SkipForward class="size-[24px]" strokeWidth={1.7} />
    </Button>
  </div>

  <div class="volume-row">
    <Button
      variant="outline"
      size="icon"
      class="size-12 shrink-0 rounded-[14px] border-border bg-card/50 text-muted-foreground shadow-none backdrop-blur-md hover:bg-secondary hover:text-foreground"
      type="button"
      aria-label="静音"
      title="静音"
      onclick={() => sendAction('mute')}
    >
      {#if volume?.muted}
        <VolumeX class="size-[22px]" strokeWidth={1.7} />
      {:else}
        <Volume2 class="size-[22px]" strokeWidth={1.7} />
      {/if}
    </Button>
    <Slider
      type="single"
      min={0}
      max={100}
      step={1}
      value={volumePercent}
      aria-label="音量"
      class="volume-slider max-w-[280px]"
      onValueChange={handleVolumeInput}
      onValueCommit={handleVolumeCommit}
    />
    <span class="w-14 text-right text-[16px] text-muted-foreground numeric">{volumePercent}%</span>
  </div>
</div>

<style>
  .music-controls {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: clamp(16px, 2.8vh, 26px);
    padding-right: clamp(0px, 2vw, 24px);
  }

  .track-title {
    margin: 7px 0 0;
    display: -webkit-box;
    overflow: hidden;
    color: var(--foreground);
    font-size: clamp(34px, 4.7vw, 52px);
    font-weight: 570;
    line-height: 1.08;
    letter-spacing: -0.05em;
    overflow-wrap: anywhere;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .track-artist {
    margin: 8px 0 0;
    overflow: hidden;
    color: var(--muted-foreground);
    font-size: clamp(17px, 2vw, 21px);
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }


  .transport {
    display: flex;
    align-items: center;
    gap: clamp(12px, 2vw, 20px);
  }

  :global(.transport-button:disabled) {
    opacity: 0.35;
  }

  :global(.volume-slider [data-slot='slider-track']) {
    height: 6px;
    background: color-mix(in srgb, var(--foreground) 12%, transparent);
  }

  :global(.volume-slider [data-slot='slider-range']) {
    background: var(--brand);
  }

  :global(.volume-slider [data-slot='slider-thumb']) {
    width: 18px;
    height: 18px;
    border-width: 2px;
    background: var(--background);
    box-shadow: none;
  }

  .volume-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  @media (max-height: 760px) {
    .music-controls {
      gap: 14px;
    }

    .track-title {
      font-size: clamp(30px, 4vw, 40px);
    }

    .track-artist {
      font-size: 17px;
    }

    :global(.transport-button) {
      width: 62px;
      height: 62px;
    }

    :global(.play-button) {
      width: 80px;
      height: 80px;
    }
  }

  @media (orientation: portrait) {
    .music-controls {
      padding-right: 0;
    }
  }
</style>
