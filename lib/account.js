/** Balance and Platform usage (today / current week) for the active DSH account. */

import {
  finiteNumber,
  localTimezoneOffsetSeconds,
  serializeError,
  startOfLocalDay,
  startOfLocalWeek,
  VERSION,
} from './util.js';

const BALANCE_TTL_MS = 60_000;
const BALANCE_ERROR_TTL_MS = 20_000;
const USAGE_TTL_MS = 90_000;
const USAGE_ERROR_TTL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 9000;

function clientMetadata(locale = 'zh') {
  return {
    version: VERSION,
    locale,
    timezoneOffsetSeconds: localTimezoneOffsetSeconds(),
  };
}

function timeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function currencyOf(wallets) {
  const list = Array.isArray(wallets) ? wallets : [];
  const normalized = list
    .map((wallet) => ({
      currency: String(wallet?.currency || '').toUpperCase(),
      balance: finiteNumber(wallet?.balance, null),
    }))
    .filter((wallet) => wallet.currency && wallet.balance !== null);
  if (normalized.length === 0) return null;
  const cny = normalized.find((wallet) => wallet.currency === 'CNY');
  if (cny) return cny.currency;
  const usd = normalized.find((wallet) => wallet.currency === 'USD');
  if (usd) return usd.currency;
  return normalized[0].currency;
}

function sumWallets(wallets, currency) {
  const list = Array.isArray(wallets) ? wallets : [];
  return list
    .filter((wallet) => String(wallet?.currency || '').toUpperCase() === currency)
    .reduce((sum, wallet) => sum + (finiteNumber(wallet?.balance, 0) ?? 0), 0);
}

function pickCostBlock(blocks, preferredCurrency) {
  const list = Array.isArray(blocks) ? blocks : [];
  if (list.length === 0) return null;
  if (preferredCurrency) {
    const exact = list.find((block) => String(block?.currency || '').toUpperCase() === preferredCurrency);
    if (exact) return exact;
  }
  const funded = list.find((block) =>
    [...(block?.series ?? []), ...(block?.function_series ?? [])].some((series) =>
      (series?.buckets ?? []).some((bucket) => (finiteNumber(costOf(bucket?.cost), 0) ?? 0) > 0),
    ),
  );
  return funded || list[0];
}

function costOf(value) {
  if (value && typeof value === 'object') return finiteNumber(value.value, 0) ?? 0;
  return finiteNumber(value, 0) ?? 0;
}

function costBlocks(payload) {
  const bizData = payload?.data?.biz_data;
  if (Array.isArray(bizData)) return bizData;
  if (Array.isArray(bizData?.data)) return bizData.data;
  if (bizData && typeof bizData === 'object') return [bizData];
  return [];
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function lastSevenDays(now) {
  const start = startOfLocalDay(now);
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(start);
    date.setDate(date.getDate() - offset);
    days.push({
      date: localDateKey(date),
      label: offset === 0 ? '今天' : `${date.getMonth() + 1}/${date.getDate()}`,
      cost: 0,
    });
  }
  return days;
}

