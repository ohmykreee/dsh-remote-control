<script lang="ts">
  import { app } from '../state.svelte';
  import { appGradient, appInitial, timeAgo } from '../format';
  import EmptyState from './EmptyState.svelte';

  const notifications = $derived(app.notifications);
  const list = $derived(Array.isArray(notifications?.notifications) ? notifications.notifications : []);
  const unavailable = $derived(notifications?.available === false);
</script>

<article class="card notifications-card">
  <header class="card-header">
    <div><span class="kicker">NOTIFICATIONS</span><h2>通知</h2></div>
    <span class="count-pill">{list.length}</span>
  </header>
  <div class="notification-list">
    {#if notifications === null}
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
      <div class="skeleton-row"></div>
    {:else if unavailable}
      <EmptyState icon="cloud" title="通知不可用" text={notifications?.reason || '当前系统无法读取通知'} />
    {:else if list.length === 0}
      <EmptyState icon="cloud" title="暂无通知" text="新的系统通知会出现在这里。" />
    {:else}
      {#each list as item, index (item.id || `${item.appKey}-${item.receivedAt}-${index}`)}
        <div class="notification-row">
          <div
            class="notification-avatar"
            style={`background:${item.avatar ? 'transparent' : appGradient(item.appKey)}`}
          >
            {#if item.avatar}
              <img src={item.avatar} alt="" loading="lazy">
            {:else}
              {appInitial(item.appName, item.title)}
            {/if}
          </div>
          <div class="notification-body">
            <span class="notification-app">{item.appName || '通知'}</span>
            <p class="notification-title">{item.title || ''}</p>
            {#if item.body}<p class="notification-text">{item.body}</p>{/if}
          </div>
          <span class="notification-time">{timeAgo(item.receivedAt, app.clockNow)}</span>
        </div>
      {/each}
    {/if}
  </div>
</article>
