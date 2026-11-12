//! NetEase Cloud Music local metadata (cover art + liked state).
//!
//! The desktop client keeps its own library in `Library/webdb.dat` (a SQLite
//! database) and its image cache in `Statics/*.dat`. This module reads those
//! files read-only to enrich the current SMTC/MPRIS session. It never writes to
//! the client, never calls a network API and never extracts cookies.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

use super::common;
use crate::media::catalog::ParsedTitle;
use crate::media::Media;
use crate::util;

const MAX_COVER_BYTES: u64 = 4 * 1024 * 1024;
const HISTORY_LIMIT: usize = 120;

/// A NetEase track matched from the local client database.
#[derive(Debug, Clone, Default)]
pub struct LocalTrack {
    pub track_id: Option<String>,
    pub duration_seconds: Option<f64>,
    pub liked: Option<bool>,
    pub cover: Option<String>,
}

#[derive(Debug, Clone)]
struct TrackData {
    id: Option<String>,
    name: String,
    artists: Vec<String>,
    duration_ms: Option<f64>,
    source_history: bool,
}

/// True when the SMTC/MPRIS app id belongs to the NetEase desktop client.
pub fn is_netease(app_id: &str) -> bool {
    let app_id = app_id.to_ascii_lowercase();
    app_id.contains("cloudmusic") || app_id.contains("netease") || app_id.contains("163music")
}

/// Parse the NetEase desktop window title.
///
/// NetEase's SMTC session provides metadata but not playback progress, so the
/// title fallback is only used when SMTC is missing/incomplete. Titles look like
/// `歌名 - 歌手 - 网易云音乐`.
pub fn parse_title(raw: &str) -> Option<ParsedTitle> {
    const SUFFIXES: &[&str] = &[
        " - 网易云音乐",
        " - NetEase Cloud Music",
        " - 网易云",
        " - CloudMusic",
    ];
    const PRODUCT_NAMES: &[&str] = &["网易云音乐", "网易云", "netease cloud music", "cloudmusic"];
    let text = common::strip_suffixes(common::normalize_spaces(raw), SUFFIXES);
    if common::is_generic_title(&text, PRODUCT_NAMES) {
        return None;
    }
    let mut parsed = common::split_title_artist(&text, false);
    parsed.artist = common::normalize_artist(&parsed.artist, &[("/", " / ")]);
    if parsed.title.is_empty() {
        return None;
    }
    Some(parsed)
}

/// Enrich a playing media item with local NetEase cover/liked/duration data.
pub fn enrich(media: &mut Media) {
    if !is_netease(&media.app_id) {
        return;
    }
    // `canLike` is a display flag: the console shows read-only liked state.
    media.can_like = true;
    // Seek policy is decided by the platform adapter. NetEase's SMTC provides
    // metadata/status but not playback progress, so the Windows adapter treats
    // it as metadata-only and never grants seek. This module only enriches
    // metadata and must not grant seek by itself.
    let Some(local) = read_local(&media.title, &media.artist) else {
        return;
    };
    if media.track_id.is_none() {
        media.track_id = local.track_id;
    }
    if media.liked.is_none() {
        media.liked = local.liked;
    }
    if media.thumbnail.is_none() {
        media.thumbnail = local.cover;
        if media.thumbnail.is_some() {
            media.thumbnail_type = Some("image/*".to_string());
        }
    }
    if media.end_time <= media.start_time {
        if let Some(duration) = local.duration_seconds.filter(|value| *value > 0.0) {
            media.end_time = duration;
            media.max_seek_time = duration;
        }
    }
}

pub fn read_local(title: &str, artist: &str) -> Option<LocalTrack> {
    let (track, liked) = with_database(|connection| {
        let track = find_track(connection, title, artist);
        let liked = track
            .as_ref()
            .and_then(|track| track.id.as_deref())
            .and_then(|track_id| is_liked(connection, track_id));
        (track, liked)
    })?;
    let track = track?;
    Some(LocalTrack {
        track_id: track.id,
        duration_seconds: track.duration_ms.map(|value| value / 1000.0),
        liked,
        cover: latest_cover(),
    })
}

/// Run `f` against a read-only copy of the NetEase database.
///
/// Opening the live file first mirrors the old Node adapter: SQLite readers can
/// share a WAL database. If the client holds an exclusive lock, fall back to a
/// temporary copy of the database and its sidecars.
fn with_database<T>(f: impl FnOnce(&Connection) -> T) -> Option<T> {
    for root in netease_roots() {
        let source = root.join("Library").join("webdb.dat");
        if !source.is_file() {
            continue;
        }
        if let Ok(connection) =
            Connection::open_with_flags(&source, OpenFlags::SQLITE_OPEN_READ_ONLY)
        {
            let _ = connection.busy_timeout(std::time::Duration::from_millis(500));
            return Some(f(&connection));
        }
        let temp = util::TempDir::create("dsh-probe-netease").ok()?;
        let target = temp.path().join("webdb.dat");
        util::copy_sqlite_database(&source, &target).ok()?;
        if let Ok(connection) =
            Connection::open_with_flags(&target, OpenFlags::SQLITE_OPEN_READ_ONLY)
        {
            return Some(f(&connection));
        }
    }
    None
}

