/**
 * OS "reduce motion" preference for the console.
 *
 * Only programmatic motion is dropped: rail taps jump straight to the page, the
 * music wave becomes the plain progress line, the mic level ring stops
 * interpolating, and the quick-answer loader holds its first frame. Gesture
 * scrolling keeps its snap behaviour — that movement is the user's own, not a
 * playback animation.
 */

/** Reactive mirror of `prefers-reduced-motion: reduce`. */
export const motion = $state({ reduced: false });

const query = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

if (query) {
  motion.reduced = query.matches;
  query.addEventListener('change', (event) => {
    motion.reduced = event.matches;
  });
}
