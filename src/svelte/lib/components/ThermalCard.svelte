<script lang="ts">
  import { app } from '../state.svelte';
  import { temperatureUnitLabel, toDisplayTemperature } from '../format';
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
  const maxShown = $derived(Number.isFinite(maxTemp) ? Math.round(toDisplayTemperature(maxTemp, unit) ?? 0) : '—');
  const maxHot = $derived(Number.isFinite(maxTemp) && maxTemp >= 70);
  const maxCritical = $derived(Number.isFinite(maxTemp) && maxTemp >= 85);

  function levelOf(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  }

  function shownOf(value: number): string {
    const display = toDisplayTemperature(value, unit);
    return display === null ? '—' : `${display.toFixed(1)}${unitText}`;
  }
</script>

<article class="card perf-card perf-temp" class:is-empty={empty}>
  <div class="perf-head"><span class="kicker">THERMALS</span><span class="perf-chip">{temperatures.length} 个传感器</span></div>
  <div class="temp-hero" class:is-hot={maxHot} class:is-critical={maxCritical} style={`--heat:${heatWidth}%`}>
    <div class="temp-hero-copy"><strong>{maxShown}</strong><span>{unitText} 最高</span></div>
  </div>
  <div class="temp-list">
    {#if !loaded}
      <p class="perf-note">正在读取温度</p>
    {:else if empty}
      <EmptyState icon="thermometer" title="暂无温度读数" className="temp-empty" />
    {:else}
      {#each temperatures as item, index (item.name || index)}
        {@const value = Number(item.celsius)}
        <div
          class="temp-row"
          class:is-hot={value >= 70 && value < 85}
          class:is-critical={value >= 85}
          style={`--heat:${levelOf(value)}%`}
        >
          <span class="temp-name">{item.name || '设备'}</span>
          <b>{shownOf(value)}</b>
        </div>
      {/each}
      {#if !hasCpuSensor}
        <div class="temp-row is-unavailable" title="Windows 未向用户态程序暴露 CPU 温度：需要主板 ACPI 热区或厂商驱动">
          <span class="temp-name">CPU</span>
          <b>未提供</b>
        </div>
      {/if}
    {/if}
  </div>
</article>

<style>
.perf-temp {
  min-height: 0;
  padding: 16px 18px 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.temp-hero {
  position: relative;
  margin-top: 10px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: linear-gradient(150deg, color-mix(in srgb, var(--accent) 10%, transparent), transparent 70%);
  overflow: hidden;
}

.temp-hero::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--heat, 0%);
  border-radius: inherit;
  background: color-mix(in srgb, var(--green) 18%, transparent);
  transition: width 0.35s ease, background 0.35s ease;
}

.temp-hero.is-hot::before {
  background: color-mix(in srgb, var(--amber) 22%, transparent);
}

.temp-hero.is-critical::before {
  background: color-mix(in srgb, var(--red) 24%, transparent);
}

.temp-hero-copy {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.temp-hero-copy strong {
  font-size: 38px;
  line-height: 1;
  font-weight: 580;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}

.temp-hero-copy span {
  color: var(--muted);
  font-size: 10px;
}

.temp-hero.is-hot .temp-hero-copy strong {
  color: var(--amber);
}

.temp-hero.is-critical .temp-hero-copy strong {
  color: var(--red);
}

.temp-list {
  flex: 1;
  min-height: 0;
  margin-top: 10px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  scrollbar-width: none;
}

.temp-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  border-radius: 11px;
  background: color-mix(in srgb, var(--text) 3.5%, transparent);
  overflow: hidden;
}

.temp-row::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--heat, 0%);
  border-radius: inherit;
  background: color-mix(in srgb, var(--accent-2) 16%, transparent);
  transition: width 0.35s ease, background 0.35s ease;
}

.temp-row > * {
  position: relative;
  z-index: 1;
}

.temp-name {
  min-width: 0;
  color: var(--muted);
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.temp-row b {
  flex: 0 0 auto;
  color: var(--text);
  font-size: 14px;
  font-weight: 570;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.temp-row.is-hot b {
  color: var(--amber);
}

.temp-row.is-critical b {
  color: var(--red);
}

.temp-row.is-hot::before {
  background: color-mix(in srgb, var(--amber) 20%, transparent);
}

.temp-row.is-critical::before {
  background: color-mix(in srgb, var(--red) 22%, transparent);
}

.temp-row.is-unavailable {
  border: 1px dashed var(--line);
  background: transparent;
}

.temp-row.is-unavailable .temp-name {
  color: var(--faint);
}

.temp-row.is-unavailable b {
  color: var(--faint);
  font-size: 10px;
  font-weight: 500;
}

.perf-temp.is-empty .temp-hero {
  display: none;
}

.perf-temp.is-empty .temp-list {
  justify-content: center;
}

.perf-temp.is-empty :global(.empty-state.temp-empty) {
  margin: 0;
  padding: 0 12px;
  border: 0;
  border-radius: 0;
  gap: 10px;
}

.perf-temp.is-empty :global(.empty-state.temp-empty svg) {
  width: 42px;
  height: 42px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: color-mix(in srgb, var(--text) 3.5%, transparent);
  color: var(--accent-2);
}

.perf-temp.is-empty :global(.empty-state.temp-empty h3) {
  font-size: 15px;
}

@media (max-height: 760px) {
  .temp-hero {
    margin-top: 8px;
    padding: 9px 11px;
  }
  .temp-hero-copy strong {
    font-size: 30px;
  }
  .temp-row {
    padding: 6px 9px;
  }
}

@media (orientation: portrait) {
  .perf-temp {
    min-height: 0;
  }
}

@media (max-height: 500px) {
  .temp-hero {
    margin-top: 5px;
    padding: 7px 9px;
  }
  .temp-hero-copy strong {
    font-size: 24px;
  }
  .temp-hero-copy span {
    font-size: 8px;
  }
  .temp-list {
    margin-top: 6px;
    gap: 4px;
  }
  .temp-row {
    padding: 4px 7px;
  }
  .temp-name {
    font-size: 8.5px;
  }
  .temp-row b {
    font-size: 10px;
  }
}
</style>
