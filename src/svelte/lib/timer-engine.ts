/**
 * Reference-counted interval engine shared by the pomodoro and countdown timers.
 *
 * The console renders every page twice (infinite-loop clones), so each timer
 * card acquires the same engine; only the first acquire starts the interval and
 * only the last release stops it, which keeps one clock and one sound engine.
 */
export interface TimerEngineOptions {
  tickMs: number;
  /** Called on every interval tick and once when the tab becomes visible again. */
  onTick: () => void;
  /** Module-specific initialisation, run when the first handle is acquired. */
  onStart?: () => void;
  /** Module-specific teardown, run when the last handle is released. */
  onStop?: () => void;
}

export interface TimerEngine {
  /** Acquire one reference; the returned function releases it exactly once. */
  acquire: () => () => void;
}

export function createTimerEngine(options: TimerEngineOptions): TimerEngine {
  let refs = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  // Background tabs throttle timers, so recompute once the tab is visible again
  // instead of waiting for the next interval.
  function handleVisibility(): void {
    if (!document.hidden) options.onTick();
  }

  function start(): void {
    options.onStart?.();
    if (timer) return;
    timer = setInterval(options.onTick, Math.max(16, options.tickMs));
    document.addEventListener('visibilitychange', handleVisibility);
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
    document.removeEventListener('visibilitychange', handleVisibility);
    options.onStop?.();
  }

  return {
    acquire() {
      refs += 1;
      if (refs === 1) start();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        refs = Math.max(0, refs - 1);
        if (refs === 0) stop();
      };
    },
  };
}
