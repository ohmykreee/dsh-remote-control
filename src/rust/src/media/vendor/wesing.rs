//! WeSing (全民 K 歌) private adapter.
//!
//! WeSing's window title is `全民K歌 - 歌名`. Progress is read from its
//! accessibility text (`MM:SS | MM:SS`), but that lives in the platform
//! accessibility module because it is a generic tree scan.

use super::common;
use crate::media::catalog::ParsedTitle;

const PREFIX: &str = "全民K歌 - ";
const SUFFIXES: &[&str] = &[" - 全民K歌", " - WeSing"];
const PRODUCT_NAMES: &[&str] = &["全民k歌", "wesing"];

pub fn parse_title(raw: &str) -> Option<ParsedTitle> {
    let normalized = common::normalize_spaces(raw);
    let stripped = common::strip_prefix_ci(&normalized, PREFIX)
        .map(str::to_string)
        .unwrap_or_else(|| common::strip_suffixes(normalized, SUFFIXES));
    if common::is_generic_title(&stripped, PRODUCT_NAMES) {
        return None;
    }
    let parsed = common::split_title_artist(&stripped, false);
    if parsed.title.is_empty() {
        return None;
    }
    Some(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wesing_title() {
        let parsed = parse_title("全民K歌 - 爱在西元前").unwrap();
        assert_eq!(parsed.title, "爱在西元前");
        assert!(parse_title("全民K歌").is_none());
    }
}
