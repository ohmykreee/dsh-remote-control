//! Linux media probe: MPRIS 2 over the session D-Bus (zbus), no `playerctl`.

use std::collections::HashMap;

use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::{ObjectPath, OwnedObjectPath, OwnedValue};

use super::catalog::{self, Tier};
use super::{Media, ReadOptions};
use crate::util;

pub const BACKEND: &str = "linux-mpris";

const MPRIS_PREFIX: &str = "org.mpris.MediaPlayer2.";
const MPRIS_PATH: &str = "/org/mpris/MediaPlayer2";
const PLAYER_INTERFACE: &str = "org.mpris.MediaPlayer2.Player";

fn failure(error: impl std::fmt::Display) -> String {
    format!("MPRIS: {error}")
}

fn connection() -> Result<Connection, String> {
    Connection::session().map_err(|error| format!("D-Bus session unavailable: {error}"))
}

fn player_names(connection: &Connection) -> Result<Vec<String>, String> {
    let reply = connection
        .call_method(
            Some("org.freedesktop.DBus"),
            "/org/freedesktop/DBus",
            Some("org.freedesktop.DBus"),
            "ListNames",
            &(),
        )
        .map_err(failure)?;
    let names: Vec<String> = reply.body().deserialize().map_err(failure)?;
    Ok(names
        .into_iter()
        .filter(|name| name.starts_with(MPRIS_PREFIX))
        .collect())
}

fn player_proxy<'a>(connection: &'a Connection, name: &'a str) -> Result<Proxy<'a>, String> {
    Proxy::new(connection, name, MPRIS_PATH, PLAYER_INTERFACE).map_err(failure)
}

/// A cheap projection of one MPRIS player used for selection.
struct PlayerSummary {
    status: String,
    has_identity: bool,
    duration: f64,
}

fn player_summary(connection: &Connection, name: &str) -> Option<PlayerSummary> {
    let proxy = player_proxy(connection, name).ok()?;
    let status = proxy
        .get_property::<String>("PlaybackStatus")
        .unwrap_or_else(|_| "Stopped".to_string());
    let metadata = metadata_of(&proxy);
    let title = string_value(&metadata, "xesam:title");
    let artists = string_array(&metadata, "xesam:artist");
    let has_identity =
        !title.trim().is_empty() || artists.iter().any(|artist| !artist.trim().is_empty());
    let duration = number_value(&metadata, "mpris:length")
        .unwrap_or(0.0)
        .max(0.0)
        / 1_000_000.0;
    Some(PlayerSummary {
        status,
        has_identity,
        duration,
    })
}

/// Reuse the previously selected player while it is alive, otherwise prefer a
/// playing player, then any player that actually has a track (or at least a
/// duration). Empty browser MPRIS placeholders are skipped so they cannot
/// shadow a real player or turn into an empty media card.
fn choose_player(
    connection: &Connection,
    names: &[String],
    options: &ReadOptions,
) -> Option<String> {
    let preferred = options
        .app_id
        .as_deref()
        .or(options.player.as_deref())
        .filter(|value| !value.is_empty());
    if let Some(preferred) = preferred {
        if let Some(exact) = names.iter().find(|name| name.as_str() == preferred) {
            return Some(exact.clone());
        }
        if let Some(partial) = names
            .iter()
            .find(|name| name.ends_with(preferred) || name.contains(preferred))
        {
            return Some(partial.clone());
        }
        if let Some(profile) =
            catalog::profile_for_id(preferred).or_else(|| catalog::profile_for_process(preferred))
        {
            if let Some(name) = names.iter().find(|name| {
                catalog::profile_for_id(name)
                    .or_else(|| catalog::profile_for_process(name))
                    .map(|candidate| candidate.app == profile.app)
                    .unwrap_or(false)
            }) {
                return Some(name.clone());
            }
        }
        // The caller asked for one player. Do not silently select another one
        // just because it is playing or has a longer timeline.
        return None;
    }

    let mut playing_without_identity = None;
    let mut fallback = None;
    for name in names {
        let Some(summary) = player_summary(connection, name) else {
            continue;
        };
        let playing = summary.status == "Playing";
        let usable = summary.has_identity || summary.duration > 0.0;
        if playing && usable {
            return Some(name.clone());
        }
        if playing && playing_without_identity.is_none() {
            playing_without_identity = Some(name.clone());
        }
        if usable && fallback.is_none() {
            fallback = Some(name.clone());
        }
    }
    playing_without_identity.or(fallback)
}

