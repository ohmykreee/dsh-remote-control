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
