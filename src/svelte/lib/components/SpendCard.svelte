<script lang="ts">
  import { app } from '../state.svelte';
  import { formatMoney } from '../format';
  import { t } from '../i18n.svelte';
  import ChartColumn from '@lucide/svelte/icons/chart-column';
  import Panel from './Panel.svelte';
  import SectionHeader from './SectionHeader.svelte';

  const account = $derived(app.account);
  const signedIn = $derived(Boolean(account && account.available !== false && account.signedIn));
  const usage = $derived(signedIn ? account?.usage || {} : {});
  const currency = $derived(account?.balance?.currency || usage.currency || 'CNY');
  const ready = $derived(usage.state === 'ready');
  const daily = $derived(ready && Array.isArray(usage.daily) ? usage.daily : []);
  const max = $derived(Math.max(0, ...daily.map((day) => Number(day.cost) || 0)));
  const today = $derived(ready ? usage.today : null);
  const spend = $derived(ready ? usage.spend : null);
  const spendLabel = $derived(t(app.balanceDisplay.spendWindow === 'rolling' ? 'last7Days' : 'thisWeek'));
</script>

<Panel class="spend-card relative flex min-h-0 flex-col overflow-hidden p-4">
  <div class="spend-chart" aria-hidden="true">
    {#each daily as day, index (day.label || index)}
      {@const height = max > 0 ? Math.max(6, Math.round(((Number(day.cost) || 0) / max) * 100)) : 6}
      <i class:is-today={index === daily.length - 1} style={`height:${height}%`}></i>
    {/each}
  </div>

  <div class="relative z-10">
    <SectionHeader icon={ChartColumn} eyebrow="SPEND" title={t('usage')} />

    <div class="spend-values mt-3 grid grid-cols-2 gap-3">
      <div>
        <p class="text-[15px] text-muted-foreground">{t('todaySpend')}</p>
        <p class="spend-number numeric mt-1">{ready ? formatMoney(today, usage.currency || currency) : '—'}</p>
      </div>
      <div class="border-l border-border pl-3">
        <p class="text-[15px] text-muted-foreground">{spendLabel}</p>
        <p class="spend-number numeric mt-1">{ready ? formatMoney(spend, usage.currency || currency) : '—'}</p>
      </div>
    </div>
  </div>
</Panel>

<style>
  :global(.spend-card) {
    background: linear-gradient(180deg, color-mix(in srgb, var(--brand) 4%, transparent), transparent 68%), var(--card);
  }

  .spend-chart {
    position: absolute;
    z-index: 0;
    inset: 48% 12px 10px 12px;
    display: flex;
    align-items: flex-end;
    gap: 7px;
    opacity: 0.5;
    pointer-events: none;
  }

  .spend-chart i {
    display: block;
    min-width: 0;
    flex: 1;
    border-radius: 5px 5px 2px 2px;
    background: color-mix(in srgb, var(--brand) 26%, transparent);
  }

  .spend-chart i.is-today {
    background: color-mix(in srgb, var(--brand) 38%, transparent);
  }

  .spend-number {
    color: var(--foreground);
    font-size: clamp(26px, 3.3vw, 34px);
    font-weight: 560;
    line-height: 1;
    letter-spacing: -0.035em;
  }

  @media (max-height: 760px) {
    :global(.spend-card) {
      padding: 12px;
    }

    .spend-values {
      margin-top: 8px;
    }

    .spend-number {
      font-size: 28px;
    }

    .spend-chart {
      inset: 50% 10px 8px 10px;
      gap: 6px;
    }
  }

  @media (orientation: portrait) {
    :global(.spend-card) {
      min-height: 150px;
    }
  }
</style>
