<script lang="ts">
  import { cn } from '$lib/utils.js';

  let {
    value = 0,
    color = 'var(--brand)',
    size = 'clamp(92px, 14vh, 112px)',
    class: className = '',
  }: {
    value?: number;
    color?: string;
    size?: string;
    class?: string;
  } = $props();

  const clamped = $derived(Math.max(0, Math.min(100, Number(value) || 0)));
  const display = $derived(Math.round(clamped));
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  const offset = $derived(circumference * (1 - clamped / 100));
</script>

<div
  class={cn('radial-gauge', className)}
  style={`--meter-color:${color}; width:${size}; height:${size};`}
  role="meter"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={display}
>
  <svg viewBox="0 0 100 100" aria-hidden="true">
    <circle class="radial-track" cx="50" cy="50" r={radius} />
    <circle
      class="radial-value"
      cx="50"
      cy="50"
      r={radius}
      stroke-dasharray={circumference}
      stroke-dashoffset={offset}
      transform="rotate(-90 50 50)"
    />
  </svg>
  <div class="radial-copy">
    <span class="radial-number numeric">{display}</span>
    <span class="radial-unit">%</span>
  </div>
</div>

<style>
  .radial-gauge {
    position: relative;
    display: grid;
    flex: 0 0 auto;
    place-items: center;
  }

  .radial-gauge svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .radial-track {
    fill: none;
    stroke: color-mix(in srgb, var(--foreground) 8%, transparent);
    stroke-width: 7;
  }

  .radial-value {
    fill: none;
    stroke: var(--meter-color);
    stroke-width: 7;
    stroke-linecap: round;
  }

  .radial-copy {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: flex-start;
    gap: 1px;
    color: var(--foreground);
  }

  .radial-number {
    font-size: clamp(30px, 4vw, 42px);
    font-weight: 560;
    line-height: 1;
    letter-spacing: -0.05em;
  }

  .radial-unit {
    margin-top: 3px;
    color: var(--muted-foreground);
    font-size: clamp(13px, 1.5vw, 16px);
    font-weight: 550;
  }
</style>
