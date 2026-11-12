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
