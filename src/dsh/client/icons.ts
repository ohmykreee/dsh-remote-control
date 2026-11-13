/** Small inline SVGs: the sidebar launcher and the section navigation icons. */

import * as React from 'react';

const h = React.createElement;

export interface PanelIconProps {
  size?: number;
  active?: boolean;
}

export interface MenuIconProps {
  name: string;
}

/** Sidebar launcher glyph: a phone beside a broadcast signal. */
export function PanelIcon({ size = 20, active = false }: PanelIconProps): React.ReactElement {
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': true,
    style: { display: 'block', color: active ? 'var(--dsw-alias-brand-primary)' : 'currentColor' },
  },
  h('rect', { x: 4.2, y: 2.8, width: 15.6, height: 18.4, rx: 4, stroke: 'currentColor', strokeWidth: 1.7 }),
  h('path', { d: 'M9.3 18.1h5.4', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
  h('circle', { cx: 12, cy: 10.5, r: 3.5, stroke: 'currentColor', strokeWidth: 1.7 }),
  h('path', {
    d: 'M2.6 8.2c-1 1.1-1.5 2.3-1.5 3.6 0 1.4.5 2.6 1.5 3.7M21.4 8.2c1 1.1 1.5 2.3 1.5 3.6 0 1.4-.5 2.6-1.5 3.7',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    opacity: 0.7,
  }));
}

export const MENU_ICONS: Record<string, string> = {
  link: '<path d="M9.5 14.5 14.5 9.5M7.1 16.9a3.5 3.5 0 0 1 0-5l2.1-2.1M16.9 7.1a3.5 3.5 0 0 1 0 5l-2.1 2.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="16" cy="7" r="2.4" stroke="currentColor" stroke-width="1.7"/><circle cx="8" cy="17" r="2.4" stroke="currentColor" stroke-width="1.7"/>',
  cloud: '<path d="M6.5 18h10.2a4.3 4.3 0 0 0 .7-8.5A5.5 5.5 0 0 0 7 8.6 4.7 4.7 0 0 0 6.5 18Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  wallet: '<rect x="3.5" y="6" width="17" height="13" rx="3" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 10h17M16 14.5h2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  bell: '<path d="M6 10a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6ZM10 20h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  apps: '<rect x="3.5" y="3.5" width="7.2" height="7.2" rx="1.8" stroke="currentColor" stroke-width="1.7"/><rect x="13.3" y="3.5" width="7.2" height="7.2" rx="1.8" stroke="currentColor" stroke-width="1.7"/><rect x="3.5" y="13.3" width="7.2" height="7.2" rx="1.8" stroke="currentColor" stroke-width="1.7"/><rect x="13.3" y="13.3" width="7.2" height="7.2" rx="1.8" stroke="currentColor" stroke-width="1.7"/>',
  timer: '<circle cx="12" cy="13.5" r="7" stroke="currentColor" stroke-width="1.7"/><path d="M12 9.5v4l2.8 1.7M9 2.8h6M12 2.8v2.2M18.8 6.2l1.5-1.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  info: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v6M12 7.2v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};

export function MenuIcon({ name }: MenuIconProps): React.ReactElement {
  return h('svg', {
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': true,
    dangerouslySetInnerHTML: { __html: MENU_ICONS[name] || MENU_ICONS.info },
  });
}
