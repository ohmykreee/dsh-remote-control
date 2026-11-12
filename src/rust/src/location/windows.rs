//! Windows location: WinRT `Windows.Devices.Geolocation.Geolocator`.
//!
//! This is the same system API the old PowerShell probe used, now called from
//! Rust. Access can be denied by the Windows privacy settings *or* because the
//! process runs below the Medium integrity level (a Low mandatory label on the
//! plugin directory is enough), which Windows treats as untrusted for location.
//! `request_access` reports both cases and can open the privacy settings page
//! for the user.

use std::mem::{size_of, size_of_val};

use windows::core::PCWSTR;
use windows::Devices::Geolocation::{GeolocationAccessStatus, Geolocator, PositionAccuracy};
use windows::Foundation::TimeSpan;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Security::{
    GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, TokenIntegrityLevel,
    TOKEN_MANDATORY_LABEL, TOKEN_QUERY,
};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

use super::{AccessReport, Reading};

const REQUEST_TIMEOUT: TimeSpan = TimeSpan {
    // 8 seconds in 100 ns ticks.
    Duration: 80_000_000,
};
const MAXIMUM_AGE: TimeSpan = TimeSpan {
    // 10 minutes in 100 ns ticks.
    Duration: 6_000_000_000,
};
/// `SECURITY_MANDATORY_MEDIUM_RID`; anything below it is Low/Untrusted.
const SECURITY_MANDATORY_MEDIUM_RID: u32 = 0x2000;

fn ensure_com() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| unsafe {
        // S_FALSE / RPC_E_CHANGED_MODE are harmless.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    });
}

fn access_status() -> Result<GeolocationAccessStatus, String> {
    ensure_com();
    Geolocator::RequestAccessAsync()
        .map_err(|error| format!("geolocation request failed: {error}"))?
        .join()
        .map_err(|error| format!("geolocation access request failed: {error}"))
}

/// Whether this process is running at the Low integrity level. Windows refuses
/// location access to Low-integrity processes even when the privacy settings
/// allow desktop apps, so this distinction matters for the hint shown in the UI.
fn is_low_integrity() -> bool {
    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut size = 0_u32;
        let _ = GetTokenInformation(token, TokenIntegrityLevel, None, 0, &mut size);
        if size == 0 {
            let _ = CloseHandle(token);
            return false;
        }
        // `GetTokenInformation` writes a TOKEN_MANDATORY_LABEL followed by the
        // SID; use word-aligned storage so the cast below is well defined.
        let words = (size as usize).div_ceil(size_of::<usize>()).max(1);
        let mut buffer = vec![0_usize; words];
        let query = GetTokenInformation(
            token,
            TokenIntegrityLevel,
            Some(buffer.as_mut_ptr() as *mut core::ffi::c_void),
            size_of_val(&buffer[..]) as u32,
            &mut size,
        );
        let _ = CloseHandle(token);
        if query.is_err() {
            return false;
        }
        let label = &*(buffer.as_ptr() as *const TOKEN_MANDATORY_LABEL);
        let sid = label.Label.Sid;
        if sid.is_invalid() {
            return false;
        }
        let count = GetSidSubAuthorityCount(sid);
        if count.is_null() || *count == 0 {
            return false;
        }
        let rid = GetSidSubAuthority(sid, 0);
        if rid.is_null() {
            return false;
        }
        *rid < SECURITY_MANDATORY_MEDIUM_RID
    }
}

/// Open `Settings > Privacy & security > Location` so the user can grant access.
fn open_location_settings() -> bool {
    unsafe {
        let result = ShellExecuteW(
            None,
            windows::core::w!("open"),
            windows::core::w!("ms-settings:privacy-location"),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
        result.0 as isize > 32
    }
}

/// Ask the OS for location permission and report the exact blocker.
pub fn request_access(open_settings: bool) -> AccessReport {
    let low_integrity = is_low_integrity();
    let (access, reason) = match access_status() {
        Ok(status) if status == GeolocationAccessStatus::Allowed => ("allowed", None),
        Ok(status) if status == GeolocationAccessStatus::Denied => {
            ("denied", Some("privacy-denied"))
        }
        Ok(_) => ("unspecified", Some("unspecified")),
        Err(_) => ("unknown", Some("request-failed")),
    };
    let reason = if access == "denied" && low_integrity {
        Some("low-integrity")
    } else {
        reason
    };
    let opened_settings = open_settings && access != "allowed" && open_location_settings();
    AccessReport {
        access,
        low_integrity,
        opened_settings,
        reason,
    }
}

pub fn read() -> Result<Reading, String> {
    let access = access_status()?;
    if access != GeolocationAccessStatus::Allowed {
        let label = if access == GeolocationAccessStatus::Denied {
            "denied"
        } else {
            "not granted"
        };
        if is_low_integrity() {
            return Err(format!(
                "Windows location access {label}: dsh-probe is running at low integrity, and Windows blocks location for low-integrity processes; rebuild the probe into a normal-integrity directory or open the location settings"
            ));
        }
        return Err(format!(
            "Windows location access {label}; enable Settings > Privacy > Location (desktop apps) or use the location permission request in the weather settings"
        ));
    }
    let locator =
        Geolocator::new().map_err(|error| format!("could not create Geolocator: {error}"))?;
    let _ = locator.SetDesiredAccuracy(PositionAccuracy::High);
    let position = locator
        .GetGeopositionAsyncWithAgeAndTimeout(MAXIMUM_AGE, REQUEST_TIMEOUT)
        .map_err(|error| format!("could not request a position: {error}"))?
        .join()
        .map_err(|error| format!("could not read a position: {error}"))?;
    let coordinate = position
        .Coordinate()
        .map_err(|error| format!("position has no coordinate: {error}"))?;
    let point = coordinate
        .Point()
        .map_err(|error| format!("coordinate has no point: {error}"))?;
    let basic = point
        .Position()
        .map_err(|error| format!("point has no position: {error}"))?;
    let accuracy = coordinate.Accuracy().ok();
    if !basic.Latitude.is_finite()
        || !basic.Longitude.is_finite()
        || basic.Latitude.abs() > 90.0
        || basic.Longitude.abs() > 180.0
    {
        return Err("Windows returned an invalid coordinate".to_string());
    }
    Ok(Reading {
        latitude: basic.Latitude,
        longitude: basic.Longitude,
        accuracy,
        source: "windows-geolocation",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovers_from_com_initialization() {
        ensure_com();
        ensure_com();
    }

    #[test]
    fn integrity_probe_returns_a_bool() {
        let _ = is_low_integrity();
    }
}