function parseUsage(costPayload, currency, now = new Date(), periodStartMs = null, mode = 'calendar') {
  const blocks = costBlocks(costPayload);
  const block = pickCostBlock(blocks, currency);
  const dayStart = startOfLocalDay(now).getTime();
  const startMs = finiteNumber(periodStartMs, startOfLocalWeek(now).getTime()) ?? startOfLocalWeek(now).getTime();
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  const endMs = end.getTime();
  const daily = lastSevenDays(now);

  if (!block) {
    return {
      state: 'empty',
      currency,
      today: 0,
      spend: 0,
      spendWindow: mode,
      spendLabel: mode === 'rolling' ? '最近 7 天' : '本周',
      periodStart: new Date(startMs).toISOString(),
      daily,
      updatedAt: Date.now(),
    };
  }
  const effectiveCurrency = String(block.currency || currency || 'CNY').toUpperCase();

  let today = 0;
  let spend = 0;
  for (const series of [...(block.series ?? []), ...(block.function_series ?? [])]) {
    for (const bucket of series?.buckets ?? []) {
      const time = finiteNumber(bucket?.time, null);
      if (time === null) continue;
      const timeMs = time * 1000;
      const cost = costOf(bucket?.cost);
      const bucketDate = localDateKey(new Date(timeMs));
      const day = daily.find((entry) => entry.date === bucketDate);
      if (day) day.cost += cost;
      if (timeMs < startMs || timeMs >= endMs) continue;
      spend += cost;
      if (timeMs >= dayStart) today += cost;
    }
  }
  return {
    state: 'ready',
    currency: effectiveCurrency,
    today,
    spend,
    spendWindow: mode,
    spendLabel: mode === 'rolling' ? '最近 7 天' : '本周',
    periodStart: new Date(startMs).toISOString(),
    daily,
    updatedAt: Date.now(),
  };
}

