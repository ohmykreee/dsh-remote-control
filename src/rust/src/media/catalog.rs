//! Cross-platform media application catalog.
//!
//! The probe talks to one system media interface per platform (SMTC on Windows,
//! MPRIS on Linux, MediaRemote/`nowplaying-cli` on macOS). A few desktop
//! players do not expose a complete system session, so the probe also knows how
//! to recognise their process/window identity and, as a last resort, read their
//! accessibility tree.
//!
//! This module owns the parts that are identical everywhere:
//!
//! * the list of supported applications and the ids/process names that map to
//!   them (adapted from <https://github.com/Widdit/now-playing-service>),
//! * per-application window-title parsing (the reference project uses window
//!   titles for NetEase/QQ/KuGou/KuWo/WeSing/Spotify/Cider),
//! * `MM:SS | MM:SS` progress parsing used by UI Automation/AT-SPI/AX readers,
//! * the tier/seek policy: transport seeking is only exposed by a complete
//!   system session, never by accessibility, and only by a private interface
//!   when that interface is explicitly real-time.
//!
//! No network API is used anywhere in this crate: the private tier reads local
//! client state (SQLite databases, local title files) only.

// Some fields/helpers are only used by one platform's adapter (for example the
// window-title parsers are Windows/macOS-only, while `seek_allowed` is used
// everywhere). Keep the catalog compiled on every target without per-platform
// dead-code noise.
#![allow(dead_code)]

/// A supported desktop player (or a browser acting as one).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum App {
    Netease,
    QQMusic,
    Kugou,
    Kuwo,
    Qishui,
    WeSing,
    Spotify,
    AppleMusic,
    YouTubeMusic,
    Browser,
}

/// How much trust to place in an application's system media session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SmtcPolicy {
    /// Accept the system session whenever it exposes metadata, transport and a
    /// seekable timeline.
    Trusted,
    /// Older builds of some clients advertise a seekable timeline while never
    /// reporting a real position. Only accept the system session when it also
    /// reports a non-zero position.
    VerifyPosition,
    /// The system session is useful for metadata/transport status but does not
    /// report playback progress (current NetEase builds do this). Never treat
    /// it as a complete timeline; fill progress from the private/accessibility
    /// tiers instead.
    MetadataOnly,
}

/// The private interface a client exposes, if any.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrivateKind {
    /// No useful private interface.
    None,
    /// Read the current track from the client's top-level window title.
    WindowTitle,
    /// Cider keeps the current Apple Music title in `Plugins/title.txt`.
    CiderTitleFile,
}

/// Which layer produced a media payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum Tier {
    System,
    Private,
    Accessibility,
}

impl Tier {
    pub fn as_str(self) -> &'static str {
        match self {
            Tier::System => "system",
            Tier::Private => "private",
            Tier::Accessibility => "accessibility",
        }
    }
}

/// One application description.
#[derive(Debug, Clone, Copy)]
pub struct Profile {
    pub app: App,
    /// Stable fallback id when no executable name is available.
    pub app_id: &'static str,
    /// Human-readable name, used only in diagnostics.
    pub name: &'static str,
    /// Lower-case executable stems (without `.exe`/`.app`).
    pub process_names: &'static [&'static str],
    /// Lower-case substrings of an SMTC AUMID / MPRIS bus name / bundle id.
    pub id_keywords: &'static [&'static str],
    pub smtc_policy: SmtcPolicy,
    /// Whether a progress read through the accessibility API is worthwhile.
    pub accessibility: bool,
    pub private: PrivateKind,
}

