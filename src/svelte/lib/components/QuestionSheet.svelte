<script lang="ts">
  import { app, closeQuestion, submitQuestionAnswer, toast } from '../state.svelte';
  import type { SessionQuestion } from '../types';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Card } from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { cn } from '$lib/utils.js';
  import X from '@lucide/svelte/icons/x';
  import MessageCircle from '@lucide/svelte/icons/message-circle';
  import Check from '@lucide/svelte/icons/check';
  import PencilLine from '@lucide/svelte/icons/pencil-line';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import SkipForward from '@lucide/svelte/icons/skip-forward';

  interface Draft {
    selected: string[];
    custom: string;
    skipped: boolean;
  }

  interface DisplayLabel {
    text: string;
    recommended: boolean;
  }

  const session = $derived(app.sessions.find((item) => item.id === app.answerSessionId) ?? null);
  const pending = $derived(session?.pending ?? null);
  const questions = $derived<SessionQuestion[]>(pending?.questions ?? []);
  const opened = $derived(Boolean(session && pending && questions.length > 0));
  const needsSubmit = $derived(questions.length > 1 || questions.some((question) => question.multiSelect === true));
  const complete = $derived(questions.every((_, index) => isComplete(index)));

  let drafts = $state<Draft[]>([]);
  let busy = $state(false);
  let error = $state('');
  let activeKey = '';

  function isComplete(index: number): boolean {
    const draft = drafts[index];
    if (!draft) return false;
    return draft.skipped || draft.selected.length > 0 || draft.custom.trim() !== '';
  }

  $effect(() => {
    const key = `${session?.id ?? ''}\u0000${pending?.requestId ?? ''}\u0000${questions.length}`;
    if (key === activeKey) return;
    activeKey = key;
    drafts = questions.map(() => ({ selected: [], custom: '', skipped: false }));
    busy = false;
    error = '';
  });

  $effect(() => {
    if (!app.answerSessionId) return;
    if (!app.pushQuestions || !session || pending?.answerable === false || questions.length === 0) closeQuestion();
  });

  function close(): void {
    if (busy) return;
    closeQuestion();
  }

  function choose(question: SessionQuestion, index: number, label: string): void {
    if (busy) return;
    const draft = drafts[index];
    if (!draft) return;
    if (question.multiSelect === true) {
      const selected = draft.selected.includes(label)
        ? draft.selected.filter((item) => item !== label)
        : [...draft.selected, label];
      drafts[index] = { ...draft, selected, skipped: false };
      error = '';
      return;
    }
    drafts[index] = { selected: [label], custom: '', skipped: false };
    error = '';
    if (questions.length === 1) void submit();
  }

  function updateCustom(index: number, value: string): void {
    if (busy) return;
    const draft = drafts[index];
    if (!draft) return;
    drafts[index] = {
      ...draft,
      custom: value,
      selected: questions[index]?.multiSelect === true ? draft.selected : [],
      skipped: false,
    };
    error = '';
  }

  function skip(index: number): void {
    if (busy) return;
    drafts[index] = { selected: [], custom: '', skipped: true };
    error = '';
    if (questions.length === 1) void submit();
  }

  function answerFor(question: SessionQuestion, index: number): { id: string; selected: string[]; custom?: string } {
    const draft = drafts[index];
    if (!draft || draft.skipped) return { id: question.id, selected: [] };
    const custom = draft.custom.trim();
    if (custom) {
      return {
        id: question.id,
        selected: question.multiSelect === true ? [...draft.selected] : [],
        custom,
      };
    }
    return { id: question.id, selected: [...draft.selected] };
  }

  async function submit(): Promise<void> {
    if (busy) return;
    if (!session?.id || !pending?.requestId) {
      error = '当前问题已经结束';
      return;
    }
    if (!complete) {
      error = '请先回答每一道问题，或选择跳过';
      return;
    }
    busy = true;
    error = '';
    try {
      await submitQuestionAnswer(
        session.id,
        pending.requestId,
        questions.map((question, index) => answerFor(question, index)),
      );
      toast('已回复');
      closeQuestion();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      toast(error);
    } finally {
      busy = false;
    }
  }

  function customKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void submit();
  }

  function displayLabel(label: string): DisplayLabel {
    const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
    return suffix.test(label)
      ? { text: label.replace(suffix, ''), recommended: true }
      : { text: label, recommended: false };
  }
