//! Current location from each platform's system location API.
//!
//! * Windows: WinRT `Windows.Devices.Geolocation.Geolocator`, plus an explicit
//!   permission-request command that reports privacy/integrity blockers.
//! * Linux: GeoClue2 (`org.freedesktop.GeoClue2`) over the session/system bus
//! * macOS: CoreLocation requires an app bundle/usage description, which a
//!   sidecar process cannot provide; returns a clear error so Node can fall
//!   back to IP geolocation. Source only, untested.
//!
//! The Node weather service treats this as a best-effort first step and falls
//! back to IP geolocation / timezone.

use serde_json::{json, Value};

use crate::cli::{action_of, has_flag, CliError, CliResult};

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

/// The outcome of asking the OS for location permission.
#[derive(Debug, Clone)]
pub struct AccessReport {
    /// `allowed`, `denied`, `unspecified`, `unknown` or `unsupported`.
    pub access: &'static str,
    /// The process runs at the Low integrity level (Windows only).
    pub low_integrity: bool,
    /// The privacy settings page was opened for the user.
    pub opened_settings: bool,
    /// Machine-readable blocker: `low-integrity`, `privacy-denied`,
    /// `unspecified`, `request-failed`, `unavailable`.
    pub reason: Option<&'static str>,
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

fn access_json(report: &AccessReport, sampled_at: i64) -> Value {
    json!({
        "ok": true,
        "available": report.access == "allowed",
        "access": report.access,
        "allowed": report.access == "allowed",
        "lowIntegrity": report.low_integrity,
        "openedSettings": report.opened_settings,
        "reason": report.reason,
        "sampledAt": sampled_at,
    })
}

pub fn read_json(sampled_at: i64) -> Value {
    match platform::read() {
        Ok(reading) => reading_json(&reading, sampled_at),
        Err(error) => error_json(&error, sampled_at),
    }
}

/// Ask for location permission. The platform module owns the consent flow
/// (Windows) or reports whether a location can be read at all.
fn request_access(open_settings: bool) -> AccessReport {
    platform::request_access(open_settings)
}

pub fn cli(args: &[String], started_at: i64) -> CliResult {
    match action_of(args).as_str() {
        "read" => Ok(read_json(started_at)),
        "request" => Ok(access_json(
            &request_access(has_flag(args, "--open-settings")),
            started_at,
        )),
        other => Err(CliError::usage(format!(
            "unsupported location action: {other} (expected read, request)"
        ))),
    }
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

    #[test]
    fn access_shape_reports_the_blocker() {
        let value = access_json(
            &AccessReport {
                access: "denied",
                low_integrity: true,
                opened_settings: true,
                reason: Some("low-integrity"),
            },
            7,
        );
        assert_eq!(value["ok"], true);
        assert_eq!(value["available"], false);
        assert_eq!(value["access"], "denied");
        assert_eq!(value["allowed"], false);
        assert_eq!(value["lowIntegrity"], true);
        assert_eq!(value["openedSettings"], true);
        assert_eq!(value["reason"], "low-integrity");
        assert_eq!(value["sampledAt"], 7);
    }
}
