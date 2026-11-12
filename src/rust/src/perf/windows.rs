//! Windows performance probe.
//!
//! CPU/memory come from sysinfo. The current core clock uses the PDH
//! `% Processor Performance` counter with a `CallNtPowerInformation` fallback.
//! GPU name/VRAM come from DXGI (registry as a fallback), GPU utilization and
//! dedicated memory from PDH GPU performance counters, and temperatures from the
//! PDH thermal-zone counters. GPU clocks, die temperature, power and fan speed
//! come from the WDDM performance data (`D3DKMTQueryAdapterInfo`), which is the
//! same source Task Manager uses. None of this goes through WMI or PowerShell.

use std::collections::HashSet;
use std::mem::size_of;

use windows::core::{HSTRING, PCWSTR};
use windows::Wdk::Graphics::Direct3D::{
    D3DKMTCloseAdapter, D3DKMTOpenAdapterFromLuid, D3DKMTQueryAdapterInfo, D3DKMT_ADAPTER_PERFDATA,
    D3DKMT_CLOSEADAPTER, D3DKMT_NODEMETADATA, D3DKMT_NODE_PERFDATA, D3DKMT_OPENADAPTERFROMLUID,
    D3DKMT_QUERYADAPTERINFO, DXGK_ENGINE_TYPE_3D, KMTQAITYPE_ADAPTERPERFDATA,
    KMTQAITYPE_NODEMETADATA, KMTQAITYPE_NODEPERFDATA, KMTQUERYADAPTERINFOTYPE,
};
use windows::Win32::Foundation::{CloseHandle, HANDLE, LUID};
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
    PdhGetFormattedCounterValue, PdhOpenQueryW, PDH_FMT_COUNTERVALUE, PDH_FMT_COUNTERVALUE_ITEM_W,
    PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
};
use windows::Win32::System::Power::{
    CallNtPowerInformation, ProcessorInformation, PROCESSOR_POWER_INFORMATION,
};
use windows::Win32::System::IO::DeviceIoControl;
use winreg::enums::{HKEY_LOCAL_MACHINE, REG_BINARY, REG_QWORD};
use winreg::RegKey;

use super::{common, Gpu, Performance, Temperature};
use crate::util;

pub const BACKEND: &str = "win32-dxgi-pdh-d3dkmt+sysinfo";

/// `\\Processor Information(_Total)\\% Processor Performance`, the same counter
/// the old PowerShell probe used (`PercentProcessorPerformance`).
const PROCESSOR_PERFORMANCE_COUNTER: &str =
    "\\Processor Information(_Total)\\% Processor Performance";
const GPU_ENGINE_COUNTER: &str = "\\GPU Engine(*)\\Utilization Percentage";
const GPU_MEMORY_COUNTER: &str = "\\GPU Adapter Memory(*)\\Dedicated Usage";
const THERMAL_PRECISION_COUNTER: &str = "\\Thermal Zone Information(*)\\High Precision Temperature";
const THERMAL_COUNTER: &str = "\\Thermal Zone Information(*)\\Temperature";
const PDH_MORE_DATA: u32 = 0x8000_07D2;
const GPU_CLASS_KEY: &str =
    "SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";

fn registry_cpu() -> (Option<String>, Option<f64>) {
    let Ok(hklm) = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0")
    else {
        return (None, None);
    };
    let name = hklm
        .get_value::<String, _>("ProcessorNameString")
        .ok()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty());
    let max_clock = hklm
        .get_value::<u32, _>("MaxClockSpeed")
        .ok()
        .map(|value| value as f64)
        .filter(|value| *value > 0.0);
    (name, max_clock)
}

fn power_frequency() -> Option<(f64, f64)> {
    let count = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1)
        .max(1);
    let mut info: Vec<PROCESSOR_POWER_INFORMATION> =
        (0..count).map(|_| unsafe { std::mem::zeroed() }).collect();
    let bytes = (info.len() * size_of::<PROCESSOR_POWER_INFORMATION>()) as u32;
    let status = unsafe {
        CallNtPowerInformation(
            ProcessorInformation,
            None,
            0,
            Some(info.as_mut_ptr() as *mut core::ffi::c_void),
            bytes,
        )
    };
    if status.0 < 0 {
        return None;
    }
    let mut current = 0.0;
    let mut max = 0.0;
    let mut seen = 0_u32;
    for entry in &info {
        if entry.MaxMhz > 0 {
            max += entry.MaxMhz as f64;
        }
        if entry.CurrentMhz > 0 {
            current += entry.CurrentMhz as f64;
            seen += 1;
        }
    }
    let current = if seen > 0 { current / seen as f64 } else { 0.0 };
    let max = if count > 0 { max / count as f64 } else { 0.0 };
    if current <= 0.0 && max <= 0.0 {
        return None;
    }
    Some((util::round1(current), util::round1(max)))
}

