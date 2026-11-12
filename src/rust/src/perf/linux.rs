//! Linux performance probe.
//!
//! CPU/memory come from sysinfo; current frequency from `/proc/cpuinfo` (or
//! cpufreq); GPU and temperatures are best effort: `nvidia-smi` when present,
//! otherwise AMD sysfs counters, plus `/sys/class/hwmon` thermal sensors.

use std::path::Path;

use super::{common, Gpu, Performance, Temperature};
use crate::util;

pub const BACKEND: &str = "linux-sysinfo+sysfs";

fn read_trim(path: &str) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let text = text.trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn read_u64(path: &str) -> Option<u64> {
    read_trim(path)?.parse::<u64>().ok()
}

fn read_freq_mhz(path: &str) -> Option<f64> {
    // cpufreq files are in kHz.
    let value = read_u64(path)? as f64 / 1000.0;
    if value > 0.0 {
        Some(util::round1(value))
    } else {
        None
    }
}

fn cpu_frequency() -> Option<f64> {
    let text = std::fs::read_to_string("/proc/cpuinfo").ok()?;
    let values: Vec<f64> = text
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            if key.trim() != "cpu MHz" {
                return None;
            }
            value
                .trim()
                .parse::<f64>()
                .ok()
                .filter(|value| *value > 0.0)
        })
        .collect();
    if values.is_empty() {
        for cpu in 0..8 {
            if let Some(value) = read_freq_mhz(&format!(
                "/sys/devices/system/cpu/cpu{cpu}/cpufreq/scaling_cur_freq"
            )) {
                return Some(value);
            }
        }
        return None;
    }
    Some(util::round1(
        values.iter().sum::<f64>() / values.len() as f64,
    ))
}

fn base_frequency() -> Option<f64> {
    for cpu in 0..2 {
        for file in ["base_frequency", "cpuinfo_max_freq"] {
            if let Some(value) =
                read_freq_mhz(&format!("/sys/devices/system/cpu/cpu{cpu}/cpufreq/{file}"))
            {
                return Some(value);
            }
        }
    }
    None
}

fn nvidia_gpu() -> Option<Gpu> {
    let path = util::find_executable("nvidia-smi")?;
    let text = util::run_path_command(
        &path,
        &[
            "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
            "--format=csv,noheader,nounits",
        ],
    )
    .ok()?;
    let line = text.lines().next()?.trim();
    let fields: Vec<&str> = line.split(',').map(str::trim).collect();
    if fields.len() < 5 {
        return None;
    }
    let number = |index: usize| {
        fields
            .get(index)
            .and_then(|value| value.parse::<f64>().ok())
    };
    let used_mib = number(2);
    let total_mib = number(3);
    let mib = 1024.0 * 1024.0;
    let memory_used = used_mib.map(|value| (value * mib) as u64);
    let memory_total = total_mib.map(|value| (value * mib) as u64);
    Some(Gpu {
        name: fields[0].to_string(),
        driver: "nvidia".to_string(),
        adapters: vec![fields[0].to_string()],
        utilization: number(1).map(|value| util::clamp(value, 0.0, 100.0)),
        memory_used,
        memory_total,
        memory_percent: match (memory_used, memory_total) {
            (Some(used), Some(total)) if total > 0 => {
                Some(util::round1(used as f64 / total as f64 * 100.0))
            }
            _ => None,
        },
        ok: true,
        source: "nvidia-smi".to_string(),
        error: None,
        ..Default::default()
    })
}

