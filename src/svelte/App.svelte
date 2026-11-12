<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { app, exposeState, restoreUrl, startLive, startTicks, stopLive, toast } from './lib/state.svelte';
  import { DEFAULT_ORDER, PAGE_LABELS, enabledOrder, normalizeOrder } from './lib/pages';
  import type { PageKey } from './lib/types';
  import { refreshLive } from './lib/ws';
  import HomePage from './lib/components/HomePage.svelte';
  import MusicPage from './lib/components/MusicPage.svelte';
  import PerformancePage from './lib/components/PerformancePage.svelte';
  import Rail from './lib/components/Rail.svelte';
  import SessionsPage from './lib/components/SessionsPage.svelte';
  import Toast from './lib/components/Toast.svelte';

  interface DisplayPage {
    key: PageKey;
    clone: 'first' | 'last' | null;
    uid: string;
  }

  const order = $derived(enabledOrder(normalizeOrder(app.pageOrder), app.pageEnabled));
  const questionCount = $derived(app.sessions.filter((session) => session.status === 'question').length);
  const errorCount = $derived(app.sessions.filter((session) => session.status === 'error').length);

  const displayPages = $derived.by<DisplayPage[]>(() => {
    const pages: DisplayPage[] = order.map((key) => ({ key, clone: null, uid: `real-${key}` }));
    if (order.length < 2) return pages;
    return [
      { key: order[order.length - 1], clone: 'last', uid: `clone-last-${order[order.length - 1]}` },
      ...pages,
      { key: order[0], clone: 'first', uid: `clone-first-${order[0]}` },
    ];
  });

  let pager: HTMLElement | undefined = $state();
  let jumpTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressScrollUntil = 0;
  let appliedOrderSignature = '';
  let revisionSeen = 0;
  let scrollFrame = 0;

  const params = new URLSearchParams(location.search);
  const pageParam = params.get('page');
  if (pageParam && DEFAULT_ORDER.includes(pageParam as PageKey)) app.initialKey = pageParam as PageKey;

  function pageOffset(): number {
    return order.length > 1 ? 1 : 0;
  }

  function scrollToKey(key: PageKey, smooth = false): void {
    if (!pager) return;
    const index = order.indexOf(key);
    if (index < 0) return;
    const left = (index + pageOffset()) * pager.clientWidth;
    if (smooth) {
      pager.scrollTo({ left, behavior: 'smooth' });
      return;
    }
    pager.scrollLeft = left;
    requestAnimationFrame(() => {
      if (pager) pager.scrollLeft = left;
    });
  }

  function goTo(key: PageKey, smooth = true): void {
    if (!order.includes(key)) return;
    app.hasNavigated = true;
    app.activeKey = key;
    suppressScrollUntil = Date.now() + (smooth ? 620 : 120);
    if (jumpTimer) {
      clearTimeout(jumpTimer);
      jumpTimer = null;
    }
    scrollToKey(key, smooth);
  }

  function applyPageOrder(): void {
    if (revisionSeen === 0) return;
    const signature = order.join('|');
    const same = signature === appliedOrderSignature;
    const previousKey = app.activeKey;
    const initialKey = app.initialKey && order.includes(app.initialKey) ? app.initialKey : null;
    const wanted: PageKey = initialKey ?? (!app.hasNavigated ? order[0] : order.includes(previousKey) ? previousKey : order[0]);
    app.initialKey = null;
    app.hasNavigated = true;
    app.activeKey = wanted;
    appliedOrderSignature = signature;
    if (initialKey || !same || wanted !== previousKey) {
      suppressScrollUntil = Date.now() + 220;
      scrollToKey(wanted, false);
    }
  }

  $effect(() => {
    const revision = app.pageRevision;
    if (revision === revisionSeen) return;
    revisionSeen = revision;
    applyPageOrder();
  });

  $effect(() => {
    document.body.dataset.theme = app.theme;
    document.body.dataset.page = app.activeKey;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', app.theme === 'light' ? '#eef3ff' : '#05070d');
  });

  function scheduleEdgeJump(jumpTo: number, count: number): void {
    if (jumpTimer) clearTimeout(jumpTimer);
    jumpTimer = setTimeout(() => {
      jumpTimer = null;
      if (!pager) return;
      const raw = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
      const stillAtEdge = jumpTo === count ? raw <= 0 : raw >= count + 1;
      if (!stillAtEdge) return;
      pager.style.scrollSnapType = 'none';
      suppressScrollUntil = Date.now() + 220;
      pager.scrollLeft = jumpTo * pager.clientWidth;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (pager) pager.style.scrollSnapType = '';
        });
      });
    }, 150);
  }

  function handleScroll(): void {
    if (!pager) return;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      if (!pager || Date.now() < suppressScrollUntil) return;
      const count = order.length;
      const raw = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
      let key: PageKey | null = null;
      let jumpTo: number | null = null;
      if (count < 2) {
        key = order[0];
      } else if (raw <= 0) {
        key = order[count - 1];
        jumpTo = count;
      } else if (raw >= count + 1) {
        key = order[0];
        jumpTo = 1;
      } else {
        key = order[raw - 1] ?? null;
      }
      if (key && key !== app.activeKey) {
        app.activeKey = key;
        app.hasNavigated = true;
      }
      if (jumpTo !== null) scheduleEdgeJump(jumpTo, count);
      else if (jumpTimer) {
        clearTimeout(jumpTimer);
        jumpTimer = null;
      }
    });
  }

  function handleResize(): void {
    if (!pager) return;
    suppressScrollUntil = Date.now() + 160;
    pager.scrollLeft = (order.indexOf(app.activeKey) + pageOffset()) * pager.clientWidth;
  }

  type FullscreenDocument = Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => Promise<void> | void;
  };
  type FullscreenElement = HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };

  function isFullscreen(): boolean {
    return Boolean(document.fullscreenElement || (document as FullscreenDocument).webkitFullscreenElement);
  }

  function updateFullscreen(): void {
    app.fullscreen = isFullscreen();
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      if (isFullscreen()) {
        const doc = document as FullscreenDocument;
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
      } else {
        const root = document.documentElement as FullscreenElement;
        if (root.requestFullscreen) await root.requestFullscreen();
        else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen();
        else toast('当前浏览器不支持全屏');
      }
    } catch {
      toast('当前浏览器不允许全屏');
    }
    setTimeout(updateFullscreen, 120);
  }

  function handleVisibility(): void {
    if (!document.hidden) refreshLive();
  }

  onMount(() => {
    const stopTicks = startTicks();
    const initial = app.initialKey && order.includes(app.initialKey) ? app.initialKey : order[0];
    app.activeKey = initial;
    appliedOrderSignature = order.join('|');
    void tick().then(() => scrollToKey(initial, false));
    startLive();
    exposeState();
    restoreUrl();
    updateFullscreen();

    document.addEventListener('fullscreenchange', updateFullscreen);
    document.addEventListener('webkitfullscreenchange' as 'fullscreenchange', updateFullscreen);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('resize', handleResize);

    return () => {
      stopTicks();
      stopLive();
      if (jumpTimer) clearTimeout(jumpTimer);
      cancelAnimationFrame(scrollFrame);
      document.removeEventListener('fullscreenchange', updateFullscreen);
      document.removeEventListener('webkitfullscreenchange' as 'fullscreenchange', updateFullscreen);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('resize', handleResize);
    };
  });
</script>

<div class="app">
  <Rail
    {order}
    activeKey={app.activeKey}
    {questionCount}
    {errorCount}
    onNavigate={goTo}
    onFullscreen={toggleFullscreen}
  />

  <main class="pager" bind:this={pager} onscroll={handleScroll}>
    {#each displayPages as item (item.uid)}
      <section
        class="page page-{item.key}"
        class:page-clone={item.clone !== null}
        data-page-key={item.clone ? (item.clone === 'first' ? '__first-clone' : '__last-clone') : item.key}
        data-source-key={item.clone ? item.key : undefined}
        aria-label={PAGE_LABELS[item.key]}
        aria-hidden={item.clone ? 'true' : undefined}
      >
        {#if item.key === 'home'}
          <HomePage />
        {:else if item.key === 'sessions'}
          <SessionsPage />
        {:else if item.key === 'music'}
          <MusicPage />
        {:else if item.key === 'performance'}
          <PerformancePage />
        {/if}
      </section>
    {/each}
  </main>
</div>

{#if app.online === false}
  <div class="offline">
    <span class="offline-dot"></span>
    <span>连接中断，正在重新连接…</span>
  </div>
{/if}

<Toast />
