//! macOS performance probe: sysinfo CPU/memory plus a best-effort `sysctl`
//! frequency lookup. GPU and thermal readings are intentionally absent: they
//! need privileged APIs (`powermetrics`, IOKit) that this sidecar does not use.
//! Source only; not run in this repository's CI.

use super::{common, Performance};
use crate::util;

pub const BACKEND: &str = "macos-sysinfo";

fn cpu_frequency_mhz() -> Option<f64> {
    // Intel Macs expose hw.cpufrequency in Hz; Apple Silicon usually does not.
    let text = util::command_output("/usr/sbin/sysctl", &["-n", "hw.cpufrequency"]).ok()?;
    let hz = text
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|value| *value > 0.0)?;
    Some(util::round1(hz / 1_000_000.0))
}

pub fn read() -> Result<Performance, String> {
    let (mut cpu, memory) = common::sample_system();
    if let Some(frequency) = cpu_frequency_mhz() {
        cpu.speed_mhz = Some(frequency);
    }
    Ok(Performance::success(cpu, memory))
}
