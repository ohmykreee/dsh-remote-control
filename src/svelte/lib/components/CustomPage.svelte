<script lang="ts">
  import { app } from '../state.svelte';
  import { pageLabel } from '../i18n.svelte';

  // The address is already normalized by the state layer; it always points at
  // a real http(s) page, with the built-in address as the fallback.
  const url = $derived(app.customPageUrl);
  const title = $derived(pageLabel('custom'));
</script>

<div class="custom-page">
  <iframe
    class="custom-frame"
    src={url}
    title={title}
    loading="lazy"
    referrerpolicy="no-referrer"
    allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write"
    allowfullscreen
  ></iframe>
</div>

<style>
  /* Match the Quick Q&A page: no card chrome and no extra background layer,
     so the native console background (with its subtle gradient) shows through
     a transparent document instead of an opaque solid color. */
  .custom-page {
    position: relative;
    isolation: isolate;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: transparent;
  }

  .custom-frame {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
    /* The console root sets `color-scheme: dark`. Letting the iframe inherit it
       makes Chromium paint a transparent document over an opaque white canvas;
       `normal` keeps the frame transparent so the native background shows. */
    color-scheme: normal;
  }
</style>
