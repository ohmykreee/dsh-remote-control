/**
 * Official voice-input status and transcription bridge.
 *
 * The DSH voice-input bundle registers a `speechToText` provider. The remote
 * console treats the feature as available only when that provider reports a
 * ready/standby preparation — i.e. the model is downloaded, loaded, and waiting
 * for a recording. Everything else is a binary "not ready" for the UI.
 */

import type { DshContext } from '../shared/types.js';

export interface SpeechProviderView {
  id?: string;
  name?: string;
  languages?: readonly string[];
  preparation?: {
    phase?: string;
    message?: string;
    download?: { resource?: string; completedBytes?: number; totalBytes?: number } | null;
  } | null;
}

export interface SpeechSnapshot {
  providers?: readonly SpeechProviderView[];
  selection?: {
    providerId?: string;
    language?: string;
  } | null;
}

export interface SpeechSpec {
  audio: Uint8Array;
  provider: unknown;
}

export interface SpeechToTextService {
  snapshot?(): SpeechSnapshot;
  resolve?(request: { audio: Uint8Array; providerId?: string; language?: string }): SpeechSpec;
  transcribe?(spec: SpeechSpec, signal: AbortSignal): Promise<{ text?: string; audioSeconds?: number }>;
}

export interface VoiceStatus {
  ready: boolean;
  providerName: string;
  language: string;
  phase: string;
}

/** Phases that mean "model prepared and transcription can start". */
const READY_PHASES = new Set(['ready', 'standby']);

function speechService(ctx: DshContext): SpeechToTextService | undefined {
  try {
    const service = ctx.get?.('speechToText');
    if (!service || typeof service !== 'object') return undefined;
    return service as SpeechToTextService;
  } catch {
    return undefined;
  }
}

/** Read the official plugin's current readiness. Never throws. */
export function readVoiceStatus(ctx: DshContext): VoiceStatus {
  const service = speechService(ctx);
  if (!service?.snapshot) return { ready: false, providerName: '', language: '', phase: 'missing' };
  let snapshot: SpeechSnapshot;
  try {
    snapshot = service.snapshot();
  } catch {
    return { ready: false, providerName: '', language: '', phase: 'failed' };
  }
  const providers = Array.isArray(snapshot.providers) ? snapshot.providers : [];
  const selectedId = snapshot.selection?.providerId ?? '';
  const provider =
    providers.find((entry) => entry.id === selectedId)
    ?? providers[0]
    ?? null;
  const language = snapshot.selection?.language || '';
  if (!provider) return { ready: false, providerName: '', language, phase: 'unprepared' };
  const phase = String(provider.preparation?.phase || 'unprepared');
  return {
    ready: READY_PHASES.has(phase),
    providerName: String(provider.name || provider.id || ''),
    language,
    phase,
  };
}

/** True when a recording may be transcribed right now. */
export function isVoiceReady(ctx: DshContext): boolean {
  return readVoiceStatus(ctx).ready;
}

/** Transcribe one canonical WAV recording through the selected provider. */
export async function transcribeAudio(
  ctx: DshContext,
  audio: Uint8Array,
  signal: AbortSignal,
): Promise<{ text: string; audioSeconds: number }> {
  const service = speechService(ctx);
  if (!service?.resolve || !service.transcribe) throw new Error('voice-input-unavailable');
  const status = readVoiceStatus(ctx);
  if (!status.ready) throw new Error('voice-input-not-ready');
  const snapshot = service.snapshot?.() ?? {};
  const providerId = snapshot.selection?.providerId || undefined;
  const language = snapshot.selection?.language || undefined;
  const spec = service.resolve({ audio, ...(providerId ? { providerId } : {}), ...(language ? { language } : {}) });
  const result = await service.transcribe(spec, signal);
  return {
    text: String(result?.text || '').trim(),
    audioSeconds: Number(result?.audioSeconds) || 0,
  };
}

/** Read the maximum duration advertised by the official Remote, when present. */
export function readRecordingLimits(ctx: DshContext): { maxAudioBytes: number; maxDurationSeconds: number } {
  try {
    const controller = ctx.get?.('speechController') as
      | { catalog?(): { maxAudioBytes?: number; maxDurationSeconds?: number } }
      | undefined;
    const catalog = controller?.catalog?.();
    return {
      maxAudioBytes: Number(catalog?.maxAudioBytes) > 0 ? Number(catalog?.maxAudioBytes) : 8 * 1024 * 1024,
      maxDurationSeconds: Number(catalog?.maxDurationSeconds) > 0 ? Number(catalog?.maxDurationSeconds) : 60,
    };
  } catch {
    return { maxAudioBytes: 8 * 1024 * 1024, maxDurationSeconds: 60 };
  }
}
