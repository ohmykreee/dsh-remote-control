//! Windows media probe: SMTC first, then per-app private interfaces, then UI
//! Automation as a read-only last resort.
//!
//! Tier rules (from `catalog`):
//! * A *complete* SMTC session — metadata, a seekable timeline and a real
//!   position — is used directly; only that session may expose seek.
//! * When SMTC is missing/incomplete, the player's window title (and Cider's
//!   local title file) is used. This tier is read-only: it never exposes seek.
//! * UI Automation is consulted only for NetEase/WeSing progress, again
//!   read-only and behind a timeout.
//!
//! No network API is used. Cover art still comes from the SMTC thumbnail stream
//! or the local NetEase cache.

#[path = "windows/accessibility.rs"]
mod accessibility;
#[path = "windows/audio.rs"]
mod audio;
#[path = "windows/private.rs"]
mod private;

use std::time::Duration;

use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession, GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionMediaProperties,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Media::MediaPlaybackAutoRepeatMode;
use windows::Storage::Streams::{DataReader, IRandomAccessStreamReference};

use super::catalog::{self, Profile, SmtcPolicy, Tier};
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
        // A private app id ("cloudmusic.exe") may not equal the SMTC AUMID;
        // match it through the app catalog as a fallback.
        if let Some(profile) =
            catalog::profile_for_id(app_id).or_else(|| catalog::profile_for_process(app_id))
        {
            if let Some(session) = sessions.iter().find(|session| {
                let session_id = app_id_of(session);
                catalog::profile_for_id(&session_id)
                    .or_else(|| catalog::profile_for_process(&session_id))
                    .map(|candidate| candidate.app == profile.app)
                    .unwrap_or(false)
            }) {
                return Ok(Some(session.clone()));
            }
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

fn media_from_session(
    session: &GlobalSystemMediaTransportControlsSession,
    options: &ReadOptions,
) -> Result<Media, String> {
    let props = session
        .TryGetMediaPropertiesAsync()
        .map_err(failure)?
        .join()
        .map_err(failure)?;
    let info = session.GetPlaybackInfo().map_err(failure)?;
    let timeline = session.GetTimelineProperties().map_err(failure)?;
    let controls = info.Controls().ok();

    let mut media = Media::new(app_id_of(session));
    media.provider = Tier::System.as_str().to_string();
    media.provider_detail = "smtc".to_string();
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
    media.can_play_pause = controls
        .as_ref()
        .and_then(|controls| controls.IsPlayPauseToggleEnabled().ok())
        .unwrap_or(true);
    media.can_next = controls
        .as_ref()
        .and_then(|controls| controls.IsNextEnabled().ok())
        .unwrap_or(true);
    media.can_previous = controls
        .as_ref()
        .and_then(|controls| controls.IsPreviousEnabled().ok())
        .unwrap_or(true);
    media.can_seek = controls
        .as_ref()
        .and_then(|controls| controls.IsPlaybackPositionEnabled().ok())
        .unwrap_or(false);

    let (thumbnail, thumbnail_type, thumbnail_error) =
        read_thumbnail(session, &props, options.thumbnail);
    media.thumbnail = thumbnail;
    media.thumbnail_type = thumbnail_type;
    media.thumbnail_error = thumbnail_error;
    Ok(media)
}

/// A complete SMTC session is the only source allowed to expose seek.
fn is_complete(profile: Option<&Profile>, media: &Media) -> bool {
    if media.title.trim().is_empty() {
        return false;
    }
    if media.playback_status == "Closed" {
        return false;
    }
    if media.end_time <= media.start_time || media.end_time <= 0.0 {
        return false;
    }
    if !media.can_seek {
        return false;
    }
    match profile
        .map(|profile| profile.smtc_policy)
        .unwrap_or(SmtcPolicy::Trusted)
    {
        SmtcPolicy::Trusted => true,
        // Older builds (notably some QQ/KuGou releases) advertise a seekable
        // timeline but keep the position at zero. Require an actual position
        // report for those adapters.
        SmtcPolicy::VerifyPosition => media.position > 0.01,
        // NetEase exposes SMTC metadata/controls but not playback progress.
        // It must never be treated as a complete timeline (and never grants
        // seek); the accessibility/local tier supplies the displayed progress.
        SmtcPolicy::MetadataOnly => false,
    }
}

#[derive(Clone)]
struct Candidate {
    media: Media,
    raw_app_id: String,
    profile: Option<&'static Profile>,
    tier: Tier,
    complete: bool,
    order: usize,
    current: bool,
}

fn rank(candidate: &Candidate) -> (u8, u8, u8, u8, usize) {
    let playing = if candidate.media.playback_status == "Playing" {
        0
    } else {
        1
    };
    let current = if candidate.current { 0 } else { 1 };
    let complete = if candidate.complete { 0 } else { 1 };
    let tier = match candidate.tier {
        Tier::System => 0,
        Tier::Private => 1,
        Tier::Accessibility => 2,
    };
    (playing, current, complete, tier, candidate.order)
}

fn matches_preferred(candidate: &Candidate, preferred: &str) -> bool {
    let wanted = preferred.trim().to_lowercase();
    if wanted.is_empty() {
        return false;
    }
    if candidate.media.app_id.to_lowercase().contains(&wanted)
        || candidate.raw_app_id.to_lowercase().contains(&wanted)
    {
        return true;
    }
    candidate
        .profile
        .map(|profile| {
            profile.name.to_lowercase() == wanted
                || profile.app_id.to_lowercase().contains(&wanted)
                || profile
                    .process_names
                    .iter()
                    .any(|name| name.contains(&wanted))
        })
        .unwrap_or(false)
}

pub fn read(options: &ReadOptions) -> Result<Option<Media>, String> {
    ensure_com();
    let windows = private::enumerate_windows();
    let activities = audio::snapshot();

    let mut candidates: Vec<Candidate> = Vec::new();
    let mut smtc_error: Option<String> = None;
    let mut current_app_id = String::new();

    match manager() {
        Ok(manager) => {
            current_app_id = manager
                .GetCurrentSession()
                .ok()
                .map(|session| app_id_of(&session))
                .unwrap_or_default();
            match manager.GetSessions() {
                Ok(sessions) => {
                    for (order, session) in sessions.into_iter().enumerate() {
                        let app_id = app_id_of(&session);
                        let profile = catalog::profile_for_id(&app_id)
                            .or_else(|| catalog::profile_for_process(&app_id));
                        let Ok(mut media) = media_from_session(&session, options) else {
                            continue;
                        };
                        if media.playback_status == "Closed"
                            || (media.title.trim().is_empty() && media.artist.trim().is_empty())
                        {
                            continue;
                        }
                        let complete = is_complete(profile, &media);
                        media.can_seek = catalog::seek_allowed(Tier::System, complete, false);
                        if !complete {
                            // An incomplete system session may still give us the
                            // metadata/controls, but never the seek grant.
                            media.provider_detail = "smtc-partial".to_string();
                        }
                        candidates.push(Candidate {
                            raw_app_id: app_id,
                            media,
                            profile,
                            tier: Tier::System,
                            complete,
                            order,
                            current: false,
                        });
                    }
                }
                Err(error) => smtc_error = Some(failure(error)),
            }
        }
        Err(error) => smtc_error = Some(error),
    }

    // Mark the session Windows currently reports as the system-wide current
    // one; it breaks ties after the "is playing" check.
    for candidate in candidates.iter_mut() {
        candidate.current = !current_app_id.is_empty()
            && candidate.raw_app_id.eq_ignore_ascii_case(&current_app_id);
    }

    // NetEase exposes SMTC metadata/status but not playback progress. Keep the
    // SMTC metadata and attach read-only progress from UI Automation (the local
    // NetEase database later supplies duration/cover/liked in `finish`).
    for candidate in candidates.iter_mut() {
        if candidate.complete || candidate.media.title.trim().is_empty() {
            continue;
        }
        let Some(profile) = candidate.profile else {
            continue;
        };
        if profile.smtc_policy == SmtcPolicy::MetadataOnly {
            let attached = private::attach_progress(profile, &windows, &mut candidate.media);
            if !attached {
                // NetEase's SMTC LastUpdatedTime is not a reliable playback
                // anchor. Without a UIA position, keep the progress bar at the
                // reported position (usually 0) instead of projecting a
                // synthetic timeline forward.
                candidate.media.last_updated_at = util::now_ms();
            }
        }
    }

    // Private tier: only when the app has no complete system session.
    for (index, profile) in catalog::PROFILES.iter().enumerate() {
        let has_complete = candidates.iter().any(|candidate| {
            candidate.complete && candidate.profile.map(|value| value.app) == Some(profile.app)
        });
        if has_complete {
            continue;
        }
        // Metadata-only clients keep the system metadata (SMTC title/artist is
        // richer than the window title); the title fallback is only used when
        // the system session has no usable title at all.
        let keep_metadata = profile.smtc_policy == SmtcPolicy::MetadataOnly
            && candidates.iter().any(|candidate| {
                candidate.profile.map(|value| value.app) == Some(profile.app)
                    && !candidate.media.title.trim().is_empty()
            });
        if keep_metadata {
            continue;
        }
        let smtc_media = candidates
            .iter()
            .find(|candidate| candidate.profile.map(|value| value.app) == Some(profile.app))
            .map(|candidate| &candidate.media);
        if let Some(media) = private::read(profile, &windows, &activities, smtc_media, options) {
            // A private result outranks a partial system session for the same app.
            candidates.retain(|candidate| {
                !(candidate.profile.map(|value| value.app) == Some(profile.app)
                    && !candidate.complete)
            });
            candidates.push(Candidate {
                raw_app_id: media.app_id.clone(),
                media,
                profile: Some(profile),
                tier: Tier::Private,
                complete: false,
                order: 10_000 + index,
                current: false,
            });
        }
    }

    // The reference project uses the audio meter to repair a stale status for
    // clients that do not refresh SMTC unless the media flyout is open.
    for candidate in candidates.iter_mut() {
        if candidate.complete || candidate.tier != Tier::System {
            continue;
        }
        let Some(profile) = candidate.profile else {
            continue;
        };
        if let Some(activity) = private::profile_activity(profile, &windows, &activities) {
            candidate.media.playback_status = if activity.is_playing() {
                "Playing".to_string()
            } else {
                "Paused".to_string()
            };
        }
    }

    if candidates.is_empty() {
        return match smtc_error {
            Some(error) => Err(error),
            None => Ok(None),
        };
    }

    let preferred = options
        .app_id
        .as_deref()
        .or(options.player.as_deref())
        .filter(|value| !value.is_empty());
    let selected = if let Some(preferred) = preferred {
        candidates
            .iter()
            .filter(|candidate| matches_preferred(candidate, preferred))
            .min_by_key(|candidate| rank(candidate))
            .cloned()
    } else {
        candidates
            .iter()
            .min_by_key(|candidate| rank(candidate))
            .cloned()
    };
    Ok(selected.map(|candidate| candidate.media))
}

pub fn control(action: &str, position: f64, options: &ReadOptions) -> Result<(), String> {
    let preferred = options.app_id.as_deref().or(options.player.as_deref());
    let Some(session) = select(preferred)? else {
        return Err(
            "no active SMTC session; this player is read-only in the private tier".to_string(),
        );
    };
    ensure_com();

    if action == "seek" {
        let profile = catalog::profile_for_id(&app_id_of(&session))
            .or_else(|| catalog::profile_for_process(&app_id_of(&session)));
        let check_options = ReadOptions {
            thumbnail: false,
            ..options.clone()
        };
        let media = media_from_session(&session, &check_options)?;
        if !is_complete(profile, &media) {
            return Err(
                "this player only reports progress; seek requires a complete SMTC timeline"
                    .to_string(),
            );
        }
    }

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

    fn playable(app_id: &str) -> Media {
        let mut media = Media::new(app_id);
        media.title = "Song".to_string();
        media.playback_status = "Playing".to_string();
        media.start_time = 0.0;
        media.end_time = 200.0;
        media.position = 12.0;
        media.can_seek = true;
        media
    }

    #[test]
    fn complete_requires_a_timeline_and_seek_grant() {
        let trusted = playable("MSEdge");
        assert!(is_complete(None, &trusted));

        let mut no_timeline = playable("MSEdge");
        no_timeline.end_time = 0.0;
        assert!(!is_complete(None, &no_timeline));

        let mut no_seek = playable("MSEdge");
        no_seek.can_seek = false;
        assert!(!is_complete(None, &no_seek));
    }

    #[test]
    fn netease_smtc_is_metadata_only() {
        let profile = catalog::profile_for_id("cloudmusic.exe");
        let mut media = playable("cloudmusic.exe");
        // Even a claimed timeline/position must not turn NetEase's SMTC into a
        // seekable session; progress comes from UIA/local data.
        assert!(!is_complete(profile, &media));
        media.position = 42.0;
        assert!(!is_complete(profile, &media));
    }

    #[test]
    fn trusted_players_accept_spotify_like_seek() {
        let profile = catalog::profile_for_id("Spotify.exe");
        let mut media = playable("Spotify.exe");
        media.position = 0.0;
        assert!(is_complete(profile, &media));
    }
}
