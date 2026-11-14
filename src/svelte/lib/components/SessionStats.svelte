<script lang="ts">
  import type { SessionItem } from '../types';
  import { t } from '../i18n.svelte';
  import { cn } from '$lib/utils.js';
  import Panel from './Panel.svelte';

  let { sessions = [] }: { sessions?: SessionItem[] } = $props();

  const counts = $derived.by(() => {
    const result = { running: 0, question: 0, error: 0, done: 0 };
    for (const session of sessions) {
      const key = session.status;
      if (key && key in result) result[key as keyof typeof result] += 1;
    }
    return result;
  });
</script>

{#snippet stat(value: number, label: string, tone: string)}
  <div class={cn('stat', tone)}>
    <strong class="numeric">{value}</strong>
    <span>{label}</span>
  </div>
{/snippet}

<Panel class="status-panel grid min-h-0 grid-cols-2 grid-rows-2 gap-1.5 p-2">
  {@render stat(counts.running, t('statusRunning'), 'is-running')}
  {@render stat(counts.question, t('statusQuestion'), counts.question > 0 ? 'is-question' : '')}
  {@render stat(counts.error, t('statusError'), counts.error > 0 ? 'is-error' : '')}
  {@render stat(counts.done, t('statusDone'), '')}
</Panel>

<style>
  .stat {
    display: flex;
    min-height: 0;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    padding: 6px 3px;
    border: 1px solid transparent;
    border-radius: 13px;
    background: color-mix(in srgb, var(--secondary) 52%, transparent);
  }

  .stat strong {
    color: var(--foreground);
    font-size: clamp(36px, 4.6vw, 46px);
    font-weight: 560;
    line-height: 1;
    letter-spacing: -0.03em;
  }

  .stat span {
    color: var(--muted-foreground);
    font-size: clamp(13px, 1.6vw, 16px);
    white-space: nowrap;
  }

  .stat.is-running strong {
    color: var(--success);
  }

  .stat.is-question {
    border-color: color-mix(in srgb, var(--warn) 20%, transparent);
    background: var(--warn-soft);
  }

  .stat.is-question strong {
    color: var(--warn);
  }

  .stat.is-error {
    border-color: color-mix(in srgb, var(--danger) 20%, transparent);
    background: var(--danger-soft);
  }

  .stat.is-error strong {
    color: var(--danger);
  }

  @media (max-height: 760px) {
    .stat strong {
      font-size: 36px;
    }

    .stat span {
      font-size: 13px;
    }
  }

  @media (orientation: portrait) {
    :global(.status-panel) {
      min-height: 120px;
    }
  }
</style>
