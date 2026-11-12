//! Vendor-specific local integrations.
//!
//! Each child module reads one third-party desktop client's local state (never
//! its network API): window titles, Cider's title file, NetEase's SQLite
//! database, etc. Keep this folder for vendor-only code so the generic media /
//! notification / performance probes stay platform-focused.

use crate::media::catalog::{App, ParsedTitle};

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
