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

<style>
.status-card {
display: grid;
  min-height: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 10px;
}

.stat {
display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 8px 4px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--text) 3.5%, transparent);
}

.stat strong {
font-size: 25px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.stat span {
color: var(--faint);
  font-size: 10px;
  white-space: nowrap;
}

.stat.is-question {
background: color-mix(in srgb, var(--amber) 16%, var(--card));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--amber) 32%, transparent);
}

.stat.is-question strong {
color: var(--amber);
}

.stat.is-error {
background: color-mix(in srgb, var(--red) 16%, var(--card));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--red) 32%, transparent);
}

.stat.is-error strong {
color: var(--red);
}

@media (max-height: 760px) {
  .status-card {
    min-height: 0;
    padding: 8px;
    gap: 6px;
  }
  .stat {
    padding: 6px 2px;
  }
  .stat strong {
    font-size: 20px;
  }
  .stat span {
    font-size: 9px;
  }
}

@media (orientation: portrait) {
  .status-card {
    min-height: 122px;
  }
}
</style>
