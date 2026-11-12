<script lang="ts">
  import { app } from '../state.svelte';
  import { currencySymbol, formatMoney } from '../format';
  import { beijingYear, ensureHolidayYear, tariffPeriod } from '../billing.svelte';
  import Icon from './Icon.svelte';

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

  const tariff = $derived(tariffPeriod(new Date(app.clockNow)));
  const showTariff = $derived(app.balanceDisplay.showPeakValley);

  let loadedHolidayYear = 0;
  $effect(() => {
    const year = beijingYear(new Date(app.clockNow));
    if (year === loadedHolidayYear) return;
    loadedHolidayYear = year;
    void ensureHolidayYear(year);
  });
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
  {#if showTariff}
    <div class="balance-tariff-art" class:is-peak={tariff === 'peak'} aria-hidden="true">
      <Icon name={tariff === 'peak' ? 'mountain' : 'moon'} />
    </div>
  {:else}
    <div class="balance-orbit" aria-hidden="true"><i></i><i></i><i></i></div>
  {/if}
</article>

<style>
.balance-card {
position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  min-height: 0;
  text-align: center;
  background:
    radial-gradient(110% 120% at 100% 0%, color-mix(in srgb, var(--accent) 28%, transparent), transparent 64%),
    linear-gradient(150deg, color-mix(in srgb, var(--card-2) 90%, var(--accent) 10%), var(--card));
}

.balance-line {
display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
  margin-top: 12px;
  font-variant-numeric: tabular-nums;
}

.balance-symbol {
color: var(--accent-2);
  font-size: 22px;
  font-weight: 580;
}

.balance-value {
font-size: 56px;
  line-height: 1;
  letter-spacing: -0.035em;
  font-weight: 580;
}

.balance-caption {
margin-top: 8px;
  font-size: 12px;
  line-height: 1.5;
  letter-spacing: 0.01em;
}

.balance-card > .kicker,
.balance-card > .balance-line,
.balance-card > .balance-caption {
  position: relative;
  z-index: 1;
}

/* Faint tariff watermark, bottom-right, matching the line-art weather icons. */
.balance-tariff-art {
  position: absolute;
  right: -28px;
  bottom: -26px;
  z-index: 0;
  width: 168px;
  height: 168px;
  color: var(--accent-2);
  opacity: 0.11;
  pointer-events: none;
}

.balance-tariff-art.is-peak {
  color: var(--amber);
  opacity: 0.13;
}

.balance-tariff-art :global(svg) {
  width: 100%;
  height: 100%;
}

.balance-card.is-low .balance-symbol {
color: var(--red);
}

.balance-card.is-low .balance-value {
color: var(--red);
}

.balance-alert {
position: relative;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-top: 14px;
  padding: 7px 10px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--red) 30%, transparent);
  background: color-mix(in srgb, var(--red) 10%, transparent);
  color: var(--red);
  font-size: 10.5px;
  font-weight: 600;
}

.alert-dot {
width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--red);
}

.balance-orbit {
position: absolute;
  width: 160px;
  height: 160px;
  right: -40px;
  bottom: -68px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
  opacity: 0.8;
}

.balance-orbit::before {
content: "";
  position: absolute;
  inset: 24px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--accent) 16%, transparent);
}

.balance-orbit i {
position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent-2);
}

.balance-orbit i:nth-child(1) {
top: 18px; right: 38px;
}

.balance-orbit i:nth-child(2) {
left: 30px; bottom: 20px; opacity: 0.5;
}

.balance-orbit i:nth-child(3) {
right: 12px; bottom: 52px; opacity: 0.35;
}

@media (max-height: 760px) {
  .balance-card {
    min-height: 0;
    padding: 14px;
  }
  .balance-value {
    font-size: 44px;
  }
  .balance-symbol {
    font-size: 19px;
  }
  .balance-caption {
    margin-top: 5px;
    font-size: 11px;
  }
}

@media (orientation: portrait) {
  .balance-card {
    min-height: 220px;
  }
}
</style>
