<script lang="ts">
  import { app, openQuestion } from '../state.svelte';
  import type { SessionItem } from '../types';
  import { runningDuration, timeAgo } from '../format';
  import { t } from '../i18n.svelte';
  import { buildSessionTree, type SessionNode } from '../session-tree';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Card } from '$lib/components/ui/card/index.js';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { Skeleton } from '$lib/components/ui/skeleton/index.js';
  import { cn } from '$lib/utils.js';
  import Layers3 from '@lucide/svelte/icons/layers-3';
  import MessageCircle from '@lucide/svelte/icons/message-circle';
  import MessagesSquare from '@lucide/svelte/icons/messages-square';
  import Panel from './Panel.svelte';
  import SectionHeader from './SectionHeader.svelte';
  import EmptyState from './EmptyState.svelte';

  let { sessions = [], error = null }: { sessions?: SessionItem[]; error?: string | null } = $props();

  const tree = $derived(buildSessionTree(sessions));
  const subtitle = $derived(
    app.overview === null
      ? t('sessionLoading')
      : sessions.length === 1
        ? t('sessionCountOne')
        : sessions.length
          ? t('sessionCount', { count: sessions.length })
          : t('noActiveSessions'),
  );
  const labels = $derived<Record<string, string>>({
    running: t('statusRunning'),
    question: t('statusQuestion'),
    error: t('statusError'),
    done: t('statusDone'),
  });
  const statusClasses: Record<string, string> = {
    running: 'status-success',
    question: 'status-warn',
    error: 'status-danger',
    done: 'border-border bg-secondary text-muted-foreground',
  };

  function statusOf(session: SessionItem): string {
    return session.status && ['running', 'question', 'error', 'done'].includes(session.status)
      ? session.status
      : 'done';
  }

  function previewOf(session: SessionItem): string {
    return session.error || session.pending?.question || session.preview || t('noMessage');
  }

  function runningSinceOf(session: SessionItem): number | null {
    const value = session.runningSince;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function isWaiting(session: SessionItem): boolean {
    return statusOf(session) === 'question';
  }

  function canQuickAnswer(session: SessionItem): boolean {
    return (
      isWaiting(session) &&
      app.pushQuestions &&
      session.pending?.answerable !== false &&
      (session.pending?.questions?.length ?? 0) > 0
    );
  }

  function openSession(session: SessionItem): void {
    if (!isWaiting(session) || !session.id) return;
    openQuestion(session.id);
  }

  function openSessionFromKey(event: KeyboardEvent, session: SessionItem): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openSession(session);
  }

  function metaOf(session: SessionItem, depth: number): string[] {
    return [
      session.turn ? t('turnLabel', { turn: session.turn }) : '',
      session.isSubagent && depth === 0 ? t('subagent') : '',
    ].filter((item): item is string => Boolean(item));
  }
</script>