/// All known profiles, in match priority order.
pub const PROFILES: &[Profile] = &[
    Profile {
        app: App::Netease,
        app_id: "cloudmusic.exe",
        name: "网易云音乐",
        process_names: &["cloudmusic", "netease-cloud-music", "netease cloud music"],
        id_keywords: &["cloudmusic", "netease", "163music", "网易云"],
        // Current NetEase builds expose SMTC metadata and transport controls
        // but not playback progress. Use SMTC as the metadata source, then fill
        // the position/duration from the window/UI Automation fallback.
        smtc_policy: SmtcPolicy::MetadataOnly,
        accessibility: true,
        private: PrivateKind::WindowTitle,
    },
    Profile {
        app: App::QQMusic,
        app_id: "QQMusic.exe",
        name: "QQ音乐",
        process_names: &["qqmusic", "qq music"],
        id_keywords: &["qqmusic", "qq music", "qq音乐"],
        smtc_policy: SmtcPolicy::VerifyPosition,
        accessibility: false,
        private: PrivateKind::WindowTitle,
    },
    Profile {
        app: App::Kugou,
        app_id: "KuGou.exe",
        name: "酷狗音乐",
        process_names: &["kugou", "kgmusic", "ku gou"],
        id_keywords: &["kugou", "kgmusic", "酷狗"],
        smtc_policy: SmtcPolicy::VerifyPosition,
        accessibility: false,
        private: PrivateKind::WindowTitle,
    },
    Profile {
        app: App::Kuwo,
        app_id: "KwMusic.exe",
        name: "酷我音乐",
        process_names: &["kwmusic", "kwservice", "kuwo"],
        id_keywords: &["kwmusic", "kuwo", "酷我"],
        smtc_policy: SmtcPolicy::VerifyPosition,
        accessibility: false,
        private: PrivateKind::WindowTitle,
    },
    Profile {
        app: App::Qishui,
        app_id: "SodaMusic.exe",
        name: "汽水音乐",
        process_names: &["sodamusic", "soda music"],
        id_keywords: &["sodamusic", "soda music", "汽水"],
        smtc_policy: SmtcPolicy::VerifyPosition,
        accessibility: false,
        private: PrivateKind::None,
    },
    Profile {
        app: App::WeSing,
        app_id: "WeSing.exe",
        name: "全民K歌",
        process_names: &["wesing"],
        id_keywords: &["wesing", "全民k歌"],
        smtc_policy: SmtcPolicy::VerifyPosition,
        accessibility: true,
        private: PrivateKind::WindowTitle,
    },
    Profile {
        app: App::Spotify,
        app_id: "Spotify.exe",
        name: "Spotify",
        process_names: &["spotify"],
        id_keywords: &["spotify"],
        smtc_policy: SmtcPolicy::Trusted,
        accessibility: false,
        private: PrivateKind::WindowTitle,
    },
    Profile {
        app: App::AppleMusic,
        app_id: "AppleMusic.exe",
        name: "Apple Music",
        process_names: &["applemusic", "apple music", "cider"],
        id_keywords: &["applemusic", "apple music", "com.apple.music", "cider"],
        smtc_policy: SmtcPolicy::Trusted,
        accessibility: false,
        private: PrivateKind::CiderTitleFile,
    },
    Profile {
        app: App::YouTubeMusic,
        app_id: "YouTube Music.exe",
        name: "YouTube Music",
        process_names: &["youtube-music", "youtubemusic", "youtube music", "ytmusic"],
        id_keywords: &["youtube-music", "youtubemusic", "youtube music", "ytmusic"],
        smtc_policy: SmtcPolicy::Trusted,
        accessibility: false,
        private: PrivateKind::WindowTitle,
    },
    Profile {
        app: App::Browser,
        app_id: "browser",
        name: "浏览器",
        process_names: &[
            "chrome",
            "msedge",
            "firefox",
            "brave",
            "opera",
            "vivaldi",
            "arc",
            "qqbrowser",
            "sogou",
            "360se",
            "360chrome",
        ],
        id_keywords: &[
            "chrome",
            "msedge",
            "firefox",
            "brave",
            "opera",
            "vivaldi",
            "arc",
            "qqbrowser",
            "sogou",
            "360se",
            "360chrome",
            "electron.app",
        ],
        smtc_policy: SmtcPolicy::Trusted,
        accessibility: false,
        private: PrivateKind::None,
    },
];

/// Find a profile from a system media id (AUMID, MPRIS name or bundle id).
pub fn profile_for_id(id: &str) -> Option<&'static Profile> {
    let id = id.to_lowercase();
    if id.trim().is_empty() {
        return None;
    }
    PROFILES.iter().find(|profile| {
        profile
            .id_keywords
            .iter()
            .any(|keyword| id.contains(keyword))
    })
}

/// Find a profile from an executable/process name (path allowed).
pub fn profile_for_process(process: &str) -> Option<&'static Profile> {
    let lower = process.to_lowercase();
    let name = lower
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(&lower)
        .trim()
        .trim_end_matches(".exe")
        .trim_end_matches(".app");
    if name.is_empty() {
        return None;
    }
    PROFILES.iter().find(|profile| {
        profile
            .process_names
            .iter()
            .any(|candidate| name == *candidate || name.contains(candidate))
    })
}

#[allow(dead_code)]
pub fn profile_for_app(app: App) -> Option<&'static Profile> {
    PROFILES.iter().find(|profile| profile.app == app)
}

