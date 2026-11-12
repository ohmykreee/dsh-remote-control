//! Windows media probe: WinRT `GlobalSystemMediaTransportControlsSessionManager`.
//!
//! This replaces the former PowerShell SMTC probe and its C# thumbnail helper,
//! which have both been removed. The Rust probe is the only media path.

use std::time::Duration;

use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession, GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionMediaProperties,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Media::MediaPlaybackAutoRepeatMode;
use windows::Storage::Streams::{DataReader, IRandomAccessStreamReference};

use super::{Media, ReadOptions};
use crate::util;

pub const BACKEND: &str = "rust-smtc";

const MAX_THUMBNAIL_BYTES: u64 = 8 * 1024 * 1024;

fn failure(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn ensure_com() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| unsafe {
        // S_FALSE / RPC_E_CHANGED_MODE are harmless: another library already
        // initialized this apartment.
        let _ = windows::Win32::System::Com::CoInitializeEx(
            None,
            windows::Win32::System::Com::COINIT_MULTITHREADED,
        );
    });
}

fn manager() -> Result<GlobalSystemMediaTransportControlsSessionManager, String> {
    ensure_com();
    GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(failure)?
        .join()
        .map_err(failure)
}

fn status_of(
    session: &GlobalSystemMediaTransportControlsSession,
) -> Option<GlobalSystemMediaTransportControlsSessionPlaybackStatus> {
    session
        .GetPlaybackInfo()
        .ok()
        .and_then(|info| info.PlaybackStatus().ok())
}

fn is_playing(session: &GlobalSystemMediaTransportControlsSession) -> bool {
    status_of(session) == Some(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
}

fn app_id_of(session: &GlobalSystemMediaTransportControlsSession) -> String {
    session
        .SourceAppUserModelId()
        .map(|value| value.to_string())
        .unwrap_or_default()
}

/// Pick a session exactly like the PowerShell probe: explicit app id, then the
/// current session, then the first playing session, then the first session.
fn select(
    app_id: Option<&str>,
) -> Result<Option<GlobalSystemMediaTransportControlsSession>, String> {
    let manager = manager()?;
    let sessions: Vec<GlobalSystemMediaTransportControlsSession> = manager
        .GetSessions()
        .map_err(failure)?
        .into_iter()
        .collect();
    if sessions.is_empty() {
        return Ok(None);
    }

    if let Some(app_id) = app_id.filter(|value| !value.is_empty()) {
        if let Some(session) = sessions
            .iter()
            .find(|session| app_id_of(session).eq_ignore_ascii_case(app_id))
        {
            return Ok(Some(session.clone()));
        }
    }

    let mut session = manager.GetCurrentSession().ok();
    if session
        .as_ref()
        .map(|value| !is_playing(value))
        .unwrap_or(false)
    {
        if let Some(playing) = sessions.iter().find(|value| is_playing(value)) {
            session = Some(playing.clone());
        }
    }
    if session.is_none() {
        session = sessions.iter().find(|value| is_playing(value)).cloned();
    }
    if session.is_none() {
        session = sessions.first().cloned();
    }
    Ok(session)
}

fn status_name(status: GlobalSystemMediaTransportControlsSessionPlaybackStatus) -> &'static str {
    use GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status;
    if status == Status::Playing {
        "Playing"
    } else if status == Status::Paused {
        "Paused"
    } else if status == Status::Stopped {
        "Stopped"
    } else {
        "Closed"
    }
}

fn read_thumbnail_stream(reference: &IRandomAccessStreamReference) -> Result<String, String> {
    let stream = reference
        .OpenReadAsync()
        .map_err(failure)?
        .join()
        .map_err(failure)?;
    let size = stream.Size().map_err(failure)?;
    if size == 0 {
        return Err("thumbnail stream is empty".to_string());
    }
    if size > MAX_THUMBNAIL_BYTES {
        return Err(format!("thumbnail stream is too large ({size} bytes)"));
    }
    let reader = DataReader::CreateDataReader(&stream).map_err(failure)?;
    reader
        .LoadAsync(size as u32)
        .map_err(failure)?
        .join()
        .map_err(failure)?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).map_err(failure)?;
    util::image_data_url(&bytes).ok_or_else(|| "thumbnail is not a supported image".to_string())
}

/// Read the artwork, retrying briefly because Edge/YouTube populates the
/// thumbnail reference shortly after metadata becomes available.
fn read_thumbnail(
    session: &GlobalSystemMediaTransportControlsSession,
    first: &GlobalSystemMediaTransportControlsSessionMediaProperties,
    wanted: bool,
) -> (Option<String>, Option<String>, Option<String>) {
    if !wanted {
        return (None, None, None);
    }
    let mut last_error = String::new();
    let mut props = first.clone();
    let mut saw_reference = false;
    for attempt in 0..4 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(140));
            match session
                .TryGetMediaPropertiesAsync()
                .map_err(failure)
                .and_then(|op| op.join().map_err(failure))
            {
                Ok(refreshed) => props = refreshed,
                Err(error) => {
                    last_error = error;
                    continue;
                }
            }
        }
        let reference = match props.Thumbnail() {
            Ok(reference) => reference,
            Err(_) => {
                // A null reference does not become available by waiting; the
                // PowerShell probe also stopped here instead of retrying.
                if !saw_reference {
                    return (None, None, Some("thumbnail reference is null".to_string()));
                }
                last_error = "thumbnail reference is null".to_string();
                break;
            }
        };
        saw_reference = true;
        match read_thumbnail_stream(&reference) {
            Ok(data) => return (Some(data), Some("data-url".to_string()), None),
            Err(error) => last_error = error,
        }
    }
    (
        None,
        None,
        Some(if last_error.is_empty() {
            "thumbnail unavailable".to_string()
        } else {
            last_error
        }),
    )
}