/// Returns the counter value as a percentage of nominal frequency (100 = base).
fn pdh_performance_percent() -> Option<f64> {
    unsafe {
        let mut query = PDH_HQUERY(std::ptr::null_mut());
        if PdhOpenQueryW(PCWSTR::null(), 0, &mut query) != 0 {
            return None;
        }
        let path = HSTRING::from(PROCESSOR_PERFORMANCE_COUNTER);
        let mut counter = PDH_HCOUNTER(std::ptr::null_mut());
        let status = PdhAddEnglishCounterW(query, &path, 0, &mut counter);
        if status != 0 {
            let _ = PdhCloseQuery(query);
            return None;
        }
        // PDH rate counters need two samples.
        if PdhCollectQueryData(query) != 0 {
            let _ = PdhCloseQuery(query);
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(120));
        if PdhCollectQueryData(query) != 0 {
            let _ = PdhCloseQuery(query);
            return None;
        }
        let mut value = PDH_FMT_COUNTERVALUE::default();
        let status = PdhGetFormattedCounterValue(counter, PDH_FMT_DOUBLE, None, &mut value);
        let _ = PdhCloseQuery(query);
        if status != 0 {
            return None;
        }
        let percent = value.Anonymous.doubleValue;
        if percent.is_finite() && percent > 0.0 {
            Some(percent)
        } else {
            None
        }
    }
}

/// Read every instance of a wildcard PDH counter, taking two samples so rate
/// counters have a value. Returns `(instance name, value)` pairs.
fn pdh_array(counter_path: &str) -> Result<Vec<(String, f64)>, String> {
    unsafe {
        let mut query = PDH_HQUERY(std::ptr::null_mut());
        if PdhOpenQueryW(PCWSTR::null(), 0, &mut query) != 0 {
            return Err("PdhOpenQueryW failed".to_string());
        }
        let path = HSTRING::from(counter_path);
        let mut counter = PDH_HCOUNTER(std::ptr::null_mut());
        let status = PdhAddEnglishCounterW(query, &path, 0, &mut counter);
        if status != 0 {
            let _ = PdhCloseQuery(query);
            return Err(format!("counter unavailable (status {status})"));
        }
        if PdhCollectQueryData(query) != 0 {
            let _ = PdhCloseQuery(query);
            return Err("PdhCollectQueryData failed".to_string());
        }
        std::thread::sleep(std::time::Duration::from_millis(180));
        if PdhCollectQueryData(query) != 0 {
            let _ = PdhCloseQuery(query);
            return Err("PdhCollectQueryData failed".to_string());
        }

        let mut size = 0_u32;
        let mut count = 0_u32;
        let status =
            PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, None);
        if status != 0 && status != PDH_MORE_DATA {
            let _ = PdhCloseQuery(query);
            return Err(format!("counter query failed (status {status})"));
        }
        if size == 0 || count == 0 {
            let _ = PdhCloseQuery(query);
            return Ok(Vec::new());
        }

        // `size` is a byte count; allocate word-aligned storage for the array.
        let words = (size as usize).div_ceil(size_of::<usize>());
        let mut buffer = vec![0_usize; words];
        let items = buffer.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
        let status = PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_DOUBLE,
            &mut size,
            &mut count,
            Some(items),
        );
        if status != 0 {
            let _ = PdhCloseQuery(query);
            return Err(format!("counter array failed (status {status})"));
        }
        let slice = std::slice::from_raw_parts(items, count as usize);
        let mut values = Vec::with_capacity(slice.len());
        for item in slice {
            let name = if item.szName.is_null() {
                String::new()
            } else {
                item.szName.to_string().unwrap_or_default()
            };
            values.push((name, item.FmtValue.Anonymous.doubleValue));
        }
        let _ = PdhCloseQuery(query);
        Ok(values)
    }
}

fn is_virtual_adapter(name: &str) -> bool {
    let name = name.to_lowercase();
    [
        "virtual",
        "gameviewer",
        "remote",
        "basic display",
        "microsoft basic",
    ]
    .iter()
    .any(|marker| name.contains(marker))
}