fn player_matches_preferred(name: &str, preferred: &str) -> bool {
    let wanted = preferred.trim().to_lowercase();
    if wanted.is_empty() {
        return false;
    }
    let lower = name.to_lowercase();
    if lower == wanted || lower.ends_with(&wanted) || lower.contains(&wanted) {
        return true;
    }
    let candidate = catalog::profile_for_id(name).or_else(|| catalog::profile_for_process(name));
    let requested =
        catalog::profile_for_id(preferred).or_else(|| catalog::profile_for_process(preferred));
    matches!((candidate, requested), (Some(left), Some(right)) if left.app == right.app)
}

fn metadata_of(proxy: &Proxy<'_>) -> HashMap<String, OwnedValue> {
    proxy
        .get_property::<HashMap<String, OwnedValue>>("Metadata")
        .unwrap_or_default()
}

fn string_value(metadata: &HashMap<String, OwnedValue>, key: &str) -> String {
    metadata
        .get(key)
        .and_then(|value| value.try_clone().ok())
        .and_then(|value| String::try_from(value).ok())
        .unwrap_or_default()
}

fn string_array(metadata: &HashMap<String, OwnedValue>, key: &str) -> Vec<String> {
    metadata
        .get(key)
        .and_then(|value| value.try_clone().ok())
        .and_then(|value| Vec::<String>::try_from(value).ok())
        .unwrap_or_default()
}

fn number_value(metadata: &HashMap<String, OwnedValue>, key: &str) -> Option<f64> {
    // MPRIS says mpris:length is int64, but some players (Haruna/Qt) send a
    // double. Accept i64/u64/f64 so those players still expose a timeline.
    let value = metadata.get(key)?.try_clone().ok()?;
    if let Ok(number) = i64::try_from(value.try_clone().ok()?) {
        return Some(number as f64);
    }
    if let Ok(number) = u64::try_from(value.try_clone().ok()?) {
        return Some(number as f64);
    }
    f64::try_from(value).ok()
}

fn track_id(metadata: &HashMap<String, OwnedValue>) -> Option<OwnedObjectPath> {
    metadata
        .get("mpris:trackid")
        .and_then(|value| value.try_clone().ok())
        .and_then(|value| OwnedObjectPath::try_from(value).ok())
}

fn artwork(media: &mut Media, art_url: &str) {
    let art_url = art_url.trim();
    if art_url.is_empty() {
        return;
    }
    if art_url.starts_with("data:") {
        if art_url.len() < 5_000_000 {
            media.thumbnail = Some(art_url.to_string());
            media.thumbnail_type = Some("image/*".to_string());
        }
        return;
    }
    if art_url.starts_with("file://") {
        if let Some(path) = util::file_url_to_path(art_url) {
            if let Some(data) = util::file_image_data_url(&path, 4 * 1024 * 1024) {
                media.thumbnail = Some(data);
                media.thumbnail_type = Some("image/*".to_string());
            }
        }
        return;
    }
    if art_url.starts_with("http://") || art_url.starts_with("https://") {
        // The Node bridge downloads HTTP artwork and fills `thumbnail`.
        media.thumbnail_url = Some(art_url.to_string());
    }
}

pub fn read(options: &ReadOptions) -> Result<Option<Media>, String> {
    let preferred = preferred_app(options);
    let connection = match connection() {
        Ok(connection) => connection,
        // No session bus / no MPRIS service: use the vendor fallback only when
        // the caller did not ask for a specific player.
        Err(_) => {
            return Ok(if preferred.is_some() {
                None
            } else {
                crate::media::vendor::fallback_media()
            });
        }
    };
    let names = match player_names(&connection) {
        Ok(names) => names,
        Err(_) => {
            return Ok(if preferred.is_some() {
                None
            } else {
                crate::media::vendor::fallback_media()
            });
        }
    };
    let Some(name) = choose_player(&connection, &names, options) else {
        return Ok(if preferred.is_some() {
            None
        } else {
            crate::media::vendor::fallback_media()
        });
    };
    match media_for_player(&connection, &name, options)? {
        Some(media) => Ok(Some(media)),
        // An empty browser/player placeholder: the vendor layer decides whether
        // the identified app still has a page-backed snapshot.
        None => {
            let app = catalog::profile_for_id(&name)
                .or_else(|| catalog::profile_for_process(&name))
                .map(|profile| profile.app);
            Ok(crate::media::vendor::fallback_for_app(app))
        }
    }
}

