<script lang="ts">
  import type { MediaInfo } from '../types';
  import { t } from '../i18n.svelte';
  import Music2 from '@lucide/svelte/icons/music-2';

  let { media }: { media: MediaInfo | null } = $props();

  const thumbnail = $derived(media?.thumbnail || media?.thumbnailUrl || '');
  const fallbackText = $derived(media ? t('nowPlaying') : t('nothingPlaying'));
  let failed = $state(false);
  const showArt = $derived(Boolean(thumbnail) && !failed);

  $effect(() => {
    void thumbnail;
    failed = false;
  });
</script>

<div class="cover-shell" class:has-art={showArt}>
  <div class="cover-fallback">
    <span class="cover-fallback-icon">
      <Music2 class="size-6" strokeWidth={1.55} />
    </span>
    <span>{fallbackText}</span>
  </div>
  {#if showArt}
    <img
      class="cover-art"
      src={thumbnail}
      alt={t('albumCover')}
      draggable="false"
      referrerpolicy="no-referrer"
      onerror={() => (failed = true)}
    />
  {/if}
</div>

<style>
  .cover-shell {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--brand) 15%, var(--border));
    border-radius: 22px;
    background:
      radial-gradient(90% 90% at 30% 18%, color-mix(in srgb, var(--brand) 22%, transparent), transparent 62%),
      var(--surface-2);
    box-shadow: 0 24px 60px rgb(0 0 0 / 28%);
  }

  .cover-art {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cover-fallback {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--muted-foreground);
    font-size: 10px;
    letter-spacing: 0.02em;
  }

  .cover-shell.has-art .cover-fallback {
    display: none;
  }

  .cover-fallback-icon {
    display: grid;
    width: 48px;
    height: 48px;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--brand) 20%, transparent);
    border-radius: 15px;
    background: var(--brand-soft);
    color: var(--brand);
  }
</style>
