<script lang="ts">
  import { app, sendAction } from '../state.svelte';
  import type { MediaInfo, MediaPayload } from '../types';
  import { clampVolume, isPlaying, isSeekable, mediaDuration, projectedPosition, seekMaximum } from '../media';
  import { formatDuration } from '../format';
  import Icon from './Icon.svelte';

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
  const seekable = $derived(isSeekable(media));
  const loaded = $derived(payload !== null);
  const duration = $derived(mediaDuration(media));
  const max = $derived(seekMaximum(media));
  const position = $derived.by(() => {
    if (!media) return 0;
    if (app.seekDragging) return app.seekInput;
    if (Date.now() < app.seekHoldUntil && app.seekTarget > 0) return app.seekTarget;
    return projectedPosition(media, app.mediaReceivedAt, app.mediaNow);
  });
  const seekPercent = $derived(max > 0 ? Math.max(0, Math.min(100, (position / max) * 100)) : 0);

  const displayVolume = $derived.by(() => {
    if (app.volumeDragging) return clampVolume(app.volumeInput);
    if (Date.now() < app.volumeHoldUntil) return clampVolume(app.volumeTarget);
    return volume ? clampVolume(volume.volume ?? 0.5) : 0.2;
  });
  const volumePercent = $derived(displayVolume * 100);
  const seekDisabled = $derived(media ? !seekable || Number(media.endTime) <= 0 : true);
  const previousDisabled = $derived(media ? !media.canPrevious : loaded);
  const nextDisabled = $derived(media ? !media.canNext : loaded);

  function handleSeekDown(): void {
    if (!media || !seekable) return;
    app.seekDragging = true;
    app.seekInput = position;
  }

  function handleSeekInput(event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value) || 0;
    app.seekDragging = true;
    app.seekInput = value;
  }

  function handleSeekChange(event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value) || 0;
    app.seekDragging = false;
    app.seekTarget = value;
    app.seekHoldUntil = Date.now() + 2600;
    sendAction('seek', value);
  }

  function handleSeekUp(): void {
    setTimeout(() => {
      app.seekDragging = false;
      app.mediaNow = Date.now();
    }, 220);
  }

  function handleVolumeDown(): void {
    app.volumeDragging = true;
    app.volumeInput = displayVolume;
  }

  function handleVolumeInput(event: Event): void {
    app.volumeDragging = true;
    app.volumeInput = Number((event.currentTarget as HTMLInputElement).value) || 0;
  }

  function handleVolumeChange(event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value) || 0;
    app.volumeDragging = false;
    app.volumeTarget = value;
    app.volumeHoldUntil = Date.now() + 2200;
    sendAction('volume', value);
  }

  function handleLike(): void {
    if (!media?.canSetLiked || typeof media.liked !== 'boolean') return;
    sendAction('like', !media.liked);
  }

</script>

<div class="music-controls">
  <div class="track-copy">
    <span class="kicker">{media?.album ? media.album.toUpperCase() : 'NOW PLAYING'}</span>
    <h1>{media?.title || '未在播放'}</h1>
    <p>{media ? media.artist || media.albumArtist || '未知艺术家' : payload?.media?.error || '在电脑上打开播放器后，这里会显示当前媒体。'}</p>
    <div class="track-tools">
      {#if typeof media?.liked === 'boolean'}
        <button
          type="button"
          class="like-badge"
          class:is-liked={media.liked}
          class:is-interactive={media.canSetLiked}
          disabled={!media.canSetLiked}
          title={media.canSetLiked ? (media.liked ? '取消喜欢' : '喜欢') : '红心状态（只读）'}
          onclick={handleLike}
        >
          <Icon name={media.liked ? 'heart-filled' : 'heart'} />
          <span>{media.liked ? '已喜欢' : '未喜欢'}</span>
        </button>
      {/if}
    </div>
  </div>

  <div class="progress-block">
    <input
      class="range range-seek"
      type="range"
      min="0"
      max={max}
      step="0.1"
      value={position}
      style={`--p:${seekPercent}%`}
      aria-label="播放进度"
      title={media ? (seekable ? '播放进度' : '当前播放器仅上报进度，不支持拖动') : '播放进度'}
      disabled={seekDisabled}
      onpointerdown={handleSeekDown}
      oninput={handleSeekInput}
      onchange={handleSeekChange}
      onpointerup={handleSeekUp}
    >
    <div class="time-row"><span>{formatDuration(position)}</span><span>{formatDuration(duration)}</span></div>
  </div>

  <div class="transport">
    <button
      class="transport-button"
      type="button"
      aria-label="上一首"
      disabled={previousDisabled}
      onclick={() => sendAction('previous')}
    ><Icon name="previous" /></button>
    <button
      class="transport-button play-button"
      type="button"
      aria-label={playing ? '暂停' : '播放'}
      onclick={() => sendAction('playpause')}
    ><Icon name={playing ? 'pause' : 'play'} /></button>
    <button
      class="transport-button"
      type="button"
      aria-label="下一首"
      disabled={nextDisabled}
      onclick={() => sendAction('next')}
    ><Icon name="next" /></button>
  </div>

  <div class="volume-row">
    <button
      class="volume-button"
      type="button"
      aria-label="静音"
      onclick={() => sendAction('mute')}
    ><Icon name={volume?.muted ? 'volume-off' : 'volume'} /></button>
    <input
      class="range range-volume"
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={displayVolume}
      style={`--p:${volumePercent}%`}
      aria-label="音量"
      onpointerdown={handleVolumeDown}
      oninput={handleVolumeInput}
      onchange={handleVolumeChange}
    >
    <span class="volume-label">{Math.round(displayVolume * 100)}%</span>
  </div>
</div>

<style>
.music-controls {
min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.track-copy h1 {
margin: 6px 0 5px;
  padding: 3px 0 5px;
  font-size: clamp(28px, 3.4vw, 46px);
  line-height: 1.22;
  letter-spacing: -0.025em;
  font-weight: 590;
  overflow: hidden;
  overflow-wrap: anywhere;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  text-overflow: ellipsis;
}

.track-copy p {
margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.5;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.track-tools {
display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.like-badge {
display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: color-mix(in srgb, var(--card) 60%, transparent);
  color: var(--muted);
  font: inherit;
  font-size: 10.5px;
  font-weight: 600;
  user-select: none;
  appearance: none;
  cursor: default;
}

.like-badge.is-interactive {
  cursor: pointer;
}

.like-badge:disabled {
  opacity: 1;
}

.like-badge :global(svg) {
width: 17px;
  height: 17px;
}

.like-badge.is-liked {
color: var(--red);
  border-color: color-mix(in srgb, var(--red) 32%, transparent);
  background: color-mix(in srgb, var(--red) 10%, transparent);
}

.like-badge.is-liked :global(svg) {
fill: currentColor;
}

.progress-block {
width: 100%;
}

.range {
--p: 0%;
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 28px;
  margin: 0;
  background: transparent;
  cursor: pointer;
  touch-action: none;
}

.range::-webkit-slider-runnable-track {
height: 5px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent) 0%, var(--accent) var(--p), color-mix(in srgb, var(--text) 12%, transparent) var(--p), color-mix(in srgb, var(--text) 12%, transparent) 100%);
}

.range::-moz-range-track {
height: 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text) 12%, transparent);
}

