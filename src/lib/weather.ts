import type { WeatherData } from './types';

/** WMO weather-code mapping ported from the original console. */
export const WMO: Record<number, readonly [string, string, string]> = {
  0: ['晴', 'sun', 'day'],
  1: ['大致晴朗', 'sun', 'day'],
  2: ['局部多云', 'cloud-sun', 'day'],
  3: ['阴天', 'cloud', 'cloud'],
  45: ['有雾', 'fog', 'cloud'],
  48: ['雾凇', 'fog', 'cloud'],
  51: ['毛毛雨', 'rain', 'rain'],
  53: ['毛毛雨', 'rain', 'rain'],
  55: ['较强毛毛雨', 'rain', 'rain'],
  56: ['冻毛毛雨', 'rain', 'rain'],
  57: ['强冻毛毛雨', 'rain', 'rain'],
  61: ['小雨', 'rain', 'rain'],
  63: ['中雨', 'rain', 'rain'],
  65: ['大雨', 'rain', 'rain'],
  66: ['冻雨', 'rain', 'rain'],
  67: ['强冻雨', 'rain', 'rain'],
  71: ['小雪', 'snow', 'rain'],
  73: ['中雪', 'snow', 'rain'],
  75: ['大雪', 'snow', 'rain'],
  77: ['雪粒', 'snow', 'rain'],
  80: ['阵雨', 'rain', 'rain'],
  81: ['较强阵雨', 'rain', 'rain'],
  82: ['强阵雨', 'storm', 'storm'],
  85: ['阵雪', 'snow', 'rain'],
  86: ['强阵雪', 'snow', 'rain'],
  95: ['雷雨', 'storm', 'storm'],
  96: ['雷雨伴冰雹', 'storm', 'storm'],
  99: ['强雷雨伴冰雹', 'storm', 'storm'],
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
  const item = WMO[Number(code)] || (isDay ? ['天气', 'sun', 'day'] : ['夜间', 'moon', 'night']);
  return { label: item[0], icon: item[1], skycon: skyconFor(code, isDay), tone: item[2] };
}

export type { WeatherData };
