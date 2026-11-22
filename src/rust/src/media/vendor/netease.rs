//! NetEase Cloud Music vendor adapter: CDP bridge and window-title parser.
//!
//! The CDP bridge reads the page's webpack store (never the DOM) for title,
//! artist, album, cover URL, track id, playback state and progress, plus the
//! client's liked-track id list for the heart state. Cover bytes are taken from
//! the image the page already loaded and encoded as a `data:` URL inside the
//! page, so neither the probe nor the Node bridge downloads or caches artwork.
//! The player-bar DOM is only the fallback for progress, playback status and the
//! like control. The window title and UI Automation remain the fallback when CDP
//! is unavailable. The bridge never writes to the client, never calls a network
//! API and never extracts cookies.
//!
//! When the client was launched with `/remote-debugging-port=<port>` (or
//! `--remote-debugging-port=<port>`, default port `2015`), the CDP bridge also
//! supplies:
//!
//! - with a usable system session: exact playback progress, duration and liked
//!   state, while the system session keeps its transport and seek policy;
//! - without a system session: the full media snapshot (title, artist, album,
//!   cover URL, playback state and progress) plus play/pause and next/previous,
//!   but no seek grant;
//! - the like button state and click, which the client store does not expose.
//!
//! Without CDP, liked state stays `null` and progress falls back to the
//! platform's window-title / UI Automation text.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, SystemTime};

use base64::Engine as _;
use serde_json::{json, Value};

use super::common;
use super::Platform;
use crate::media::catalog::{self, ParsedTitle};
use crate::media::Media;
use crate::util;

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

/// Live state read from the NetEase page through the Chromium DevTools
/// Protocol. Only available when the client was started with
/// `/remote-debugging-port=<port>` (or `--remote-debugging-port=<port>`).
#[derive(Debug, Clone, Default)]
pub struct CdpState {
    pub track_id: Option<String>,
    pub position: Option<f64>,
    pub duration: Option<f64>,
    pub liked: Option<bool>,
    /// `store` when the liked state came from the webpack store, `dom` when it
    /// fell back to the player-bar button. Diagnostics only.
    pub liked_source: Option<String>,
    pub can_like: bool,
    pub can_set_liked: bool,
}

