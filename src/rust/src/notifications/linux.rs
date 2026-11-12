//! Linux notification probe: watch `org.freedesktop.Notifications`.
//!
//! `Notify` is a method call to the desktop notification daemon, so a normal
//! D-Bus client cannot observe it. The probe turns its connection into a bus
//! monitor with `org.freedesktop.DBus.Monitoring.BecomeMonitor` (the same
//! mechanism `dbus-monitor` uses) and filters for `Notify` calls.
//!
//! `notifications watch` streams one JSON snapshot per notification, which is
//! what the Node service consumes. `notifications` samples a short window and
//! returns whatever arrived in it (there is no portable history API).

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

use zbus::blocking::{Connection, MessageIterator};
use zbus::message::Message;
use zbus::zvariant::OwnedValue;

use super::{snapshot_json, NotificationItem, Snapshot, SnapshotResult};
use crate::cli::CliResult;
use crate::util;

pub const SOURCE: &str = "linux-dbus-notifications";
pub const LIVE_ONLY: bool = true;

const SNAPSHOT_WINDOW_MS: u64 = 1200;
const MAX_ICON_BYTES: u64 = 512 * 1024;
const NOTIFY_RULE: &str =
    "type='method_call',interface='org.freedesktop.Notifications',member='Notify'";

/// D-Bus `Notify` signature: susssasa{sv}i.
type NotifyBody = (
    String,
    u32,
    String,
    String,
    String,
    Vec<String>,
    HashMap<String, OwnedValue>,
    i32,
);

fn monitor() -> Result<Receiver<Message>, String> {
    let connection =
        Connection::session().map_err(|error| format!("D-Bus session unavailable: {error}"))?;
    connection
        .call_method(
            Some("org.freedesktop.DBus"),
            "/org/freedesktop/DBus",
            Some("org.freedesktop.DBus.Monitoring"),
            "BecomeMonitor",
            &(&[NOTIFY_RULE] as &[&str], 0u32),
        )
        .map_err(|error| format!("could not monitor org.freedesktop.Notifications: {error}"))?;

    let (sender, receiver) = channel();
    std::thread::spawn(move || {
        let iterator = MessageIterator::from(connection);
        for message in iterator {
            let Ok(message) = message else {
                break;
            };
            if sender.send(message).is_err() {
                break;
            }
        }
    });
    Ok(receiver)
}

fn read_icon_source(source: &str) -> Option<String> {
    let source = source.trim();
    if source.is_empty() {
        return None;
    }
    let path: PathBuf = if source.starts_with("file://") {
        util::file_url_to_path(source)?
    } else {
        PathBuf::from(source)
    };
    if !path.is_absolute() {
        // A themed icon name (for example "firefox") is not a file path.
        return None;
    }
    util::file_image_data_url(&path, MAX_ICON_BYTES)
}

fn hint_string(hints: &HashMap<String, OwnedValue>, key: &str) -> Option<String> {
    let value = hints.get(key)?.try_clone().ok()?;
    String::try_from(value).ok()
}

fn hint_icon(hints: &HashMap<String, OwnedValue>) -> Option<String> {
    for key in ["image-path", "image_path", "imagePath"] {
        if let Some(source) = hint_string(hints, key) {
            if let Some(icon) = read_icon_source(&source) {
                return Some(icon);
            }
        }
    }
    None
}

fn item_from_message(message: &Message, counter: u64) -> Option<NotificationItem> {
    let header = message.header();
    if header.member().map(|member| member.as_str()) != Some("Notify") {
        return None;
    }
    let body: NotifyBody = message.body().deserialize().ok()?;
    let (app_name, _replaces_id, app_icon, summary, body_text, _actions, hints, _timeout) = body;
    let app_name = app_name.trim();
    let app_name = if app_name.is_empty() {
        "通知".to_string()
    } else {
        app_name.to_string()
    };
    let title = if summary.trim().is_empty() {
        app_name.clone()
    } else {
        summary.trim().to_string()
    };
    let body_text = body_text.trim().to_string();
    let avatar = read_icon_source(&app_icon).or_else(|| hint_icon(&hints));
    let has_image = avatar.is_some()
        || hints.contains_key("image-data")
        || hints.contains_key("image_data")
        || hints.contains_key("image-path")
        || hints.contains_key("image_path");
    let received_at = util::now_ms();
    Some(NotificationItem {
        id: format!("{received_at}-{counter}"),
        app_key: app_name.clone(),
        app_name,
        title: super::truncate(&title, 160),
        body: super::truncate(&body_text, 260),
        avatar,
        has_image,
        received_at,
        is_group: false,
    })
}

