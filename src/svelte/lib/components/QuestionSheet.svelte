<script lang="ts">
  import { app, closeQuestion, submitQuestionAnswer, toast } from '../state.svelte';
  import type { SessionQuestion } from '../types';

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

{#if session && pending && questions.length > 0}
  <div class="sheet-layer">
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="question-sheet-title">
      <header class="sheet-head">
        <div class="sheet-heading">
          <span class="sheet-kicker">WAITING FOR ANSWER</span>
          <h2 id="question-sheet-title">{session.title || '会话提问'}</h2>
          <p>{questions.length > 1 ? `${questions.length} 个问题` : '请选择一个选项，或填写自定义回复'}{session.cwd ? ` · ${session.cwd}` : ''}</p>
        </div>
        <button type="button" class="sheet-close" aria-label="关闭" onclick={close} disabled={busy}>×</button>
      </header>

      <div class="sheet-body">
        {#each questions as question, index (question.id)}
          <article class="question-block">
            {#if question.header}<div class="question-header">{question.header}</div>{/if}
            <div class="question-title-row">
              {#if questions.length > 1}<span class="question-index">{index + 1}</span>{/if}
              <h3>{question.question}</h3>
            </div>
            {#if question.detail}<p class="question-detail">{question.detail}</p>{/if}

            {#if (question.options?.length ?? 0) > 0}
              <div
                class="option-list"
                class:is-multi={question.multiSelect === true}
                role={question.multiSelect === true ? 'group' : 'radiogroup'}
              >
                {#each question.options ?? [] as option, optionIndex (`${option.label}-${optionIndex}`)}
                  {@const label = displayLabel(option.label)}
                  {@const selected = drafts[index]?.selected.includes(option.label) === true}
                  <button
                    type="button"
                    class="option"
                    class:is-selected={selected}
                    role={question.multiSelect === true ? 'checkbox' : 'radio'}
                    aria-checked={selected}
                    disabled={busy}
                    onclick={() => choose(question, index, option.label)}
                  >
                    {#if question.multiSelect === true}
                      <span class="option-check" aria-hidden="true">{selected ? '✓' : ''}</span>
                    {:else}
                      <span class="option-number" aria-hidden="true">{optionIndex + 1}</span>
                    {/if}
                    <span class="option-copy">
                      <span class="option-label">
                        {label.text}
                        {#if label.recommended}<span class="option-badge">推荐</span>{/if}
                      </span>
                      {#if option.description}<span class="option-desc">{option.description}</span>{/if}
                    </span>
                  </button>
                {/each}
              </div>
            {/if}

            <div class="custom-row" class:is-active={Boolean(drafts[index]?.custom.trim())}>
              <span class="custom-icon" aria-hidden="true">✎</span>
              <input
                class="custom-input"
                type="text"
                value={drafts[index]?.custom ?? ''}
                placeholder={question.options?.length ? '其他回答…' : '输入回答…'}
                aria-label="自定义回复"
                disabled={busy}
                oninput={(event) => updateCustom(index, event.currentTarget.value)}
                onkeydown={customKey}
              />
              {#if questions.length === 1}
                <button
                  type="button"
                  class="custom-send"
                  disabled={busy || !isComplete(index)}
                  onclick={() => void submit()}
                  aria-label="发送回答"
                >↵</button>
              {/if}
            </div>

            <div class="question-footer">
              <button type="button" class="skip" disabled={busy} onclick={() => skip(index)}>跳过此题</button>
              {#if drafts[index]?.skipped}<span class="skip-note">将作为未回答提交</span>{/if}
            </div>
          </article>
        {/each}
        {#if error}<p class="sheet-error" role="alert">{error}</p>{/if}
      </div>

      {#if needsSubmit}
        <footer class="sheet-foot">
          <span class="sheet-hint">{busy ? '正在发送…' : '点击选项即可快速回答；也可以填写自定义回复。'}</span>
          <div class="sheet-actions">
            <button type="button" class="btn ghost" onclick={close} disabled={busy}>取消</button>
            <button type="button" class="btn primary" onclick={() => void submit()} disabled={busy || !complete}>
              {busy ? '发送中…' : '发送回答'}
            </button>
          </div>
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
.sheet-layer {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 22px;
  background: rgba(2, 5, 12, 0.58);
  backdrop-filter: blur(9px);
  animation: sheet-fade 0.16s ease both;
}

.sheet {
  width: min(760px, 100%);
  max-height: min(88vh, 720px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--line-strong);
  border-radius: 24px;
  background: var(--card);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.5);
  color: var(--text);
  overflow: hidden;
  animation: sheet-rise 0.2s ease both;
}

.sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, color-mix(in srgb, var(--amber) 9%, transparent), transparent);
}

.sheet-heading {
  min-width: 0;
}

.sheet-kicker {
  display: block;
  color: var(--amber);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.sheet-heading h2 {
  margin: 4px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 19px;
  line-height: 1.2;
  font-weight: 620;
  letter-spacing: -0.02em;
}

.sheet-heading p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.4;
}

.sheet-close {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--card-2);
  color: var(--muted);
  font-size: 19px;
  line-height: 1;
}

.sheet-close:hover {
  color: var(--text);
  border-color: var(--line-strong);
}

.sheet-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  scrollbar-width: thin;
}

.sheet-body::-webkit-scrollbar {
  width: 6px;
}

.sheet-body::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: var(--line-strong);
}

.question-block {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 13px 14px 10px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--card-2);
}

.question-block + .question-block {
  margin-top: 0;
}

.question-header {
  align-self: flex-start;
  padding: 3px 8px;
  border: 1px solid color-mix(in srgb, var(--amber) 28%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--amber) 12%, transparent);
  color: var(--amber);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.question-title-row {
  display: flex;
  align-items: flex-start;
  gap: 9px;
}

.question-title-row h3 {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.42;
  font-weight: 600;
}

.question-index {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  margin-top: 1px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent-2);
  font-size: 10px;
  font-weight: 700;
}

.question-detail {
  max-height: 190px;
  margin: 0;
  padding: 9px 10px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--card-3);
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  scrollbar-width: thin;
}

.option-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.option {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--card) 72%, transparent);
  color: var(--text);
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.option:hover:not(:disabled) {
  border-color: var(--line-strong);
  background: var(--card);
}

.option.is-selected {
  border-color: color-mix(in srgb, var(--accent) 65%, transparent);
  background: color-mix(in srgb, var(--accent) 14%, var(--card));
}

.option:disabled {
  opacity: 0.62;
}

.option-number,
.option-check {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  color: var(--muted);
  font-size: 9.5px;
  font-weight: 650;
}

.option-check {
  border-radius: 6px;
}

.option.is-selected .option-number,
.option.is-selected .option-check {
  border-color: transparent;
  background: var(--accent);
  color: #fff;
}

.option-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.option-label {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  line-height: 1.35;
  font-weight: 560;
}

.option-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--green) 15%, transparent);
  color: var(--green);
  font-size: 8.5px;
  font-weight: 700;
}

.option-desc {
  color: var(--muted);
  font-size: 10px;
  line-height: 1.42;
}

.custom-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 9px 0 11px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--card);
}

