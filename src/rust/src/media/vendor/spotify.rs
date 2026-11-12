//! Spotify private window-title adapter.
//!
//! Spotify normally provides a complete SMTC/MPRIS session. The window title
//! fallback is only used when that session is missing; Spotify puts the artist
//! first (`歌手 - 歌名`).

use super::common;
use crate::media::catalog::ParsedTitle;

const SUFFIXES: &[&str] = &[
    " - Spotify Premium",
    " - Spotify Free",
    " - Spotify",
    " – Spotify",
];
const PRODUCT_NAMES: &[&str] = &[
    "spotify",
    "spotify free",
    "spotify premium",
    "spotify - free",
];

pub fn parse_title(raw: &str) -> Option<ParsedTitle> {
    let text = common::strip_suffixes(common::normalize_spaces(raw), SUFFIXES);
    if common::is_generic_title(&text, PRODUCT_NAMES) {
        return None;
    }
    let parsed = common::split_title_artist(&text, true);
    if parsed.title.is_empty() {
        return None;
    }
    Some(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_spotify_title() {
        let parsed = parse_title("Daft Punk - Starboy - Spotify").unwrap();
        assert_eq!(parsed.title, "Starboy");
        assert_eq!(parsed.artist, "Daft Punk");
        assert!(parse_title("Spotify Free").is_none());
    }
}