.range::-moz-range-progress {
height: 5px;
  border-radius: 999px;
  background: var(--accent);
}

.range::-webkit-slider-thumb {
-webkit-appearance: none;
  width: 17px;
  height: 17px;
  margin-top: -6px;
  border-radius: 50%;
  border: 0;
  background: #fff;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3), 0 0 0 5px color-mix(in srgb, var(--accent) 15%, transparent);
}

.range::-moz-range-thumb {
width: 17px;
  height: 17px;
  border: 0;
  border-radius: 50%;
  background: #fff;
}

.time-row {
display: flex;
  justify-content: space-between;
  color: var(--faint);
  font-family: var(--mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.transport {
display: flex;
  align-items: center;
  gap: 20px;
}

.transport-button {
width: 64px;
  height: 64px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: color-mix(in srgb, var(--card) 70%, transparent);
  color: var(--text);
  transition: transform 0.16s ease, opacity 0.16s ease;
}

.transport-button :global(svg) {
width: 24px;
  height: 24px;
}

.transport-button:active {
transform: scale(0.94);
}

.transport-button:disabled {
opacity: 0.28;
  cursor: default;
}

.play-button {
width: 64px;
  height: 64px;
  border: 0;
  background: linear-gradient(145deg, var(--accent-2), var(--accent));
  color: #fff;
  box-shadow: 0 18px 44px color-mix(in srgb, var(--accent) 34%, transparent);
}

.play-button :global(svg) {
width: 27px;
  height: 27px;
}

.volume-row {
display: grid;
  grid-template-columns: 34px minmax(120px, 240px) 42px;
  align-items: center;
  gap: 10px;
}

.volume-button {
width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  color: var(--muted);
}

.volume-button :global(svg) {
width: 20px;
  height: 20px;
}

.range-volume {
height: 24px;
}

.range-volume::-webkit-slider-runnable-track {
height: 4px;
  background: linear-gradient(90deg, var(--accent) 0%, var(--accent) var(--p), color-mix(in srgb, var(--text) 12%, transparent) var(--p), color-mix(in srgb, var(--text) 12%, transparent) 100%);
}

.range-volume::-moz-range-progress {
background: var(--accent);
}

.range-volume::-webkit-slider-thumb {
width: 14px;
  height: 14px;
  margin-top: -5px;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 14%, transparent);
}

.range:disabled {
cursor: default;
}

.range:disabled::-webkit-slider-thumb {
display: none;
  opacity: 0;
  box-shadow: none;
}

.range:disabled::-moz-range-thumb {
display: none;
  opacity: 0;
}

.volume-label {
color: var(--faint);
  font-family: var(--mono);
  font-size: 10px;
  text-align: right;
}

@media (max-height: 760px) {
  .music-controls {
    gap: 12px;
  }
  .track-copy h1 {
    font-size: clamp(27px, 3.25vw, 40px);
    line-height: 1.24;
    padding: 4px 0 5px;
  }
  .transport-button {
    width: 50px;
    height: 50px;
  }
  .transport {
    gap: 16px;
  }
  .like-badge {
    height: 31px;
  }
}
</style>
