//! Windows location: WinRT `Windows.Devices.Geolocation.Geolocator`.
//!
//! This is the same system API the old PowerShell probe used, now called from
//! Rust. Access can be denied by the Windows privacy settings; the error is
//! returned to Node, which falls back to IP geolocation.

use windows::Devices::Geolocation::{GeolocationAccessStatus, Geolocator, PositionAccuracy};
use windows::Foundation::TimeSpan;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

use super::Reading;

const REQUEST_TIMEOUT: TimeSpan = TimeSpan {
    // 8 seconds in 100 ns ticks.
    Duration: 80_000_000,
};
const MAXIMUM_AGE: TimeSpan = TimeSpan {
    // 10 minutes in 100 ns ticks.
    Duration: 6_000_000_000,
};

fn ensure_com() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| unsafe {
        // S_FALSE / RPC_E_CHANGED_MODE are harmless.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    });
}

pub fn read() -> Result<Reading, String> {
    ensure_com();
    let access = Geolocator::RequestAccessAsync()
        .map_err(|error| format!("geolocation request failed: {error}"))?
        .join()
        .map_err(|error| format!("geolocation access request failed: {error}"))?;
    if access != GeolocationAccessStatus::Allowed {
        let label = if access == GeolocationAccessStatus::Denied {
            "denied"
        } else {
            "not granted"
        };
        return Err(format!(
            "Windows location access {label}; enable Settings > Privacy > Location"
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
}
