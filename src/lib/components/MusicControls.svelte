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
  const seekDisabled = $derived(media ? !seekable || Number(media.endTime) <= 0 : loaded);
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

</script>

<div class="music-controls">
  <div class="track-copy">
    <span class="kicker">{media?.album ? media.album.toUpperCase() : 'NOW PLAYING'}</span>
    <h1>{media?.title || '未在播放'}</h1>
    <p>{media ? media.artist || media.albumArtist || '未知艺术家' : payload?.media?.error || '在电脑上打开播放器后，这里会显示当前媒体。'}</p>
    <div class="track-tools">
      {#if typeof media?.liked === 'boolean'}
        <span class="like-badge" class:is-liked={media.liked}>
          <Icon name={media.liked ? 'heart-filled' : 'heart'} />
          <span>{media.liked ? '已喜欢' : '未喜欢'}</span>
        </span>
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
