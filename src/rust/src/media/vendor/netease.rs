//! NetEase Cloud Music vendor adapter: local metadata cache and CDP bridge.
//!
//! The desktop client keeps its library in `Library/webdb.dat` (a SQLite
//! database) and its image cache in `Statics/*.dat`. This module opens those
//! files read-only to enrich the private window-title path with a track id,
//! duration and cover art. It never writes to the client, never calls a network
//! API and never extracts cookies.
//!
//! When the client was launched with `/remote-debugging-port=<port>` (or
//! `--remote-debugging-port=<port>`, default port `2015`), the CDP bridge also
//! supplies:
//!
//! - with a usable SMTC/MPRIS/Now Playing session: exact playback progress,
//!   duration and liked state, while the system session keeps its transport and
//!   seek policy;
//! - without a system session: the full media snapshot (title, artist, album,
//!   cover URL, playback state and progress) plus play/pause and next/previous,
//!   but no seek grant;
//! - the like button state and click, which the client store does not expose.
//!
//! Without CDP, liked state stays `null` and progress falls back to the
//! platform's window-title / UI Automation text. The local database is never
//! used for liked state.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use base64::Engine as _;
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};

use super::common;
use super::Platform;
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

/// Enrich a playing media item with local NetEase cover/duration data.
///
/// Liked state is deliberately not read here: it is only available through the
/// CDP bridge when the client is launched with remote debugging.
pub fn enrich(media: &mut Media) {
    if !is_netease(&media.app_id) {
        return;
    }
    // Seek policy is decided by the platform adapter. Windows NetEase SMTC is
    // metadata-only; Linux MPRIS / macOS Now Playing may keep a valid seek
    // grant. This module only enriches metadata and must not grant seek itself.
    let Some(local) = read_local(&media.title, &media.artist) else {
        return;
    };
    if media.track_id.is_none() {
        media.track_id = local.track_id;
    }
    // The cover must come from the active provider: SMTC while a system
    // session exists, or the CDP page in CDP-only mode. The local Statics cache
    // is only a fallback for the private window-title path.
    let provider_cover =
        media.provider_detail.contains("smtc") || media.provider_detail.contains("cdp");
    if !provider_cover && media.thumbnail.is_none() {
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
    let track = with_database(|connection| find_track(connection, title, artist))?;
    let track = track?;
    Some(LocalTrack {
        track_id: track.id,
        duration_seconds: track.duration_ms.map(|value| value / 1000.0),
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
    Some(LocalTrack {
        track_id: track.id.clone(),
        duration_seconds: track.duration_ms.map(|value| value / 1000.0),
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

/// Live state read from the NetEase page through the Chromium DevTools
/// Protocol. Only available when the client was started with
/// `/remote-debugging-port=<port>` (or `--remote-debugging-port=<port>`).
#[derive(Debug, Clone, Copy, Default)]
pub struct CdpState {
    pub position: Option<f64>,
    pub duration: Option<f64>,
    pub liked: Option<bool>,
    pub can_like: bool,
    pub can_set_liked: bool,
}

/// Full media snapshot used only when NetEase has no SMTC session at all.
/// The page is then the only source, so it also supplies metadata, cover art
/// and transport availability.
#[derive(Debug, Clone, Default)]
struct CdpTrack {
    title: String,
    artist: String,
    album: String,
    cover_url: Option<String>,
    position: Option<f64>,
    duration: Option<f64>,
    playing: Option<bool>,
    liked: Option<bool>,
    can_like: bool,
    can_set_liked: bool,
    can_play_pause: bool,
    can_next: bool,
    can_previous: bool,
}

const CDP_DEFAULT_PORT: u16 = 2015;
const CDP_CONNECT_TIMEOUT: Duration = Duration::from_millis(250);
const CDP_IO_TIMEOUT: Duration = Duration::from_millis(1500);

/// Store/audio progress are preferred when the client's webpack runtime is
/// reachable; the visible player bar is a layout-independent fallback. The
/// like action uses the client's Ctrl+L shortcut, with a visible-button click
/// only if CDP key dispatch itself fails.
const CDP_STATE_TEMPLATE: &str = r#"
(async () => {
__STORE_HELPER__
  const dom = domMedia();
  const position = (await readProgress()) ?? dom.position ?? null;
  const effectiveDuration = duration || dom.duration || null;
  const button = pickLikeButton(false);
  return {
    position,
    duration: effectiveDuration,
    liked: readLiked(button),
    canLike: !!button,
    canSetLiked: !!button && button.getAttribute('aria-disabled') !== 'true'
  };
})()
"#;

#[allow(dead_code)] // called by the platform adapters; kept cross-platform.
const CDP_CLICK_LIKE_EXPRESSION: &str = r#"
(() => {
  const all = Array.from(document.querySelectorAll(
    'button[data-testid="tid_redstar_btn"]'
  ));
  const visible = all.filter((button) => {
    const rect = button.getBoundingClientRect();
    const style = window.getComputedStyle(button);
    return rect.width > 0 && rect.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden';
  });
  const pool = visible.length ? visible : all;
  const button = pool.find(
    (candidate) => candidate.getAttribute('aria-disabled') !== 'true'
  ) || null;
  if (!button) return { ok: false };
  button.click();
  return { ok: true };
})()
"#;

/// Attempt to resolve the live store through the NetEase webpack runtime. The
/// module id changes between client builds, so inspect the loaded module cache
/// instead of hard-coding one id. This is opportunistic: after a page reload
/// the require hook may not be installable, so every template also has a DOM
/// player-bar fallback.
const CDP_STORE_HELPER: &str = r#"
  const req = (() => {
    if (window.__dsh_cm_require__) return window.__dsh_cm_require__;
    try {
      webpackJsonp.push([[987660], { 987660: function(module, exports, require) {
        window.__dsh_cm_require__ = require;
      } }]);
    } catch (error) {}
    return window.__dsh_cm_require__;
  })();
  const findStoreApi = () => {
    if (!req) return null;
    const cache = req.c || {};
    for (const id of Object.keys(cache)) {
      let exports;
      try { exports = cache[id] && cache[id].exports; } catch (error) { continue; }
      if (!exports) continue;
      const api = typeof exports.getStore === 'function'
        ? exports
        : (exports.a && typeof exports.a.getStore === 'function' ? exports.a : null);
      if (api) return api;
    }
    return null;
  };
  const knownStoreApi = (id) => {
    try {
      const module = req(id);
      return module && typeof module.getStore === 'function'
        ? module
        : (module && module.a && typeof module.a.getStore === 'function' ? module.a : null);
    } catch (error) { return null; }
  };
  let storeApi = window.__dsh_cm_store_api__;
  if (!storeApi) {
    storeApi = knownStoreApi(7) || knownStoreApi(12) || findStoreApi();
    if (storeApi) window.__dsh_cm_store_api__ = storeApi;
  }
  let store = null;
  try { store = storeApi ? storeApi.getStore() : null; } catch (error) { store = null; }
  const playing = (store && store.playing) || {};
  const cur = playing.curPlaying || {};
  const track = cur.track || {};
  const storeArtists = Array.isArray(playing.resourceArtists) ? playing.resourceArtists : [];
  const artistList = (Array.isArray(track.artists) ? track.artists : storeArtists)
    .map((item) => typeof item === 'string' ? item : (item && item.name) || '')
    .filter(Boolean);
  const storeTitle = String(track.name || playing.resourceName || '').trim();
  const storeArtist = artistList.join(' / ');
  const storeAlbum = String((track.album && track.album.name) || '');
  const coverUrl = String(
    (track.album && (track.album.picUrl || track.album.cover))
    || playing.resourceCoverUrl
    || ''
  ).trim().replace(/^http:/, 'https:');
  const rawDuration = Number(track.duration || 0);
  const storeDuration = Number(playing.resourceDuration || 0);
  const duration = rawDuration > 1000 ? rawDuration / 1000 : (storeDuration || rawDuration || 0);
  const storePlaying = Number(playing.playingState);

  const findAudio = () => {
    if (!req) return null;
    const cache = req.c || {};
    for (const id of Object.keys(cache)) {
      let exports;
      try { exports = cache[id] && cache[id].exports; } catch (error) { continue; }
      if (!exports) continue;
      const api = exports.a || exports;
      if (api && api.audioPlayerPlayProgress$
        && typeof api.audioPlayerPlayProgress$.subscribe === 'function') {
        return api;
      }
    }
    return null;
  };
  let audio = window.__dsh_cm_audio__;
  if (!audio || !audio.audioPlayerPlayProgress$) {
    const audioApi = (id) => {
      try {
        const module = req(id);
        const api = module && (module.a || module);
        return api && api.audioPlayerPlayProgress$
          && typeof api.audioPlayerPlayProgress$.subscribe === 'function'
          ? api : null;
      } catch (error) { return null; }
    };
    audio = audioApi(1195) || audioApi(12) || findAudio();
    if (audio) window.__dsh_cm_audio__ = audio;
  }
  const progressFrom = (value) => {
    let key = '';
    let seconds = null;
    if (Array.isArray(value) && value.length >= 2) {
      key = String(value[0] || '');
      seconds = Number(value[1]);
    } else if (value && typeof value === 'object') {
      key = String(value.key || value.trackId || '');
      seconds = Number(value.position ?? value.currentTime ?? value.seconds);
    } else if (typeof value === 'number') {
      seconds = value;
    }
    return key && Number.isFinite(seconds) ? { key, position: seconds } : null;
  };
  if (!window.__dsh_cm_progress_sub__ && audio
    && typeof audio.audioPlayerPlayProgress$.subscribe === 'function') {
    try {
      window.__dsh_cm_progress_sub__ = audio.audioPlayerPlayProgress$.subscribe((value) => {
        const next = progressFrom(value);
        if (next) window.__dsh_cm_progress__ = next;
      });
    } catch (error) {}
  }
  const currentProgress = () => {
    const cached = window.__dsh_cm_progress__;
    if (!cached || !track.id) return null;
    return String(cached.key).startsWith(String(track.id)) ? cached.position : null;
  };
  const readProgress = () => {
    const current = currentProgress();
    // NetEase's internal IAudioPlayer state uses 2 = playing, 1 = paused.
    if (!audio || storePlaying !== 2) return Promise.resolve(current);
    return new Promise((resolve) => {
      let done = false;
      let subscription = null;
      const finish = (value) => {
        if (done) return;
        done = true;
        try { subscription && subscription.unsubscribe(); } catch (error) {}
        const next = progressFrom(value);
        if (next) window.__dsh_cm_progress__ = next;
        resolve(next && track.id && next.key.startsWith(String(track.id))
          ? next.position
          : current);
      };
      try {
        subscription = audio.audioPlayerPlayProgress$.subscribe(finish);
      } catch (error) {
        finish(null);
        return;
      }
      setTimeout(() => finish(null), 500);
    });
  };

  // DOM is used only for the like control, which is not exposed by the store.
  // Pick a visible button so mini, expanded and comment-area layouts all work.
  const allLikeButtons = () => Array.from(
    document.querySelectorAll('button[data-testid="tid_redstar_btn"]')
  );
  const visibleLikeButtons = () => allLikeButtons().filter((button) => {
    const rect = button.getBoundingClientRect();
    const style = window.getComputedStyle(button);
    return rect.width > 0 && rect.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden';
  });
  const pickLikeButton = (requireEnabled) => {
    const all = allLikeButtons();
    const visible = visibleLikeButtons();
    const pool = visible.length ? visible : all;
    const enabled = pool.filter(
      (button) => button.getAttribute('aria-disabled') !== 'true'
    );
    return requireEnabled ? (enabled[0] || null) : (enabled[0] || pool[0] || null);
  };
  const readLiked = (button) => button
    ? (button.querySelector('[aria-label="likenumber_red"]') ? true
      : (button.querySelector('[aria-label="like_number"]') ? false : null))
    : null;

  // The webpack store is not always reachable (the runtime changed between
  // NetEase builds). The visible player bar still carries the same metadata,
  // progress and cover, so use it as a fallback instead of returning null.
  const domMedia = () => {
    const footer = document.querySelector('footer');
    const root = footer
      || document.querySelector('[data-testid="tid_playbar_controls"]')?.closest('footer')
      || document;
    const visibleRange = Array.from(root.querySelectorAll('input[type="range"]'))
      .find((candidate) => Number(candidate.max) > 5)
      || Array.from(document.querySelectorAll('input[type="range"]'))
        .find((candidate) => Number(candidate.max) > 5);
    const range = root.querySelector('.slider-default input[type="range"]')
      || visibleRange;
    const textOf = (node) => node ? (node.innerText || '').replace(/\s+/g, ' ').trim() : '';
    const firstText = (nodes) => {
      for (const node of nodes) {
        const text = textOf(node);
        if (text) return text;
      }
      return '';
    };
    // In the vinyl / comment layouts the footer collapses to 0px and its
    // minibar title is empty; the same track is rendered outside the footer.
    const title = firstText([
      root.querySelector('[data-testid="tid_minibar_title"] .main-title'),
      document.querySelector('[data-testid="tid_minibar_title"] .main-title'),
      ...document.querySelectorAll('.main-title'),
      ...document.querySelectorAll('[class*="TrackInfo"] .title')
    ]).replace(/\s+VIP\s*$/i, '').trim();
    const artist = firstText([
      root.querySelector('[data-testid="tid_minibar_title"] .author'),
      document.querySelector('[data-testid="tid_minibar_title"] .author'),
      ...document.querySelectorAll('.author'),
      ...document.querySelectorAll('[class*="TrackInfo"] .artist')
    ]);
    const playButton = root.querySelector('button[data-testid="tid_playbar_play_btn"]')
      || document.querySelector('button[data-testid="tid_playbar_play_btn"]');
    const playIcon = playButton && playButton.querySelector('[role="img"]');
    const playLabel = playIcon ? playIcon.getAttribute('aria-label') : null;
    const knownCovers = [
      root.querySelector('[data-testid="tid_btn_pc_minibar_vinyl"] img'),
      document.querySelector('[data-testid="tid_btn_pc_minibar_vinyl"] img'),
      document.querySelector('[data-testid="tid_vinylcover_cover"] img'),
      document.querySelector('[data-testid="tid_vinylcover_container"] img'),
      document.querySelector('[class*="TrackInfo"] img')
    ];
    const fallbackCovers = Array.from(document.images).filter((image) => {
      const rect = image.getBoundingClientRect();
      const source = image.currentSrc || image.src || '';
      return rect.width >= 40 && rect.height >= 40 && /music\.126\.net/.test(source);
    });
    const image = knownCovers.find((candidate) => {
      if (!candidate) return false;
      const rect = candidate.getBoundingClientRect();
      return rect.width >= 1 && rect.height >= 1;
    }) || fallbackCovers.find((candidate) => {
      const source = candidate.currentSrc || candidate.src || '';
      const parent = candidate.closest('[data-testid="tid_useravatar_click"], [data-testid="tid_comment_card"]');
      return !parent && /music\.126\.net/.test(source);
    }) || null;
    let cover = '';
    if (image) {
      cover = String(image.currentSrc || image.src || '')
        .replace(/^orpheus:\/\/cache\/\?/, '')
        .replace(/^http:\/\//, 'https://')
        .replace(/thumbnail=\d+y\d+/, 'thumbnail=300y300');
      if (!/^https?:\/\//.test(cover)) cover = '';
    }
    return {
      title,
      artist,
      cover,
      position: range ? Number(range.value) : null,
      duration: range ? Number(range.max) : null,
      playing: playLabel === 'pause' ? true : (playLabel === 'play' ? false : null)
    };
  };
"#;

/// Full CDP snapshot for the no-SMTC case. Store values win when available;
/// the player-bar DOM supplies the same fields after a page reload where the
/// webpack require cache is no longer reachable.
#[allow(dead_code)] // called by `cdp_media` on every platform.
const CDP_MEDIA_TEMPLATE: &str = r#"
(async () => {
__STORE_HELPER__
  const dom = domMedia();
  const position = (await readProgress()) ?? dom.position ?? null;
  const effectiveTitle = storeTitle || dom.title || '';
  const effectiveArtist = storeArtist || dom.artist || '';
  const effectiveDuration = duration || dom.duration || null;
  const effectiveCover = coverUrl || dom.cover || null;
  const effectivePlaying = storePlaying === 2 ? true
    : storePlaying === 1 ? false : (dom.playing ?? null);
  const likeButton = pickLikeButton(false);
  return {
    title: effectiveTitle,
    artist: effectiveArtist,
    album: storeAlbum,
    coverUrl: effectiveCover,
    position,
    duration: effectiveDuration,
    playing: effectivePlaying,
    liked: readLiked(likeButton),
    canLike: !!likeButton,
    canSetLiked: !!likeButton && likeButton.getAttribute('aria-disabled') !== 'true',
    canPlayPause: !!effectiveTitle,
    canNext: !!effectiveTitle,
    canPrevious: !!effectiveTitle
  };
})()
"#;

fn cdp_ports() -> Vec<u16> {
    if let Ok(value) = std::env::var("DSH_RC_NETEASE_CDP_PORT") {
        if let Ok(port) = value.trim().parse::<u16>() {
            if port > 0 {
                return vec![port];
            }
        }
    }
    // NetEase follows the Chromium switch; 2015 is the value documented by
    // the cloudmusic-patch project, 9222 is the common alternative.
    vec![CDP_DEFAULT_PORT, 9222]
}

fn http_get(port: u16, path: &str) -> Result<String, String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, CDP_CONNECT_TIMEOUT)
        .map_err(|error| format!("CDP connect 127.0.0.1:{port}: {error}"))?;
    let _ = stream.set_read_timeout(Some(CDP_IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(CDP_IO_TIMEOUT));
    let request =
        format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("CDP HTTP write: {error}"))?;
    let headers = read_http_headers(&mut stream)?;
    let content_length = headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        if name.eq_ignore_ascii_case("content-length") {
            value.trim().parse::<usize>().ok()
        } else {
            None
        }
    });
    let mut body = Vec::new();
    if let Some(length) = content_length {
        body.resize(length, 0);
        stream
            .read_exact(&mut body)
            .map_err(|error| format!("CDP HTTP body: {error}"))?;
    } else {
        stream
            .read_to_end(&mut body)
            .map_err(|error| format!("CDP HTTP read: {error}"))?;
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

fn cdp_websocket_url(port: u16) -> Result<String, String> {
    let body = http_get(port, "/json")?;
    let targets: Value =
        serde_json::from_str(&body).map_err(|error| format!("CDP target JSON: {error}"))?;
    let list = targets
        .as_array()
        .ok_or_else(|| "CDP target list is not an array".to_string())?;
    for target in list {
        let kind = target.get("type").and_then(Value::as_str).unwrap_or("");
        if kind != "page" {
            continue;
        }
        let url = target.get("url").and_then(Value::as_str).unwrap_or("");
        let title = target.get("title").and_then(Value::as_str).unwrap_or("");
        let ws = target
            .get("webSocketDebuggerUrl")
            .and_then(Value::as_str)
            .unwrap_or("");
        if ws.is_empty() {
            continue;
        }
        let is_netease = url.contains("orpheus")
            || url.contains("music.163.com")
            || title.contains("网易云")
            || title.contains("NetEase");
        if is_netease {
            return Ok(ws.to_string());
        }
    }
    Err("CDP has no NetEase page target".to_string())
}

struct CdpConnection {
    stream: TcpStream,
}

impl CdpConnection {
    fn connect(ws_url: &str) -> Result<Self, String> {
        let rest = ws_url
            .strip_prefix("ws://")
            .ok_or_else(|| format!("unsupported CDP URL: {ws_url}"))?;
        let (host_port, path) = rest.split_once('/').unwrap_or((rest, ""));
        let path = format!("/{path}");
        let address = host_port
            .to_socket_addrs()
            .map_err(|error| format!("CDP resolve {host_port}: {error}"))?
            .next()
            .ok_or_else(|| format!("CDP address not found: {host_port}"))?;
        let mut stream = TcpStream::connect_timeout(&address, CDP_CONNECT_TIMEOUT)
            .map_err(|error| format!("CDP websocket connect: {error}"))?;
        let _ = stream.set_read_timeout(Some(CDP_IO_TIMEOUT));
        let _ = stream.set_write_timeout(Some(CDP_IO_TIMEOUT));
        let key = websocket_key();
        let request = format!(
            "GET {path} HTTP/1.1\r\nHost: {host_port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        );
        stream
            .write_all(request.as_bytes())
            .map_err(|error| format!("CDP handshake write: {error}"))?;
        let headers = read_http_headers(&mut stream)?;
        if !headers.starts_with("HTTP/1.1 101") {
            return Err(format!(
                "CDP websocket rejected: {}",
                headers.lines().next().unwrap_or("")
            ));
        }
        Ok(Self { stream })
    }

    fn command(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let payload = json!({
            "id": 1,
            "method": method,
            "params": params,
        });
        write_ws_text(&mut self.stream, payload.to_string().as_bytes())?;
        for _ in 0..24 {
            let (opcode, fin, data) = read_ws_frame(&mut self.stream)?;
            if opcode == 0x8 {
                return Err("CDP websocket closed".to_string());
            }
            if opcode == 0x9 {
                write_ws_frame(&mut self.stream, 0xA, false, &data)?;
                continue;
            }
            if opcode != 0x1 || !fin {
                continue;
            }
            let message: Value = match serde_json::from_slice(&data) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if message.get("id").and_then(Value::as_i64) != Some(1) {
                continue;
            }
            if let Some(exception) = message.get("exceptionDetails") {
                return Err(format!("CDP evaluate failed: {exception}"));
            }
            return Ok(message.get("result").cloned().unwrap_or(Value::Null));
        }
        Err("CDP evaluate timed out".to_string())
    }

    fn evaluate(&mut self, expression: &str) -> Result<Value, String> {
        let result = self.command(
            "Runtime.evaluate",
            json!({
                "expression": expression,
                "returnByValue": true,
                "awaitPromise": true,
            }),
        )?;
        Ok(result
            .get("result")
            .and_then(|result| result.get("value"))
            .cloned()
            .unwrap_or(Value::Null))
    }

    /// Send Ctrl+L (NetEase's built-in like shortcut) to the renderer.
    fn press_like_shortcut(&mut self) -> Result<(), String> {
        self.command(
            "Input.dispatchKeyEvent",
            json!({
                "type": "rawKeyDown",
                "modifiers": 2,
                "key": "l",
                "code": "KeyL",
                "windowsVirtualKeyCode": 76,
                "nativeVirtualKeyCode": 76,
                "text": "\u{000c}",
                "unmodifiedText": "l",
            }),
        )?;
        self.command(
            "Input.dispatchKeyEvent",
            json!({
                "type": "keyUp",
                "modifiers": 2,
                "key": "l",
                "code": "KeyL",
                "windowsVirtualKeyCode": 76,
                "nativeVirtualKeyCode": 76,
            }),
        )?;
        Ok(())
    }
}

fn websocket_key() -> String {
    let now = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let seed = format!("{now}-{}-{}", std::process::id(), now.rotate_left(17));
    let mut bytes = [0u8; 16];
    for (index, byte) in seed.as_bytes().iter().take(16).enumerate() {
        bytes[index] = *byte;
    }
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn read_http_headers(stream: &mut TcpStream) -> Result<String, String> {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 1];
    while bytes.len() < 16 * 1024 {
        stream
            .read_exact(&mut buffer)
            .map_err(|error| format!("CDP handshake read: {error}"))?;
        bytes.push(buffer[0]);
        if bytes.ends_with(b"\r\n\r\n") {
            return Ok(String::from_utf8_lossy(&bytes).into_owned());
        }
    }
    Err("CDP handshake headers are too large".to_string())
}

fn write_ws_text(stream: &mut TcpStream, payload: &[u8]) -> Result<(), String> {
    write_ws_frame(stream, 0x1, true, payload)
}

fn write_ws_frame(
    stream: &mut TcpStream,
    opcode: u8,
    fin: bool,
    payload: &[u8],
) -> Result<(), String> {
    let mut frame = Vec::with_capacity(payload.len() + 14);
    frame.push(if fin { 0x80 | opcode } else { opcode });
    let mask_bit = 0x80;
    match payload.len() {
        length if length < 126 => frame.push(mask_bit | length as u8),
        length if length <= u16::MAX as usize => {
            frame.push(mask_bit | 126);
            frame.extend_from_slice(&(length as u16).to_be_bytes());
        }
        length => {
            frame.push(mask_bit | 127);
            frame.extend_from_slice(&(length as u64).to_be_bytes());
        }
    }
    let now = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u32)
        .unwrap_or(0);
    let mask = now.to_be_bytes();
    frame.extend_from_slice(&mask);
    frame.extend(
        payload
            .iter()
            .enumerate()
            .map(|(index, byte)| byte ^ mask[index % 4]),
    );
    stream
        .write_all(&frame)
        .map_err(|error| format!("CDP websocket write: {error}"))
}

fn read_ws_frame(stream: &mut TcpStream) -> Result<(u8, bool, Vec<u8>), String> {
    let mut header = [0u8; 2];
    stream
        .read_exact(&mut header)
        .map_err(|error| format!("CDP websocket read: {error}"))?;
    let fin = header[0] & 0x80 != 0;
    let opcode = header[0] & 0x0F;
    let masked = header[1] & 0x80 != 0;
    let mut length = (header[1] & 0x7F) as u64;
    if length == 126 {
        let mut extended = [0u8; 2];
        stream
            .read_exact(&mut extended)
            .map_err(|error| format!("CDP websocket read: {error}"))?;
        length = u16::from_be_bytes(extended) as u64;
    } else if length == 127 {
        let mut extended = [0u8; 8];
        stream
            .read_exact(&mut extended)
            .map_err(|error| format!("CDP websocket read: {error}"))?;
        length = u64::from_be_bytes(extended);
    }
    if length > 8 * 1024 * 1024 {
        return Err("CDP websocket frame is too large".to_string());
    }
    let mut mask = [0u8; 4];
    if masked {
        stream
            .read_exact(&mut mask)
            .map_err(|error| format!("CDP websocket read: {error}"))?;
    }
    let mut payload = vec![0u8; length as usize];
    stream
        .read_exact(&mut payload)
        .map_err(|error| format!("CDP websocket read: {error}"))?;
    if masked {
        for (index, byte) in payload.iter_mut().enumerate() {
            *byte ^= mask[index % 4];
        }
    }
    Ok((opcode, fin, payload))
}

/// Store-backed page identity, used to recognize a NetEase SMTC session that
/// exposes an auto-generated AUMID instead of `cloudmusic.exe`.
#[allow(dead_code)] // called by the Windows adapter; kept cross-platform.
const CDP_IDENTITY_TEMPLATE: &str = r#"
(() => {
__STORE_HELPER__
  const dom = domMedia();
  return {
    title: storeTitle || dom.title || '',
    artist: storeArtist || dom.artist || ''
  };
})()
"#;

fn cdp_identity_expression() -> String {
    CDP_IDENTITY_TEMPLATE.replace("__STORE_HELPER__", CDP_STORE_HELPER)
}

fn cdp_media_expression() -> String {
    CDP_MEDIA_TEMPLATE.replace("__STORE_HELPER__", CDP_STORE_HELPER)
}

fn cdp_state_expression() -> String {
    CDP_STATE_TEMPLATE.replace("__STORE_HELPER__", CDP_STORE_HELPER)
}

/// The current NetEase page title/artist, used to map an auto-generated SMTC
/// AUMID back to the NetEase profile.
#[allow(dead_code)] // used by the Windows adapter; kept cross-platform.
pub fn cdp_identity() -> Option<(String, String)> {
    let value = cdp_evaluate(&cdp_identity_expression()).ok()?;
    let object = value.as_object()?;
    let title = object
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let artist = object
        .get("artist")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if title.is_empty() && artist.is_empty() {
        None
    } else {
        Some((title, artist))
    }
}

fn parse_cdp_track(value: &Value) -> Option<CdpTrack> {
    let object = value.as_object()?;
    let string = |key: &str| {
        object
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let number = |key: &str| {
        object
            .get(key)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
    };
    let flag = |key: &str| object.get(key).and_then(Value::as_bool).unwrap_or(false);
    let title = string("title");
    let artist = string("artist");
    if title.is_empty() && artist.is_empty() {
        return None;
    }
    Some(CdpTrack {
        title,
        artist,
        album: string("album"),
        cover_url: object
            .get("coverUrl")
            .and_then(Value::as_str)
            .filter(|value| value.starts_with("http://") || value.starts_with("https://"))
            .map(str::to_string),
        position: number("position").filter(|value| *value >= 0.0),
        duration: number("duration").filter(|value| *value > 0.0),
        playing: object.get("playing").and_then(Value::as_bool),
        liked: object.get("liked").and_then(Value::as_bool),
        can_like: flag("canLike"),
        can_set_liked: flag("canSetLiked"),
        can_play_pause: flag("canPlayPause"),
        can_next: flag("canNext"),
        can_previous: flag("canPrevious"),
    })
}

/// Read the complete NetEase page state. Used only when SMTC is unavailable;
/// with SMTC present the page contributes progress/liked while metadata, cover
/// and transport stay on the system session.
#[allow(dead_code)] // called by `merge` on every platform; kept cross-platform.
pub fn cdp_media() -> Option<Media> {
    let value = cdp_evaluate(&cdp_media_expression()).ok()?;
    let track = parse_cdp_track(&value)?;
    let duration = track.duration.unwrap_or(0.0);
    let mut media = Media::new("cloudmusic.exe");
    media.provider = "private".to_string();
    media.provider_detail = "netease-cdp".to_string();
    media.title = track.title;
    media.artist = track.artist;
    media.album = track.album;
    media.playback_status = match track.playing {
        Some(true) => "Playing".to_string(),
        _ => "Paused".to_string(),
    };
    media.position = track.position.unwrap_or(0.0).max(0.0);
    media.start_time = 0.0;
    media.end_time = duration;
    media.min_seek_time = 0.0;
    media.max_seek_time = duration;
    media.last_updated_at = util::now_ms();
    media.can_play_pause = track.can_play_pause;
    media.can_next = track.can_next;
    media.can_previous = track.can_previous;
    // CDP-only has no SMTC timeline. The page slider is still used for direct
    // transport control, but only an explicitly seekable SMTC session may
    // report a seekable timeline to the client.
    media.can_seek = false;
    media.thumbnail_url = track.cover_url;
    media.liked = track.liked;
    media.can_like = track.can_like;
    media.can_set_liked = track.can_set_liked;
    Some(media)
}

/// Transport control through the NetEase page when there is no SMTC session.
#[allow(dead_code)] // called by the platform control paths; kept cross-platform.
pub fn cdp_control(action: &str, position: f64) -> Result<(), String> {
    let position = if position.is_finite() {
        position.max(0.0)
    } else {
        0.0
    };
    let expression = match action {
        "playpause" => "(() => { const button = document.querySelector('button[data-testid=\"tid_playbar_play_btn\"]'); if (!button) return false; button.click(); return true; })()".to_string(),
        "next" => "(() => { const button = document.querySelector('button[data-testid=\"tid_playbar_next_btn\"]'); if (!button) return false; button.click(); return true; })()".to_string(),
        "previous" => "(() => { const button = document.querySelector('button[data-testid=\"tid_playbar_prev_btn\"]'); if (!button) return false; button.click(); return true; })()".to_string(),
        "seek" => format!(
            r#"(() => {{
  const range = document.querySelector('footer .slider-default input[type="range"]')
    || document.querySelector('footer input[type="range"]');
  if (!range) return false;
  const max = Number(range.max);
  if (!(max > 0)) return false;
  const value = Math.max(0, Math.min(max, {position}));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(range, String(value));
  range.dispatchEvent(new Event('input', {{bubbles: true}}));
  range.dispatchEvent(new Event('change', {{bubbles: true}}));
  return true;
}})()"#
        ),
        other => return Err(format!("unsupported CDP media action: {other}")),
    };
    let value = cdp_evaluate(&expression)?;
    if value.as_bool() == Some(true) {
        Ok(())
    } else {
        Err(format!("NetEase CDP could not perform {action}"))
    }
}

fn parse_cdp_state(value: &Value) -> Option<CdpState> {
    let object = value.as_object()?;
    let number = |key: &str| {
        object
            .get(key)
            .and_then(Value::as_f64)
            .filter(|value| value.is_finite())
    };
    let flag = |key: &str| object.get(key).and_then(Value::as_bool).unwrap_or(false);
    let state = CdpState {
        position: number("position").filter(|value| *value >= 0.0),
        duration: number("duration").filter(|value| *value > 0.0),
        liked: object.get("liked").and_then(Value::as_bool),
        can_like: flag("canLike"),
        can_set_liked: flag("canSetLiked"),
    };
    if state.position.is_none() && state.duration.is_none() && state.liked.is_none() {
        return None;
    }
    Some(state)
}

/// Read progress/liked state from the NetEase CDP page, if the client exposes
/// a debugging port. `None` means "CDP unavailable or no play bar", and the
/// platform adapter must use the now-playing-service fallback.
#[allow(dead_code)] // called by the platform adapters; kept cross-platform.
pub fn cdp_state() -> Option<CdpState> {
    cdp_state_result().ok()
}

fn cdp_target() -> Result<(u16, String), String> {
    let mut errors = Vec::new();
    for port in cdp_ports() {
        match cdp_websocket_url(port) {
            Ok(url) => return Ok((port, url)),
            Err(error) => errors.push(format!("{port}: {error}")),
        }
    }
    Err(format!(
        "NetEase CDP is unavailable ({})",
        errors.join("; ")
    ))
}

fn cdp_evaluate(expression: &str) -> Result<Value, String> {
    let (_port, websocket_url) = cdp_target()?;
    let mut connection = CdpConnection::connect(&websocket_url)
        .map_err(|error| format!("CDP websocket failed: {error}"))?;
    connection
        .evaluate(expression)
        .map_err(|error| format!("CDP evaluate failed: {error}"))
}

/// Same as [`cdp_state`] but preserves the failure reason for diagnostics.
pub fn cdp_state_result() -> Result<CdpState, String> {
    let value = cdp_evaluate(&cdp_state_expression())?;
    parse_cdp_state(&value)
        .ok_or_else(|| format!("CDP page returned no play-bar state: {}", value.to_string()))
}

/// Diagnostic payload for `media cdp`.
pub fn cdp_diagnostic() -> Value {
    match cdp_state_result() {
        Ok(state) => {
            let full = cdp_media().map(|media| {
                json!({
                    "title": media.title,
                    "artist": media.artist,
                    "album": media.album,
                    "hasCover": media.thumbnail.is_some() || media.thumbnail_url.is_some(),
                    "thumbnailType": media.thumbnail_type,
                    "position": media.position,
                    "duration": media.end_time,
                    "playbackStatus": media.playback_status,
                    "canPlayPause": media.can_play_pause,
                    "canNext": media.can_next,
                    "canPrevious": media.can_previous,
                    "canSeek": media.can_seek,
                    "liked": media.liked,
                    "canLike": media.can_like,
                    "canSetLiked": media.can_set_liked,
                })
            });
            json!({
                "ok": true,
                "state": {
                    "position": state.position,
                    "duration": state.duration,
                    "liked": state.liked,
                    "canLike": state.can_like,
                    "canSetLiked": state.can_set_liked,
                },
                "full": full,
                "ports": cdp_ports(),
            })
        }
        Err(error) => json!({
            "ok": false,
            "error": error,
            "ports": cdp_ports(),
        }),
    }
}

/// Vendor-first NetEase entry point: combine the system session (metadata and
/// transport status) with the CDP page (exact progress and liked state), and
/// fall back to UIA/title only when needed.
#[allow(dead_code)] // called by `vendor::resolve` from every platform adapter.
pub fn merge(
    platform: Platform,
    system: Option<Media>,
    private: Option<Media>,
    fallback: impl FnOnce() -> Option<(f64, f64)>,
) -> Option<Media> {
    let system_has_metadata = system
        .as_ref()
        .map(|media| !media.title.trim().is_empty() || !media.artist.trim().is_empty())
        .unwrap_or(false);

    // No usable system session: the page is the complete source when CDP is
    // available (metadata, cover, progress, liked state and transport).
    if !system_has_metadata {
        if let Some(media) = cdp_media() {
            return Some(media);
        }
    }

    let mut fallback = Some(fallback);
    let mut media = if system_has_metadata {
        system?
    } else {
        // Neither system metadata nor CDP: keep the original private/UIA path.
        // If that also yields nothing the caller receives `None` (empty media).
        private?
    };
    resolve(
        platform,
        &mut media,
        fallback.take().expect("fallback is consumed once"),
    );
    Some(media)
}

/// Whether the system branch has a usable, seek-capable timeline. Windows uses
/// the catalog policy; MPRIS/Now Playing are accepted when they expose a real
/// timeline and `CanSeek`.
fn system_valid(_platform: Platform, media: &Media) -> bool {
    // Vendor modules may call the selected platform's common system API
    // directly; windows.rs/linux.rs/macos.rs supply the same validity rule.
    super::super::platform::system_valid(media)
}

/// Resolve NetEase's progress/liked state. This is the single entry point each
/// platform adapter calls after it identifies the app as NetEase:
///
/// 1. CDP when the client was launched with a remote-debugging port,
/// 2. otherwise the caller-provided accessibility fallback (`MM:SS | MM:SS`),
/// 3. otherwise leave the system metadata alone.
///
/// With a valid MPRIS/Now Playing session, transport seeking stays on the
/// system API; with Windows SMTC (MetadataOnly) it is disabled. Liked state is
/// never read from the local database; it is CDP-only.
#[allow(dead_code)] // called by vendor::resolve on every platform.
pub fn resolve(
    platform: Platform,
    media: &mut Media,
    fallback: impl FnOnce() -> Option<(f64, f64)>,
) {
    let seekable_system = system_valid(platform, media);
    if apply_cdp(media, seekable_system) {
        return;
    }
    if let Some((position, total)) = fallback() {
        if total > 0.0 {
            media.position = position;
            media.start_time = 0.0;
            media.end_time = total;
            media.min_seek_time = 0.0;
            media.max_seek_time = total;
            media.provider_detail = if media.provider_detail.starts_with("smtc") {
                "smtc+uia".to_string()
            } else {
                format!("{}+uia", media.provider_detail)
            };
        }
    }
    if !seekable_system {
        media.can_seek = false;
    }
    media.last_updated_at = util::now_ms();
}

#[allow(dead_code)] // called by `resolve` on every platform.
fn apply_cdp(media: &mut Media, seekable_system: bool) -> bool {
    let Some(state) = cdp_state() else {
        return false;
    };
    if let Some(position) = state.position {
        media.position = position;
    }
    if let Some(duration) = state.duration {
        media.start_time = 0.0;
        media.end_time = duration;
        media.min_seek_time = 0.0;
        media.max_seek_time = duration;
    }
    media.liked = state.liked;
    media.can_like = state.can_like;
    media.can_set_liked = state.can_set_liked;
    // Windows SMTC has no progress timeline and must not grant seek. MPRIS/Now
    // Playing can keep their seek grant while CDP supplies exact progress.
    if !seekable_system {
        media.can_seek = false;
    }
    media.provider_detail = if media.provider_detail.starts_with("smtc") {
        "smtc+cdp".to_string()
    } else {
        format!("{}+cdp", media.provider_detail)
    };
    media.last_updated_at = util::now_ms();
    true
}

/// Toggle/set the red-heart state through CDP. The client's Ctrl+L shortcut is
/// sent first (layout-independent); a visible button click is only a fallback
/// when key dispatch itself fails. Returns the settled state.
#[allow(dead_code)] // called by every platform media control path.
pub fn cdp_set_liked(liked: Option<bool>) -> Result<CdpState, String> {
    let (_port, websocket_url) = cdp_target()?;
    let mut connection = CdpConnection::connect(&websocket_url)?;
    let current_value = connection.evaluate(&cdp_state_expression())?;
    let current = parse_cdp_state(&current_value)
        .ok_or_else(|| "NetEase CDP page did not expose a play bar".to_string())?;
    let target = match liked {
        Some(target) => {
            if current.liked.is_none() {
                return Err("NetEase liked state is unknown; cannot set it safely".to_string());
            }
            target
        }
        None => current
            .liked
            .map(|value| !value)
            .ok_or_else(|| "NetEase liked state is unknown".to_string())?,
    };
    if current.liked == Some(target) {
        return Ok(current);
    }
    if !current.can_set_liked {
        return Err("NetEase like button is disabled".to_string());
    }
    // Prefer the client's own Ctrl+L shortcut. It targets the app's like
    // handler instead of relying on a particular DOM button/layout.
    if let Err(shortcut_error) = connection.press_like_shortcut() {
        let click_result = connection.evaluate(CDP_CLICK_LIKE_EXPRESSION)?;
        if click_result.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(format!(
                "NetEase CDP could not send Ctrl+L ({shortcut_error}) or find the like button"
            ));
        }
    }
    let mut last = current;
    for _ in 0..20 {
        std::thread::sleep(Duration::from_millis(200));
        if let Ok(value) = connection.evaluate(&cdp_state_expression()) {
            if let Some(state) = parse_cdp_state(&value) {
                last = state;
                if state.liked == Some(target) {
                    return Ok(state);
                }
            }
        }
    }
    Err(format!(
        "NetEase CDP did not apply liked={target} (last={:?})",
        last.liked
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "reads the live NetEase CDP page"]
    fn cdp_identity_returns_title_and_artist() {
        let (title, artist) = cdp_identity().expect("NetEase must be running with CDP");
        assert!(!title.trim().is_empty());
        assert!(!artist.trim().is_empty());
    }

    #[test]
    #[ignore = "reads the live NetEase CDP page"]
    fn cdp_only_merge_returns_full_page_media() {
        let media = merge(Platform::Windows, None, None, || None)
            .expect("NetEase must be running with CDP");
        assert!(!media.title.trim().is_empty());
        assert_eq!(media.provider, "private");
        assert_eq!(media.provider_detail, "netease-cdp");
        assert!(media.thumbnail.is_some());
        assert!(media.can_play_pause);
        assert!(!media.can_seek);
        assert!(media.end_time > 0.0);
    }

    #[test]
    #[ignore = "controls the live NetEase CDP page"]
    fn cdp_only_control_seek_is_safe() {
        let media = merge(Platform::Windows, None, None, || None)
            .expect("NetEase must be running with CDP");
        cdp_control("seek", media.position).expect("CDP seek must apply");
    }

    #[test]
    fn parses_cdp_progress_and_liked_state() {
        let value = json!({
            "position": 21.012,
            "duration": 103.0,
            "liked": true,
            "canLike": true,
            "canSetLiked": true
        });
        let state = parse_cdp_state(&value).unwrap();
        assert!((state.position.unwrap() - 21.012).abs() < 0.001);
        assert!((state.duration.unwrap() - 103.0).abs() < 0.001);
        assert_eq!(state.liked, Some(true));
        assert!(state.can_like);
        assert!(state.can_set_liked);
        assert!(parse_cdp_state(&json!({ "liked": null })).is_none());
    }

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
    }

    #[test]
    fn unmatched_track_is_none() {
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
        assert!(
            local.cover.is_some(),
            "live cover should be found in Statics"
        );
        let mut media = Media::new("cloudmusic.exe");
        media.title = title;
        media.artist = artist;
        media.end_time = 0.0;
        enrich(&mut media);
        assert!(media.track_id.is_some());
    }
}
