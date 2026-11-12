//! Soda Music (汽水音乐) private adapter.
//!
//! The desktop client normally provides SMTC; only the title fallback lives
//! here because the reference project does not expose a useful private API.

use super::common;
use crate::media::catalog::ParsedTitle;

const SUFFIXES: &[&str] = &[" - 汽水音乐", " - Soda Music"];
const PRODUCT_NAMES: &[&str] = &["汽水音乐", "soda music", "sodamusic"];

pub fn parse_title(raw: &str) -> Option<ParsedTitle> {
    let text = common::strip_suffixes(common::normalize_spaces(raw), SUFFIXES);
    if common::is_generic_title(&text, PRODUCT_NAMES) {
        return None;
    }
    let mut parsed = common::split_title_artist(&text, false);
    parsed.artist = common::normalize_artist(&parsed.artist, &[(", ", " / ")]);
    if parsed.title.is_empty() {
        return None;
    }
    Some(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_soda_music_title() {
        let parsed = parse_title("晴天 - 周杰伦 - 汽水音乐").unwrap();
        assert_eq!(parsed.title, "晴天");
        assert_eq!(parsed.artist, "周杰伦");
        assert!(parse_title("汽水音乐").is_none());
    }
}
