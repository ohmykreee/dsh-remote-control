//! macOS media probe.
//!
//! MediaRemote's private framework is not linkable without entitlements, so the
//! sidecar resolves it at runtime (see `mediaremote.rs`). No helper tool needs
//! to be installed for the common case. AppleScript against Music/Spotify is a
//! fallback for systems where the private controller class is unavailable, and
//! Cider's private title file covers that client.

use std::time::Duration;

use super::catalog::{self, Tier};
use super::{Media, ReadOptions};
use crate::util;

#[path = "macos/accessibility.rs"]
mod accessibility;
#[path = "macos/mediaremote.rs"]
mod mediaremote;

pub const BACKEND: &str = "macos-media";

const APPLESCRIPT_TIMEOUT: Duration = Duration::from_millis(3000);

/// Best-effort client identity for MediaRemote, which does not always expose
/// the bundle id. This keeps the vendor-first dispatch working on macOS.
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

fn applescript(script: &str) -> Result<String, String> {
    util::command_output_timeout("/usr/bin/osascript", &["-e", script], APPLESCRIPT_TIMEOUT)
}

fn app_running(name: &str) -> bool {
    util::command_output("/usr/bin/pgrep", &["-x", name]).is_ok()
}

/// Only query applications that `pgrep` already sees. `System Events` is
/// deliberately avoided: its first automation request opens a TCC prompt and
/// blocks until the user answers, which would stall the probe every poll.
const MUSIC_SCRIPT: &str = r#"
if out is "" then
    tell application "Music"
        try
            set st to player state as string
            if st is not "stopped" then
                set out to "Music" & tab & st & tab & (name of current track) & tab & (artist of current track) & tab & (album of current track) & tab & (duration of current track) & tab & (player position)
            end if
        end try
    end tell
end if
"#;

const SPOTIFY_SCRIPT: &str = r#"
if out is "" then
    tell application "Spotify"
        try
            set st to player state as string
            if st is not "stopped" then
                set out to "Spotify" & tab & st & tab & (name of current track) & tab & (artist of current track) & tab & (album of current track) & tab & ((duration of current track) / 1000) & tab & (player position)
            end if
        end try
    end tell
end if
"#;

