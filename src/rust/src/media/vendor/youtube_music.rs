//! YouTube Music private adapter.
//!
//! The desktop client and browsers usually bridge `navigator.mediaSession` to
//! SMTC/MPRIS. This module only parses the window title fallback.

use super::common;
use crate::media::catalog::ParsedTitle;

const SUFFIXES: &[&str] = &[
    " - YouTube Music",
    " - YouTube Music Premium",
    " - YouTube",
    " - YT Music",
];
const PRODUCT_NAMES: &[&str] = &[
    "youtube music",
    "youtube music premium",
    "youtube",
    "yt music",
];

pub fn parse_title(raw: &str) -> Option<ParsedTitle> {
    let text = common::strip_suffixes(common::normalize_spaces(raw), SUFFIXES);
    if common::is_generic_title(&text, PRODUCT_NAMES) {
        return None;
    }
    let mut parsed = common::split_title_artist(&text, false);
    parsed.artist = common::normalize_artist(
        &parsed.artist,
        &[("、", " / "), ("和", " / "), (", ", " / ")],
    );
    if parsed.title.is_empty() {
        return None;
    }
    Some(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_youtube_music_title() {
        let parsed = parse_title("晴天 - 周杰伦 - YouTube Music").unwrap();
        assert_eq!(parsed.title, "晴天");
        assert_eq!(parsed.artist, "周杰伦");
        assert!(parse_title("YouTube Music").is_none());
    }
}
