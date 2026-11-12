<script lang="ts">
  import { app } from '../state.svelte';
  import type { PageKey } from '../types';
  import { PAGE_ICONS, PAGE_LABELS } from '../pages';
  import Icon from './Icon.svelte';

  let {
    order,
    activeKey,
    questionCount = 0,
    errorCount = 0,
    onNavigate,
    onFullscreen,
  }: {
    order: PageKey[];
    activeKey: PageKey;
    questionCount?: number;
    errorCount?: number;
    onNavigate: (key: PageKey) => void;
    onFullscreen: () => void;
  } = $props();

  const connectionTitle = $derived(app.online === false ? '连接中断' : app.online === true ? '已连接' : '连接中');
  const fullscreenTitle = $derived(app.fullscreen ? '退出全屏' : '进入全屏');
</script>

<aside class="rail" aria-label="页面">
  <div class="rail-top">
    {#each order as key (key)}
      <button
        class="rail-button"
        class:is-active={activeKey === key}
        type="button"
        data-key={key}
        aria-label={PAGE_LABELS[key]}
        title={PAGE_LABELS[key]}
        onclick={() => onNavigate(key)}
      >
        <Icon name={PAGE_ICONS[key]} />
        {#if key === 'sessions' && questionCount + errorCount > 0}
          <span class="rail-badge" class:is-error={errorCount > 0}></span>
        {/if}
      </button>
    {/each}
  </div>
  <div class="rail-bottom">
    <button
      class="rail-utility"
      type="button"
      aria-label={fullscreenTitle}
      title={fullscreenTitle}
      onclick={onFullscreen}
    ><Icon name={app.fullscreen ? 'compress' : 'expand'} /></button>
    <span
      class="connection-dot"
      class:is-offline={app.online === false}
      title={connectionTitle}
      aria-label={connectionTitle}
    ></span>
  </div>
</aside>
