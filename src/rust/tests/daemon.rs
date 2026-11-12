//! End-to-end checks for the persistent `daemon` protocol.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

use serde_json::{json, Value};

fn start() -> (Child, Receiver<String>, ChildStdin) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_dsh-probe"))
        .arg("daemon")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to start dsh-probe daemon");
    let stdout = child.stdout.take().expect("stdout");
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(line) => {
                    if sender.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    let stdin = child.stdin.take().expect("stdin");
    (child, receiver, stdin)
}

fn next(receiver: &Receiver<String>) -> Value {
    let line = receiver
        .recv_timeout(Duration::from_secs(20))
        .expect("daemon produced no response");
    serde_json::from_str(&line).expect("daemon response was not JSON")
}

fn send(stdin: &mut ChildStdin, request: Value) {
    writeln!(stdin, "{request}").expect("write request");
    stdin.flush().expect("flush request");
}

fn wait_with_timeout(child: &mut Child) -> bool {
    for _ in 0..100 {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => return false,
        }
    }
    let _ = child.kill();
    false
}

#[test]
fn daemon_answers_requests_and_exits_on_eof() {
    let (mut child, responses, mut stdin) = start();

    let ready = next(&responses);
    assert_eq!(ready["event"], "ready");
    assert_eq!(ready["ok"], true);
    assert_eq!(ready["protocol"], 1);
    assert!(ready["pid"].as_u64().is_some());

    send(&mut stdin, json!({"id": 1, "argv": ["version"]}));
    let version = next(&responses);
    assert_eq!(version["id"], 1);
    assert_eq!(version["ok"], true);
    assert_eq!(version["result"]["name"], "dsh-probe");

    // Two performance requests share one process and its sampler baseline.
    for id in [2, 3] {
        send(&mut stdin, json!({"id": id, "argv": ["performance"]}));
        let performance = next(&responses);
        assert_eq!(performance["id"], id);
        assert_eq!(performance["ok"], true);
        assert!(performance["result"].get("cpu").is_some());
        assert!(performance["result"].get("memory").is_some());
    }

    // A malformed request is rejected but must not stop the daemon.
    stdin.write_all(b"{not json}\n").expect("write garbage");
    stdin.flush().expect("flush garbage");
    let failure = next(&responses);
    assert_eq!(failure["ok"], false);
    assert!(failure["error"]
        .as_str()
        .unwrap_or_default()
        .contains("invalid request"));

    send(&mut stdin, json!({"id": "last", "argv": ["version"]}));
    let version = next(&responses);
    assert_eq!(version["id"], "last");
    assert_eq!(version["result"]["ok"], true);

    drop(stdin);
    assert!(
        wait_with_timeout(&mut child),
        "daemon did not exit after stdin EOF"
    );
}
