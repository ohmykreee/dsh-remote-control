//! Vendor-specific local integrations.
//!
//! Each child module reads one third-party desktop client's local state (never
//! its network API): window titles, Cider's title file, NetEase's CDP page
//! data, etc. Keep this folder for vendor-only code so the generic media /
//! notification / performance probes stay platform-focused.

use serde_json::Value;

use crate::media::catalog::{self, App, ParsedTitle, Profile};
use crate::media::Media;

/// Which system branch a vendor adapter is running on. Vendor modules use this
/// to pick the matching system-API rule (WinRT SMTC, MPRIS, MediaRemote) while
/// keeping all client-specific logic in one file.
#[allow(dead_code, reason = "every platform constructs only its own variant")]
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

/// A vendor page that can identify a system media session whose system app id
/// is opaque (for example a generated Windows AUMID).
#[allow(
    dead_code,
    reason = "constructed by page_identity; consumed by the Windows adapter"
)]
pub struct PageIdentity {
    pub profile: &'static Profile,
    pub title: String,
    pub artist: String,
}

#[allow(dead_code, reason = "see PageIdentity")]
impl PageIdentity {
    /// True when the system session describes the same track as the page.
    pub fn matches(&self, media: &Media) -> bool {
        let title = media.title.trim();
        if title.is_empty() || !title.eq_ignore_ascii_case(self.title.trim()) {
            return false;
        }
        self.artist.trim().is_empty()
            || media.artist.trim().is_empty()
            || media.artist.trim().eq_ignore_ascii_case(self.artist.trim())
    }
}

/// Ask the vendor layer whether a page can identify an unrecognised system
/// session. Kept here so platform adapters never name a client module.
#[allow(
    dead_code,
    reason = "used by Windows; every vendor may provide an identity"
)]
pub fn page_identity() -> Option<PageIdentity> {
    let (title, artist) = netease::cdp_identity()?;
    if title.trim().is_empty() {
        return None;
    }
    Some(PageIdentity {
        profile: catalog::profile_for_app(App::Netease)?,
        title,
        artist,
    })
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
#[allow(
    dead_code,
    reason = "used by every platform adapter; kept cross-platform"
)]
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
#[allow(
    dead_code,
    reason = "used by every platform adapter; kept cross-platform"
)]
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
/// Only call it when the caller did not request a specific app; a requested app
/// that is not running must read as empty rather than as another vendor's page.
#[allow(
    dead_code,
    reason = "used by Linux/macOS when no explicit player is requested"
)]
pub fn fallback_media() -> Option<Media> {
    netease::cdp_media()
}

/// Vendor fallback for one identified app (for example an empty system
/// placeholder that a page-backed client can still describe).
#[allow(dead_code, reason = "used by Linux; kept cross-platform")]
pub fn fallback_for_app(app: Option<App>) -> Option<Media> {
    match app {
        Some(App::Netease) => netease::cdp_media(),
        _ => None,
    }
}

/// Whether a vendor can act on its target without a matching system session.
/// NetEase controls its own page over CDP; other clients need the system
/// session. Add future page-backed vendors here, not in the platform layer.
#[allow(dead_code, reason = "used by macOS; kept cross-platform")]
pub fn handles_without_system_session(app: Option<App>) -> bool {
    matches!(app, Some(App::Netease))
}

/// Vendor-specific private-page diagnostics used by `media cdp`.
#[allow(dead_code, reason = "used by the command layer; kept cross-platform")]
pub fn diagnostic() -> Value {
    netease::cdp_diagnostic()
}

/// Vendor-specific like control. Only NetEase currently exposes a red-heart
/// control; add future vendors as match arms here rather than in the platform
/// or command layers.
#[allow(
    dead_code,
    reason = "used by every platform adapter; kept cross-platform"
)]
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

    #[test]
    fn future_vendors_opt_in_to_page_fallbacks() {
        assert!(handles_without_system_session(Some(App::Netease)));
        assert!(!handles_without_system_session(Some(App::QQMusic)));
        assert!(!handles_without_system_session(Some(App::Spotify)));
        assert!(!handles_without_system_session(None));
    }
}
