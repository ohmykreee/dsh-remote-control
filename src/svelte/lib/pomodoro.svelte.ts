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
let originalTitle = '';
let originalIcon = '';
let alerting = false;
let audioContext: AudioContext | null = null;
let scheduled: { endsAt: number; nodes: OscillatorNode[] } | null = null;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let alarmAudio: HTMLAudioElement | null = null;
let activeChimeNodes: OscillatorNode[] = [];

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
  const hasScheduledChime = scheduled !== null && scheduled.endsAt === pomodoro.endsAt;
  scheduled = null;
  if (settings().loopAlarm) {
    pomodoro.alarmActive = true;
    startLoopingAlarm(hasScheduledChime);
  } else if (!hasScheduledChime) {
    playAlarm();
  }
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

function stopActiveChime(): void {
  for (const node of activeChimeNodes) {
    try {
      node.stop(0);
    } catch {
      /* already stopped */
    }
  }
  activeChimeNodes = [];
}

/** Start one built-in chime that can be cut off immediately on dismiss. */
function playChimeNow(): void {
  stopActiveChime();
  activeChimeNodes = buildChime(0.02);
}

function scheduleChime(delaySeconds: number, endsAt: number): void {
  const nodes = buildChime(delaySeconds);
  if (nodes.length > 0) scheduled = { endsAt, nodes };
}

function soundSource(path: string): string {
  const direct = /^(https?:)?\/\//i.test(path) || /^(data|blob):/i.test(path);
  return direct ? path : `/api/pomodoro/sound?v=${Date.now()}`;
}

function playAlarm(): void {
  const path = settings().soundPath.trim();
  if (path) {
    try {
      const audio = new Audio(soundSource(path));
      audio.volume = 0.72;
      let fellBack = false;
      const fallback = (): void => {
        if (fellBack) return;
        fellBack = true;
        playChimeNow();
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
      playChimeNow();
    }
    return;
  }
  playChimeNow();
}

function stopLoopTimer(): void {
  if (!loopTimer) return;
  clearTimeout(loopTimer);
  loopTimer = null;
}

function startBuiltinLoop(delayMs: number): void {
  stopLoopTimer();
  loopTimer = setTimeout(() => {
    loopTimer = null;
    if (!pomodoro.alarmActive) return;
    playChimeNow();
    startBuiltinLoop(4400);
  }, Math.max(0, delayMs));
}

/** Loop the configured audio file until dismissed; false means fall back. */
function startCustomLoop(path: string): boolean {
  try {
    const audio = new Audio(soundSource(path));
    audio.loop = true;
    audio.volume = 0.72;
    alarmAudio = audio;
    let failed = false;
    const fallback = (): void => {
      if (failed || !pomodoro.alarmActive) return;
      failed = true;
      if (alarmAudio === audio) alarmAudio = null;
      startBuiltinLoop(0);
    };
    audio.addEventListener('error', fallback, { once: true });
    const playing = audio.play();
    if (playing && typeof playing.catch === 'function') playing.catch(fallback);
    return true;
  } catch {
    return false;
  }
}

function startLoopingAlarm(skipFirst: boolean): void {
  stopLoopTimer();
  const path = settings().soundPath.trim();
  if (path && startCustomLoop(path)) return;
  if (skipFirst) startBuiltinLoop(4400);
  else {
    playChimeNow();
    startBuiltinLoop(4400);
  }
}

/** Stop every alarm source and clear the page-tab indicator. */
function stopAlarm(): void {
  stopLoopTimer();
  if (alarmAudio) {
    try {
      alarmAudio.pause();
      alarmAudio.currentTime = 0;
    } catch {
      /* ignore */
    }
    alarmAudio = null;
  }
  cancelScheduled();
  stopActiveChime();
  pomodoro.alarmActive = false;
  setTabAlert(false);
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
