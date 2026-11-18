<script lang="ts">
  import { app, closeQuestion } from '../state.svelte';
  import type { SessionQuestion } from '../types';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import QuestionForm from './QuestionForm.svelte';

  const session = $derived(app.sessions.find((item) => item.id === app.answerSessionId) ?? null);
  const pending = $derived(session?.pending ?? null);
  const isApproval = $derived(pending?.kind === 'approval');
  const questions = $derived<SessionQuestion[]>(pending?.questions ?? []);
  const opened = $derived(Boolean(session && pending && (isApproval || questions.length > 0)));

  /**
   * Identity of the inquiry currently on screen. The form remounts when the Host
   * replaces it (new request id, or a different session), which is what keeps
   * the draft answers clean — no state-syncing effect needed.
   */
  const formKey = $derived(`${app.answerSessionId || ''}\u0000${pending?.requestId || ''}`);

  function close(): void {
    closeQuestion();
  }
</script>

<Dialog.Root open={opened} onOpenChange={(value) => { if (!value) close(); }}>
  <Dialog.Content
    showCloseButton={false}
    interactOutsideBehavior="ignore"
    escapeKeydownBehavior="ignore"
    class="flex h-[calc(100dvh-20px)] max-h-[620px] w-[min(780px,calc(100vw-20px))] max-w-[780px] flex-col gap-0 overflow-hidden rounded-[24px] border border-border bg-card p-0 shadow-2xl sm:max-w-[780px]"
  >
    {#if session && pending}
      {#key formKey}
        <QuestionForm {session} {pending} {isApproval} {questions} onClose={close} />
      {/key}
    {/if}
  </Dialog.Content>
</Dialog.Root>