fn wide_string(value: &[u16]) -> String {
    let end = value
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(value.len());
    String::from_utf16_lossy(&value[..end]).trim().to_string()
}

#[derive(Debug, Clone, Default)]
struct RegistryAdapter {
    name: String,
    driver: String,
    memory_total: Option<u64>,
}

/// Per-adapter performance data from the WDDM kernel-mode interface
/// (`D3DKMTQueryAdapterInfo`). This is the vendor-neutral source Task Manager
/// uses for the GPU clock, temperature, power and fan speed.
#[derive(Debug, Clone, Copy, Default)]
struct AdapterPerf {
    core_clock_mhz: Option<f64>,
    core_clock_max_mhz: Option<f64>,
    memory_clock_mhz: Option<f64>,
    temperature_celsius: Option<f64>,
    power_percent: Option<f64>,
    fan_rpm: Option<u32>,
}

fn query_adapter_info<T>(h_adapter: u32, kind: KMTQUERYADAPTERINFOTYPE, value: &mut T) -> bool {
    let mut query = D3DKMT_QUERYADAPTERINFO {
        hAdapter: h_adapter,
        Type: kind,
        pPrivateDriverData: value as *mut T as *mut core::ffi::c_void,
        PrivateDriverDataSize: size_of::<T>() as u32,
    };
    unsafe { D3DKMTQueryAdapterInfo(&mut query).0 >= 0 }
}

/// Read WDDM performance data for an adapter identified by its DXGI LUID.
///
/// * `D3DKMT_ADAPTER_PERFDATA` reports memory clock, die temperature, power
///   (tenths of a percent) and fan RPM.
/// * `D3DKMT_NODE_PERFDATA` reports per-engine clocks in hertz; the 3D engine is
///   the graphics clock shown in Task Manager.
fn adapter_perf(luid: LUID) -> Option<AdapterPerf> {
    unsafe {
        let mut open = D3DKMT_OPENADAPTERFROMLUID {
            AdapterLuid: luid,
            hAdapter: 0,
        };
        if D3DKMTOpenAdapterFromLuid(&mut open).0 < 0 || open.hAdapter == 0 {
            return None;
        }
        let mut perf = AdapterPerf::default();

        let mut adapter = D3DKMT_ADAPTER_PERFDATA::default();
        if query_adapter_info(open.hAdapter, KMTQAITYPE_ADAPTERPERFDATA, &mut adapter) {
            if adapter.Temperature > 0 {
                let celsius = adapter.Temperature as f64 / 10.0;
                if (5.0..=125.0).contains(&celsius) {
                    perf.temperature_celsius = Some(util::round1(celsius));
                }
            }
            if adapter.MemoryFrequency > 0 {
                perf.memory_clock_mhz =
                    Some(util::round1(adapter.MemoryFrequency as f64 / 1_000_000.0));
            }
            // The driver reports tenths of a percent; 0 means "unsupported".
            if adapter.Power > 0 && adapter.Power <= 1000 {
                perf.power_percent = Some(util::round1(adapter.Power as f64 / 10.0));
            }
            if adapter.FanRPM > 0 {
                perf.fan_rpm = Some(adapter.FanRPM);
            }
        }

        // Engine nodes are 1-based in the WDDM metadata (node 0 is a placeholder
        // on some drivers), so probe a generous range and pick the 3D engine.
        let mut fallback_clock: Option<(f64, f64)> = None;
        for node in 0..16u32 {
            let mut metadata = D3DKMT_NODEMETADATA {
                NodeOrdinalAndAdapterIndex: node,
                ..Default::default()
            };
            if !query_adapter_info(open.hAdapter, KMTQAITYPE_NODEMETADATA, &mut metadata) {
                continue;
            }
            let engine = metadata.NodeData.EngineType;
            let mut data = D3DKMT_NODE_PERFDATA {
                NodeOrdinal: node,
                PhysicalAdapterIndex: 0,
                ..Default::default()
            };
            if !query_adapter_info(open.hAdapter, KMTQAITYPE_NODEPERFDATA, &mut data) {
                continue;
            }
            if data.Frequency == 0 && data.MaxFrequency == 0 {
                continue;
            }
            let frequency = data.Frequency as f64 / 1_000_000.0;
            let maximum = data.MaxFrequency as f64 / 1_000_000.0;
            if engine == DXGK_ENGINE_TYPE_3D {
                // An idle GPU may legitimately report 0 MHz on the 3D node;
                // forward it instead of pretending the clock is unavailable.
                perf.core_clock_mhz = Some(util::round1(frequency));
                if maximum > 0.0 {
                    perf.core_clock_max_mhz = Some(util::round1(maximum));
                }
            } else if frequency > 0.0 && fallback_clock.map_or(true, |(value, _)| frequency > value)
            {
                fallback_clock = Some((frequency, maximum));
            }
        }
        if perf.core_clock_mhz.is_none() {
            if let Some((frequency, maximum)) = fallback_clock {
                perf.core_clock_mhz = Some(util::round1(frequency));
                if maximum > 0.0 {
                    perf.core_clock_max_mhz = Some(util::round1(maximum));
                }
            }
        }

        let close = D3DKMT_CLOSEADAPTER {
            hAdapter: open.hAdapter,
        };
        let _ = D3DKMTCloseAdapter(&close);
        Some(perf)
    }
}

