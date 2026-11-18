/**
 * Microphone capture and WAV encoding for Quick Q&A.
 *
 * Uses the browser's default input device (no device picker), records with
 * MediaRecorder, then decodes and resamples to the canonical 16 kHz mono PCM16
 * WAV the DSH speech provider accepts. Level metering is exposed while holding.
 */

export interface QuickQaRecording {
  blob: Blob;
  durationMs: number;
  maxLevel: number;
  voicedMs: number;
}

export interface QuickQaCapture {
  level(): number;
  stop(): Promise<QuickQaRecording>;
  cancel(): Promise<void>;
}

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const candidate = (globalThis as unknown as { AudioContext?: AudioContextCtor }).AudioContext
    ?? (globalThis as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  return candidate ?? null;
}

function preferredMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

/** Encode mono Float32 samples in [-1, 1] as a 16 kHz PCM16 WAV. */
function encodeWav(samples: Float32Array, sampleRate = 16_000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

/** Decode a browser recording and convert it to 16 kHz mono PCM16 WAV. */
export async function recordingToWav(blob: Blob): Promise<Blob> {
  const Ctor = audioContextCtor();
  if (!Ctor) throw new Error('audio-unsupported');
  const encoded = await blob.arrayBuffer();
  const decodeContext = new Ctor();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeContext.decodeAudioData(encoded);
  } finally {
    void decodeContext.close();
  }
  let mono: Float32Array;
  if (decoded.numberOfChannels <= 1) {
    mono = decoded.getChannelData(0).slice();
  } else {
    mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const data = decoded.getChannelData(channel);
      for (let index = 0; index < mono.length; index += 1) mono[index] += data[index] / decoded.numberOfChannels;
    }
  }
  const OfflineCtor = (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!OfflineCtor) throw new Error('audio-unsupported');
  const targetRate = 16_000;
  const targetLength = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineCtor(1, targetLength, targetRate);
  const buffer = offline.createBuffer(1, mono.length, decoded.sampleRate);
  const channel = new Float32Array(mono.length);
  channel.set(mono);
  buffer.copyToChannel(channel, 0);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return new Blob([encodeWav(rendered.getChannelData(0), targetRate)], { type: 'audio/wav' });
}

/** Start capturing from the default microphone. */
export async function startQuickQaCapture(): Promise<QuickQaCapture> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('microphone-unsupported');
  if (typeof MediaRecorder === 'undefined') throw new Error('microphone-unsupported');
  const Ctor = audioContextCtor();
  if (!Ctor) throw new Error('audio-unsupported');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  const context = new Ctor();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.55;
  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let lastLevel = 0;
  let maxLevel = 0;
  let voicedMs = 0;
  let lastSampleAt = performance.now();
  const startedAt = performance.now();

  const tone = preferredMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = tone ? new MediaRecorder(stream, { mimeType: tone }) : new MediaRecorder(stream);
  } catch {
    for (const track of stream.getTracks()) track.stop();
    void context.close();
    throw new Error('microphone-unsupported');
  }
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  });
  recorder.start(100);

  const measure = (): void => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const rms = Math.sqrt(sum / samples.length);
    lastLevel = Math.min(1, rms * 7);
    maxLevel = Math.max(maxLevel, lastLevel);
    const now = performance.now();
    if (lastLevel > 0.12) voicedMs += now - lastSampleAt;
    lastSampleAt = now;
  };
  const timer = setInterval(measure, 50);

  let cleaned = false;
  async function cleanup(): Promise<void> {
    if (cleaned) return;
    cleaned = true;
    clearInterval(timer);
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
    try {
      source.disconnect();
      analyser.disconnect();
    } catch {
      /* ignore */
    }
    try {
      await context.close();
    } catch {
      /* ignore */
    }
  }

  return {
    level: () => lastLevel,
    async stop(): Promise<QuickQaRecording> {
      const stopped = new Promise<void>((resolve) => {
        if (recorder.state === 'inactive') resolve();
        else recorder.addEventListener('stop', () => resolve(), { once: true });
      });
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* ignore */
      }
      await stopped;
      const durationMs = performance.now() - startedAt;
      const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
      await cleanup();
      if (blob.size === 0) throw new Error('empty-recording');
      return { blob, durationMs, maxLevel, voicedMs };
    },
    async cancel(): Promise<void> {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* ignore */
      }
      await cleanup();
    },
  };
}

/** Upload one WAV recording and return the recognized text. */
export async function transcribeQuickQaWav(wav: Blob): Promise<string> {
  const response = await fetch('/api/quickqa/transcribe', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'audio/wav' },
    body: wav,
  });
  const payload: unknown = await response.json().catch(() => null);
  const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
  if (!response.ok) {
    const message = typeof record.error === 'string' ? record.error : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return String(record.text ?? '').trim();
}
