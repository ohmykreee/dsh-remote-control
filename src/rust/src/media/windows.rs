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

use super::catalog::{self, Profile, Tier};
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
    catalog::system_complete(profile, media)
}

/// System-branch validity exposed to vendor modules.
pub(crate) fn system_valid(media: &Media) -> bool {
    let profile = catalog::profile_for_id(&media.app_id)
        .or_else(|| catalog::profile_for_process(&media.app_id));
    is_complete(profile, media)
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

    let mut system_candidates: Vec<Candidate> = Vec::new();
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
                        let complete = catalog::system_complete(profile, &media);
                        media.can_seek = catalog::seek_allowed(Tier::System, complete, false);
                        if !complete {
                            // An incomplete system session may still give us the
                            // metadata/controls, but never the seek grant.
                            media.provider_detail = "smtc-partial".to_string();
                        }
                        system_candidates.push(Candidate {
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
                Err(_) => {}
            }
        }
        Err(_) => {}
    }

    // Mark the session Windows currently reports as the system-wide current
    // one; it breaks ties after the "is playing" check.
    for candidate in system_candidates.iter_mut() {
        candidate.current = !current_app_id.is_empty()
            && candidate.raw_app_id.eq_ignore_ascii_case(&current_app_id);
    }

    // NetEase sometimes exposes a generated AUMID (for example
    // `Microsoft.AutoGenerated.{GUID}`) instead of `cloudmusic.exe`. Match that
    // unknown SMTC session against the current CDP page so it still enters the
    // NetEase vendor path and gets the heart/progress combination.
    if system_candidates
        .iter()
        .any(|candidate| candidate.profile.is_none())
    {
        if let Some((title, artist)) = crate::media::vendor::netease::cdp_identity() {
            for candidate in system_candidates
                .iter_mut()
                .filter(|candidate| candidate.profile.is_none())
            {
                let same_title = !title.is_empty()
                    && candidate
                        .media
                        .title
                        .trim()
                        .eq_ignore_ascii_case(title.trim());
                let same_artist = artist.is_empty()
                    || candidate.media.artist.trim().is_empty()
                    || candidate
                        .media
                        .artist
                        .trim()
                        .eq_ignore_ascii_case(artist.trim());
                if !same_title || !same_artist {
                    continue;
                }
                let Some(profile) = catalog::profile_for_app(catalog::App::Netease) else {
                    continue;
                };
                candidate.profile = Some(profile);
                candidate.complete = catalog::system_complete(Some(profile), &candidate.media);
                candidate.media.can_seek =
                    catalog::seek_allowed(Tier::System, candidate.complete, false);
                if !candidate.complete {
                    candidate.media.provider_detail = "smtc-partial".to_string();
                }
            }
        }
    }

    // Build the private (window-title / Cider file) candidate for every known
    // vendor. The vendor dispatcher decides whether it or the system session is
    // used; generic callers never see this detail.
    let mut private_candidates: Vec<Candidate> = Vec::new();
    for (index, profile) in catalog::PROFILES.iter().enumerate() {
        if matches!(profile.private, catalog::PrivateKind::None) {
            continue;
        }
        let smtc_media =
            best_for_app(&system_candidates, profile.app).map(|candidate| &candidate.media);
        if let Some(media) = private::read(profile, &windows, &activities, smtc_media, options) {
            private_candidates.push(Candidate {
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

    let mut candidates: Vec<Candidate> = Vec::new();

    // Applications without a vendor profile only have the system API. Browsers
    // have no private interface either, so keep every browser session.
    for candidate in system_candidates.iter() {
        let is_browser = candidate
            .profile
            .map(|profile| profile.app == catalog::App::Browser)
            .unwrap_or(false);
        if candidate.profile.is_none() || is_browser {
            candidates.push(candidate.clone());
        }
    }

    // Vendor-first dispatch for every known application.
    for (index, profile) in catalog::PROFILES.iter().enumerate() {
        if profile.app == catalog::App::Browser {
            continue;
        }
        let system = best_for_app(&system_candidates, profile.app);
        let private = best_for_app(&private_candidates, profile.app);
        if system.is_none() && private.is_none() && profile.app != catalog::App::Netease {
            continue;
        }
        let system_media = system.map(|candidate| candidate.media.clone());
        let private_media = private.map(|candidate| candidate.media.clone());
        let windows_ref = &windows;
        let resolved = crate::media::vendor::resolve(
            crate::media::vendor::Platform::Windows,
            profile.app,
            system_media,
            private_media,
            || private::progress_for_profile(profile, windows_ref),
        );
        let Some(mut media) = resolved else {
            continue;
        };
        let complete = catalog::system_complete(Some(profile), &media);
        if media.provider_detail.contains("cdp") {
            // CDP-only mode: the page slider is a transport, but it must not
            // report a seekable timeline. Keep a seek grant only when the SMTC
            // session itself is complete and explicitly seekable.
            media.can_seek = complete && media.can_seek && media.end_time > media.start_time;
        } else {
            media.can_seek = catalog::seek_allowed(Tier::System, complete, false);
        }
        let tier = if media.provider == "private" || media.provider == "accessibility" {
            Tier::Private
        } else {
            Tier::System
        };
        candidates.push(Candidate {
            raw_app_id: media.app_id.clone(),
            media,
            profile: Some(profile),
            tier,
            complete,
            order: system
                .map(|candidate| candidate.order)
                .unwrap_or(10_000 + index),
            current: system.map(|candidate| candidate.current).unwrap_or(false),
        });
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
        // No system API, no vendor interface, no accessibility tree: this is
        // an empty reading, not an error. The Node bridge clears the media card.
        return Ok(None);
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

fn best_for_app<'a>(candidates: &'a [Candidate], app: catalog::App) -> Option<&'a Candidate> {
    candidates
        .iter()
        .filter(|candidate| candidate.profile.map(|profile| profile.app) == Some(app))
        .min_by_key(|candidate| rank(candidate))
}

pub fn control(action: &str, position: f64, options: &ReadOptions) -> Result<(), String> {
    let preferred = options.app_id.as_deref().or(options.player.as_deref());
    let session = match select(preferred) {
        Ok(session) => session,
        Err(_) => None,
    };
    let Some(session) = session else {
        // No SMTC session: CDP-only NetEase still has its page transport.
        let netease = preferred
            .map(|value| {
                catalog::profile_for_id(value)
                    .or_else(|| catalog::profile_for_process(value))
                    .map(|profile| profile.app == catalog::App::Netease)
                    .unwrap_or_else(|| value.to_ascii_lowercase().contains("cloudmusic"))
            })
            .unwrap_or(true);
        if netease && crate::media::vendor::netease::cdp_control(action, position).is_ok() {
            return Ok(());
        }
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

pub fn like(liked: Option<bool>, _options: &ReadOptions) -> Result<(), String> {
    crate::media::vendor::netease::cdp_set_liked(liked).map(|_| ())
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
