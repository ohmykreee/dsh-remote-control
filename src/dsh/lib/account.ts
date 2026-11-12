/** Balance and Platform usage (today / current week) for the active DSH account. */

import { isRecord } from './types.js';
import type { DshContext, JsonRecord } from './types.js';
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

/** Spend window selected in the console settings. */
export type SpendWindow = 'calendar' | 'rolling';

/** States emitted by `readBalance`. */
type AccountStatus = 'unavailable' | 'error' | 'signed-out' | 'failed' | 'ready';

/** States emitted by `readUsage`; account states are reused as-is. */
type UsageStatus = AccountStatus | 'expired' | 'empty';

/** Balance snapshot for the active account. */
export interface BalanceState {
  signedIn: boolean;
  state: AccountStatus;
  currency?: string | null;
  balance?: number | null;
  paid?: number | null;
  bonus?: number | null;
  error?: string;
  updatedAt?: number;
  cached?: boolean;
}

/** One bar of the seven-day spend chart. */
interface UsageDay {
  date: string;
  label: string;
  cost: number;
}

/** Spend snapshot for the active account. */
export interface UsageSnapshot {
  state: UsageStatus;
  currency: string | null;
  today: number | null;
  spend: number | null;
  week?: number | null;
  spendWindow: SpendWindow;
  spendLabel: string;
  periodStart?: string;
  daily?: UsageDay[];
  error?: string;
  updatedAt?: number;
  cached?: boolean;
}

/** Balance plus usage, as returned by `getAccount`. */
export interface AccountSnapshot {
  available: boolean;
  signedIn: boolean;
  balance: BalanceState;
  usage: UsageSnapshot;
}

/** Settings slice `createAccountService` reads. */
type AccountSettings = {
  balance?: {
    spendWindow?: string;
  };
};

interface AccountOptions {
  locale?: string;
  getSettings?: () => AccountSettings;
}

/** Balance request metadata, also the `getBalance` argument. */
type ClientMetadata = {
  version: string;
  locale: string;
  timezoneOffsetSeconds: number;
};

/** Minimal `deepseekAccount` service surface. */
interface DeepseekAccountService {
  getState(): Promise<unknown>;
  getBalance(metadata: JsonRecord): Promise<unknown>;
  getPlatformSession?(): Promise<unknown>;
}

/** Narrow an untrusted JSON value to an array. */
function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function clientMetadata(locale = 'zh'): ClientMetadata {
  return {
    version: VERSION,
    locale,
    timezoneOffsetSeconds: localTimezoneOffsetSeconds(),
  };
}

function timeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function currencyOf(wallets: unknown): string | null {
  const list = asList(wallets);
  const normalized = list
    .map((wallet): { currency: string; balance: number | null } => {
      const record: JsonRecord = isRecord(wallet) ? wallet : {};
      return {
        currency: String(record.currency || '').toUpperCase(),
        balance: finiteNumber(record.balance, null),
      };
    })
    .filter((wallet) => wallet.currency && wallet.balance !== null);
  if (normalized.length === 0) return null;
  const cny = normalized.find((wallet) => wallet.currency === 'CNY');
  if (cny) return cny.currency;
  const usd = normalized.find((wallet) => wallet.currency === 'USD');
  if (usd) return usd.currency;
  return normalized[0].currency;
}

function sumWallets(wallets: unknown, currency: string): number {
  const list = asList(wallets);
  return list
    .filter((wallet) => String((isRecord(wallet) && wallet.currency) || '').toUpperCase() === currency)
    .reduce<number>((sum, wallet) => sum + (finiteNumber(isRecord(wallet) ? wallet.balance : 0, 0) ?? 0), 0);
}

function pickCostBlock(blocks: unknown, preferredCurrency: string | null): JsonRecord | null {
  const list: JsonRecord[] = asList(blocks).filter(isRecord);
  if (list.length === 0) return null;
  if (preferredCurrency) {
    const exact = list.find((block) => String(block.currency || '').toUpperCase() === preferredCurrency);
    if (exact) return exact;
  }
  const funded = list.find((block) =>
    [...asList(block.series), ...asList(block.function_series)].some((series) => {
      const seriesRecord: JsonRecord = isRecord(series) ? series : {};
      return asList(seriesRecord.buckets).some((bucket) => {
        const bucketRecord: JsonRecord = isRecord(bucket) ? bucket : {};
        return (finiteNumber(costOf(bucketRecord.cost), 0) ?? 0) > 0;
      });
    }),
  );
  return funded || list[0];
}

function costOf(value: unknown): number {
  if (value && typeof value === 'object') return finiteNumber(isRecord(value) ? value.value : null, 0) ?? 0;
  return finiteNumber(value, 0) ?? 0;
}

