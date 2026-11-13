<script lang="ts">
  import { app } from '../state.svelte';
  import { temperatureUnitLabel, toDisplayTemperature } from '../format';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import Thermometer from '@lucide/svelte/icons/thermometer';
  import ThermometerSun from '@lucide/svelte/icons/thermometer-sun';
  import Panel from './Panel.svelte';
  import SectionHeader from './SectionHeader.svelte';
  import EmptyState from './EmptyState.svelte';

  const data = $derived(app.performance);
  const loaded = $derived(data !== null);
  const temperatures = $derived(Array.isArray(data?.temperatures) ? data.temperatures : []);
  const unit = $derived(app.temperatureUnit);
  const unitText = $derived(temperatureUnitLabel(unit));
  const empty = $derived(loaded && temperatures.length === 0);
  const hasCpuSensor = $derived(
    temperatures.some((item) => /cpu|core|package|processor|tdie|tctl/i.test(String(item.name || ''))),
  );

  const maxTemp = $derived.by(() => {
    let max = -Infinity;
    for (const item of temperatures) {
      const value = Number(item.celsius);
      if (Number.isFinite(value)) max = Math.max(max, value);
    }
    return max;
  });
  const heatWidth = $derived(Number.isFinite(maxTemp) ? Math.max(0, Math.min(100, maxTemp)) : 0);
  const maxShown = $derived(
    Number.isFinite(maxTemp) ? Math.round(toDisplayTemperature(maxTemp, unit) ?? 0) : '—',
  );
  const maxHot = $derived(Number.isFinite(maxTemp) && maxTemp >= 70);
  const maxCritical = $derived(Number.isFinite(maxTemp) && maxTemp >= 85);

  function levelOf(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  }

  function shownOf(value: number): string {
    const display = toDisplayTemperature(value, unit);
    return display === null ? '—' : `${display.toFixed(1)}°`;
  }
</script>

<Panel class="thermal-card relative flex min-h-0 flex-col overflow-hidden p-4">
  <div class="perf-glow" aria-hidden="true"></div>
  <SectionHeader icon={Thermometer} eyebrow="THERMALS" title="温度">
    {#snippet children()}
      <Badge
        variant="outline"
        class="h-7 border-border bg-secondary px-2.5 text-[13px] font-medium text-muted-foreground"
      >
        {temperatures.length} 个
      </Badge>
    {/snippet}
  </SectionHeader>

  {#if !loaded}
    <div class="mt-3 flex flex-1 flex-col gap-2">
      <div class="h-24 rounded-[15px] bg-secondary/50"></div>
      {#each Array(3) as _, index (index)}
        <div class="h-12 rounded-[11px] bg-secondary/40"></div>
      {/each}
    </div>
  {:else if empty}
    <div class="flex min-h-0 flex-1 items-center justify-center">
      <EmptyState icon={Thermometer} title="暂无温度读数" text="稍后再试" />
    </div>
  {:else}
    <div class="relative z-10 mt-3 flex flex-1 flex-col">
      <div class="temp-hero" class:is-hot={maxHot} class:is-critical={maxCritical} style={`--heat:${heatWidth}%`}>
        <div class="relative z-10 flex items-end justify-between gap-3">
          <div>
            <p class="text-[15px] text-muted-foreground">最高温度</p>
            <div class="mt-1 flex items-baseline gap-1">
              <span class="temp-max numeric">{maxShown}</span>
              <span class="text-[17px] text-muted-foreground">{unitText}</span>
            </div>
          </div>
          <ThermometerSun class="mb-1 size-[32px] text-muted-foreground" strokeWidth={1.5} />
        </div>
      </div>

      <div class="mt-3 min-h-0 flex-1">
        <ScrollArea class="h-full" scrollbarYClasses="w-2">
          <div class="flex flex-col gap-2 pr-1">
            {#each temperatures as item, index (item.name || index)}
              {@const value = Number(item.celsius)}
              <div
                class="temp-row"
                class:is-hot={value >= 70 && value < 85}
                class:is-critical={value >= 85}
                style={`--heat:${levelOf(value)}%`}
              >
                <span class="relative z-10 min-w-0 flex-1 truncate text-[16px] text-muted-foreground">
                  {item.name || '设备'}
                </span>
                <b class="relative z-10 numeric shrink-0 text-[20px] font-semibold text-foreground">
                  {shownOf(value)}
                </b>
              </div>
            {/each}

            {#if !hasCpuSensor}
              <div class="temp-row is-unavailable">
                <span class="relative z-10 text-[15px] text-muted-foreground">CPU</span>
                <span class="relative z-10 text-[14px] text-muted-foreground">未提供</span>
              </div>
            {/if}
          </div>
        </ScrollArea>
      </div>
    </div>
  {/if}
</Panel>

<style>
  :global(.thermal-card) {
    background:
      radial-gradient(90% 100% at 100% 0%, color-mix(in srgb, var(--warn) 5%, transparent), transparent 58%),
      var(--card);
  }

  .perf-glow {
    position: absolute;
    right: -70px;
    bottom: -110px;
    width: 210px;
    height: 210px;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--warn) 10%, transparent);
    pointer-events: none;
  }

  .temp-hero {
    position: relative;
    overflow: hidden;
    padding: 10px 13px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: color-mix(in srgb, var(--secondary) 55%, transparent);
  }

  .temp-hero::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: var(--heat, 0%);
    background: color-mix(in srgb, var(--success) 16%, transparent);
    pointer-events: none;
  }

  .temp-hero.is-hot::before {
    background: color-mix(in srgb, var(--warn) 20%, transparent);
  }

  .temp-hero.is-critical::before {
    background: color-mix(in srgb, var(--danger) 22%, transparent);
  }

  .temp-max {
    color: var(--foreground);
    font-size: clamp(50px, 6.2vw, 68px);
    font-weight: 560;
    line-height: 1;
    letter-spacing: -0.06em;
  }

  .temp-hero.is-hot .temp-max {
    color: var(--warn);
  }

  .temp-hero.is-critical .temp-max {
    color: var(--danger);
  }

  .temp-row {
    position: relative;
    display: flex;
    min-height: 52px;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    overflow: hidden;
    padding: 6px 10px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: color-mix(in srgb, var(--secondary) 48%, transparent);
  }

  .temp-row::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: var(--heat, 0%);
    background: color-mix(in srgb, var(--brand) 13%, transparent);
    pointer-events: none;
  }

  .temp-row.is-hot::before {
    background: color-mix(in srgb, var(--warn) 17%, transparent);
  }

  .temp-row.is-critical::before {
    background: color-mix(in srgb, var(--danger) 19%, transparent);
  }

  .temp-row.is-hot b {
    color: var(--warn);
  }

  .temp-row.is-critical b {
    color: var(--danger);
  }

  .temp-row.is-unavailable {
    border: 1px dashed var(--border);
    background: transparent;
    opacity: 0.75;
  }

  @media (max-height: 760px) {
    :global(.thermal-card) {
      padding: 12px;
    }

    .temp-hero {
      padding: 8px 11px;
    }

    .temp-max {
      font-size: clamp(46px, 6.8vw, 60px);
    }

    .temp-row {
      min-height: 46px;
      padding: 4px 9px;
    }
  }

  @media (orientation: portrait) {
    :global(.thermal-card) {
      min-height: 320px;
    }
  }
</style>
