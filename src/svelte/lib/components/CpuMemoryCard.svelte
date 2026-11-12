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
  const cpuTitle = $derived(cpu.model ? `实时负载 · ${cpuModel}` : '实时负载');
  const cpuPercent = $derived(Number.isFinite(cpuUsage) ? Math.max(0, Math.min(100, cpuUsage)) : 0);
  const cpuShown = $derived(Number.isFinite(cpuUsage) ? Math.round(cpuUsage) : '—');
  const cores = $derived(`${cpu.cores ?? '—'} 核心`);
  const speed = $derived(cpu.speed ? `${(Number(cpu.speed) / 1000).toFixed(1)} GHz` : '—');
  const uptime = $derived(formatUptime(cpu.uptime));

  const memoryPercent = $derived(Number(memory.percent));
  const memoryPercentText = $derived(Number.isFinite(memoryPercent) ? `${Math.round(memoryPercent)}%` : '—%');
  const memoryBarWidth = $derived(Number.isFinite(memoryPercent) ? Math.max(0, Math.min(100, memoryPercent)) : 0);
  const memoryNote = $derived(loaded ? (Number.isFinite(Number(memory.free)) ? `空闲 ${formatBytes(memory.free)}` : '内存读数不可用') : '正在读取内存');
</script>

<article class="card perf-combo perf-system">
  <header class="perf-combo-head">
    <div><span class="kicker">SYSTEM</span><h2>CPU / 内存</h2></div>
    <h3 class="perf-model-name" title={loaded ? cpuTitle : ''}>{cpuHeader}</h3>
  </header>
  <div class="perf-combo-body">
    <section class="perf-pane perf-cpu">
      <div class="perf-pane-head"><span class="kicker">CPU</span><span class="perf-chip">{cores}</span></div>
      <div class="perf-cpu-main">
        <div class="perf-ring" style={`--p:${cpuPercent}`}>
          <div class="perf-ring-copy"><strong>{cpuShown}</strong><span>%</span></div>
        </div>
        <div class="perf-facts">
          <span><b>{speed}</b><small>频率</small></span>
          <span><b>{uptime}</b><small>运行时间</small></span>
        </div>
      </div>
    </section>
    <section class="perf-pane perf-memory">
      <div class="perf-pane-head"><span class="kicker">MEMORY</span><span class="perf-chip">{memoryPercentText}</span></div>
      <div class="perf-memory-main">
        <div class="perf-big"><strong>{formatBytes(memory.used)}</strong><span>/ {formatBytes(memory.total)}</span></div>
        <div class="perf-bar"><i style={`width:${memoryBarWidth}%`}></i></div>
        <p class="perf-note">{memoryNote}</p>
      </div>
    </section>
  </div>
</article>