</script>

<Dialog.Root open={opened} onOpenChange={(value) => { if (!value) close(); }}>
  <Dialog.Content
    showCloseButton={false}
    interactOutsideBehavior="ignore"
    escapeKeydownBehavior="ignore"
    class="flex h-[calc(100dvh-20px)] max-h-[620px] w-[min(780px,calc(100vw-20px))] max-w-[780px] flex-col gap-0 overflow-hidden rounded-[24px] border border-border bg-card p-0 shadow-2xl sm:max-w-[780px]"
  >
    <div class="flex shrink-0 items-start justify-between gap-4 border-b border-border p-3.5">
      <div class="flex min-w-0 items-start gap-3">
        <span class="grid size-11 shrink-0 place-items-center rounded-[13px] border border-warn/20 bg-warn-soft text-warn">
          <MessageCircle class="size-[24px]" strokeWidth={1.7} />
        </span>
        <div class="min-w-0">
          <p class="eyebrow text-warn">WAITING FOR ANSWER</p>
          <Dialog.Title class="mt-1 truncate text-[24px] font-semibold tracking-[-0.03em]">
            {session?.title || '会话提问'}
          </Dialog.Title>
          <Dialog.Description class="mt-1 text-[14px] leading-relaxed">
            {questions.length > 1 ? `${questions.length} 个问题` : '选择一项，或填写自定义回复'}
          </Dialog.Description>
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon"
        class="size-11 shrink-0 rounded-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        type="button"
        aria-label="关闭"
        disabled={busy}
        onclick={close}
      >
        <X class="size-[22px]" strokeWidth={1.8} />
      </Button>
    </div>

    <ScrollArea class="min-h-0 flex-1">
      <div class="flex flex-col gap-2.5 p-3.5">
        {#each questions as question, index (question.id)}
          <Card class="gap-0 rounded-[16px] border border-border bg-surface-2/55 p-3.5 shadow-none ring-0 [--card-spacing:0px]">
            {#if question.header}
              <Badge
                variant="outline"
                class="mb-2 h-7 self-start border-warn/20 bg-warn-soft px-3 text-[13px] font-medium text-warn"
              >
                {question.header}
              </Badge>
            {/if}

            <div class="flex items-start gap-2.5">
              {#if questions.length > 1}
                <span class="grid size-7 shrink-0 place-items-center rounded-[9px] bg-brand-soft text-[14px] font-semibold text-brand">
                  {index + 1}
                </span>
              {/if}
              <h3 class="text-[19px] leading-snug font-semibold text-foreground">{question.question}</h3>
            </div>

            {#if question.detail}
              <p class="mt-2.5 max-h-36 overflow-y-auto rounded-[11px] border border-border bg-card px-3 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {question.detail}
              </p>
            {/if}

            {#if (question.options?.length ?? 0) > 0}
              <div
                class="mt-3 flex flex-col gap-2"
                role={question.multiSelect === true ? 'group' : 'radiogroup'}
              >
                {#each question.options ?? [] as option, optionIndex (`${option.label}-${optionIndex}`)}
                  {@const label = displayLabel(option.label)}
                  {@const selected = drafts[index]?.selected.includes(option.label) === true}
                  <Button
                    variant="outline"
                    class={cn(
                      'h-auto min-h-[54px] w-full justify-start gap-3 rounded-[12px] border-border bg-card px-3 py-2.5 text-left whitespace-normal shadow-none hover:bg-secondary',
                      selected && 'border-brand/50 bg-brand-soft hover:bg-brand-soft',
                    )}
                    type="button"
                    role={question.multiSelect === true ? 'checkbox' : 'radio'}
                    aria-checked={selected}
                    disabled={busy}
                    onclick={() => choose(question, index, option.label)}
                  >
                    <span
                      class={cn(
                        'grid size-7 shrink-0 place-items-center rounded-[8px] border border-border text-[13px] font-semibold text-muted-foreground',
                        selected && 'border-brand bg-primary text-primary-foreground',
                      )}
                    >
                      {#if selected}
                        <Check class="size-4" strokeWidth={2.2} />
                      {:else}
                        {question.multiSelect === true ? '' : optionIndex + 1}
                      {/if}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="flex flex-wrap items-center gap-2 text-[16px] leading-snug font-medium text-foreground">
                        {label.text}
                        {#if label.recommended}
                          <span class="rounded-full bg-success-soft px-2 py-0.5 text-[12px] font-semibold text-success">推荐</span>
                        {/if}
                      </span>
                      {#if option.description}
                        <span class="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{option.description}</span>
                      {/if}
                    </span>
                  </Button>
                {/each}
              </div>
            {/if}

            <div class="relative mt-3">
              <PencilLine class="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" strokeWidth={1.7} />
              <Input
                type="text"
                value={drafts[index]?.custom ?? ''}
                placeholder={question.options?.length ? '其他回答…' : '输入回答…'}
                aria-label="自定义回复"
                class="h-12 rounded-[11px] border-border bg-card pl-11 text-[16px] shadow-none placeholder:text-muted-foreground"
                disabled={busy}
                oninput={(event) => updateCustom(index, event.currentTarget.value)}
                onkeydown={customKey}
              />
              {#if questions.length === 1}
                <Button
                  size="icon"
                  class="absolute top-1/2 right-1.5 size-10 -translate-y-1/2 rounded-[10px] bg-primary text-primary-foreground shadow-none hover:bg-primary/90"
                  type="button"
                  disabled={busy || !isComplete(index)}
                  onclick={() => void submit()}
                  aria-label="发送回答"
                >
                  <ArrowUp class="size-[20px]" strokeWidth={2} />
                </Button>
              {/if}
            </div>

            <div class="mt-1.5 flex min-h-9 items-center gap-2">
              <Button
                variant="ghost"
                class="h-9 gap-2 px-0 text-[14px] text-muted-foreground hover:bg-transparent hover:text-foreground"
                type="button"
                disabled={busy}
                onclick={() => skip(index)}
              >
                <SkipForward class="size-[18px]" strokeWidth={1.7} />
                跳过此题
              </Button>
              {#if drafts[index]?.skipped}
                <span class="text-[13px] text-warn">将作为未回答提交</span>
              {/if}
            </div>
          </Card>
        {/each}

        {#if error}
          <p
            class="rounded-[11px] border border-danger/25 bg-danger-soft px-3 py-2.5 text-[15px] leading-relaxed text-danger"
            role="alert"
          >
            {error}
          </p>
        {/if}
      </div>
    </ScrollArea>

    {#if needsSubmit}
      <div class="mt-0 flex shrink-0 flex-col gap-2.5 border-t border-border bg-card p-4">
        <p class="text-[13px] text-muted-foreground">
          {busy ? '正在发送…' : '可多选或填写自定义回复'}
        </p>
        <div class="flex w-full gap-2.5">
          <Button
            variant="outline"
            class="h-12 flex-1 rounded-[13px] border-border bg-transparent text-[16px] shadow-none hover:bg-secondary"
            type="button"
            disabled={busy}
            onclick={close}
          >
            取消
          </Button>
          <Button
            class="h-12 flex-1 rounded-[13px] bg-primary text-[16px] text-primary-foreground shadow-none hover:bg-primary/90"
            type="button"
            disabled={busy || !complete}
            onclick={() => void submit()}
          >
            {busy ? '发送中…' : '发送回答'}
          </Button>
        </div>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
