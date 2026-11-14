<script lang="ts">
  import { app } from '../state.svelte';
  import { clockParts } from '../format';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import CalendarDays from '@lucide/svelte/icons/calendar-days';
  import Panel from './Panel.svelte';
  import WeatherPanel from './WeatherPanel.svelte';
  import PomodoroCard from './PomodoroCard.svelte';
  import WeatherIcon from './WeatherIcon.svelte';

  const parts = $derived(clockParts(new Date(app.clockNow)));
  const weather = $derived(app.weather);
  const available = $derived(Boolean(weather && weather.ok !== false));
  const current = $derived(weather?.current || {});
</script>

<Panel class="clock-card relative flex min-h-0 flex-col overflow-hidden">
  <div class="clock-aura" aria-hidden="true"></div>
  {#if available}
    <div class="clock-graphic" aria-hidden="true">
      <WeatherIcon code={current.code} isDay={current.isDay} class="size-full" strokeWidth={1.1} />
    </div>
  {/if}

  <div class="clock-content relative z-10 flex min-h-0 flex-1 flex-col">
    <header class="flex items-start justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <span class="grid size-11 shrink-0 place-items-center rounded-[13px] border border-border bg-secondary text-brand">
          <CalendarDays class="size-[22px]" strokeWidth={1.7} />
        </span>
        <div class="min-w-0">
          <p class="truncate text-[16px] font-semibold tracking-[-0.01em] text-foreground">{parts.dateLabel}</p>
          {#if parts.periodLabel}
            <p class="mt-0.5 truncate text-[13px] text-muted-foreground">{parts.periodLabel}</p>
          {/if}
        </div>
      </div>
      <Badge
        variant="outline"
        class="h-8 shrink-0 border-border bg-secondary px-3 text-[15px] font-medium text-muted-foreground"
      >
        {parts.greeting}
      </Badge>
    </header>

    <div class="clock-line flex items-baseline gap-3">
      <span class="clock-time numeric">{parts.time}</span>
      <span class="clock-seconds numeric">{parts.seconds}</span>
    </div>

    {#if app.pomodoro.enabled}
      <PomodoroCard />
    {/if}

    <WeatherPanel {weather} />
  </div>
</Panel>

<style>
  :global(.clock-card) {
    container-type: inline-size;
    background:
      radial-gradient(95% 82% at 100% 3%, color-mix(in srgb, var(--brand) 10%, transparent), transparent 55%),
      linear-gradient(145deg, color-mix(in srgb, var(--card) 88%, #16213c), var(--card) 62%);
  }

  .clock-content {
    padding: clamp(16px, 2.6vh, 26px);
  }

  .clock-aura {
    position: absolute;
    inset: auto -18% -48% 28%;
    height: 62%;
    border-radius: 50%;
    background: color-mix(in srgb, var(--brand) 10%, transparent);
    filter: blur(65px);
    pointer-events: none;
  }

  .clock-graphic {
    position: absolute;
    right: -34px;
    bottom: 118px;
    width: 310px;
    height: 310px;
    color: var(--brand);
    opacity: 0.05;
    pointer-events: none;
  }

  .clock-line {
    min-height: 0;
    padding-top: clamp(16px, 3.8vh, 34px);
    line-height: 0.82;
  }

  .clock-time {
    color: var(--foreground);
    font-size: clamp(82px, 10.7vw, 138px);
    font-weight: 560;
    letter-spacing: -0.075em;
    line-height: 0.82;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .clock-seconds {
    color: var(--brand);
    font-size: clamp(28px, 3vw, 40px);
    font-weight: 560;
    letter-spacing: -0.02em;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  @media (max-height: 760px) {
    .clock-content {
      padding: 14px;
    }

    .clock-graphic {
      width: 250px;
      height: 250px;
      bottom: 104px;
    }

    .clock-line {
      padding-top: 10px;
    }

    .clock-time {
      font-size: clamp(86px, 13.4vw, 123px);
    }

    .clock-seconds {
      font-size: 29px;
    }
  }

  @media (max-height: 620px) {
    .clock-content {
      padding: 12px;
    }

    .clock-line {
      padding-top: 7px;
      padding-bottom: 3px;
    }

    .clock-time {
      font-size: clamp(76px, 10.7vw, 96px);
      line-height: 0.9;
    }

    .clock-seconds {
      font-size: 24px;
    }

    .clock-graphic {
      width: 210px;
      height: 210px;
      bottom: 90px;
    }
  }

  @media (orientation: portrait) {
    :global(.clock-card) {
      min-height: 620px;
    }

    .clock-graphic {
      display: none;
    }

    .clock-time {
      font-size: clamp(84px, 22vw, 124px);
    }
  }
</style>