function costBlocks(payload: unknown): JsonRecord[] {
  const root: JsonRecord = isRecord(payload) ? payload : {};
  const data: JsonRecord = isRecord(root.data) ? root.data : {};
  const bizData = data.biz_data;
  if (Array.isArray(bizData)) return bizData.filter(isRecord);
  if (isRecord(bizData) && Array.isArray(bizData.data)) return bizData.data.filter(isRecord);
  if (isRecord(bizData)) return [bizData];
  return [];
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function lastSevenDays(now: Date): UsageDay[] {
  const start = startOfLocalDay(now);
  const days: UsageDay[] = [];
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

function parseUsage(
  costPayload: unknown,
  currency: string | null,
  now: Date = new Date(),
  periodStartMs: number | null = null,
  mode: SpendWindow = 'calendar',
): UsageSnapshot {
  const blocks = costBlocks(costPayload);
  const block = pickCostBlock(blocks, currency);
  const dayStart: number = startOfLocalDay(now).getTime();
  const startMs: number = finiteNumber(periodStartMs, startOfLocalWeek(now).getTime()) ?? startOfLocalWeek(now).getTime();
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
  for (const series of [...asList(block.series), ...asList(block.function_series)]) {
    const seriesRecord: JsonRecord = isRecord(series) ? series : {};
    for (const bucket of asList(seriesRecord.buckets)) {
      const bucketRecord: JsonRecord = isRecord(bucket) ? bucket : {};
      const time: number | null = finiteNumber(bucketRecord.time, null);
      if (time === null) continue;
      const timeMs = time * 1000;
      const cost = costOf(bucketRecord.cost);
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

export function createAccountService(ctx: DshContext, options: AccountOptions = {}): {
  getAccount(force?: boolean): Promise<AccountSnapshot>;
  readBalance(force?: boolean): Promise<BalanceState>;
  readUsage(force?: boolean): Promise<UsageSnapshot>;
} {
  const locale = options.locale || 'zh';
  const getSettings: () => AccountSettings =
    options.getSettings || (() => ({ balance: { spendWindow: 'calendar' } }));
  const resolveAccount = (): DeepseekAccountService | undefined =>
    ctx.get?.('deepseekAccount') as DeepseekAccountService | undefined;
  let balanceCache: BalanceState | null = null;
  let balanceAt = 0;
  let usageCache: UsageSnapshot | null = null;
  let usageAt = 0;

  async function readBalance(force = false): Promise<BalanceState> {
    const account = resolveAccount();
    if (!account) return { signedIn: false, state: 'unavailable', error: 'Account service is not mounted' };
    const now = Date.now();
    const ttl = balanceCache?.state === 'ready' ? BALANCE_TTL_MS : BALANCE_ERROR_TTL_MS;
    if (!force && balanceCache && now - balanceAt < ttl) return { ...balanceCache, cached: true };

    let state: unknown;
    try {
      state = await account.getState();
    } catch (error) {
      balanceCache = { signedIn: false, state: 'error', error: serializeError(error) };
      balanceAt = now;
      return balanceCache;
    }
    const stateRecord: JsonRecord | null = isRecord(state) ? state : null;
    if (!state || stateRecord?.status === 'signed-out') {
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
      const detailsRecord: JsonRecord | null = isRecord(details) ? details : null;
      if (!detailsRecord || detailsRecord.status !== 'ready') {
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
      const currency = currencyOf(detailsRecord.value) || currencyOf(detailsRecord.bonusWallets) || 'CNY';
      const paid = sumWallets(detailsRecord.value, currency);
      const bonus = sumWallets(detailsRecord.bonusWallets, currency);
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

  async function readUsage(force = false): Promise<UsageSnapshot> {
    const account = resolveAccount();
    const mode: SpendWindow = getSettings()?.balance?.spendWindow === 'rolling' ? 'rolling' : 'calendar';
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
      const origin = isRecord(platform) && typeof platform.origin === 'string' ? platform.origin : '';
      const token = isRecord(platform) && typeof platform.token === 'string' ? platform.token : '';
      if (!origin || !token) {
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
      const url = new URL('/api/v0/usage/by_api_key/cost', origin);
      url.searchParams.set('start', String(Math.floor(periodStart.getTime() / 1000)));
      url.searchParams.set('end', String(Math.floor(tomorrow.getTime() / 1000)));
      url.searchParams.set('tz', String(tz));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${token}`,
            'x-dsh-auth-token': token,
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
      const payload: unknown = await response.json();
      const payloadRecord: JsonRecord = isRecord(payload) ? payload : {};
      const data: JsonRecord = isRecord(payloadRecord.data) ? payloadRecord.data : {};
      const code: number = finiteNumber(payloadRecord.code, 0);
      const bizCode: number = finiteNumber(data.biz_code, 0);
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

  async function getAccount(force = false): Promise<AccountSnapshot> {
    const balance = await readBalance(force);
    if (!balance.signedIn) {
      const mode: SpendWindow = getSettings()?.balance?.spendWindow === 'rolling' ? 'rolling' : 'calendar';
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
