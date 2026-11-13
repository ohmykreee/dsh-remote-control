<script lang="ts">
  import type { Component } from 'svelte';
  import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
  } from '$lib/components/ui/empty/index.js';
  import { cn } from '$lib/utils.js';
  import Inbox from '@lucide/svelte/icons/inbox';

  let {
    icon: Icon = Inbox,
    title = '',
    text = '',
    class: className = '',
  }: {
    icon?: Component<{ class?: string; strokeWidth?: number }>;
    title?: string;
    text?: string;
    class?: string;
  } = $props();
</script>

<Empty class={cn('gap-4 border-0 p-6 text-center', className)}>
  <EmptyMedia variant="icon" class="mb-0 size-14 rounded-[16px] border border-border bg-secondary text-brand">
    <Icon class="size-[26px]" strokeWidth={1.7} />
  </EmptyMedia>
  <EmptyHeader class="max-w-none gap-1.5">
    <EmptyTitle class="text-[20px] font-medium text-foreground">{title}</EmptyTitle>
    {#if text}<EmptyDescription class="text-[15px] leading-relaxed">{text}</EmptyDescription>{/if}
  </EmptyHeader>
</Empty>