.custom-row.is-active {
  border-color: color-mix(in srgb, var(--accent) 52%, transparent);
}

.custom-icon {
  flex: 0 0 auto;
  color: var(--faint);
  font-size: 12px;
}

.custom-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: 11.5px;
  outline: none;
}

.custom-input::placeholder {
  color: var(--faint);
}

.custom-send {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}

.custom-send:disabled {
  opacity: 0.36;
}

.question-footer {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 16px;
}

.skip {
  padding: 0;
  color: var(--faint);
  font-size: 9.5px;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.skip:hover:not(:disabled) {
  color: var(--muted);
}

.skip-note {
  color: var(--amber);
  font-size: 9px;
}

.sheet-error {
  margin: 0;
  padding: 9px 11px;
  border: 1px solid color-mix(in srgb, var(--red) 32%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--red) 10%, transparent);
  color: var(--red);
  font-size: 10.5px;
  line-height: 1.45;
}

.sheet-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 20px 14px;
  border-top: 1px solid var(--line);
  background: var(--card-3);
}

.sheet-hint {
  color: var(--muted);
  font-size: 9.5px;
  line-height: 1.4;
}

.sheet-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.btn {
  min-height: 34px;
  padding: 0 13px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}

.btn.ghost {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
}

.btn.ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--line-strong);
}

.btn.primary {
  background: var(--accent);
  color: #fff;
}

.btn:disabled {
  opacity: 0.45;
}

@keyframes sheet-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes sheet-rise {
  from { opacity: 0; transform: translateY(10px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (max-height: 700px) {
  .sheet { max-height: 94vh; }
  .sheet-head { padding: 14px 16px 11px; }
  .sheet-body { padding: 12px 16px 14px; gap: 12px; }
  .sheet-foot { padding: 10px 16px 12px; }
}

@media (orientation: portrait) {
  .sheet-layer { padding: 10px; }
  .sheet { width: 100%; max-height: 92vh; border-radius: 20px; }
  .sheet-heading h2 { font-size: 17px; }
  .question-detail { max-height: 150px; }
  .sheet-foot { flex-wrap: wrap; }
  .sheet-actions { width: 100%; }
  .sheet-actions .btn { flex: 1; }
}
</style>
