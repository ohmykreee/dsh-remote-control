<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import Mic from '@lucide/svelte/icons/mic';
  import Plus from '@lucide/svelte/icons/plus';
  import MessageCircle from '@lucide/svelte/icons/message-circle';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button/index.js';
  import { cn } from '$lib/utils.js';
  import { app, toast } from '../state.svelte';
  import { t } from '../i18n.svelte';
  import Panel from './Panel.svelte';
  import Markdown from './Markdown.svelte';
  import {
    quickQa,
    quickQaAsk,
    quickQaBusy,
    quickQaCanAsk,
    quickQaOpenPending,
    quickQaReset,
    quickQaSelectDefault,
    quickQaSelectWorkspace,
    quickQaWorkspaces,
  } from '../quickqa.svelte';
  import {
    recordingToWav,
    startQuickQaCapture,
    transcribeQuickQaWav,
    type QuickQaCapture,
  } from '../quickqa-audio';

  const voiceReady = $derived(app.quickqa?.voiceReady === true);
  const workspaces = $derived(quickQaWorkspaces());
  const selectedWorkspaceId = $derived(quickQa.workspaceId || app.quickqa?.defaultWorkspaceId || '');
  const locked = $derived(Boolean(quickQa.sessionId));
  const phase = $derived(quickQa.phase);
  const followUpActive = $derived(Boolean(quickQa.sessionId) && (phase === 'capturing' || phase === 'transcribing'));
  const answerMode = $derived(phase === 'thinking' || phase === 'streaming' || phase === 'done' || phase === 'transcribing' || followUpActive);

  type MicPermissionState = 'unknown' | 'prompt' | 'granted' | 'denied';
  type StandbyHint = 'idle' | 'canceled' | 'noSpeech' | 'short' | 'noMic';
  let micPermission = $state<MicPermissionState>('unknown');
  let standbyHint = $state<StandbyHint>('idle');
  let conversationBodyEl = $state<HTMLElement | null>(null);
  let scrollFrame = 0;
  const waveLevel = new Tween(0, { duration: 140, easing: cubicOut });
  let permissionBusy = $state(false);

  let captureHandle: QuickQaCapture | null = null;
  let holding = false;
  let releasePending = false;
  let pointerId: number | null = null;
  let frame = 0;
  let startedAt = 0;
  let maxLevel = 0;
  let voicedMs = 0;
  let lastSampleAt = 0;
  let wasActive = false;
  let cancelButtonEl: HTMLElement | null = $state(null);

  $effect(() => {
    const active = app.activeKey === 'quickqa';
    if (active && !wasActive) quickQaSelectDefault();
    wasActive = active;
  });

  $effect(() => {
    const current = phase;
    const contentLength = quickQa.answer.length;
    const messageCount = quickQa.messages.length;
    const body = conversationBodyEl;
    if (!body || contentLength < 0 || messageCount < 0) return;
    if (current !== 'thinking' && current !== 'streaming' && current !== 'done' && current !== 'transcribing') return;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      if (conversationBodyEl) conversationBodyEl.scrollTop = conversationBodyEl.scrollHeight;
    });
  });

  onDestroy(() => {
    cancelAnimationFrame(scrollFrame);
    void cancelCapture(false);
  });

  onMount(() => {
    let status: PermissionStatus | null = null;
    const apply = (): void => {
      if (!status) return;
      micPermission = status.state as MicPermissionState;
    };
    let query: Promise<PermissionStatus> | null = null;
    try {
      query = navigator.permissions?.query?.({ name: 'microphone' as PermissionName }) ?? null;
    } catch {
      query = null;
    }
    if (query) {
      void query.then((value) => {
        status = value;
        apply();
        value.addEventListener?.('change', apply);
      }).catch(() => {});
    }
    return () => {
      status?.removeEventListener?.('change', apply);
    };
  });

  async function requestMicPermission(): Promise<void> {
    if (permissionBusy) return;
    permissionBusy = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      for (const track of stream.getTracks()) track.stop();
      micPermission = 'granted';
      standbyHint = 'idle';
    } catch {
      micPermission = 'denied';
      standbyHint = 'noMic';
      toast(t('quickQaMicDenied'));
    } finally {
      permissionBusy = false;
    }
  }

  function bindWindow(): void {
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  function unbindWindow(): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  }

  function cancelArmedAt(clientX: number, clientY: number): boolean {
    const rect = cancelButtonEl?.getBoundingClientRect();
    if (!rect) return false;
    const pad = 12;
    return clientX >= rect.left - pad
      && clientX <= rect.right + pad
      && clientY >= rect.top - pad
      && clientY <= rect.bottom + pad;
  }

  function onPointerMove(event: PointerEvent): void {
    if (!holding || (pointerId !== null && event.pointerId !== pointerId)) return;
    quickQa.cancelArmed = cancelArmedAt(event.clientX, event.clientY);
    event.preventDefault();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!holding || (pointerId !== null && event.pointerId !== pointerId)) return;
    if (quickQa.cancelArmed || cancelArmedAt(event.clientX, event.clientY)) {
      void cancelCapture(true);
      return;
    }
    void stopCapture();
  }

  function onPointerCancel(): void {
    if (!holding) return;
    void cancelCapture(true);
  }

  function stopFrame(): void {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    void waveLevel.set(0);
  }

  async function beginHold(event: PointerEvent): Promise<void> {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (holding || quickQa.phase === 'capturing') return;
    if (!voiceReady) {
      toast(t('quickQaVoiceUnavailable'));
      return;
    }
    if (quickQaBusy()) return;
    if (!quickQaCanAsk()) {
      toast(t('connectionLost'));
      return;
    }
    if (micPermission !== 'granted') {
      void requestMicPermission();
      return;
    }
    event.preventDefault();
    standbyHint = 'idle';
    holding = true;
    releasePending = false;
    pointerId = event.pointerId;
    startedAt = performance.now();
    lastSampleAt = startedAt;
    maxLevel = 0;
    voicedMs = 0;
    quickQa.phase = 'capturing';
    void waveLevel.set(0);
    quickQa.cancelArmed = false;
    if (!quickQa.sessionId) quickQa.answer = '';
    quickQa.error = '';
    quickQa.empty = false;
    quickQa.pending = null;
    bindWindow();
    void openCapture();
  }

  async function openCapture(): Promise<void> {
    try {
      const handle = await startQuickQaCapture();
      if (!holding || quickQa.cancelArmed) {
        releasePending = false;
        await handle.cancel();
        return;
      }
      captureHandle = handle;
      micPermission = 'granted';
      if (releasePending) {
        releasePending = false;
        await finishCapture(handle);
        return;
      }
      const tick = (): void => {
        if (!holding || quickQa.phase !== 'capturing') return;
        const level = handle.level();
        void waveLevel.set(level);
        if (level > maxLevel) maxLevel = level;
        const now = performance.now();
        if (level > 0.12) voicedMs += now - lastSampleAt;
        lastSampleAt = now;
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    } catch (error) {
      holding = false;
      unbindWindow();
      stopFrame();
      settlePhase();
      standbyHint = 'noMic';
      const message = error instanceof Error ? error.message : String(error);
      toast(
        message === 'microphone-unsupported' || message === 'audio-unsupported'
          ? t('quickQaMicUnsupported')
          : t('quickQaMicDenied'),
      );
    }
  }

  async function cancelCapture(showToast: boolean): Promise<void> {
    const hadCapture = holding || captureHandle !== null || quickQa.phase === 'capturing';
    holding = false;
    releasePending = false;
    unbindWindow();
    stopFrame();
    quickQa.cancelArmed = false;
    const handle = captureHandle;
    captureHandle = null;
    if (handle) await handle.cancel();
    settlePhase();
    if (showToast && hadCapture) {
      standbyHint = 'canceled';
      toast(t('quickQaCanceled'));
    }
  }

  async function stopCapture(): Promise<void> {
    holding = false;
    unbindWindow();
    stopFrame();
    quickQa.cancelArmed = false;
    if (!captureHandle) {
      releasePending = true;
      return;
    }
    const handle = captureHandle;
    captureHandle = null;
    await finishCapture(handle);
  }

  async function finishCapture(handle: QuickQaCapture): Promise<void> {
    const durationMs = performance.now() - startedAt;
    if (durationMs < 700 || maxLevel < 0.02 || voicedMs < 260) {
      await handle.cancel();
      settlePhase();
      standbyHint = durationMs < 700 ? 'short' : 'noSpeech';
      toast(durationMs < 700 ? t('quickQaTooShort') : t('quickQaNoSpeech'));
      return;
    }
    quickQa.phase = 'transcribing';
    try {
      const recording = await handle.stop();
      const wav = await recordingToWav(recording.blob);
      const text = await transcribeQuickQaWav(wav);
      if (!text) {
        settlePhase();
        toast(t('quickQaEmptyText'));
        return;
      }
      quickQa.phase = 'idle';
      if (!quickQaAsk(text)) settlePhase();
    } catch (error) {
      settlePhase();
      const message = error instanceof Error ? error.message : String(error);
      toast(
        message === 'voice-input-not-ready' || message === 'voice-input-unavailable'
          ? t('quickQaVoiceUnavailable')
          : t('quickQaTranscribeFailed'),
      );
    }
  }

  function selectWorkspace(id: string): void {
    if (locked) return;
    quickQaSelectWorkspace(id);
  }

  function settlePhase(): void {
    quickQa.phase = quickQa.sessionId && (quickQa.answer || quickQa.messages.length > 0) ? 'done' : 'idle';
  }

  function resetAll(): void {
    quickQaReset();
    quickQaSelectDefault();
  }
</script>

<div class="quickqa-page">
  <div class="quickqa-aurora" aria-hidden="true"></div>

  {#if answerMode}
    <div class="quickqa-answer-mode">
      <Panel class="quickqa-conversation">
        <div class="quickqa-conversation-body" bind:this={conversationBodyEl}>
          {#each quickQa.messages as message}
            <div class="quickqa-chat-row" class:is-user={message.role === 'user'}>
              {#if message.role === 'user'}
                <div class="quickqa-chat-bubble">{message.text}</div>
              {:else}
                <div class="quickqa-chat-assistant"><Markdown content={message.text} /></div>
              {/if}
            </div>
          {/each}

          {#if phase === 'thinking'}
            <div class="quickqa-chat-row is-assistant">
              <div class="quickqa-chat-thinking">
                <div class="quickqa-orb"><span></span><span></span><span></span></div>
                <span>{t('quickQaThinking')}</span>
              </div>
            </div>
          {:else if phase === 'streaming' || phase === 'done'}
            <div class="quickqa-chat-row is-assistant">
              {#if phase === 'done' && quickQa.empty && !quickQa.answer}
                <p class="quickqa-answer-empty">{t('quickQaAnswerEmpty')}</p>
              {:else}
                <div class="quickqa-chat-assistant" class:is-streaming={phase === 'streaming'}><Markdown content={quickQa.answer} /></div>
              {/if}
            </div>
          {:else if (phase === 'capturing' || phase === 'transcribing') && quickQa.answer}
            <div class="quickqa-chat-row is-assistant">
              <div class="quickqa-chat-assistant"><Markdown content={quickQa.answer} /></div>
            </div>
          {/if}

          {#if phase === 'transcribing'}
            <div class="quickqa-chat-row is-assistant">
              <div class="quickqa-follow-transcribing">
                <div class="quickqa-orb"><span></span><span></span><span></span></div>
                <span>{t('quickQaTranscribing')}</span>
              </div>
            </div>
          {/if}
        </div>

        {#if quickQa.pending}
          <div class="quickqa-pending" role="status">
            <MessageCircle class="size-[20px]" strokeWidth={1.8} />
            <div>
              <strong>{t('quickQaPending')}</strong>
              <p>{quickQa.pending.pushEnabled && app.pushQuestions ? t('quickQaPendingHint') : t('quickQaPushOffHint')}</p>
            </div>
            {#if quickQa.pending.pushEnabled && app.pushQuestions}
              <button type="button" class="quickqa-text-button" onclick={quickQaOpenPending}>{t('quickQaOpenInquiry')}</button>
            {/if}
          </div>
        {/if}

        {#if phase === 'capturing' || phase === 'done'}
          <div class="quickqa-actions">
            <div class="quickqa-action-item is-follow">
              {#if phase === 'capturing'}
                <Button
                  bind:ref={cancelButtonEl}
                  variant="outline"
                  size="sm"
                  class={cn('quickqa-cancel quickqa-follow-cancel transition-none', quickQa.cancelArmed && 'is-armed')}
                  aria-label={t('quickQaCancel')}
                  onpointerdown={(event) => event.stopPropagation()}
                >
                  <X class="size-[17px]" strokeWidth={2} />
                  <span>{quickQa.cancelArmed ? t('quickQaCancelHint') : t('quickQaCancel')}</span>
                </Button>
              {/if}
              <div class="quickqa-follow-shell">
                {#if phase === 'capturing'}
                  <span class="quickqa-ring" style="--level:{waveLevel.current}"></span>
                {/if}
                <Button
                  size="icon"
                  class="quickqa-round-action size-[76px] rounded-full border border-brand/35 bg-primary text-primary-foreground shadow-none transition-none hover:bg-primary"
                  aria-label={phase === 'capturing' ? t('quickQaListening') : t('quickQaFollowUp')}
                  title={phase === 'capturing' ? t('quickQaListening') : t('quickQaFollowUp')}
                  onpointerdown={phase === 'done' ? beginHold : (event) => event.preventDefault()}
                  oncontextmenu={(event) => event.preventDefault()}
                >
                  <Mic class="size-[32px]" strokeWidth={1.7} />
                </Button>
              </div>
              <span>{phase === 'capturing' ? t('quickQaListening') : t('quickQaFollowUp')}</span>
            </div>
            <div class="quickqa-action-item">
              <Button
                variant="outline"
                size="icon"
                class="quickqa-round-action size-[76px] rounded-full border-border bg-card/60 text-foreground shadow-none transition-none hover:bg-card/60"
                aria-label={t('quickQaNewSession')}
                title={t('quickQaNewSession')}
                disabled={phase === 'capturing'}
                onclick={resetAll}
              >
                <Plus class="size-[32px]" strokeWidth={1.8} />
              </Button>
              <span>{t('quickQaNewSession')}</span>
            </div>
          </div>
        {/if}
      </Panel>
    </div>
  {:else}
    <div class="quickqa-layout">
      <section class="quickqa-stage" aria-label={t('quickQaTitle')}>
        {#if voiceReady}
          <div class="quickqa-mic-area">
            {#if micPermission !== 'granted' && !quickQa.sessionId}
              <Button
                variant="outline"
                size="sm"
                class="h-10 gap-2 rounded-full border border-danger/30 bg-danger-soft px-4 text-[14px] font-medium text-danger shadow-none transition-none hover:bg-danger-soft"
                disabled={permissionBusy}
                onclick={requestMicPermission}
              >
                <Mic class="size-[16px]" strokeWidth={1.8} />
                {t('quickQaGrantMic')}
              </Button>
            {/if}
            {#if phase === 'capturing'}
              <Button
                bind:ref={cancelButtonEl}
                variant="outline"
                size="sm"
                class={cn('quickqa-cancel transition-none', quickQa.cancelArmed && 'is-armed')}
                aria-label={t('quickQaCancel')}
                onpointerdown={(event) => event.stopPropagation()}
              >
                <X class="size-[17px]" strokeWidth={2} />
                <span>{quickQa.cancelArmed ? t('quickQaCancelHint') : t('quickQaCancel')}</span>
              </Button>
            {/if}

            {#if phase === 'capturing' || phase === 'idle' || phase === 'error'}
              <div class="quickqa-mic-shell" class:is-capturing={phase === 'capturing'}>
                <span class="quickqa-ring" style={`--level:${waveLevel.current}`}></span>
                <Button
                  size="icon"
                  class={cn(
                    'quickqa-mic rounded-full border border-brand/35 bg-primary text-primary-foreground shadow-none transition-none hover:bg-primary',
                    phase === 'capturing' && 'is-holding',
                  )}
                  aria-label={phase === 'capturing' ? t('quickQaReleaseToSend') : t('quickQaHold')}
                  onpointerdown={beginHold}
                  oncontextmenu={(event) => event.preventDefault()}
                >
                  <Mic class="size-[56px]" strokeWidth={1.6} />
                </Button>
              </div>
              <p class="quickqa-mic-hint">
                {#if phase === 'capturing'}
                  {t('quickQaListening')}
                {:else if standbyHint === 'canceled'}
                  {t('quickQaCanceledHint')}
                {:else if standbyHint === 'noSpeech'}
                  {t('quickQaNoSpeechHint')}
                {:else if standbyHint === 'short'}
                  {t('quickQaShortHint')}
                {:else if standbyHint === 'noMic'}
                  {t('quickQaNoMicHint')}
                {:else}
                  {t('quickQaHold')}
                {/if}
              </p>
              {#if phase === 'capturing'}
                <p class="quickqa-mic-sub">{t('quickQaReleaseToSend')}</p>
              {/if}
            {:else if phase === 'transcribing'}
              <div class="quickqa-status-block">
                <div class="quickqa-orb"><span></span><span></span><span></span></div>
                <p class="quickqa-status">{t('quickQaTranscribing')}</p>
              </div>
            {/if}
          </div>

          {#if phase === 'error'}
            <div class="quickqa-error" role="alert">
              <p>{quickQa.error || t('quickQaError')}</p>
            </div>
          {/if}
        {:else}
          <Panel class="quickqa-unavailable">
            <div class="quickqa-unavailable-icon"><Mic class="size-[32px]" strokeWidth={1.6} /></div>
            <h2>{t('quickQaVoiceUnavailable')}</h2>
            <p>{t('quickQaVoiceUnavailableHint')}</p>
          </Panel>
        {/if}
      </section>

      <Panel class="quickqa-workspace-card">
        <h2 class="quickqa-workspace-title">{t('quickQaSelectWorkspace')}</h2>
        <div class="quickqa-workspace-list" class:is-locked={locked}>
          {#each workspaces as workspace (workspace.id)}
            {@const selected = workspace.id === selectedWorkspaceId}
            {@const isDefault = workspace.id === app.quickqa?.defaultWorkspaceId}
            <Button
              variant="outline"
              class={cn(
                'quickqa-workspace-item h-auto min-h-[66px] w-full justify-start gap-3 rounded-[18px] border-border bg-background/50 px-4 py-3 text-left whitespace-normal shadow-none touch-manipulation transition-none hover:bg-background/50',
                selected && 'is-selected border-brand/50 bg-brand-soft hover:bg-brand-soft',
              )}
              disabled={locked || quickQaBusy()}
              onclick={() => selectWorkspace(workspace.id)}
            >
              <span class="quickqa-workspace-mark" class:is-selected={selected} aria-hidden="true"></span>
              <span class="quickqa-workspace-text">
                <span class="quickqa-workspace-name">{workspace.title}</span>
                {#if workspace.path}<span class="quickqa-workspace-path">{workspace.path}</span>{/if}
              </span>
              {#if isDefault}<span class="quickqa-default-badge">{t('quickQaDefaultWorkspace')}</span>{/if}
            </Button>
          {/each}
          {#if workspaces.length === 0}
            <p class="quickqa-empty">{t('quickQaNoWorkspace')}</p>
          {/if}
        </div>
      </Panel>
    </div>
  {/if}
</div>

<style>
  .quickqa-page {
    position: relative;
    isolation: isolate;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .quickqa-aurora {
    position: absolute;
    inset: -10%;
    z-index: 0;
    background:
      radial-gradient(44% 56% at 24% 46%, color-mix(in srgb, var(--brand) 18%, transparent), transparent 70%),
      radial-gradient(36% 46% at 72% 24%, color-mix(in srgb, var(--success) 9%, transparent), transparent 72%),
      radial-gradient(52% 58% at 68% 82%, color-mix(in srgb, var(--warn) 8%, transparent), transparent 70%);
    filter: blur(18px);
    pointer-events: none;
  }

  .quickqa-layout {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: minmax(0, 1.08fr) minmax(330px, 0.92fr);
    align-items: center;
    gap: clamp(18px, 2.6vw, 36px);
    width: 100%;
    height: 100%;
    padding: clamp(14px, 2.4vw, 26px) clamp(14px, 2.6vw, 30px);
  }

  .quickqa-stage {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }

  .quickqa-mic-area {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .quickqa-mic-shell {
    position: relative;
    display: grid;
    place-items: center;
    width: clamp(190px, 30vh, 252px);
    height: clamp(190px, 30vh, 252px);
  }

  .quickqa-ring {
    position: absolute;
    inset: -14px;
    border-radius: 50%;
    border: 0;
    background: color-mix(in srgb, var(--brand) 20%, transparent);
    opacity: calc(0.16 + var(--level) * 0.52);
    transform: scale(calc(0.92 + var(--level) * 0.2));
    transition: opacity 140ms ease-out;
    pointer-events: none;
  }

  .quickqa-mic-shell:not(.is-capturing) .quickqa-ring {
    opacity: 0;
    transform: scale(0.86);
  }
  :global(.quickqa-mic) {
    width: 100%;
    height: 100%;
    border-radius: 9999px;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }

  :global(.quickqa-mic:active),
  :global(.quickqa-mic.is-holding) {
    transform: none;
  }

  :global(.quickqa-cancel) {
    position: absolute;
    z-index: 3;
    top: -74px;
    left: 50%;
    display: inline-flex;
    height: 42px;
    align-items: center;
    gap: 7px;
    padding: 0 17px;
    border-radius: 999px;
    border-color: color-mix(in srgb, var(--danger) 30%, var(--border));
    background: color-mix(in srgb, var(--card) 92%, transparent);
    color: var(--danger);
    font-size: 16px;
    font-weight: 600;
    box-shadow: none;
    backdrop-filter: blur(14px);
    transform: translateX(-50%);
  }

  :global(.quickqa-cancel.is-armed) {
    background: var(--danger);
    color: var(--danger-foreground, #fff);
  }

  .quickqa-mic-hint {
    margin: 0;
    color: var(--muted-foreground);
    font-size: 18px;
    font-weight: 600;
  }

  .quickqa-mic-sub {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    margin: 0;
    color: var(--muted-foreground);
    font-size: 15px;
    white-space: nowrap;
    transform: translateX(-50%);
  }

  .quickqa-status-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 42px 0;
  }

  .quickqa-orb {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    height: 40px;
  }

  .quickqa-orb span {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--brand);
    opacity: 0.35;
    animation: quickqa-pulse 1.05s ease-in-out infinite;
  }

  .quickqa-orb span:nth-child(2) { animation-delay: 0.14s; }
  .quickqa-orb span:nth-child(3) { animation-delay: 0.28s; }

  .quickqa-status {
    margin: 0;
    color: var(--muted-foreground);
    font-size: 18px;
    font-weight: 600;
  }

  .quickqa-answer-mode {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    padding: clamp(14px, 2.6vw, 30px);
  }

  :global(.quickqa-conversation) {
    display: flex;
    width: min(920px, 96%);
    height: min(72vh, 650px);
    flex-direction: column;
    padding: 24px 28px;
    border-radius: 28px;
    background: color-mix(in srgb, var(--card) 92%, transparent);
    backdrop-filter: blur(20px);
  }

  .quickqa-conversation-body {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 18px;
    overflow-y: auto;
    padding: 4px 2px 12px;
    scrollbar-width: thin;
  }

  .quickqa-chat-row {
    display: flex;
    width: 100%;
    flex: 0 0 auto;
    justify-content: flex-start;
  }

  .quickqa-chat-row.is-user { justify-content: flex-end; }

  .quickqa-chat-bubble {
    max-width: min(78%, 580px);
    padding: 10px 14px;
    border-radius: 18px 18px 4px 18px;
    background: var(--secondary);
    color: var(--secondary-foreground);
    font-size: 18px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .quickqa-chat-assistant {
    max-width: 100%;
    color: var(--foreground);
    font-size: 18px;
    line-height: 1.7;
    word-break: break-word;
  }

  .quickqa-chat-thinking {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--muted-foreground);
    font-size: 18px;
  }

  .quickqa-answer-empty {
    margin: 0;
    color: var(--muted-foreground);
    font-size: 18px;
  }

  .quickqa-chat-assistant.is-streaming :global(.quickqa-markdown > :last-child)::after {
    content: '';
    display: inline-block;
    width: 2px;
    height: 1.05em;
    margin-left: 2px;
    vertical-align: -0.16em;
    background: var(--brand);
    animation: quickqa-blink 0.9s steps(2, start) infinite;
  }

  .quickqa-follow-shell {
    position: relative;
    display: grid;
    place-items: center;
    width: 76px;
    height: 76px;
  }

  :global(.quickqa-follow-cancel) { top: -62px; }

  .quickqa-follow-transcribing {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 8px 0;
    color: var(--muted-foreground);
    font-size: 14px;
  }

  .quickqa-follow-transcribing .quickqa-orb {
    height: 24px;
    gap: 6px;
  }

  .quickqa-follow-transcribing .quickqa-orb span {
    width: 8px;
    height: 8px;
  }

  .quickqa-actions {
    display: flex;
    flex: 0 0 auto;
    align-items: flex-start;
    justify-content: center;
    gap: 48px;
    padding-top: 12px;
  }

  .quickqa-action-item {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: center;
    gap: 9px;
  }

  .quickqa-action-item.is-follow { position: relative; }

  .quickqa-action-item > span {
    color: var(--muted-foreground);
    font-size: 15px;
    white-space: nowrap;
  }

  @media (max-width: 700px) {
    .quickqa-actions { gap: 20px; }
  }
  .quickqa-text-button {
    border: 0;
    background: transparent;
    color: var(--brand);
    font: inherit;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
  }

  .quickqa-error {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
    border-radius: 14px;
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger);
    font-size: 16px;
  }

  .quickqa-error p { margin: 0; }

  .quickqa-pending {
    display: flex;
    flex: 0 0 auto;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
    margin-top: 8px;
    padding: 12px 14px;
    border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
    border-radius: 16px;
    background: color-mix(in srgb, var(--warn) 10%, transparent);
    color: var(--warn);
  }

  .quickqa-pending strong { font-size: 16px; }
  .quickqa-pending p { margin: 3px 0 0; color: var(--muted-foreground); font-size: 15px; }
  .quickqa-pending .quickqa-text-button { margin-left: auto; color: var(--warn); }

  :global(.quickqa-unavailable) {
    display: flex;
    max-width: 440px;
    flex-direction: column;
    align-items: center;
    gap: 9px;
    padding: 28px;
    border-radius: 24px;
    background: color-mix(in srgb, var(--card) 86%, transparent);
    text-align: center;
  }

  .quickqa-unavailable-icon {
    display: grid;
    place-items: center;
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--muted-foreground) 14%, transparent);
    color: var(--muted-foreground);
  }

  :global(.quickqa-unavailable) h2 { margin: 6px 0 0; font-size: 24px; font-weight: 650; letter-spacing: -0.02em; }
  :global(.quickqa-unavailable) p { margin: 0; color: var(--muted-foreground); font-size: 16px; line-height: 1.6; }

  :global(.quickqa-workspace-card) {
    display: flex;
    max-height: min(78vh, 690px);
    min-width: 0;
    flex-direction: column;
    gap: 14px;
    padding: 20px;
    border-radius: 26px;
    background: color-mix(in srgb, var(--card) 88%, transparent);
    backdrop-filter: blur(20px);
  }

  .quickqa-workspace-title {
    margin: 0;
    font-size: 24px;
    font-weight: 650;
    letter-spacing: -0.02em;
    line-height: 1.25;
  }

  .quickqa-workspace-list {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    padding-right: 2px;
    scrollbar-width: thin;
  }

  .quickqa-workspace-list.is-locked { opacity: 0.72; }

  .quickqa-workspace-mark {
    width: 19px;
    height: 19px;
    flex: 0 0 auto;
    border: 1.5px solid var(--muted-foreground);
    border-radius: 50%;
  }

  .quickqa-workspace-mark.is-selected {
    border: 5px solid var(--brand);
  }

  .quickqa-workspace-text {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 2px;
  }

  .quickqa-workspace-name {
    overflow: hidden;
    font-size: 18px;
    font-weight: 620;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quickqa-workspace-path {
    overflow: hidden;
    color: var(--muted-foreground);
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quickqa-default-badge {
    flex: 0 0 auto;
    padding: 4px 9px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--success) 16%, transparent);
    color: var(--success);
    font-size: 12px;
    font-weight: 700;
  }

  .quickqa-empty {
    margin: 0;
    padding: 18px 4px;
    color: var(--muted-foreground);
    font-size: 16px;
    text-align: center;
  }

  @keyframes quickqa-pulse {
    0%, 100% { transform: translateY(0); opacity: 0.28; }
    50% { transform: translateY(-4px); opacity: 1; }
  }

  @keyframes quickqa-blink {
    50% { opacity: 0; }
  }

  @media (max-height: 720px) {
    .quickqa-layout {
      gap: 16px;
      padding: 10px 18px;
    }

    .quickqa-mic-shell { width: clamp(150px, 27vh, 200px); height: clamp(150px, 27vh, 200px); }
    :global(.quickqa-conversation) { height: min(82vh, 560px); padding: 20px 22px; }
    :global(.quickqa-workspace-card) { padding: 16px; max-height: calc(100% - 4px); }
    :global(.quickqa-workspace-item) { min-height: 58px; padding: 10px 12px; }
  }

  @media (max-width: 900px) {
    .quickqa-layout {
      grid-template-columns: minmax(0, 1fr) minmax(290px, 0.86fr);
      gap: 14px;
    }
  }

  @media (orientation: portrait) {
    .quickqa-page { overflow-y: auto; }
    .quickqa-layout {
      grid-template-columns: 1fr;
      align-items: start;
      height: auto;
      min-height: 100%;
      gap: 18px;
      padding: 22px 14px;
    }

    .quickqa-stage { min-height: 52vh; }
    :global(.quickqa-workspace-card) { max-height: none; }
    .quickqa-workspace-list { max-height: 40vh; }
    :global(.quickqa-workspace-item) { min-height: 66px; }

    .quickqa-answer-mode { padding: 14px; }
    :global(.quickqa-conversation) {
      width: 100%;
      height: calc(100dvh - 110px);
      padding: 18px;
    }
  }
</style>
