/**
 * Performance view backed by `dsh-probe performance`.
 *
 * CPU/memory/GPU/temperatures all come from Rust. Only when the sidecar is
 * unavailable does Node provide a pure-JS CPU/memory fallback (`os.cpus()` /
 * `os.totalmem()`); there is no WMI or PowerShell probe left.
 */

import os from 'node:os';
import { probeInfo, runProbe } from './probe.js';
import { isRecord, type JsonRecord } from './types.js';
import { clamp, finiteNumber, serializeError } from './util.js';

const PROBE_ERROR_TTL_MS = 8000;

/** CPU block: from Rust when the sidecar answers, otherwise from `os.cpus()`. */
export interface PerformanceCpu {
  usage: number;
  model: string;
  cores: number;
  speed: number | null;
  baseSpeed: number | null;
  uptime: number;
  source: 'node' | 'rust';
}

/** System memory in bytes, plus the usage percentage. */
export interface PerformanceMemory {
  total: number;
  used: number;
  free: number;
  percent: number;
  source: 'node' | 'rust';
}

/**
 * GPU block. `driver`, `adapters` and the memory/utilization readings are only
 * present when the probe reported a GPU; the fallback shape carries just
 * `name`, `ok`, `error` and `source`.
 */
export interface PerformanceGpu {
  name: string;
  ok: boolean;
  error: string | null;
  source: string;
  driver?: string;
  adapters?: unknown[];
  utilization?: number | null;
  memoryUsed?: number | null;
  memoryTotal?: number | null;
  memoryPercent?: number | null;
}

/** One temperature sensor reading in degrees Celsius. */
export interface PerformanceTemperature {
  name: string;
  celsius: number;
}

/** Whether the sidecar answered, and why it did not. */
export interface PerformanceProbeState {
  used: boolean;
  error: string | null;
}

/** Sampling result handed to the browser. */
export interface PerformancePayload {
  cpu: PerformanceCpu;
  memory: PerformanceMemory;
  gpu: PerformanceGpu;
  temperatures: PerformanceTemperature[];
  probe: PerformanceProbeState;
  sampledAt: number;
}

/** Diagnostic snapshot returned by `status()`. */
export interface PerformanceStatus {
  cpu: number;
  probeError: string | null;
}

export interface PerformanceService {
  sample(force?: boolean): Promise<PerformancePayload>;
  status(): PerformanceStatus;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

function mapProbeGpu(gpu: JsonRecord): PerformanceGpu {
  const total = finiteNumber(gpu.memoryTotal, null);
  const used = finiteNumber(gpu.memoryUsed, null);
  const adapters: unknown[] = Array.isArray(gpu.adapters) ? gpu.adapters : [];
  return {
    name: typeof gpu.name === 'string' && gpu.name ? gpu.name : 'GPU',
    driver: typeof gpu.driver === 'string' && gpu.driver ? gpu.driver : '',
    adapters,
    utilization: finiteNumber(gpu.utilization, null),
    memoryUsed: used,
    memoryTotal: total,
    memoryPercent: finiteNumber(gpu.memoryPercent, null),
    ok: gpu.ok !== false,
    error: typeof gpu.error === 'string' && gpu.error ? gpu.error : null,
    source: typeof gpu.source === 'string' && gpu.source ? gpu.source : 'rust',
  };
}

export function createPerformanceService(): PerformanceService {
  let previous = cpuTimes();
  let cpuUsage = 0;
  let probeError: string | null = null;
  let probeAt = 0;
  let inFlight: Promise<JsonRecord | null> | null = null;

  function sampleNodeCpu(): PerformanceCpu {
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

  function nodeMemory(): PerformanceMemory {
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

  async function readProbePerformance(): Promise<JsonRecord | null> {
    if (!probeInfo().available) return null;
    if (probeError && Date.now() - probeAt < PROBE_ERROR_TTL_MS) return null;
    if (inFlight) return inFlight;
    inFlight = (async (): Promise<JsonRecord | null> => {
      try {
        const raw = await runProbe(['performance'], { timeout: 12_000 });
        const result = isRecord(raw) ? raw : null;
        if (result && result.ok === false) {
          const message = typeof result.error === 'string' && result.error
            ? result.error
            : 'dsh-probe performance failed';
          throw new Error(message);
        }
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

  async function sample(force?: boolean): Promise<PerformancePayload> {
    const probe = await readProbePerformance();
    const probeCpu = probe && isRecord(probe.cpu) ? probe.cpu : null;
    const probeMemory = probe && isRecord(probe.memory) ? probe.memory : null;

    const cpu: PerformanceCpu = probeCpu
      ? {
          usage: finiteNumber(probeCpu.usage, 0) ?? 0,
          model: typeof probeCpu.model === 'string' && probeCpu.model ? probeCpu.model : 'CPU',
          cores: finiteNumber(probeCpu.cores, null) || os.cpus().length,
          speed: finiteNumber(probeCpu.speedMhz, null),
          baseSpeed: finiteNumber(probeCpu.baseMhz, null),
          uptime: finiteNumber(probeCpu.uptime, os.uptime()) ?? os.uptime(),
          source: 'rust',
        }
      : sampleNodeCpu();

    let memory: PerformanceMemory;
    if (probeMemory) {
      const total = finiteNumber(probeMemory.total, 0) ?? 0;
      const used = finiteNumber(probeMemory.used, 0) ?? 0;
      const free = finiteNumber(probeMemory.free, 0) ?? 0;
      memory = {
        total,
        used,
        free,
        percent: finiteNumber(probeMemory.percent, null) ?? (total ? round((used / total) * 100) : 0),
        source: 'rust',
      };
    } else {
      memory = nodeMemory();
    }

    let gpu: PerformanceGpu;
    const probeGpu = probe && isRecord(probe.gpu) ? probe.gpu : null;
    if (probeGpu) {
      gpu = mapProbeGpu(probeGpu);
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

    const temperatures: PerformanceTemperature[] = [];
    const seen = new Set<string>();
    const candidates: unknown[] = probe && Array.isArray(probe.temperatures) ? probe.temperatures : [];
    for (const item of candidates) {
      const record = isRecord(item) ? item : null;
      const value = finiteNumber(record?.celsius, null);
      if (value === null || value < 5 || value > 125) continue;
      const name = record && record.name ? String(record.name) : '设备';
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
        error: probe ? null : probeInfo().error || probeError || null,
      },
      sampledAt: Date.now(),
    };
  }

  return {
    sample,
    status: () => ({ cpu: cpuUsage, probeError }),
  };
}
