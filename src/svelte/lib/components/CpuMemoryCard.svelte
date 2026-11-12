<script lang="ts">
  import { app } from '../state.svelte';
  import { formatBytes, formatUptime } from '../format';

  const data = $derived(app.performance);
  const loaded = $derived(data !== null);
  const cpu = $derived(data?.cpu || {});
  const memory = $derived(data?.memory || {});

  const cpuUsage = $derived(Number(cpu.usage));
  const cpuModel = $derived(String(cpu.model || '').trim() || '处理器');
  const cpuHeader = $derived(loaded ? cpuModel : '正在读取处理器信息');
  const cpuPercent = $derived(Number.isFinite(cpuUsage) ? Math.max(0, Math.min(100, cpuUsage)) : 0);
  const cpuShown = $derived(Number.isFinite(cpuUsage) ? Math.round(cpuUsage) : '—');

  const speed = $derived.by(() => {
    const value = Number(cpu.speed);
    return Number.isFinite(value) && value > 0 ? `${(value / 1000).toFixed(2)} GHz` : '—';
  });
  const uptime = $derived(loaded ? formatUptime(cpu.uptime) : '—');
  const threadChip = $derived(
    Number.isFinite(Number(cpu.cores)) && Number(cpu.cores) > 0 ? `${cpu.cores} 线程` : '线程数 —',
  );

  const memoryPercent = $derived(Number(memory.percent));
  const memoryBarWidth = $derived(Number.isFinite(memoryPercent) ? Math.max(0, Math.min(100, memoryPercent)) : 0);
  const memoryNote = $derived(loaded ? (Number.isFinite(Number(memory.free)) ? `空闲 ${formatBytes(memory.free)}` : '内存读数不可用') : '正在读取内存');
</script>

<article class="card perf-combo perf-system">
  <header class="perf-combo-head">
    <div><span class="kicker">SYSTEM</span><h2>CPU / 内存</h2></div>
    <h3 class="perf-model-name" title={cpuModel}>{cpuHeader}</h3>
  </header>
  <div class="perf-combo-body">
    <section class="perf-pane perf-cpu">
      <div class="perf-pane-head"><span class="kicker">CPU</span><span class="perf-chip">{threadChip}</span></div>
      <div class="perf-cpu-main">
        <div class="perf-ring" style={`--p:${cpuPercent}`}>
          <div class="perf-ring-copy"><strong>{cpuShown}</strong><span>%</span></div>
        </div>
        <div class="perf-facts">
          <span><b>{speed}</b><small>当前频率</small></span>
          <span><b>{uptime}</b><small>运行时间</small></span>
        </div>
      </div>
    </section>
    <section class="perf-pane perf-memory">
      <div class="perf-pane-head"><span class="kicker">MEMORY</span></div>
      <div class="perf-memory-main">
        <div class="perf-big"><strong>{formatBytes(memory.used)}</strong><span>/ {formatBytes(memory.total)}</span></div>
        <div class="perf-bar"><i style={`width:${memoryBarWidth}%`}></i></div>
        <p class="perf-note">{memoryNote}</p>
      </div>
    </section>
  </div>
</article>
