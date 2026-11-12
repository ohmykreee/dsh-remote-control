<script lang="ts">
  import { app, openQuestion } from '../state.svelte';
  import type { SessionItem } from '../types';
  import { runningDuration, timeAgo } from '../format';
  import { buildSessionTree, type SessionNode } from '../session-tree';
  import EmptyState from './EmptyState.svelte';
  import Icon from './Icon.svelte';

  let { sessions = [], error = null }: { sessions?: SessionItem[]; error?: string | null } = $props();

  const tree = $derived(buildSessionTree(sessions));
  const subtitle = $derived(
    app.overview === null
      ? '正在读取'
      : sessions.length
        ? `${sessions.length} 个活动会话`
        : '暂无活动会话',
  );
  const labels: Record<string, string> = { running: '运行中', question: '等待回答', error: '错误', done: '已结束' };

  function statusOf(session: SessionItem): string {
    return session.status && ['running', 'question', 'error', 'done'].includes(session.status) ? session.status : 'done';
  }

  function previewOf(session: SessionItem): string {
    return session.error || session.pending?.question || session.preview || session.cwd || '暂无消息';
  }

  function runningSinceOf(session: SessionItem): number | null {
    const value = session.runningSince;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function metaOf(session: SessionItem, depth: number): string[] {
    return [
      session.cwd,
      session.turn ? `第 ${session.turn} 轮` : '',
      session.isSubagent && depth === 0 ? '子代理' : '',
    ].filter((item): item is string => Boolean(item));
  }

  function isWaiting(session: SessionItem): boolean {
    return statusOf(session) === 'question';
  }

  function canQuickAnswer(session: SessionItem): boolean {
    return isWaiting(session)
      && app.pushQuestions
      && session.pending?.answerable !== false
      && (session.pending?.questions?.length ?? 0) > 0;
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
</script>

{#snippet sessionNode(node: SessionNode, depth: number)}
  {@const session = node.session}
  {@const status = statusOf(session)}
  {@const runningSince = runningSinceOf(session)}
  <article
    class="session-card is-{status}"
    class:is-subagent={depth > 0}
    class:has-children={node.children.length > 0}
    class:is-clickable={isWaiting(session)}
    style={depth > 0 ? `--session-depth:${Math.min(depth, 4)}` : undefined}
  >
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="session-hit"
      role={isWaiting(session) ? 'button' : undefined}
      tabindex={isWaiting(session) ? 0 : undefined}
      aria-label={isWaiting(session) ? `回答会话 ${session.title || '新会话'}` : undefined}
      onclick={() => openSession(session)}
      onkeydown={(event) => openSessionFromKey(event, session)}
    >
      <div class="session-row">
        <div class="session-icon">{Array.from(session.title || '新')[0] || '新'}</div>
        <div class="session-main">
          <h3 class="session-title">{session.title || '新会话'}</h3>
          <p class="session-preview">{previewOf(session)}</p>
        </div>
        <div class="session-side">
          <span class="status-badge is-{status}"><i></i>{labels[status]}</span>
        </div>
      </div>
      <div class="session-footer">
        <div class="session-meta">
          {#each metaOf(session, depth) as item, metaIndex (metaIndex)}<span>{item}</span>{/each}
        </div>
        <div class="session-footer-end">
          {#if canQuickAnswer(session)}
            <span class="session-answer"><Icon name="chat" /> 点击回答</span>
          {/if}
          {#if runningSince !== null}
            <span class="session-time is-running" title="本轮用时">{runningDuration(runningSince, app.clockNow)}</span>
          {:else}
            <span class="session-time">{timeAgo(session.lastActiveAt, app.clockNow)}</span>
          {/if}
        </div>
      </div>
    </div>
    {#if node.children.length > 0}
      <div class="session-children">
        <div class="session-children-label">子代理 · {node.children.length}</div>
        {#each node.children as child (child.session.id || child.session.title)}
          {@render sessionNode(child, depth + 1)}
        {/each}
      </div>
    {/if}
  </article>
{/snippet}

<section class="conversation-column">
  <header class="section-header">
    <div><span class="kicker">CONVERSATIONS</span><h1>会话</h1></div>
    <span class="section-meta">{subtitle}</span>
  </header>
  <div class="session-list">
    {#if app.overview === null && sessions.length === 0 && !error}
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
    {:else if error}
      <EmptyState icon="layers" title="会话读取失败" text={error} />
    {:else if sessions.length === 0}
      <EmptyState icon="layers" title="暂无会话" text="在 DSH 中开始一个会话后会出现在这里。" />
    {:else}
      {#each tree as node (node.session.id || node.session.title)}
        {@render sessionNode(node, 0)}
      {/each}
    {/if}
  </div>
</section>

<style>
.session-list::-webkit-scrollbar {
display: none;
}

.section-header {
display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.section-header h1 {
margin: 4px 0 0;
  font-size: 25px;
  line-height: 1.05;
  letter-spacing: -0.035em;
  font-weight: 600;
}

.conversation-column {
display: flex;
  flex-direction: column;
  min-height: 0;
}

.section-header {
align-items: flex-end;
  margin: 2px 2px 8px;
}

.section-header h1 {
font-size: 27px;
}

.section-meta {
color: var(--muted);
  font-size: 10px;
}

.session-list {
flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 2px;
}

.session-card {
display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--card);
  transition: border-color 0.18s ease, background 0.18s ease;
}

.session-row {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-width: 0;
}

/* Subagent cards live inside the dispatching agent's card and step right. */
.session-card.is-subagent {
  padding: 8px 10px;
  border-radius: 13px;
  background: color-mix(in srgb, var(--card-2) 76%, transparent);
}

.session-card.is-subagent .session-row {
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 8px;
}

.session-card.is-subagent .session-icon {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  font-size: 12px;
}

.session-card.is-subagent .session-icon::after {
  width: 8px;
  height: 8px;
}

.session-card.is-subagent .session-title {
  font-size: 12.5px;
}

.session-children {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  margin-left: 12px;
  padding-left: 10px;
  border-left: 1px solid color-mix(in srgb, var(--accent) 24%, transparent);
}

.session-children-label {
  color: var(--faint);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.session-time.is-running {
  color: var(--green);
  font-variant-numeric: tabular-nums;
  font-weight: 650;
}

.session-card:hover {
border-color: var(--line-strong);
}

.session-hit {
  border-radius: 12px;
}

.session-card.is-clickable .session-hit {
  cursor: pointer;
}

.session-hit:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
  outline-offset: 2px;
}

.session-card.is-running {
border-color: color-mix(in srgb, var(--green) 22%, transparent);
  background: color-mix(in srgb, var(--green) 9%, var(--card));
}

.session-card.is-question {
border-color: color-mix(in srgb, var(--amber) 38%, transparent);
  background: color-mix(in srgb, var(--amber) 13%, var(--card));
}

.session-card.is-error {
border-color: color-mix(in srgb, var(--red) 38%, transparent);
  background: color-mix(in srgb, var(--red) 13%, var(--card));
}

.session-icon {
width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent-2);
  font-size: 14px;
  font-weight: 680;
  position: relative;
}

.session-card.is-running .session-icon {
color: var(--green); background: color-mix(in srgb, var(--green) 12%, transparent);
}

.session-card.is-question .session-icon {
color: var(--amber); background: color-mix(in srgb, var(--amber) 13%, transparent);
}

.session-card.is-error .session-icon {
color: var(--red); background: color-mix(in srgb, var(--red) 13%, transparent);
}

.session-icon::after {
content: "";
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--card);
  background: var(--faint);
}

.session-card.is-running .session-icon::after {
background: var(--green);
}

.session-card.is-question .session-icon::after {
background: var(--amber);
}

.session-card.is-error .session-icon::after {
background: var(--red);
}

.session-card.is-done .session-icon::after {
background: var(--accent-2); opacity: 0.6;
}

.session-main {
min-width: 0;
}

.session-title {
margin: 0;
  font-size: 13.5px;
  line-height: 1.3;
  font-weight: 590;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.session-preview {
margin: 2px 0 0;
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.32;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.session-meta {
display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  margin: 0;
  color: var(--faint);
  font-size: 9px;
  line-height: 1.3;
}

.session-footer {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-top: 3px;
  padding-left: 48px;
}

.session-footer-end {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  gap: 9px;
}

.session-answer {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--amber) 15%, transparent);
  color: var(--amber);
  font-size: 8.5px;
  font-weight: 650;
  white-space: nowrap;
}

.session-answer :global(svg) {
  width: 10px;
  height: 10px;
}
.session-card.is-subagent .session-footer {
  padding-left: 40px;
}

.session-side {
display: flex;
  align-items: flex-start;
  justify-content: flex-end;
}

.status-badge {
display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 23px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 9.5px;
  font-weight: 600;
  white-space: nowrap;
}

.status-badge i {
width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}

.status-badge.is-running {
color: var(--green); border-color: color-mix(in srgb, var(--green) 22%, transparent); background: color-mix(in srgb, var(--green) 14%, var(--card));
}

.status-badge.is-question {
color: var(--amber); border-color: color-mix(in srgb, var(--amber) 24%, transparent); background: color-mix(in srgb, var(--amber) 16%, var(--card));
}

.status-badge.is-error {
color: var(--red); border-color: color-mix(in srgb, var(--red) 24%, transparent); background: color-mix(in srgb, var(--red) 16%, var(--card));
}

.status-badge.is-done {
color: var(--accent-2); border-color: color-mix(in srgb, var(--accent) 18%, transparent);
}

.session-time {
flex: 0 0 auto;
  color: var(--faint);
  font-size: 9.5px;
  line-height: 1.3;
  text-align: right;
  white-space: nowrap;
}

@media (max-height: 760px) {
  .section-header {
    margin-bottom: 6px;
  }
  .section-header h1 {
    font-size: 24px;
  }
  .session-list {
    gap: 5px;
  }
  .session-card {
    padding: 8px 10px;
    border-radius: 14px;
  }
  .session-icon {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    font-size: 13px;
  }
  .session-title {
    font-size: 13px;
  }
  .session-preview {
    font-size: 10px;
  }
}

@media (orientation: portrait) {
  .conversation-column {
    min-height: 420px;
  }
}
</style>
