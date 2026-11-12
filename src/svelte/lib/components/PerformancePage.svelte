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
:global(.performance-grid) {
display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(280px, 27%, 330px);
  gap: 14px;
  height: 100%;
  min-height: 0;
}

:global(.performance-main) {
display: grid;
  grid-template-rows: minmax(0, 1.12fr) minmax(0, 0.88fr);
  gap: 14px;
  min-height: 0;
}

:global(.perf-combo) {
position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 18px 20px;
  overflow: hidden;
  background:
    radial-gradient(90% 110% at 100% 0%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 62%),
    var(--card);
}

:global(.perf-combo::after) {
content: "";
  position: absolute;
  right: -80px;
  bottom: -110px;
  width: 230px;
  height: 230px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--accent) 16%, transparent);
  pointer-events: none;
}

:global(.perf-combo-head) {
position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

:global(.perf-combo-head h2) {
margin: 4px 0 0;
  font-size: 21px;
  line-height: 1.05;
  letter-spacing: -0.03em;
  font-weight: 600;
}

:global(.perf-combo-head .perf-chip) {
flex: 0 0 auto;
}

:global(.perf-model-name) {
margin: 0;
  max-width: 58%;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
  font-weight: 550;
  text-align: right;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

:global(.perf-combo-body) {
position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px;
  padding-top: 14px;
}

:global(.perf-pane) {
min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

:global(.perf-pane + .perf-pane) {
padding-left: 22px;
  border-left: 1px solid var(--line);
}

:global(.perf-pane-head) {
display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

:global(.perf-head) {
display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

:global(.perf-chip) {
padding: 5px 9px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

:global(.perf-ring) {
--p: 0;
  position: relative;
  width: 148px;
  height: 148px;
  margin: 8px auto 4px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: conic-gradient(var(--accent) calc(var(--p) * 1%), color-mix(in srgb, var(--text) 8%, transparent) 0);
  box-shadow: 0 0 34px color-mix(in srgb, var(--accent) 16%, transparent);
}

:global(.perf-ring::before) {
content: "";
  position: absolute;
  inset: 9px;
  border-radius: 50%;
  background: var(--card);
}

:global(.perf-ring-copy) {
position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  gap: 2px;
  font-variant-numeric: tabular-nums;
}

:global(.perf-ring-copy strong) {
font-size: 40px;
  line-height: 1;
  font-weight: 580;
  letter-spacing: -0.03em;
}

:global(.perf-ring-copy span) {
color: var(--muted);
  font-size: 13px;
  margin-top: 3px;
}

:global(.perf-ring-sm) {
width: 122px;
  height: 122px;
  margin-top: 14px;
}

:global(.perf-ring-sm .perf-ring-copy strong) {
font-size: 33px;
}

:global(.perf-cpu-main) {
flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding-top: 2px;
}

:global(.perf-gpu-main) {
flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding-top: 2px;
}

:global(.perf-gpu-main) {
gap: 8px;
}

:global(.perf-facts) {
display: flex;
  justify-content: center;
  gap: 26px;
}

:global(.perf-facts span) {
display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

:global(.perf-facts b) {
display: block;
  height: 1.25em;
  line-height: 1.25;
  font-size: 12.5px;
  font-weight: 580;
  font-variant-numeric: tabular-nums;
}

:global(.perf-facts small) {
color: var(--faint);
  font-size: 8.5px;
  line-height: 1.2;
}

:global(.perf-memory-main) {
flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  padding-top: 6px;
}

:global(.perf-vram-main) {
flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  padding-top: 6px;
}

:global(.perf-big) {
display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 7px;
  font-variant-numeric: tabular-nums;
}

:global(.perf-big strong) {
font-size: 50px;
  line-height: 1;
  font-weight: 580;
  letter-spacing: -0.03em;
}

:global(.perf-big span) {
color: var(--muted);
  font-size: 15px;
}

:global(.perf-bar) {
width: 100%;
  height: 6px;
  margin-top: 16px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text) 8%, transparent);
  overflow: hidden;
}

:global(.perf-bar i) {
display: block;
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent), var(--cyan));
  transition: width 0.35s ease;
}

:global(.perf-note) {
margin: 8px 0 0;
  color: var(--faint);
  font-size: 9.5px;
  line-height: 1.4;
  text-align: center;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

@media (max-height: 760px) {
  :global(.performance-grid) {
    grid-template-columns: minmax(0, 1fr) clamp(240px, 27%, 280px);
    gap: 10px;
  }
  :global(.performance-main) {
    grid-template-rows: minmax(0, 1.08fr) minmax(0, 0.92fr);
    gap: 10px;
  }
  :global(.perf-combo) {
    padding: 12px 14px;
  }
  :global(.perf-combo-head) {
    padding-bottom: 8px;
  }
  :global(.perf-combo-head h2) {
    font-size: 18px;
  }
  :global(.perf-model-name) {
    font-size: 10.5px;
  }
  :global(.perf-combo-body) {
    gap: 14px;
    padding-top: 10px;
  }
  :global(.perf-pane + .perf-pane) {
    padding-left: 14px;
  }
  :global(.perf-ring) {
    width: 108px;
    height: 108px;
    margin: 4px auto 2px;
  }
  :global(.perf-ring-copy strong) {
    font-size: 28px;
  }
  :global(.perf-ring-sm) {
    width: 92px;
    height: 92px;
    margin-top: 8px;
  }
  :global(.perf-ring-sm .perf-ring-copy strong) {
    font-size: 24px;
  }
  :global(.perf-facts) {
    gap: 14px;
  }
  :global(.perf-facts b) {
    font-size: 11px;
  }
  :global(.perf-big strong) {
    font-size: 34px;
  }
  :global(.perf-big span) {
    font-size: 12px;
  }
  :global(.perf-bar) {
    margin-top: 10px;
  }
  :global(.perf-note) {
    margin-top: 5px;
  }
}

@media (orientation: portrait) {
  :global(.performance-grid) {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 100%;
    gap: 12px;
  }
  :global(.performance-main) {
    grid-template-rows: auto auto;
    gap: 12px;
  }
  :global(.perf-combo) {
    min-height: 300px;
  }
  :global(.perf-combo-body) {
    grid-template-columns: 1fr;
    gap: 14px;
  }
  :global(.perf-pane + .perf-pane) {
    padding-left: 0;
    border-left: 0;
    border-top: 1px solid var(--line);
    padding-top: 14px;
  }
}

@media (max-height: 500px) {
  :global(.perf-combo) {
    padding: 8px 10px;
  }
  :global(.perf-combo-head) {
    padding-bottom: 5px;
  }
  :global(.perf-combo-head h2) {
    font-size: 15px;
  }
  :global(.perf-model-name) {
    font-size: 9px;
  }
  :global(.perf-combo-body) {
    gap: 10px;
    padding-top: 6px;
  }
  :global(.perf-pane + .perf-pane) {
    padding-left: 10px;
  }
  :global(.perf-pane-head .kicker) {
    font-size: 8px;
  }
  :global(.perf-chip) {
    padding: 3px 6px;
    font-size: 8px;
  }
  :global(.perf-ring) {
    width: 66px;
    height: 66px;
    margin: 2px auto;
  }
  :global(.perf-ring::before) {
    inset: 5px;
  }
  :global(.perf-ring-copy strong) {
    font-size: 18px;
  }
  :global(.perf-ring-copy span) {
    margin-top: 1px;
    font-size: 8px;
  }
  :global(.perf-ring-sm) {
    width: 60px;
    height: 60px;
    margin-top: 2px;
  }
  :global(.perf-ring-sm .perf-ring-copy strong) {
    font-size: 17px;
  }
  :global(.perf-facts) {
    gap: 8px;
  }
  :global(.perf-facts b) {
    font-size: 9px;
  }
  :global(.perf-facts small) {
    font-size: 7px;
  }
  :global(.perf-big strong) {
    font-size: 24px;
  }
  :global(.perf-big span) {
    font-size: 9px;
  }
  :global(.perf-bar) {
    height: 4px;
    margin-top: 5px;
  }
  :global(.perf-note) {
    margin-top: 3px;
    font-size: 8px;
  }
}
</style>
