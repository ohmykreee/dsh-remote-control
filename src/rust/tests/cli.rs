//! End-to-end checks that every invocation prints one parseable JSON line.

use std::process::Command;

fn run(args: &[&str]) -> (std::process::Output, serde_json::Value) {
    let output = Command::new(env!("CARGO_BIN_EXE_dsh-probe"))
        .args(args)
        .output()
        .expect("failed to run dsh-probe");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
        .unwrap_or_else(|| panic!("no JSON on stdout for {args:?}: {stdout}"));
    let value = serde_json::from_str(line).expect("stdout was not valid JSON");
    (output, value)
}

#[test]
fn version_reports_platform() {
    let (output, value) = run(&["version"]);
    assert!(output.status.success());
    assert_eq!(value["ok"], true);
    assert_eq!(value["name"], "dsh-probe");
    assert_eq!(value["os"], std::env::consts::OS);
    assert!(value["media"].as_str().is_some());
}

#[test]
fn help_is_json() {
    let (output, value) = run(&["--help"]);
    assert!(output.status.success());
    assert_eq!(value["ok"], true);
    assert!(value["help"].as_str().unwrap().contains("volume"));
}

#[test]
fn unknown_command_is_a_usage_error() {
    let (output, value) = run(&["not-a-command"]);
    assert_eq!(output.status.code(), Some(2));
    assert_eq!(value["ok"], false);
    assert_eq!(value["usageError"], true);
    assert!(value["error"].as_str().unwrap().contains("unknown command"));
}

#[test]
fn volume_and_performance_emit_json() {
    for command in ["volume", "performance"] {
        let (output, value) = run(&[command, "read"]);
        assert!(
            output.status.success(),
            "{command} exited with {:?}",
            output.status
        );
        assert!(value.get("ok").is_some());
        assert!(value.get("sampledAt").is_some());
    }
}

#[test]
fn location_and_notifications_emit_json() {
    for args in [&["location"][..], &["notifications", "--limit", "2"][..]] {
        let (output, value) = run(args);
        assert!(
            output.status.success(),
            "{args:?} exited with {:?}",
            output.status
        );
        assert!(value.get("ok").is_some(), "{args:?} missing ok");
        assert!(
            value.get("sampledAt").is_some(),
            "{args:?} missing sampledAt"
        );
    }
    let (_, value) = run(&["notifications", "--limit", "2"]);
    assert!(value["notifications"].as_array().is_some());
    assert!(value["apps"].as_array().is_some());
}
