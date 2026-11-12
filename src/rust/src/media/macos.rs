//! macOS media probe.
//!
//! MediaRemote's private framework is not linkable without entitlements, so the
//! sidecar uses the same two public routes as the JavaScript adapter:
//!   1. `nowplaying-cli` when installed (system-wide Now Playing, artwork).
//!   2. AppleScript against Music/Spotify as a fallback (no artwork).
//!
//! This module is source-only: it is compiled and type-checked with
//! `cargo check --features macos-check` but has not been run on macOS.

use super::catalog::{self, Tier};
use super::{Media, ReadOptions};
use crate::util;

#[path = "macos/accessibility.rs"]
mod accessibility;

pub const BACKEND: &str = "macos-nowplaying";

const MAX_ARTWORK_BYTES: usize = 8 * 1024 * 1024;

fn nowplaying_cli() -> Option<std::path::PathBuf> {
    util::find_executable("nowplaying-cli")
}

/// Best-effort client identity for nowplaying, which does not expose the
/// bundle id. This keeps the vendor-first dispatch working on macOS.
fn playing_app_id() -> Option<&'static str> {
    for (process, app_id) in [
        ("Music", "Music"),
        ("Spotify", "Spotify"),
        ("Cider", "Cider"),
    ] {
        if util::command_output("pgrep", &["-x", process]).is_ok() {
            return Some(app_id);
        }
    }
    None
}

fn parse_key_values(text: &str) -> std::collections::HashMap<String, String> {
    let mut values = std::collections::HashMap::new();
    for line in text.lines() {
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            if !key.is_empty() {
                values.insert(key.to_string(), value.trim().to_string());
            }
        }
    }
    values
}

fn read_nowplaying(path: &std::path::Path) -> Result<Option<Media>, String> {
    let output = util::run_path_command(
        path,
        &[
            "get",
            "title",
            "artist",
            "album",
            "duration",
            "elapsedTime",
            "playbackRate",
            "artworkData",
            "artworkMIMEType",
        ],
    )?;
    let values = parse_key_values(&output);
    let title = values.get("title").cloned().unwrap_or_default();
    let artist = values.get("artist").cloned().unwrap_or_default();
    if title.trim().is_empty() && artist.trim().is_empty() {
        return Ok(None);
    }
    let duration = values
        .get("duration")
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0);
    let position = values
        .get("elapsedTime")
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0);
    let rate = values
        .get("playbackRate")
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0);

    let mut media = Media::new("macOS");
    media.provider_detail = "nowplaying".to_string();
    media.title = if title.trim().is_empty() {
        "未命名媒体".to_string()
    } else {
        title
    };
    media.artist = artist;
    media.album = values.get("album").cloned().unwrap_or_default();
    media.playback_status = if rate > 0.0 { "Playing" } else { "Paused" }.to_string();
    media.position = position.max(0.0);
    media.start_time = 0.0;
    media.end_time = duration.max(0.0);
    media.min_seek_time = 0.0;
    media.max_seek_time = duration.max(0.0);
    media.last_updated_at = util::now_ms();
    media.can_play_pause = true;
    media.can_next = true;
    media.can_previous = true;
    media.can_seek = catalog::seek_allowed(Tier::System, duration > 0.0, false);

    if let Some(data) = values.get("artworkData") {
        if !data.is_empty() && data.len() < MAX_ARTWORK_BYTES {
            let mime = values
                .get("artworkMIMEType")
                .filter(|value| !value.is_empty())
                .cloned()
                .unwrap_or_else(|| "image/jpeg".to_string());
            media.thumbnail = Some(format!(
                "data:{mime};base64,{}",
                data.replace(char::is_whitespace, "")
            ));
            media.thumbnail_type = Some(mime);
        }
    }
    Ok(Some(media))
}

fn applescript(script: &str) -> Result<String, String> {
    util::command_output("/usr/bin/osascript", &["-e", script])
}

