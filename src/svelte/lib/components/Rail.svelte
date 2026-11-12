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

<style>
.rail {
width: 86px;
  flex: 0 0 86px;
  height: 100%;
  padding: 22px 0 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  background: color-mix(in srgb, var(--rail) 94%, transparent);
  border-right: 1px solid var(--line);
}

.rail-top {
display: flex;
  flex-direction: column;
  gap: 10px;
}

.rail-button {
position: relative;
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  color: var(--faint);
  transition: transform 0.15s ease;
}

.rail-badge {
position: absolute;
  top: 8px;
  right: 9px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--rail);
  background: var(--amber);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--amber) 12%, transparent);
}

.rail-badge.is-error {
background: var(--red);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--red) 14%, transparent);
}

.rail-button :global(svg) {
width: 23px;
  height: 23px;
}

.rail-button.is-active {
color: #fff;
  background: linear-gradient(145deg, var(--accent), color-mix(in srgb, var(--accent) 62%, #13204c));
  box-shadow: 0 12px 28px color-mix(in srgb, var(--accent) 30%, transparent);
}

:global(body[data-theme="light"]) .rail-button.is-active {
color: #fff;
}

.rail-button:active {
transform: scale(0.94);
}

.rail-bottom {
display: flex;
  flex-direction: column;
  align-items: center;
  gap: 13px;
}

.rail-utility {
width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: var(--faint);
}

.rail-utility :global(svg) {
width: 18px;
  height: 18px;
}

.connection-dot {
width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--green) 13%, transparent);
  transition: background 0.2s ease, box-shadow 0.2s ease;
}

.connection-dot.is-offline {
background: var(--red);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--red) 13%, transparent);
}

/* Placement variants driven by `.app.nav-*` in App.svelte. */
:global(.app.nav-right) .rail {
  border-right: 0;
  border-left: 1px solid var(--line);
}

:global(.app.nav-top) .rail,
:global(.app.nav-bottom) .rail {
  width: 100%;
  flex: 0 0 auto;
  flex-basis: auto;
  height: auto;
  padding: 8px 16px;
  flex-direction: row;
  justify-content: space-between;
  border-right: 0;
}

:global(.app.nav-top) .rail {
  border-bottom: 1px solid var(--line);
}

:global(.app.nav-bottom) .rail {
  border-top: 1px solid var(--line);
}

:global(.app.nav-top) .rail-top,
:global(.app.nav-bottom) .rail-top {
  flex-direction: row;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}

:global(.app.nav-top) .rail-bottom,
:global(.app.nav-bottom) .rail-bottom {
  flex-direction: row;
  gap: 12px;
}

:global(.app.nav-top) .rail-button,
:global(.app.nav-bottom) .rail-button {
  width: 46px;
  height: 46px;
  border-radius: 15px;
}

:global(.app.nav-top) .rail-button :global(svg),
:global(.app.nav-bottom) .rail-button :global(svg) {
  width: 21px;
  height: 21px;
}

@media (max-height: 760px) {
  .rail {
    width: 74px;
    flex-basis: 74px;
    padding: 14px 0 14px;
  }
  .rail-top {
    gap: 6px;
  }
  .rail-button {
    width: 48px;
    height: 48px;
    border-radius: 15px;
  }
  .rail-button :global(svg) {
    width: 21px;
    height: 21px;
  }
}

@media (orientation: portrait) {
  .rail {
    width: 74px;
    flex-basis: 74px;
  }
  .rail-button {
    width: 48px;
    height: 48px;
  }
}
</style>
