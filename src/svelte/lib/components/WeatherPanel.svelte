<script lang="ts">
  import { app } from '../state.svelte';
  import { formatTemperature, pad, temperatureUnitLabel, toDisplayTemperature } from '../format';
  import { localeTag, t } from '../i18n.svelte';
  import { weatherInfo } from '../weather';
  import type { WeatherData } from '../types';
  import { Skeleton } from '$lib/components/ui/skeleton/index.js';
  import { cn } from '$lib/utils.js';
  import Sunrise from '@lucide/svelte/icons/sunrise';
  import Sunset from '@lucide/svelte/icons/sunset';
  import CloudSun from '@lucide/svelte/icons/cloud-sun';
  import WeatherIcon from './WeatherIcon.svelte';

  let { weather }: { weather: WeatherData | null } = $props();

  const weekdayFormatter = $derived(new Intl.DateTimeFormat(localeTag(), { weekday: 'short' }));
  const unit = $derived(app.temperatureUnit);
  const displayUnit = $derived(temperatureUnitLabel(unit));
  const loaded = $derived(weather !== null);
  const available = $derived(Boolean(loaded && weather?.ok !== false));
  const current = $derived(weather?.current || {});
  const daily = $derived(weather?.daily || {});
  const info = $derived(available ? weatherInfo(current.code, current.isDay) : null);
  const mainTemperature = $derived(available ? toDisplayTemperature(current.temperature, unit) : null);
  const hourly = $derived(available && Array.isArray(weather?.hourly) ? weather.hourly.slice(0, 6) : []);
  const dailyForecast = $derived(
    available && Array.isArray(weather?.dailyForecast) ? weather.dailyForecast.slice(0, 7) : [],
  );
  const showDaily = $derived(available && weather?.forecastMode === 'daily' && dailyForecast.length > 0);

  const sunrise = $derived(weather?.daily?.sunrise ? new Date(weather.daily.sunrise) : null);
  const sunset = $derived(weather?.daily?.sunset ? new Date(weather.daily.sunset) : null);
  const sunriseText = $derived(
    sunrise && !Number.isNaN(sunrise.getTime()) ? `${pad(sunrise.getHours())}:${pad(sunrise.getMinutes())}` : '--:--',
  );
  const sunsetText = $derived(
    sunset && !Number.isNaN(sunset.getTime()) ? `${pad(sunset.getHours())}:${pad(sunset.getMinutes())}` : '--:--',
  );
  const tomorrowText = $derived(
    daily.tomorrowHigh != null && daily.tomorrowLow != null
      ? `${formatTemperature(daily.tomorrowHigh, unit)} / ${formatTemperature(daily.tomorrowLow, unit)}`
      : '--',
  );

  function hourIsDay(time: string | undefined): boolean {
    const hour = new Date(time || Date.now()).getHours();
    return hour >= 6 && hour < 18;
  }

  /** The Host may fill generic fallback names; localize those, keep real cities. */
  function locationName(name: string | undefined): string {
    const value = String(name || '').trim();
    if (!value || value === '当前位置') return t('currentLocation');
    if (value === '自定义位置') return t('customLocation');
    return value;
  }
</script>

