<script lang="ts">
  import { onMount } from 'svelte';
  import {
    acquirePomodoro,
    dismissAlarm,
    formatRemaining,
    pomodoro,
    pomodoroProgress,
    resetPomodoro,
    switchPomodoroPhase,
    togglePomodoro,
  } from '../pomodoro.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Progress } from '$lib/components/ui/progress/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { cn } from '$lib/utils.js';
  import Play from '@lucide/svelte/icons/play';
  import Pause from '@lucide/svelte/icons/pause';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import BellRing from '@lucide/svelte/icons/bell-ring';
  import Timer from '@lucide/svelte/icons/timer';

  // Every page is rendered twice (infinite-loop clones), so the engine is
  // reference-counted and shared instead of running once per card instance.
  onMount(() => acquirePomodoro());

  const phaseLabel = $derived(
    pomodoro.finished
      ? pomodoro.phase === 'focus'
        ? '专注完成'
        : '休息结束'
      : pomodoro.phase === 'focus'
        ? '专注'
        : '休息',
  );
  const primaryLabel = $derived(
    pomodoro.alarmActive
      ? '停止响铃'
      : pomodoro.finished
        ? pomodoro.phase === 'focus'
          ? '开始休息'
          : '开始专注'
        : pomodoro.running
          ? '暂停'
          : '开始',
  );
  const time = $derived(formatRemaining(pomodoro.remainingMs));
  const percent = $derived(pomodoroProgress());

  function handlePrimary(): void {
    if (pomodoro.alarmActive) {
      dismissAlarm();
      return;
    }
    togglePomodoro();
  }
</script>

<div
  class="pomodoro"
  class:is-break={pomodoro.phase === 'break'}
  class:is-finished={pomodoro.finished}
  class:is-alarm={pomodoro.alarmActive}
  data-phase={pomodoro.phase}
  data-running={pomodoro.running ? 'true' : 'false'}
>
  <div class="flex min-w-0 flex-1 flex-col justify-center">
    <div class="flex items-center gap-2.5">
      <Timer class="size-[18px] text-brand" strokeWidth={1.8} />
      <span class="text-[16px] font-medium text-muted-foreground">番茄钟</span>
      <button
        class="phase-button"
        type="button"
        disabled={pomodoro.running}
        title="切换专注 / 休息"
        onclick={switchPomodoroPhase}
      >
        {phaseLabel}
      </button>
      {#if pomodoro.rounds > 0}
        <Badge
          variant="outline"
          class="h-6 border-border bg-secondary px-2 text-[12px] font-medium text-muted-foreground"
        >
          {pomodoro.rounds} 个
        </Badge>
      {/if}
    </div>

    <div class="pomodoro-main-row">
      <span class="pomodoro-time numeric" aria-live="off">{time}</span>

      <div class="flex shrink-0 items-center gap-2.5">
        <Button
          class={cn(
            'h-12 gap-2 rounded-[14px] px-5 text-[16px] font-semibold shadow-none',
            pomodoro.finished && !pomodoro.alarmActive && 'bg-success text-[#041b14] hover:bg-success/90',
            pomodoro.alarmActive && 'bg-danger text-white hover:bg-danger/90',
          )}
          type="button"
          title={primaryLabel}
          onclick={handlePrimary}
        >
          {#if pomodoro.alarmActive}
            <BellRing class="size-[19px]" strokeWidth={1.9} />
          {:else if pomodoro.running}
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
          onclick={resetPomodoro}
          aria-label="重置番茄钟"
          title="重置"
        >
          <RotateCcw class="size-[20px]" strokeWidth={1.8} />
        </Button>
      </div>
    </div>
  </div>

  <Progress
    value={percent}
    class={cn(
      'mt-3 h-1.5 bg-secondary',
      pomodoro.finished ? '[&>[data-slot=progress-indicator]]:bg-success' : '[&>[data-slot=progress-indicator]]:bg-brand',
    )}
  />
</div>

<style>
  .pomodoro {
    display: flex;
    min-height: 142px;
    max-height: 230px;
    flex: 1 1 auto;
    flex-direction: column;
    justify-content: center;
    margin: clamp(20px, 3.5vh, 32px) 0;
    padding: 16px 18px 14px;
    border: 1px solid var(--border);
    border-radius: 19px;
    background: color-mix(in srgb, var(--secondary) 46%, transparent);
  }

  .phase-button {
    min-width: 0;
    padding: 3px 8px;
    border: 1px solid color-mix(in srgb, var(--brand) 20%, transparent);
    border-radius: 999px;
    background: var(--brand-soft);
    color: var(--brand);
    font-size: 14px;
    font-weight: 600;
    line-height: 1.2;
    text-align: left;
    white-space: nowrap;
  }

  .phase-button:disabled {
    cursor: default;
    color: var(--foreground);
    background: var(--secondary);
    border-color: var(--border);
  }

  .pomodoro-main-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-top: 7px;
  }

  .pomodoro-time {
    color: var(--foreground);
    font-family: var(--font-mono);
    font-size: clamp(48px, 7vh, 62px);
    font-weight: 580;
    line-height: 1;
    letter-spacing: -0.05em;
  }

  .pomodoro.is-finished .pomodoro-time {
    color: var(--success);
  }

  .pomodoro.is-alarm {
    border-color: color-mix(in srgb, var(--danger) 28%, transparent);
    background: var(--danger-soft);
  }

  @media (max-height: 760px) {
    .pomodoro {
      min-height: 118px;
      max-height: 180px;
      margin: 14px 0;
      padding: 11px 13px 10px;
      border-radius: 17px;
    }

    .pomodoro-main-row {
      margin-top: 5px;
    }

    .pomodoro-time {
      font-size: clamp(44px, 8vh, 58px);
    }
  }

  @media (max-height: 620px) {
    .pomodoro {
      min-height: 104px;
      max-height: 160px;
      margin: 10px 0;
      padding: 9px 12px 8px;
    }

    .pomodoro-time {
      font-size: 42px;
    }

    .phase-button {
      padding: 2px 7px;
      font-size: 12px;
    }
  }

  @container (max-width: 360px) {
    .pomodoro-main-row {
      align-items: flex-start;
      flex-direction: column;
    }

    .pomodoro-main-row > .flex {
      width: 100%;
    }

    .pomodoro-main-row :global(button[data-slot='button']:first-child) {
      flex: 1;
    }
  }
</style>
