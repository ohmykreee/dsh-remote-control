<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    icon = 'cloud',
    title = '',
    text = '',
    className = '',
  }: { icon?: string; title?: string; text?: string; className?: string } = $props();
</script>

<div class="empty-state {className}">
  <Icon name={icon} />
  <h3>{title}</h3>
  {#if text}<p>{text}</p>{/if}
</div>
