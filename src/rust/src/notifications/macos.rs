//! macOS notification probe: read the Notification Center database.
//!
//! Source only: this module is type-checked with `--features macos-check` but has
//! not been run on macOS. Notification Center stores a binary property list per
//! record; it is parsed in-process (no `plutil`/AppleScript fallback).
//!
//! Reading the database requires Full Disk Access for the DSH host. When access
//! is denied the probe returns a clear error instead of partial/fake data.

use std::path::PathBuf;

use plist::{Dictionary, Value};
use rusqlite::{types::ValueRef, Connection, OpenFlags};

use super::{truncate, NotificationItem, Snapshot, SnapshotResult};
use crate::util;

pub const SOURCE: &str = "macos-notification-center";
pub const LIVE_ONLY: bool = false;

const APP_LABELS: &[(&str, &str)] = &[
    ("com.apple.Music", "音乐"),
    ("com.apple.iTunes", "音乐"),
    ("com.spotify.client", "Spotify"),
    ("com.tencent.xinWeChat", "微信"),
    ("com.tencent.qq", "QQ"),
    ("com.microsoft.teams2", "Microsoft Teams"),
    ("com.microsoft.Outlook", "Outlook"),
    ("com.google.Chrome", "Google Chrome"),
    ("com.apple.Safari", "Safari"),
    ("com.apple.mail", "邮件"),
    ("com.apple.reminders", "提醒事项"),
    ("com.apple.iCal", "日历"),
];

fn database_path() -> Option<PathBuf> {
    util::home_dir().map(|home| {
        home.join("Library")
            .join("Group Containers")
            .join("group.com.apple.usernoted")
            .join("db2")
            .join("db")
    })
}