/// Candidate NetEase Cloud Music data roots, most specific first.
pub fn netease_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if cfg!(windows) {
        let local = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| util::home_dir().map(|home| home.join("AppData").join("Local")));
        if let Some(local) = local {
            for name in ["NetEase", "Netease"] {
                roots.push(local.join(name).join("CloudMusic"));
            }
        }
    } else if cfg!(target_os = "macos") {
        if let Some(home) = util::home_dir() {
            roots.push(
                home.join("Library")
                    .join("Application Support")
                    .join("Netease")
                    .join("CloudMusic"),
            );
            roots.push(
                home.join("Library")
                    .join("Application Support")
                    .join("NetEase")
                    .join("CloudMusic"),
            );
            roots.push(
                home.join("Library")
                    .join("Containers")
                    .join("com.netease.163music")
                    .join("Data")
                    .join("Documents"),
            );
        }
    } else {
        if let Some(home) = util::home_dir() {
            roots.push(home.join(".config").join("netease-cloud-music"));
            roots.push(
                home.join(".local")
                    .join("share")
                    .join("netease-cloud-music"),
            );
            roots.push(home.join(".netease-cloud-music"));
            roots.push(home.join(".config").join("NetEase").join("CloudMusic"));
        }
    }
    roots.retain(|root| root.is_dir());
    roots
}

/// Normalize a title/artist for comparison (case, spaces, punctuation).
pub fn normalize(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|character| !character.is_whitespace() && !"()（）[]【】'\"`".contains(*character))
        .collect()
}

fn column_names(connection: &Connection, table: &str) -> Vec<String> {
    let sql = format!("pragma table_info(\"{}\")", table.replace('"', "\"\""));
    let Ok(mut statement) = connection.prepare(&sql) else {
        return Vec::new();
    };
    let Ok(rows) = statement.query_map([], |row| row.get::<_, String>(1)) else {
        return Vec::new();
    };
    rows.flatten().collect()
}

