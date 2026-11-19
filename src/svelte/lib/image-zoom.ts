/**
 * Click-to-zoom preview for the one image attached to a Quick Q&A question.
 *
 * `medium-zoom` is a small framework-agnostic library that clones the image
 * into a fixed overlay, so the same action works for the 84px attach preview
 * and the 49px chat thumbnail. One shared instance keeps a single overlay and
 * lets each image detach cleanly when its state disappears.
 */

import mediumZoom, { type Zoom } from 'medium-zoom';

let zoom: Zoom | null = null;

function getZoom(): Zoom {
  zoom ??= mediumZoom({
    margin: 18,
    background: 'rgba(8, 11, 18, 0.9)',
  });
  return zoom;
}

/** Svelte action: click the image to open the floating zoom preview. */
export function imageZoom(node: HTMLImageElement): { destroy(): void } {
  getZoom().attach(node);
  return {
    destroy() {
      zoom?.detach(node);
    },
  };
}