/// AppleScript fallback: query Music first, then Spotify. Returns `None` when
/// neither app is running or neither is playing something.
fn read_applescript() -> Result<Option<Media>, String> {
    let script = r#"
set out to ""
tell application "System Events"
    set musicRunning to (exists process "Music")
    set spotifyRunning to (exists process "Spotify")
end tell
if musicRunning then
    tell application "Music"
        try
            set st to player state as string
            if st is not "stopped" then
                set out to "Music" & tab & st & tab & (name of current track) & tab & (artist of current track) & tab & (album of current track) & tab & (duration of current track) & tab & (player position)
            end if
        end try
    end tell
end if
if out is "" and spotifyRunning then
    tell application "Spotify"
        try
            set st to player state as string
            if st is not "stopped" then
                set out to "Spotify" & tab & st & tab & (name of current track) & tab & (artist of current track) & tab & (album of current track) & tab & ((duration of current track) / 1000) & tab & (player position)
            end if
        end try
    end tell
end if
return out
"#;
    let output = applescript(script)?;
    let output = output.trim();
    if output.is_empty() {
        return Ok(None);
    }
    let fields: Vec<&str> = output.split('\t').collect();
    if fields.len() < 7 {
        return Ok(None);
    }
    let app = fields[0];
    let state = fields[1].to_ascii_lowercase();
    let mut media = Media::new(app);
    media.provider_detail = "applescript".to_string();
    media.title = fields[2].to_string();
    media.artist = fields[3].to_string();
    media.album = fields[4].to_string();
    media.playback_status = match state.as_str() {
        "playing" => "Playing",
        "paused" => "Paused",
        _ => "Stopped",
    }
    .to_string();
    media.position = fields[6].parse::<f64>().unwrap_or(0.0).max(0.0);
    let duration = fields[5].parse::<f64>().unwrap_or(0.0).max(0.0);
    media.end_time = duration;
    media.max_seek_time = duration;
    media.last_updated_at = util::now_ms();
    media.can_play_pause = true;
    media.can_next = true;
    media.can_previous = true;
    media.can_seek = catalog::seek_allowed(Tier::System, duration > 0.0, false);
    Ok(Some(media))
}

/// Cider's private title file. Cider is the Apple Music client used by the
/// reference project when MediaRemote cannot identify the track.
fn read_cider() -> Option<Media> {
    if util::command_output("pgrep", &["-x", "Cider"]).is_err() {
        return None;
    }
    let parsed = crate::media::vendor::apple_music::cider_title()?;
    let mut media = Media::new("Cider");
    media.provider = Tier::Private.as_str().to_string();
    media.provider_detail = "cider-title".to_string();
    media.title = parsed.title;
    media.artist = parsed.artist;
    media.playback_status = "Paused".to_string();
    media.can_play_pause = false;
    media.can_next = false;
    media.can_previous = false;
    media.can_seek = false;
    media.last_updated_at = util::now_ms();
    Some(media)
}

/// System-branch validity exposed to vendor modules.
pub(crate) fn system_valid(media: &Media) -> bool {
    !media.title.trim().is_empty()
        && media.playback_status != "Closed"
        && media.end_time > media.start_time
        && media.end_time > 0.0
        && media.can_seek
}

