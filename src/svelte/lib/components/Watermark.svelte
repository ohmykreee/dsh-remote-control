<script lang="ts">
  import { iconMarkup } from '../icons';

  let { name }: { name: string } = $props();
  let svg: SVGSVGElement | null = $state(null);
  let viewBox = $state('0 0 24 24');

  // Match the original watermark: after the icon is in the DOM, tighten the
  // viewBox around its actual geometry and pin it to the bottom-right corner.
  $effect(() => {
    const current = name;
    if (!current || !svg) return;
    try {
      const box = svg.getBBox();
      if (box.width > 0 && box.height > 0) {
        const pad = 1.5;
        viewBox = `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`;
      }
    } catch {
      /* keep the default viewBox */
    }
  });
</script>

{#if name}
  <svg bind:this={svg} {viewBox} preserveAspectRatio="xMaxYMax meet" fill="none" aria-hidden="true">
    {@html iconMarkup(name)}
  </svg>
{/if}