fn json_column(columns: &[String]) -> Option<String> {
    columns
        .iter()
        .find(|name| name.eq_ignore_ascii_case("jsonStr"))
        .cloned()
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn parse_track(json: &str, source_history: bool) -> Option<TrackData> {
    let value: Value = serde_json::from_str(json).ok()?;
    let name = value.get("name")?.as_str()?.trim().to_string();
    if name.is_empty() {
        return None;
    }
    let id = value.get("id").and_then(value_to_string);
    let artists = value
        .get("artists")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let duration_ms = value.get("duration").and_then(Value::as_f64);
    Some(TrackData {
        id,
        name,
        artists,
        duration_ms,
        source_history,
    })
}

fn find_track(connection: &Connection, title: &str, artist: &str) -> Option<TrackData> {
    let wanted_title = normalize(title);
    if wanted_title.is_empty() {
        return None;
    }
    let wanted_artist = normalize(artist);
    let mut candidates: Vec<(i32, TrackData)> = Vec::new();

    for table in ["historyTracks", "dbTrack"] {
        let columns = column_names(connection, table);
        let Some(json_column) = json_column(&columns) else {
            continue;
        };
        let order = if table == "historyTracks" {
            " order by playtime desc"
        } else {
            ""
        };
        let sql = format!(
            "select \"{}\" from \"{}\"{} limit {HISTORY_LIMIT}",
            json_column.replace('"', "\"\""),
            table,
            order
        );
        let Ok(mut statement) = connection.prepare(&sql) else {
            continue;
        };
        let Ok(rows) = statement.query_map([], |row| row.get::<_, String>(0)) else {
            continue;
        };
        for json in rows.flatten() {
            let Some(track) = parse_track(&json, table == "historyTracks") else {
                continue;
            };
            let name = normalize(&track.name);
            let mut score: i32 = 0;
            if name == wanted_title {
                score += 10;
            } else if name.contains(&wanted_title) || wanted_title.contains(&name) {
                score += 5;
            }
            if !wanted_artist.is_empty() {
                let artist_match = track.artists.iter().any(|candidate| {
                    let candidate = normalize(candidate);
                    candidate == wanted_artist
                        || candidate.contains(&wanted_artist)
                        || wanted_artist.contains(&candidate)
                });
                if artist_match {
                    score += 6;
                }
            }
            if track.source_history {
                score += 1;
            }
            if score >= 5 {
                candidates.push((score, track));
            }
        }
    }

    candidates.sort_by(|left, right| right.0.cmp(&left.0));
    candidates.into_iter().next().map(|(_, track)| track)
}

fn liked_playlist_id(connection: &Connection) -> Option<String> {
    let columns = column_names(connection, "historyPlaylists");
    let json_column = json_column(&columns)?;
    let sql = format!(
        "select cast(id as text), \"{}\" from \"historyPlaylists\" limit 200",
        json_column.replace('"', "\"\"")
    );
    let mut statement = connection.prepare(&sql).ok()?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .ok()?;
    for row in rows.flatten() {
        let (id, json) = row;
        let Ok(value) = serde_json::from_str::<Value>(&json) else {
            continue;
        };
        let name = value.get("name").and_then(Value::as_str).unwrap_or("");
        let special = value
            .get("specialType")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let is_liked = name.contains("喜欢的音乐")
            || name.contains("喜歡的音樂")
            || name.to_lowercase().contains("liked songs")
            || special == 5;
        if is_liked {
            return Some(id.to_string());
        }
    }
    None
}

fn is_liked(connection: &Connection, track_id: &str) -> Option<bool> {
    let playlist_id = liked_playlist_id(connection)?;
    let columns = column_names(connection, "playlistTrackIds");
    let json_column = json_column(&columns)?;
    let sql = format!(
        "select \"{}\" from \"playlistTrackIds\" where id = ?1",
        json_column.replace('"', "\"\"")
    );
    let json: String = connection
        .query_row(&sql, [playlist_id], |row| row.get(0))
        .ok()?;
    let value: Value = serde_json::from_str(&json).ok()?;
    let track_ids = value.get("trackIds")?.as_array()?;
    Some(track_ids.iter().any(|item| {
        item.get("id")
            .and_then(value_to_string)
            .map(|id| id == track_id)
            .unwrap_or(false)
    }))
}

/// Read the newest image from the client `Statics` cache.
fn latest_cover() -> Option<String> {
    for root in netease_roots() {
        let directory = root.join("Statics");
        if let Some(cover) = cover_from_directory(&directory) {
            return Some(cover);
        }
    }
    None
}

fn cover_from_directory(directory: &Path) -> Option<String> {
    let mut files: Vec<(SystemTime, PathBuf, u64)> = std::fs::read_dir(directory)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let is_dat = path
                .extension()
                .map(|extension| extension.eq_ignore_ascii_case("dat"))
                .unwrap_or(false);
            if !is_dat {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let size = metadata.len();
            if !(500..MAX_COVER_BYTES).contains(&size) {
                return None;
            }
            let modified = metadata.modified().ok()?;
            Some((modified, path, size))
        })
        .collect();
    files.sort_by(|left, right| right.0.cmp(&left.0));
    for (_, path, _) in files.into_iter().take(8) {
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        if let Some(data) = util::image_data_url(&bytes) {
            return Some(data);
        }
    }
    None
}

/// Read the track metadata for a test database (exposed for unit tests).
#[cfg(test)]
fn read_local_from(connection: &Connection, title: &str, artist: &str) -> Option<LocalTrack> {
    let track = find_track(connection, title, artist)?;
    let liked = track
        .id
        .as_deref()
        .and_then(|track_id| is_liked(connection, track_id));
    Some(LocalTrack {
        track_id: track.id.clone(),
        duration_seconds: track.duration_ms.map(|value| value / 1000.0),
        liked,
        cover: None,
    })
}