<section class="weather-panel" aria-label={t('weather')}>
  {#if !loaded}
    <div class="weather-main">
      <div class="weather-condition">
        <Skeleton class="size-14 rounded-[15px]" />
        <div class="space-y-2">
          <Skeleton class="h-4 w-28" />
          <Skeleton class="h-3 w-20" />
        </div>
      </div>
      <Skeleton class="h-12 w-24" />
    </div>
  {:else if !available}
    <div class="weather-main">
      <div class="weather-condition">
        <span class="weather-icon">
          <CloudSun class="size-[26px] text-muted-foreground" strokeWidth={1.7} />
        </span>
        <div>
          <p class="text-[19px] font-medium text-foreground">{t('weatherUnavailable')}</p>
          <p class="mt-0.5 text-[14px] text-muted-foreground">{t('tryLater')}</p>
        </div>
      </div>
    </div>
  {:else}
    <div class="weather-main">
      <div class="weather-condition">
        <span class="weather-icon">
          <WeatherIcon code={current.code} isDay={current.isDay} class="size-[26px]" />
        </span>
        <div class="min-w-0">
          <p class="truncate text-[20px] font-semibold text-foreground">{info?.label}</p>
          <p class="mt-0.5 truncate text-[14px] text-muted-foreground">{locationName(weather?.location?.name)}</p>
        </div>
      </div>

      <div class="weather-temp numeric">
        {mainTemperature === null ? '--' : Math.round(mainTemperature)}<span>{displayUnit}</span>
      </div>

      <div class="weather-metrics numeric">
        <span><b>{formatTemperature(daily.high, unit)} / {formatTemperature(daily.low, unit)}</b><small>{t('highLow')}</small></span>
        <span><b>{formatTemperature(current.feelsLike, unit)}</b><small>{t('feelsLike')}</small></span>
        <span><b>{Math.round(current.humidity ?? 0)}%</b><small>{t('humidity')}</small></span>
        <span><b>{Math.round(current.windSpeed ?? 0)} km/h</b><small>{t('windSpeed')}</small></span>
      </div>
    </div>

    <div class={cn('forecast-grid', showDaily ? 'is-daily' : 'is-hourly')}>
      {#if showDaily}
        {#each dailyForecast as day, index (day.date || index)}
          <div class="forecast-chip" class:is-now={index === 0}>
            <span class="forecast-label">{index === 0 ? t('today') : weekdayFormatter.format(new Date(day.date || Date.now()))}</span>
            <WeatherIcon code={day.code} isDay class="size-[22px] text-brand" />
            <b class="numeric">{formatTemperature(day.high, unit)}</b>
            <small class="numeric">{formatTemperature(day.low, unit)}</small>
          </div>
        {/each}
      {:else}
        {#each hourly as hour, index (hour.time || index)}
          {@const date = new Date(hour.time || Date.now())}
          <div class="forecast-chip" class:is-now={index === 0}>
            <span class="forecast-label">{index === 0 ? t('now') : t('hourLabel', { hour: pad(date.getHours()) })}</span>
            <WeatherIcon code={hour.code} isDay={hourIsDay(hour.time)} class="size-[22px] text-brand" />
            <b class="numeric">{formatTemperature(hour.temperature, unit)}</b>
          </div>
        {/each}
      {/if}
    </div>

    <div class="weather-extra">
      <span><Sunrise class="size-4 text-muted-foreground" strokeWidth={1.7} />{t('sunrise')} {sunriseText}</span>
      <span><Sunset class="size-4 text-muted-foreground" strokeWidth={1.7} />{t('sunset')} {sunsetText}</span>
      <span><CloudSun class="size-4 text-muted-foreground" strokeWidth={1.7} />{t('tomorrow')} {tomorrowText}</span>
    </div>
  {/if}
</section>

<style>
  .weather-panel {
    flex: 0 0 auto;
    margin-top: auto;
    padding-top: 15px;
    border-top: 1px solid var(--border);
  }

  .weather-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px 18px;
  }

  .weather-condition {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 11px;
  }

  .weather-icon {
    display: grid;
    width: 52px;
    height: 52px;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--brand) 20%, transparent);
    border-radius: 15px;
    background: var(--brand-soft);
    color: var(--brand);
  }

  .weather-temp {
    justify-self: end;
    color: var(--foreground);
    font-size: clamp(44px, 5vw, 58px);
    font-weight: 560;
    line-height: 0.9;
    letter-spacing: -0.06em;
    white-space: nowrap;
  }

  .weather-temp span {
    margin-left: 2px;
    color: var(--brand);
    font-size: 0.36em;
    font-weight: 600;
    vertical-align: top;
    letter-spacing: 0;
  }

  .weather-metrics {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 18px;
    color: var(--muted-foreground);
  }

  .weather-metrics span {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
  }

  .weather-metrics b {
    color: var(--foreground);
    font-size: 14px;
    font-weight: 550;
    white-space: nowrap;
  }

  .weather-metrics small {
    font-size: 12px;
  }

  .forecast-grid {
    display: grid;
    gap: 5px;
    margin-top: 12px;
  }

  .forecast-grid.is-hourly {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }

  .forecast-grid.is-daily {
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }

  .forecast-chip {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 7px 3px 6px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: color-mix(in srgb, var(--secondary) 70%, transparent);
  }

  .forecast-chip.is-now {
    border-color: color-mix(in srgb, var(--brand) 24%, transparent);
    background: var(--brand-soft);
  }

  .forecast-label {
    color: var(--muted-foreground);
    font-size: 13px;
    line-height: 1;
    white-space: nowrap;
  }

  .forecast-chip b {
    color: var(--foreground);
    font-size: 14px;
    font-weight: 560;
    line-height: 1.2;
    white-space: nowrap;
  }

  .forecast-chip small {
    color: var(--muted-foreground);
    font-size: 12px;
    line-height: 1;
  }

  .weather-extra {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 6px 12px;
    margin-top: 9px;
    color: var(--muted-foreground);
    font-size: 13px;
  }

  .weather-extra span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }

  @media (max-height: 760px) {
    .weather-panel {
      margin-top: auto;
      padding-top: 12px;
    }

    .weather-icon {
      width: 46px;
      height: 46px;
      border-radius: 13px;
    }

    .weather-temp {
      font-size: 46px;
    }

    .weather-metrics {
      gap: 4px 13px;
    }

    .weather-metrics b {
      font-size: 13px;
    }

    .weather-metrics small {
      font-size: 11px;
    }

    .forecast-grid {
      margin-top: 9px;
      gap: 4px;
    }

    .forecast-chip {
      padding: 6px 2px 5px;
      gap: 3px;
    }

    .forecast-chip :global(svg) {
      width: 20px;
      height: 20px;
    }

    .forecast-label {
      font-size: 12px;
    }

    .forecast-chip b {
      font-size: 13px;
    }

    .forecast-chip small {
      font-size: 11px;
    }

    .weather-extra {
      margin-top: 7px;
      font-size: 12px;
    }
  }

  @container (max-width: 400px) {
    .forecast-grid.is-daily {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  @media (max-height: 620px) {
    .weather-panel {
      margin-top: auto;
      padding-top: 9px;
    }

    .weather-icon {
      width: 42px;
      height: 42px;
      border-radius: 12px;
    }

    .weather-condition {
      gap: 8px;
    }

    .weather-condition p:first-child {
      font-size: 18px;
    }

    .weather-condition p:last-child {
      font-size: 12px;
    }

    .weather-temp {
      font-size: 42px;
    }

    .weather-metrics {
      gap: 2px 10px;
    }

    .weather-metrics b {
      font-size: 12px;
    }

    .weather-metrics small {
      font-size: 10px;
    }

    .forecast-grid {
      margin-top: 7px;
    }

    .forecast-chip {
      padding: 5px 2px 4px;
    }

    .weather-extra {
      margin-top: 5px;
      font-size: 11px;
    }
  }

  @media (orientation: portrait) {
    .weather-panel {
      margin-top: auto;
    }

    .forecast-grid.is-hourly {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .forecast-grid.is-daily {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
</style>
