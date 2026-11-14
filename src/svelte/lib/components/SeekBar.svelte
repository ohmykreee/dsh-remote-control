<script lang="ts">
  import { onMount } from 'svelte';
  import { sineInOut } from 'svelte/easing';
  import { Tween } from 'svelte/motion';
  import { formatDuration } from '../format';
  import { t } from '../i18n.svelte';
  import { isPlaying, isSeekable, mediaDuration, seekMaximum } from '../media';
  import type { MediaInfo } from '../types';
  import { cn } from '$lib/utils.js';

  let {
    media,
    onSeek,
    class: className = '',
  }: {
    media: MediaInfo | null;
    onSeek: (value: number) => void;
    class?: string;
  } = $props();

  const duration = $derived(mediaDuration(media));
  const max = $derived(seekMaximum(media));
  const playing = $derived(isPlaying(media));
  const hasTotal = $derived(Boolean(media) && duration > 0);
  const hasCurrent = $derived(
    Boolean(media) && media?.position !== null && media?.position !== undefined && Number.isFinite(Number(media.position)),
  );
  const hasTimeline = $derived(hasTotal && hasCurrent);
  const seekable = $derived(Boolean(media && isSeekable(media) && hasTimeline));

  // One long sine path in SVG user units (1 unit = 1 px, no viewBox), shifted
  // by the live phase so the pattern is pinned to the leading edge. The phase
  // shift (0..40) and drift (0..40) add up, so the path starts several periods
  // left of the viewport — the visible left edge is always in the middle of
  // the path, never on its start cap.
  const WAVE_PERIOD = 40;
  const WAVE_MIDDLE = 12;
  const WAVE_AMPLITUDE = 2.52;
  const WAVE_CONTROL_Y = WAVE_MIDDLE - WAVE_AMPLITUDE * 2;
  const WAVE_LEAD = WAVE_PERIOD * 5;
  const WAVE_PATH = buildWavePath();

  function buildWavePath(): string {
    let d = `M${-WAVE_LEAD} ${WAVE_MIDDLE}`;
    for (let x = -WAVE_LEAD; x < 4000; x += WAVE_PERIOD) {
      d += ` Q${x + 10} ${WAVE_CONTROL_Y} ${x + 20} ${WAVE_MIDDLE} T${x + WAVE_PERIOD} ${WAVE_MIDDLE}`;
    }
    return d;
  }

  let now = $state(Date.now());
  let dragging = $state(false);
  let dragValue = $state(0);
  let trackEl = $state<HTMLDivElement | null>(null);
  let trackWidth = $state(0);
  let anchor = 0;
  let anchorAt = Date.now();
  let lastKey = '';
  let pendingValue = 0;
  let pendingUntil = 0;
  let lastSentValue = -1;
  let lastSentAt = 0;
  let activePointerId: number | null = null;

  // Only a live, advancing timeline gets the wave. Pausing, dragging and
  // unavailable timelines (fixed at 100%) fall back to a straight bar.
  const flowing = $derived(hasTimeline && playing && !dragging);

  const reduceMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Freeze the phase (the CSS drift pauses immediately), hold for 120 ms,
  // then tween the wave's amplitude into the line — and the exact reverse
  // when playback resumes. Both directions share these options. The resting
  // value is 0.001, not 0: a singular scaleY culls the path, while 0.001
  // still renders its non-scaling 4px stroke as the straight bar.
  const waveAmplitude = Tween.of(
    () => (flowing ? 1 : 0.001),
    {
      duration: reduceMotion ? 0 : 320,
      delay: reduceMotion ? 0 : 120,
      easing: sineInOut,
    },
  );
  const waveScale = $derived(waveAmplitude.current);

  function clampPosition(value: number): number {
    const limit = duration > 0 ? duration : max;
    return Math.max(0, Math.min(limit, value));
  }

  function positionAt(timestamp: number, isPlayingNow = playing): number {
    let value = anchor;
    if (isPlayingNow && timestamp > anchorAt) value += (timestamp - anchorAt) / 1000;
    return clampPosition(value);
  }

  const position = $derived.by(() => {
    if (!media) return 0;
    if (dragging) return clampPosition(dragValue);
    return positionAt(now);
  });

  const percent = $derived(max > 0 ? Math.min(100, Math.max(0, (position / max) * 100)) : 0);
  const displayPercent = $derived(!media ? 0 : !hasTotal ? 100 : hasTimeline ? percent : 0);
  const wavePercent = $derived(seekable ? percent : displayPercent);
  const waveWidth = $derived((trackWidth * wavePercent) / 100);
  const phaseLock = $derived(((waveWidth % WAVE_PERIOD) + WAVE_PERIOD) % WAVE_PERIOD);
  const currentLabel = $derived(hasTimeline ? formatDuration(position) : '--:--');
  const totalLabel = $derived(hasTotal ? formatDuration(duration) : '--:--');

  function trackKey(item: MediaInfo | null): string {
    if (!item) return '';
    return `${item.appId || ''}\u0000${item.title || ''}\u0000${item.endTime || 0}`;
  }

  // Keep the local timeline moving even when the Host keeps resending the
  // same cached media snapshot. Only meaningful jumps/track/play-state changes
  // re-anchor the bar.
  $effect(() => {
    const currentMedia = media;
    const timestamp = Date.now();
    if (!currentMedia) {
      anchor = 0;
      anchorAt = timestamp;
      lastKey = '';
      pendingUntil = 0;
      now = timestamp;
      return;
    }

    const key = trackKey(currentMedia);
    const reported = Number(currentMedia.position) || 0;
    const isPlayingNow = isPlaying(currentMedia);

    if (key !== lastKey || dragging) {
      if (key !== lastKey) {
        lastKey = key;
        anchor = clampPosition(reported);
        anchorAt = timestamp;
        pendingUntil = 0;
      }
      now = timestamp;
      return;
    }

    if (pendingUntil > timestamp) {
      if (Math.abs(reported - pendingValue) <= 4) {
        pendingUntil = 0;
        anchor = clampPosition(reported);
        anchorAt = timestamp;
      }
      now = timestamp;
      return;
    }

    if (!isPlayingNow) {
      anchor = clampPosition(reported);
      anchorAt = timestamp;
    } else {
      const current = positionAt(timestamp, true);
      if (reported > current + 2.5) {
        anchor = clampPosition(reported);
        anchorAt = timestamp;
      }
    }
    now = timestamp;
  });

  onMount(() => {
    const timer = setInterval(() => {
      now = Date.now();
    }, 100);
    return () => clearInterval(timer);
  });

  function valueFromPointer(clientX: number): number {
    if (!trackEl) return position;
    const rect = trackEl.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * max;
  }

  function commit(value: number): void {
    if (!media) return;
    const timestamp = Date.now();
    const target = clampPosition(value);
    dragging = false;
    dragValue = target;
    anchor = target;
    anchorAt = timestamp;
    pendingValue = target;
    pendingUntil = timestamp + 8000;

    // A pointer gesture and a keyboard adjustment must submit exactly one
    // seek; duplicate actions make the player jump twice.
    if (timestamp - lastSentAt < 400 && Math.abs(target - lastSentValue) < 0.5) return;
    lastSentAt = timestamp;
    lastSentValue = target;
    onSeek(target);
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!seekable || dragging) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    activePointerId = event.pointerId;
    dragging = true;
    dragValue = valueFromPointer(event.clientX);
    try {
      trackEl?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; window pointerup still finishes the drag.
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!dragging || event.pointerId !== activePointerId) return;
    event.preventDefault();
    dragValue = valueFromPointer(event.clientX);
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!dragging || event.pointerId !== activePointerId) return;
    const target = valueFromPointer(event.clientX);
    try {
      trackEl?.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already have been released by the browser.
    }
    activePointerId = null;
    commit(target);
  }

  function cancelPointer(): void {
    if (!seekable) return;
    dragging = false;
    activePointerId = null;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!seekable) return;
    const smallStep = event.shiftKey ? 30 : 5;
    let target: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') target = position - smallStep;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') target = position + smallStep;
    else if (event.key === 'PageDown') target = position - 30;
    else if (event.key === 'PageUp') target = position + 30;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = duration;
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    commit(target);
  }
