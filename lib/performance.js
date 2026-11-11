/** CPU/memory from Node, GPU and thermal probes from the Windows bridge. */

import os from 'node:os';
import { clamp, finiteNumber, serializeError } from './util.js';
import { readSystemInfo } from './win/bridge.js';

const GPU_TTL_MS = 2800;
const GPU_ERROR_TTL_MS = 8000;

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

export function createPerformanceService() {
  let previous = cpuTimes();
  let cpuUsage = 0;
  let gpuCache = null;
  let gpuAt = 0;
  let gpuErrorAt = 0;
  let inFlight = null;

  async function readGpu(force = false) {
    const now = Date.now();
    const ttl = gpuCache ? GPU_TTL_MS : GPU_ERROR_TTL_MS;
    if (!force && gpuCache && now - gpuAt < ttl) return { ...gpuCache, cached: true };
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const parsed = await readSystemInfo();
        if (!parsed?.gpu) return null;
        const total = finiteNumber(parsed.gpu.memoryTotal, null);
        const used = finiteNumber(parsed.gpu.memoryUsed, 0) || 0;
        gpuCache = {
          name: parsed.gpu.name || 'GPU',
          driver: parsed.gpu.driver || '',
          adapters: Array.isArray(parsed.gpu.adapters) ? parsed.gpu.adapters : [],
          utilization: clamp(finiteNumber(parsed.gpu.utilization, 0) || 0, 0, 100),
          memoryUsed: used,
          memoryTotal: total,
          memoryPercent: total ? clamp((used / total) * 100, 0, 100) : null,
          temperatures: Array.isArray(parsed.temperatures) ? parsed.temperatures : [],
          sampledAt: finiteNumber(parsed.sampledAt, Date.now()) || Date.now(),
          ok: true,
        };
        gpuAt = now;
        gpuErrorAt = 0;
        return gpuCache;
      } catch (error) {
        gpuAt = now;
        gpuErrorAt = now;
        gpuCache = {
          ok: false,
          name: 'GPU',
          error: serializeError(error?.stderr || error),
          temperatures: [],
          sampledAt: now,
        };
        return gpuCache;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function sampleCpu() {
    const current = cpuTimes();
    const idle = current.idle - previous.idle;
    const total = current.total - previous.total;
    previous = current;
    if (total > 0) {
      cpuUsage = clamp((1 - idle / total) * 100, 0, 100);
    }
    return round(cpuUsage);
  }

  async function sample(forceGpu = false) {
    const cpu = sampleCpu();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const gpu = await readGpu(forceGpu);
    const temperatures = [];
    if (Array.isArray(gpu?.temperatures)) {
      for (const item of gpu.temperatures) {
        const value = finiteNumber(item?.celsius, null);
        if (value !== null && value >= 5 && value <= 125) {
          temperatures.push({ name: String(item.name || '设备'), celsius: round(value) });
        }
      }
    }
    return {
      cpu: {
        usage: cpu,
        model: os.cpus()[0]?.model || 'CPU',
        cores: os.cpus().length,
        speed: os.cpus()[0]?.speed || null,
        uptime: os.uptime(),
      },
      memory: {
        total: totalMemory,
        used: totalMemory - freeMemory,
        free: freeMemory,
        percent: totalMemory ? round(((totalMemory - freeMemory) / totalMemory) * 100) : 0,
      },
      gpu: gpu
        ? {
            name: gpu.name,
            driver: gpu.driver || '',
            adapters: gpu.adapters || [],
            utilization: gpu.utilization ?? null,
            memoryUsed: gpu.memoryUsed ?? null,
            memoryTotal: gpu.memoryTotal ?? null,
            memoryPercent: gpu.memoryPercent ?? null,
            ok: gpu.ok !== false,
            error: gpu.error || null,
          }
        : { name: 'GPU', ok: false, error: '当前平台不支持 GPU 读数' },
      temperatures,
      sampledAt: Date.now(),
    };
  }

  return { sample, status: () => ({ cpu: cpuUsage, gpu: gpuCache?.ok ?? null, gpuErrorAt }) };
}
