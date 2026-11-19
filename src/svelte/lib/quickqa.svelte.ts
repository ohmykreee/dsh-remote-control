/**
 * Quick Q&A page state and WebSocket protocol handling.
 *
 * Audio capture stays in `quickqa-audio.ts`; this module owns the visible phase,
 * streamed answer text, workspace selection, and pending inquiry handoff.
 */

import { t } from './i18n.svelte';
import { app, toast } from './state.svelte';
import type { QuickQaImageMediaType } from './quickqa-image';
import { isLiveOpen, sendLive } from './ws';
import type { QuickQaPending, QuickQaPhase, ServerMessage, SessionItem } from './types';

export interface QuickQaChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Local object URL for the image sent with this user turn, if any. */
  imageUrl?: string;
}

export interface QuickQaAttachedImage {
  /** Original bytes; uploaded together with the question, not on selection. */
  blob: Blob;
  mediaType: QuickQaImageMediaType;
  /** Local object URL used by the preview; revoked when the image is dropped. */
  url: string;
}

/** Image id + preview URL handed to one successfully sent question. */
export interface QuickQaOutgoingImage {
  id: string;
  url: string;
}

export const quickQa = $state({
  phase: 'idle' as QuickQaPhase,
  sessionId: null as string | null,
  workspaceId: '',
  answer: '',
  messages: [] as QuickQaChatMessage[],
  error: '',
  empty: false,
  stopped: false,
  pending: null as QuickQaPending | null,
  cancelArmed: false,
  cancelRequested: false,
  attachedImage: null as QuickQaAttachedImage | null,
});

/** Image URL waiting for the Host's `thinking` echo to land on the user bubble. */
let pendingImageUrl: string | null = null;

const BUSY_PHASES: readonly QuickQaPhase[] = ['capturing', 'transcribing', 'thinking', 'streaming'];

function releaseUrl(url: string | null | undefined): void {
  if (!url || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* already released */
  }
}

/** Replace the one pending attachment, releasing the preview that was replaced. */
export function setQuickQaImage(image: QuickQaAttachedImage): void {
  if (quickQa.attachedImage && quickQa.attachedImage.url !== image.url) {
    releaseUrl(quickQa.attachedImage.url);
  }
  quickQa.attachedImage = image;
}

/** Drop the pending attachment (the close button and page teardown). */
export function clearQuickQaImage(): void {
  releaseUrl(quickQa.attachedImage?.url);
  quickQa.attachedImage = null;
}

function releaseChatImages(): void {
  for (const message of quickQa.messages) releaseUrl(message.imageUrl);
  releaseUrl(pendingImageUrl);
  pendingImageUrl = null;
}

function appendChatMessage(role: 'user' | 'assistant', text: string, imageUrl?: string): boolean {
  const value = String(text || '').trim();
  if (!value) return false;
  const last = quickQa.messages[quickQa.messages.length - 1];
  if (last?.role === role && last.text === value) return false;
  quickQa.messages.push({ role, text: value, ...(imageUrl ? { imageUrl } : {}) });
  return true;
}

function archiveCurrentAnswer(): void {
  const value = quickQa.answer.trim();
  if (!value) return;
  appendChatMessage('assistant', value);
  quickQa.answer = '';
}

export function quickQaBusy(): boolean {
  return BUSY_PHASES.includes(quickQa.phase);
}

export function quickQaWorkspaces(): Array<{ id: string; title: string; path: string }> {
  const configured = app.quickqa ?? {};
  const workspaces: Array<{ id: string; title: string; path: string }> = [];
  if (configured.defaultWorkspaceId) {
    workspaces.push({
      id: configured.defaultWorkspaceId,
      title: configured.defaultWorkspaceTitle || configured.defaultWorkspaceId,
      path: '',
    });
  }
  for (const entry of configured.pinned ?? []) {
    if (!entry?.id || workspaces.some((workspace) => workspace.id === entry.id)) continue;
    workspaces.push({ id: entry.id, title: entry.title || entry.id, path: entry.path || '' });
  }
  return workspaces;
}

