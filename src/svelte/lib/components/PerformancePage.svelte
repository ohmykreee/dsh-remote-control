<script lang="ts">
  import CpuMemoryCard from './CpuMemoryCard.svelte';
  import GpuCard from './GpuCard.svelte';
  import ThermalCard from './ThermalCard.svelte';
</script>

<div class="performance-grid">
  <div class="performance-main">
    <CpuMemoryCard />
    <GpuCard />
  </div>
  <ThermalCard />
</div>

<style>
  .performance-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(250px, 28%, 316px);
    gap: 12px;
    height: 100%;
    min-height: 0;
  }

  .performance-main {
    display: grid;
    grid-template-rows: repeat(2, minmax(0, 1fr));
    gap: 10px;
    min-height: 0;
  }

  @media (max-height: 760px) {
    .performance-grid {
      grid-template-columns: minmax(0, 1fr) clamp(238px, 30%, 280px);
      gap: 10px;
    }

    .performance-main {
      gap: 8px;
    }
  }

  @media (orientation: portrait) {
    .performance-grid {
      grid-template-columns: 1fr;
      height: auto;
      min-height: 100%;
      gap: 10px;
    }

    .performance-main {
      grid-template-rows: auto auto;
      gap: 10px;
    }
  }
</style>
