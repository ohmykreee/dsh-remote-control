<script lang="ts">
  import { app } from '../state.svelte';
  import { formatMoney } from '../format';

  const account = $derived(app.account);
  const signedIn = $derived(Boolean(account && account.available !== false && account.signedIn));
  const usage = $derived(signedIn ? account?.usage || {} : {});
  const currency = $derived(account?.balance?.currency || usage.currency || 'CNY');
  const ready = $derived(usage.state === 'ready');
  const daily = $derived(ready && Array.isArray(usage.daily) ? usage.daily : []);
  const max = $derived(Math.max(0, ...daily.map((day) => Number(day.cost) || 0)));
  const today = $derived(ready ? usage.today : null);
  const spend = $derived(ready ? usage.spend : null);
  const spendLabel = $derived(usage.spendLabel || '本周');
  const caption = $derived(
    !signedIn
      ? '—'
      : ready
        ? `${usage.spendLabel || '本周'}累计 · 近 7 日柱状图按当日最高值归一`
        : usage.state === 'expired'
          ? '登录已过期，请回到 DSH 重新登录'
          : usage.error || '用量暂时不可用',
  );
</script>

<article class="card spend-card">
  <div class="spend-row"><span>今日</span><strong>{ready ? formatMoney(today, usage.currency || currency) : '—'}</strong></div>
  <div class="spend-row"><span>{spendLabel}</span><strong>{ready ? formatMoney(spend, usage.currency || currency) : '—'}</strong></div>
  <div class="spend-chart" aria-label="近 7 日使用金额">
    {#each daily as day, index (day.label || index)}
      {@const height = max > 0 ? Math.max(3, Math.round(((Number(day.cost) || 0) / max) * 100)) : 3}
      <div
        class="spend-bar"
        class:is-today={index === daily.length - 1}
        title={`${day.label} ${formatMoney(day.cost, usage.currency || currency)}`}
      >
        <i style={`height:${height}%`}></i>
        <span>{day.label}</span>
      </div>
    {/each}
  </div>
  <p class="muted-line spend-caption">{caption}</p>
</article>

<style>
.spend-card {
position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  align-items: start;
  gap: 0 8px;
  min-height: 0;
  padding: 24px 20px 18px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--accent) 8%, transparent), transparent 68%),
    var(--card);
}

.spend-row {
position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0;
  color: var(--muted);
  font-size: 11px;
  text-align: center;
}

.spend-row span {
color: color-mix(in srgb, var(--text) 62%, transparent);
  letter-spacing: 0.06em;
  text-shadow: 0 1px 7px color-mix(in srgb, var(--bg) 72%, transparent);
}

.spend-row strong {
color: var(--text);
  font-size: 24px;
  line-height: 1.05;
  font-weight: 590;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 2px 10px color-mix(in srgb, var(--bg) 55%, transparent);
}

.spend-chart {
position: absolute;
  z-index: 0;
  inset: 0;
  top: 44%;
  display: flex;
  align-items: flex-end;
  gap: 5px;
  margin: 0;
  padding: 12px 16px 8px;
  border-radius: inherit;
  background: none;
  opacity: 0.5;
  pointer-events: none;
}

.spend-bar {
flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 0;
  height: 100%;
}

.spend-bar i {
display: block;
  width: 100%;
  max-width: 26px;
  min-height: 2px;
  border-radius: 5px 5px 2px 2px;
  background: linear-gradient(0deg, color-mix(in srgb, var(--accent-2) 78%, #fff) 0%, color-mix(in srgb, var(--accent) 74%, #fff) 46%, color-mix(in srgb, var(--accent) 26%, transparent) 100%);
  opacity: 0.55;
}

.spend-bar.is-today i {
background: linear-gradient(0deg, color-mix(in srgb, var(--accent-2) 62%, #fff) 0%, color-mix(in srgb, var(--accent-2) 82%, #fff) 45%, color-mix(in srgb, var(--accent) 30%, transparent) 100%);
  opacity: 0.72;
  box-shadow: none;
}

.spend-bar span {
display: none;
}

.spend-caption {
display: none;
}

@media (max-height: 760px) {
  .spend-card {
    min-height: 0;
    padding: 12px 14px;
  }
  .spend-row {
    gap: 3px;
  }
  .spend-row strong {
    font-size: 18px;
  }
}

@media (orientation: portrait) {
  .spend-card {
    min-height: 150px;
  }
}
</style>
