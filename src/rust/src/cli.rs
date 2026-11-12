//! Command-line parsing and the JSON envelope shared by every subcommand.

use serde_json::{json, Value};

use crate::location;
use crate::media;
use crate::notifications;
use crate::perf;
use crate::util;
use crate::volume;

/// A command failure. Probe failures still print JSON and exit 0 so the Node
/// bridge can surface a useful error and fall back; usage errors exit 2.
pub struct CliError {
    pub message: String,
    pub usage: bool,
}

impl CliError {
    pub fn usage(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            usage: true,
        }
    }

    pub fn into_json(self, command: Option<&str>, started_at: i64) -> Value {
        json!({
            "ok": false,
            "available": false,
            "error": self.message,
            "command": command,
            "usageError": self.usage,
            "sampledAt": started_at,
        })
    }
}

pub type CliResult = Result<Value, CliError>;

const HELP: &str = "dsh-probe <command> [options]

Commands:
  version
  media read [--app-id ID] [--player DEST] [--no-thumbnail]
  media playpause|next|previous|seek [--position SECONDS] [--app-id ID] [--player DEST]
  volume read
  volume set --value 0.0..1.0
  volume toggle
  performance
  notifications [--limit 1..20]
  notifications watch [--limit 1..20]
  location
  location request [--open-settings]

Every command prints one line of JSON on stdout. Probe errors are reported as
{\"ok\":false,...\"} with exit code 0; malformed invocations exit with code 2.
`notifications watch` streams one JSON line per update and runs until killed.";

pub fn dispatch(args: &[String]) -> (Value, i32) {
    let started_at = util::now_ms();
    let command = args.first().map(String::as_str);
    let result = match command {
        Some("version") | Some("--version") | Some("-V") => Ok(version_json()),
        Some("help") | Some("--help") | Some("-h") | None => Ok(help_json()),
        Some("media") => media::cli(&args[1..], started_at),
        Some("volume") => volume::cli(&args[1..], started_at),
        Some("performance") | Some("perf") => perf::cli(&args[1..], started_at),
        Some("notifications") | Some("notification") => notifications::cli(&args[1..], started_at),
        Some("location") => location::cli(&args[1..], started_at),
        Some(other) => Err(CliError::usage(format!("unknown command: {other}"))),
    };
    match result {
        Ok(value) => (value, 0),
        Err(error) => {
            let usage = error.usage;
            let value = error.into_json(command, started_at);
            (value, if usage { 2 } else { 0 })
        }
    }
}

pub fn version_json() -> Value {
    json!({
        "ok": true,
        "name": "dsh-probe",
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "media": platform_media_backend(),
        "volume": platform_volume_backend(),
        "performance": platform_perf_backend(),
        "notifications": platform_notification_backend(),
        "location": platform_location_backend(),
        "sampledAt": util::now_ms(),
    })
}

fn help_json() -> Value {
    json!({ "ok": true, "help": HELP, "version": env!("CARGO_PKG_VERSION") })
}

pub fn platform_media_backend() -> &'static str {
    #[cfg(windows)]
    {
        "windows-smtc"
    }
    #[cfg(target_os = "linux")]
    {
        "linux-mpris"
    }
    #[cfg(target_os = "macos")]
    {
        "macos-media"
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        "unsupported"
    }
}

pub fn platform_volume_backend() -> &'static str {
    #[cfg(windows)]
    {
        "windows-coreaudio"
    }
    #[cfg(target_os = "linux")]
    {
        "linux-wpctl-pactl-amixer"
    }
    #[cfg(target_os = "macos")]
    {
        "macos-osascript"
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        "unsupported"
    }
}

pub fn platform_perf_backend() -> &'static str {
    #[cfg(windows)]
    {
        "windows-dxgi-pdh-d3dkmt"
    }
    #[cfg(target_os = "linux")]
    {
        "linux-sysinfo-sysfs"
    }
    #[cfg(target_os = "macos")]
    {
        "macos-sysinfo"
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        "unsupported"
    }
}

pub fn platform_notification_backend() -> &'static str {
    #[cfg(windows)]
    {
        "windows-notification-database"
    }
    #[cfg(target_os = "linux")]
    {
        "linux-dbus-notifications"
    }
    #[cfg(target_os = "macos")]
    {
        "macos-notification-center"
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        "unsupported"
    }
}

pub fn platform_location_backend() -> &'static str {
    #[cfg(windows)]
    {
        "windows-geolocation"
    }
    #[cfg(target_os = "linux")]
    {
        "linux-geoclue2"
    }
    #[cfg(target_os = "macos")]
    {
        "macos-corelocation-unavailable"
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        "unsupported"
    }
}

/// Read `--name value` (or `--name=value`) from an argument list.
pub fn option_value(args: &[String], name: &str) -> Option<String> {
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if arg == name {
            return args.get(index + 1).cloned();
        }
        if let Some(value) = arg.strip_prefix(&format!("{name}=")) {
            return Some(value.to_string());
        }
        index += 1;
    }
    None
}

/// Parse an option as a finite number, ignoring malformed values.
pub fn option_number(args: &[String], name: &str) -> Option<f64> {
    option_value(args, name)
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite())
}

pub fn has_flag(args: &[String], name: &str) -> bool {
    args.iter().any(|arg| arg == name)
}

/// The action word for `media`/`volume`, defaulting to `read`.
pub fn action_of(args: &[String]) -> String {
    args.first()
        .filter(|value| !value.starts_with("--"))
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| "read".to_string())
}