pub fn read(options: &ReadOptions) -> Result<Option<Media>, String> {
    let preferred = options.app_id.as_deref().or(options.player.as_deref());
    let Some(session) = select(preferred)? else {
        return Ok(None);
    };
    ensure_com();

    let props = session
        .TryGetMediaPropertiesAsync()
        .map_err(failure)?
        .join()
        .map_err(failure)?;
    let info = session.GetPlaybackInfo().map_err(failure)?;
    let timeline = session.GetTimelineProperties().map_err(failure)?;
    let controls = info.Controls().map_err(failure)?;

    let mut media = Media::new(app_id_of(&session));
    media.title = props
        .Title()
        .map(|value| value.to_string())
        .unwrap_or_default();
    media.artist = props
        .Artist()
        .map(|value| value.to_string())
        .unwrap_or_default();
    media.album = props
        .AlbumTitle()
        .map(|value| value.to_string())
        .unwrap_or_default();
    media.album_artist = props
        .AlbumArtist()
        .map(|value| value.to_string())
        .unwrap_or_default();
    media.track_number = props.TrackNumber().unwrap_or(0);
    media.playback_status = info
        .PlaybackStatus()
        .map(status_name)
        .unwrap_or("Closed")
        .to_string();
    media.auto_repeat_mode = match info
        .AutoRepeatMode()
        .ok()
        .and_then(|value| value.Value().ok())
    {
        Some(MediaPlaybackAutoRepeatMode::Track) => "Track",
        Some(MediaPlaybackAutoRepeatMode::List) => "List",
        _ => "None",
    }
    .to_string();
    media.shuffle_active = info
        .IsShuffleActive()
        .ok()
        .and_then(|value| value.Value().ok())
        .unwrap_or(false);
    media.position = timeline
        .Position()
        .map(|value| util::ticks_to_seconds(value.Duration))
        .unwrap_or(0.0);
    media.start_time = timeline
        .StartTime()
        .map(|value| util::ticks_to_seconds(value.Duration))
        .unwrap_or(0.0);
    media.end_time = timeline
        .EndTime()
        .map(|value| util::ticks_to_seconds(value.Duration))
        .unwrap_or(0.0);
    media.min_seek_time = timeline
        .MinSeekTime()
        .map(|value| util::ticks_to_seconds(value.Duration))
        .unwrap_or(0.0);
    media.max_seek_time = timeline
        .MaxSeekTime()
        .map(|value| util::ticks_to_seconds(value.Duration))
        .unwrap_or(0.0);
    media.last_updated_at = timeline
        .LastUpdatedTime()
        .map(|value| util::winrt_time_to_unix_ms(value.UniversalTime))
        .unwrap_or_else(|_| util::now_ms());
    media.can_play_pause = controls.IsPlayPauseToggleEnabled().unwrap_or(true);
    media.can_next = controls.IsNextEnabled().unwrap_or(true);
    media.can_previous = controls.IsPreviousEnabled().unwrap_or(true);
    media.can_seek = controls.IsPlaybackPositionEnabled().unwrap_or(false);

    let (thumbnail, thumbnail_type, thumbnail_error) =
        read_thumbnail(&session, &props, options.thumbnail);
    media.thumbnail = thumbnail;
    media.thumbnail_type = thumbnail_type;
    media.thumbnail_error = thumbnail_error;
    Ok(Some(media))
}

pub fn control(action: &str, position: f64, options: &ReadOptions) -> Result<(), String> {
    let preferred = options.app_id.as_deref().or(options.player.as_deref());
    let Some(session) = select(preferred)? else {
        return Err("no active SMTC session".to_string());
    };
    ensure_com();
    let accepted = match action {
        "playpause" => session
            .TryTogglePlayPauseAsync()
            .map_err(failure)?
            .join()
            .map_err(failure)?,
        "next" => session
            .TrySkipNextAsync()
            .map_err(failure)?
            .join()
            .map_err(failure)?,
        "previous" => session
            .TrySkipPreviousAsync()
            .map_err(failure)?
            .join()
            .map_err(failure)?,
        "seek" => {
            let ticks = (position.max(0.0) * 10_000_000.0).round() as i64;
            session
                .TryChangePlaybackPositionAsync(ticks)
                .map_err(failure)?
                .join()
                .map_err(failure)?
        }
        other => return Err(format!("unsupported media action: {other}")),
    };
    if !accepted {
        return Err(format!("SMTC rejected {action}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_status_names() {
        assert_eq!(
            status_name(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing),
            "Playing"
        );
        assert_eq!(
            status_name(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed),
            "Closed"
        );
    }
}
