//! Shared CPU/memory sampling via sysinfo.
//!
//! `dsh-probe` is a one-shot process, so CPU usage is measured over a short
//! in-process window instead of relying on a previous invocation.

use sysinfo::{System, MINIMUM_CPU_UPDATE_INTERVAL};

use super::{Cpu, Memory};
use crate::util;

pub fn sample_system() -> (Cpu, Memory) {
    let mut system = System::new();
    system.refresh_cpu_all();
    // sysinfo needs a second sample after the minimum interval to compute usage.
    std::thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL);
    system.refresh_cpu_usage();
    system.refresh_memory();

    let cpus = system.cpus();
    let model = cpus
        .first()
        .map(|cpu| cpu.brand().trim().to_string())
        .filter(|model| !model.is_empty())
        .unwrap_or_else(|| "CPU".to_string());
    let cores = cpus.len().max(1);
    let base_mhz = cpus
        .first()
        .map(|cpu| cpu.frequency() as f64)
        .filter(|frequency| *frequency > 0.0);
    let usage = util::round1(util::clamp(system.global_cpu_usage() as f64, 0.0, 100.0));

    let total = system.total_memory();
    let used = system.used_memory();
    let free = system.free_memory();
    let percent = if total > 0 {
        util::round1(used as f64 / total as f64 * 100.0)
    } else {
        0.0
    };

    (
        Cpu {
            model,
            cores,
            physical_cores: system.physical_core_count().filter(|count| *count > 0),
            usage,
            speed_mhz: None,
            base_mhz,
            uptime: System::uptime(),
        },
        Memory {
            total,
            used,
            free,
            percent,
        },
    )
}
