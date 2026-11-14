import { app } from './state.svelte';
import {
  cancelScheduledAlarm,
  claimScheduledAlarm,
  playAlarmOnce,
  primeAudio,
  scheduleAlarm,
  setTabAlert,
  startLoopingAlarm,
  stopAlarmSound,
} from './timer-alarm.svelte';
import type { PomodoroSettings } from './types';

/**
 * Tomato timer that lives entirely in the controller's browser.
 *
 * The DSH panel only persists settings; this module owns the countdown. Timing
 * always derives from an absolute `endsAt` timestamp, so moving between console
 * pages (or a throttled background tab) never loses time. The runtime is a
 * singleton because the console renders an infinite-loop clone of every page.
 */

export type PomodoroPhase = 'focus' | 'break';

export interface PomodoroRuntime {
  phase: PomodoroPhase;
  running: boolean;
  remainingMs: number;
  endsAt: number;
  finished: boolean;
  rounds: number;
  /** True while the end-of-timer alarm is still ringing (loop mode). */
  alarmActive: boolean;
}

export const pomodoro = $state<PomodoroRuntime>({
  phase: 'focus',
  running: false,
  remainingMs: 25 * 60_000,
  endsAt: 0,
  finished: false,
  rounds: 0,
  alarmActive: false,
});

let refs = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let durationSignature = '';

function settings(): PomodoroSettings {
  return app.pomodoro;
}

export function phaseDurationMs(phase: PomodoroPhase = pomodoro.phase, value: PomodoroSettings = settings()): number {
  const minutes = phase === 'focus' ? value.focusMinutes : value.breakMinutes;
  const limit = phase === 'focus' ? 180 : 120;
  const fallback = phase === 'focus' ? 25 : 5;
  const raw = Number(minutes);
  const safe = Number.isFinite(raw) ? Math.max(0.1, Math.min(limit, raw)) : fallback;
  // Fractional minutes are allowed in settings; the timer works in whole seconds.
  return Math.max(1, Math.round(safe * 60)) * 1000;
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function pomodoroProgress(): number {
  const duration = phaseDurationMs();
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(100, ((duration - pomodoro.remainingMs) / duration) * 100));
}

function syncDuration(): void {
  const signature = `${settings().focusMinutes}/${settings().breakMinutes}`;
  if (signature === durationSignature) return;
  durationSignature = signature;
  if (!pomodoro.running && !pomodoro.finished) pomodoro.remainingMs = phaseDurationMs();
}

function resetRuntime(): void {
  pomodoro.phase = 'focus';
  pomodoro.running = false;
  pomodoro.remainingMs = phaseDurationMs('focus');
  pomodoro.endsAt = 0;
  pomodoro.finished = false;
  pomodoro.rounds = 0;
  stopAlarm();
}

function startEngine(): void {
  durationSignature = `${settings().focusMinutes}/${settings().breakMinutes}`;
  if (!pomodoro.running && !pomodoro.finished) pomodoro.remainingMs = phaseDurationMs();
  if (timer) return;
  timer = setInterval(tick, 250);
  document.addEventListener('visibilitychange', handleVisibility);
  (window as unknown as { __DSH_POMODORO__?: PomodoroRuntime }).__DSH_POMODORO__ = pomodoro;
}

function stopEngine(): void {
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', handleVisibility);
  cancelScheduledAlarm();
  resetRuntime();
}

function handleVisibility(): void {
  if (!document.hidden) tick();
}

function tick(): void {
  if (!settings().enabled) {
    resetRuntime();
    return;
  }
  syncDuration();
  if (pomodoro.alarmActive && !settings().loopAlarm) stopAlarm();
  if (!pomodoro.running) return;
  const remaining = pomodoro.endsAt - Date.now();
  if (remaining <= 0) {
    pomodoro.remainingMs = 0;
    finish();
    return;
  }
  pomodoro.remainingMs = remaining;
}

/** Reference-counted lifecycle; the card (and its clone) both acquire it. */
export function acquirePomodoro(): () => void {
  refs += 1;
  if (refs === 1) startEngine();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    refs = Math.max(0, refs - 1);
    if (refs === 0) stopEngine();
  };
}

export function startPomodoro(): void {
  if (!settings().enabled) return;
  primeAudio();
  if (pomodoro.finished) {
    pomodoro.phase = pomodoro.phase === 'focus' ? 'break' : 'focus';
    pomodoro.finished = false;
    pomodoro.remainingMs = phaseDurationMs();
  }
  if (pomodoro.remainingMs <= 0) pomodoro.remainingMs = phaseDurationMs();
  pomodoro.running = true;
  pomodoro.endsAt = Date.now() + pomodoro.remainingMs;
  stopAlarm();
  if (!settings().soundPath.trim()) scheduleAlarm(Math.max(0.06, (pomodoro.endsAt - Date.now()) / 1000), pomodoro.endsAt);
}

export function pausePomodoro(): void {
  if (!pomodoro.running) return;
  pomodoro.remainingMs = Math.max(0, pomodoro.endsAt - Date.now());
  pomodoro.running = false;
  pomodoro.endsAt = 0;
  cancelScheduledAlarm();
}

export function togglePomodoro(): void {
  if (pomodoro.running) pausePomodoro();
  else startPomodoro();
}

export function resetPomodoro(): void {
  pomodoro.running = false;
  pomodoro.finished = false;
  pomodoro.phase = 'focus';
  pomodoro.rounds = 0;
  pomodoro.endsAt = 0;
  pomodoro.remainingMs = phaseDurationMs('focus');
  stopAlarm();
}

/** Switch focus/break while idle (the label in the card is a button). */
export function switchPomodoroPhase(): void {
  if (pomodoro.running) return;
  pomodoro.phase = pomodoro.phase === 'focus' ? 'break' : 'focus';
  pomodoro.finished = false;
  pomodoro.remainingMs = phaseDurationMs();
  stopAlarm();
}

/** Acknowledge the end-of-timer alarm and stop the looping sound. */
export function dismissAlarm(): void {
  stopAlarm();
}

function finish(): void {
  const finishedPhase = pomodoro.phase;
  pomodoro.running = false;
  pomodoro.remainingMs = 0;
  pomodoro.finished = true;
  pomodoro.alarmActive = false;
  if (finishedPhase === 'focus') pomodoro.rounds += 1;
  const hasScheduledChime = claimScheduledAlarm(pomodoro.endsAt);
  if (settings().loopAlarm) {
    pomodoro.alarmActive = true;
    startLoopingAlarm(settings().soundPath, hasScheduledChime);
  } else if (!hasScheduledChime) {
    playAlarmOnce(settings().soundPath);
  }
  setTabAlert(true);
  try {
    navigator.vibrate?.([140, 90, 180]);
  } catch {
    /* vibration is optional */
  }
}

/** Stop the alert sound and clear the runtime flag. */
function stopAlarm(): void {
  stopAlarmSound();
  pomodoro.alarmActive = false;
}