fn push_item(items: &mut Vec<NotificationItem>, item: NotificationItem, limit: usize) {
    items.insert(0, item);
    items.truncate(limit);
}

/// Sample live notifications for a short window.
pub fn read(limit: usize) -> SnapshotResult {
    let receiver = monitor()?;
    let deadline = Instant::now() + Duration::from_millis(SNAPSHOT_WINDOW_MS);
    let mut items = Vec::new();
    let mut counter = 0_u64;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match receiver.recv_timeout(remaining) {
            Ok(message) => {
                if let Some(item) = item_from_message(&message, counter) {
                    counter += 1;
                    push_item(&mut items, item, limit);
                }
            }
            Err(_) => break,
        }
    }
    Ok(Snapshot {
        source: SOURCE,
        live_only: LIVE_ONLY,
        notifications: items,
        updated_at: util::now_ms(),
    })
}

fn print_json(value: &serde_json::Value) {
    match serde_json::to_string(value) {
        Ok(line) => {
            println!("{line}");
            let _ = std::io::stdout().flush();
        }
        Err(error) => {
            eprintln!("could not encode notification snapshot: {error}");
        }
    }
}

fn print_snapshot(snapshot: &Snapshot, limit: usize) {
    print_json(&snapshot_json(snapshot, limit, util::now_ms()));
}

/// Print the notification-shaped error and exit; the Node service reads the
/// error from the stream instead of the generic CLI error envelope.
fn fail(error: &str, limit: usize) -> ! {
    print_json(&super::error_json(
        error,
        SOURCE,
        LIVE_ONLY,
        limit,
        util::now_ms(),
    ));
    std::process::exit(1);
}

/// Stream snapshots until the monitor connection closes.
pub fn watch(limit: usize) -> CliResult {
    let receiver = match monitor() {
        Ok(receiver) => receiver,
        Err(error) => fail(&error, limit),
    };
    let mut items: Vec<NotificationItem> = Vec::new();
    let mut counter = 0_u64;
    print_snapshot(
        &Snapshot {
            source: SOURCE,
            live_only: LIVE_ONLY,
            notifications: Vec::new(),
            updated_at: util::now_ms(),
        },
        limit,
    );
    for message in receiver {
        if let Some(item) = item_from_message(&message, counter) {
            counter += 1;
            push_item(&mut items, item, limit);
            print_snapshot(
                &Snapshot {
                    source: SOURCE,
                    live_only: LIVE_ONLY,
                    notifications: items.clone(),
                    updated_at: util::now_ms(),
                },
                limit,
            );
        }
    }
    fail("notification monitor ended (D-Bus session closed)", limit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_themed_icon_names_and_missing_files() {
        assert!(read_icon_source("firefox").is_none());
        assert!(read_icon_source("/nonexistent/dsh-probe/icon.png").is_none());
    }

    #[test]
    fn keeps_only_the_most_recent_items() {
        let mut items = Vec::new();
        for index in 0..3 {
            push_item(
                &mut items,
                NotificationItem {
                    id: index.to_string(),
                    ..Default::default()
                },
                2,
            );
        }
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "2");
    }

    #[test]
    fn notification_rule_targets_notify_calls() {
        assert!(NOTIFY_RULE.contains("member='Notify'"));
        assert!(NOTIFY_RULE.contains("org.freedesktop.Notifications"));
    }
}