fn quote(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn value_string(value: ValueRef<'_>) -> Option<String> {
    match value {
        ValueRef::Text(bytes) => Some(String::from_utf8_lossy(bytes).into_owned()),
        ValueRef::Integer(number) => Some(number.to_string()),
        ValueRef::Real(number) => Some(number.to_string()),
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

fn tables(connection: &Connection) -> Vec<String> {
    let Ok(mut statement) =
        connection.prepare("select name from sqlite_master where type = 'table'")
    else {
        return Vec::new();
    };
    let Ok(rows) = statement.query_map([], |row| row.get::<_, String>(0)) else {
        return Vec::new();
    };
    rows.flatten().collect()
}

fn columns(connection: &Connection, table: &str) -> Vec<String> {
    let sql = format!("pragma table_info({})", quote(table));
    let Ok(mut statement) = connection.prepare(&sql) else {
        return Vec::new();
    };
    let Ok(rows) = statement.query_map([], |row| row.get::<_, String>(1)) else {
        return Vec::new();
    };
    rows.flatten().collect()
}

fn pick_column<'a>(columns: &'a [String], predicate: impl Fn(&str) -> bool) -> Option<&'a str> {
    columns
        .iter()
        .find(|name| predicate(&name.to_lowercase()))
        .map(String::as_str)
}

fn app_name(app_key: &str, app_table_names: &std::collections::HashMap<String, String>) -> String {
    if let Some(name) = app_table_names.get(app_key) {
        return name.clone();
    }
    if let Some((_, label)) = APP_LABELS.iter().find(|(key, _)| *key == app_key) {
        return (*label).to_string();
    }
    app_key
        .split('.')
        .filter(|part| !part.is_empty())
        .next_back()
        .unwrap_or("macOS")
        .to_string()
}

fn pick_string(dictionary: &Dictionary, keys: &[&str]) -> String {
    for key in keys {
        let Some(value) = dictionary.get(key) else {
            continue;
        };
        if let Some(text) = value.as_string() {
            if !text.trim().is_empty() {
                return text.trim().to_string();
            }
        }
        if let Some(inner) = value.as_dictionary() {
            for inner_key in ["string", "stringValue"] {
                if let Some(text) = inner.get(inner_key).and_then(Value::as_string) {
                    if !text.trim().is_empty() {
                        return text.trim().to_string();
                    }
                }
            }
        }
    }
    String::new()
}

fn parse_payload(payload: &[u8]) -> Option<(String, String, String)> {
    let value = Value::from_reader(std::io::Cursor::new(payload)).ok()?;
    let root = value.as_dictionary()?;
    let request = root
        .get("req")
        .and_then(Value::as_dictionary)
        .unwrap_or(root);
    Some((
        pick_string(request, &["titl", "title"]),
        pick_string(request, &["subt", "subtitle"]),
        pick_string(request, &["body", "mess"]),
    ))
}

fn apple_time_to_ms(value: ValueRef<'_>) -> Option<i64> {
    let number = match value {
        ValueRef::Integer(number) => number as f64,
        ValueRef::Real(number) => number,
        ValueRef::Text(bytes) => String::from_utf8_lossy(bytes).trim().parse::<f64>().ok()?,
        _ => return None,
    };
    if !number.is_finite() || number <= 0.0 {
        return None;
    }
    let seconds = if number > 10_000_000_000.0 {
        number / 1000.0
    } else {
        number
    };
    Some(((seconds + 978_307_200.0) * 1000.0).round() as i64)
}

pub fn read(limit: usize) -> SnapshotResult {
    let source = database_path().ok_or_else(|| "home directory not found".to_string())?;
    if !source.is_file() {
        return Err("Notification Center database not found".to_string());
    }
    let temp = util::TempDir::create("dsh-probe-nc")?;
    let target = temp.path().join("db");
    util::copy_sqlite_database(&source, &target)?;
    let connection = Connection::open_with_flags(&target, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| {
            format!(
                "Notification Center is not readable (grant Full Disk Access to the DSH host): {error}"
            )
        })?;

    let table_names = tables(&connection);
    let record_table = table_names
        .iter()
        .find(|name| name.eq_ignore_ascii_case("record"))
        .or_else(|| {
            table_names
                .iter()
                .find(|name| name.to_lowercase().contains("record"))
        })
        .ok_or_else(|| "Notification Center record table not found".to_string())?
        .clone();
    let record_columns = columns(&connection, &record_table);
    let data_column = pick_column(&record_columns, |name| {
        name == "data" || name == "plist" || name == "record"
    })
    .or_else(|| pick_column(&record_columns, |name| name.contains("data")))
    .ok_or_else(|| "Notification Center payload column not found".to_string())?
    .to_string();
    let app_column = pick_column(&record_columns, |name| {
        (name.contains("app") && (name.contains("id") || name.contains("bundle")))
            || name.contains("bundle")
    })
    .map(str::to_string);
    let date_column = pick_column(&record_columns, |name| {
        name.contains("deliver") || name.contains("date") || name.contains("time")
    })
    .map(str::to_string);

    let mut select = format!("{} as payload", quote(&data_column));
    select.push_str(&format!(
        ", {} as appId",
        app_column
            .as_deref()
            .map(quote)
            .unwrap_or_else(|| "''".to_string())
    ));
    select.push_str(&format!(
        ", {} as deliveredAt",
        date_column
            .as_deref()
            .map(quote)
            .unwrap_or_else(|| "0".to_string())
    ));
    let order = date_column
        .as_deref()
        .map(quote)
        .unwrap_or_else(|| "rowid".to_string());
    let sql = format!(
        "select {select} from {} order by {order} desc limit ?1",
        quote(&record_table)
    );
    let fetch = (limit.saturating_mul(3)).max(24) as i64;
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("notification query failed: {error}"))?;
    let rows = statement
        .query_map([fetch], |row| {
            Ok((
                value_bytes(row.get_ref(0)?).unwrap_or_default(),
                value_string(row.get_ref(1)?).unwrap_or_default(),
                apple_time_to_ms(row.get_ref(2)?),
            ))
        })
        .map_err(|error| format!("notification query failed: {error}"))?;

    let mut app_table_names = std::collections::HashMap::new();
    if let Some(app_table) = table_names
        .iter()
        .find(|name| name.eq_ignore_ascii_case("app"))
    {
        let app_columns = columns(&connection, app_table);
        let id_column = pick_column(&app_columns, |name| {
            name.contains("identifier") || name.contains("bundle")
        });
        let name_column = pick_column(&app_columns, |name| {
            name.contains("name") || name.contains("display")
        });
        if let (Some(id_column), Some(name_column)) = (id_column, name_column) {
            let sql = format!(
                "select {}, {} from {}",
                quote(id_column),
                quote(name_column),
                quote(app_table)
            );
            if let Ok(mut app_statement) = connection.prepare(&sql) {
                if let Ok(app_rows) = app_statement.query_map([], |row| {
                    Ok((
                        value_string(row.get_ref(0)?).unwrap_or_default(),
                        value_string(row.get_ref(1)?).unwrap_or_default(),
                    ))
                }) {
                    for (key, name) in app_rows.flatten() {
                        if !key.is_empty() && !name.is_empty() {
                            app_table_names.insert(key, name);
                        }
                    }
                }
            }
        }
    }

    let now = util::now_ms();
    let mut notifications = Vec::new();
    for (payload, app_id, delivered_at) in rows.flatten() {
        if payload.is_empty() {
            continue;
        }
        let Some((title, subtitle, body)) = parse_payload(&payload) else {
            continue;
        };
        if title.is_empty() && body.is_empty() && subtitle.is_empty() {
            continue;
        }
        let app_key = if app_id.trim().is_empty() {
            "macOS".to_string()
        } else {
            app_id.trim().to_string()
        };
        let app_name = app_name(&app_key, &app_table_names);
        let title = if title.is_empty() {
            app_name.clone()
        } else {
            title
        };
        let body = [subtitle, body]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("  ");
        let received_at = delivered_at.unwrap_or(now);
        notifications.push(NotificationItem {
            id: format!("{received_at}-{}", notifications.len()),
            app_key,
            app_name,
            title: truncate(&title, 160),
            body: truncate(&body, 260),
            avatar: None,
            has_image: false,
            received_at,
            is_group: false,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_apple_epoch_times() {
        // 2024-01-01T00:00:00Z is 726_537_600 seconds after the 2001 epoch.
        assert_eq!(
            apple_time_to_ms(ValueRef::Real(726_537_600.0)),
            Some(1_704_067_200_000)
        );
        // Millisecond values are detected and normalized.
        assert_eq!(
            apple_time_to_ms(ValueRef::Integer(1_704_067_200_000)),
            Some(1_704_067_200_000)
        );
    }

    #[test]
    fn picks_nested_plist_strings() {
        let plist = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>req</key><dict>
<key>titl</key><dict><key>string</key><string>Hello</string></dict>
<key>body</key><string>World</string>
</dict></dict></plist>"#;
        let value = Value::from_reader(std::io::Cursor::new(plist.as_bytes())).unwrap();
        let root = value.as_dictionary().unwrap();
        let request = root.get("req").and_then(Value::as_dictionary).unwrap();
        assert_eq!(pick_string(request, &["titl"]), "Hello");
        assert_eq!(pick_string(request, &["body"]), "World");
    }

    #[test]
    fn derives_app_names() {
        let names = std::collections::HashMap::new();
        assert_eq!(app_name("com.apple.Music", &names), "音乐");
        assert_eq!(app_name("com.example.SomeApp", &names), "SomeApp");
    }
}
