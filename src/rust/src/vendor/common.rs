//! Shared helpers for the per-client vendor adapters.
//!
//! The adapters read only local client state (window titles, Cider's title
//! file, NetEase's SQLite database). They never call a network API.

use crate::media::catalog::ParsedTitle;

/// Collapse runs of whitespace and trim.
pub fn normalize_spaces(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Split a player window title into a title/artist pair.
pub fn split_title_artist(value: &str, artist_first: bool) -> ParsedTitle {
    let value = value.trim();
    for separator in [" - ", " – "] {
        if let Some((left, right)) = value.split_once(separator) {
            let (left, right) = (left.trim(), right.trim());
            if !left.is_empty() && !right.is_empty() {
                return if artist_first {
                    ParsedTitle {
                        title: right.to_string(),
                        artist: left.to_string(),
                    }
                } else {
                    ParsedTitle {
                        title: left.to_string(),
                        artist: right.to_string(),
                    }
                };
            }
        }
    }
    ParsedTitle {
        title: value.to_string(),
        artist: String::new(),
    }
}

/// Remove the client/product suffix used by most desktop players.
pub fn strip_suffixes(value: String, suffixes: &[&str]) -> String {
    let mut text = value.trim().to_string();
    for suffix in suffixes {
        if let Some(stripped) = strip_suffix_ci(&text, suffix) {
            text = stripped.trim().to_string();
            break;
        }
    }
    text
}

pub fn strip_prefix_ci<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    if value.len() >= prefix.len()
        && value.is_char_boundary(prefix.len())
        && value[..prefix.len()].eq_ignore_ascii_case(prefix)
    {
        Some(&value[prefix.len()..])
    } else {
        None
    }
}

pub fn strip_suffix_ci<'a>(value: &'a str, suffix: &str) -> Option<&'a str> {
    if value.len() < suffix.len() {
        return None;
    }
    let index = value.len() - suffix.len();
    if !value.is_char_boundary(index) {
        return None;
    }
    if value[index..].eq_ignore_ascii_case(suffix) {
        Some(&value[..index])
    } else {
        None
    }
}

/// True for product names, "connecting" placeholders and empty titles.
pub fn is_generic_title(value: &str, product_names: &[&str]) -> bool {
    let lower = value.trim().to_lowercase();
    if lower.is_empty() {
        return true;
    }
    if lower.contains("正在连接") || lower.contains("connecting") {
        return true;
    }
    if product_names.iter().any(|name| lower == *name) {
        return true;
    }
    matches!(lower.as_str(), "未知" | "unknown" | "未命名媒体")
}

/// Apply client-specific artist separators (e.g. `、`/`&` -> ` / `).
pub fn normalize_artist(value: &str, replacements: &[(&str, &str)]) -> String {
    let mut artist = value.trim().to_string();
    for (from, to) in replacements {
        artist = artist.replace(from, to);
    }
    normalize_spaces(&artist)
}

pub fn find_chars(haystack: &[char], needle: &[char]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Rotate a rolling window title so it starts at `marker`.
pub fn rotate_to_marker(raw: &str, marker: &[char]) -> Option<String> {
    let chars: Vec<char> = raw.chars().collect();
    let index = find_chars(&chars, marker)?;
    Some(
        chars[index..]
            .iter()
            .chain(chars[..index].iter())
            .collect::<String>(),
    )
}