</script>

<svelte:window onpointerup={handlePointerUp} onpointercancel={cancelPointer} />

{#snippet waveLine()}
  <svg class="seek-wave" style={`width: ${wavePercent}%`} height="24" aria-hidden="true">
    <g transform={`translate(${phaseLock} 0)`}>
      <g class="seek-wave-drift">
        <g class="seek-wave-amplitude" style={`transform: scaleY(${waveScale})`}>
          <path class="seek-wave-line" d={WAVE_PATH} vector-effect="non-scaling-stroke" />
        </g>
      </g>
    </g>
  </svg>
{/snippet}

<div class={cn('seek-bar', className)} bind:clientWidth={trackWidth}>
  {#if seekable}
    <div
      bind:this={trackEl}
      class="seek-hit"
      role="slider"
      tabindex="0"
      aria-label={t('playProgress')}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(position)}
      aria-valuetext="{currentLabel} / {totalLabel}"
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onkeydown={handleKeydown}
    >
      <div class="seek-track" class:is-flowing={flowing}>
        <div class="seek-rest" style={`left: ${percent}%`}></div>
        {@render waveLine()}
        <div class="seek-thumb" style={`left: ${percent}%`}></div>
      </div>
    </div>
  {:else}
    <div
      class="seek-readonly"
      title={!hasTotal ? t('progressUnavailable') : hasTimeline ? t('progressReadOnly') : t('playProgress')}
    >
      <div
        class="seek-track"
        class:is-flowing={flowing}
        role="progressbar"
        aria-label={hasTotal ? t('playProgress') : t('progressUnavailable')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(displayPercent)}
        aria-valuetext={hasTimeline ? `${currentLabel} / ${totalLabel}` : undefined}
      >
        <div class="seek-rest" style={`left: ${displayPercent}%`}></div>
        {@render waveLine()}
      </div>
    </div>
  {/if}

  <div class={cn('mt-2 flex items-center justify-between text-[16px] text-muted-foreground', seekable && 'mt-0')}>
    <span class="numeric">{currentLabel}</span>
    <span class="numeric">{totalLabel}</span>
  </div>
</div>

<style>
  .seek-hit {
    display: flex;
    height: 44px;
    align-items: center;
    cursor: pointer;
    touch-action: none;
    outline: none;
    user-select: none;
  }

  .seek-hit:focus-visible {
    outline: none;
  }

  .seek-hit:focus-visible .seek-track {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--brand) 32%, transparent);
  }

  .seek-readonly {
    display: flex;
    height: 24px;
    align-items: center;
  }

  .seek-track {
    position: relative;
    width: 100%;
    height: 4px;
    border-radius: 999px;
  }

  .seek-rest {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    border-radius: 999px;
    background: color-mix(in srgb, var(--foreground) 14%, transparent);
  }

  /* A single long sine path is shifted by `phaseLock` so its phase is pinned
     to the leading edge, then scrolled by the drift animation. Only the
     amplitude group scales, and vector-effect keeps the 4px stroke intact:
     the crests flatten into the same 4px line instead of fading into it. */
  .seek-wave {
    position: absolute;
    top: 50%;
    left: 0;
    display: block;
    height: 24px;
    overflow: hidden;
    color: var(--brand);
    transform: translateY(-50%);
    pointer-events: none;
  }

  .seek-wave-line {
    fill: none;
    stroke: currentColor;
    stroke-width: 4;
    stroke-linecap: round;
  }

  .seek-wave-amplitude {
    transform-box: view-box;
    transform-origin: 0 12px;
  }

  .seek-wave-drift {
    animation: seek-wave-drift 3.8s linear infinite;
    animation-play-state: paused;
  }

  .is-flowing .seek-wave-drift {
    animation-play-state: running;
  }

  .seek-thumb {
    position: absolute;
    top: 50%;
    width: 5px;
    height: 24px;
    border-radius: 999px;
    background: var(--brand);
    transform: translate(-50%, -50%);
  }

  @keyframes seek-wave-drift {
    from {
      transform: translateX(0);
    }

    to {
      transform: translateX(40px);
    }
  }

</style>