/// AppleScript fallback for macOS versions without the private
/// `MRNowPlayingController` class (or without MediaRemote access).
fn read_applescript() -> Result<Option<Media>, String> {
    let music = app_running("Music");
    let spotify = app_running("Spotify");
    if !music && !spotify {
        return Ok(None);
    }
    let mut script = String::from("set out to \"\"\n");
    if music {
        script.push_str(MUSIC_SCRIPT);
    }
    if spotify {
        script.push_str(SPOTIFY_SCRIPT);
    }
    script.push_str("return out\n");

    let output = applescript(&script)?;
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

fn media_from_mediaremote(reading: mediaremote::Reading) -> Media {
    let mut media = Media::new(reading.app_id);
    media.provider_detail = "mediaremote".to_string();
    media.title = if reading.title.trim().is_empty() {
        "未命名媒体".to_string()
    } else {
        reading.title
    };
    media.artist = reading.artist;
    media.album = reading.album;
    media.playback_status = match reading.playback_state {
        1 => "Playing",
        2 => "Paused",
        3 => "Stopped",
        _ if reading.playback_rate > 0.0 => "Playing",
        _ if reading.duration > 0.0 => "Paused",
        _ => "Stopped",
    }
    .to_string();
    media.position = reading.position.max(0.0);
    media.start_time = 0.0;
    media.end_time = reading.duration.max(0.0);
    media.min_seek_time = 0.0;
    media.max_seek_time = reading.duration.max(0.0);
    media.last_updated_at = util::now_ms();
    media.can_play_pause = true;
    media.can_next = true;
    media.can_previous = true;
    media.can_seek = catalog::seek_allowed(Tier::System, reading.duration > 0.0, false);
    media
}

pub fn read(options: &ReadOptions) -> Result<Option<Media>, String> {
    let preferred = options
        .app_id
        .as_deref()
        .or(options.player.as_deref())
        .filter(|value| !value.is_empty());
    let has_mediaremote = mediaremote::available();
    let mut media = if has_mediaremote {
        // The private controller is the primary source and needs no external
        // helper.
        mediaremote::read().map(media_from_mediaremote)
    } else {
        None
    };
    if media.is_none() && !has_mediaremote {
        // AppleScript is only the fallback for older macOS: on current macOS
        // the first automation request can block on a TCC prompt, and there is
        // no reason to pay that cost when MediaRemote already answered.
        media = read_applescript().unwrap_or(None);
    }
    if media.is_none() {
        media = read_cider();
    }
    if media.is_none() {
        // No MediaRemote/AppleScript/Cider source: use the vendor fallback only
        // when the caller did not ask for a specific player.
        return Ok(if preferred.is_some() {
            None
        } else {
            crate::media::vendor::fallback_media()
        });
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
        // combine the MediaRemote/AppleScript session with CDP when applicable.
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
    // macOS has one system media session; an explicit target must match
    // it (a vendor page fallback is still matched by its app id).
    if let Some(preferred) = preferred {
        if !media
            .as_ref()
            .map(|media| catalog::media_matches_preferred(media, preferred))
            .unwrap_or(false)
        {
            return Ok(None);
        }
    }
    Ok(media)
}

pub fn read_all(options: &ReadOptions) -> Result<Vec<Media>, String> {
    Ok(read(options)?.into_iter().collect())
}

fn accessibility_process(app_id: &str) -> Option<&'static str> {
    let id = app_id.to_lowercase();
    if id.contains("cider") {
        Some("Cider")
    } else if id.contains("music") {
        Some("Music")
    } else if id.contains("spotify") {
        Some("Spotify")
    } else {
        None
    }
}

pub fn control(action: &str, position: f64, options: &ReadOptions) -> Result<(), String> {
    let preferred = options
        .app_id
        .as_deref()
        .or(options.player.as_deref())
        .filter(|value| !value.is_empty());
    let check = ReadOptions {
        thumbnail: false,
        ..options.clone()
    };
    let current = read(&check).ok().flatten();
    let target_app = preferred
        .and_then(|value| {
            catalog::profile_for_id(value).or_else(|| catalog::profile_for_process(value))
        })
        .or_else(|| current.as_ref().and_then(catalog::profile_for_media))
        .map(|profile| profile.app);
    if let Some(preferred) = preferred {
        let matches = current
            .as_ref()
            .map(|media| catalog::media_matches_preferred(media, preferred))
            .unwrap_or(false);
        if !crate::media::vendor::handles_without_system_session(target_app) && !matches {
            return Err("the requested player is not the current macOS media session".to_string());
        }
    }
    // The system closure may only act on the current system session. A vendor
    // page that is not backed by a system session (for example CDP-only) must
    // never fall back to controlling whatever macOS currently reports.
    let system_target_matches = match (preferred, current.as_ref()) {
        (None, Some(media)) => media.provider == "system",
        (Some(_), Some(media)) => {
            media.provider == "system"
                && catalog::profile_for_media(media).map(|profile| profile.app) == target_app
        }
        _ => false,
    };
    // Seeking is only valid for a complete system timeline, exactly like the
    // Windows/Linux closures.
    let seek_allowed = current.as_ref().map(catalog::system_valid).unwrap_or(false);
    crate::media::vendor::control(
        crate::media::vendor::Platform::MacOS,
        target_app,
        action,
        position,
        current.as_ref(),
        || {
            if preferred.is_some() && !system_target_matches {
                return Err("no matching macOS system session for the requested player".to_string());
            }
            if action == "seek" && !seek_allowed {
                return Err(
                    "this player only reports progress; seek requires a complete system timeline"
                        .to_string(),
                );
            }
            system_control(action, position)
        },
    )
}

fn system_control(action: &str, position: f64) -> Result<(), String> {
    if mediaremote::available() {
        return mediaremote::control(action, position);
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

pub fn like(liked: Option<bool>, options: &ReadOptions) -> Result<(), String> {
    let check = ReadOptions {
        thumbnail: false,
        ..options.clone()
    };
    let current = read(&check).ok().flatten();
    let target_app = options
        .app_id
        .as_deref()
        .or(options.player.as_deref())
        .and_then(|value| {
            catalog::profile_for_id(value).or_else(|| catalog::profile_for_process(value))
        })
        .or_else(|| current.as_ref().and_then(catalog::profile_for_media))
        .map(|profile| profile.app);
    crate::media::vendor::like(target_app, liked)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_target_must_match_the_current_media() {
        let media = Media::new("Music");
        assert!(catalog::media_matches_preferred(&media, "Music"));
        assert!(!catalog::media_matches_preferred(&media, "Spotify"));
    }
}
