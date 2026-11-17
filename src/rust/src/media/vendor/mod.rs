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

/// Vendor-first transport dispatch. The platform supplies the target app (from
/// the UI's app id) and the currently selected media; the vendor decides
/// whether to use the private interface or the platform's system control.
///
/// Only NetEase has a client-specific transport (CDP); every other client uses
/// the platform closure, so QQ/Spotify/etc. never need client checks in the
/// generic platform layer.
#[allow(dead_code)] // used by every platform adapter; kept cross-platform.
pub fn control(
    platform: Platform,
    app: Option<App>,
    action: &str,
    position: f64,
    current: Option<&Media>,
    system: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    match app {
        Some(App::Netease) => netease::control(platform, action, position, current, system),
        _ => system(),
    }
}

/// Last-resort vendor media when the platform has no system session at all.
/// Only NetEase currently has such a path (CDP); platforms ask the vendor layer
/// instead of naming the client themselves.
#[allow(dead_code)] // used by Linux/macOS; kept cross-platform.
pub fn fallback_media() -> Option<Media> {
    netease::cdp_media()
}

/// Vendor-specific like control. Only NetEase exposes a red-heart control.
#[allow(dead_code)] // used by every platform adapter; kept cross-platform.
pub fn like(app: Option<App>, liked: Option<bool>) -> Result<(), String> {
    match app {
        Some(App::Netease) => netease::cdp_set_liked(liked).map(|_| ()),
        _ => Err("the current player does not support liking".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_vendor_players_delegate_transport_to_the_system() {
        let mut called = false;
        control(Platform::MacOS, None, "playpause", 0.0, None, || {
            called = true;
            Ok(())
        })
        .unwrap();
        assert!(called);

        let mut called = false;
        control(
            Platform::MacOS,
            Some(App::Spotify),
            "next",
            0.0,
            None,
            || {
                called = true;
                Ok(())
            },
        )
        .unwrap();
        assert!(called);
    }

    #[test]
    fn only_netease_accepts_like_control() {
        assert!(like(None, Some(true)).is_err());
        assert!(like(Some(App::Spotify), Some(true)).is_err());
    }
}
