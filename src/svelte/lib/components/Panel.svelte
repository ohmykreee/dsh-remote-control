<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Card } from '$lib/components/ui/card/index.js';
  import { cn } from '$lib/utils.js';

  let {
    class: className = '',
    children,
  }: {
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<Card
  class={cn(
    'gap-0 rounded-[26px] border border-border bg-card py-0 text-card-foreground shadow-none ring-0 [--card-spacing:0px]',
    className,
  )}
>
  {@render children?.()}
</Card>
