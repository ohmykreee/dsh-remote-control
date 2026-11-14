import {
  cancelScheduledAlarm,
  claimScheduledAlarm,
  primeAudio,
  scheduleAlarm,
  setTabAlert,
  startLoopingAlarm,
  stopAlarmSound,
} from './timer-alarm.svelte';
import { app } from './state.svelte';
import type { CountdownSettings } from './types';

/**
 * Countdown timer that lives entirely in the controller's browser.
 *
 * The DSH panel only persists the enabled flag and the preset list; this module
 * owns the run. Timing derives from an absolute `endsAt`, so switching console
 * pages never loses time. There is no loop option: once the time is up the
 * alarm keeps ringing until the console user confirms it.
 */

export const COUNTDOWN_MAX_SECONDS = 86_400;

export interface CountdownRuntime {
  /** Index into the configured preset list. */
  presetIndex: number;
  /** Duration of the current run, kept stable while the timer advances. */
  durationMs: number;
  running: boolean;
  remainingMs: number;
  endsAt: number;
  /** Time is up and the alarm is waiting for confirmation. */
  finished: boolean;
  alarmActive: boolean;
}

export const countdown = $state<CountdownRuntime>({
  presetIndex: 0,
  durationMs: 60_000,
  running: false,
  remainingMs: 60_000,
  endsAt: 0,
  finished: false,
  alarmActive: false,
});

let refs = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let presetSignature = '';

function settings(): CountdownSettings {
  return app.countdown;
}

function clampPresetIndex(index: number): number {
  const count = settings().presets.length;
  if (count <= 0) return 0;
  const value = Math.round(Number(index));
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(count - 1, value));
}

/** Seconds configured for one preset, clamped to the accepted range. */
export function presetSeconds(index: number = countdown.presetIndex): number {
  const value = Number(settings().presets[clampPresetIndex(index)]);
  const seconds = Number.isFinite(value) ? Math.round(value) : 60;
  return Math.max(1, Math.min(COUNTDOWN_MAX_SECONDS, seconds));
}

export function presetDurationMs(index: number = countdown.presetIndex): number {
  return presetSeconds(index) * 1000;
}

/** `m:ss`, or `h:mm:ss` once the duration reaches an hour. */
export function formatSeconds(totalSeconds: number): string {
  const value = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  const pad = (part: number): string => String(part).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function formatCountdown(ms: number): string {
  return formatSeconds(Math.ceil(Math.max(0, ms) / 1000));
}

export function countdownProgress(): number {
  const duration = countdown.durationMs;
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(100, ((duration - countdown.remainingMs) / duration) * 100));
}

function syncPresets(): void {
  const presets = settings().presets;
  const signature = presets.join('/');
  if (signature === presetSignature) return;
  presetSignature = signature;
  countdown.presetIndex = clampPresetIndex(countdown.presetIndex);
  if (!countdown.running && !countdown.finished) {
    countdown.durationMs = presetDurationMs();
    countdown.remainingMs = countdown.durationMs;
  }
}

function resetRuntime(): void {
  countdown.presetIndex = clampPresetIndex(countdown.presetIndex);
  countdown.running = false;
  countdown.endsAt = 0;
  countdown.finished = false;
  countdown.durationMs = presetDurationMs();
  countdown.remainingMs = countdown.durationMs;
  countdown.alarmActive = false;
  stopAlarmSound();
}

function startEngine(): void {
  presetSignature = settings().presets.join('/');
  countdown.presetIndex = clampPresetIndex(countdown.presetIndex);
  if (!countdown.running && !countdown.finished) {
    countdown.durationMs = presetDurationMs();
    countdown.remainingMs = countdown.durationMs;
  }
  if (timer) return;
  timer = setInterval(tick, 250);
  document.addEventListener('visibilitychange', handleVisibility);
  (window as unknown as { __DSH_COUNTDOWN__?: CountdownRuntime }).__DSH_COUNTDOWN__ = countdown;
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
  syncPresets();
  if (!countdown.running) return;
  const remaining = countdown.endsAt - Date.now();
  if (remaining <= 0) {
    countdown.remainingMs = 0;
    finish();
    return;
  }
  countdown.remainingMs = remaining;
}

/** Reference-counted lifecycle; the card (and its clone) both acquire it. */
export function acquireCountdown(): () => void {
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

/** Quick-select one preset while the timer is idle or paused. */
export function selectCountdownPreset(index: number): void {
  if (!settings().enabled || countdown.running || countdown.alarmActive) return;
  countdown.presetIndex = clampPresetIndex(index);
  countdown.finished = false;
  countdown.running = false;
  countdown.endsAt = 0;
  countdown.durationMs = presetDurationMs();
  countdown.remainingMs = countdown.durationMs;
  stopAlarmSound();
}

export function startCountdown(): void {
  if (!settings().enabled || countdown.alarmActive) return;
  primeAudio();
  if (countdown.finished) {
    countdown.finished = false;
    countdown.durationMs = presetDurationMs();
    countdown.remainingMs = countdown.durationMs;
  }
  if (countdown.remainingMs <= 0) countdown.remainingMs = countdown.durationMs;
  countdown.running = true;
  countdown.endsAt = Date.now() + countdown.remainingMs;
  stopAlarmSound();
  if (!app.pomodoro.soundPath.trim()) {
    scheduleAlarm(Math.max(0.06, (countdown.endsAt - Date.now()) / 1000), countdown.endsAt);
  }
}

export function pauseCountdown(): void {
  if (!countdown.running) return;
  countdown.remainingMs = Math.max(0, countdown.endsAt - Date.now());
  countdown.running = false;
  countdown.endsAt = 0;
  cancelScheduledAlarm();
}

export function toggleCountdown(): void {
  if (countdown.running) pauseCountdown();
  else startCountdown();
}

export function resetCountdown(): void {
  countdown.running = false;
  countdown.finished = false;
  countdown.endsAt = 0;
  countdown.durationMs = presetDurationMs();
  countdown.remainingMs = countdown.durationMs;
  countdown.alarmActive = false;
  stopAlarmSound();
}

/**
 * Acknowledge the finished countdown. The alarm never stops on its own: this
 * is the confirmation the phone user has to give.
 */
export function confirmCountdown(): void {
  if (!countdown.alarmActive && !countdown.finished) return;
  stopAlarmSound();
  countdown.alarmActive = false;
  countdown.finished = false;
  countdown.running = false;
  countdown.endsAt = 0;
  countdown.durationMs = presetDurationMs();
  countdown.remainingMs = countdown.durationMs;
}

function finish(): void {
  countdown.running = false;
  countdown.remainingMs = 0;
  countdown.finished = true;
  countdown.alarmActive = true;
  const hasScheduledChime = claimScheduledAlarm(countdown.endsAt);
  startLoopingAlarm(app.pomodoro.soundPath, hasScheduledChime);
  setTabAlert(true);
  try {
    navigator.vibrate?.([140, 90, 180]);
  } catch {
    /* vibration is optional */
  }
}
