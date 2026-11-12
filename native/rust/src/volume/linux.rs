//! Linux volume probe.
//!
//! Preference order matches the JavaScript adapter: PipeWire (`wpctl`), then
//! PulseAudio (`pactl`), then ALSA (`amixer`). Each backend is an external
//! command with a strict output parser; a failure falls through to the next.

use std::path::PathBuf;

use super::Reading;
use crate::util;

pub const BACKEND: &str = "wpctl";

fn wpctl() -> Option<PathBuf> {
    util::find_executable("wpctl")
}

fn pactl() -> Option<PathBuf> {
    util::find_executable("pactl")
}

fn amixer() -> Option<PathBuf> {
    util::find_executable("amixer")
}

fn parse_decimal_after(text: &str, marker: &str) -> Option<f64> {
    let rest = text.split_once(marker)?.1;
    let number: String = rest
        .trim_start()
        .chars()
        .take_while(|character| character.is_ascii_digit() || *character == '.')
        .collect();
    number.parse::<f64>().ok()
}

fn parse_percent(text: &str) -> Option<f64> {
    // "Volume: front-left: 32768 /  50% / -18.06 dB" -> 50
    let mut digits = String::new();
    for character in text.chars() {
        if character.is_ascii_digit() {
            digits.push(character);
        } else if character == '%' {
            if let Ok(value) = digits.parse::<f64>() {
                return Some(value / 100.0);
            }
            digits.clear();
        } else {
            digits.clear();
        }
    }
    None
}

fn read_wpctl(path: &PathBuf) -> Result<Reading, String> {
    let text = util::run_path_command(path, &["get-volume", "@DEFAULT_AUDIO_SINK@"])?;
    let volume = parse_decimal_after(&text, "Volume:").unwrap_or(0.5);
    Ok(Reading {
        volume: util::clamp(volume, 0.0, 1.0),
        muted: text.to_ascii_uppercase().contains("[MUTED]"),
        backend: "wpctl".to_string(),
    })
}

fn read_pactl(path: &PathBuf) -> Result<Reading, String> {
    let volume_text = util::run_path_command(path, &["get-sink-volume", "@DEFAULT_SINK@"])?;
    let mute_text = util::run_path_command(path, &["get-sink-mute", "@DEFAULT_SINK@"])?;
    let volume = parse_percent(&volume_text).unwrap_or(0.5);
    Ok(Reading {
        volume: util::clamp(volume, 0.0, 1.0),
        muted: mute_text.to_ascii_lowercase().contains("yes"),
        backend: "pactl".to_string(),
    })
}

fn read_amixer(path: &PathBuf) -> Result<Reading, String> {
    let text = util::run_path_command(path, &["get", "Master"])?;
    let volume = parse_percent(&text).unwrap_or(0.5);
    Ok(Reading {
        volume: util::clamp(volume, 0.0, 1.0),
        muted: text.contains("[off]"),
        backend: "amixer".to_string(),
    })
}

pub fn read() -> Result<Reading, String> {
    let mut last_error = String::new();
    if let Some(path) = wpctl() {
        match read_wpctl(&path) {
            Ok(reading) => return Ok(reading),
            Err(error) => last_error = error,
        }
    }
    if let Some(path) = pactl() {
        match read_pactl(&path) {
            Ok(reading) => return Ok(reading),
            Err(error) => last_error = error,
        }
    }
    if let Some(path) = amixer() {
        match read_amixer(&path) {
            Ok(reading) => return Ok(reading),
            Err(error) => last_error = error,
        }
    }
    if last_error.is_empty() {
        Err("no supported audio backend (wpctl, pactl, amixer)".to_string())
    } else {
        Err(last_error)
    }
}

pub fn set(value: f64) -> Result<Reading, String> {
    let value = util::clamp(value, 0.0, 1.0);
    let mut last_error = String::new();
    if let Some(path) = wpctl() {
        let text = format!("{value:.2}");
        match util::run_path_command(&path, &["set-volume", "@DEFAULT_AUDIO_SINK@", &text]) {
            Ok(_) => return read_wpctl(&path),
            Err(error) => last_error = error,
        }
    }
    if let Some(path) = pactl() {
        let text = format!("{}%", (value * 100.0).round() as i64);
        match util::run_path_command(&path, &["set-sink-volume", "@DEFAULT_SINK@", &text]) {
            Ok(_) => return read_pactl(&path),
            Err(error) => last_error = error,
        }
    }
    if let Some(path) = amixer() {
        let text = format!("{}%", (value * 100.0).round() as i64);
        match util::run_path_command(&path, &["set", "Master", &text]) {
            Ok(_) => return read_amixer(&path),
            Err(error) => last_error = error,
        }
    }
    if last_error.is_empty() {
        Err("no supported audio backend (wpctl, pactl, amixer)".to_string())
    } else {
        Err(last_error)
    }
}

pub fn toggle() -> Result<Reading, String> {
    let mut last_error = String::new();
    if let Some(path) = wpctl() {
        match util::run_path_command(&path, &["set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"]) {
            Ok(_) => return read_wpctl(&path),
            Err(error) => last_error = error,
        }
    }
    if let Some(path) = pactl() {
        match util::run_path_command(&path, &["set-sink-mute", "@DEFAULT_SINK@", "toggle"]) {
            Ok(_) => return read_pactl(&path),
            Err(error) => last_error = error,
        }
    }
    if let Some(path) = amixer() {
        match util::run_path_command(&path, &["set", "Master", "toggle"]) {
            Ok(_) => return read_amixer(&path),
            Err(error) => last_error = error,
        }
    }
    if last_error.is_empty() {
        Err("no supported audio backend (wpctl, pactl, amixer)".to_string())
    } else {
        Err(last_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wpctl_volume() {
        assert_eq!(parse_decimal_after("Volume: 0.45", "Volume:"), Some(0.45));
        assert_eq!(
            parse_decimal_after("Volume: 1.00 [MUTED]", "Volume:"),
            Some(1.0)
        );
    }

    #[test]
    fn parses_pactl_percent() {
        assert_eq!(
            parse_percent("Volume: front-left: 32768 /  50% / -18.06 dB"),
            Some(0.5)
        );
        assert_eq!(
            parse_percent("Volume: front-left: 65536 / 100% / 0.00 dB"),
            Some(1.0)
        );
        assert_eq!(parse_percent("no percent"), None);
    }
}
