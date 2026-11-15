//! Linux performance probe.
//!
//! CPU/memory come from sysinfo; current frequency from `/proc/cpuinfo` (or
//! cpufreq); GPU and temperatures are best effort: `nvidia-smi` when present,
//! otherwise AMD/Intel sysfs counters, plus `/sys/class/hwmon` thermal sensors.
//! Intel utilization additionally uses the optional `intel_gpu_top` helper.

use std::path::Path;

use serde_json::Value;

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

fn uevent_field(uevent: &str, key: &str) -> Option<String> {
    uevent.lines().find_map(|line| {
        let (name, value) = line.split_once('=')?;
        (name.trim() == key).then(|| value.trim().to_string())
    })
}

fn device_driver(device: &str) -> String {
    std::fs::read_link(format!("{device}/driver"))
        .ok()
        .and_then(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .unwrap_or_default()
}

fn lspci_gpu_name(slot: &str) -> Option<String> {
    if slot.is_empty() {
        return None;
    }
    let text = util::command_output("lspci", &["-mm", "-s", slot]).ok()?;
    // `lspci -mm` returns quoted fields:
    // 00:02.0 "VGA compatible controller" "Intel Corporation" "UHD Graphics"
    let parts: Vec<&str> = text.split('"').collect();
    if parts.len() < 6 {
        return None;
    }
    let name = format!("{} {}", parts[3].trim(), parts[5].trim())
        .trim()
        .to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// Parse `intel_gpu_top -L` and return the display name plus the `-d` filter
/// for the Intel card whose PCI device id matches `pci_id`.
fn intel_tool_card(pci_id: &str) -> Option<(String, String)> {
    let tool = util::find_executable("intel_gpu_top")?;
    let text = util::run_path_command(&tool, &["-L"]).ok()?;
    let device_id = pci_id.split(':').nth(1)?.to_ascii_lowercase();
    for line in text.lines() {
        let Some(position) = line.find("pci:") else {
            continue;
        };
        let filter = line[position..].trim();
        let lower = filter.to_ascii_lowercase();
        if !lower.contains("vendor=8086") || !lower.contains(&format!("device={device_id}")) {
            continue;
        }
        let name = line[..position]
            .split_whitespace()
            .skip(1)
            .collect::<Vec<_>>()
            .join(" ");
        let name = if name.is_empty() {
            "Intel Graphics".to_string()
        } else {
            name
        };
        return Some((name, filter.to_string()));
    }
    None
}

fn parse_intel_utilization(text: &str) -> Option<f64> {
    let samples: Value = serde_json::from_str(text).ok()?;
    let sample = samples.as_array()?.last()?.as_object()?;
    let engines = sample.get("engines")?.as_object()?;
    let mut max = 0.0_f64;
    for engine in engines.values() {
        if let Some(busy) = engine.get("busy").and_then(Value::as_f64) {
            max = max.max(busy);
        }
    }
    some_if_finite(max)
}

fn some_if_finite(value: f64) -> Option<f64> {
    if value.is_finite() {
        Some(util::round1(util::clamp(value, 0.0, 100.0)))
    } else {
        None
    }
}

/// `intel_gpu_top` needs CAP_PERFMON (or root) to read the i915/xe PMU. When it
/// is unavailable, the caller keeps the sysfs name/frequency and leaves
/// utilization unset.
fn intel_utilization(filter: Option<&str>) -> Option<f64> {
    let tool = util::find_executable("intel_gpu_top")?;
    let mut args = vec!["-J", "-s", "250", "-n", "2"];
    if let Some(filter) = filter {
        args.push("-d");
        args.push(filter);
    }
    let text = util::run_path_command(&tool, &args).ok()?;
    parse_intel_utilization(&text)
}

fn intel_gpu() -> Option<Gpu> {
    for index in 0..8 {
        let card = format!("/sys/class/drm/card{index}");
        let device = format!("{card}/device");
        if !Path::new(&device).exists() {
            continue;
        }
        let uevent = read_trim(&format!("{device}/uevent")).unwrap_or_default();
        let Some(pci_id) = uevent_field(&uevent, "PCI_ID") else {
            continue;
        };
        if !pci_id.to_ascii_lowercase().starts_with("8086:") {
            continue;
        }
        let driver = device_driver(&device);
        if driver != "i915" && driver != "xe" {
            continue;
        }
        let slot = uevent_field(&uevent, "PCI_SLOT_NAME").unwrap_or_default();
        let tool = intel_tool_card(&pci_id);
        let (tool_name, filter) = match tool {
            Some((name, filter)) => (Some(name), Some(filter)),
            None => (None, None),
        };
        let name = lspci_gpu_name(&slot)
            .or(tool_name)
            .unwrap_or_else(|| "Intel Graphics".to_string());

        let used = read_u64(&format!("{device}/mem_info_vram_used"));
        let total = read_u64(&format!("{device}/mem_info_vram_total"));
        // i915 exposes the GT frequency on the DRM card node, not on the PCI
        // device symlink; the connector directories link back to this node.
        let current = read_u64(&format!("{card}/gt_cur_freq_mhz")).map(|value| value as f64);
        let maximum = read_u64(&format!("{card}/gt_max_freq_mhz"))
            .or_else(|| read_u64(&format!("{card}/gt_RP0_freq_mhz")))
            .map(|value| value as f64);
        let utilization = intel_utilization(filter.as_deref());
        let source = if utilization.is_some() {
            "intel-gpu-top"
        } else {
            "sysfs-intel"
        };
        return Some(Gpu {
            name: name.clone(),
            driver,
            adapters: vec![name],
            utilization,
            memory_used: used,
            memory_total: total,
            memory_percent: match (used, total) {
                (Some(used), Some(total)) if total > 0 => {
                    Some(util::round1(used as f64 / total as f64 * 100.0))
                }
                _ => None,
            },
            core_clock_mhz: current.map(util::round1),
            core_clock_max_mhz: maximum.map(util::round1),
            ok: true,
            source: source.to_string(),
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

    let gpu = nvidia_gpu().or_else(amd_gpu).or_else(intel_gpu);
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

    #[test]
    fn parses_intel_gpu_top_utilization() {
        let text = r#"[
            {"engines": {"Render/3D": {"busy": 12.5}, "Blitter": {"busy": 0.0}}},
            {"engines": {"Render/3D": {"busy": 40.0}, "Blitter": {"busy": 5.0}}}
        ]"#;
        assert_eq!(parse_intel_utilization(text), Some(40.0));
        assert_eq!(parse_intel_utilization("[]"), None);
        assert_eq!(parse_intel_utilization("not json"), None);
    }
}
