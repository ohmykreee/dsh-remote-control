//! Vendor-specific local integrations.
//!
//! Each child module reads one third-party desktop client's local state (never
//! its network API): window titles, Cider's title file, NetEase's SQLite
//! database, etc. Keep this folder for vendor-only code so the generic media /
//! notification / performance probes stay platform-focused.

use crate::media::catalog::{App, ParsedTitle};
use crate::media::Media;

/// Which system branch a vendor adapter is running on. Vendor modules use this
/// to pick the matching system-API rule (WinRT SMTC, MPRIS, Now Playing) while
/// keeping all client-specific logic in one file.
#[allow(dead_code)] // every platform constructs only its own variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    Linux,
    MacOS,
}

pub mod apple_music;
pub mod common;
pub mod kugou;
pub mod kuwo;
pub mod netease;
pub mod qishui;
pub mod qqmusic;
pub mod spotify;
pub mod wesing;
pub mod youtube_music;

/// Parse a client's window title using its vendor adapter.
///
/// `App::Browser` has no private interface: browser playback is handled by the
/// system media session only.
pub fn parse_title(app: App, raw: &str) -> Option<ParsedTitle> {
    match app {
        App::Netease => netease::parse_title(raw),
        App::QQMusic => qqmusic::parse_title(raw),
        App::Kugou => kugou::parse_title(raw),
        App::Kuwo => kuwo::parse_title(raw),
        App::Qishui => qishui::parse_title(raw),
        App::WeSing => wesing::parse_title(raw),
        App::Spotify => spotify::parse_title(raw),
        App::AppleMusic => apple_music::parse_title(raw),
        App::YouTubeMusic => youtube_music::parse_title(raw),
        App::Browser => None,
    }
}

/// Vendor-first media resolution.
///
/// The platform adapter identifies the application and passes the matching
/// `Platform` plus its system session and optional private candidate. The
/// vendor decides how to combine them:
///
/// * NetEase: system metadata/status/cover + CDP progress/liked; with no system
///   session CDP supplies the complete media/transport; accessibility fallback;
/// * other known clients: complete system session, else private title/UIA;
/// * browser/unknown: the platform's system API only (handled by the caller).
#[allow(dead_code)] // used by every platform adapter; kept cross-platform.
pub fn resolve(
    platform: Platform,
    app: App,
    system: Option<Media>,
    private: Option<Media>,
    fallback: impl FnOnce() -> Option<(f64, f64)>,
) -> Option<Media> {
    match app {
        App::Netease => netease::merge(platform, system, private, fallback),
        App::Browser => system,
        _ => common::resolve_system_or_private(app, system, private),
    }
}
