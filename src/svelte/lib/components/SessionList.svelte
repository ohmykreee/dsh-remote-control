<script lang="ts">
  import { app } from '../state.svelte';
  import type { SessionItem } from '../types';
  import { timeAgo } from '../format';
  import EmptyState from './EmptyState.svelte';

  let { sessions = [], error = null }: { sessions?: SessionItem[]; error?: string | null } = $props();

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

  function metaOf(session: SessionItem): string[] {
    return [
      session.cwd,
      session.turn ? `第 ${session.turn} 轮` : '',
      session.isSubagent ? '子任务' : '',
    ].filter((item): item is string => Boolean(item));
  }
</script>

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
      {#each sessions as session, index (session.title || index)}
        {@const status = statusOf(session)}
        <article class="session-card is-{status}">
          <div class="session-icon">{Array.from(session.title || '新')[0] || '新'}</div>
          <div class="session-main">
            <h3 class="session-title">{session.title || '新会话'}</h3>
            <p class="session-preview">{previewOf(session)}</p>
            <div class="session-meta">
              {#each metaOf(session) as item, metaIndex (metaIndex)}<span>{item}</span>{/each}
            </div>
          </div>
          <div class="session-side">
            <span class="status-badge is-{status}"><i></i>{labels[status]}</span>
            <span class="session-time">{timeAgo(session.lastActiveAt, app.clockNow)}</span>
          </div>
        </article>
      {/each}
    {/if}
  </div>
</section>
