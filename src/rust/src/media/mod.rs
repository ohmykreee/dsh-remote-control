//! Media metadata + transport control.
//!
//! The JSON shape intentionally mirrors the old PowerShell SMTC result so
//! `lib/media.js` can keep its progress smoothing, NetEase enrichment and seek
//! rules unchanged.

use serde::Serialize;
use serde_json::{json, Value};

use crate::cli::{action_of, has_flag, option_number, option_value, CliError, CliResult};
use crate::util;

pub(crate) mod catalog;

#[cfg(windows)]
#[path = "windows.rs"]
mod platform;
#[cfg(target_os = "linux")]
#[path = "linux.rs"]
mod platform;
#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod platform;

// Compile the macOS implementation on other hosts for syntax/type checking.
// This is not a macOS build and does not enable the code path.
#[cfg(all(feature = "macos-check", not(target_os = "macos")))]
#[allow(dead_code)]
#[path = "macos.rs"]
mod macos_preview;

/// One media session, using the same field names as the SMTC PowerShell probe.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    pub app_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub track_number: i32,
    pub playback_status: String,
    pub auto_repeat_mode: String,
    pub shuffle_active: bool,
    pub position: f64,
    pub start_time: f64,
    pub end_time: f64,
    pub min_seek_time: f64,
    pub max_seek_time: f64,
    pub last_updated_at: i64,
    pub can_play_pause: bool,
    pub can_next: bool,
    pub can_previous: bool,
    pub can_seek: bool,
    pub thumbnail: Option<String>,
    pub thumbnail_type: Option<String>,
    pub thumbnail_error: Option<String>,
    /// HTTP(S) artwork reference (Linux MPRIS). The Node bridge downloads it and
    /// turns it into `thumbnail` so the sidecar needs no HTTP client.
    pub thumbnail_url: Option<String>,
    /// Local NetEase liked state. `Some(true)`/`Some(false)` when the local
    /// client database has a matching track, `None` when unknown.
    pub liked: Option<bool>,
    /// Display-only flag: the current app is NetEase Cloud Music.
    pub can_like: bool,
    pub track_id: Option<String>,
    /// Which layer produced this payload: `system`, `private` or
    /// `accessibility`. Only `system` may expose transport seeking.
    pub provider: String,
    /// Concrete provider within the layer (`smtc`, `mpris`, `nowplaying`,
    /// `window-title`, `cider-title`, `uia`, `atspi`, `ax`, ...).
    pub provider_detail: String,
}

impl Media {
    pub fn new(app_id: impl Into<String>) -> Self {
        Self {
            app_id: app_id.into(),
            title: String::new(),
            artist: String::new(),
            album: String::new(),
            album_artist: String::new(),
            track_number: 0,
            playback_status: "Closed".to_string(),
            auto_repeat_mode: String::new(),
            shuffle_active: false,
            position: 0.0,
            start_time: 0.0,
            end_time: 0.0,
            min_seek_time: 0.0,
            max_seek_time: 0.0,
            last_updated_at: 0,
            can_play_pause: true,
            can_next: true,
            can_previous: true,
            can_seek: false,
            thumbnail: None,
            thumbnail_type: None,
            thumbnail_error: None,
            thumbnail_url: None,
            liked: None,
            can_like: false,
            track_id: None,
            provider: catalog::Tier::System.as_str().to_string(),
            provider_detail: String::new(),
        }
    }

    pub fn finish(mut self) -> Self {
        if self.last_updated_at <= 0 {
            self.last_updated_at = util::now_ms();
        }
        crate::vendor::netease::enrich(&mut self);
        self
    }
}

/// Options shared by read and control commands.
#[derive(Debug, Clone, Default)]
pub struct ReadOptions {
    pub app_id: Option<String>,
    pub player: Option<String>,
    pub thumbnail: bool,
}

impl ReadOptions {
    pub fn from_args(args: &[String]) -> Self {
        Self {
            app_id: option_value(args, "--app-id").filter(|value| !value.is_empty()),
            player: option_value(args, "--player").filter(|value| !value.is_empty()),
            thumbnail: !has_flag(args, "--no-thumbnail"),
        }
    }
}

/// Read the active session. `Ok(None)` means "no player", not an error.
pub fn read(options: &ReadOptions) -> Value {
    let started_at = util::now_ms();
    match platform::read(options) {
        Ok(Some(media)) => json!({
            "ok": true,
            "available": true,
            "media": media.finish(),
            "error": null,
            "backend": platform::BACKEND,
            "sampledAt": started_at,
        }),
        Ok(None) => json!({
            "ok": true,
            "available": true,
            "media": null,
            "error": null,
            "backend": platform::BACKEND,
            "sampledAt": started_at,
        }),
        Err(error) => json!({
            "ok": false,
            "available": false,
            "media": null,
            "error": error,
            "backend": platform::BACKEND,
            "sampledAt": started_at,
        }),
    }
}

/// Run a transport action, wait briefly for the player to settle, then re-read.
pub fn control(action: &str, position: f64, options: &ReadOptions) -> Value {
    let started_at = util::now_ms();
    let result = platform::control(action, position, options);
    match result {
        Ok(()) => {
            // The PowerShell probe waited 140 ms so SMTC reflects the change.
            std::thread::sleep(std::time::Duration::from_millis(140));
            let (media, media_error) = match platform::read(options) {
                Ok(Some(media)) => (Some(media.finish()), None),
                Ok(None) => (None, None),
                Err(error) => (None, Some(error)),
            };
            json!({
                "ok": true,
                "action": action,
                "actionError": media_error,
                "media": media,
                "backend": platform::BACKEND,
                "sampledAt": util::now_ms(),
            })
        }
        Err(error) => json!({
            "ok": false,
            "action": action,
            "actionError": error,
            "media": null,
            "backend": platform::BACKEND,
            "sampledAt": started_at,
        }),
    }
}

pub fn cli(args: &[String], _started_at: i64) -> CliResult {
    let action = action_of(args);
    let options = ReadOptions::from_args(args);
    match action.as_str() {
        "read" => Ok(read(&options)),
        "playpause" | "next" | "previous" | "seek" => {
            let position = if action == "seek" {
                option_number(args, "--position").unwrap_or(0.0).max(0.0)
            } else {
                0.0
            };
            Ok(control(&action, position, &options))
        }
        other => Err(CliError::usage(format!(
            "unsupported media action: {other} (expected read, playpause, next, previous, seek)"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_serializes_camel_case() {
        let mut media = Media::new("MSEdge");
        media.title = "Title".to_string();
        media.can_seek = true;
        let value = serde_json::to_value(media).unwrap();
        assert_eq!(value["appId"], "MSEdge");
        assert_eq!(value["playbackStatus"], "Closed");
        assert_eq!(value["canPlayPause"], true);
        assert_eq!(value["startTime"], 0.0);
        assert_eq!(value["provider"], "system");
        assert!(value.get("lastUpdatedAt").is_some());
        assert!(value.get("thumbnailUrl").is_some());
    }

    #[test]
    fn parses_media_options() {
        let args = vec![
            "read".to_string(),
            "--app-id".to_string(),
            "MSEdge".to_string(),
            "--no-thumbnail".to_string(),
        ];
        let options = ReadOptions::from_args(&args);
        assert_eq!(options.app_id.as_deref(), Some("MSEdge"));
        assert!(!options.thumbnail);
    }
}
