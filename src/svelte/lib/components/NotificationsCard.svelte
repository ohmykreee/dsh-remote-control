<script lang="ts">
  import { app } from '../state.svelte';
  import { appGradient, appInitial, timeAgo } from '../format';
  import { t } from '../i18n.svelte';
  import {
    Avatar,
    AvatarFallback,
    AvatarImage,
  } from '$lib/components/ui/avatar/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
  import { Skeleton } from '$lib/components/ui/skeleton/index.js';
  import Bell from '@lucide/svelte/icons/bell';
  import BellOff from '@lucide/svelte/icons/bell-off';
  import Panel from './Panel.svelte';
  import SectionHeader from './SectionHeader.svelte';
  import EmptyState from './EmptyState.svelte';

  const notifications = $derived(app.notifications);
  const list = $derived(Array.isArray(notifications?.notifications) ? notifications.notifications : []);
  const unavailable = $derived(notifications?.available === false);
</script>

<Panel class="notifications-card flex min-h-0 flex-col p-4">
  <SectionHeader icon={Bell} eyebrow="ALERTS" title={t('notifications')} class="mb-3">
    {#snippet children()}
      <Badge
        variant="outline"
        class="h-7 min-w-7 justify-center border-border bg-secondary px-2.5 text-[14px] font-semibold text-muted-foreground"
      >
        {list.length}
      </Badge>
    {/snippet}
  </SectionHeader>

  <div class="hairline-top pt-2"></div>

  {#if notifications === null}
    <div class="flex flex-col gap-2 pt-1">
      {#each Array(5) as _, index (index)}
        <div class="flex items-center gap-3 rounded-[14px] p-2.5">
          <Skeleton class="size-11 shrink-0 rounded-[13px]" />
          <div class="flex-1 space-y-2">
            <Skeleton class="h-3 w-20" />
            <Skeleton class="h-4 w-4/5" />
            <Skeleton class="h-3 w-3/5" />
          </div>
        </div>
      {/each}
    </div>
  {:else if unavailable}
    <div class="flex min-h-0 flex-1 items-center justify-center">
      <EmptyState icon={BellOff} title={t('notificationsUnavailable')} text={t('tryLater')} />
    </div>
  {:else if list.length === 0}
    <div class="flex min-h-0 flex-1 items-center justify-center">
      <EmptyState icon={BellOff} title={t('noNotifications')} text={t('noNotificationsHint')} />
    </div>
  {:else}
    <ScrollArea class="-mx-1 min-h-0 flex-1" scrollbarYClasses="mr-0.5 w-2">
      <div class="flex flex-col gap-1 pb-1 pr-1">
        {#each list as item, index (item.id || `${item.appKey}-${item.receivedAt}-${index}`)}
          <div class="notification-row flex gap-3 rounded-[15px] px-2 py-2.5">
            <Avatar class="mt-0.5 size-11 shrink-0 rounded-[13px] after:rounded-[13px]">
              {#if item.avatar}
                <AvatarImage src={item.avatar} alt="" class="rounded-[13px]" />
              {/if}
              <AvatarFallback
                class="rounded-[13px] text-[16px] font-semibold text-white ring-1 ring-white/10 ring-inset"
                style={`background:${appGradient(item.appKey)}`}
              >
                {appInitial(item.appName, item.title)}
              </AvatarFallback>
            </Avatar>

            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-3">
                <span class="truncate text-[14px] font-semibold tracking-[0.03em] text-brand">
                  {item.appName || t('notificationFallback')}
                </span>
                <span class="shrink-0 text-[13px] text-muted-foreground">
                  {timeAgo(item.receivedAt, app.clockNow)}
                </span>
              </div>
              <p class="mt-0.5 line-clamp-2 text-[18px] leading-snug font-medium text-foreground">
                {item.title || ''}
              </p>
              {#if item.body}
                <p class="mt-1 line-clamp-2 text-[15px] leading-snug text-muted-foreground">{item.body}</p>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </ScrollArea>
  {/if}
</Panel>

<style>
  .notification-row {
    border: 1px solid transparent;
  }

  @media (orientation: portrait) {
    :global(.notifications-card) {
      min-height: 440px;
    }
  }
</style>
