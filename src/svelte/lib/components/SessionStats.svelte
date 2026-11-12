<script lang="ts">
  import type { SessionItem } from '../types';

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

{#snippet stat(value: number, label: string, className: string)}
  <div class="stat {className}"><strong>{value}</strong><span>{label}</span></div>
{/snippet}

<article class="card status-card">
  {@render stat(counts.running, '运行中', '')}
  {@render stat(counts.question, '等待回答', counts.question > 0 ? 'is-question' : '')}
  {@render stat(counts.error, '错误', counts.error > 0 ? 'is-error' : '')}
  {@render stat(counts.done, '已结束', '')}
</article>