fn registry_adapters() -> Vec<RegistryAdapter> {
    let Ok(root) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(GPU_CLASS_KEY) else {
        return Vec::new();
    };
    let mut adapters = Vec::new();
    for subkey in root.enum_keys().flatten() {
        let Ok(key) = root.open_subkey(&subkey) else {
            continue;
        };
        let Ok(name) = key.get_value::<String, _>("DriverDesc") else {
            continue;
        };
        let name = name.trim().to_string();
        if name.is_empty() || is_virtual_adapter(&name) {
            continue;
        }
        let driver = key
            .get_value::<String, _>("DriverVersion")
            .ok()
            .map(|value| value.trim().to_string())
            .unwrap_or_default();
        let memory_total = key
            .get_value::<u64, _>("HardwareInformation.qwMemorySize")
            .ok()
            .or_else(|| {
                key.get_raw_value("HardwareInformation.qwMemorySize")
                    .ok()
                    .and_then(|raw| {
                        if raw.bytes.len() < 8 {
                            return None;
                        }
                        let bytes: [u8; 8] = raw.bytes[..8].try_into().ok()?;
                        match raw.vtype {
                            REG_QWORD | REG_BINARY => Some(u64::from_le_bytes(bytes)),
                            _ => None,
                        }
                    })
            })
            .filter(|value| *value > 0);
        adapters.push(RegistryAdapter {
            name,
            driver,
            memory_total,
        });
    }
    adapters
}

#[derive(Debug, Clone, Default)]
struct DxgiAdapter {
    name: String,
    memory_total: u64,
    driver: String,
    /// DXGI LUID, used to open the adapter for WDDM performance data.
    luid: Option<LUID>,
    /// Whether the adapter drives at least one display output.
    has_output: bool,
}

fn dxgi_adapters() -> Result<Vec<DxgiAdapter>, String> {
    let registry = registry_adapters();
    unsafe {
        let factory: IDXGIFactory1 =
            CreateDXGIFactory1().map_err(|error| format!("DXGI unavailable: {error}"))?;
        let mut adapters = Vec::new();
        let mut index = 0_u32;
        loop {
            let adapter = match factory.EnumAdapters1(index) {
                Ok(adapter) => adapter,
                Err(_) => break,
            };
            index += 1;
            let Ok(desc) = adapter.GetDesc1() else {
                continue;
            };
            let name = wide_string(&desc.Description);
            if name.is_empty() || is_virtual_adapter(&name) {
                continue;
            }
            let driver = registry
                .iter()
                .find(|candidate| candidate.name.eq_ignore_ascii_case(&name))
                .map(|candidate| candidate.driver.clone())
                .unwrap_or_default();
            adapters.push(DxgiAdapter {
                name,
                memory_total: desc.DedicatedVideoMemory as u64,
                driver,
                luid: Some(desc.AdapterLuid),
                has_output: adapter.EnumOutputs(0).is_ok(),
            });
        }
        Ok(adapters)
    }
}

