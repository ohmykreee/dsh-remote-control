/**
 * Screen Wake Lock for the phone console.
 *
 * The lock is requested only when the Host setting is on, the page was opened
 * over HTTPS, and the tab is visible. Browsers release it automatically when
 * the page is hidden, so visibility changes release and reacquire it; anything
 * unsupported or denied is ignored and the console keeps working normally.
 */

interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockNavigator {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
  };
}

let requested = false;
let sentinel: WakeLockSentinelLike | null = null;
let visibilityBound = false;
let generation = 0;
let acquiring = false;

function wakeLockApi(): WakeLockNavigator['wakeLock'] {
  if (!window.isSecureContext) return undefined;
  return (navigator as Navigator & WakeLockNavigator).wakeLock;
}

function releaseSentinel(): void {
  generation += 1;
  const current = sentinel;
  sentinel = null;
  if (!current) return;
  try {
    void current.release().catch(() => {});
  } catch {
    /* an already released lock is fine */
  }
}

async function acquireWakeLock(): Promise<void> {
  if (!requested || sentinel || acquiring || document.visibilityState !== 'visible') return;
  const api = wakeLockApi();
  if (!api) return;
  acquiring = true;
  const token = ++generation;
  try {
    const next = await api.request('screen');
    if (token !== generation || !requested || document.visibilityState !== 'visible') {
      void next.release().catch(() => {});
      return;
    }
    sentinel = next;
    next.addEventListener('release', () => {
      if (sentinel === next) sentinel = null;
    });
  } catch {
    /* The browser can refuse the lock; the console does not depend on it. */
  } finally {
    acquiring = false;
    // A settings toggle can land while the request is in flight; retry once
    // the stale request has settled if the lock is still wanted.
    if (token !== generation && requested && !sentinel && document.visibilityState === 'visible') {
      void acquireWakeLock();
    }
  }
}

function handleVisibility(): void {
  if (!requested) return;
  if (document.visibilityState === 'visible') void acquireWakeLock();
  else releaseSentinel();
}

/** Apply the Host setting; safe to call on every settings snapshot. */
export function setWakeLockEnabled(enabled: boolean): void {
  const next = enabled === true;
  if (next === requested) {
    if (next && !sentinel && document.visibilityState === 'visible') void acquireWakeLock();
    return;
  }
  requested = next;
  if (!visibilityBound) {
    document.addEventListener('visibilitychange', handleVisibility);
    visibilityBound = true;
  }
  if (requested) void acquireWakeLock();
  else releaseSentinel();
}

/** Drop the lock when the console page is torn down. */
export function releaseWakeLock(): void {
  requested = false;
  releaseSentinel();
}
