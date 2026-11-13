<script lang="ts">
  import type { Component } from 'svelte';
  import { weatherInfo } from '../weather';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import CloudSun from '@lucide/svelte/icons/cloud-sun';
  import Cloud from '@lucide/svelte/icons/cloud';
  import CloudFog from '@lucide/svelte/icons/cloud-fog';
  import CloudRain from '@lucide/svelte/icons/cloud-rain';
  import CloudSnow from '@lucide/svelte/icons/cloud-snow';
  import CloudLightning from '@lucide/svelte/icons/cloud-lightning';

  let {
    code,
    isDay = true,
    class: className = 'size-5',
    strokeWidth = 1.7,
  }: {
    code?: number;
    isDay?: boolean;
    class?: string;
    strokeWidth?: number;
  } = $props();

  const map: Record<string, Component<{ class?: string; strokeWidth?: number }>> = {
    sun: Sun,
    moon: Moon,
    'cloud-sun': CloudSun,
    cloud: Cloud,
    fog: CloudFog,
    rain: CloudRain,
    snow: CloudSnow,
    storm: CloudLightning,
  };

  const info = $derived(weatherInfo(code, isDay));
  const Icon = $derived(info.icon === 'sun' && !isDay ? Moon : map[info.icon] || Cloud);
</script>

<Icon class={className} {strokeWidth} />
