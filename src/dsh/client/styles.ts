/**
 * The remote console's stylesheet.
 *
 * It intentionally mirrors DSH's settings dialog rather than inventing a new
 * visual language: a 188px navigation rail, a 54px header row, the same type
 * scale, hairline rows instead of cards, and the shared `--dsw-*` tokens. The
 * `--drc-*` aliases only supply fallbacks for tokens missing from older DSH
 * builds, so the page inherits the host theme in both light and dark modes.
 */

export const CSS = `
.drc-page {
  --drc-text: var(--dsw-alias-label-primary);
  --drc-muted: var(--dsw-alias-label-secondary);
  --drc-tertiary: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  --drc-border: var(--dsw-alias-border-l2, var(--dsw-alias-border-l1));
  --drc-hairline: var(--dsw-alias-border-l4, var(--dsw-alias-border-l1));
  --drc-card-border: var(--dsw-alias-border-l1, var(--dsw-alias-border-l2));
  --drc-surface: var(--dsw-alias-bg-layer-1);
  --drc-surface-2: var(--dsw-alias-bg-layer-2);
  --drc-surface-3: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-1));
  --drc-hover: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
  --drc-accent: var(--dsw-alias-brand-primary);
  --drc-success: var(--dsw-alias-state-success-primary);
  --drc-error: var(--dsw-alias-state-error-primary);
  --drc-radius: var(--dsw-radius-md, 8px);
  --drc-radius-sm: var(--dsw-radius-sm, 6px);
  --drc-card-radius: var(--dsw-radius-lg, 12px);
  height: 100%;
  max-height: none;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--drc-text);
  background: var(--dsw-alias-bg-base);
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
}

.drc-shell {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 188px minmax(0, 1fr);
  grid-template-rows: 54px minmax(0, 1fr);
  grid-template-areas:
    'title head'
    'nav main';
}

.drc-nav-title {
  grid-area: title;
  padding: 22px 12px 8px 24px;
  overflow: hidden;
  color: var(--drc-text);
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.drc-head {
  grid-area: head;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
  height: 54px;
  padding: 10px 20px 14px 10px;
  box-sizing: border-box;
}

.drc-head-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
  min-width: 0;
}

.drc-nav {
  grid-area: nav;
  min-width: 0;
  min-height: 0;
  padding: 10px 12px 0;
  overflow-y: auto;
  box-sizing: border-box;
}

.drc-nav-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
}

.drc-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 40px;
  padding: 9px 16px 9px 12px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--drc-radius);
  background: transparent;
  color: var(--drc-text);
  font: inherit;
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
  text-align: left;
  cursor: pointer;
}

.drc-nav-item svg {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}

.drc-nav-item:hover {
  background: var(--drc-hover);
}

.drc-nav-item.is-active {
  background: var(--dsw-specific-sidebar-nav-item-active, var(--dsw-alias-bg-layer-2));
  font-weight: 500;
}

.drc-nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.drc-nav-compact {
  padding: 0 16px 12px;
}

.drc-nav-select-wrap {
  position: relative;
  width: 100%;
}

.drc-nav-select {
  width: 100%;
  height: 40px;
  padding: 0 36px 0 12px;
  box-sizing: border-box;
  border: 0.5px solid var(--drc-hairline);
  border-radius: var(--drc-radius);
  outline: none;
  appearance: none;
  background: var(--dsw-alias-bg-layer-1, var(--drc-surface));
  color: var(--drc-text);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
}

.drc-nav-select:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, var(--drc-accent)));
  outline-offset: 1px;
}

.drc-nav-select-wrap::after {
  content: '';
  position: absolute;
  top: 50%;
  right: 14px;
  width: 7px;
  height: 7px;
  border-right: 1.5px solid var(--drc-muted);
  border-bottom: 1.5px solid var(--drc-muted);
  transform: translateY(-70%) rotate(45deg);
  pointer-events: none;
}

.drc-main {
  grid-area: main;
  min-width: 0;
  min-height: 0;
  padding: 0 24px 24px;
  overflow-y: auto;
  box-sizing: border-box;
  scrollbar-width: thin;
}

.drc-main::-webkit-scrollbar { width: 8px; }
.drc-main::-webkit-scrollbar-thumb { background: var(--drc-border); border-radius: 999px; }

.drc-section {
  width: 100%;
  max-width: 760px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--drc-text);
}

.drc-section-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 2px;
}

.drc-section-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}

.drc-intro {
  margin: 0;
  color: var(--drc-tertiary);
  font-size: 13px;
  line-height: 20px;
}

.drc-group {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0 16px;
  border: 0.5px solid var(--drc-card-border);
  border-radius: var(--drc-card-radius);
  background: var(--dsw-alias-bg-layer-1, var(--drc-surface));
  box-sizing: border-box;
}

.drc-group + .drc-group { margin-top: 0; }

.drc-group-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 0 4px;
}

.drc-group-title {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}

.drc-group-desc {
  margin: 0;
  color: var(--drc-tertiary);
  font-size: 12px;
  line-height: 18px;
}

/* Separator between distinct setting groups inside one card. Never use it
 * directly under the card header or between a control and its own action. */
.drc-divider {
  height: 0;
  margin: 8px 0;
  border-top: 0.5px solid var(--drc-border);
}

/* List rows keep a separator, but inset from both sides so it reads lighter
 * than the card border instead of touching the card edge. */
.drc-list-row + .drc-list-row,
.drc-order-row + .drc-order-row,
.drc-status-row + .drc-status-row,
.drc-map-row + .drc-map-row,
.drc-client + .drc-client {
  position: relative;
}

.drc-list-row + .drc-list-row::before,
.drc-order-row + .drc-order-row::before,
.drc-status-row + .drc-status-row::before,
.drc-map-row + .drc-map-row::before,
.drc-client + .drc-client::before {
  content: '';
  position: absolute;
  top: 0;
  right: 12px;
  left: 12px;
  height: 0.5px;
  background: var(--drc-border);
}

.drc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 10px 0;
}

/* A card without a header (for example the pomodoro timer group) starts
 * directly with its first row; keep the same top breathing room as a card
 * header would give it. */
.drc-group > .drc-row:first-child { padding-top: 16px; }

.drc-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.drc-row-title {
  font-size: 14px;
  line-height: 22px;
  font-weight: 400;
}

.drc-row-desc {
  color: var(--drc-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.drc-row-control {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.drc-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--drc-radius);
  background: transparent;
  color: var(--drc-text);
  box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l3, var(--drc-border));
  font: inherit;
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
  white-space: nowrap;
  cursor: pointer;
}

.drc-btn:hover:not(:disabled) { background: var(--drc-hover); }

.drc-btn.is-primary {
  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-label-primary));
  color: var(--dsw-alias-label-primary-foreground, var(--dsw-alias-bg-layer-3));
  box-shadow: none;
}

.drc-btn.is-primary:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-label-primary));
}

.drc-btn.is-danger {
  color: var(--drc-error);
  box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--drc-error) 35%, transparent);
}

.drc-btn.is-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--drc-error) 10%, transparent);
}

.drc-btn.is-sm {
  height: 28px;
  padding: 0 10px;
  border-radius: var(--drc-radius-sm);
  font-size: 12px;
  line-height: 18px;
}

.drc-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.drc-btn:focus-visible,
.drc-nav-item:focus-visible,
.drc-toggle:focus-visible,
.drc-seg button:focus-visible,
.drc-city-option:focus-visible,
.drc-app:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, var(--drc-accent)));
  outline-offset: 1px;
}

.drc-toggle {
  position: relative;
  flex: 0 0 auto;
  width: 36px;
  height: 20px;
  padding: 2px;
  border: 0;
  border-radius: 999px;
  corner-shape: round;
  background: var(--dsw-alias-border-l3, var(--drc-border));
  cursor: pointer;
}

.drc-toggle i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  corner-shape: round;
  background: var(--dsw-alias-switch-thumb, var(--drc-muted));
  transition: transform 120ms ease, background 120ms ease;
}

.drc-toggle.is-on { background: var(--drc-accent); }
.drc-toggle.is-on i {
  transform: translateX(16px);
  background: var(--dsw-alias-label-primary-foreground, #fff);
}

.drc-seg {
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 2px;
  max-width: 100%;
  padding: 4px;
  border-radius: var(--drc-radius);
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
  box-sizing: border-box;
}

.drc-seg button {
  height: 28px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--drc-radius-sm);
  background: transparent;
  color: var(--drc-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.drc-seg button.is-active {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--drc-text);
  box-shadow: var(--dsw-elevation-soft, 0 1px 2px rgb(0 0 0 / 8%));
}

.drc-seg button[aria-pressed='false']:hover { color: var(--drc-text); }

.drc-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 10px 0;
}

/* Countdown presets are a vertical list: one preset per row, the input grows
 * and the remove action stays on the same line. */
.drc-preset-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 8px 0;
}

.drc-preset-main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1 1 auto;
  min-width: 0;
}

.drc-preset-label {
  flex: 0 0 auto;
  min-width: 96px;
  color: var(--drc-text);
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
}

/* Countdown presets read as "x 分 y 秒": two compact fields with unit labels. */
.drc-preset-duration {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
}

.drc-preset-row .drc-preset-part {
  flex: 0 1 92px;
  width: 92px;
  min-width: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.drc-preset-unit {
  flex: 0 0 auto;
  color: var(--drc-tertiary);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
}

.drc-preset-count {
  color: var(--drc-tertiary);
  font-size: 12px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}

.drc-field {
  flex: 1 1 190px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.drc-field > span {
  color: var(--drc-text);
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}

.drc-field input {
  width: 100%;
  height: 34px;
  padding: 0 12px;
  box-sizing: border-box;
  border: 0.5px solid var(--drc-hairline);
  border-radius: var(--drc-radius);
  outline: none;
  background: var(--drc-surface-3);
  color: var(--drc-text);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
}

.drc-field input::placeholder { color: var(--dsw-alias-label-dimmed, var(--drc-tertiary)); }
.drc-field input:focus { border-color: var(--dsw-alias-state-business-primary, var(--drc-accent)); }
.drc-field input:disabled { opacity: 0.5; cursor: not-allowed; }

/* City combobox: the field keeps the normal label/input layout and hosts the
 * suggestion list in an absolutely positioned popover so the card never
 * reflows while typing. */
.drc-city { position: relative; }

.drc-city-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  left: 0;
  z-index: 30;
  max-height: 236px;
  padding: 4px;
  overflow-y: auto;
  border: 0.5px solid var(--drc-card-border);
  border-radius: var(--drc-radius);
  background: var(--dsw-alias-bg-layer-1, var(--drc-surface));
  box-shadow: var(--dsw-elevation-soft, 0 12px 32px rgb(0 0 0 / 18%));
  box-sizing: border-box;
  scrollbar-width: thin;
}

.drc-city-option {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: var(--drc-radius-sm);
  background: transparent;
  color: var(--drc-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.drc-city-option.is-active { background: var(--drc-hover); }

.drc-city-name {
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}

.drc-city-meta {
  color: var(--drc-tertiary);
  font-size: 11px;
  line-height: 17px;
}

.drc-city-empty {
  padding: 8px 10px;
  color: var(--drc-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.drc-city-empty.is-error { color: var(--drc-error); }

.drc-city-error-title,
.drc-city-error-detail { display: block; }

.drc-city-error-detail {
  margin-top: 2px;
  color: var(--drc-tertiary);
  font-size: 10px;
  line-height: 15px;
  overflow-wrap: anywhere;
}

.drc-list {
  display: flex;
  flex-direction: column;
}

.drc-list-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  font-size: 13px;
  line-height: 20px;
}

.drc-list-row label {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.drc-list-row input[type='checkbox'] {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--drc-accent);
  cursor: inherit;
}

.drc-code {
  color: var(--drc-tertiary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 17px;
  overflow-wrap: anywhere;
}

.drc-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 0;
}

.drc-actions-stack {
  flex-direction: column;
  align-items: flex-start;
}

.drc-qr {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
  padding: 4px 0 12px;
}

.drc-qr-frame {
  flex: 0 0 auto;
  width: 176px;
  height: 176px;
  padding: 8px;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  border-radius: var(--drc-radius);
  background: #fff;
  box-shadow: var(--dsw-elevation-soft, 0 8px 24px rgb(0 0 0 / 14%));
}

.drc-qr-frame img {
  display: block;
  width: 160px;
  height: 160px;
  image-rendering: pixelated;
}

.drc-qr-copy { flex: 1 1 280px; min-width: 220px; }

.drc-url {
  display: block;
  max-height: 62px;
  margin-top: 12px;
  padding: 8px 10px;
  overflow: hidden;
  border: 0.5px solid var(--drc-hairline);
  border-radius: var(--drc-radius);
  background: var(--drc-surface-3);
  color: var(--drc-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-wrap: anywhere;
}

.drc-apps {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 0;
}

.drc-app {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 0.5px solid var(--drc-hairline);
  border-radius: 999px;
  background: transparent;
  color: var(--drc-muted);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}

.drc-app i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.55;
}

.drc-app.is-on {
  border-color: transparent;
  background: color-mix(in srgb, var(--drc-accent) 10%, transparent);
  color: var(--drc-text);
}

.drc-app.is-on i { background: var(--drc-accent); opacity: 1; }

.drc-map-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
}

.drc-map-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.drc-map-input {
  width: 100%;
  height: 34px;
  padding: 0 12px;
  box-sizing: border-box;
  border: 0.5px solid var(--drc-hairline);
  border-radius: var(--drc-radius);
  outline: none;
  background: var(--drc-surface-3);
  color: var(--drc-text);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
}

.drc-map-input:focus { border-color: var(--dsw-alias-state-business-primary, var(--drc-accent)); }

.drc-map-key {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.drc-map-meta {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.drc-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  corner-shape: round;
  background: var(--dsw-alias-bg-module-platform, var(--drc-surface-2));
  color: var(--drc-muted);
  font-size: 11px;
  font-weight: 500;
  line-height: 17px;
  white-space: nowrap;
}

.drc-tag[data-tone='outline'] {
  border: 0.5px solid var(--drc-hairline);
  background: transparent;
  color: var(--drc-tertiary);
}

.drc-tag[data-tone='success'] {
  background: color-mix(in srgb, var(--drc-success) 10%, transparent);
  color: var(--drc-success);
}

.drc-tag[data-tone='warning'] {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, var(--drc-accent)) 12%, transparent);
  color: var(--dsw-alias-state-warn-primary, var(--drc-accent));
}

.drc-tag[data-tone='danger'] {
  background: color-mix(in srgb, var(--drc-error) 10%, transparent);
  color: var(--drc-error);
}

.drc-order-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 20px;
  cursor: grab;
  touch-action: none;
  transition: opacity 150ms ease;
}

.drc-order-row.is-dragging {
  position: absolute;
  width: 0;
  height: 0;
  min-height: 0;
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  visibility: hidden;
  overflow: hidden;
  pointer-events: none;
  transition: none;
}

.drc-order-row b {
  width: 18px;
  color: var(--drc-tertiary);
  font-family: ui-monospace, monospace;
  font-size: 11px;
  font-weight: 500;
}

.drc-order-row .drc-order-label { flex: 1; min-width: 0; }

.drc-drag-handle {
  color: var(--drc-tertiary);
  font-size: 12px;
  letter-spacing: -2px;
  cursor: grab;
}

.drc-order-placeholder {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 41px;
  padding: 0 12px;
  border: 1px dashed var(--drc-accent);
  border-radius: var(--drc-radius);
  background: color-mix(in srgb, var(--drc-accent) 9%, transparent);
  pointer-events: none;
}

.drc-order-placeholder-title {
  color: var(--drc-accent);
  font-size: 13px;
  font-weight: 500;
}

.drc-order-placeholder .drc-drag-handle {
  color: var(--drc-accent);
  cursor: grabbing;
}

body.drc-sorting,
body.drc-sorting * {
  user-select: none !important;
  cursor: grabbing !important;
}

.drc-order-end { height: 8px; }

.drc-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 0;
}

.drc-status-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.drc-status-label {
  font-size: 13px;
  line-height: 20px;
}

.drc-status-detail {
  color: var(--drc-tertiary);
  font-size: 11px;
  line-height: 17px;
  overflow-wrap: anywhere;
}

.drc-status {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--drc-muted);
  font-size: 12px;
  line-height: 18px;
}

.drc-dot {
  position: relative;
  display: inline-block;
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  color: var(--dsw-alias-state-idle-primary);
}

.drc-dot::after {
  content: '';
  position: absolute;
  inset: 20%;
  border-radius: 50%;
  background: currentColor;
}

.drc-dot.ok { color: var(--drc-success); }
.drc-dot.bad { color: var(--drc-error); }

.drc-client {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
}

.drc-client-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.drc-client strong {
  display: block;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}

.drc-client small {
  display: block;
  color: var(--drc-tertiary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 17px;
}

.drc-banner {
  margin: 0 0 12px;
  padding: 8px 12px;
  border-radius: var(--drc-radius);
  background: var(--drc-surface-2);
  font-size: 12px;
  line-height: 18px;
}

.drc-banner.is-error {
  background: color-mix(in srgb, var(--drc-error) 10%, transparent);
  color: var(--drc-error);
}

.drc-banner.is-ok {
  background: color-mix(in srgb, var(--drc-success) 10%, transparent);
  color: var(--drc-success);
}

.drc-fact-columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 0 32px;
  padding: 2px 0 0;
}

.drc-fact-column { min-width: 0; }

.drc-fact-row {
  position: relative;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 0;
  min-width: 0;
}

.drc-fact-row + .drc-fact-row::before,
.drc-fact-columns + .drc-fact-row::before {
  content: '';
  position: absolute;
  top: 0;
  right: 12px;
  left: 12px;
  height: 0.5px;
  background: var(--drc-border);
}

.drc-fact-key {
  flex: 0 0 auto;
  color: var(--drc-tertiary);
  font-size: 11px;
  line-height: 17px;
}

.drc-fact-value {
  min-width: 0;
  color: var(--drc-muted);
  font-size: 11px;
  line-height: 17px;
  text-align: right;
  overflow-wrap: anywhere;
}

.drc-backends {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 0 8px;
}

.drc-empty {
  margin: 0;
  padding: 12px 0;
  color: var(--drc-tertiary);
  font-size: 12px;
  line-height: 18px;
}

@media (max-width: 767px) {
  .drc-shell {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: auto auto minmax(0, 1fr);
    grid-template-areas:
      'title head'
      'nav nav'
      'main main';
  }

  .drc-nav-title { padding: 22px 0 0 16px; }
  .drc-head { height: auto; padding: 20px 16px 8px 10px; }
  .drc-nav { padding: 0; }
  .drc-nav-compact { padding: 0 16px 12px; }
  .drc-main { padding: 0 16px 24px; }
}
`;
