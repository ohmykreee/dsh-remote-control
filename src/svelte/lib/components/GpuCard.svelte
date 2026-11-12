<script lang="ts">
  import { app } from '../state.svelte';
  import { formatBytes } from '../format';

  const data = $derived(app.performance);
  const loaded = $derived(data !== null);
  const gpu = $derived(data?.gpu || {});
  const gpuModel = $derived(String(gpu.name || '').trim());
  const unavailable = $derived(loaded && gpu.ok === false);
  const gpuHeader = $derived(
    !loaded ? '正在读取显卡信息' : unavailable ? gpu.error || 'GPU 读数不可用' : gpuModel || '未检测到独立显卡',
  );

  const usage = $derived(Number(gpu.utilization));
  const usagePercent = $derived(Number.isFinite(usage) ? Math.max(0, Math.min(100, usage)) : 0);
  const usageShown = $derived(Number.isFinite(usage) ? Math.round(usage) : '—');

  const memoryPercent = $derived(Number(gpu.memoryPercent));
  const memoryBarWidth = $derived(Number.isFinite(memoryPercent) ? Math.max(0, Math.min(100, memoryPercent)) : 0);
  const memoryNote = $derived(
    Number.isFinite(Number(gpu.memoryUsed)) && Number(gpu.memoryUsed) > 0 ? `已用 ${formatBytes(gpu.memoryUsed)}` : '显存占用',
  );

  function clock(value: unknown): string {
    if (value === null || value === undefined) return '—';
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return '—';
    return number >= 1000 ? `${(number / 1000).toFixed(2)} GHz` : `${Math.round(number)} MHz`;
  }

  const coreClock = $derived(clock(gpu.coreClockMhz));
  const memoryClock = $derived(clock(gpu.memoryClockMhz));
  const driverChip = $derived(
    typeof gpu.driver === 'string' && gpu.driver.trim() ? `驱动 ${gpu.driver.trim()}` : '驱动 —',
  );
</script>

<article class="card perf-combo perf-graphics">
  <header class="perf-combo-head">
    <div><span class="kicker">GRAPHICS</span><h2>GPU / 显存</h2></div>
    <h3 class="perf-model-name" title={gpuModel}>{gpuHeader}</h3>
  </header>
  <div class="perf-combo-body">
    <section class="perf-pane perf-gpu">
      <div class="perf-pane-head"><span class="kicker">GPU</span><span class="perf-chip">{driverChip}</span></div>
      <div class="perf-gpu-main">
        <div class="perf-ring perf-ring-sm" style={`--p:${usagePercent}`}>
          <div class="perf-ring-copy"><strong>{usageShown}</strong><span>%</span></div>
        </div>
        <div class="perf-facts">
          <span><b>{coreClock}</b><small>核心频率</small></span>
          <span><b>{memoryClock}</b><small>显存频率</small></span>
        </div>
      </div>
    </section>
    <section class="perf-pane perf-vram">
      <div class="perf-pane-head"><span class="kicker">VRAM</span></div>
      <div class="perf-vram-main">
        <div class="perf-big"><strong>{gpu.memoryUsed ? formatBytes(gpu.memoryUsed) : '—'}</strong><span>{gpu.memoryTotal ? `/ ${formatBytes(gpu.memoryTotal)}` : '/ —'}</span></div>
        <div class="perf-bar"><i style={`width:${memoryBarWidth}%`}></i></div>
        <p class="perf-note">{memoryNote}</p>
      </div>
    </section>
  </div>
</article>