/// Simple key/value view used by the tests.
#[cfg(test)]
fn json_track(name: &str, artist: &str, id: &str, duration: f64) -> String {
    serde_json::json!({
        "id": id,
        "name": name,
        "duration": duration,
        "artists": [{ "id": "1", "name": artist }],
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "create table historyTracks (playtime integer, id text, jsonStr text);
                 create table dbTrack (id text, jsonStr text);
                 create table historyPlaylists (playtime integer, id text, jsonStr text);
                 create table playlistTrackIds (id text, jsonStr text);",
            )
            .unwrap();
        connection
    }

    #[test]
    fn normalizes_titles_for_matching() {
        assert_eq!(normalize("  Hello (Live)  "), "hellolive");
        assert_eq!(normalize("A  B\tC"), "abc");
    }

    #[test]
    fn parses_netease_window_title() {
        let parsed = parse_title("晴天 - 周杰伦 - 网易云音乐").unwrap();
        assert_eq!(parsed.title, "晴天");
        assert_eq!(parsed.artist, "周杰伦");
        assert!(parse_title("网易云音乐").is_none());
    }

    #[test]
    fn netease_enrichment_never_grants_seek() {
        let mut media = Media::new("cloudmusic.exe");
        media.can_seek = false;
        enrich(&mut media);
        assert!(!media.can_seek);
    }

    #[test]
    fn matches_history_track_and_duration() {
        let connection = fixture();
        connection
            .execute(
                "insert into historyTracks (playtime, id, jsonStr) values (?, ?, ?)",
                rusqlite::params![
                    10,
                    "7",
                    json_track("Tablear", "kuro", "2660424367", 200506.0)
                ],
            )
            .unwrap();
        let local = read_local_from(&connection, "Tablear", "kuro").unwrap();
        assert_eq!(local.track_id.as_deref(), Some("2660424367"));
        assert!((local.duration_seconds.unwrap() - 200.506).abs() < 0.001);
        assert_eq!(local.liked, None);
    }

    #[test]
    fn reads_liked_state_from_the_liked_playlist() {
        let connection = fixture();
        connection
            .execute(
                "insert into historyTracks (playtime, id, jsonStr) values (1, '7', ?1)",
                [json_track("Song", "Artist", "42", 1000.0)],
            )
            .unwrap();
        connection
            .execute(
                "insert into historyPlaylists (playtime, id, jsonStr) values (1, '99', ?1)",
                [r#"{"name":"Kreee喜欢的音乐","trackCount":1}"#],
            )
            .unwrap();
        connection
            .execute(
                "insert into playlistTrackIds (id, jsonStr) values ('99', ?1)",
                [r#"{"trackIds":[{"id":"42","v":4}]}"#],
            )
            .unwrap();
        let local = read_local_from(&connection, "Song", "Artist").unwrap();
        assert_eq!(local.liked, Some(true));
    }

    #[test]
    fn unmatched_track_has_no_liked_state() {
        let connection = fixture();
        assert!(find_track(&connection, "missing", "nobody").is_none());
    }

    #[test]
    fn identifies_netease_app_ids() {
        assert!(is_netease("cloudmusic.exe"));
        assert!(is_netease("com.netease.163music"));
        assert!(!is_netease("MSEdge"));
    }

    #[test]
    fn reads_cover_from_statics_cache() {
        let directory = util::TempDir::create("dsh-probe-netease-test").unwrap();
        // Smallest useful PNG: a 1x1 transparent image.
        let png: [u8; 66] = [
            0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, b'I', b'H', b'D', b'R',
            0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1F, 0x15, 0xC4, 0x89, 0, 0, 0, 0x0A, b'I',
            b'D', b'A', b'T', 0x78, 0x9C, 0x63, 0, 0, 0, 2, 0, 1, 0xE2, 0x21, 0xBC, 0x33, 0, 0, 0,
            0, b'I', b'E', b'N', b'D', 0xAE, 0x42, 0x60, 0x82,
        ];
        let path = directory.path().join("cover.dat");
        let mut bytes = png.to_vec();
        bytes.resize(600, 0);
        std::fs::write(&path, bytes).unwrap();
        let cover = cover_from_directory(directory.path()).unwrap();
        assert!(cover.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn ignores_non_image_cache_files() {
        let directory = util::TempDir::create("dsh-probe-netease-test").unwrap();
        std::fs::write(directory.path().join("index.dat"), vec![0u8; 4096]).unwrap();
        assert!(cover_from_directory(directory.path()).is_none());
    }

    #[test]
    #[ignore = "reads the local NetEase desktop client database"]
    fn reads_live_netease_database() {
        let latest = with_database(|connection| {
            let columns = column_names(connection, "historyTracks");
            let json_column = json_column(&columns)?;
            let sql = format!(
                "select \"{}\" from historyTracks order by playtime desc limit 1",
                json_column.replace('"', "\"\"")
            );
            let json: String = connection.query_row(&sql, [], |row| row.get(0)).ok()?;
            let track = parse_track(&json, true)?;
            Some((
                track.name,
                track.artists.first().cloned().unwrap_or_default(),
            ))
        })
        .flatten();
        let Some((title, artist)) = latest else {
            eprintln!("no NetEase history track found; skipping live assertions");
            return;
        };
        let local = read_local(&title, &artist).expect("live track should match");
        assert!(local.track_id.is_some(), "live track id");
        assert!(local.liked.is_some(), "liked state should be known");
        assert!(
            local.cover.is_some(),
            "live cover should be found in Statics"
        );
        let mut media = Media::new("cloudmusic.exe");
        media.title = title;
        media.artist = artist;
        media.end_time = 0.0;
        enrich(&mut media);
        assert!(media.can_like);
        assert!(media.liked.is_some());
        assert!(media.track_id.is_some());
    }
}
