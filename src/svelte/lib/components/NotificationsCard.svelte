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

<style>
.notification-list::-webkit-scrollbar {
display: none;
}

.notifications-card {
display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 24px 22px 18px;
}

.card-header {
display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.card-header {
align-items: center;
  margin-bottom: 12px;
}

.card-header h2 {
margin: 4px 0 0;
  font-size: 25px;
  line-height: 1.05;
  letter-spacing: -0.035em;
  font-weight: 600;
}

.count-pill {
min-width: 32px;
  height: 28px;
  padding: 0 10px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 24%, transparent);
  color: var(--accent-2);
  font-size: 11px;
  font-weight: 650;
}

.notification-list {
flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}

.notification-row {
display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  gap: 11px;
  align-items: center;
  padding: 10px;
  border-radius: 16px;
  border: 1px solid transparent;
  transition: background 0.18s ease, border-color 0.18s ease;
}

.notification-row:hover {
background: color-mix(in srgb, var(--text) 4%, transparent);
  border-color: var(--line);
}

.notification-avatar {
width: 44px;
  height: 44px;
  border-radius: 13px;
  overflow: hidden;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 14px;
  font-weight: 750;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.13);
}

.notification-avatar img {
width: 100%;
  height: 100%;
  object-fit: cover;
}

.notification-body {
min-width: 0;
}

.notification-app {
color: var(--accent-2);
  font-size: 9.5px;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.notification-title {
margin: 2px 0 0;
  font-size: 13px;
  line-height: 1.35;
  font-weight: 580;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.notification-text {
margin: 2px 0 0;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.35;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.notification-time {
align-self: flex-start;
  padding-top: 2px;
  color: var(--faint);
  font-size: 9.5px;
  white-space: nowrap;
}

@media (orientation: portrait) {
  .notifications-card {
    min-height: 460px;
  }
}
</style>
