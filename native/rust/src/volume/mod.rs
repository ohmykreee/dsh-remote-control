//! System output volume: Core Audio, PipeWire/PulseAudio/ALSA, or osascript.

use serde_json::{json, Value};

use crate::cli::{action_of, option_number, CliError, CliResult};
use crate::util;

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

/// A successful volume reading from whichever backend handled it.
#[derive(Debug, Clone)]
pub struct Reading {
    pub volume: f64,
    pub muted: bool,
    pub backend: String,
}

fn envelope(result: Result<Reading, String>, started_at: i64) -> Value {
    match result {
        Ok(reading) => json!({
            "ok": true,
            "available": true,
            "volume": util::clamp(reading.volume, 0.0, 1.0),
            "muted": reading.muted,
            "backend": reading.backend,
            "error": null,
            "updatedAt": util::now_ms(),
            "sampledAt": started_at,
        }),
        Err(error) => json!({
            "ok": false,
            "available": false,
            "volume": 0.5,
            "muted": false,
            "backend": platform::BACKEND,
            "error": error,
            "updatedAt": util::now_ms(),
            "sampledAt": started_at,
        }),
    }
}

pub fn read() -> Value {
    let started_at = util::now_ms();
    envelope(platform::read(), started_at)
}

pub fn set(value: f64) -> Value {
    let started_at = util::now_ms();
    envelope(platform::set(util::clamp(value, 0.0, 1.0)), started_at)
}

pub fn toggle() -> Value {
    let started_at = util::now_ms();
    envelope(platform::toggle(), started_at)
}

pub fn cli(args: &[String], _started_at: i64) -> CliResult {
    let action = action_of(args);
    match action.as_str() {
        "read" => Ok(read()),
        "set" => {
            let value = option_number(args, "--value")
                .or_else(|| {
                    args.iter()
                        .find(|arg| arg.parse::<f64>().is_ok())
                        .and_then(|arg| arg.parse::<f64>().ok())
                })
                .ok_or_else(|| CliError::usage("volume set requires --value <0.0..1.0>"))?;
            Ok(set(value))
        }
        "toggle" | "mute" => Ok(toggle()),
        other => Err(CliError::usage(format!(
            "unsupported volume action: {other} (expected read, set, toggle)"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_clamps_and_marks_errors() {
        let value = envelope(
            Ok(Reading {
                volume: 4.2,
                muted: true,
                backend: "test".to_string(),
            }),
            123,
        );
        assert_eq!(value["ok"], true);
        assert_eq!(value["volume"], 1.0);
        assert_eq!(value["muted"], true);
        assert_eq!(value["sampledAt"], 123);

        let error = envelope(Err("nope".to_string()), 5);
        assert_eq!(error["ok"], false);
        assert_eq!(error["error"], "nope");
        assert_eq!(error["volume"], 0.5);
    }
}
