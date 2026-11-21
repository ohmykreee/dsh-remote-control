/**
 * Official voice-input bridge.
 *
 * Quick Q&A consumes the public `speechController` service — the same
 * `catalog()` / `transcribe()` contract the DSH client uses — instead of
 * reaching into the provider registry behind it. The official controller owns
 * WAV validation, the configured recording limits and the idle worker wake-up,
 * so this bridge only maps its state onto the console's availability flag.
 */

import type { DshContext } from '../shared/types.js';
import type { SpeechCatalog, TranscriptionRequest } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types';
import type { SpeechProviderView, Transcript } from '@deepseek-ai/dsh-experimental-speech-to-text/types';

/** The public contract the DSH client also calls through its `speech` namespace. */
export interface SpeechControllerService {
  catalog?(): SpeechCatalog;
  transcribe?(request: TranscriptionRequest, signal: AbortSignal): Promise<Transcript>;
}

export interface VoiceStatus {
  ready: boolean;
  providerName: string;
  language: string;
  phase: string;
}

/**
 * Phases in which the official plugin accepts a recording.
 *
 * `waking` is the transient state of an idle-reclaimed worker starting for the
 * request already in flight. The provider accepts that request and returns to
 * `ready`; treating the phase as unavailable would push a false "not ready"
 * snapshot to the phone mid-transcription and block the answer that follows.
 */
const READY_PHASES = new Set(['ready', 'standby', 'waking']);

/**
 * Phases in which the official provider accepts a new recording.
 *
 * `waking` is deliberately excluded here: it already has a request in flight
 * that owns the wake-up, and `speechController.transcribe()` would reject a
 * second one. Reporting that case as unavailable keeps the upload a retriable
 * 409 instead of an opaque transcription failure.
 */
const TRANSCRIBE_PHASES = new Set(['ready', 'standby']);

function controllerService(ctx: DshContext): SpeechControllerService | undefined {
  try {
    const service = ctx.get?.('speechController');
    if (!service || typeof service !== 'object') return undefined;
    return service as SpeechControllerService;
  } catch {
    return undefined;
  }
}

function catalogOf(ctx: DshContext): SpeechCatalog | undefined {
  const service = controllerService(ctx);
  if (!service?.catalog) return undefined;
  try {
    return service.catalog();
  } catch {
    return undefined;
  }
}

function voiceStatusOf(catalog: SpeechCatalog | undefined): VoiceStatus {
  if (!catalog) return { ready: false, providerName: '', language: '', phase: 'missing' };
  const providers: readonly SpeechProviderView[] = Array.isArray(catalog.providers) ? catalog.providers : [];
  const selectedId = catalog.selection?.providerId ?? '';
  const language = catalog.selection?.language || '';
  const provider = providers.find((entry) => entry.id === selectedId) ?? null;
  if (!provider) return { ready: false, providerName: '', language, phase: 'unprepared' };
  const phase = String(provider.preparation?.phase || 'unprepared');
  return {
    ready: READY_PHASES.has(phase),
    providerName: String(provider.name || provider.id || ''),
    language,
    phase,
  };
}

/** Read the official plugin's current readiness. Never throws. */
export function readVoiceStatus(ctx: DshContext): VoiceStatus {
  return voiceStatusOf(catalogOf(ctx));
}

/** True when a recording may be transcribed right now. */
export function isVoiceReady(ctx: DshContext): boolean {
  return readVoiceStatus(ctx).ready;
}

/**
 * Transcribe one canonical WAV recording through the official public API.
 *
 * The controller validates the WAV header, enforces its configured byte and
 * duration limits, and pins the provider recorded in the user's selection.
 */
export async function transcribeAudio(
  ctx: DshContext,
  audio: Uint8Array,
  signal: AbortSignal,
): Promise<{ text: string; audioSeconds: number }> {
  const service = controllerService(ctx);
  if (!service?.transcribe) throw new Error('voice-input-unavailable');
  const catalog = service.catalog ? catalogOf(ctx) : undefined;
  const status = voiceStatusOf(catalog);
  if (!status.ready || !TRANSCRIBE_PHASES.has(status.phase)) throw new Error('voice-input-not-ready');
  const providerId = catalog?.selection?.providerId || undefined;
  const language = catalog?.selection?.language || undefined;
  const result = await service.transcribe({
    audioBase64: Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength).toString('base64'),
    ...(providerId ? { providerId } : {}),
    ...(language ? { language } : {}),
  }, signal);
  return {
    text: String(result?.text || '').trim(),
    audioSeconds: Number(result?.audioSeconds) || 0,
  };
}

/** Read the recording limits advertised by the official controller, when present. */
export function readRecordingLimits(ctx: DshContext): { maxAudioBytes: number; maxDurationSeconds: number } {
  const catalog = catalogOf(ctx);
  return {
    maxAudioBytes: Number(catalog?.maxAudioBytes) > 0 ? Number(catalog?.maxAudioBytes) : 8 * 1024 * 1024,
    maxDurationSeconds: Number(catalog?.maxDurationSeconds) > 0 ? Number(catalog?.maxDurationSeconds) : 60,
  };
}
