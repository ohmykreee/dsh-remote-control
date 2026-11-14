/**
 * Browser entry for the dsh-remote-control sidebar page.
 *
 * `scripts/build-dsh.mjs` compiles the modules under this directory and wraps
 * them in the DSH module-loader factory; the package still exposes the result
 * as a single `client.js`. This file only wires the DSH lifecycle: locale
 * registration, theme synchronization, the sidebar launcher, and the main
 * panel registration.
 */

import { LOCALE_URL, THEME_URL } from './api.js';
import { DICTS, NS, configureLocale, en, translate, zh } from './i18n.js';
import { PanelIcon } from './icons.js';
import { RemotePanel } from './panel.js';
import type { ClientContext, ThemeSnapshot } from './types.js';

const PANEL_ID = 'remote-control';

export const inject: string[] = ['slots', 'locale', 'theme'];

export function apply(ctx: ClientContext): void {
  configureLocale(ctx.locale);
  ctx.effect(() => ctx.locale.register(NS, DICTS), 'dsh-remote-control: dictionaries');
  ctx.effect(() => {
    /**
     * Tell the Host which language DSH actually renders. The phone console has
     * no access to the DSH locale service, so "follow DSH" can only be resolved
     * once this snapshot reaches the Host.
     */
    const sync = (): void => {
      try {
        const snapshot = ctx.locale.getLocale?.() ?? ctx.locale.getSnapshot?.();
        const active = String(snapshot?.active || '');
        if (!active) return;
        void fetch(LOCALE_URL, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ locale: active }),
        }).catch(() => {});
      } catch {
        /* a locale service without snapshots still renders the bundled default */
      }
    };
    sync();
    let off: (() => void) | undefined;
    try {
      off = ctx.locale.subscribe?.(sync);
    } catch {
      off = undefined;
    }
    return () => {
      try {
        off?.();
      } catch {
        /* ignore a disposed locale service */
      }
    };
  }, 'dsh-remote-control: locale sync');
  ctx.effect(() => {
    let active = true;
    const sync = (snapshot?: ThemeSnapshot): void => {
      if (!active) return;
      const scheme = snapshot?.active?.colorScheme || ctx.theme?.getTheme?.()?.active?.colorScheme;
      if (!scheme) return;
      void fetch(THEME_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ theme: scheme }),
      }).catch(() => {});
    };
    sync(ctx.theme?.getTheme?.());
    const off = ctx.on?.('theme/change', sync);
    return () => {
      active = false;
      try { off?.(); } catch { /* ignore */ }
    };
  }, 'dsh-remote-control: theme sync');
  ctx.effect(
    () => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 12,
      label: () => translate('title'),
    }, PanelIcon)),
    'dsh-remote-control: sidebar launcher',
  );
  ctx.effect(
    () => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, RemotePanel)),
    'dsh-remote-control: settings panel',
  );
}

export const __test = { zh, en, PanelIcon, RemotePanel };
