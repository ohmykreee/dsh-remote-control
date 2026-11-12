<script lang="ts">
  import { app } from '../state.svelte';
  import { clockParts } from '../format';
  import { weatherInfo } from '../weather';
  import Watermark from './Watermark.svelte';
  import WeatherPanel from './WeatherPanel.svelte';
  import PomodoroCard from './PomodoroCard.svelte';

  const parts = $derived(clockParts(new Date(app.clockNow)));
  const weather = $derived(app.weather);
  const available = $derived(Boolean(weather && weather.ok !== false));
  const info = $derived(available ? weatherInfo(weather?.current?.code, weather?.current?.isDay) : null);
</script>

<article class="card clock-card" class:has-pomodoro={app.pomodoro.enabled}>
  <div class="clock-hero">
    <div class="card-kicker"><span>{parts.dateLabel}</span><span class="kicker-dot"></span><span>{parts.periodLabel}</span></div>
    <div class="clock-line">
      <div class="clock">{parts.time}</div>
      <div class="clock-seconds">{parts.seconds}</div>
    </div>
    <div class="clock-side"><span>{parts.greeting}</span></div>
    <div class="clock-watermark" aria-hidden="true">
      {#if info}<Watermark name={info.icon} />{/if}
    </div>
  </div>
  {#if app.pomodoro.enabled}
    <PomodoroCard />
  {/if}
  <WeatherPanel {weather} />
</article>

<style>
.clock-card {
container-type: inline-size;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 32px 28px 22px;
  overflow: hidden;
  background:
    radial-gradient(120% 90% at 95% 0%, color-mix(in srgb, var(--accent) 24%, transparent), transparent 58%),
    linear-gradient(150deg, color-mix(in srgb, var(--card-2) 88%, var(--accent) 12%), var(--card) 62%);
}

.clock-card::before {
content: "";
  position: absolute;
  width: 300px;
  height: 300px;
  right: -120px;
  bottom: -160px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  filter: blur(50px);
  pointer-events: none;
}

.clock-hero {
position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-top: 8px;
}

/* With the pomodoro mounted, the flexible middle belongs to it instead. */
.clock-card.has-pomodoro .clock-hero {
  flex: 0 0 auto;
}

/* The weather card's auto margin would otherwise steal the pomodoro's space. */
.clock-card.has-pomodoro :global(.weather-line) {
  margin-top: 0;
}

.clock-watermark {
position: absolute;
  z-index: 0;
  right: -20%;
  bottom: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  opacity: 0.1;
  filter: saturate(0.9);
  pointer-events: none;
}

.clock-watermark :global(svg) {
width: 100%;
  height: 100%;
  max-width: 100%;
  object-fit: contain;
}

.clock-watermark :global(img) {
width: 100%;
  height: 100%;
  max-width: 100%;
  object-fit: contain;
}

.clock-hero > *:not(.clock-watermark) {
position: relative;
  z-index: 1;
}

.clock-card > *:not(.clock-watermark) {
position: relative;
  z-index: 1;
}

.clock-card .card-kicker {
font-size: 12px;
  letter-spacing: 0.12em;
}

.clock-line {
display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  margin-top: 10px;
}

.clock {
display: block;
  width: auto;
  min-width: 0;
  flex: 0 1 auto;
  font-size: clamp(64px, 30cqw, 160px);
  line-height: 0.9;
  letter-spacing: -0.04em;
  font-weight: 590;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  white-space: nowrap;
}

.clock-seconds {
flex: 0 0 auto;
  color: var(--accent-2);
  font-family: var(--mono);
  font-size: clamp(34px, 15cqw, 80px);
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1;
}

.clock-side {
display: flex;
  align-items: baseline;
  justify-content: flex-end;
  margin-top: 12px;
}

.clock-side span {
color: color-mix(in srgb, var(--text) 66%, transparent);
  font-size: 46px;
  font-weight: 500;
  line-height: 1.2;
}

@media (max-height: 760px) {
  .clock-hero {
    padding-top: 10px;
  }
  .clock-card {
    padding: 22px 18px 15px;
  }
  .clock {
    font-size: clamp(64px, 30cqw, 140px);
    line-height: 0.9;
  }
  .clock-line {
    gap: 10px;
    margin-top: 6px;
  }
  .clock-side {
    margin-top: 8px;
  }
  .clock-side span {
    font-size: 30px;
  }
}

@media (orientation: portrait) {
  .clock-card {
    min-height: 560px;
  }
  .clock-watermark {
    display: none;
  }
}

@media (max-height: 620px) {
  .clock-hero {
    padding-top: 12px;
  }
  .clock-card {
    padding: 16px 14px 10px;
  }
  .clock {
    font-size: clamp(58px, 28cqw, 110px);
    line-height: 0.92;
  }
  .clock-seconds {
    font-size: clamp(29px, 14cqw, 55px);
  }
  .clock-line {
    gap: 8px;
    margin-top: 4px;
  }
  .clock-side {
    margin-top: 6px;
  }
  .clock-side span {
    font-size: 24px;
  }
}

@media (max-height: 500px) {
  .clock-hero {
    padding-top: 10px;
  }
}
</style>
