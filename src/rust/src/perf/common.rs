//! Shared CPU/memory sampling via sysinfo.
//!
//! The sampler is kept in thread-local state so a long-lived `daemon` process
//! can reuse the previous CPU counters instead of sleeping for a fresh window on
//! every request. A one-shot invocation still pays the initial
//! `MINIMUM_CPU_UPDATE_INTERVAL` sample (there is no previous baseline), which
//! preserves the existing CLI behaviour exactly.

use std::cell::RefCell;
use std::time::Instant;

use sysinfo::{System, MINIMUM_CPU_UPDATE_INTERVAL};

use super::{Cpu, Memory};
use crate::util;

struct Sampler {
    system: System,
    last_refresh: Option<Instant>,
    last_usage: f64,
}

thread_local! {
    /// Each thread gets its own sysinfo baseline. The daemon handles requests on
    /// one thread; tests and one-shot CLI runs simply take the first-sample path.
    static SAMPLER: RefCell<Option<Sampler>> = const { RefCell::new(None) };
}

pub fn sample_system() -> (Cpu, Memory) {
    SAMPLER.with(|slot| {
        let mut slot = slot.borrow_mut();
        let sampler = slot.get_or_insert_with(|| Sampler {
            system: System::new(),
            last_refresh: None,
            last_usage: 0.0,
        });

        match sampler.last_refresh {
            None => {
                sampler.system.refresh_cpu_all();
                // The first refresh has no previous counters to diff against.
                std::thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL);
                sampler.system.refresh_cpu_usage();
                sampler.last_usage = util::round1(util::clamp(
                    sampler.system.global_cpu_usage() as f64,
                    0.0,
                    100.0,
                ));
            }
            Some(previous) => {
                let elapsed = previous.elapsed();
                if elapsed >= MINIMUM_CPU_UPDATE_INTERVAL {
                    sampler.system.refresh_cpu_usage();
                    sampler.last_usage = util::round1(util::clamp(
                        sampler.system.global_cpu_usage() as f64,
                        0.0,
                        100.0,
                    ));
                }
                // Repeated requests inside the minimum window reuse the last
                // valid reading instead of sleeping. Callers poll at >= 1.5 s,
                // so this only affects diagnostic bursts.
            }
        }
        sampler.system.refresh_memory();
        sampler.last_refresh = Some(Instant::now());

        let system = &sampler.system;
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
        let usage = sampler.last_usage;

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
    })
}
