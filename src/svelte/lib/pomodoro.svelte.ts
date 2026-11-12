import { app } from './state.svelte';
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
}

export const pomodoro = $state<PomodoroRuntime>({
  phase: 'focus',
  running: false,
  remainingMs: 25 * 60_000,
  endsAt: 0,
  finished: false,
  rounds: 0,
});

let refs = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let durationSignature = '';
let originalTitle = '';
let originalIcon = '';
let alerting = false;
let audioContext: AudioContext | null = null;
let scheduled: { endsAt: number; nodes: OscillatorNode[] } | null = null;

function settings(): PomodoroSettings {
  return app.pomodoro;
}

export function phaseDurationMs(phase: PomodoroPhase = pomodoro.phase, value: PomodoroSettings = settings()): number {
  const minutes = phase === 'focus' ? value.focusMinutes : value.breakMinutes;
  return Math.max(1, Math.min(180, Math.round(Number(minutes) || 25))) * 60_000;
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
  setTabAlert(false);
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
  cancelScheduled();
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
  setTabAlert(false);
  cancelScheduled();
  if (!settings().soundPath.trim()) scheduleChime(Math.max(0.06, (pomodoro.endsAt - Date.now()) / 1000), pomodoro.endsAt);
}

export function pausePomodoro(): void {
  if (!pomodoro.running) return;
  pomodoro.remainingMs = Math.max(0, pomodoro.endsAt - Date.now());
  pomodoro.running = false;
  pomodoro.endsAt = 0;
  cancelScheduled();
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
  cancelScheduled();
  setTabAlert(false);
}

/** Switch focus/break while idle (the label in the card is a button). */
export function switchPomodoroPhase(): void {
  if (pomodoro.running) return;
  pomodoro.phase = pomodoro.phase === 'focus' ? 'break' : 'focus';
  pomodoro.finished = false;
  pomodoro.remainingMs = phaseDurationMs();
  cancelScheduled();
  setTabAlert(false);
}

function finish(): void {
  const finishedPhase = pomodoro.phase;
  pomodoro.running = false;
  pomodoro.remainingMs = 0;
  pomodoro.finished = true;
  if (finishedPhase === 'focus') pomodoro.rounds += 1;
  const scheduledForRun = scheduled !== null && scheduled.endsAt === pomodoro.endsAt;
  scheduled = null;
  if (!scheduledForRun) playAlarm();
  setTabAlert(true);
  try {
    navigator.vibrate?.([140, 90, 180]);
  } catch {
    /* vibration is optional */
  }
}

/* ------------------------------------------------------------------ sound */

function ensureAudio(): AudioContext | null {
  try {
    if (!audioContext) {
      const Ctor = window.AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioContext = new Ctor();
    }
    if (audioContext.state === 'suspended') void audioContext.resume();
    return audioContext;
  } catch {
    return null;
  }
}

/** Resume the audio context inside the start-button gesture. */
export function primeAudio(): void {
  ensureAudio();
}

/**
 * Schedule a soft major-arpeggio chime. Sine fundamentals plus quiet octave
 * triangles and a low-pass keep it gentle rather than a harsh alarm beep.
 */
function buildChime(delaySeconds: number): OscillatorNode[] {
  const context = ensureAudio();
  if (!context) return [];
  const now = context.currentTime + Math.max(0.02, delaySeconds);
  const master = context.createGain();
  master.gain.value = 0.16;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 4200;
  filter.Q.value = 0.4;
  filter.connect(master);
  master.connect(context.destination);
  const notes = [523.25, 659.25, 783.99, 1046.5];
  const nodes: OscillatorNode[] = [];
  const phrase = (offset: number): void => {
    notes.forEach((frequency, index) => {
      const at = now + offset + index * 0.22;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.9, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.05);
      const fundamental = context.createOscillator();
      fundamental.type = 'sine';
      fundamental.frequency.value = frequency;
      fundamental.connect(gain);
      const shimmer = context.createOscillator();
      shimmer.type = 'triangle';
      shimmer.frequency.value = frequency * 2;
      const shimmerGain = context.createGain();
      shimmerGain.gain.value = 0.1;
      shimmer.connect(shimmerGain);
      shimmerGain.connect(gain);
      gain.connect(filter);
      fundamental.start(at);
      shimmer.start(at);
      fundamental.stop(at + 1.1);
      shimmer.stop(at + 1.1);
      nodes.push(fundamental, shimmer);
    });
  };
  phrase(0);
  phrase(1.08);
  return nodes;
}

function cancelScheduled(): void {
  if (!scheduled) return;
  for (const node of scheduled.nodes) {
    try {
      node.stop(0);
    } catch {
      /* already stopped */
    }
  }
  scheduled = null;
}

function scheduleChime(delaySeconds: number, endsAt: number): void {
  const nodes = buildChime(delaySeconds);
  if (nodes.length > 0) scheduled = { endsAt, nodes };
}

function playAlarm(): void {
  const path = settings().soundPath.trim();
  if (path) {
    const direct = /^(https?:)?\/\//i.test(path) || /^(data|blob):/i.test(path);
    const source = direct ? path : `/api/pomodoro/sound?v=${Date.now()}`;
    try {
      const audio = new Audio(source);
      audio.volume = 0.72;
      let fellBack = false;
      const fallback = (): void => {
        if (fellBack) return;
        fellBack = true;
        buildChime(0.02);
      };
      audio.addEventListener('error', fallback, { once: true });
      const playing = audio.play();
      if (playing && typeof playing.catch === 'function') playing.catch(fallback);
      setTimeout(() => {
        try {
          audio.pause();
        } catch {
          /* ignore */
        }
      }, 30_000);
    } catch {
      buildChime(0.02);
    }
    return;
  }
  buildChime(0.02);
}

/* ------------------------------------------------------- page-tab indicator */

function cssVariable(name: string, fallback: string): string {
  try {
    const value = getComputedStyle(document.body).getPropertyValue(name).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

function iconLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel="icon"]');
}

/** A green dot with the same card-colored ring as a session status dot. */
function dotIcon(base: HTMLImageElement | null): string {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return '';
  if (base) context.drawImage(base, 0, 0, size, size);
  const green = cssVariable('--green', '#45dfb1');
  const ring = cssVariable('--card', '#0d121d');
  context.beginPath();
  context.arc(46, 46, 13, 0, Math.PI * 2);
  context.fillStyle = ring;
  context.fill();
  context.beginPath();
  context.arc(46, 46, 10, 0, Math.PI * 2);
  context.fillStyle = green;
  context.fill();
  return canvas.toDataURL('image/png');
}

function paintFavicon(): void {
  const link = iconLink();
  if (!link) return;
  const immediate = dotIcon(null);
  if (immediate) link.setAttribute('href', immediate);
  const image = new Image();
  image.onload = () => {
    if (!alerting) return;
    const composed = dotIcon(image);
    if (composed) link.setAttribute('href', composed);
  };
  image.src = '/icon.svg';
}

export function setTabAlert(active: boolean): void {
  if (active === alerting) return;
  alerting = active;
  const link = iconLink();
  if (active) {
    originalTitle = document.title.replace(/^●\s*/, '');
    originalIcon = link?.getAttribute('href') || '';
    document.title = `● ${originalTitle}`;
    paintFavicon();
    return;
  }
  document.title = originalTitle || document.title.replace(/^●\s*/, '');
  if (link && originalIcon) link.setAttribute('href', originalIcon);
}
