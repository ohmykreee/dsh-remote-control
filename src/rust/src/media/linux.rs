//! Linux media probe: MPRIS 2 over the session D-Bus (zbus), no `playerctl`.

use std::collections::HashMap;

use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::{ObjectPath, OwnedObjectPath, OwnedValue};

use super::catalog::{self, Tier};
use super::{Media, ReadOptions};
use crate::util;

pub const BACKEND: &str = "rust-mpris";

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

fn playback_status(connection: &Connection, name: &str) -> Option<String> {
    player_proxy(connection, name)
        .ok()?
        .get_property::<String>("PlaybackStatus")
        .ok()
}

/// Reuse the previously selected player while it is alive, otherwise prefer a
/// playing player, then the first one. Mirrors the old playerctl adapter.
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
    }
    for name in names {
        if playback_status(connection, name).as_deref() == Some("Playing") {
            return Some(name.clone());
        }
    }
    names.first().cloned()
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
        // The Node bridge downloads HTTP artwork (it already had this logic for
        // the playerctl adapter) and fills `thumbnail`.
        media.thumbnail_url = Some(art_url.to_string());
    }
}

pub fn read(options: &ReadOptions) -> Result<Option<Media>, String> {
    let connection = connection()?;
    let names = player_names(&connection)?;
    let Some(name) = choose_player(&connection, &names, options) else {
        return Ok(None);
    };
    let proxy = player_proxy(&connection, &name)?;
    let metadata = metadata_of(&proxy);
    let title = string_value(&metadata, "xesam:title");
    let artists = string_array(&metadata, "xesam:artist");
    if title.trim().is_empty() && artists.is_empty() {
        return Ok(None);
    }

    let status = proxy
        .get_property::<String>("PlaybackStatus")
        .unwrap_or_else(|_| "Stopped".to_string());
    let position_micros = proxy.get_property::<i64>("Position").unwrap_or(0).max(0);
    let length_micros = number_value(&metadata, "mpris:length")
        .unwrap_or(0.0)
        .max(0.0);
    let duration = length_micros / 1_000_000.0;
    let can_seek = proxy.get_property::<bool>("CanSeek").unwrap_or(false);
    let can_control = proxy.get_property::<bool>("CanControl").unwrap_or(true);

    let mut media = Media::new(name.clone());
    media.provider_detail = "mpris".to_string();
    media.title = if title.trim().is_empty() {
        "未命名媒体".to_string()
    } else {
        title
    };
    media.artist = artists.join(", ");
    media.album = string_value(&metadata, "xesam:album");
    media.album_artist = string_array(&metadata, "xesam:albumArtist").join(", ");
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
    Ok(Some(media))
}

pub fn control(action: &str, position: f64, options: &ReadOptions) -> Result<(), String> {
    let connection = connection()?;
    let names = player_names(&connection)?;
    let Some(name) = choose_player(&connection, &names, options) else {
        return Err("no MPRIS player is running".to_string());
    };
    let proxy = player_proxy(&connection, &name)?;
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
            let metadata = metadata_of(&proxy);
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
}
