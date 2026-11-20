/**
 * Screen Wake Lock for the phone console.
 *
 * The lock is requested whenever the Host setting is on and the tab is visible.
 * The setting is stored under `tls.advanced` but is independent of the HTTPS
 * switch, and the console never pre-checks the secure context: it always makes
 * the request and ignores a refusal, so an environment that grants the lock
 * anyway (a browser flag, a policy, a WebView) still gets it. Browsers release
 * it automatically when the page is hidden, so visibility changes release and
 * reacquire it; anything unsupported or denied is ignored and the console keeps
 * working normally.
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

/**
 * The Wake Lock API itself. The console never inspects `isSecureContext`: a
 * browser or an embedding host can expose and grant the API where the page
 * does not look secure, so the only reliable check is to make the request and
 * ignore a refusal. When the API is missing the request is skipped silently.
 */
function wakeLockApi(): WakeLockNavigator['wakeLock'] {
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
    // The console mounts App exactly once for the page lifetime, so this
    // listener is intentionally never removed; `releaseWakeLock()` only drops
    // the lock itself.
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
