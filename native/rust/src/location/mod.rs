//! Current location from each platform's system location API.
//!
//! * Windows: WinRT `Windows.Devices.Geolocation.Geolocator`
//! * Linux: GeoClue2 (`org.freedesktop.GeoClue2`) over the session/system bus
//! * macOS: CoreLocation requires an app bundle/usage description, which a
//!   sidecar process cannot provide; returns a clear error so Node can fall
//!   back to IP geolocation. Source only, untested.
//!
//! The Node weather service treats this as a best-effort first step and falls
//! back to IP geolocation / timezone.

use serde_json::{json, Value};

use crate::cli::CliResult;

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

#[derive(Debug, Clone)]
pub struct Reading {
    pub latitude: f64,
    pub longitude: f64,
    pub accuracy: Option<f64>,
    pub source: &'static str,
}

fn reading_json(reading: &Reading, sampled_at: i64) -> Value {
    json!({
        "ok": true,
        "available": true,
        "latitude": reading.latitude,
        "longitude": reading.longitude,
        "accuracy": reading.accuracy,
        "source": reading.source,
        "error": null,
        "sampledAt": sampled_at,
    })
}

fn error_json(error: &str, sampled_at: i64) -> Value {
    json!({
        "ok": false,
        "available": false,
        "latitude": null,
        "longitude": null,
        "accuracy": null,
        "source": "none",
        "error": error,
        "sampledAt": sampled_at,
    })
}

pub fn read_json(sampled_at: i64) -> Value {
    match platform::read() {
        Ok(reading) => reading_json(&reading, sampled_at),
        Err(error) => error_json(&error, sampled_at),
    }
}

pub fn cli(_args: &[String], started_at: i64) -> CliResult {
    Ok(read_json(started_at))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn success_shape_is_camel_case() {
        let value = reading_json(
            &Reading {
                latitude: 31.2,
                longitude: 121.5,
                accuracy: Some(12.0),
                source: "test",
            },
            5,
        );
        assert_eq!(value["ok"], true);
        assert_eq!(value["latitude"], 31.2);
        assert_eq!(value["longitude"], 121.5);
        assert_eq!(value["source"], "test");
        assert_eq!(value["sampledAt"], 5);
    }

    #[test]
    fn error_shape_is_clean() {
        let value = error_json("no location", 6);
        assert_eq!(value["ok"], false);
        assert_eq!(value["available"], false);
        assert_eq!(value["latitude"], serde_json::Value::Null);
        assert_eq!(value["error"], "no location");
    }
}
