<script lang="ts">
  import { app } from '../state.svelte';
  import { formatTemperature, pad, temperatureUnitLabel, toDisplayTemperature } from '../format';
  import { weatherInfo } from '../weather';
  import type { WeatherData } from '../types';
  import Icon from './Icon.svelte';

  let { weather }: { weather: WeatherData | null } = $props();

  const weekdayFormatter = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' });
  const unit = $derived(app.temperatureUnit);
  const displayUnit = $derived(temperatureUnitLabel(unit));
  const loaded = $derived(weather !== null);
  const available = $derived(Boolean(loaded && weather?.ok !== false));
  const current = $derived(weather?.current || {});
  const daily = $derived(weather?.daily || {});
  const info = $derived(available ? weatherInfo(current.code, current.isDay) : null);
  const artSkycon = $derived(info?.skycon || 'CLOUDY');
  const mainTemperature = $derived(available ? toDisplayTemperature(current.temperature, unit) : null);
  const hourly = $derived(available && Array.isArray(weather?.hourly) ? weather.hourly.slice(0, 6) : []);
  const dailyForecast = $derived(available && Array.isArray(weather?.dailyForecast) ? weather.dailyForecast.slice(0, 7) : []);
  const showDaily = $derived(available && weather?.forecastMode === 'daily' && dailyForecast.length > 0);

  const sunrise = $derived(weather?.daily?.sunrise ? new Date(weather.daily.sunrise) : null);
  const sunset = $derived(weather?.daily?.sunset ? new Date(weather.daily.sunset) : null);
  const sunriseText = $derived(sunrise && !Number.isNaN(sunrise.getTime()) ? `${pad(sunrise.getHours())}:${pad(sunrise.getMinutes())}` : '--:--');
  const sunsetText = $derived(sunset && !Number.isNaN(sunset.getTime()) ? `${pad(sunset.getHours())}:${pad(sunset.getMinutes())}` : '--:--');
  const tomorrowText = $derived(
    daily.tomorrowHigh != null && daily.tomorrowLow != null
      ? `${formatTemperature(daily.tomorrowHigh, unit)} / ${formatTemperature(daily.tomorrowLow, unit)}`
      : '--',
  );
</script>

