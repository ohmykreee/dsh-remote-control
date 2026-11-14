<script lang="ts">
  import { app } from '../state.svelte';
  import { formatBytes } from '../format';
  import { t } from '../i18n.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import Monitor from '@lucide/svelte/icons/monitor';
  import Panel from './Panel.svelte';
  import RadialGauge from './RadialGauge.svelte';

  const data = $derived(app.performance);
  const loaded = $derived(data !== null);
  const gpu = $derived(data?.gpu || {});
  const gpuModel = $derived(String(gpu.name || '').trim());
  const unavailable = $derived(loaded && gpu.ok === false);
  const gpuHeader = $derived(!loaded
    ? t('sessionLoading')
    : unavailable
      ? t('unavailableShort')
      : gpuModel || t('noDiscreteGpu'));

  const usage = $derived(Number(gpu.utilization));
  const usagePercent = $derived(Number.isFinite(usage) ? Math.max(0, Math.min(100, usage)) : 0);

  function clock(value: unknown): string {
    if (value === null || value === undefined) return '—';
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) return '—';
    return number >= 1000 ? `${(number / 1000).toFixed(2)} GHz` : `${Math.round(number)} MHz`;
  }

  const coreClock = $derived(clock(gpu.coreClockMhz));
  const memoryClock = $derived(clock(gpu.memoryClockMhz));
  const vramTotal = $derived(gpu.memoryTotal ? formatBytes(gpu.memoryTotal) : '—');
  const vramUsed = $derived(gpu.memoryUsed ? formatBytes(gpu.memoryUsed) : '—');
  const vramFree = $derived(
    Number(gpu.memoryTotal) > 0 && Number(gpu.memoryUsed) >= 0
      ? formatBytes(Math.max(0, Number(gpu.memoryTotal) - Number(gpu.memoryUsed)))
      : '—',
  );
  const vramPercent = $derived(
    Number.isFinite(Number(gpu.memoryPercent)) ? Math.max(0, Math.min(100, Math.round(Number(gpu.memoryPercent)))) : 0,
  );
  const driver = $derived(typeof gpu.driver === 'string' && gpu.driver.trim() ? gpu.driver.trim() : '');
</script>

<Panel class="graphics-card relative flex min-h-0 flex-col overflow-hidden p-4">
  <div class="perf-glow" aria-hidden="true"></div>

  <header class="relative z-10 flex items-center gap-3">
    <span class="grid size-11 shrink-0 place-items-center rounded-[13px] border border-border bg-secondary text-brand">
      <Monitor class="size-[24px]" strokeWidth={1.7} />
    </span>
    <div class="min-w-0">
      <p class="eyebrow">GRAPHICS</p>
      <h2 class="mt-0.5 truncate text-[24px] leading-tight font-semibold tracking-[-0.03em] text-foreground">
        {t('gpuMemory')}
      </h2>
    </div>
    <p class="ml-auto max-w-[40%] truncate text-right text-[14px] text-muted-foreground" title={gpuModel}>
      {gpuHeader}
    </p>
  </header>

  <div class="pane-grid relative z-10">
    <section class="usage-pane">
      <div class="pane-head flex items-center justify-between gap-2.5">
        <span class="eyebrow">GPU</span>
        <Badge
          variant="outline"
          class="h-6 max-w-[72%] border-border bg-secondary px-2 text-[11px] font-medium text-muted-foreground"
          title={driver ? t('driverValue', { name: driver }) : t('driverUnknown')}
        >
          <span class="truncate">{driver ? t('driverValue', { name: driver }) : t('driverNone')}</span>
        </Badge>
      </div>

      <div class="pane-body">
        <RadialGauge value={usagePercent} color="var(--chart-4)" />
        <div class="grid w-full grid-cols-2 gap-2">
          <div class="fact-tile">
            <span>{t('coreClock')}</span>
            <b class="numeric">{coreClock}</b>
          </div>
          <div class="fact-tile">
            <span>{t('memoryClock')}</span>
            <b class="numeric">{memoryClock}</b>
          </div>
        </div>
      </div>
    </section>

    <section class="usage-pane is-right">
      <div class="pane-head flex items-center justify-between gap-2.5">
        <span class="eyebrow">VRAM</span>
        <Badge
          variant="outline"
          class="h-6 border-border bg-secondary px-2 text-[11px] font-medium text-muted-foreground"
        >
          {vramTotal}
        </Badge>
      </div>

      <div class="pane-body">
        <RadialGauge value={vramPercent} color="var(--chart-2)" />
        <div class="grid w-full grid-cols-2 gap-2">
          <div class="fact-tile">
            <span>{t('memoryUsed')}</span>
            <b class="numeric">{vramUsed}</b>
          </div>
          <div class="fact-tile">
            <span>{t('memoryFree')}</span>
            <b class="numeric">{vramFree}</b>
          </div>
        </div>
      </div>
    </section>
  </div>
</Panel>

<style>
  :global(.graphics-card) {
    background:
      radial-gradient(90% 110% at 100% 0%, color-mix(in srgb, var(--chart-4) 7%, transparent), transparent 57%),
      var(--card);
  }

  .perf-glow {
    position: absolute;
    right: -70px;
    bottom: -110px;
    width: 210px;
    height: 210px;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--chart-4) 11%, transparent);
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
    :global(.graphics-card) {
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
    :global(.graphics-card) {
      min-height: 320px;
    }
  }
</style>
