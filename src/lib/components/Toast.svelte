<script lang="ts">
  import { app } from '../state.svelte';
</script>

{#if app.toastVisible}
  <div class="toast" role="status">{app.toastMessage}</div>
{/if}
