//! KuWo Music private window-title adapter.
//!
//! KuWo also rotates its window title and drops spaces around the separator:
//! `nd&Daft Punk-酷我音乐 Starboy -The Week` -> `Starboy - The Weeknd / Daft Punk`.

use super::common;
use crate::media::catalog::ParsedTitle;

const PRODUCT_NAMES: &[&str] = &["酷我音乐", "酷我", "kuwo"];

pub fn parse_title(raw: &str) -> Option<ParsedTitle> {
    let fixed = fix_title(raw);
    if common::is_generic_title(&fixed, PRODUCT_NAMES) {
        return None;
    }
    let parsed = common::split_title_artist(&fixed, false);
    if parsed.title.is_empty() {
        return None;
    }
    Some(parsed)
}

fn fix_title(raw: &str) -> String {
    let rotated = common::rotate_to_marker(raw, &['酷', '我']).unwrap_or_else(|| raw.to_string());
    let mut text = rotated.trim().to_string();
    text = common::strip_prefix_ci(&text, "酷我音乐")
        .or_else(|| common::strip_prefix_ci(&text, "酷我"))
        .unwrap_or(&text)
        .trim_start_matches([' ', '-', '—', '–'])
        .to_string();
    text = text.trim_end_matches([' ', '-', '—', '–']).to_string();
    text = text.replace('&', " / ");
    // KuWo drops the spaces around its separator.
    text = text.replace(" -", " - ").replace("- ", " - ");
    common::normalize_spaces(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixes_rolling_kuwo_title() {
        let parsed = parse_title("nd&Daft Punk-酷我音乐 Starboy -The Week").unwrap();
        assert_eq!(parsed.title, "Starboy");
        assert_eq!(parsed.artist, "The Weeknd / Daft Punk");
        assert!(parse_title("酷我音乐").is_none());
    }
}