{#snippet sessionNode(node: SessionNode, depth: number)}
  {@const session = node.session}
  {@const status = statusOf(session)}
  {@const runningSince = runningSinceOf(session)}
  <Card
    class={cn(
      'session-card gap-0 rounded-[18px] border bg-card px-3.5 py-3 shadow-none ring-0 [--card-spacing:0px]',
      status === 'running' && 'border-success/20',
      status === 'question' && 'border-warn/25',
      status === 'error' && 'border-danger/25',
      isWaiting(session) && 'cursor-pointer',
      depth > 0 && 'is-subagent bg-surface-2/60',
    )}
    role={isWaiting(session) ? 'button' : undefined}
    tabindex={isWaiting(session) ? 0 : undefined}
    aria-label={isWaiting(session) ? t('answerSession', { title: session.title || t('newSession') }) : undefined}
    onclick={() => openSession(session)}
    onkeydown={(event) => openSessionFromKey(event, session)}
  >
    <div class="flex min-w-0 items-start gap-3">
      <span class={cn('session-icon', `tone-${status}`)} aria-hidden="true">
        {Array.from(session.title || t('newSession'))[0] || '?'}
        <i></i>
      </span>

      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-2.5">
          <h3 class="session-title min-w-0 pt-0.5 text-[21px] leading-snug font-semibold text-foreground">
            {session.title || t('newSession')}
          </h3>
          <Badge
            variant="outline"
            class={cn(
              'mt-0.5 h-8 shrink-0 gap-1.5 rounded-full border px-3 text-[13px] font-semibold',
              statusClasses[status],
            )}
          >
            <span class="status-dot"></span>
            {labels[status]}
          </Badge>
        </div>

        <p class="session-preview mt-1 line-clamp-2 text-[15px] leading-snug text-muted-foreground">
          {previewOf(session)}
        </p>

        <div class="mt-2 flex min-w-0 items-center justify-between gap-3">
          <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {#if session.error}
              <span class="text-[13px] font-medium text-danger">{t('needsAttention')}</span>
            {:else}
              {#each metaOf(session, depth) as item, metaIndex (metaIndex)}
                <span class="text-[13px] text-muted-foreground">{item}</span>
              {/each}
            {/if}
            {#if canQuickAnswer(session)}
              <span class="inline-flex items-center gap-1.5 text-[13px] font-semibold text-warn">
                <MessageCircle class="size-4" strokeWidth={1.8} />
                {t('answer')}
              </span>
            {/if}
          </div>

          {#if runningSince !== null}
            <span class="numeric shrink-0 text-[13px] font-semibold text-success">
              {runningDuration(runningSince, app.clockNow)}
            </span>
          {:else}
            <span class="shrink-0 text-[13px] text-muted-foreground">
              {timeAgo(session.lastActiveAt, app.clockNow)}
            </span>
          {/if}
        </div>
      </div>
    </div>

    {#if node.children.length > 0}
      <div class="session-children">
        <div class="mb-2 flex items-center gap-2 text-[13px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
          {t('subagent')}
          <span class="h-px flex-1 bg-border"></span>
          {node.children.length}
        </div>
        {#each node.children as child (child.session.id || child.session.title)}
          {@render sessionNode(child, depth + 1)}
        {/each}
      </div>
    {/if}
  </Card>
{/snippet}

<Panel class="conversation-panel flex min-h-0 flex-col p-4">
  <SectionHeader icon={Layers3} eyebrow="CONVERSATIONS" title={t('conversations')} class="mb-3">
    {#snippet children()}
      <span class="text-[15px] text-muted-foreground">{subtitle}</span>
    {/snippet}
  </SectionHeader>

  <div class="-mx-2 flex min-h-0 flex-1 flex-col border-t border-border pt-3">
    {#if app.overview === null && sessions.length === 0 && !error}
      <div class="flex flex-col gap-2 px-2">
        {#each Array(4) as _, index (index)}
          <div class="rounded-[18px] border border-border px-3.5 py-3">
            <div class="flex items-center gap-3">
              <Skeleton class="size-11 rounded-[13px]" />
              <div class="flex-1 space-y-2">
                <Skeleton class="h-4 w-2/5" />
                <Skeleton class="h-3 w-3/4" />
              </div>
            </div>
          </div>
        {/each}
      </div>
    {:else if error}
      <div class="flex min-h-0 flex-1 items-center justify-center px-6">
        <EmptyState icon={MessagesSquare} title={t('sessionLoadFailed')} text={t('tryLater')} />
      </div>
    {:else if sessions.length === 0}
      <div class="flex min-h-0 flex-1 items-center justify-center px-6">
        <EmptyState icon={MessagesSquare} title={t('noSessions')} text={t('noSessionsHint')} />
      </div>
    {:else}
      <ScrollArea class="min-h-0 flex-1" scrollbarYClasses="w-2">
        <div class="flex flex-col gap-2 px-2 pb-1">
          {#each tree as node (node.session.id || node.session.title)}
            {@render sessionNode(node, 0)}
          {/each}
        </div>
      </ScrollArea>
    {/if}
  </div>
</Panel>

<style>
  :global(.conversation-panel) {
    background:
      radial-gradient(80% 100% at 100% 0%, color-mix(in srgb, var(--brand) 4%, transparent), transparent 60%),
      var(--card);
  }

  .session-card.is-subagent {
    border-radius: 15px;
  }

  .session-icon {
    position: relative;
    display: grid;
    width: 42px;
    height: 42px;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--brand) 16%, transparent);
    border-radius: 12px;
    background: var(--brand-soft);
    color: var(--brand);
    font-size: 16px;
    font-weight: 650;
  }

  .session-icon.tone-running {
    border-color: color-mix(in srgb, var(--success) 18%, transparent);
    background: var(--success-soft);
    color: var(--success);
  }

  .session-icon.tone-question {
    border-color: color-mix(in srgb, var(--warn) 20%, transparent);
    background: var(--warn-soft);
    color: var(--warn);
  }

  .session-icon.tone-error {
    border-color: color-mix(in srgb, var(--danger) 20%, transparent);
    background: var(--danger-soft);
    color: var(--danger);
  }

  .session-icon i {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 10px;
    height: 10px;
    border: 2px solid var(--card);
    border-radius: 50%;
    background: var(--muted-foreground);
  }

  .session-icon.tone-running i {
    background: var(--success);
  }

  .session-icon.tone-question i {
    background: var(--warn);
  }

  .session-icon.tone-error i {
    background: var(--danger);
  }

  .session-icon.tone-done i {
    background: var(--brand);
    opacity: 0.55;
  }

  .session-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.session-card.is-subagent .session-icon) {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    font-size: 14px;
  }

  :global(.session-card.is-subagent .session-title) {
    font-size: 19px;
  }

  .session-card:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--brand) 65%, transparent);
    outline-offset: 2px;
  }

  .status-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
  }

  .session-children {
    display: flex;
    flex-direction: column;
    margin-top: 10px;
    margin-left: 16px;
    padding-left: 12px;
    border-left: 1px solid color-mix(in srgb, var(--brand) 20%, transparent);
  }

  @media (max-height: 760px) {
    :global(.conversation-panel) {
      padding: 12px;
    }

    :global(.session-card) {
      padding: 8px 11px;
    }

    .session-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      font-size: 14px;
    }

    .session-title {
      font-size: 19px;
    }

    .session-preview {
      font-size: 14.5px;
    }
  }

  @media (orientation: portrait) {
    :global(.conversation-panel) {
      min-height: 420px;
    }
  }
</style>
