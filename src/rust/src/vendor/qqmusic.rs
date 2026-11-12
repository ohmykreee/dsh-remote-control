//! QQ Music private window-title adapter.

use super::common;
use crate::media::catalog::ParsedTitle;

const SUFFIXES: &[&str] = &[" - QQ音乐", " - QQ Music"];
const PRODUCT_NAMES: &[&str] = &["qq音乐", "qq music"];

pub fn parse_title(raw: &str) -> Option<ParsedTitle> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_qq_music_title() {
        let parsed = parse_title("晴天 - 周杰伦 - QQ音乐").unwrap();
        assert_eq!(parsed.title, "晴天");
        assert_eq!(parsed.artist, "周杰伦");
        assert!(parse_title("QQ音乐").is_none());
    }
}
