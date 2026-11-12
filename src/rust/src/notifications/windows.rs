//! Windows notification probe: read the notification center SQLite database.
//!
//! The live database is copied (with its WAL/SHM sidecars) to a temporary
//! directory before opening read-only. Toast payloads are normalized from their
//! XML, including the app-logo/hero image when it points at a local file.

use std::path::PathBuf;

use rusqlite::{types::ValueRef, Connection, OpenFlags};

use super::{truncate, NotificationItem, Snapshot, SnapshotResult};
use crate::cli::{CliError, CliResult};
use crate::util;

pub const SOURCE: &str = "windows-notification-database";
pub const LIVE_ONLY: bool = false;

pub fn watch(_limit: usize) -> CliResult {
    Err(CliError::usage(
        "notifications watch is available on Linux only".to_string(),
    ))
}

const MAX_AVATAR_BYTES: u64 = 768 * 1024;
const MAX_BODY_CHARS: usize = 260;
const MAX_TITLE_CHARS: usize = 160;

fn database_path() -> PathBuf {
    let local = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| util::home_dir().map(|home| home.join("AppData").join("Local")))
        .unwrap_or_default();
    local
        .join("Microsoft")
        .join("Windows")
        .join("Notifications")
        .join("wpndatabase.db")
}

fn clip_chars(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

fn value_string(value: ValueRef<'_>) -> Option<String> {
    match value {
        ValueRef::Text(bytes) => Some(String::from_utf8_lossy(bytes).into_owned()),
        ValueRef::Integer(number) => Some(number.to_string()),
        ValueRef::Real(number) => Some(number.to_string()),
        _ => None,
    }
}

fn value_i64(value: ValueRef<'_>) -> Option<i64> {
    match value {
        ValueRef::Integer(number) => Some(number),
        ValueRef::Real(number) => Some(number as i64),
        ValueRef::Text(bytes) => String::from_utf8_lossy(bytes).trim().parse().ok(),
        _ => None,
    }
}

fn value_bytes(value: ValueRef<'_>) -> Option<Vec<u8>> {
    match value {
        ValueRef::Blob(bytes) => Some(bytes.to_vec()),
        ValueRef::Text(bytes) => Some(bytes.to_vec()),
        _ => None,
    }
}

struct Row {
    id: String,
    handler_id: Option<i64>,
    payload: Vec<u8>,
    arrival: Option<i64>,
    expiry: Option<i64>,
    primary_id: Option<String>,
}

fn read_rows(connection: &Connection, limit: usize) -> Result<Vec<Row>, String> {
    let fetch = (limit.saturating_mul(4)).max(40) as i64;
    let mut statement = connection
        .prepare(
            "select n.Id, n.HandlerId, n.Payload, n.Type,
                    n.ArrivalTime, n.ExpiryTime, h.PrimaryId, h.HandlerType
               from Notification n
               left join NotificationHandler h on h.RecordId = n.HandlerId
              where n.Type = 'toast'
              order by cast(n.ArrivalTime as integer) desc
              limit ?1",
        )
        .map_err(|error| format!("notification query failed: {error}"))?;
    let rows = statement
        .query_map([fetch], |row| {
            Ok(Row {
                id: value_string(row.get_ref(0)?).unwrap_or_default(),
                handler_id: value_i64(row.get_ref(1)?),
                payload: value_bytes(row.get_ref(2)?).unwrap_or_default(),
                arrival: value_i64(row.get_ref(4)?),
                expiry: value_i64(row.get_ref(5)?),
                primary_id: value_string(row.get_ref(6)?),
            })
        })
        .map_err(|error| format!("notification query failed: {error}"))?;
    Ok(rows.flatten().collect())
}

pub fn read(limit: usize) -> SnapshotResult {
    let source = database_path();
    if !source.is_file() {
        return Err("Windows notification database not found".to_string());
    }
    let temp = util::TempDir::create("dsh-probe-wpn")?;
    let target = temp.path().join("wpndatabase.db");
    util::copy_sqlite_database(&source, &target)?;
    let connection = Connection::open_with_flags(&target, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("could not open the notification database: {error}"))?;
    let rows = read_rows(&connection, limit)?;

    let now = util::now_ms();
    let mut notifications = Vec::new();
    for row in rows {
        let Some(received_at) = row.arrival.and_then(filetime_to_unix_ms) else {
            continue;
        };
        if received_at > now + 60_000 || now - received_at > 7 * 24 * 60 * 60 * 1000 {
            continue;
        }
        if let Some(expiry) = row.expiry.and_then(filetime_to_unix_ms) {
            if expiry < now {
                continue;
            }
        }
        let payload = String::from_utf8_lossy(&row.payload);
        let parsed = parse_toast_xml(&payload);
        if parsed.texts.is_empty() && parsed.image.is_none() {
            continue;
        }
        let app_key = clip_chars(
            row.primary_id
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(&format!("handler-{}", row.handler_id.unwrap_or_default())),
            240,
        );
        // The probe only forwards the raw application identity from the OS; the
        // plugin keeps the display-name mapping (and user renames) on the Node
        // side so Windows app ids never need a hard-coded table here.
        let app_name = raw_app_name(&app_key);
        let title = parsed
            .texts
            .first()
            .cloned()
            .unwrap_or_else(|| app_name.clone());
        let mut body = parsed
            .texts
            .iter()
            .skip(1)
            .cloned()
            .collect::<Vec<_>>()
            .join("  ");
        if body == title {
            body.clear();
        }
        notifications.push(NotificationItem {
            id: if row.id.is_empty() {
                format!("{received_at}-{}", notifications.len())
            } else {
                row.id
            },
            app_key,
            app_name,
            title: truncate(&title, MAX_TITLE_CHARS),
            body: truncate(&body, MAX_BODY_CHARS),
            avatar: parsed.image.as_deref().and_then(avatar_data_url),
            has_image: parsed.has_inline_image,
            received_at,
            is_group: is_group_title(&title),
        });
        if notifications.len() >= limit {
            break;
        }
    }

    Ok(Snapshot {
        source: SOURCE,
        live_only: LIVE_ONLY,
        notifications,
        updated_at: now,
    })
}

fn is_group_title(title: &str) -> bool {
    let lower = title.to_lowercase();
    lower.contains("群")
        || lower.contains("group")
        || lower.contains("频道")
        || lower.contains("channel")
}

/// The probe deliberately reports the raw OS application id; the plugin maps it
/// to a display name (with user overrides) on the Node side.
fn raw_app_name(primary_id: &str) -> String {
    if primary_id.trim().is_empty() {
        "Windows".to_string()
    } else {
        clip_chars(primary_id.trim(), 120)
    }
}

fn filetime_to_unix_ms(filetime: i64) -> Option<i64> {
    if filetime <= 0 {
        return None;
    }
    Some(filetime / 10_000 - 11_644_473_600_000)
}

fn avatar_data_url(source: &str) -> Option<String> {
    let source = source.trim();
    if source.is_empty() {
        return None;
    }
    let path = if let Some(path) = source.strip_prefix("file://") {
        PathBuf::from(util::percent_decode(path.trim_start_matches("localhost")))
    } else if source.starts_with("ms-appdata://") || source.starts_with("ms-appx://") {
        return None;
    } else {
        PathBuf::from(source)
    };
    if !path.is_absolute() {
        return None;
    }
    util::file_image_data_url(&path, MAX_AVATAR_BYTES)
}

#[derive(Debug, Default, PartialEq)]
pub struct ToastContent {
    pub texts: Vec<String>,
    pub image: Option<String>,
    pub launch: String,
    pub has_inline_image: bool,
}

fn next_tag(lower: &str, from: usize, tag: &str) -> Option<usize> {
    lower[from..]
        .find(&format!("<{tag}"))
        .map(|index| index + from)
}

/// Decode the XML entities that appear in toast payloads.
pub fn decode_xml(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(index) = rest.find('&') {
        output.push_str(&rest[..index]);
        let Some(end) = rest[index..].find(';') else {
            output.push_str(&rest[index..]);
            return output;
        };
        let entity = &rest[index + 1..index + end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| {
                    entity
                        .strip_prefix('#')
                        .and_then(|digits| digits.parse::<u32>().ok())
                })
                .and_then(char::from_u32),
        };
        match decoded {
            Some(character) => output.push(character),
            None => {
                output.push('&');
                output.push_str(entity);
                output.push(';');
            }
        }
        rest = &rest[index + end + 1..];
    }
    output.push_str(rest);
    output
}

fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn attribute(attributes: &str, name: &str) -> Option<String> {
    let lower = attributes.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let needle = name.as_bytes();
    let mut index = 0;
    while index + needle.len() <= bytes.len() {
        if &bytes[index..index + needle.len()] == needle {
            let boundary_before = index == 0
                || !(bytes[index - 1].is_ascii_alphanumeric() || bytes[index - 1] == b'_');
            if boundary_before {
                let mut cursor = index + needle.len();
                while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
                    cursor += 1;
                }
                if cursor < bytes.len() && bytes[cursor] == b'=' {
                    cursor += 1;
                    while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
                        cursor += 1;
                    }
                    if cursor < bytes.len() && (bytes[cursor] == b'"' || bytes[cursor] == b'\'') {
                        let quote = bytes[cursor];
                        let start = cursor + 1;
                        if let Some(offset) = bytes[start..].iter().position(|byte| *byte == quote)
                        {
                            let value = &attributes[start..start + offset];
                            return Some(decode_xml(value).trim().to_string());
                        }
                    }
                }
            }
        }
        index += 1;
    }
    None
}

pub fn parse_toast_xml(xml: &str) -> ToastContent {
    let lower = xml.to_ascii_lowercase();
    let mut content = ToastContent::default();

    let mut cursor = 0;
    while let Some(start) = next_tag(&lower, cursor, "text") {
        let Some(open_end) = lower[start..].find('>').map(|index| index + start) else {
            break;
        };
        let Some(close_start) = next_tag(&lower, open_end + 1, "/text") else {
            break;
        };
        let text = collapse_whitespace(&decode_xml(&xml[open_end + 1..close_start]));
        if !text.is_empty() {
            content.texts.push(text);
        }
        cursor = close_start + 1;
    }

    let mut images: Vec<(String, String)> = Vec::new();
    let mut cursor = 0;
    while let Some(start) = next_tag(&lower, cursor, "image") {
        let Some(open_end) = lower[start..].find('>').map(|index| index + start) else {
            break;
        };
        let attributes = &xml[start + 6..open_end];
        if let Some(source) = attribute(attributes, "src").filter(|value| !value.is_empty()) {
            let placement = attribute(attributes, "placement")
                .map(|value| value.to_ascii_lowercase())
                .unwrap_or_else(|| "inline".to_string());
            images.push((source, placement));
        }
        cursor = open_end + 1;
    }
    content.image = images
        .iter()
        .find(|(_, placement)| placement == "applogooverride")
        .or_else(|| images.iter().find(|(_, placement)| placement == "hero"))
        .or_else(|| images.first())
        .map(|(source, _)| source.clone());
    content.has_inline_image = images
        .iter()
        .any(|(_, placement)| placement != "applogooverride");
    content.launch = attribute(xml, "launch").unwrap_or_default();
    content
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_toast_texts_and_entity_codes() {
        let xml = r#"<toast launch="app://open"><visual><binding template="ToastGeneric">
            <text>Hello &amp; welcome</text><text>  spaced
            body  </text></binding></visual></toast>"#;
        let parsed = parse_toast_xml(xml);
        assert_eq!(parsed.texts, vec!["Hello & welcome", "spaced body"]);
        assert_eq!(parsed.launch, "app://open");
        assert!(parsed.image.is_none());
    }

    #[test]
    fn prefers_application_logo_and_detects_inline_images() {
        let xml = r#"<toast><visual><binding>
            <image src="C:\hero.png" placement="hero"/>
            <image src="C:\logo.png" placement="applogooverride"/>
            <text>Title</text></binding></visual></toast>"#;
        let parsed = parse_toast_xml(xml);
        assert_eq!(parsed.image.as_deref(), Some("C:\\logo.png"));
        assert!(parsed.has_inline_image);
    }

    #[test]
    fn decodes_numeric_entities() {
        assert_eq!(decode_xml("A&#65;&#x42;"), "AAB");
        assert_eq!(decode_xml("unknown &bogus; kept"), "unknown &bogus; kept");
    }

    #[test]
    fn converts_filetime() {
        assert_eq!(
            filetime_to_unix_ms(133_485_408_000_000_000),
            Some(1_704_067_200_000)
        );
        assert_eq!(filetime_to_unix_ms(0), None);
    }

    #[test]
    fn forwards_raw_application_ids() {
        assert_eq!(raw_app_name("QQ"), "QQ");
        assert_eq!(
            raw_app_name("Microsoft.WindowsTerminal_8wekyb3d8bbwe!App"),
            "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App"
        );
        assert_eq!(
            raw_app_name("C:\\Tools\\player.exe"),
            "C:\\Tools\\player.exe"
        );
        assert_eq!(raw_app_name("  "), "Windows");
    }

    #[test]
    fn detects_group_titles() {
        assert!(is_group_title("项目群"));
        assert!(is_group_title("Team channel"));
        assert!(!is_group_title("Alice"));
    }
}