/** Select the configured default workspace when the page is entered. */
export function quickQaSelectDefault(): void {
  if (quickQa.sessionId) return;
  quickQa.workspaceId = app.quickqa?.defaultWorkspaceId || '';
}

/** Keep the selection valid when settings change while no session is active. */
export function quickQaSyncSettings(): void {
  if (quickQa.sessionId) return;
  const available = quickQaWorkspaces();
  if (!quickQa.workspaceId || !available.some((workspace) => workspace.id === quickQa.workspaceId)) {
    quickQa.workspaceId = app.quickqa?.defaultWorkspaceId || '';
  }
}

export function quickQaSelectWorkspace(id: string): void {
  if (quickQa.sessionId || quickQaBusy()) return;
  if (!quickQaWorkspaces().some((workspace) => workspace.id === id)) return;
  quickQa.workspaceId = id;
}

export function quickQaCanAsk(): boolean {
  return app.quickqa?.voiceReady === true && isLiveOpen() && !quickQaBusy();
}

/** Send one transcribed question. A null session starts a new DSH Session. */
export function quickQaAsk(text: string, image: QuickQaOutgoingImage | null = null): boolean {
  const content = String(text || '').trim();
  if (!content) {
    toast(t('quickQaEmptyText'));
    return false;
  }
  if (app.quickqa?.voiceReady !== true) {
    toast(t('quickQaVoiceUnavailable'));
    return false;
  }
  if (quickQaBusy()) return false;
  if (!isLiveOpen()) {
    toast(t('connectionLost'));
    return false;
  }
  const sessionId = quickQa.sessionId;
  const workspaceId = quickQa.workspaceId || app.quickqa?.defaultWorkspaceId || '';
  const message = sessionId
    ? { type: 'quickqa-ask' as const, text: content, sessionId, ...(image ? { imageId: image.id } : {}) }
    : { type: 'quickqa-ask' as const, text: content, workspaceId, ...(image ? { imageId: image.id } : {}) };
  if (!sendLive(message)) {
    toast(t('connectionLost'));
    return false;
  }
  if (image) {
    // The preview URL now belongs to the pending user message instead of the
    // attach row, so it must outlive this state transition.
    if (quickQa.attachedImage?.url === image.url) quickQa.attachedImage = null;
    releaseUrl(pendingImageUrl);
    pendingImageUrl = image.url;
  }
  if (sessionId) archiveCurrentAnswer();
  quickQa.phase = 'thinking';
  quickQa.error = '';
  quickQa.empty = false;
  quickQa.stopped = false;
  quickQa.pending = null;
  return true;
}

/** Drop the current conversation and return to the default workspace. */
export function quickQaReset(): void {
  if (quickQa.sessionId) sendLive({ type: 'quickqa-reset' });
  releaseChatImages();
  clearQuickQaImage();
  quickQa.phase = 'idle';
  quickQa.sessionId = null;
  quickQa.answer = '';
  quickQa.messages = [];
  quickQa.error = '';
  quickQa.empty = false;
  quickQa.stopped = false;
  quickQa.pending = null;
  quickQa.cancelArmed = false;
  quickQa.cancelRequested = false;
  quickQa.workspaceId = app.quickqa?.defaultWorkspaceId || '';
}

/** Ask the Host to interrupt the running turn without leaving the answer card. */
export function quickQaStop(): void {
  if (!quickQa.sessionId || quickQa.phase !== 'thinking') return;
  sendLive({ type: 'quickqa-stop' });
}

/** Re-open the existing inquiry sheet for the active conversation. */
export function quickQaOpenPending(): void {
  if (!quickQa.pending || !quickQa.sessionId) return;
  if (app.pushQuestions !== true) {
    toast(t('quickQaPushOffHint'));
    return;
  }
  app.answerSessionId = quickQa.sessionId;
}

/**
 * Synthetic session row for the inquiry sheet when the real sessions push is
 * disabled or has not arrived yet. The Host's snapshots replace it as soon as
 * the quick session is listed.
 */