impl Profile {
    /// Parse this client's window title through its vendor adapter.
    pub fn parse_title(&self, raw: &str) -> Option<ParsedTitle> {
        crate::vendor::parse_title(self.app, raw)
    }
}

/// A title/artist pair parsed from a client window title.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedTitle {
    pub title: String,
    pub artist: String,
}

/// Parse `MM:SS`, `H:MM:SS`, `MM:SS | MM:SS` and `MM:SS/MM:SS`.
pub fn parse_progress_text(text: &str) -> Option<(f64, f64)> {
    let cleaned: String = text
        .chars()
        .filter(|character| {
            !character.is_whitespace()
                && *character != '\u{00a0}'
                && *character != '\u{3000}'
                && *character != '\u{feff}'
        })
        .collect();
    if cleaned.is_empty() {
        return None;
    }
    let (left, right) = cleaned
        .split_once('|')
        .or_else(|| cleaned.split_once('｜'))
        .or_else(|| cleaned.split_once('/'))?;
    let current = parse_time(left)?;
    let total = parse_time(right)?;
    if total <= 0.0 || current < 0.0 || current > total + 2.0 {
        return None;
    }
    Some((current, total))
}

/// The seek rule shared by every platform.
///
/// * A complete system session may expose seek.
/// * Accessibility readers are display-only.
/// * A private interface may expose seek only when it is explicitly fast enough
///   to survive the follow-up read (`private_realtime`).
pub fn seek_allowed(tier: Tier, system_complete: bool, private_realtime: bool) -> bool {
    match tier {
        Tier::System => system_complete,
        Tier::Private => private_realtime,
        Tier::Accessibility => false,
    }
}

fn parse_time(value: &str) -> Option<f64> {
    let value = value.replace('：', ":");
    let parts: Vec<&str> = value.split(':').collect();
    let (hours, minutes, seconds) = match parts.as_slice() {
        [minutes, seconds] => (
            0.0,
            minutes.parse::<f64>().ok()?,
            seconds.parse::<f64>().ok()?,
        ),
        [hours, minutes, seconds] => (
            hours.parse::<f64>().ok()?,
            minutes.parse::<f64>().ok()?,
            seconds.parse::<f64>().ok()?,
        ),
        _ => return None,
    };
    if minutes < 0.0 || seconds < 0.0 || seconds >= 60.0 {
        return None;
    }
    if parts.len() == 3 && minutes >= 60.0 {
        return None;
    }
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_apps_from_ids_and_processes() {
        assert_eq!(profile_for_id("cloudmusic.exe").unwrap().app, App::Netease);
        assert_eq!(
            profile_for_id("cloudmusic.exe").unwrap().smtc_policy,
            SmtcPolicy::MetadataOnly
        );
        assert_eq!(
            profile_for_id("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify")
                .unwrap()
                .app,
            App::Spotify
        );
        assert_eq!(
            profile_for_id("com.apple.Music").unwrap().app,
            App::AppleMusic
        );
        assert_eq!(
            profile_for_process(r"D:\Program Files\KuGou\KuGou.exe")
                .unwrap()
                .app,
            App::Kugou
        );
        assert_eq!(profile_for_process("KwService.exe").unwrap().app, App::Kuwo);
        assert_eq!(
            profile_for_process("youtube-music-desktop-app.exe")
                .unwrap()
                .app,
            App::YouTubeMusic
        );
        assert_eq!(profile_for_id("MSEdge").unwrap().app, App::Browser);
        assert_eq!(profile_for_id("MSEdge").unwrap().private, PrivateKind::None);
    }

    #[test]
    fn parses_progress_text() {
        assert_eq!(parse_progress_text("00:08 | 04:16"), Some((8.0, 256.0)));
        assert_eq!(parse_progress_text("00:08 / 04:16"), Some((8.0, 256.0)));
        assert_eq!(
            parse_progress_text("1:02:03 ｜ 2:00:00"),
            Some((3723.0, 7200.0))
        );
        assert_eq!(parse_progress_text("00：08 | 04：16"), Some((8.0, 256.0)));
        assert_eq!(parse_progress_text("not a progress"), None);
        assert_eq!(parse_progress_text("05:00 | 04:00"), None);
    }

    #[test]
    fn accessibility_never_exposes_seek() {
        assert!(seek_allowed(Tier::System, true, false));
        assert!(!seek_allowed(Tier::System, false, false));
        assert!(!seek_allowed(Tier::Accessibility, true, false));
        assert!(!seek_allowed(Tier::Private, false, false));
        assert!(seek_allowed(Tier::Private, false, true));
    }
}
