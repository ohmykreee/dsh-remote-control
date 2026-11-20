/**
 * Click-to-open lightbox for the one image attached to a Quick Q&A question.
 *
 * PhotoSwipe is a small, dependency-free lightbox with native pinch-zoom and
 * panning on touch, plus wheel zoom on desktop. The 84px attach preview and the
 * 49px chat thumbnail stay cropped with `object-fit: cover`; the lightbox reads
 * the image's natural size, so the opened image keeps its original aspect ratio
 * and can be zoomed further.
 */

import PhotoSwipeLightbox from 'photoswipe/lightbox';
import 'photoswipe/style.css';
import { t } from './i18n.svelte';

let lightbox: PhotoSwipeLightbox | null = null;

function getLightbox(): PhotoSwipeLightbox {
  if (!lightbox) {
    lightbox = new PhotoSwipeLightbox({
      dataSource: [],
      pswpModule: () => import('photoswipe'),
      wheelToZoom: true,
      bgOpacity: 0.92,
      showHideAnimationType: 'fade',
      padding: { top: 12, bottom: 12, left: 12, right: 12 },
      counter: false,
      arrowKeys: false,
      closeTitle: t('quickQaImageZoomClose'),
      zoomTitle: t('quickQaImageZoomZoom'),
      errorMsg: t('quickQaImageZoomError'),
    });
    lightbox.init();
  }
  return lightbox;
}

async function openImage(node: HTMLImageElement): Promise<void> {
  if (!node.complete) {
    await node.decode().catch(() => undefined);
  }
  const width = node.naturalWidth || node.clientWidth;
  const height = node.naturalHeight || node.clientHeight;
  const source = node.currentSrc || node.src;
  if (!width || !height || !source) return;
  const viewer = getLightbox();
  viewer.options.closeTitle = t('quickQaImageZoomClose');
  viewer.options.zoomTitle = t('quickQaImageZoomZoom');
  viewer.options.errorMsg = t('quickQaImageZoomError');
  viewer.loadAndOpen(0, [{
    src: source,
    width,
    height,
    alt: node.alt || undefined,
  }]);
}

/** Svelte action: click the image to open the zoomable lightbox. */
export function imageZoom(node: HTMLImageElement): { destroy(): void } {
  const onClick = (): void => {
    void openImage(node);
  };
  node.addEventListener('click', onClick);
  return {
    destroy() {
      node.removeEventListener('click', onClick);
    },
  };
}