export function quickQaPendingSession(): SessionItem | null {
  const pending = quickQa.pending;
  if (!pending || !quickQa.sessionId) return null;
  if (!pending.pushEnabled || !app.pushQuestions) return null;
  return {
    id: quickQa.sessionId,
    title: t('pageQuickQa'),
    status: 'question',
    syntheticQuickQa: true,
    pending: {
      kind: pending.kind,
      question: pending.question,
      header: pending.header,
      detail: pending.detail,
      requestId: pending.requestId,
      answerable: pending.answerable,
      count: pending.count,
      questions: pending.questions,
    },
  };
}

/** Apply one `quickqa-*` server frame. */
export function handleQuickQaMessage(message: ServerMessage): void {
  switch (message.type) {
    case 'quickqa-state': {
      const phase = message.phase;
      if (message.sessionId) quickQa.sessionId = message.sessionId;
      if (message.workspaceId) quickQa.workspaceId = message.workspaceId;
      if (message.error) {
        const abandoned = quickQa.sessionId || message.sessionId || '';
        releaseChatImages();
        clearQuickQaImage();
        quickQa.error = message.error;
        quickQa.answer = '';
        quickQa.messages = [];
        quickQa.sessionId = null;
        quickQa.pending = null;
        quickQa.stopped = false;
        quickQa.phase = 'error';
        if (abandoned) sendLive({ type: 'quickqa-reset' });
        toast(message.error);
        break;
      }
      if (phase === 'thinking') {
        archiveCurrentAnswer();
        quickQa.empty = false;
        quickQa.stopped = false;
        quickQa.error = '';
        quickQa.pending = null;
        const question = String(message.question || '').trim();
        if (question) {
          const appended = appendChatMessage('user', question, pendingImageUrl ?? undefined);
          // A duplicate turn reuses the existing bubble; do not leak the
          // preview URL that would otherwise have belonged to a new message.
          if (!appended && pendingImageUrl) releaseUrl(pendingImageUrl);
          pendingImageUrl = null;
        } else if (pendingImageUrl) {
          releaseUrl(pendingImageUrl);
          pendingImageUrl = null;
        }
      } else if (phase === 'streaming') {
        quickQa.empty = false;
        quickQa.stopped = false;
      } else if (phase === 'done') {
        quickQa.empty = message.empty === true;
        quickQa.stopped = message.stopped === true;
      }
      if (phase) quickQa.phase = phase;
      break;
    }
    case 'quickqa-delta':
      if (message.text) {
        if (quickQa.phase !== 'streaming') quickQa.phase = 'streaming';
        quickQa.answer += message.text;
      }
      break;
    case 'quickqa-pending': {
      if (message.clear) {
        quickQa.pending = null;
        if (quickQa.sessionId) {
          app.sessions = app.sessions.filter(
            (session) => !(session.syntheticQuickQa === true && session.id === quickQa.sessionId),
          );
        }
        if (app.answerSessionId && app.answerSessionId === quickQa.sessionId) app.answerSessionId = null;
        break;
      }
      const pending: QuickQaPending = {
        kind: message.kind || 'question',
        question: message.question || '',
        header: message.header || '',
        detail: message.detail || '',
        requestId: message.requestId || '',
        answerable: message.answerable === true,
        count: message.count || 1,
        questions: message.questions ?? [],
        pushEnabled: message.pushEnabled === true,
      };
      quickQa.pending = pending;
      if (pending.pushEnabled && app.pushQuestions && quickQa.sessionId) {
        const overlay = quickQaPendingSession();
        if (overlay) {
          const exists = app.sessions.some((session) => session.id === overlay.id);
          app.sessions = exists
            ? app.sessions.map((session) => session.syntheticQuickQa === true && session.id === overlay.id
              ? overlay
              : session)
            : [...app.sessions, overlay];
        }
        app.answerSessionId = quickQa.sessionId;
      }
      break;
    }
    default:
      break;
  }
}
