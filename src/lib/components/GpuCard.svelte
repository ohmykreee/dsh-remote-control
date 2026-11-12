<script lang="ts">
  import { app } from '../state.svelte';
  import { formatBytes } from '../format';

  const data = $derived(app.performance);
  const loaded = $derived(data !== null);
  const gpu = $derived(data?.gpu || {});
  const gpuModel = $derived(String(gpu.name || '').trim());
  const gpuName = $derived(gpuModel || '未检测到独立显卡');
  const gpuHeader = $derived(loaded ? gpuName : '正在读取显卡信息');
  const gpuTitle = $derived(gpuModel ? `GPU：${gpuModel}` : '');
  const usage = $derived(Number(gpu.utilization));
  const usagePercent = $derived(Number.isFinite(usage) ? Math.max(0, Math.min(100, usage)) : 0);
  const usageShown = $derived(Number.isFinite(usage) ? Math.round(usage) : '—');
  const usageChip = $derived(Number.isFinite(usage) ? `${Math.round(usage)}%` : '—%');
  const memoryPercent = $derived(Number(gpu.memoryPercent));
  const memoryChip = $derived(Number.isFinite(memoryPercent) ? `${Math.round(memoryPercent)}%` : '—%');
  const memoryBarWidth = $derived(Number.isFinite(memoryPercent) ? Math.max(0, Math.min(100, memoryPercent)) : 0);
  const note = $derived(
    !loaded
      ? '—'
      : gpu.ok === false
        ? gpu.error || 'GPU 读数不可用'
        : gpu.driver
          ? `驱动 ${gpu.driver}`
          : 'GPU 读数',
  );
</script>

<article class="card perf-combo perf-graphics">
  <header class="perf-combo-head">
    <div><span class="kicker">GRAPHICS</span><h2>GPU / 显存</h2></div>
    <h3 class="perf-model-name" title={gpuTitle}>{gpuHeader}</h3>
  </header>
  <div class="perf-combo-body">
    <section class="perf-pane perf-gpu">
      <div class="perf-pane-head"><span class="kicker">GPU</span><span class="perf-chip">{usageChip}</span></div>
      <div class="perf-gpu-main">
        <div class="perf-ring perf-ring-sm" style={`--p:${usagePercent}`}>
          <div class="perf-ring-copy"><strong>{usageShown}</strong><span>%</span></div>
        </div>
        <p class="perf-note">{note}</p>
      </div>
    </section>
    <section class="perf-pane perf-vram">
      <div class="perf-pane-head"><span class="kicker">VRAM</span><span class="perf-chip">{memoryChip}</span></div>
      <div class="perf-vram-main">
        <div class="perf-big"><strong>{gpu.memoryUsed ? formatBytes(gpu.memoryUsed) : '—'}</strong><span>{gpu.memoryTotal ? `/ ${formatBytes(gpu.memoryTotal)}` : '/ —'}</span></div>
        <div class="perf-bar"><i style={`width:${memoryBarWidth}%`}></i></div>
        <p class="perf-note">显存占用</p>
      </div>
    </section>
  </div>
</article>
