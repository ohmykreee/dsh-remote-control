<script lang="ts">
  import { app } from '../state.svelte';
  import { currencySymbol, formatMoney } from '../format';

  const account = $derived(app.account);
  const loaded = $derived(account !== null);
  const signedIn = $derived(Boolean(account && account.available !== false && account.signedIn));
  const balance = $derived(account?.balance);
  const currency = $derived(balance?.currency || account?.usage?.currency || 'CNY');
  const low = $derived(signedIn && Boolean(account?.lowBalance));
  const value = $derived(
    signedIn && balance?.balance != null && Number.isFinite(Number(balance.balance))
      ? Number(balance.balance).toFixed(2)
      : '—',
  );
  const caption = $derived(
    !loaded
      ? '正在同步余额'
      : !signedIn
        ? account?.balance?.error || '未登录账号'
        : balance?.state === 'ready'
          ? `充值 ${formatMoney(balance?.paid, currency)} · 赠送 ${formatMoney(balance?.bonus, currency)}`
          : balance?.error || '正在同步余额',
  );
  const alertText = $derived(low ? `余额低于提醒线 ${formatMoney(account?.lowThreshold, currency)}` : '');
</script>

<article class="card balance-card" class:is-low={low}>
  <span class="kicker">ACCOUNT</span>
  <div class="balance-line">
    <span class="balance-symbol">{currencySymbol(currency)}</span>
    <span class="balance-value">{value}</span>
  </div>
  <p class="muted-line balance-caption">{caption}</p>
  {#if low}
    <div class="balance-alert"><span class="alert-dot"></span><span>{alertText}</span></div>
  {/if}
  <div class="balance-orbit" aria-hidden="true"><i></i><i></i><i></i></div>
</article>
