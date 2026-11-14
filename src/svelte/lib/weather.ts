import { t, type MessageKey } from './i18n.svelte';
import type { WeatherData } from './types';

/** WMO weather-code mapping ported from the original console. */
export const WMO: Record<number, readonly [MessageKey, string, string]> = {
  0: ['wmoClear', 'sun', 'day'],
  1: ['wmoMostlyClear', 'sun', 'day'],
  2: ['wmoPartlyCloudy', 'cloud-sun', 'day'],
  3: ['wmoOvercast', 'cloud', 'cloud'],
  45: ['wmoFog', 'fog', 'cloud'],
  48: ['wmoRimeFog', 'fog', 'cloud'],
  51: ['wmoDrizzle', 'rain', 'rain'],
  53: ['wmoDrizzle', 'rain', 'rain'],
  55: ['wmoDenseDrizzle', 'rain', 'rain'],
  56: ['wmoFreezingDrizzle', 'rain', 'rain'],
  57: ['wmoHeavyFreezingDrizzle', 'rain', 'rain'],
  61: ['wmoLightRain', 'rain', 'rain'],
  63: ['wmoRain', 'rain', 'rain'],
  65: ['wmoHeavyRain', 'rain', 'rain'],
  66: ['wmoFreezingRain', 'rain', 'rain'],
  67: ['wmoHeavyFreezingRain', 'rain', 'rain'],
  71: ['wmoLightSnow', 'snow', 'rain'],
  73: ['wmoSnow', 'snow', 'rain'],
  75: ['wmoHeavySnow', 'snow', 'rain'],
  77: ['wmoSnowGrains', 'snow', 'rain'],
  80: ['wmoRainShowers', 'rain', 'rain'],
  81: ['wmoHeavyRainShowers', 'rain', 'rain'],
  82: ['wmoViolentRainShowers', 'storm', 'storm'],
  85: ['wmoSnowShowers', 'snow', 'rain'],
  86: ['wmoHeavySnowShowers', 'snow', 'rain'],
  95: ['wmoThunderstorm', 'storm', 'storm'],
  96: ['wmoThunderstormHail', 'storm', 'storm'],
  99: ['wmoSevereThunderstorm', 'storm', 'storm'],
};

export interface WeatherInfo {
  label: string;
  icon: string;
  skycon: string;
  tone: string;
}

export function skyconFor(code: number | undefined, isDay: boolean | undefined): string {
  switch (Number(code)) {
    case 0: return isDay ? 'CLEAR_DAY' : 'CLEAR_NIGHT';
    case 1:
    case 2: return isDay ? 'PARTLY_CLOUDY_DAY' : 'PARTLY_CLOUDY_NIGHT';
    case 3: return 'CLOUDY';
    case 45:
    case 48: return 'FOG';
    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
    case 61:
    case 66:
    case 67:
    case 80: return 'LIGHT_RAIN';
    case 63:
    case 81: return 'MODERATE_RAIN';
    case 65: return 'HEAVY_RAIN';
    case 71:
    case 77:
    case 85: return 'LIGHT_SNOW';
    case 73:
    case 86: return 'MODERATE_SNOW';
    case 75: return 'HEAVY_SNOW';
    case 82:
    case 95:
    case 96:
    case 99: return 'STORM_RAIN';
    default: return 'CLOUDY';
  }
}

export function weatherInfo(code: number | undefined, isDay: boolean | undefined): WeatherInfo {
  const item = WMO[Number(code)] || (isDay
    ? ['weatherFallback', 'sun', 'day'] as const
    : ['weatherNight', 'moon', 'night'] as const);
  return { label: t(item[0]), icon: item[1], skycon: skyconFor(code, isDay), tone: item[2] };
}

export type { WeatherData };