fn gpu_from_adapters(adapters: &[DxgiAdapter], source: &str) -> Option<Gpu> {
    // Some drivers expose the same physical adapter through more than one DXGI
    // entry; collapse identical descriptions before reporting/aggregating.
    let mut seen = HashSet::new();
    let adapters: Vec<DxgiAdapter> = adapters
        .iter()
        .filter(|adapter| seen.insert(adapter.name.to_lowercase()))
        .cloned()
        .collect();
    if adapters.is_empty() {
        return None;
    }
    // The adapter that drives a display output is the "primary" one and the one
    // Task Manager reports; fall back to the largest VRAM.
    let primary = adapters
        .iter()
        .find(|adapter| adapter.has_output)
        .or_else(|| adapters.iter().max_by_key(|adapter| adapter.memory_total))?;
    let registry = registry_adapters();
    let registry_total = registry
        .iter()
        .filter_map(|adapter| adapter.memory_total)
        .max();
    let memory_total = registry_total.or_else(|| {
        if primary.memory_total > 0 {
            Some(primary.memory_total)
        } else {
            None
        }
    });
    let memory_used = pdh_array(GPU_MEMORY_COUNTER).ok().and_then(|values| {
        values
            .into_iter()
            .map(|(_, value)| value)
            .filter(|value| value.is_finite() && *value > 0.0)
            .reduce(f64::max)
            .map(|value| value.round() as u64)
    });
    let utilization = pdh_array(GPU_ENGINE_COUNTER)
        .ok()
        .map(|values| {
            values
                .into_iter()
                .map(|(_, value)| value)
                .filter(|value| value.is_finite() && *value > 0.0)
                .sum::<f64>()
        })
        .filter(|value| *value > 0.0)
        .map(|value| util::round1(util::clamp(value, 0.0, 100.0)));
    let memory_percent = match (memory_used, memory_total) {
        (Some(used), Some(total)) if total > 0 => {
            Some(util::round1(used as f64 / total as f64 * 100.0))
        }
        _ => None,
    };
    let perf = primary.luid.and_then(adapter_perf);
    Some(Gpu {
        name: primary.name.clone(),
        driver: primary.driver.clone(),
        adapters: adapters
            .iter()
            .map(|adapter| adapter.name.clone())
            .collect(),
        utilization,
        memory_used,
        memory_total,
        memory_percent,
        core_clock_mhz: perf.and_then(|value| value.core_clock_mhz),
        core_clock_max_mhz: perf.and_then(|value| value.core_clock_max_mhz),
        memory_clock_mhz: perf.and_then(|value| value.memory_clock_mhz),
        temperature_celsius: perf.and_then(|value| value.temperature_celsius),
        power_percent: perf.and_then(|value| value.power_percent),
        fan_rpm: perf.and_then(|value| value.fan_rpm),
        ok: true,
        source: source.to_string(),
        error: None,
    })
}

fn read_gpu() -> Option<Gpu> {
    if let Ok(adapters) = dxgi_adapters() {
        if let Some(gpu) = gpu_from_adapters(&adapters, "dxgi-pdh") {
            return Some(gpu);
        }
    }
    let registry = registry_adapters();
    let adapters: Vec<DxgiAdapter> = registry
        .iter()
        .map(|adapter| DxgiAdapter {
            name: adapter.name.clone(),
            memory_total: adapter.memory_total.unwrap_or(0),
            driver: adapter.driver.clone(),
            ..Default::default()
        })
        .collect();
    gpu_from_adapters(&adapters, "registry-pdh")
}

fn thermal_value(raw: f64, high_precision: bool) -> Option<f64> {
    let candidates: [f64; 2] = if high_precision {
        [raw / 10.0 - 273.15, raw - 273.15]
    } else {
        [raw - 273.15, raw / 10.0 - 273.15]
    };
    candidates
        .into_iter()
        .find(|celsius| (5.0..=125.0).contains(celsius))
}

/// `IOCTL_STORAGE_QUERY_PROPERTY` with `StorageDeviceTemperatureProperty`.
/// Works for NVMe/SATA drives as a standard user (the device is opened with no
/// access rights: the query itself only needs a handle).
const IOCTL_STORAGE_QUERY_PROPERTY: u32 = 0x002D_1400;
const STORAGE_DEVICE_TEMPERATURE_PROPERTY: u32 = 51;
/// `STORAGE_TEMPERATURE_VALUE_NOT_REPORTED` as a signed 16-bit value.
const TEMPERATURE_NOT_REPORTED: i16 = i16::MIN;
const MAX_PHYSICAL_DRIVES: u32 = 8;