<div class="weather-line">
  <div class="weather-art" aria-hidden="true">
    {#if loaded}<img src={`/weather-icons/${artSkycon}.svg`} alt="">{/if}
  </div>
  <div class="weather-copy">
    <div class="weather-condition">
      <span>{!loaded ? '正在获取天气' : available ? info?.label : '天气暂不可用'}</span>
      <span>{available ? weather?.location?.name || '当前位置' : '当前位置'}</span>
    </div>
  </div>
  <div class="weather-metrics">
    <span><b>{available ? `${formatTemperature(daily.high, unit)} / ${formatTemperature(daily.low, unit)}` : '-- / --'}</b><small>最高 / 最低</small></span>
    <span><b>{available ? formatTemperature(current.feelsLike, unit) : '--'}</b><small>体感</small></span>
    <span><b>{available ? `${Math.round(current.humidity ?? 0)}%` : '--'}</b><small>湿度</small></span>
    <span><b>{available ? `${Math.round(current.windSpeed ?? 0)} km/h` : '--'}</b><small>风速</small></span>
  </div>
  <div class="temperature">
    {#if mainTemperature === null}--{:else}{Math.round(mainTemperature)}{/if}<span>{displayUnit}</span>
  </div>
</div>

<div class={showDaily ? 'hourly is-daily' : 'hourly'}>
  {#if showDaily}
    {#each dailyForecast as day, index (day.date || index)}
      {@const dayInfo = weatherInfo(day.code, true)}
      <div class="hour-chip" class:is-now={index === 0}>
        <span>{index === 0 ? '今天' : weekdayFormatter.format(new Date(day.date || Date.now()))}</span>
        <Icon name={dayInfo.icon} />
        <b>{formatTemperature(day.high, unit)}</b>
        <small>{formatTemperature(day.low, unit)}</small>
      </div>
    {/each}
  {:else}
    {#each hourly as hour, index (hour.time || index)}
      {@const date = new Date(hour.time || Date.now())}
      {@const hourInfo = weatherInfo(hour.code, date.getHours() >= 6 && date.getHours() < 18)}
      <div class="hour-chip" class:is-now={index === 0}>
        <span>{index === 0 ? '现在' : `${pad(date.getHours())}时`}</span>
        <Icon name={hourInfo.icon} />
        <b>{formatTemperature(hour.temperature, unit)}</b>
      </div>
    {/each}
  {/if}
</div>

{#if available}
  <div class="weather-extra">
    <span><Icon name="sun" />日出 <b>{sunriseText}</b></span>
    <span><Icon name="moon" />日落 <b>{sunsetText}</b></span>
    <span><Icon name="cloud" />明日 <b>{tomorrowText}</b></span>
  </div>
{/if}

<style>
.weather-line {
display: grid;
  grid-template-columns: 92px minmax(0, 1fr) auto auto;
  gap: 14px;
  align-items: center;
  margin-top: auto;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}

.weather-art {
width: 92px;
  height: 92px;
  display: grid;
  place-items: center;
  justify-self: center;
}

.weather-art img {
width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  overflow: visible;
}

.weather-copy {
min-width: 0;
}

.temperature {
justify-self: end;
  font-size: 58px;
  line-height: 0.9;
  letter-spacing: -0.06em;
  font-weight: 590;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

.temperature span {
color: var(--accent-2);
  font-size: 0.42em;
  vertical-align: top;
  letter-spacing: 0;
}

.weather-condition {
display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  color: var(--text);
  font-size: 16px;
  line-height: 1.25;
}

.weather-condition span:last-child {
color: var(--muted);
  font-size: 12px;
}

.weather-condition span {
max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.weather-metrics {
display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 16px;
  min-width: 148px;
}

.weather-metrics span {
display: flex;
  flex-direction: column;
  gap: 2px;
}

.weather-metrics b {
font-size: 12px;
  font-weight: 580;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.weather-metrics small {
color: var(--faint);
  font-size: 9px;
}

.hourly {
display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  margin-top: 18px;
  padding-top: 0;
}

.hourly.is-daily {
grid-template-columns: repeat(7, minmax(0, 1fr));
}

.hour-chip {
display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 9px 4px;
  border-radius: 14px;
  border: 1px solid transparent;
  background: color-mix(in srgb, var(--text) 3.5%, transparent);
}

.hour-chip.is-now {
border-color: color-mix(in srgb, var(--accent) 34%, transparent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.hour-chip span {
color: var(--faint);
  font-size: 9px;
}

.hour-chip :global(svg) {
width: 20px;
  height: 20px;
  color: var(--accent-2);
}

.hour-chip b {
font-size: 11px;
  font-weight: 560;
}

.hour-chip small {
color: var(--faint);
  font-size: 9px;
}

.weather-extra {
display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
  color: var(--faint);
  font-size: 10px;
}

.weather-extra span {
display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.weather-extra :global(svg) {
width: 13px;
  height: 13px;
  color: var(--accent-2);
}

.weather-extra b {
color: var(--muted);
  font-weight: 550;
}

@media (max-height: 760px) {
  .weather-line {
    grid-template-columns: 76px minmax(0, 1fr) auto auto;
    gap: 9px;
    margin-top: auto;
    padding-top: 10px;
  }
  .weather-art {
    width: 76px;
    height: 76px;
  }
  .temperature {
    font-size: 42px;
  }
  .weather-metrics {
    gap: 7px 12px;
    min-width: 132px;
  }
  .hourly {
    margin-top: 10px;
    padding-top: 0;
    gap: 4px;
  }
  .weather-extra {
    display: none;
  }
  .hour-chip {
    padding: 6px 2px;
    border-radius: 11px;
    gap: 3px;
  }
  .hour-chip b {
    font-size: 10px;
  }
}

@media (max-height: 620px) {
  .weather-line {
    padding-top: 8px;
  }
  .temperature {
    font-size: 34px;
  }
  .weather-condition {
    gap: 1px;
    font-size: 12px;
  }
  .weather-condition span:last-child {
    font-size: 9px;
  }
  .weather-metrics {
    min-width: 112px;
    gap: 4px 10px;
  }
  .weather-metrics b {
    font-size: 10px;
  }
  .weather-metrics small {
    font-size: 8px;
  }
  .hourly {
    margin-top: 8px;
  }
  .hour-chip {
    padding: 3px 2px;
    border-radius: 10px;
    gap: 1px;
  }
  .hour-chip :global(svg) {
    width: 15px;
    height: 15px;
  }
  .hour-chip b {
    font-size: 9px;
  }
  .hour-chip small {
    font-size: 8px;
  }
  .weather-extra {
    display: flex;
    margin-top: 6px;
    font-size: 9px;
  }
  .weather-extra :global(svg) {
    width: 11px;
    height: 11px;
  }
}

@media (max-width: 980px) {
  .weather-line {
    grid-template-columns: 84px minmax(0, 1fr) auto;
  }
  .weather-art {
    grid-column: 1;
    grid-row: 1;
    width: 84px;
    height: 84px;
  }
  .weather-copy {
    grid-column: 2;
    grid-row: 1;
  }
  .temperature {
    grid-column: 3;
    grid-row: 1;
  }
  .weather-metrics {
    grid-column: 1 / -1;
    grid-row: 2;
    grid-template-columns: repeat(4, 1fr);
    min-width: 0;
  }
}

@container (min-width: 290px) and (max-width: 460px) {
  .weather-line {
    grid-template-columns: 64px minmax(0, 1fr) auto auto;
    gap: 8px;
    padding-top: 8px;
  }
  .weather-art {
    grid-column: 1;
    grid-row: 1;
    width: 64px;
    height: 64px;
  }
  .weather-copy {
    grid-column: 2;
    grid-row: 1;
  }
  .weather-metrics {
    grid-column: 3;
    grid-row: 1;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    min-width: 0;
    gap: 4px 8px;
  }
  .temperature {
    grid-column: 4;
    grid-row: 1;
    font-size: 34px;
  }
  .weather-condition {
    font-size: 12px;
  }
  .weather-condition span:last-child {
    font-size: 9px;
  }
  .weather-metrics b {
    font-size: 10px;
  }
  .weather-metrics small {
    font-size: 8px;
  }
}
</style>
