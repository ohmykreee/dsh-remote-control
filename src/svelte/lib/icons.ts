// Inline icon set ported from the original console. Keeping these paths (rather
// than a generic icon package) preserves the exact visual weight and sizes.
export const ICONS: Record<string, string> = {
  home: '<path d="m4 10.5 8-6.7 8 6.7V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  music: '<path d="M9 18V6l10-2v11" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.7" stroke="currentColor" stroke-width="1.7"/><circle cx="16.5" cy="15" r="2.7" stroke="currentColor" stroke-width="1.7"/>',
  previous: '<path d="M7 5v14M19 6.5 9.5 12 19 17.5V6.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  next: '<path d="M17 5v14M5 6.5 14.5 12 5 17.5V6.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  play: '<path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor"/>',
  pause: '<path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z" fill="currentColor"/>',
  volume: '<path d="M4 10v4h4l5 4V6l-5 4H4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M16 9.2a4 4 0 0 1 0 5.6M18.5 6.8a7.2 7.2 0 0 1 0 10.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  'volume-off': '<path d="M4 10v4h4l5 4V6l-5 4H4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m16 10 4 4m0-4-4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  sun: '<circle cx="12" cy="12" r="4.1" stroke="currentColor" stroke-width="1.7"/><path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  moon: '<path d="M20 15.2A8.5 8.5 0 0 1 8.8 4a8.7 8.7 0 1 0 11.2 11.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  cloud: '<path d="M6.5 18h10.2a4.3 4.3 0 0 0 .7-8.5A5.5 5.5 0 0 0 7 8.6 4.7 4.7 0 0 0 6.5 18Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  'cloud-sun': '<path d="M15.5 17.5h4a3.4 3.4 0 0 0 .5-6.8 4.6 4.6 0 0 0-8.7-1.4 3.8 3.8 0 0 0 1.7 7.4" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 5.5 8.7 4M4.2 4.8l.9.9M4 9h1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  rain: '<path d="M6.5 15h10.2a4.3 4.3 0 0 0 .7-8.5A5.5 5.5 0 0 0 7 5.6 4.7 4.7 0 0 0 6.5 15Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m8 18-.8 2M12 18l-.8 2M16 18l-.8 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  storm: '<path d="M6.5 14h10.2a4.3 4.3 0 0 0 .7-8.5A5.5 5.5 0 0 0 7 4.6 4.7 4.7 0 0 0 6.5 14Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m12.5 16-3 4h3l-1 3.5 4-5h-3l1-2.5Z" fill="currentColor"/>',
  snow: '<path d="M6.5 15h10.2a4.3 4.3 0 0 0 .7-8.5A5.5 5.5 0 0 0 7 5.6 4.7 4.7 0 0 0 6.5 15Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 18v3M6.8 18.8l2.4 2.4M9.2 18.8l-2.4 2.4M15 18v3M13.8 18.8l2.4 2.4M16.2 18.8l-2.4 2.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  fog: '<path d="M4 8h11M7 12h13M4 16h12M9 20h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  compress: '<path d="M3 8h5V3M21 8h-5V3M16 21v-5h5M8 21v-5H3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  heart: '<path d="M12 20.2 4.8 13a4.8 4.8 0 0 1 6.8-6.8L12 7l.4-.8A4.8 4.8 0 0 1 19.2 13L12 20.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  'heart-filled': '<path d="M12 20.2 4.8 13a4.8 4.8 0 0 1 6.8-6.8L12 7l.4-.8A4.8 4.8 0 0 1 19.2 13L12 20.2Z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="2.5" stroke="currentColor" stroke-width="1.7"/><path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3M10 10h4v4h-4z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  thermometer: '<path d="M10 4.5a2 2 0 0 1 4 0v9.1a4.5 4.5 0 1 1-4 0V4.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 9v7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 6.5v1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};

export function iconMarkup(name: string): string {
  return ICONS[name] || ICONS.cloud;
}
