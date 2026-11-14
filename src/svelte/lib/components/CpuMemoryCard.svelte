<script lang="ts">
  import { app } from '../state.svelte';
  import { formatBytes, formatUptime } from '../format';
  import { t } from '../i18n.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import Cpu from '@lucide/svelte/icons/cpu';
  import Panel from './Panel.svelte';
  import RadialGauge from './RadialGauge.svelte';

  const data = $derived(app.performance);
  const loaded = $derived(data !== null);
  const cpu = $derived(data?.cpu || {});
  const memory = $derived(data?.memory || {});

  const cpuUsage = $derived(Number(cpu.usage));
  const cpuPercent = $derived(Number.isFinite(cpuUsage) ? Math.max(0, Math.min(100, cpuUsage)) : 0);
  const cpuModel = $derived(String(cpu.model || '').trim());
  const cpuHeader = $derived(loaded ? cpuModel || t('currentStatus') : t('sessionLoading'));

  const speed = $derived.by(() => {
    const value = Number(cpu.speed);
    return Number.isFinite(value) && value > 0 ? `${(value / 1000).toFixed(2)} GHz` : '—';
  });
  const uptime = $derived(loaded ? formatUptime(cpu.uptime) : '—');
  const threadChip = $derived.by(() => {
    const cores = Number(cpu.cores);
    if (!Number.isFinite(cores) || cores <= 0) return '—';
    return cores === 1 ? t('threadCountOne') : t('threadCount', { count: cores });
  });

  const memoryPercent = $derived(Number(memory.percent));
  const percentShown = $derived(
    Number.isFinite(memoryPercent) ? Math.max(0, Math.min(100, Math.round(memoryPercent))) : 0,
  );
  const memoryTotal = $derived(formatBytes(memory.total));
  const memoryFree = $derived(formatBytes(memory.free));
  const memoryUsed = $derived(formatBytes(memory.used));
</script>

<Panel class="system-card relative flex min-h-0 flex-col overflow-hidden p-4">
  <div class="perf-glow" aria-hidden="true"></div>

  <header class="relative z-10 flex items-center gap-3">
    <span class="grid size-11 shrink-0 place-items-center rounded-[13px] border border-border bg-secondary text-brand">
      <Cpu class="size-[24px]" strokeWidth={1.7} />
    </span>
    <div class="min-w-0">
      <p class="eyebrow">SYSTEM</p>
      <h2 class="mt-0.5 truncate text-[24px] leading-tight font-semibold tracking-[-0.03em] text-foreground">
        {t('cpuMemory')}
      </h2>
    </div>
    <p class="ml-auto max-w-[46%] truncate text-right text-[14px] text-muted-foreground" title={cpuModel}>
      {cpuHeader}
    </p>
  </header>

  <div class="pane-grid relative z-10">
    <section class="usage-pane">
      <div class="pane-head flex items-center justify-between gap-2.5">
        <span class="eyebrow">CPU</span>
        <Badge
          variant="outline"
          class="h-6 border-border bg-secondary px-2 text-[11px] font-medium text-muted-foreground"
        >
          {threadChip}
        </Badge>
      </div>

      <div class="pane-body">
        <RadialGauge value={cpuPercent} color="var(--brand)" />
        <div class="grid w-full grid-cols-2 gap-2">
          <div class="fact-tile">
            <span>{t('currentFrequency')}</span>
            <b class="numeric">{speed}</b>
          </div>
          <div class="fact-tile">
            <span>{t('runningTime')}</span>
            <b class="numeric">{uptime}</b>
          </div>
        </div>
      </div>
    </section>

    <section class="usage-pane is-right">
      <div class="pane-head flex items-center justify-between gap-2.5">
        <span class="eyebrow">MEMORY</span>
        <Badge
          variant="outline"
          class="h-6 border-border bg-secondary px-2 text-[11px] font-medium text-muted-foreground"
        >
          {memoryTotal}
        </Badge>
      </div>

      <div class="pane-body">
        <RadialGauge value={percentShown} color="var(--success)" />
        <div class="grid w-full grid-cols-2 gap-2">
          <div class="fact-tile">
            <span>{t('memoryUsed')}</span>
            <b class="numeric">{memoryUsed}</b>
          </div>
          <div class="fact-tile">
            <span>{t('memoryFree')}</span>
            <b class="numeric">{memoryFree}</b>
          </div>
        </div>
      </div>
    </section>
  </div>
</Panel>

<style>
  :global(.system-card) {
    background:
      radial-gradient(90% 110% at 100% 0%, color-mix(in srgb, var(--brand) 8%, transparent), transparent 57%),
      var(--card);
  }

  .perf-glow {
    position: absolute;
    right: -70px;
    bottom: -110px;
    width: 210px;
    height: 210px;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--brand) 11%, transparent);
    pointer-events: none;
  }

  .pane-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    flex: 1;
    min-height: 0;
    margin-top: 10px;
    border-top: 1px solid var(--border);
  }

  .usage-pane {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    padding-top: 8px;
    padding-right: 12px;
  }

  .usage-pane.is-right {
    margin-left: 0;
    padding-right: 0;
    padding-left: 12px;
    border-left: 1px solid var(--border);
  }

  .pane-body {
    display: flex;
    flex: 1;
    min-height: 0;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding-top: 2px;
  }

  .fact-tile {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 6px 7px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--secondary) 48%, transparent);
    text-align: center;
  }

  .fact-tile span {
    color: var(--muted-foreground);
    font-size: 11px;
    white-space: nowrap;
  }

  .fact-tile b {
    overflow: hidden;
    max-width: 100%;
    color: var(--foreground);
    font-size: clamp(13px, 1.6vw, 16px);
    font-weight: 550;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-height: 760px) {
    :global(.system-card) {
      padding: 12px;
    }

    .pane-grid {
      margin-top: 7px;
    }

    .usage-pane {
      padding-top: 6px;
      padding-right: 10px;
    }

    .usage-pane.is-right {
      margin-left: 0;
      padding-right: 0;
      padding-left: 10px;
    }

    .pane-body {
      gap: 5px;
    }

    .fact-tile {
      padding: 5px 7px;
    }

    .fact-tile span {
      font-size: 12px;
    }

    .fact-tile b {
      font-size: 14px;
    }
  }

  @media (orientation: portrait) {
    :global(.system-card) {
      min-height: 320px;
    }
  }
</style>