fn amd_gpu() -> Option<Gpu> {
    for index in 0..8 {
        let card = format!("/sys/class/drm/card{index}");
        let device = format!("{card}/device");
        if !Path::new(&device).exists() {
            continue;
        }
        let busy = read_u64(&format!("{device}/gpu_busy_percent"));
        let used = read_u64(&format!("{device}/mem_info_vram_used"));
        let total = read_u64(&format!("{device}/mem_info_vram_total"));
        if busy.is_none() && used.is_none() && total.is_none() {
            continue;
        }
        let driver = std::fs::read_link(format!("{device}/driver"))
            .ok()
            .and_then(|path| {
                path.file_name()
                    .map(|name| name.to_string_lossy().to_string())
            })
            .unwrap_or_default();
        let name = read_trim(&format!("{device}/product_name")).unwrap_or_else(|| {
            if driver.is_empty() {
                "AMD GPU".to_string()
            } else {
                format!("AMD GPU ({driver})")
            }
        });
        return Some(Gpu {
            name,
            driver,
            adapters: Vec::new(),
            utilization: busy.map(|value| util::clamp(value as f64, 0.0, 100.0)),
            memory_used: used,
            memory_total: total,
            memory_percent: match (used, total) {
                (Some(used), Some(total)) if total > 0 => {
                    Some(util::round1(used as f64 / total as f64 * 100.0))
                }
                _ => None,
            },
            ok: true,
            source: "sysfs-amdgpu".to_string(),
            error: None,
            ..Default::default()
        });
    }
    None
}

fn push_temperature(temperatures: &mut Vec<Temperature>, name: String, celsius: f64) {
    if !(5.0..=125.0).contains(&celsius) {
        return;
    }
    let celsius = util::round1(celsius);
    if temperatures.iter().any(|item| item.name == name) {
        return;
    }
    temperatures.push(Temperature { name, celsius });
}

fn hwmon_temperatures(temperatures: &mut Vec<Temperature>) {
    let Ok(entries) = std::fs::read_dir("/sys/class/hwmon") else {
        return;
    };
    for entry in entries.flatten() {
        let directory = entry.path();
        let chip = std::fs::read_to_string(directory.join("name"))
            .map(|name| name.trim().to_string())
            .unwrap_or_else(|_| "sensor".to_string());
        let Ok(files) = std::fs::read_dir(&directory) else {
            continue;
        };
        for file in files.flatten() {
            let file_name = file.file_name().to_string_lossy().to_string();
            if !file_name.starts_with("temp") || !file_name.ends_with("_input") {
                continue;
            }
            let stem = file_name.trim_end_matches("_input");
            let Ok(raw) = std::fs::read_to_string(file.path()) else {
                continue;
            };
            let Ok(millidegrees) = raw.trim().parse::<f64>() else {
                continue;
            };
            let label = std::fs::read_to_string(directory.join(format!("{stem}_label")))
                .map(|label| label.trim().to_string())
                .unwrap_or_default();
            let name = if label.is_empty() {
                chip.clone()
            } else {
                format!("{chip} {label}")
            };
            push_temperature(temperatures, name, millidegrees / 1000.0);
        }
    }
}

pub fn read() -> Result<Performance, String> {
    let (mut cpu, memory) = common::sample_system();
    if let Some(speed) = cpu_frequency() {
        cpu.speed_mhz = Some(speed);
    }
    if cpu.base_mhz.is_none() {
        cpu.base_mhz = base_frequency();
    }

    let gpu = nvidia_gpu().or_else(amd_gpu);
    let mut temperatures = Vec::new();
    if let Some(gpu) = gpu.as_ref() {
        if let Some(path) = util::find_executable("nvidia-smi") {
            if let Ok(text) = util::run_path_command(
                &path,
                &[
                    "--query-gpu=temperature.gpu",
                    "--format=csv,noheader,nounits",
                ],
            ) {
                if let Some(value) = text
                    .lines()
                    .next()
                    .and_then(|line| line.trim().parse::<f64>().ok())
                {
                    push_temperature(&mut temperatures, gpu.name.clone(), value);
                }
            }
        }
    }
    hwmon_temperatures(&mut temperatures);

    let mut performance = Performance::success(cpu, memory);
    performance.gpu = gpu;
    performance.temperatures = temperatures;
    Ok(performance)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_own_cpu_frequency_when_available() {
        if let Some(frequency) = cpu_frequency() {
            assert!(frequency > 0.0);
        }
    }

    #[test]
    fn keeps_temperatures_in_range_and_deduplicates() {
        let mut temperatures = Vec::new();
        push_temperature(&mut temperatures, "cpu".to_string(), 45.0);
        push_temperature(&mut temperatures, "cpu".to_string(), 50.0);
        push_temperature(&mut temperatures, "cpu".to_string(), 200.0);
        assert_eq!(temperatures.len(), 1);
        assert_eq!(temperatures[0].celsius, 45.0);
    }
}
