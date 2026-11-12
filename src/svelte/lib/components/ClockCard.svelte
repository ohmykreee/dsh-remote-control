<script lang="ts">
  import { app } from '../state.svelte';
  import { clockParts } from '../format';
  import { weatherInfo } from '../weather';
  import Watermark from './Watermark.svelte';
  import WeatherPanel from './WeatherPanel.svelte';

  const parts = $derived(clockParts(new Date(app.clockNow)));
  const weather = $derived(app.weather);
  const available = $derived(Boolean(weather && weather.ok !== false));
  const info = $derived(available ? weatherInfo(weather?.current?.code, weather?.current?.isDay) : null);
</script>

<article class="card clock-card">
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
  <WeatherPanel {weather} />
</article>
