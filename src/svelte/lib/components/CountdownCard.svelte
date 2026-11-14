<script lang="ts">
  import { onMount } from 'svelte';
  import {
    acquireCountdown,
    confirmCountdown,
    countdown,
    countdownProgress,
    formatCountdown,
    formatSeconds,
    resetCountdown,
    selectCountdownPreset,
    toggleCountdown,
  } from '../countdown.svelte';
  import { app } from '../state.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Progress } from '$lib/components/ui/progress/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { t } from '../i18n.svelte';
  import { cn } from '$lib/utils.js';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import BellRing from '@lucide/svelte/icons/bell-ring';
  import Hourglass from '@lucide/svelte/icons/hourglass';

  // Every page is rendered twice (infinite-loop clones), so the engine is
  // reference-counted and shared instead of running once per card instance.
  onMount(() => acquireCountdown());

  const presets = $derived(app.countdown.presets);
  const time = $derived(formatCountdown(countdown.remainingMs));
  const percent = $derived(countdownProgress());
  const primaryLabel = $derived(
    countdown.alarmActive
      ? t('confirmEnd')
      : countdown.running
        ? t('pause')
        : t('start'),
  );

  function handlePrimary(): void {
    if (countdown.alarmActive) {
      confirmCountdown();
      return;
    }
    toggleCountdown();
  }
</script>

<div
  class="countdown"
  class:is-alarm={countdown.alarmActive}
  data-running={countdown.running ? 'true' : 'false'}
>
  <div class="flex min-w-0 flex-1 flex-col justify-center">
    <div class="flex min-w-0 items-center gap-2.5">
      <Hourglass class="size-[18px] shrink-0 text-brand" strokeWidth={1.8} />
      <span class="text-[16px] font-medium text-muted-foreground">{t('countdown')}</span>
      {#if countdown.alarmActive}
        <Badge
          variant="outline"
          class="h-6 border-border bg-danger-soft px-2 text-[12px] font-medium text-danger"
        >
          {t('countdownFinished')}
        </Badge>
      {/if}
    </div>

    <div class="countdown-main-row">
      <span class="countdown-time numeric" aria-live="off">{time}</span>

      <div class="flex shrink-0 items-center gap-2.5">
        <Button
          class={cn(
            'h-12 gap-2 rounded-[14px] px-5 text-[16px] font-semibold shadow-none',
            countdown.alarmActive && 'bg-danger text-white hover:bg-danger/90',
          )}
          type="button"
          title={primaryLabel}
          onclick={handlePrimary}
        >
          {#if countdown.alarmActive}
            <BellRing class="size-[19px]" strokeWidth={1.9} />
          {:else if countdown.running}
            <Pause class="size-[19px]" strokeWidth={1.9} />
          {:else}
            <Play class="size-[19px] fill-current" strokeWidth={1.9} />
          {/if}
          <span>{primaryLabel}</span>
        </Button>
        <Button
          variant="outline"
          size="icon"
          class="size-12 rounded-[14px] border-border bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"
          type="button"
          disabled={countdown.alarmActive}
          onclick={resetCountdown}
          aria-label={t('resetCountdown')}
          title={t('reset')}
        >
          <RotateCcw class="size-[20px]" strokeWidth={1.8} />
        </Button>
      </div>
    </div>

    <Progress
      value={percent}
      class={cn(
        'mt-3 h-1.5 bg-secondary',
        countdown.alarmActive ? '[&>[data-slot=progress-indicator]]:bg-danger' : '[&>[data-slot=progress-indicator]]:bg-brand',
      )}
    />

    <div class="preset-row" role="group" aria-label={t('countdownPresets')}>
      {#each presets as preset, index (index)}
        <button
          class="preset-chip"
          class:is-active={countdown.presetIndex === index}
          type="button"
          aria-pressed={countdown.presetIndex === index}
          aria-label={formatSeconds(preset)}
          disabled={countdown.running || countdown.alarmActive}
          onclick={() => selectCountdownPreset(index)}
        >
          {formatSeconds(preset)}
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .countdown {
    display: flex;
    min-height: 174px;
    max-height: 240px;
    flex: 1 1 auto;
    flex-direction: column;
    justify-content: center;
    margin: clamp(20px, 3.2vh, 30px) 0;
    padding: 16px 18px 14px;
    border: 1px solid var(--border);
    border-radius: 19px;
    background: color-mix(in srgb, var(--secondary) 46%, transparent);
  }

  .countdown-main-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-top: 7px;
  }

  .countdown-time {
    color: var(--foreground);
    font-family: var(--font-mono);
    font-size: clamp(48px, 7vh, 62px);
    font-weight: 580;
    line-height: 1;
    letter-spacing: -0.05em;
  }

  .countdown.is-alarm {
    border-color: color-mix(in srgb, var(--danger) 28%, transparent);
    background: var(--danger-soft);
  }

  .countdown.is-alarm .countdown-time {
    color: var(--danger);
  }

  .preset-row {
    display: flex;
    gap: 6px;
    margin-top: 9px;
  }

  .preset-chip {
    flex: 1 1 0;
    min-width: 0;
    height: 28px;
    padding: 0 4px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--secondary);
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .preset-chip.is-active {
    border-color: color-mix(in srgb, var(--brand) 38%, transparent);
    background: var(--brand-soft);
    color: var(--brand);
  }

  .preset-chip:disabled {
    opacity: 0.55;
  }

  @media (max-height: 760px) {
    .countdown {
      min-height: 150px;
      max-height: 200px;
      margin: 13px 0;
      padding: 11px 13px 10px;
      border-radius: 17px;
    }

    .countdown-main-row {
      margin-top: 5px;
    }

    .countdown-time {
      font-size: clamp(44px, 8vh, 58px);
    }

    .preset-row {
      margin-top: 7px;
    }
  }

  @media (max-height: 620px) {
    .countdown {
      min-height: 132px;
      max-height: 176px;
      margin: 9px 0;
      padding: 9px 12px 8px;
    }

    .countdown-time {
      font-size: 42px;
    }

    .preset-chip {
      height: 25px;
      font-size: 11px;
    }
  }

  @container (max-width: 360px) {
    .countdown-main-row {
      align-items: flex-start;
      flex-direction: column;
    }

    .countdown-main-row > .flex {
      width: 100%;
    }

    .countdown-main-row :global(button[data-slot='button']:first-child) {
      flex: 1;
    }
  }
</style>