#[repr(C)]
#[derive(Default)]
struct StoragePropertyQuery {
    property_id: u32,
    query_type: u32,
    additional: [u8; 1],
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
struct StorageTemperatureInfo {
    index: u16,
    temperature: i16,
    over_threshold: i16,
    under_threshold: i16,
    over_threshold_changeable: u8,
    under_threshold_changeable: u8,
    event_generated: u8,
    reserved0: u8,
    reserved1: u32,
}

#[repr(C)]
#[derive(Default)]
struct StorageTemperatureDescriptor {
    version: u32,
    size: u32,
    critical_temperature: i16,
    warning_temperature: i16,
    info_count: u16,
    reserved0: [u8; 2],
    reserved1: [u32; 2],
    temperature_info: [StorageTemperatureInfo; 16],
}

/// The device temperature (sensor index 0 is the composite reading) of one
/// physical drive, or `None` when the drive does not report it.
fn disk_temperature(index: u32) -> Option<f64> {
    let path = HSTRING::from(format!(r"\\.\PhysicalDrive{index}"));
    let handle: HANDLE = unsafe {
        CreateFileW(
            &path,
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            None,
        )
    }
    .ok()?;
    if handle.is_invalid() {
        return None;
    }
    let mut query = StoragePropertyQuery {
        property_id: STORAGE_DEVICE_TEMPERATURE_PROPERTY,
        query_type: 0,
        additional: [0],
    };
    let mut output = StorageTemperatureDescriptor::default();
    let mut returned = 0_u32;
    let ok = unsafe {
        DeviceIoControl(
            handle,
            IOCTL_STORAGE_QUERY_PROPERTY,
            Some(&mut query as *mut _ as *mut core::ffi::c_void),
            size_of::<StoragePropertyQuery>() as u32,
            Some(&mut output as *mut _ as *mut core::ffi::c_void),
            size_of::<StorageTemperatureDescriptor>() as u32,
            Some(&mut returned),
            None,
        )
    };
    unsafe {
        let _ = CloseHandle(handle);
    }
    if ok.is_err() {
        return None;
    }
    let count = (output.info_count as usize).min(output.temperature_info.len());
    let mut fallback = None;
    for info in output.temperature_info.iter().take(count) {
        let value = info.temperature;
        if value == TEMPERATURE_NOT_REPORTED || value <= 0 || value > 125 {
            continue;
        }
        // Sensor 0 is the composite (drive-level) reading; prefer it.
        if info.index == 0 {
            return Some(util::round1(value as f64));
        }
        fallback = Some(fallback.map_or(value, |current: i16| current.max(value)));
    }
    fallback.map(|value| util::round1(value as f64))
}

fn disk_temperatures() -> Vec<(String, f64)> {
    (0..MAX_PHYSICAL_DRIVES)
        .filter_map(|index| {
            disk_temperature(index).map(|celsius| (format!("磁盘 {index}"), celsius))
        })
        .collect()
}

fn is_cpu_sensor_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    ["cpu", "core", "package", "processor", "tdie", "tctl"]
        .iter()
        .any(|marker| lower.contains(marker))
}

fn read_temperatures(gpu: Option<&Gpu>) -> Vec<Temperature> {
    let mut temperatures = Vec::new();
    let mut seen = HashSet::new();
    // The WDDM die temperature is the reading Task Manager shows under GPU.
    if let Some(gpu) = gpu {
        if let Some(celsius) = gpu.temperature_celsius {
            seen.insert(gpu.name.to_lowercase());
            temperatures.push(Temperature {
                name: gpu.name.clone(),
                celsius,
            });
        }
    }
    for (name, celsius) in disk_temperatures() {
        if !seen.insert(name.to_lowercase()) {
            continue;
        }
        temperatures.push(Temperature { name, celsius });
    }

    let mut zones: Vec<Temperature> = Vec::new();
    for (counter, high_precision) in [(THERMAL_PRECISION_COUNTER, true), (THERMAL_COUNTER, false)] {
        let Ok(values) = pdh_array(counter) else {
            continue;
        };
        let mut zone_seen = HashSet::new();
        for (name, raw) in values {
            if !raw.is_finite() {
                continue;
            }
            let Some(celsius) = thermal_value(raw, high_precision) else {
                continue;
            };
            let name = if name.is_empty() {
                "Thermal Zone".to_string()
            } else {
                name
            };
            if !zone_seen.insert(name.to_lowercase()) {
                continue;
            }
            zones.push(Temperature {
                name,
                celsius: util::round1(celsius),
            });
        }
        if !zones.is_empty() {
            break;
        }
    }
    // ACPI thermal zones rarely carry a friendly name. The hottest zone is the
    // CPU package on virtually every laptop/board that exposes zones, so label
    // it explicitly instead of showing an opaque `\_TZ.TZ00`.
    if !zones.is_empty() && !zones.iter().any(|zone| is_cpu_sensor_name(&zone.name)) {
        if let Some(hottest) = zones
            .iter_mut()
            .max_by(|left, right| left.celsius.total_cmp(&right.celsius))
        {
            hottest.name = "CPU".to_string();
        }
    }
    for zone in zones {
        if seen.insert(zone.name.to_lowercase()) {
            temperatures.push(zone);
        }
    }
    temperatures
}

