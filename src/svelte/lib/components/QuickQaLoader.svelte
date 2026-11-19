<script lang="ts">
  let { compact = false }: { compact?: boolean } = $props();
</script>

<div class="quickqa-loader" class:is-compact={compact} aria-hidden="true">
  <span class="quickqa-loader-row">
    <span class="quickqa-loader-bar is-left"></span>
    <span class="quickqa-loader-bar is-right"></span>
  </span>
  <span class="quickqa-loader-row">
    <span class="quickqa-loader-bar is-left"></span>
    <span class="quickqa-loader-bar is-right"></span>
  </span>
</div>

<style>
  .quickqa-loader {
    --loader-width: 43.2px;
    --loader-height: 7.8px;
    --loader-gap: 3.6px;
    --loader-wide: 27.6px;
    --loader-narrow: 8.4px;
    display: inline-flex;
    flex: 0 0 auto;
    flex-direction: column;
    gap: var(--loader-gap);
    width: var(--loader-width);
    height: calc(var(--loader-height) * 2 + var(--loader-gap));
  }

  .quickqa-loader.is-compact {
    --loader-width: 32.4px;
    --loader-height: 4.8px;
    --loader-gap: 2.4px;
    --loader-wide: 20.4px;
    --loader-narrow: 6px;
  }

  .quickqa-loader-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: var(--loader-height);
  }

  .quickqa-loader-bar {
    flex: 0 0 auto;
    height: 100%;
    width: var(--loader-narrow);
    border-radius: 999px;
    will-change: width;
    animation-duration: 0.7s;
    animation-timing-function: cubic-bezier(0.65, 0, 0.35, 1);
    animation-iteration-count: infinite;
    animation-direction: alternate;
  }

  .quickqa-loader-row:first-child .is-left,
  .quickqa-loader-row:last-child .is-right {
    background: var(--primary);
  }

  .quickqa-loader-row:first-child .is-right,
  .quickqa-loader-row:last-child .is-left {
    background: var(--brand);
  }

  .quickqa-loader-row:first-child .is-left,
  .quickqa-loader-row:last-child .is-right {
    animation-name: quickqa-loader-expand;
  }

  .quickqa-loader-row:first-child .is-right,
  .quickqa-loader-row:last-child .is-left {
    animation-name: quickqa-loader-shrink;
  }

  @keyframes quickqa-loader-expand {
    from { width: var(--loader-narrow); }
    to { width: var(--loader-wide); }
  }

  @keyframes quickqa-loader-shrink {
    from { width: var(--loader-wide); }
    to { width: var(--loader-narrow); }
  }

  /* Reduced motion holds the first frame of the oscillation: the bars that
     would expand keep their starting width and the ones that would shrink keep
     theirs. `animation-name: none` has to sit on the same selectors that name
     the animation — the base rules are more specific than `.quickqa-loader-bar`
     and would otherwise win. */
  @media (prefers-reduced-motion: reduce) {
    .quickqa-loader-row:first-child .is-left,
    .quickqa-loader-row:last-child .is-right {
      animation-name: none;
      width: var(--loader-narrow);
    }

    .quickqa-loader-row:first-child .is-right,
    .quickqa-loader-row:last-child .is-left {
      animation-name: none;
      width: var(--loader-wide);
    }
  }
</style>
