/**
 * Performance view backed by `dsh-probe performance`.
 *
 * CPU/memory/GPU/temperatures all come from Rust. Only when the sidecar is
 * unavailable does Node provide a pure-JS CPU/memory fallback (`os.cpus()` /
 * `os.totalmem()`); there is no WMI or PowerShell probe left.
 */

import os from 'node:os';
import { probeInfo, runProbe } from './probe.js';
import { clamp, finiteNumber, serializeError } from './util.js';

const PROBE_ERROR_TTL_MS = 8000;

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

function mapProbeGpu(gpu) {
  const total = finiteNumber(gpu.memoryTotal, null);
  const used = finiteNumber(gpu.memoryUsed, null);
  return {
    name: gpu.name || 'GPU',
    driver: gpu.driver || '',
    adapters: Array.isArray(gpu.adapters) ? gpu.adapters : [],
    utilization: finiteNumber(gpu.utilization, null),
    memoryUsed: used,
    memoryTotal: total,
    memoryPercent: finiteNumber(gpu.memoryPercent, null),
    ok: gpu.ok !== false,
    error: gpu.error || null,
    source: gpu.source || 'rust',
  };
}

export function createPerformanceService() {
  let previous = cpuTimes();
  let cpuUsage = 0;
  let probeError = null;
  let probeAt = 0;
  let inFlight = null;

  function sampleNodeCpu() {
    const current = cpuTimes();
    const idle = current.idle - previous.idle;
    const total = current.total - previous.total;
    previous = current;
    if (total > 0) {
      cpuUsage = clamp((1 - idle / total) * 100, 0, 100);
    }
    const cpus = os.cpus();
    const baseSpeed = finiteNumber(cpus[0]?.speed, null);
    return {
      usage: round(cpuUsage),
      model: cpus[0]?.model || 'CPU',
      cores: cpus.length,
      speed: baseSpeed,
      baseSpeed,
      uptime: os.uptime(),
      source: 'node',
    };
  }

  function nodeMemory() {
    const total = os.totalmem();
    const free = os.freemem();
    return {
      total,
      used: total - free,
      free,
      percent: total ? round(((total - free) / total) * 100) : 0,
      source: 'node',
    };
  }

  async function readProbePerformance() {
    if (!probeInfo().available) return null;
    if (probeError && Date.now() - probeAt < PROBE_ERROR_TTL_MS) return null;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const result = await runProbe(['performance'], { timeout: 12_000 });
        if (result?.ok === false) throw new Error(result.error || 'dsh-probe performance failed');
        probeError = null;
        return result;
      } catch (error) {
        probeError = serializeError(error);
        probeAt = Date.now();
        return null;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  async function sample() {
    const probe = await readProbePerformance();
    const probeCpu = probe?.cpu && typeof probe.cpu === 'object' ? probe.cpu : null;
    const probeMemory = probe?.memory && typeof probe.memory === 'object' ? probe.memory : null;

    const cpu = probeCpu
      ? {
          usage: finiteNumber(probeCpu.usage, 0) ?? 0,
          model: probeCpu.model || 'CPU',
          cores: finiteNumber(probeCpu.cores, null) || os.cpus().length,
          speed: finiteNumber(probeCpu.speedMhz, null),
          baseSpeed: finiteNumber(probeCpu.baseMhz, null),
          uptime: finiteNumber(probeCpu.uptime, os.uptime()) ?? os.uptime(),
          source: 'rust',
        }
      : sampleNodeCpu();

    const memory = probeMemory
      ? {
          total: finiteNumber(probeMemory.total, 0) ?? 0,
          used: finiteNumber(probeMemory.used, 0) ?? 0,
          free: finiteNumber(probeMemory.free, 0) ?? 0,
          percent: finiteNumber(probeMemory.percent, null)
            ?? (probeMemory.total ? round((probeMemory.used / probeMemory.total) * 100) : 0),
          source: 'rust',
        }
      : nodeMemory();

    let gpu;
    if (probe?.gpu) {
      gpu = mapProbeGpu(probe.gpu);
    } else {
      gpu = {
        name: 'GPU',
        ok: false,
        error: probe
          ? '当前平台没有可用的 GPU 读数'
          : probeInfo().error || probeError || 'native probe unavailable',
        source: 'none',
      };
    }

    const temperatures = [];
    const seen = new Set();
    for (const item of Array.isArray(probe?.temperatures) ? probe.temperatures : []) {
      const value = finiteNumber(item?.celsius, null);
      if (value === null || value < 5 || value > 125) continue;
      const name = String(item.name || '设备');
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      temperatures.push({ name, celsius: round(value) });
    }

    return {
      cpu,
      memory,
      gpu,
      temperatures,
      probe: {
        used: Boolean(probe),
        error: probe ? null : probeInfo().error || probeError,
      },
      sampledAt: Date.now(),
    };
  }

  return {
    sample,
    status: () => ({ cpu: cpuUsage, probeError }),
  };
}
