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
