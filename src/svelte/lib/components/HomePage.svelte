<script lang="ts">
  import ClockCard from './ClockCard.svelte';
  import NotificationsCard from './NotificationsCard.svelte';
</script>

<div class="home-grid">
  <ClockCard />
  <NotificationsCard />
</div>

<style>
  .home-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(360px, 42%, 440px);
    gap: 12px;
    height: 100%;
    min-height: 0;
  }

  @media (max-height: 760px) {
    .home-grid {
      gap: 10px;
    }
  }

  @media (orientation: portrait) {
    .home-grid {
      grid-template-columns: 1fr;
      height: auto;
      min-height: 100%;
      gap: 12px;
    }
  }
</style>
