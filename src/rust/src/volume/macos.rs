//! macOS volume probe: `osascript` on the system output volume.
//! Source only; not run in this repository's CI.

use super::Reading;
use crate::util;

pub const BACKEND: &str = "osascript";

fn volume_percent() -> Result<f64, String> {
    let text = util::command_output(
        "/usr/bin/osascript",
        &["-e", "output volume of (get volume settings)"],
    )?;
    text.parse::<f64>()
        .map_err(|error| format!("osascript returned {text:?}: {error}"))
}

fn muted() -> Result<bool, String> {
    let text = util::command_output(
        "/usr/bin/osascript",
        &["-e", "output muted of (get volume settings)"],
    )?;
    Ok(text.eq_ignore_ascii_case("true"))
}

pub fn read() -> Result<Reading, String> {
    Ok(Reading {
        volume: util::clamp(volume_percent()? / 100.0, 0.0, 1.0),
        muted: muted().unwrap_or(false),
        backend: BACKEND.to_string(),
    })
}

pub fn set(value: f64) -> Result<Reading, String> {
    let level = (util::clamp(value, 0.0, 1.0) * 100.0).round() as i64;
    util::command_output(
        "/usr/bin/osascript",
        &["-e", &format!("set volume output volume {level}")],
    )?;
    read()
}

pub fn toggle() -> Result<Reading, String> {
    let next = if muted().unwrap_or(false) {
        "false"
    } else {
        "true"
    };
    util::command_output(
        "/usr/bin/osascript",
        &["-e", &format!("set volume output muted {next}")],
    )?;
    read()
}
