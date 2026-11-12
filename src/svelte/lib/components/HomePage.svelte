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
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  gap: 18px;
  height: 100%;
  min-height: 0;
}

@media (max-height: 760px) {
  .home-grid {
    gap: 12px;
  }
}

@media (orientation: portrait) {
  .home-grid {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 100%;
    gap: 14px;
  }
}
</style>
