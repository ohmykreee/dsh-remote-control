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

  function levelOf(value: number): number {
    return Number.isFinite(value) ? Math.max(3, Math.min(100, value)) : 0;
  }

  function shownOf(value: number): string {
    const display = toDisplayTemperature(value, unit);
    return display === null ? '—' : `${display.toFixed(1)}${unitText}`;
  }
</script>

<article class="card perf-card perf-temp" class:is-empty={empty}>
  <div class="perf-head"><span class="kicker">THERMALS</span><span class="perf-chip">{temperatures.length} 个传感器</span></div>
  <div class="temp-hero" class:is-hot={Number.isFinite(maxTemp) && maxTemp >= 70} class:is-critical={Number.isFinite(maxTemp) && maxTemp >= 85}>
    <div class="temp-hero-copy"><strong>{maxShown}</strong><span>{unitText} 最高</span></div>
    <div class="temp-hero-scale"><i style={`width:${heatWidth}%`}></i></div>
  </div>
  <div class="temp-list">
    {#if !loaded}
      <p class="perf-note">正在读取温度</p>
    {:else if empty}
      <EmptyState icon="thermometer" title="暂无温度读数" className="temp-empty" />
    {:else}
      {#each temperatures as item, index (item.name || index)}
        {@const value = Number(item.celsius)}
        <div class="temp-row" class:is-critical={value >= 85} class:is-hot={value >= 70 && value < 85}>
          <span class="temp-name">{item.name || '设备'}</span>
          <span class="temp-level"><i style={`width:${levelOf(value)}%`}></i></span>
          <b>{shownOf(value)}</b>
        </div>
      {/each}
    {/if}
  </div>
</article>

<style>
.perf-temp {
min-height: 0;
  padding: 18px 18px 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.temp-hero {
margin-top: 14px;
  padding: 14px 14px 15px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: linear-gradient(150deg, color-mix(in srgb, var(--accent) 12%, transparent), transparent 70%);
}

.temp-hero-copy {
display: flex;
  align-items: baseline;
  gap: 6px;
}

.temp-hero-copy strong {
font-size: 46px;
  line-height: 1;
  font-weight: 580;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}

.temp-hero-copy span {
color: var(--muted);
  font-size: 10px;
}

.temp-hero-scale {
height: 6px;
  margin-top: 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text) 8%, transparent);
  overflow: hidden;
}

.temp-hero-scale i {
display: block;
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: var(--green);
  transition: width 0.35s ease, background 0.35s ease;
}

.temp-hero.is-hot .temp-hero-scale i {
background: var(--amber);
}

.temp-hero.is-critical .temp-hero-scale i {
background: var(--red);
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
  margin-top: 12px;
  overflow-y: auto;
  display: grid;
  grid-auto-rows: minmax(44px, 1fr);
  gap: 6px;
  scrollbar-width: none;
}

.temp-row {
display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  align-content: center;
  align-items: center;
  gap: 8px 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--text) 3.5%, transparent);
}

.temp-name {
grid-column: 1;
  grid-row: 1;
  color: var(--muted);
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.temp-level {
grid-column: 1 / -1;
  grid-row: 2;
  height: 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text) 8%, transparent);
  overflow: hidden;
}

.temp-level i {
display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent-2);
}

.temp-row b {
grid-column: 2;
  grid-row: 1;
  color: var(--text);
  font-size: 15px;
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

.temp-row.is-hot .temp-level i {
background: var(--amber);
}

.temp-row.is-critical .temp-level i {
background: var(--red);
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
    padding: 10px;
  }
  .temp-hero-copy strong {
    font-size: 32px;
  }
  .temp-row {
    padding: 6px 8px;
    gap: 5px 8px;
  }
}

@media (orientation: portrait) {
  .perf-temp {
    min-height: 420px;
  }
}

@media (max-height: 500px) {
  .temp-hero {
    margin-top: 5px;
    padding: 7px;
  }
  .temp-hero-copy strong {
    font-size: 24px;
  }
  .temp-hero-copy span {
    font-size: 8px;
  }
  .temp-hero-scale {
    height: 4px;
    margin-top: 6px;
  }
  .temp-list {
    margin-top: 6px;
    gap: 3px;
  }
  .temp-row {
    padding: 4px 6px;
    gap: 4px 6px;
  }
  .temp-name {
    font-size: 8px;
  }
  .temp-row b {
    font-size: 9px;
  }
}
</style>
