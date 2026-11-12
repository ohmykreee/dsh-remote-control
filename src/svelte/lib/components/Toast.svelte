<script lang="ts">
  import { app } from '../state.svelte';
</script>

{#if app.toastVisible}
  <div class="toast" role="status">{app.toastMessage}</div>
{/if}

<style>
.toast {
position: fixed;
  z-index: 60;
  left: 112px;
  bottom: 22px;
  max-width: calc(100vw - 140px);
  padding: 10px 16px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: color-mix(in srgb, var(--card) 94%, transparent);
  color: var(--text);
  font-size: 11px;
  font-weight: 550;
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
  animation: toast-in 0.2s ease both;
}

@keyframes toast-in {
from { opacity: 0; transform: translateY(7px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (orientation: portrait) {
  .toast {
    left: 88px;
  }
}
</style>
