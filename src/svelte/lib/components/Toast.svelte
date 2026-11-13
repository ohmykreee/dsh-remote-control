<script lang="ts">
  import { app } from '../state.svelte';
  import { Alert } from '$lib/components/ui/alert/index.js';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
</script>

{#if app.toastVisible}
  <div class="toast-layer">
    <Alert class="flex w-auto items-center gap-2.5 rounded-full border-border bg-popover/95 px-4 py-2.5 text-[15px] text-foreground shadow-lg backdrop-blur-md">
      <CircleAlert class="size-[19px] text-brand" strokeWidth={1.8} />
      <span>{app.toastMessage}</span>
    </Alert>
  </div>
{/if}

<style>
  .toast-layer {
    position: fixed;
    z-index: 60;
    bottom: 22px;
    left: 96px;
    max-width: calc(100vw - 124px);
  }

  @media (max-width: 760px) {
    .toast-layer {
      left: 50%;
      transform: translateX(-50%);
      max-width: calc(100vw - 32px);
    }
  }
</style>
