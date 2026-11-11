/** Tiny SVG renderer around the vendored MIT qrcode-generator. */

import { createRequire } from 'node:module';
import { escapeHtml } from './util.js';

const require = createRequire(import.meta.url);
const qrcode = require('../vendor/qrcode.cjs');

const cache = new Map();

export function qrSvg(text, options = {}) {
  const key = `${text}|${options.cellSize ?? 8}|${options.margin ?? 4}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const qr = qrcode(0, 'M');
  qr.addData(String(text));
  qr.make();
  const count = qr.getModuleCount();
  const cell = Math.max(2, Math.min(16, Number(options.cellSize) || 8));
  const margin = Math.max(0, Math.min(12, Number(options.margin) || 4));
  const size = (count + margin * 2) * cell;
  let path = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!qr.isDark(row, col)) continue;
      const x = (col + margin) * cell;
      const y = (row + margin) * cell;
      path += `M${x} ${y}h${cell}v${cell}h-${cell}z`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHtml(options.label || 'Pairing QR code')}"><rect width="${size}" height="${size}" rx="${Math.round(cell * 1.5)}" fill="#ffffff"/><path d="${path}" fill="#0a0d14" shape-rendering="crispEdges"/></svg>`;
  cache.set(key, svg);
  if (cache.size > 20) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  return svg;
}
