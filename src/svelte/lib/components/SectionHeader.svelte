<script lang="ts">
  import type { Component, Snippet } from 'svelte';
  import { cn } from '$lib/utils.js';

  let {
    icon: Icon,
    eyebrow,
    title,
    description,
    class: className = '',
    children: actions,
  }: {
    icon?: Component<{ class?: string; strokeWidth?: number }>;
    eyebrow?: string;
    title: string;
    description?: string;
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<div class={cn('flex items-start justify-between gap-4', className)}>
  <div class="flex min-w-0 items-center gap-3">
    {#if Icon}
      <span class="grid size-11 shrink-0 place-items-center rounded-[13px] border border-border bg-secondary text-brand">
        <Icon class="size-[23px]" strokeWidth={1.8} />
      </span>
    {/if}
    <div class="min-w-0">
      {#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}
      <h2 class="mt-1 truncate text-[24px] leading-tight font-semibold tracking-[-0.025em] text-foreground">
        {title}
      </h2>
      {#if description}<p class="mt-1 truncate text-[15px] text-muted-foreground">{description}</p>{/if}
    </div>
  </div>
  {#if actions}
    <div class="shrink-0">{@render actions()}</div>
  {/if}
</div>
