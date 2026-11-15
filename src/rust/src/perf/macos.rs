//! macOS performance probe: `host_statistics` CPU counters, `sysctl` memory
//! values and a best-effort frequency lookup.
//!
//! The sampler deliberately avoids `sysinfo` on macOS. `sysinfo` links
//! CoreFoundation and IOKit, which are only available through a full macOS SDK;
//! a sidecar that only needs CPU ticks and VM counters can read them through
//! `sysctl`/`vm_stat` instead. GPU and thermal readings are still absent: they
//! need privileged APIs (`powermetrics`, IOKit) this sidecar does not use.

use std::cell::RefCell;
use std::time::{Duration, Instant};

use super::{Cpu, Memory, Performance};
use crate::util;

pub const BACKEND: &str = "macos-sysctl";

/// The minimum window between two CPU tick samples, matching sysinfo's
/// `MINIMUM_CPU_UPDATE_INTERVAL` so a one-shot `performance` call still returns
/// a real percentage instead of the lifetime average.
const SAMPLE_INTERVAL: Duration = Duration::from_millis(200);
const DEFAULT_PAGE_SIZE: u64 = 4096;

#[derive(Debug, Clone, Copy, Default)]
struct CpuTicks {
    user: f64,
    nice: f64,
    system: f64,
    interrupt: f64,
    idle: f64,
}

impl CpuTicks {
    fn total(self) -> f64 {
        self.user + self.nice + self.system + self.interrupt + self.idle
    }

    fn busy(self) -> f64 {
        self.total() - self.idle
    }
}

fn sysctl(args: &[&str]) -> Result<String, String> {
    util::command_output("/usr/sbin/sysctl", args)
}

