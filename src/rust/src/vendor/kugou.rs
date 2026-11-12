//! KuGou Music private window-title adapter.
//!
//! KuGou rotates its window title, e.g.
//! `还是他 - 酷狗音乐 陶喆 - 爱我` should become `爱我还是他 - 陶喆`.
//! The "un-rotating" heuristic is ported from the reference project.

use super::common;
use crate::media::catalog::ParsedTitle;

const PRODUCT_NAMES: &[&str] = &["酷狗音乐", "酷狗", "kugou"];

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
    let rotated = common::rotate_to_marker(raw, &['酷', '狗']).unwrap_or_else(|| raw.to_string());
    let mut text = rotated.trim().to_string();
    text = common::strip_prefix_ci(&text, "酷狗音乐")
        .or_else(|| common::strip_prefix_ci(&text, "酷狗"))
        .unwrap_or(&text)
        .trim_start_matches([' ', '-', '—', '–'])
        .to_string();
    text = text.trim_end_matches([' ', '-', '—', '–']).to_string();
    text = text.replace('、', " / ");
    // KuGou leaves `artist - song`; put the song first.
    if let Some((artist, title)) = text.split_once(" - ") {
        return format!("{} - {}", title.trim(), artist.trim());
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixes_rolling_kugou_title() {
        let parsed = parse_title("还是他 - 酷狗音乐 陶喆 - 爱我").unwrap();
        assert_eq!(parsed.title, "爱我还是他");
        assert_eq!(parsed.artist, "陶喆");
        assert!(parse_title("酷狗音乐").is_none());
    }
}
