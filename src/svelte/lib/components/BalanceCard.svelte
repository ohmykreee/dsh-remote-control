<script lang="ts">
  import { app } from '../state.svelte';
  import { currencySymbol, formatMoney } from '../format';
  import { beijingYear, ensureHolidayYear, tariffPeriod } from '../billing.svelte';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import Wallet from '@lucide/svelte/icons/wallet';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Mountain from '@lucide/svelte/icons/mountain';
  import MoonStar from '@lucide/svelte/icons/moon-star';
  import Panel from './Panel.svelte';
  import SectionHeader from './SectionHeader.svelte';

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
      ? '正在同步'
      : !signedIn
        ? account?.balance?.error || '未登录账号'
        : balance?.state === 'ready'
          ? `充值 ${formatMoney(balance?.paid, currency)} · 赠送 ${formatMoney(balance?.bonus, currency)}`
          : balance?.error || '正在同步',
  );

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

<Panel class="balance-card relative flex min-h-0 flex-col overflow-hidden p-4">
  <div class="balance-glow" aria-hidden="true"></div>

  <div class="relative z-10">
    <SectionHeader icon={Wallet} eyebrow="ACCOUNT" title="账户余额">
      {#snippet children()}
        {#if showTariff}
          <Badge
            variant="outline"
            class="h-8 border-border bg-secondary px-3 text-[14px] font-medium text-muted-foreground"
            title={tariff === 'peak' ? '高峰时段' : '低谷时段'}
          >
            {#if tariff === 'peak'}
              <Mountain class="size-3.5 text-warn" strokeWidth={1.8} />
              高峰
            {:else}
              <MoonStar class="size-3.5 text-brand" strokeWidth={1.8} />
              低谷
            {/if}
          </Badge>
        {/if}
      {/snippet}
    </SectionHeader>
  </div>

  <div class="relative z-10 flex flex-1 flex-col justify-center py-2.5">
    <div class="balance-line numeric" class:is-low={low}>
      <span class="balance-symbol">{currencySymbol(currency)}</span>
      <span class="balance-value">{value}</span>
    </div>
    <p class="mt-1.5 line-clamp-2 text-[15px] leading-relaxed text-muted-foreground">{caption}</p>
    {#if low}
      <div class="mt-2 inline-flex items-center gap-1.5 self-start rounded-lg border border-danger/25 bg-danger-soft px-2 py-1 text-[14px] font-medium text-danger">
        <TriangleAlert class="size-4" strokeWidth={1.8} />
        低于提醒线 {formatMoney(account?.lowThreshold, currency)}
      </div>
    {/if}
  </div>
</Panel>

<style>
  :global(.balance-card) {
    background:
      radial-gradient(120% 130% at 100% 0%, color-mix(in srgb, var(--brand) 14%, transparent), transparent 62%),
      var(--card);
  }

  .balance-glow {
    position: absolute;
    right: -80px;
    bottom: -110px;
    width: 260px;
    height: 260px;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, var(--brand) 12%, transparent);
    box-shadow:
      0 0 0 28px color-mix(in srgb, var(--brand) 4%, transparent),
      0 0 0 64px color-mix(in srgb, var(--brand) 2.5%, transparent);
    pointer-events: none;
  }

  .balance-line {
    display: flex;
    align-items: baseline;
    gap: 4px;
    letter-spacing: -0.055em;
    line-height: 1;
  }

  .balance-symbol {
    color: var(--brand);
    font-size: 24px;
    font-weight: 560;
  }

  .balance-value {
    color: var(--foreground);
    font-size: clamp(42px, 5.4vw, 62px);
    font-weight: 560;
  }

  .balance-line.is-low .balance-symbol,
  .balance-line.is-low .balance-value {
    color: var(--danger);
  }

  /* Low state adds the alert capsule; shrink the amount so the whole card
     still fits in the short landscape layout instead of clipping the pill. */
  .balance-line.is-low .balance-value {
    font-size: clamp(36px, 4.6vw, 48px);
  }

  .balance-line.is-low .balance-symbol {
    font-size: 20px;
  }

  @media (max-height: 760px) {
    :global(.balance-card) {
      padding: 12px;
    }

    .balance-value {
      font-size: clamp(42px, 6vw, 56px);
    }

    .balance-symbol {
      font-size: 21px;
    }

    .balance-line.is-low .balance-value {
      font-size: clamp(34px, 4.4vw, 40px);
    }

    .balance-line.is-low .balance-symbol {
      font-size: 18px;
    }
  }

  @media (orientation: portrait) {
    :global(.balance-card) {
      min-height: 210px;
    }
  }
</style>