/// Full media snapshot used only when NetEase has no SMTC session at all.
/// The page is then the only source, so it also supplies metadata, cover art
/// and transport availability.
#[derive(Debug, Clone, Default)]
struct CdpTrack {
    track_id: Option<String>,
    title: String,
    artist: String,
    album: String,
    cover_url: Option<String>,
    /// Cover bytes already loaded by the client, encoded as a `data:` URL by
    /// the page. Never downloaded by the probe or the Node bridge.
    cover_data_url: Option<String>,
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
/// The page encodes the loaded cover itself; anything past this is not a
/// credible cover and would only bloat the probe payload. The page caps the
/// source image at 1.2 MB, so a valid base64 payload stays below this limit.
const CDP_COVER_DATA_URL_MAX: usize = 1_700_000;

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
  const domLiked = readLiked(button);
  const liked = likedFromStore !== null ? likedFromStore : domLiked;
  return {
    trackId: track.id ? String(track.id) : null,
    position,
    duration: effectiveDuration,
    liked,
    likedSource: likedFromStore !== null ? 'store' : (domLiked !== null ? 'dom' : null),
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
/// instead of hard-coding one id. Liked state comes from `likeTrackIds` and the
/// cover bytes from the page's image cache; the player bar remains only the
/// fallback for progress, playback status and the like control.
const CDP_STORE_HELPER: &str = r#"
  const req = (() => {
    if (window.__dsh_cm_require__) return window.__dsh_cm_require__;
    try {
      const jsonp = window.webpackJsonp;
      if (!jsonp || typeof jsonp.push !== 'function') return null;
      // Webpack 4 stores the module factory on push; the third argument lists
      // the modules to execute once installed. Without it the factory is
      // registered but never runs, so `require` is never captured.
      jsonp.push([
        [987660],
        { 987660: function(module, exports, require) {
          window.__dsh_cm_require__ = require;
        } },
        [[987660]]
      ]);
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
  const rawCoverUrl = String(
    (track.album && (track.album.picUrl || track.album.cover))
    || playing.resourceCoverUrl
    || ''
  ).trim();
  const coverUrl = rawCoverUrl.replace(/^http:/, 'https:');
  const rawDuration = Number(track.duration || 0);
  const storeDuration = Number(playing.resourceDuration || 0);
  const duration = rawDuration > 1000 ? rawDuration / 1000 : (storeDuration || rawDuration || 0);
  const storePlaying = Number(playing.playingState);
  const hostResource = (store && store['async:hostResource']) || {};
  const likeTrackIds = Array.isArray(hostResource.likeTrackIds) ? hostResource.likeTrackIds : null;
  const currentTrackId = track.id ? String(track.id) : '';
  // The client keeps every liked track id here and updates it once the like
  // request settles. An empty list means "not hydrated yet" rather than
  // "nothing liked", so it falls back to the player-bar button.
  const likedFromStore = likeTrackIds && likeTrackIds.length && currentTrackId
    ? likeTrackIds.some((value) => String(value) === currentTrackId)
    : null;

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

  const sniffImageMime = (bytes) => {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg';
    }
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50
      && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png';
    }
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
      return 'image/bmp';
    }
    if (bytes.length >= 12 && bytes[0] === 0x47 && bytes[1] === 0x49
      && bytes[2] === 0x46 && bytes[3] === 0x38) {
      return 'image/gif';
    }
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49
      && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57
      && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      return 'image/webp';
    }
    return null;
  };
  const bytesToBase64 = (bytes) => {
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
  };
  const coverCacheKey = String(
    (track.album && (track.album.picId || track.album.picUrl)) || rawCoverUrl || ''
  );
  // Prefer a large cover of this album that the page already rendered;
  // otherwise ask the client's own image cache (`orpheus://cache`) for the same
  // 336px variant its UI uses. The probe never downloads the image itself.
  const coverSourceUrls = () => {
    const picId = String((track.album && track.album.picId) || '');
    const fileName = (rawCoverUrl.split('/').pop() || '').split('?')[0];
    const match = picId || fileName;
    const loaded = match
      ? Array.from(document.images)
        .filter((img) => img.naturalWidth >= 300
          && String(img.currentSrc || img.src || '').includes(match))
        .sort((left, right) => right.naturalWidth - left.naturalWidth)
        .map((img) => img.currentSrc || img.src)
      : [];
    if (!rawCoverUrl) return loaded;
    const separator = rawCoverUrl.includes('?') ? '&' : '?';
    const cached = 'orpheus://cache/?' + rawCoverUrl + separator
      + 'imageView=&thumbnail=336y336&type=webp&rotate=0&tostatic=0';
    return loaded.concat(cached);
  };
  const readCoverDataUrl = () => {
    if (!coverCacheKey) return Promise.resolve(null);
    const state = window.__dsh_cm_cover__ || (window.__dsh_cm_cover__ = {});
    if (state.key !== coverCacheKey) {
      state.key = coverCacheKey;
      state.dataUrl = null;
      state.pending = null;
      state.failedAt = 0;
    }
    if (state.dataUrl) return Promise.resolve(state.dataUrl);
    if (state.failedAt && Date.now() - state.failedAt < 30000) return Promise.resolve(null);
    if (state.pending) return state.pending;
    const key = coverCacheKey;
    let task = null;
    task = (async () => {
      for (const source of coverSourceUrls()) {
        let timer = null;
        try {
          const controller = new AbortController();
          timer = setTimeout(() => controller.abort(), 2500);
          const response = await fetch(source, { signal: controller.signal });
          if (!response.ok) continue;
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (!bytes.length || bytes.length > 1200000) continue;
          // The track may have changed while the image was loading.
          if (state.key !== key) return null;
          const mime = sniffImageMime(bytes) || 'image/jpeg';
          state.dataUrl = 'data:' + mime + ';base64,' + bytesToBase64(bytes);
          return state.dataUrl;
        } catch (error) {
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      if (state.key === key) state.failedAt = Date.now();
      return null;
    })().then((dataUrl) => {
      if (state.pending === task) state.pending = null;
      return dataUrl;
    }, () => {
      if (state.pending === task) state.pending = null;
      return null;
    });
    state.pending = task;
    return task;
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

  // The player bar supplies progress and playback status only; track, album
  // and cover are read from the webpack store.
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
    const playButton = root.querySelector('button[data-testid="tid_playbar_play_btn"]')
      || document.querySelector('button[data-testid="tid_playbar_play_btn"]');
    const playIcon = playButton && playButton.querySelector('[role="img"]');
    const playLabel = playIcon ? playIcon.getAttribute('aria-label') : null;
    return {
      position: range ? Number(range.value) : null,
      duration: range ? Number(range.max) : null,
      playing: playLabel === 'pause' ? true : (playLabel === 'play' ? false : null)
    };
  };
"#;

/// Full CDP snapshot for the no-SMTC case. Track, album and the cover reference
/// come from the webpack store; cover bytes come from the page's loaded image and
/// the player bar is only a progress/status fallback.
#[allow(dead_code)] // called by `cdp_media` on every platform.
const CDP_MEDIA_TEMPLATE: &str = r#"
(async () => {
__STORE_HELPER__
  const dom = domMedia();
  const coverPromise = readCoverDataUrl();
  const position = (await readProgress()) ?? dom.position ?? null;
  // Track, album and the cover reference come from the webpack store; the
  // cover bytes are encoded by the page, and the player-bar DOM is used only
  // for progress, playback status and the like control.
  const effectiveTitle = storeTitle;
  const effectiveArtist = storeArtist;
  const effectiveDuration = duration || dom.duration || null;
  const effectiveCover = coverUrl || null;
  const effectivePlaying = storePlaying === 2 ? true
    : storePlaying === 1 ? false : (dom.playing ?? null);
  const likeButton = pickLikeButton(false);
  const domLiked = readLiked(likeButton);
  const liked = likedFromStore !== null ? likedFromStore : domLiked;
  // Wait briefly for a first cover load; a slow cache entry is picked up by the
  // next poll instead of blocking the snapshot.
  await Promise.race([coverPromise, new Promise((resolve) => setTimeout(resolve, 700))]);
  const coverState = window.__dsh_cm_cover__;
  const coverDataUrl = coverState && coverState.key === coverCacheKey
    ? (coverState.dataUrl || null)
    : null;
  return {
    trackId: track.id ? String(track.id) : null,
    title: effectiveTitle,
    artist: effectiveArtist,
    album: storeAlbum,
    coverUrl: effectiveCover,
    coverDataUrl,
    position,
    duration: effectiveDuration,
    playing: effectivePlaying,
    liked,
    likedSource: likedFromStore !== null ? 'store' : (domLiked !== null ? 'dom' : null),
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

/// MIME type of a `data:<mime>;base64,` URL, if it is an image.
fn data_url_mime(value: &str) -> Option<String> {
    let rest = value.strip_prefix("data:")?;
    let (mime, payload) = rest.split_once(";base64,")?;
    if mime.starts_with("image/") && !payload.is_empty() {
        Some(mime.to_string())
    } else {
        None
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
        track_id: Some(string("trackId")).filter(|value| !value.is_empty()),
        title,
        artist,
        album: string("album"),
        cover_url: object
            .get("coverUrl")
            .and_then(Value::as_str)
            .filter(|value| value.starts_with("http://") || value.starts_with("https://"))
            .map(str::to_string),
        cover_data_url: object
            .get("coverDataUrl")
            .and_then(Value::as_str)
            .filter(|value| {
                value.starts_with("data:image/")
                    && value.len() <= CDP_COVER_DATA_URL_MAX
                    && data_url_mime(value).is_some()
            })
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
    media.thumbnail_type = track.cover_data_url.as_deref().and_then(data_url_mime);
    media.thumbnail = track.cover_data_url;
    media.thumbnail_url = track.cover_url;
    media.track_id = track.track_id;
    media.liked = track.liked;
    media.can_like = track.can_like;
    media.can_set_liked = track.can_set_liked;
    Some(media)
}

/// NetEase transport dispatch. A complete system session wins; a CDP-only page
/// or a target whose system session is absent/another app uses the CDP page.
#[allow(dead_code)] // called by vendor::control on every platform.
pub fn control(
    _platform: Platform,
    action: &str,
    position: f64,
    current: Option<&Media>,
    system: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let current_is_netease = current
        .and_then(catalog::profile_for_media)
        .map(|profile| profile.app == crate::media::catalog::App::Netease)
        .unwrap_or_else(|| {
            current
                .map(|media| is_netease(&media.app_id))
                .unwrap_or(false)
        });
    let cdp_provider = current
        .map(|media| media.provider_detail.contains("cdp"))
        .unwrap_or(true);
    if current_is_netease && !cdp_provider {
        return system();
    }
    match cdp_control(action, position) {
        Ok(()) => Ok(()),
        Err(cdp_error) => {
            if current_is_netease {
                system()
            } else {
                Err(cdp_error)
            }
        }
    }
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
    let track_id = object
        .get("trackId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let state = CdpState {
        track_id,
        position: number("position").filter(|value| *value >= 0.0),
        duration: number("duration").filter(|value| *value > 0.0),
        liked: object.get("liked").and_then(Value::as_bool),
        liked_source: object
            .get("likedSource")
            .and_then(Value::as_str)
            .filter(|value| *value == "store" || *value == "dom")
            .map(str::to_string),
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
                    "trackId": media.track_id,
                    "title": media.title,
                    "artist": media.artist,
                    "album": media.album,
                    "hasCover": media.thumbnail.is_some() || media.thumbnail_url.is_some(),
                    "thumbnailType": media.thumbnail_type,
                    "thumbnailFromPage": media.thumbnail.is_some(),
                    "coverUrl": media.thumbnail_url,
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
                    "trackId": state.track_id,
                    "position": state.position,
                    "duration": state.duration,
                    "liked": state.liked,
                    "likedSource": state.liked_source,
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

/// Whether the system branch has a usable, seek-capable timeline. The catalog
/// policy is shared by every platform, so VerifyPosition applies everywhere.
fn system_valid(_platform: Platform, media: &Media) -> bool {
    catalog::system_valid(media)
}

/// Resolve NetEase's progress/liked state. This is the single entry point each
/// platform adapter calls after it identifies the app as NetEase:
///
/// 1. CDP when the client was launched with a remote-debugging port,
/// 2. otherwise the caller-provided accessibility fallback (`MM:SS | MM:SS`),
/// 3. otherwise leave the system metadata alone.
///
/// With a complete system API, metadata, playback state, transport and the
/// timeline stay on the system session; CDP only supplies the like control. If
/// the system session is incomplete or missing, CDP/fallback fills the missing
/// progress. Liked state is never read from the local database.
#[allow(dead_code)] // called by vendor::resolve on every platform.
pub fn resolve(
    platform: Platform,
    media: &mut Media,
    fallback: impl FnOnce() -> Option<(f64, f64)>,
) {
    let seekable_system = system_valid(platform, media);
    if seekable_system {
        // Complete system session: only supplement the like control. Do not
        // replace its progress/status with CDP or the accessibility fallback.
        apply_cdp(media, true);
        return;
    }
    if apply_cdp(media, false) {
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
    if media.track_id.is_none() {
        media.track_id = state.track_id.clone();
    }
    if seekable_system {
        // A complete SMTC/MPRIS session wins for metadata, playback state and
        // timeline. CDP is consulted only for the like control, which the
        // system API does not expose.
        media.liked = state.liked;
        media.can_like = state.can_like;
        media.can_set_liked = state.can_set_liked;
        media.last_updated_at = util::now_ms();
        return true;
    }
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
    media.can_seek = false;
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
                last = state.clone();
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
            "trackId": "42",
            "position": 21.012,
            "duration": 103.0,
            "liked": true,
            "likedSource": "store",
            "canLike": true,
            "canSetLiked": true
        });
        let state = parse_cdp_state(&value).unwrap();
        assert_eq!(state.track_id.as_deref(), Some("42"));
        assert!((state.position.unwrap() - 21.012).abs() < 0.001);
        assert!((state.duration.unwrap() - 103.0).abs() < 0.001);
        assert_eq!(state.liked, Some(true));
        assert_eq!(state.liked_source.as_deref(), Some("store"));
        assert!(state.can_like);
        assert!(state.can_set_liked);
        assert!(parse_cdp_state(&json!({ "liked": null })).is_none());
    }

    #[test]
    fn parses_cdp_cover_data_url() {
        let value = json!({
            "title": "晴天",
            "artist": "周杰伦",
            "coverUrl": "https://p1.music.126.net/cover.jpg",
            "coverDataUrl": "data:image/webp;base64,AAAA"
        });
        let track = parse_cdp_track(&value).unwrap();
        assert_eq!(
            track.cover_data_url.as_deref(),
            Some("data:image/webp;base64,AAAA")
        );

        let invalid = json!({
            "title": "晴天",
            "coverDataUrl": "data:text/html;base64,AAAA"
        });
        assert!(parse_cdp_track(&invalid).unwrap().cover_data_url.is_none());
    }

    #[test]
    fn extracts_image_mime_from_data_url() {
        assert_eq!(
            data_url_mime("data:image/jpeg;base64,AAAA").as_deref(),
            Some("image/jpeg")
        );
        assert!(data_url_mime("data:text/plain;base64,AAAA").is_none());
        assert!(data_url_mime("data:image/webp;base64,").is_none());
        assert!(data_url_mime("https://p1.music.126.net/cover.jpg").is_none());
    }

    #[test]
    fn parses_netease_window_title() {
        let parsed = parse_title("晴天 - 周杰伦 - 网易云音乐").unwrap();
        assert_eq!(parsed.title, "晴天");
        assert_eq!(parsed.artist, "周杰伦");
        assert!(parse_title("网易云音乐").is_none());
    }

    #[test]
    fn identifies_netease_app_ids() {
        assert!(is_netease("cloudmusic.exe"));
        assert!(is_netease("com.netease.163music"));
        assert!(!is_netease("MSEdge"));
    }
}
