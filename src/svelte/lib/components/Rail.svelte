<script lang="ts">
  import type { Component } from 'svelte';
  import { app } from '../state.svelte';
  import type { PageKey } from '../types';
  import { pageLabel, t } from '../i18n.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { cn } from '$lib/utils.js';
  import House from '@lucide/svelte/icons/house';
  import Layers3 from '@lucide/svelte/icons/layers-3';
  import Music2 from '@lucide/svelte/icons/music-2';
  import Cpu from '@lucide/svelte/icons/cpu';
  import Maximize2 from '@lucide/svelte/icons/maximize-2';
  import Minimize2 from '@lucide/svelte/icons/minimize-2';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';

  let {
    order,
    activeKey,
    questionCount = 0,
    errorCount = 0,
    timerAlert = false,
    onNavigate,
    onFullscreen,
    onRefresh,
  }: {
    order: PageKey[];
    activeKey: PageKey;
    questionCount?: number;
    errorCount?: number;
    /** Pomodoro or countdown is ringing; mirrors the page-tab indicator. */
    timerAlert?: boolean;
    onNavigate: (key: PageKey) => void;
    onFullscreen: () => void;
    onRefresh: () => void;
  } = $props();

  const icons: Record<PageKey, Component<{ class?: string; strokeWidth?: number }>> = {
    home: House,
    sessions: Layers3,
    music: Music2,
    performance: Cpu,
  };

  const fullscreenTitle = $derived(app.fullscreen ? t('fullscreenExit') : t('fullscreenEnter'));
</script>

<aside class="rail" aria-label={t('navLabel')}>
  <nav class="rail-nav" aria-label={t('pagesLabel')}>
    {#each order as key (key)}
      {@const Icon = icons[key]}
      <Button
        variant="ghost"
        size="icon"
        class={cn(
          'rail-button relative size-[44px] rounded-[13px] text-muted-foreground',
          activeKey === key && 'is-active bg-primary text-primary-foreground',
        )}
        type="button"
        data-key={key}
        aria-label={pageLabel(key)}
        aria-current={activeKey === key ? 'page' : undefined}
        title={pageLabel(key)}
        onclick={() => onNavigate(key)}
      >
        <Icon class="size-[21px]" strokeWidth={1.7} />
        {#if key === 'sessions' && questionCount + errorCount > 0}
          <span
            class="rail-badge"
            class:is-error={errorCount > 0}
            aria-label={errorCount > 0 ? t('errorSessions') : t('pendingQuestions')}
          ></span>
        {/if}
        {#if key === 'home' && timerAlert}
          <span class="rail-badge is-timer" aria-label={t('timerAlert')}></span>
        {/if}
      </Button>
    {/each}
  </nav>

  <div class="rail-bottom">
    <Button
      variant="ghost"
      size="icon"
      class="rail-utility size-10 rounded-[12px] text-muted-foreground"
      type="button"
      aria-label={t('refreshPage')}
      title={t('refreshPage')}
      onclick={onRefresh}
    >
      <RefreshCw class="size-[20px]" strokeWidth={1.7} />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      class="rail-utility size-10 rounded-[12px] text-muted-foreground"
      type="button"
      aria-label={fullscreenTitle}
      title={fullscreenTitle}
      onclick={onFullscreen}
    >
      {#if app.fullscreen}
        <Minimize2 class="size-[20px]" strokeWidth={1.7} />
      {:else}
        <Maximize2 class="size-[20px]" strokeWidth={1.7} />
      {/if}
    </Button>
  </div>
</aside>

<style>
  .rail {
    flex: 0 0 56px;
    width: 56px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 9px 6px;
    border: 1px solid var(--border);
    border-radius: 20px;
    background: color-mix(in srgb, var(--card) 94%, transparent);
    box-shadow: 0 18px 44px rgb(0 0 0 / 12%);
  }

  .rail-nav {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  :global(.rail-button) {
    flex: 0 0 auto;
  }

  :global(.rail-button svg) {
    width: 21px;
    height: 21px;
  }

  :global(.rail-button.is-active) {
    border: 1px solid color-mix(in srgb, var(--brand) 26%, transparent);
    box-shadow: 0 7px 18px rgb(29 55 148 / 20%);
  }

  /* The rail is a static tab strip: no hover feedback on desktop pointers. */
  :global(.rail-button:hover),
  :global(.rail-utility:hover) {
    background: transparent !important;
    color: var(--muted-foreground) !important;
  }

  :global(.rail-button.is-active:hover) {
    background: var(--primary) !important;
    color: var(--primary-foreground) !important;
  }

  .rail-badge {
    position: absolute;
    top: 7px;
    right: 7px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--warn);
    box-shadow: 0 0 0 2px var(--card);
  }

  .rail-badge.is-error {
    background: var(--danger);
  }

  .rail-badge.is-timer {
    background: var(--success);
  }

  .rail-bottom {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  :global(.app-shell.nav-top) .rail,
  :global(.app-shell.nav-bottom) .rail {
    flex: 0 0 auto;
    width: 100%;
    min-height: auto;
    flex-direction: row;
    padding: 7px 10px;
    border-radius: 18px;
  }

  :global(.app-shell.nav-top) .rail-nav,
  :global(.app-shell.nav-bottom) .rail-nav {
    flex-direction: row;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  :global(.app-shell.nav-top) .rail-bottom,
  :global(.app-shell.nav-bottom) .rail-bottom {
    flex-direction: row;
    gap: 8px;
  }

  :global(.app-shell.nav-top .rail-button),
  :global(.app-shell.nav-bottom .rail-button) {
    width: 42px;
    height: 42px;
    border-radius: 12px;
  }
</style>
