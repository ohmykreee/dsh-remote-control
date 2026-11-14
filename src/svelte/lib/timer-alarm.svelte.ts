/**
 * Shared alert sound and page-tab indicator for the console timers.
 *
 * The pomodoro and the countdown live in the same browser tab and only one can
 * be enabled at a time, so a single alarm engine is enough. Timer modules own
 * the remaining time and the enabled state; this module only knows how to
 * schedule, loop, and stop the configured alert.
 */

let audioContext: AudioContext | null = null;
let scheduled: { endsAt: number; nodes: OscillatorNode[] } | null = null;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let loopActive = false;
let alarmAudio: HTMLAudioElement | null = null;
let activeChimeNodes: OscillatorNode[] = [];
let alerting = false;
let originalTitle = '';
let originalIcon = '';

/** Reactive mirror of the page-tab alert, consumed by the console rail. */
export const tabAlert = $state({ active: false });

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

function stopNodes(nodes: OscillatorNode[]): void {
  for (const node of nodes) {
    try {
      node.stop(0);
    } catch {
      /* already stopped */
    }
  }
}

function stopActiveChime(): void {
  stopNodes(activeChimeNodes);
  activeChimeNodes = [];
}

/** Start one built-in chime that can be cut off immediately on dismiss. */
function playChimeNow(): void {
  stopActiveChime();
  activeChimeNodes = buildChime(0.02);
}

function soundSource(path: string): string {
  const direct = /^(https?:)?\/\//i.test(path) || /^(data|blob):/i.test(path);
  return direct ? path : `/api/pomodoro/sound?v=${Date.now()}`;
}

/** Schedule the built-in chime for a timer that is about to end. */
export function scheduleAlarm(delaySeconds: number, endsAt: number): void {
  cancelScheduledAlarm();
  const nodes = buildChime(delaySeconds);
  if (nodes.length > 0) scheduled = { endsAt, nodes };
}

/** Drop a future chime because the timer was paused or reset. */
export function cancelScheduledAlarm(): void {
  if (!scheduled) return;
  stopNodes(scheduled.nodes);
  scheduled = null;
}

/**
 * Take ownership of the chime scheduled for `endsAt` when the timer finishes.
 * The nodes keep playing (they are already due) but are tracked as active so a
 * quick confirmation can still cut them off.
 */
export function claimScheduledAlarm(endsAt: number): boolean {
  if (!scheduled || scheduled.endsAt !== endsAt) return false;
  activeChimeNodes = scheduled.nodes;
  scheduled = null;
  return true;
}

/** Play the configured file (or the built-in chime) exactly once. */
export function playAlarmOnce(soundPath: string): void {
  const path = soundPath.trim();
  if (path) {
    try {
      const audio = new Audio(soundSource(path));
      audio.volume = 0.72;
      alarmAudio = audio;
      let fellBack = false;
      const fallback = (): void => {
        if (fellBack) return;
        fellBack = true;
        if (alarmAudio === audio) alarmAudio = null;
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
        if (alarmAudio === audio) alarmAudio = null;
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
    if (!loopActive) return;
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
      if (failed || !loopActive) return;
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

/**
 * Ring until stopped. `skipFirst` is for the scheduled chime that is already
 * playing at the end of a timer, so the alarm does not double up.
 */
export function startLoopingAlarm(soundPath: string, skipFirst: boolean): void {
  loopActive = true;
  stopLoopTimer();
  const path = soundPath.trim();
  if (path && startCustomLoop(path)) return;
  if (skipFirst) {
    startBuiltinLoop(4400);
    return;
  }
  playChimeNow();
  startBuiltinLoop(4400);
}

/** Stop every alarm source and clear the page-tab indicator. */
export function stopAlarmSound(): void {
  loopActive = false;
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
  cancelScheduledAlarm();
  stopActiveChime();
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
  tabAlert.active = active;
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
