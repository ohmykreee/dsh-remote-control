<script lang="ts">
  import { app } from '../state.svelte';
  import BalanceCard from './BalanceCard.svelte';
  import SessionList from './SessionList.svelte';
  import SessionStats from './SessionStats.svelte';
  import SpendCard from './SpendCard.svelte';

  const sessions = $derived(app.sessions);
  const error = $derived(app.sessionsError);
</script>

<div class="sessions-grid">
  <aside class="billing-column">
    <BalanceCard />
    <SpendCard />
    <SessionStats {sessions} />
  </aside>
  <SessionList {sessions} {error} />
</div>

<style>
.sessions-grid {
display: grid;
  grid-template-columns: clamp(300px, 32%, 380px) minmax(0, 1fr);
  gap: 14px;
  height: 100%;
  min-height: 0;
}

.billing-column {
display: grid;
  grid-template-rows: minmax(0, 1.3fr) minmax(0, 0.95fr) minmax(0, 0.62fr);
  gap: 12px;
  min-height: 0;
}

@media (max-height: 760px) {
  .sessions-grid {
    grid-template-columns: clamp(250px, 32%, 310px) minmax(0, 1fr);
    gap: 10px;
  }
  .billing-column {
    gap: 8px;
  }
}

@media (orientation: portrait) {
  .sessions-grid {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 100%;
    gap: 14px;
  }
  .billing-column {
    grid-template-rows: auto auto auto;
    gap: 12px;
  }
}
</style>
