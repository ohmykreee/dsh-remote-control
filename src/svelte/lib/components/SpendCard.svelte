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
