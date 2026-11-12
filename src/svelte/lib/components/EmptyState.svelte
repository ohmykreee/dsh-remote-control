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

<style>
.empty-state {
margin: 20px 0;
  padding: 46px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed var(--line);
  border-radius: 22px;
  color: var(--muted);
  text-align: center;
}

.empty-state :global(svg) {
width: 30px;
  height: 30px;
  color: var(--faint);
}

.empty-state h3 {
margin: 0;
  color: var(--text);
  font-size: 15px;
  font-weight: 570;
}

.empty-state p {
margin: 0;
  font-size: 11px;
  line-height: 1.5;
}
</style>