fn sysctl_text(key: &str) -> Option<String> {
    let text = sysctl(&["-n", key]).ok()?;
    let text = text.trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn sysctl_number(key: &str) -> Option<f64> {
    sysctl_text(key)?
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
}

fn sysctl_u64(key: &str) -> Option<u64> {
    sysctl_number(key)
        .filter(|value| *value >= 0.0)
        .map(|value| value as u64)
}

#[cfg(test)]
fn parse_cpu_ticks(text: &str) -> Option<CpuTicks> {
    let values: Vec<f64> = text
        .split_whitespace()
        .filter_map(|part| part.parse::<f64>().ok())
        .collect();
    if values.len() < 5 {
        return None;
    }
    Some(CpuTicks {
        user: values[0],
        nice: values[1],
        system: values[2],
        interrupt: values[3],
        idle: values[4],
    })
}

fn usage_between(previous: CpuTicks, current: CpuTicks) -> f64 {
    let total = current.total() - previous.total();
    if !total.is_finite() || total <= 0.0 {
        return 0.0;
    }
    util::round1(util::clamp(
        (current.busy() - previous.busy()) / total * 100.0,
        0.0,
        100.0,
    ))
}

fn sample_ticks() -> Result<CpuTicks, String> {
    // `host_statistics(HOST_CPU_LOAD_INFO)` is the native cumulative CPU tick
    // counter. macOS 26 no longer exposes `kern.cp_time`, so sysctl cannot be
    // used for this.
    #[cfg(target_os = "macos")]
    {
        use libc::{
            host_cpu_load_info, host_statistics, integer_t, CPU_STATE_IDLE, CPU_STATE_MAX,
            CPU_STATE_NICE, CPU_STATE_SYSTEM, CPU_STATE_USER, HOST_CPU_LOAD_INFO,
            HOST_CPU_LOAD_INFO_COUNT,
        };
        use mach2::mach_init::mach_host_self;
        let mut info = host_cpu_load_info {
            cpu_ticks: [0; CPU_STATE_MAX as usize],
        };
        let mut count = HOST_CPU_LOAD_INFO_COUNT;
        let status = unsafe {
            host_statistics(
                mach_host_self(),
                HOST_CPU_LOAD_INFO,
                &mut info as *mut _ as *mut integer_t,
                &mut count,
            )
        };
        if status != 0 {
            return Err(format!("host_statistics failed with status {status}"));
        }
        let tick = |state: libc::c_int| info.cpu_ticks[state as usize] as f64;
        Ok(CpuTicks {
            user: tick(CPU_STATE_USER),
            nice: tick(CPU_STATE_NICE),
            system: tick(CPU_STATE_SYSTEM),
            interrupt: 0.0,
            idle: tick(CPU_STATE_IDLE),
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        // `macos-check` compiles this module on other hosts for type checking.
        Err("host_statistics is only available on macOS".to_string())
    }
}

fn parse_boot_seconds(text: &str) -> Option<f64> {
    let rest = text.split("sec =").nth(1)?;
    let seconds = rest.split(',').next()?.trim();
    seconds.parse::<f64>().ok()
}

fn uptime_seconds() -> u64 {
    let Some(text) = sysctl_text("kern.boottime") else {
        return 0;
    };
    let Some(booted_at) = parse_boot_seconds(&text) else {
        return 0;
    };
    let now = util::now_ms() as f64 / 1000.0;
    (now - booted_at).max(0.0) as u64
}

fn memory_from_values(total: u64, page_size: u64, free_pages: u64, speculative: u64) -> Memory {
    let page_size = page_size.max(1);
    let free = (free_pages.saturating_add(speculative))
        .saturating_mul(page_size)
        .min(total);
    let used = total.saturating_sub(free);
    let percent = if total > 0 {
        util::round1(used as f64 / total as f64 * 100.0)
    } else {
        0.0
    };
    Memory {
        total,
        used,
        free,
        percent,
    }
}

struct Sampler {
    last: Option<(Instant, CpuTicks)>,
    usage: f64,
}

thread_local! {
    /// The daemon handles requests on one thread, so the previous tick sample
    /// can be reused instead of paying the sampling window on every call.
    static SAMPLER: RefCell<Option<Sampler>> = const { RefCell::new(None) };
}

/// CPU usage over the last sampling window.
///
/// `kern.cp_time` was removed in macOS 26, so the primary source is the
/// per-process CPU percentages from `ps` summed across all processes. The
/// result is normalized by the number of logical CPUs and clamped.
fn process_usage() -> f64 {
    let Some(text) = util::command_output("/bin/ps", &["-A", "-o", "%cpu="]).ok() else {
        return 0.0;
    };
    let total: f64 = text
        .lines()
        .filter_map(|line| line.trim().parse::<f64>().ok())
        .sum();
    let cores = sysctl_u64("hw.logicalcpu")
        .or_else(|| sysctl_u64("hw.ncpu"))
        .unwrap_or(1)
        .max(1) as f64;
    util::round1(util::clamp(total / cores, 0.0, 100.0))
}

fn sample_usage() -> f64 {
    SAMPLER.with(|slot| {
        let mut slot = slot.borrow_mut();
        let sampler = slot.get_or_insert_with(|| Sampler {
            last: None,
            usage: 0.0,
        });

        match sampler.last {
            None => {
                // Prefer tick deltas so a single invocation returns a real
                // window; macOS 26 no longer exposes `kern.cp_time`, in which
                // case the process sum is the fallback.
                if let Ok(first) = sample_ticks() {
                    std::thread::sleep(SAMPLE_INTERVAL);
                    if let Ok(second) = sample_ticks() {
                        sampler.usage = usage_between(first, second);
                        sampler.last = Some((Instant::now(), second));
                    }
                }
                if sampler.last.is_none() {
                    sampler.usage = process_usage();
                }
            }
            Some((sampled_at, previous)) => {
                if sampled_at.elapsed() >= SAMPLE_INTERVAL {
                    if let Ok(current) = sample_ticks() {
                        sampler.usage = usage_between(previous, current);
                        sampler.last = Some((Instant::now(), current));
                    } else {
                        sampler.usage = process_usage();
                        sampler.last = Some((Instant::now(), previous));
                    }
                }
            }
        }
        sampler.usage
    })
}

fn cpu_frequency_mhz() -> Option<f64> {
    // Intel Macs expose hw.cpufrequency in Hz; Apple Silicon usually does not.
    let hz = sysctl_number("hw.cpufrequency").filter(|value| *value > 0.0)?;
    Some(util::round1(hz / 1_000_000.0))
}

pub fn read() -> Result<Performance, String> {
    let usage = sample_usage();
    let model = sysctl_text("machdep.cpu.brand_string").unwrap_or_else(|| "CPU".to_string());
    let cores = sysctl_u64("hw.logicalcpu")
        .or_else(|| sysctl_u64("hw.ncpu"))
        .unwrap_or(1)
        .max(1) as usize;
    let physical_cores = sysctl_u64("hw.physicalcpu")
        .filter(|count| *count > 0)
        .map(|count| count as usize);
    let frequency = cpu_frequency_mhz();

    let memory = memory_from_values(
        sysctl_u64("hw.memsize").unwrap_or(0),
        sysctl_u64("hw.pagesize").unwrap_or(DEFAULT_PAGE_SIZE),
        sysctl_u64("vm.page_free_count").unwrap_or(0),
        sysctl_u64("vm.page_speculative_count").unwrap_or(0),
    );

    Ok(Performance::success(
        Cpu {
            model,
            cores,
            physical_cores,
            usage,
            speed_mhz: frequency,
            base_mhz: frequency,
            uptime: uptime_seconds(),
        },
        memory,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cpu_ticks() {
        let ticks = parse_cpu_ticks("100 2 30 4 864\n").expect("ticks");
        assert_eq!(ticks.total(), 1000.0);
        assert_eq!(ticks.busy(), 136.0);
    }

    #[test]
    fn computes_usage_between_samples() {
        let before = CpuTicks {
            user: 100.0,
            nice: 0.0,
            system: 50.0,
            interrupt: 0.0,
            idle: 850.0,
        };
        let after = CpuTicks {
            user: 120.0,
            nice: 0.0,
            system: 60.0,
            interrupt: 0.0,
            idle: 920.0,
        };
        // 30 busy ticks out of 100 new ticks.
        assert_eq!(usage_between(before, after), 30.0);
        assert_eq!(usage_between(after, after), 0.0);
    }

    #[test]
    fn parses_boot_time() {
        assert_eq!(
            parse_boot_seconds("{ sec = 1794741960, usec = 707117 } Sun Nov 15 03:26:00 2026"),
            Some(1_794_741_960.0)
        );
        assert_eq!(parse_boot_seconds("garbage"), None);
    }

    #[test]
    fn computes_memory_from_page_counts() {
        let memory = memory_from_values(8 * 1024 * 1024 * 1024, 4096, 1000, 500);
        assert_eq!(memory.total, 8 * 1024 * 1024 * 1024);
        assert_eq!(memory.free, 1500 * 4096);
        assert_eq!(memory.used, memory.total - memory.free);
        assert!(memory.percent > 0.0 && memory.percent < 100.0);
    }
}