pub fn read() -> Result<Performance, String> {
    let (mut cpu, memory) = common::sample_system();
    let (model, registry_base) = registry_cpu();
    if let Some(name) = model {
        cpu.model = name;
    }
    if cpu.base_mhz.is_none() {
        cpu.base_mhz = registry_base;
    }

    // Prefer the PDH percentage (matches the old probe and reacts to boost);
    // fall back to CallNtPowerInformation on machines without the counter.
    let mut speed = None;
    if let (Some(base), Some(percent)) = (cpu.base_mhz, pdh_performance_percent()) {
        let mut current = base * percent / 100.0;
        if current > base * 2.0 {
            current = base * 2.0;
        }
        if current > 0.0 {
            speed = Some(util::round1(current));
        }
    }
    if speed.is_none() {
        if let Some((current, max)) = power_frequency() {
            if current > 0.0 {
                speed = Some(current);
            }
            if cpu.base_mhz.is_none() && max > 0.0 {
                cpu.base_mhz = Some(max);
            }
        }
    }
    cpu.speed_mhz = speed;

    let gpu = read_gpu();
    let temperatures = read_temperatures(gpu.as_ref());
    let mut performance = Performance::success(cpu, memory);
    performance.gpu = gpu;
    performance.temperatures = temperatures;
    Ok(performance)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_name_is_readable() {
        if let (Some(name), _) = registry_cpu() {
            assert!(!name.trim().is_empty());
        }
    }

    #[test]
    fn pdh_counter_is_available() {
        if let Some(percent) = pdh_performance_percent() {
            assert!(percent > 0.0);
        }
    }

    #[test]
    fn filters_virtual_adapters() {
        assert!(is_virtual_adapter("Microsoft Basic Display Adapter"));
        assert!(is_virtual_adapter("GameViewer Virtual Display"));
        assert!(!is_virtual_adapter("NVIDIA GeForce RTX 4070"));
    }

    #[test]
    fn converts_thermal_kelvin_values() {
        let high = thermal_value(3001.5, true).unwrap();
        assert!((high - 27.0).abs() < 0.2);
        let normal_tenths = thermal_value(300.15, false).unwrap();
        assert!((normal_tenths - 27.0).abs() < 0.2);
        let normal_kelvin = thermal_value(300.15, true).unwrap();
        assert!((normal_kelvin - 27.0).abs() < 0.2);
        assert_eq!(thermal_value(10.0, false), None);
    }

    #[test]
    fn gpu_reading_has_a_plausible_shape() {
        if let Some(gpu) = read_gpu() {
            assert!(gpu.ok);
            assert!(!gpu.name.is_empty());
            if let Some(value) = gpu.utilization {
                assert!((0.0..=100.0).contains(&value));
            }
        }
    }

    #[test]
    fn gpu_perf_values_are_plausible() {
        if let Some(gpu) = read_gpu() {
            if let Some(value) = gpu.core_clock_mhz {
                assert!((0.0..10_000.0).contains(&value), "core clock {value}");
            }
            if let Some(value) = gpu.core_clock_max_mhz {
                assert!(value > 0.0 && value < 10_000.0, "max clock {value}");
            }
            if let Some(value) = gpu.memory_clock_mhz {
                assert!(value > 0.0 && value < 30_000.0, "memory clock {value}");
            }
            if let Some(value) = gpu.temperature_celsius {
                assert!((5.0..=125.0).contains(&value), "temperature {value}");
            }
            if let Some(value) = gpu.power_percent {
                assert!((0.0..=100.0).contains(&value), "power {value}");
            }
            if let Some(value) = gpu.fan_rpm {
                assert!(value < 20_000, "fan {value}");
            }
        }
    }
}
