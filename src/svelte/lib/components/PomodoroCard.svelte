<script lang="ts">
  import { onMount } from 'svelte';
  import {
    acquirePomodoro,
    dismissAlarm,
    formatRemaining,
    pomodoro,
    pomodoroProgress,
    resetPomodoro,
    switchPomodoroPhase,
    togglePomodoro,
  } from '../pomodoro.svelte';
  import Icon from './Icon.svelte';

  // Every page is rendered twice (infinite-loop clones), so the engine is
  // reference-counted and shared instead of running once per card instance.
  onMount(() => acquirePomodoro());

  const phaseLabel = $derived(
    pomodoro.finished
      ? pomodoro.phase === 'focus' ? '专注完成' : '休息结束'
      : pomodoro.phase === 'focus' ? '专注' : '休息',
  );
  const primaryLabel = $derived(
    pomodoro.alarmActive
      ? '停止响铃'
      : pomodoro.finished
        ? pomodoro.phase === 'focus' ? '开始休息' : '开始专注'
        : pomodoro.running ? '暂停' : '开始',
  );
  const primaryState = $derived(pomodoro.alarmActive ? 'is-alarm' : pomodoro.finished ? 'is-finished' : '');
  const time = $derived(formatRemaining(pomodoro.remainingMs));
  const percent = $derived(pomodoroProgress());

  function handlePrimary(): void {
    if (pomodoro.alarmActive) {
      dismissAlarm();
      return;
    }
    togglePomodoro();
  }
</script>

<div
  class="pomodoro-card"
  class:is-break={pomodoro.phase === 'break'}
  class:is-running={pomodoro.running}
  class:is-finished={pomodoro.finished}
  data-phase={pomodoro.phase}
  data-running={pomodoro.running ? 'true' : 'false'}
>
  <div class="pomodoro-main">
    <div class="pomodoro-meta">
      <span class="pomodoro-kicker">POMODORO</span>
      <button
        class="pomodoro-phase"
        type="button"
        disabled={pomodoro.running}
        title="切换专注 / 休息"
        onclick={switchPomodoroPhase}
      >{phaseLabel}{#if pomodoro.rounds > 0}<span> · {pomodoro.rounds} 个</span>{/if}</button>
    </div>
    <div class="pomodoro-clock" aria-live="off">{time}</div>
    <div class="pomodoro-actions">
      <button class="pomodoro-primary {primaryState}" type="button" onclick={handlePrimary} title={primaryLabel}>
        <Icon name={pomodoro.alarmActive ? 'bell' : pomodoro.running ? 'pause' : 'play'} />
        <span>{primaryLabel}</span>
      </button>
      <button class="pomodoro-reset" type="button" onclick={resetPomodoro} aria-label="重置番茄钟" title="重置">
        <Icon name="reset" />
      </button>
    </div>
    <div class="pomodoro-progress" aria-hidden="true"><i style={`width:${percent}%`}></i></div>
  </div>
</div>

<style>
/* No card chrome: a divider above and the weather panel's own divider below. */
.pomodoro-card {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: 14px;
  padding: 18px 2px 28px;
  border-top: 1px solid var(--line);
  background: none;
}

.pomodoro-main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "meta actions"
    "clock clock"
    "progress progress";
  align-content: center;
  align-items: center;
  gap: 18px 16px;
}

.pomodoro-meta {
  grid-area: meta;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-width: 0;
}

.pomodoro-kicker {
  color: var(--faint);
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.pomodoro-phase {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent-2);
  font-size: 12px;
  font-weight: 650;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.pomodoro-phase:disabled {
  cursor: default;
  opacity: 0.85;
}

.pomodoro-phase span {
  color: var(--faint);
  font-weight: 500;
}

.pomodoro-clock {
  grid-area: clock;
  justify-self: center;
  color: var(--text);
  font-family: var(--mono);
  font-size: clamp(52px, 17cqw, 80px);
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.pomodoro-actions {
  grid-area: actions;
  justify-self: end;
  display: flex;
  align-items: center;
  gap: 8px;
}

.pomodoro-primary {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 38px;
  padding: 0 15px;
  border-radius: 11px;
  border: 1px solid transparent;
  background: linear-gradient(145deg, var(--accent-2), var(--accent));
  color: #fff;
  font-size: 11.5px;
  font-weight: 650;
  white-space: nowrap;
}

.pomodoro-primary:active {
  transform: scale(0.96);
}

.pomodoro-primary.is-finished {
  background: linear-gradient(145deg, color-mix(in srgb, var(--green) 76%, #fff), var(--green));
  color: #06241c;
}

.pomodoro-primary.is-alarm {
  background: linear-gradient(145deg, color-mix(in srgb, var(--red) 82%, #fff), var(--red));
  color: #fff;
}

.pomodoro-reset {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 11px;
  color: var(--muted);
}

.pomodoro-primary :global(svg) {
  width: 15px;
  height: 15px;
}

.pomodoro-reset :global(svg) {
  width: 15px;
  height: 15px;
}

.pomodoro-progress {
  grid-area: progress;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text) 5%, transparent);
}

.pomodoro-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent), var(--cyan));
  transition: width 0.25s linear;
}

.pomodoro-card.is-break .pomodoro-progress i {
  background: linear-gradient(90deg, var(--green), var(--cyan));
}

.pomodoro-card.is-finished {
  border-top-color: color-mix(in srgb, var(--green) 55%, transparent);
}

.pomodoro-card.is-finished .pomodoro-clock,
.pomodoro-card.is-finished .pomodoro-phase {
  color: var(--green);
}

/* Narrow clock cards: stack the rows so actions never overlap the phase. */
@container (max-width: 300px) {
  .pomodoro-main {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "meta"
      "clock"
      "actions"
      "progress";
    justify-items: center;
    gap: 10px;
  }
  .pomodoro-meta {
    align-items: center;
    text-align: center;
  }
  .pomodoro-phase {
    text-align: center;
  }
  .pomodoro-actions {
    justify-self: center;
  }
}

@media (max-height: 620px) {
  .pomodoro-card {
    margin-top: 10px;
    padding: 10px 2px 22px;
  }
  .pomodoro-main {
    gap: 18px 12px;
  }
  .pomodoro-clock {
    font-size: clamp(48px, 18cqw, 64px);
  }
  .pomodoro-primary {
    min-height: 32px;
    padding: 0 11px;
  }
  .pomodoro-reset {
    width: 32px;
    height: 32px;
  }
}

/* Very short landscape cards: keep one compact row so the card never spills
   into the clock or weather sections. */
@media (max-height: 500px) {
  .pomodoro-card {
    padding: 8px 2px 12px;
  }
  .pomodoro-main {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "clock actions"
      "progress progress";
    justify-items: stretch;
    gap: 8px 10px;
  }
  .pomodoro-meta {
    display: none;
  }
  .pomodoro-clock {
    justify-self: start;
    font-size: clamp(32px, 10cqw, 44px);
  }
  .pomodoro-actions {
    justify-self: end;
  }
  .pomodoro-primary {
    min-height: 30px;
    padding: 0 9px;
    font-size: 10px;
  }
  .pomodoro-reset {
    width: 30px;
    height: 30px;
  }
}
</style>