pub fn read(options: &ReadOptions) -> Result<Option<Media>, String> {
    let mut media = if let Some(path) = nowplaying_cli() {
        read_nowplaying(&path).unwrap_or(None)
    } else {
        None
    };
    if media.is_none() {
        // If the system route failed, try AppleScript before the private
        // Cider title, then return an empty reading.
        media = read_applescript().unwrap_or(None);
    }
    if media.is_none() {
        media = read_cider();
    }
    if media.is_none() {
        // No Now Playing/AppleScript/Cider source: try the NetEase CDP page.
        return Ok(crate::media::vendor::netease::cdp_media());
    }
    if let Some(media) = media.as_mut() {
        if media.app_id == "macOS" {
            if let Some(app_id) = playing_app_id() {
                media.app_id = app_id.to_string();
            }
        }
        // Accessibility is the last resort for a read-only progress display.
        // It is only attempted when the system/private tier did not provide a
        // duration; it never changes `canSeek`.
        if media.end_time <= 0.0 {
            if let Some(process) = accessibility_process(&media.app_id) {
                if let Some((position, total)) = accessibility::progress(process) {
                    if total > 0.0 {
                        media.position = position;
                        media.start_time = 0.0;
                        media.end_time = total;
                        media.min_seek_time = 0.0;
                        media.max_seek_time = total;
                        media.provider_detail = format!("{}+ax", media.provider_detail);
                    }
                }
            }
        }
        if !options.thumbnail {
            media.thumbnail = None;
            media.thumbnail_type = None;
        }

        // Vendor-first: map the macOS app id to the catalog and let the vendor
        // combine the Now Playing/AppleScript session with CDP when applicable.
        let profile = catalog::profile_for_id(&media.app_id)
            .or_else(|| catalog::profile_for_process(&media.app_id))
            .or_else(|| match media.app_id.to_ascii_lowercase().as_str() {
                "music" => catalog::profile_for_app(catalog::App::AppleMusic),
                _ => None,
            });
        if let Some(profile) = profile {
            if profile.app != catalog::App::Browser {
                if let Some(resolved) = crate::media::vendor::resolve(
                    crate::media::vendor::Platform::MacOS,
                    profile.app,
                    Some(media.clone()),
                    None,
                    || None,
                ) {
                    *media = resolved;
                }
            }
        }
    }
    Ok(media)
}

fn accessibility_process(app_id: &str) -> Option<&'static str> {
    match app_id.to_lowercase().as_str() {
        "cider" => Some("Cider"),
        "music" | "applemusic" | "com.apple.music" => Some("Music"),
        "spotify" => Some("Spotify"),
        _ => None,
    }
}

pub fn control(action: &str, position: f64, options: &ReadOptions) -> Result<(), String> {
    // A CDP-only NetEase session has no Now Playing entry; route its transport
    // through the page before trying the AppleScript fallback.
    let check = ReadOptions {
        thumbnail: false,
        ..options.clone()
    };
    if let Ok(Some(current)) = read(&check) {
        if current.provider_detail.contains("cdp") {
            return crate::media::vendor::netease::cdp_control(action, position);
        }
    }
    if let Some(path) = nowplaying_cli() {
        let args: Vec<String> = match action {
            "playpause" => vec!["togglePlayPause".to_string()],
            "next" => vec!["next".to_string()],
            "previous" => vec!["previous".to_string()],
            "seek" => vec!["seek".to_string(), position.max(0.0).to_string()],
            other => return Err(format!("unsupported media action: {other}")),
        };
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        util::run_path_command(&path, &refs)?;
        return Ok(());
    }

    let command = match action {
        "playpause" => "playpause",
        "next" => "next track",
        "previous" => "previous track",
        "seek" => {
            let seconds = position.max(0.0);
            let script = format!(
                "if application \"Music\" is running then tell application \"Music\" to set player position to {seconds}\nif application \"Spotify\" is running then tell application \"Spotify\" to set player position to {seconds}"
            );
            applescript(&script)?;
            return Ok(());
        }
        other => return Err(format!("unsupported media action: {other}")),
    };
    let script = format!(
        "if application \"Music\" is running then tell application \"Music\" to {command}\nif application \"Spotify\" is running then tell application \"Spotify\" to {command}"
    );
    applescript(&script)?;
    Ok(())
}

pub fn like(liked: Option<bool>, _options: &ReadOptions) -> Result<(), String> {
    crate::media::vendor::netease::cdp_set_liked(liked).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nowplaying_output() {
        let values = parse_key_values("title = Song\nartist = Artist\nduration = 120.5\n");
        assert_eq!(values.get("title").map(String::as_str), Some("Song"));
        assert_eq!(values.get("artist").map(String::as_str), Some("Artist"));
        assert_eq!(values.get("duration").map(String::as_str), Some("120.5"));
    }
}
