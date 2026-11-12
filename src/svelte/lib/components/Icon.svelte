<script lang="ts">
  import { iconMarkup } from '../icons';

  let { name }: { name: string } = $props();
</script>

<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">{@html iconMarkup(name)}</svg>
