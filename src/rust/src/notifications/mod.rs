//! Notification history/live feed probe.
//!
//! * Windows: the notification center SQLite database (`wpndatabase.db`).
//! * Linux: the session D-Bus `org.freedesktop.Notifications` traffic, observed
//!   through `org.freedesktop.DBus.Monitoring.BecomeMonitor` (zbus).
//! * macOS: the Notification Center SQLite database (source only, untested).
//!
//! `notifications` returns a snapshot; `notifications watch` streams a JSON line
//! per update (Linux only) so the Node service does not need an external
//! `dbus-monitor` process.

use serde::Serialize;
use serde_json::{json, Value};

use crate::cli::{action_of, option_number, CliError, CliResult};
use crate::util;

#[cfg(windows)]
#[path = "windows.rs"]
mod platform;
#[cfg(target_os = "linux")]
#[path = "linux.rs"]
mod platform;
#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod platform;

#[cfg(all(feature = "macos-check", not(target_os = "macos")))]
#[allow(dead_code)]
#[path = "macos.rs"]
mod macos_preview;

/// One normalized notification.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotificationItem {
    pub id: String,
    pub app_key: String,
    pub app_name: String,
    pub title: String,
    pub body: String,
    pub avatar: Option<String>,
    pub has_image: bool,
    pub received_at: i64,
    pub is_group: bool,
}

/// Aggregated per-application counts for the notification filter UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationApp {
    pub key: String,
    pub name: String,
    pub count: usize,
}

pub struct Snapshot {
    pub source: &'static str,
    pub live_only: bool,
    pub notifications: Vec<NotificationItem>,
    pub updated_at: i64,
}

pub type SnapshotResult = Result<Snapshot, String>;

pub fn limit_from_args(args: &[String]) -> usize {
    let requested = option_number(args, "--limit").unwrap_or(8.0);
    clamp_limit(requested)
}

pub fn clamp_limit(value: f64) -> usize {
    if !value.is_finite() {
        return 8;
    }
    (value as i64).clamp(1, 20) as usize
}

/// Truncate without splitting a UTF-8 character, appending an ellipsis.
pub fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let limit = max_chars.saturating_sub(1);
    let mut result: String = text.chars().take(limit).collect();
    result.push('…');
    result
}

pub fn apps_for(items: &[NotificationItem]) -> Vec<NotificationApp> {
    let mut apps: Vec<NotificationApp> = Vec::new();
    for item in items {
        if let Some(app) = apps.iter_mut().find(|app| app.key == item.app_key) {
            app.count += 1;
        } else {
            apps.push(NotificationApp {
                key: item.app_key.clone(),
                name: item.app_name.clone(),
                count: 1,
            });
        }
    }
    apps.sort_by(|left, right| right.count.cmp(&left.count));
    apps
}

pub fn snapshot_json(snapshot: &Snapshot, limit: usize, sampled_at: i64) -> Value {
    let items = &snapshot.notifications[..snapshot.notifications.len().min(limit)];
    json!({
        "ok": true,
        "available": true,
        "reason": null,
        "error": null,
        "source": snapshot.source,
        "liveOnly": snapshot.live_only,
        "notifications": items,
        "apps": apps_for(items),
        "limit": limit,
        "updatedAt": if snapshot.updated_at > 0 { snapshot.updated_at } else { sampled_at },
        "sampledAt": sampled_at,
    })
}

pub fn error_json(
    reason: &str,
    source: &str,
    live_only: bool,
    limit: usize,
    sampled_at: i64,
) -> Value {
    json!({
        "ok": false,
        "available": false,
        "reason": reason,
        "error": reason,
        "source": source,
        "liveOnly": live_only,
        "notifications": [],
        "apps": [],
        "limit": limit,
        "updatedAt": sampled_at,
        "sampledAt": sampled_at,
    })
}

fn read(limit: usize, sampled_at: i64) -> Value {
    match platform::read(limit) {
        Ok(snapshot) => snapshot_json(&snapshot, limit, sampled_at),
        Err(error) => error_json(
            &error,
            platform::SOURCE,
            platform::LIVE_ONLY,
            limit,
            sampled_at,
        ),
    }
}

pub fn cli(args: &[String], _started_at: i64) -> CliResult {
    let action = action_of(args);
    let limit = limit_from_args(args);
    let sampled_at = util::now_ms();
    match action.as_str() {
        "read" => Ok(read(limit, sampled_at)),
        "watch" => platform::watch(limit),
        other => Err(CliError::usage(format!(
            "unsupported notifications action: {other} (expected read, watch)"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(app: &str, name: &str, title: &str) -> NotificationItem {
        NotificationItem {
            id: format!("{name}-{title}"),
            app_key: app.to_string(),
            app_name: name.to_string(),
            title: title.to_string(),
            body: String::new(),
            avatar: None,
            has_image: false,
            received_at: 1,
            is_group: false,
        }
    }

    #[test]
    fn clamps_limits() {
        assert_eq!(clamp_limit(f64::NAN), 8);
        assert_eq!(clamp_limit(0.2), 1);
        assert_eq!(clamp_limit(9.9), 9);
        assert_eq!(clamp_limit(100.0), 20);
    }

    #[test]
    fn truncates_on_character_boundaries() {
        assert_eq!(truncate("hello", 10), "hello");
        assert_eq!(truncate("hello", 4), "hel…");
        assert_eq!(truncate("网易云音乐", 3), "网易…");
    }

    #[test]
    fn aggregates_apps_by_count() {
        let items = vec![
            item("qq", "QQ", "a"),
            item("wx", "微信", "b"),
            item("qq", "QQ", "c"),
        ];
        let apps = apps_for(&items);
        assert_eq!(apps[0].key, "qq");
        assert_eq!(apps[0].count, 2);
        assert_eq!(apps[1].key, "wx");
    }

    #[test]
    fn snapshot_applies_limit_and_shape() {
        let snapshot = Snapshot {
            source: "test",
            live_only: false,
            notifications: vec![item("a", "A", "one"), item("b", "B", "two")],
            updated_at: 123,
        };
        let value = snapshot_json(&snapshot, 1, 456);
        assert_eq!(value["ok"], true);
        assert_eq!(value["available"], true);
        assert_eq!(value["liveOnly"], false);
        assert_eq!(value["notifications"].as_array().unwrap().len(), 1);
        assert_eq!(value["apps"][0]["key"], "a");
        assert_eq!(value["updatedAt"], 123);
        assert_eq!(value["sampledAt"], 456);
    }

    #[test]
    fn error_shape_keeps_reason_and_error() {
        let value = error_json("no dbus", "test", true, 8, 9);
        assert_eq!(value["ok"], false);
        assert_eq!(value["available"], false);
        assert_eq!(value["reason"], "no dbus");
        assert_eq!(value["error"], "no dbus");
        assert_eq!(value["notifications"].as_array().unwrap().len(), 0);
    }
}