export function createAccountService(ctx, options = {}) {
  const locale = options.locale || 'zh';
  const getSettings = options.getSettings || (() => ({ balance: { spendWindow: 'calendar' } }));
  const resolveAccount = () => ctx.get?.('deepseekAccount');
  let balanceCache = null;
  let balanceAt = 0;
  let usageCache = null;
  let usageAt = 0;

  async function readBalance(force = false) {
    const account = resolveAccount();
    if (!account) return { signedIn: false, state: 'unavailable', error: 'Account service is not mounted' };
    const now = Date.now();
    const ttl = balanceCache?.state === 'ready' ? BALANCE_TTL_MS : BALANCE_ERROR_TTL_MS;
    if (!force && balanceCache && now - balanceAt < ttl) return { ...balanceCache, cached: true };

    let state;
    try {
      state = await account.getState();
    } catch (error) {
      balanceCache = { signedIn: false, state: 'error', error: serializeError(error) };
      balanceAt = now;
      return balanceCache;
    }
    if (!state || state.status === 'signed-out') {
      balanceCache = {
        signedIn: false,
        state: 'signed-out',
        currency: null,
        balance: null,
        paid: null,
        bonus: null,
        updatedAt: now,
      };
      balanceAt = now;
      return balanceCache;
    }

    try {
      const details = await timeout(account.getBalance(clientMetadata(locale)), REQUEST_TIMEOUT_MS, 'Balance');
      if (!details || details.status !== 'ready') {
        balanceCache = {
          signedIn: true,
          state: 'failed',
          currency: null,
          balance: null,
          paid: null,
          bonus: null,
          error: 'Balance request failed',
          updatedAt: now,
        };
        balanceAt = now;
        return balanceCache;
      }
      const currency = currencyOf(details.value) || currencyOf(details.bonusWallets) || 'CNY';
      const paid = sumWallets(details.value, currency);
      const bonus = sumWallets(details.bonusWallets, currency);
      balanceCache = {
        signedIn: true,
        state: 'ready',
        currency,
        balance: paid + bonus,
        paid,
        bonus,
        updatedAt: now,
      };
    } catch (error) {
      balanceCache = {
        signedIn: true,
        state: 'failed',
        currency: null,
        balance: null,
        paid: null,
        bonus: null,
        error: serializeError(error),
        updatedAt: now,
      };
    }
    balanceAt = now;
    return balanceCache;
  }

  async function readUsage(force = false) {
    const account = resolveAccount();
    const mode = getSettings()?.balance?.spendWindow === 'rolling' ? 'rolling' : 'calendar';
    if (!account?.getPlatformSession) {
      return {
        state: 'unavailable',
        currency: null,
        today: null,
        spend: null,
        week: null,
        spendWindow: mode,
        spendLabel: mode === 'rolling' ? '最近 7 天' : '本周',
        error: 'Usage is unavailable',
      };
    }
    const now = Date.now();
    const ttl = usageCache?.state === 'ready' ? USAGE_TTL_MS : USAGE_ERROR_TTL_MS;
    if (!force && usageCache && usageCache.spendWindow === mode && now - usageAt < ttl) {
      return { ...usageCache, cached: true };
    }

    try {
      const platform = await timeout(account.getPlatformSession(), 4000, 'Platform session');
      if (!platform?.origin || !platform?.token) {
        usageCache = {
          state: 'signed-out',
          currency: null,
          today: null,
          spend: null,
          week: null,
          spendWindow: mode,
          spendLabel: mode === 'rolling' ? '最近 7 天' : '本周',
          updatedAt: now,
        };
        usageAt = now;
        return usageCache;
      }

      const current = new Date();
      const todayStart = startOfLocalDay(current);
      const periodStart =
        mode === 'rolling'
          ? new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000)
          : startOfLocalWeek(current);
      const tomorrow = new Date(current);
      tomorrow.setHours(24, 0, 0, 0);
      const tz = localTimezoneOffsetSeconds(current);
      const url = new URL('/api/v0/usage/by_api_key/cost', platform.origin);
      url.searchParams.set('start', String(Math.floor(periodStart.getTime() / 1000)));
      url.searchParams.set('end', String(Math.floor(tomorrow.getTime() / 1000)));
      url.searchParams.set('tz', String(tz));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${platform.token}`,
            'x-dsh-auth-token': platform.token,
            accept: 'application/json',
            'x-client-platform': 'web',
            'x-client-locale': locale === 'zh' ? 'zh_CN' : 'en_US',
            'x-client-version': VERSION,
          },
        });
      } finally {
        clearTimeout(timer);
      }
      if (response.status === 401 || response.status === 403) {
        usageCache = {
          state: 'expired',
          currency: null,
          today: null,
          spend: null,
          week: null,
          spendWindow: mode,
          spendLabel: mode === 'rolling' ? '最近 7 天' : '本周',
          error: `HTTP ${response.status}`,
          updatedAt: now,
        };
        usageAt = now;
        return usageCache;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const code = finiteNumber(payload?.code, 0);
      const bizCode = finiteNumber(payload?.data?.biz_code, 0);
      if (code !== 0 || bizCode !== 0) {
        if (code === 40002 || code === 40003 || bizCode === 40002 || bizCode === 40003) {
          usageCache = {
            state: 'expired',
            currency: null,
            today: null,
            spend: null,
            week: null,
            spendWindow: mode,
            spendLabel: mode === 'rolling' ? '最近 7 天' : '本周',
            error: `code ${code || bizCode}`,
            updatedAt: now,
          };
          usageAt = now;
          return usageCache;
        }
        throw new Error(`Platform code ${code || bizCode}`);
      }
      usageCache = parseUsage(payload, balanceCache?.currency || null, current, periodStart.getTime(), mode);
      usageCache.week = usageCache.spend;
      usageAt = now;
      return usageCache;
    } catch (error) {
      usageCache = {
        state: 'error',
        currency: balanceCache?.currency || null,
        today: null,
        spend: null,
        week: null,
        spendWindow: mode,
        spendLabel: mode === 'rolling' ? '最近 7 天' : '本周',
        error: serializeError(error),
        updatedAt: now,
      };
      usageAt = now;
      return usageCache;
    }
  }

  async function getAccount(force = false) {
    const balance = await readBalance(force);
    if (!balance.signedIn) {
      const mode = getSettings()?.balance?.spendWindow === 'rolling' ? 'rolling' : 'calendar';
      return {
        available: true,
        signedIn: false,
        balance,
        usage: {
          state: balance.state,
          currency: null,
          today: null,
          spend: null,
          week: null,
          spendWindow: mode,
          spendLabel: mode === 'rolling' ? '最近 7 天' : '本周',
        },
      };
    }
    const usage = await readUsage(force);
    return {
      available: true,
      signedIn: true,
      balance,
      usage,
    };
  }

  return { getAccount, readBalance, readUsage };
}
