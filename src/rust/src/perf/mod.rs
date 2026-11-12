//! CPU/memory sampler shared by all platforms (sysinfo), plus GPU/temperature
//! best-effort data from the platform module.

use serde::Serialize;
use serde_json::{json, Value};

use crate::cli::CliResult;
use crate::util;

#[cfg(windows)]
#[path = "windows.rs"]
mod platform;
#[cfg(target_os = "linux")]
#[path = "linux.rs"]
mod platform;
#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod platform;

#[cfg(all(feature = "macos-check", not(target_os = "macos")))]
#[allow(dead_code)]
#[path = "macos.rs"]
mod macos_preview;

mod common;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Cpu {
    pub model: String,
    pub cores: usize,
    pub physical_cores: Option<usize>,
    /// Percent, 0..100, sampled over a short window inside this process.
    pub usage: f64,
    pub speed_mhz: Option<f64>,
    pub base_mhz: Option<f64>,
    /// Seconds since boot.
    pub uptime: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub total: u64,
    pub used: u64,
    pub free: u64,
    pub percent: f64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub name: String,
    pub driver: String,
    pub adapters: Vec<String>,
    pub utilization: Option<f64>,
    pub memory_used: Option<u64>,
    pub memory_total: Option<u64>,
    pub memory_percent: Option<f64>,
    /// Graphics (3D node) clock in MHz, from the WDDM performance data.
    pub core_clock_mhz: Option<f64>,
    /// Maximum nominal graphics clock in MHz.
    pub core_clock_max_mhz: Option<f64>,
    /// Video-memory clock in MHz.
    pub memory_clock_mhz: Option<f64>,
    /// The GPU die temperature the Windows performance counters report.
    pub temperature_celsius: Option<f64>,
    /// Adapter power draw as a percentage of its maximum (WDDM reports tenths).
    pub power_percent: Option<f64>,
    pub fan_rpm: Option<u32>,
    pub ok: bool,
    pub source: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Temperature {
    pub name: String,
    pub celsius: f64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Performance {
    pub ok: bool,
    pub available: bool,
    pub cpu: Cpu,
    pub memory: Memory,
    pub gpu: Option<Gpu>,
    pub temperatures: Vec<Temperature>,
    pub backend: String,
    pub sampled_at: i64,
    pub error: Option<String>,
}

impl Performance {
    pub fn success(cpu: Cpu, memory: Memory) -> Self {
        Self {
            ok: true,
            available: true,
            cpu,
            memory,
            gpu: None,
            temperatures: Vec::new(),
            backend: platform::BACKEND.to_string(),
            sampled_at: util::now_ms(),
            error: None,
        }
    }
}

pub fn read() -> Value {
    match platform::read() {
        Ok(mut performance) => {
            performance.ok = true;
            performance.available = true;
            performance.backend = platform::BACKEND.to_string();
            performance.sampled_at = util::now_ms();
            serde_json::to_value(performance).unwrap_or_else(
                |error| json!({ "ok": false, "available": false, "error": error.to_string() }),
            )
        }
        Err(error) => json!({
            "ok": false,
            "available": false,
            "error": error,
            "backend": platform::BACKEND,
            "sampledAt": util::now_ms(),
            "cpu": null,
            "memory": null,
            "gpu": null,
            "temperatures": [],
        }),
    }
}

pub fn cli(_args: &[String], _started_at: i64) -> CliResult {
    Ok(read())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn performance_serializes_camel_case() {
        let mut cpu = Cpu::default();
        cpu.model = "Test CPU".to_string();
        cpu.speed_mhz = Some(3200.0);
        let value = serde_json::to_value(Performance::success(cpu, Memory::default())).unwrap();
        assert_eq!(value["ok"], true);
        assert_eq!(value["cpu"]["speedMhz"], 3200.0);
        assert_eq!(value["cpu"]["physicalCores"], serde_json::Value::Null);
        assert_eq!(value["sampledAt"].as_i64().is_some(), true);
    }
}
