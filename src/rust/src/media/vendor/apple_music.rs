//! Apple Music / Cider private adapter.
//!
//! Apple Music normally uses SMTC/MediaRemote. Cider (a third-party Apple Music
//! client) writes the current title to `Plugins/title.txt`; that local file is
//! the private interface used when MediaRemote cannot identify the track.

use std::path::PathBuf;

use super::common;
use crate::media::catalog::ParsedTitle;
use crate::util;

const SUFFIXES: &[&str] = &[" - Apple Music", " - Music", " - Cider"];
const PRODUCT_NAMES: &[&str] = &["apple music", "music", "cider"];

pub fn parse_title(raw: &str) -> Option<ParsedTitle> {
    let text = common::strip_suffixes(common::normalize_spaces(raw), SUFFIXES);
    if common::is_generic_title(&text, PRODUCT_NAMES) {
        return None;
    }
    let mut parsed = common::split_title_artist(&text, false);
    // Apple Music appends the album to the artist: "Floating Points — Cascade".
    parsed.artist = parsed
        .artist
        .split(" — ")
        .next()
        .unwrap_or(&parsed.artist)
        .trim()
        .to_string();
    if parsed.title.is_empty() {
        return None;
    }
    Some(parsed)
}

/// Read Cider's local current-title file, checking the Windows and macOS
/// locations used by the clients.
#[allow(dead_code)] // Windows/macOS callers; Linux has no Cider client.
pub fn cider_title() -> Option<ParsedTitle> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
        candidates.push(appdata.join("Cider").join("Plugins").join("title.txt"));
    }
    if let Some(home) = util::home_dir() {
        candidates.push(
            home.join("Library")
                .join("Application Support")
                .join("Cider")
                .join("Plugins")
                .join("title.txt"),
        );
        candidates.push(
            home.join(".config")
                .join("Cider")
                .join("Plugins")
                .join("title.txt"),
        );
    }
    for path in candidates {
        let Ok(text) = std::fs::read_to_string(path) else {
            continue;
        };
        let Some(line) = text.lines().map(str::trim).find(|line| !line.is_empty()) else {
            continue;
        };
        if let Some(parsed) = parse_title(line) {
            return Some(parsed);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_apple_music_title() {
        let parsed = parse_title("Crush - Floating Points - Apple Music").unwrap();
        assert_eq!(parsed.title, "Crush");
        assert_eq!(parsed.artist, "Floating Points");
        assert!(parse_title("Apple Music").is_none());
    }

    #[test]
    fn strips_album_from_artist() {
        let parsed = parse_title("Crush - Floating Points — Cascade").unwrap();
        assert_eq!(parsed.artist, "Floating Points");
    }
}