/// Build one MPRIS snapshot. `Ok(None)` means the player exposes an empty
/// placeholder rather than a real session.
fn media_for_player(
    connection: &Connection,
    name: &str,
    options: &ReadOptions,
) -> Result<Option<Media>, String> {
    let proxy = player_proxy(connection, name)?;
    let metadata = metadata_of(&proxy);
    let title = string_value(&metadata, "xesam:title");
    let artists: Vec<String> = string_array(&metadata, "xesam:artist")
        .into_iter()
        .filter(|artist| !artist.trim().is_empty())
        .collect();
    let status = proxy
        .get_property::<String>("PlaybackStatus")
        .unwrap_or_else(|_| "Stopped".to_string());
    let length_micros = number_value(&metadata, "mpris:length")
        .unwrap_or(0.0)
        .max(0.0);
    let duration = length_micros / 1_000_000.0;

    // Browser MPRIS services often expose an empty placeholder entry while no
    // tab is playing. Only treat it as a real session when it is playing or has
    // a track/duration.
    if title.trim().is_empty() && artists.is_empty() && duration <= 0.0 && status != "Playing" {
        return Ok(None);
    }

    let position_micros = proxy.get_property::<i64>("Position").unwrap_or(0).max(0);
    let can_seek = proxy.get_property::<bool>("CanSeek").unwrap_or(false);
    let can_control = proxy.get_property::<bool>("CanControl").unwrap_or(true);

    let mut media = Media::new(name.to_string());
    media.provider_detail = "mpris".to_string();
    media.title = if title.trim().is_empty() {
        "未命名媒体".to_string()
    } else {
        title
    };
    media.artist = artists.join(", ");
    media.album = string_value(&metadata, "xesam:album");
    media.album_artist = string_array(&metadata, "xesam:albumArtist")
        .into_iter()
        .filter(|artist| !artist.trim().is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    media.playback_status = status;
    media.position = position_micros as f64 / 1_000_000.0;
    media.start_time = 0.0;
    media.end_time = duration;
    media.min_seek_time = 0.0;
    media.max_seek_time = duration;
    media.last_updated_at = util::now_ms();
    media.can_play_pause = can_control && proxy.get_property::<bool>("CanPause").unwrap_or(true);
    media.can_next = proxy.get_property::<bool>("CanGoNext").unwrap_or(true);
    media.can_previous = proxy.get_property::<bool>("CanGoPrevious").unwrap_or(true);
    let complete = can_seek && duration > 0.0;
    media.can_seek = catalog::seek_allowed(Tier::System, complete, false);
    if options.thumbnail {
        artwork(&mut media, &string_value(&metadata, "mpris:artUrl"));
    }

    // Vendor-first: identify the MPRIS player and let its adapter combine the
    // system session with any private interface.
    let profile = catalog::profile_for_id(&media.app_id)
        .or_else(|| catalog::profile_for_process(&media.app_id));
    if let Some(profile) = profile {
        if profile.app != catalog::App::Browser {
            if let Some(resolved) = crate::media::vendor::resolve(
                crate::media::vendor::Platform::Linux,
                profile.app,
                Some(media.clone()),
                None,
                || None,
            ) {
                return Ok(Some(resolved));
            }
        }
    }
    Ok(Some(media))
}

/// Return every distinct MPRIS session, ordered by the same priority used for
/// the active card. macOS has a single system session by design; Linux can
/// enumerate all players.
pub fn read_all(options: &ReadOptions) -> Result<Vec<Media>, String> {
    let connection = connection()?;
    let names = player_names(&connection)?;
    let preferred = preferred_app(options);
    let mut ordered: Vec<(usize, usize, usize, Media)> = Vec::new();
    for (order, name) in names.iter().enumerate() {
        let Ok(Some(media)) = media_for_player(&connection, name, options) else {
            continue;
        };
        let playing = if media.playback_status == "Playing" {
            0
        } else {
            1
        };
        let priority = catalog::profile_for_id(&media.app_id)
            .or_else(|| catalog::profile_for_process(&media.app_id))
            .map(|profile| catalog::app_priority(profile.app))
            .unwrap_or(catalog::APP_PRIORITY.len());
        ordered.push((playing, priority, order, media));
    }
    ordered.sort_by_key(|(playing, priority, order, _)| (*playing, *priority, *order));
    let mut result: Vec<Media> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (_, _, _, media) in ordered {
        let key = format!(
            "{:?}\u{1f}{}\u{1f}{}\u{1f}{}",
            catalog::profile_for_media(&media).map(|profile| profile.app),
            media.app_id,
            media.title,
            media.artist
        );
        if seen.insert(key) {
            result.push(media);
        }
    }
    if result.is_empty() && preferred.is_none() {
        if let Some(media) = crate::media::vendor::fallback_media() {
            result.push(media);
        }
    }
    Ok(result)
}

fn preferred_app(options: &ReadOptions) -> Option<&str> {
    options
        .app_id
        .as_deref()
        .or(options.player.as_deref())
        .filter(|value| !value.is_empty())
}

fn requested_app(options: &ReadOptions, current: Option<&Media>) -> Option<catalog::App> {
    options
        .app_id
        .as_deref()
        .or(options.player.as_deref())
        .and_then(|value| {
            catalog::profile_for_id(value).or_else(|| catalog::profile_for_process(value))
        })
        .or_else(|| current.and_then(catalog::profile_for_media))
        .map(|profile| profile.app)
}

fn system_control(proxy: &Proxy<'_>, action: &str, position: f64) -> Result<(), String> {
    match action {
        "playpause" => {
            let _: () = proxy.call("PlayPause", &()).map_err(failure)?;
        }
        "next" => {
            let _: () = proxy.call("Next", &()).map_err(failure)?;
        }
        "previous" => {
            let _: () = proxy.call("Previous", &()).map_err(failure)?;
        }
        "seek" => {
            // MPRIS is the system tier here: only expose seek when the player
            // itself advertises a seekable track. The private/accessibility
            // tiers never grant seek.
            let can_seek = proxy.get_property::<bool>("CanSeek").unwrap_or(false);
            let metadata = metadata_of(proxy);
            let duration = number_value(&metadata, "mpris:length").unwrap_or(0.0);
            if !can_seek || duration <= 0.0 {
                return Err(
                    "this player only reports progress; seek requires MPRIS CanSeek".to_string(),
                );
            }
            let target_micros = (position.max(0.0) * 1_000_000.0).round() as i64;
            if let Some(track) = track_id(&metadata) {
                let path: &ObjectPath = &track;
                let _: () = proxy
                    .call("SetPosition", &(path, target_micros))
                    .map_err(failure)?;
            } else {
                let current = proxy.get_property::<i64>("Position").unwrap_or(0);
                let _: () = proxy
                    .call("Seek", &(target_micros - current))
                    .map_err(failure)?;
            }
        }
        other => return Err(format!("unsupported media action: {other}")),
    }
    Ok(())
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
    let target_app = requested_app(options, current.as_ref());
    let connection = connection().ok();
    let names = connection
        .as_ref()
        .and_then(|connection| player_names(connection).ok())
        .unwrap_or_default();
    let chosen = connection
        .as_ref()
        .and_then(|connection| choose_player(connection, &names, options));
    crate::media::vendor::control(
        crate::media::vendor::Platform::Linux,
        target_app,
        action,
        position,
        current.as_ref(),
        || {
            let connection = connection
                .as_ref()
                .ok_or_else(|| "no MPRIS session bus".to_string())?;
            let name = chosen
                .as_ref()
                .ok_or_else(|| "no MPRIS player is running".to_string())?;
            if let Some(preferred) = preferred {
                // Never control a different player than the one requested by
                // the UI (the same rule as the Windows session selector).
                if !player_matches_preferred(name, preferred) {
                    return Err("the requested player is not the current MPRIS player".to_string());
                }
            }
            let proxy = player_proxy(connection, name)?;
            system_control(&proxy, action, position)
        },
    )
}

pub fn like(liked: Option<bool>, options: &ReadOptions) -> Result<(), String> {
    let check = ReadOptions {
        thumbnail: false,
        ..options.clone()
    };
    let current = read(&check).ok().flatten();
    let target_app = requested_app(options, current.as_ref());
    crate::media::vendor::like(target_app, liked)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_inline_artwork_and_defers_http_artwork() {
        let mut inline = Media::new("org.mpris.MediaPlayer2.test");
        artwork(&mut inline, "data:image/png;base64,AAAA");
        assert_eq!(
            inline.thumbnail.as_deref(),
            Some("data:image/png;base64,AAAA")
        );

        let mut remote = Media::new("org.mpris.MediaPlayer2.test");
        artwork(&mut remote, "https://example.test/cover.jpg");
        assert!(remote.thumbnail.is_none());
        assert_eq!(
            remote.thumbnail_url.as_deref(),
            Some("https://example.test/cover.jpg")
        );
    }

    #[test]
    fn preferred_player_must_match_the_control_target() {
        assert!(player_matches_preferred(
            "org.mpris.MediaPlayer2.spotify",
            "org.mpris.MediaPlayer2.spotify"
        ));
        assert!(player_matches_preferred(
            "org.mpris.MediaPlayer2.spotify",
            "spotify"
        ));
        assert!(!player_matches_preferred(
            "org.mpris.MediaPlayer2.vlc",
            "org.mpris.MediaPlayer2.spotify"
        ));
    }
}
