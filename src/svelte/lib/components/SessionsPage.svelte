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
