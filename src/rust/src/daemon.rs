//! Persistent probe mode: newline-delimited JSON over stdin/stdout.
//!
//! The host starts `dsh-probe daemon` once and keeps it alive, sending one
//! request per line instead of paying process startup plus platform sampler
//! warm-up on every poll:
//!
//! ```text
//! -> {"id":1,"argv":["performance"]}
//! <- {"id":1,"ok":true,"result":{...}}
//! ```
//!
//! The first line on stdout is a `ready` event. Requests are handled in order
//! on the same thread so platform sampler caches (sysinfo, PDH handles, D-Bus
//! connections) stay warm. A malformed request is rejected without exiting;
//! the host closes stdin to stop the daemon. The daemon never opens a socket:
//! all traffic stays on the inherited stdio pipes.

use std::io::{self, BufRead, Write};

use serde_json::{json, Value};

use crate::cli;

/// Bumped only when the request/response shape changes incompatibly.
pub const PROTOCOL_VERSION: u32 = 1;

/// Run the daemon loop until stdin reaches EOF or a pipe error occurs.
pub fn run() -> i32 {
    let stdout = io::stdout();
    let mut output = stdout.lock();
    let ready = json!({
        "event": "ready",
        "ok": true,
        "protocol": PROTOCOL_VERSION,
        "version": env!("CARGO_PKG_VERSION"),
        "pid": std::process::id(),
    });
    if write_message(&mut output, &ready).is_err() {
        return 0;
    }

    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => break,
        }
        let request = line.trim();
        if request.is_empty() {
            continue;
        }
        let response = handle_request(request);
        if write_message(&mut output, &response).is_err() {
            break;
        }
    }
    0
}

fn write_message(output: &mut impl Write, value: &Value) -> io::Result<()> {
    serde_json::to_writer(&mut *output, value)?;
    output.write_all(b"\n")?;
    output.flush()
}

fn error_response(id: Value, message: impl Into<String>) -> Value {
    json!({ "id": id, "ok": false, "error": message.into() })
}

fn handle_request(line: &str) -> Value {
    let request: Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(error) => {
            return error_response(Value::Null, format!("invalid request JSON: {error}"));
        }
    };
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let Some(argv) = request.get("argv").and_then(Value::as_array) else {
        return error_response(id, "request.argv must be an array of strings");
    };
    let mut args = Vec::with_capacity(argv.len());
    for item in argv {
        match item.as_str() {
            Some(value) => args.push(value.to_string()),
            None => return error_response(id, "request.argv entries must be strings"),
        }
    }
    if args.is_empty() {
        return error_response(id, "request.argv must not be empty");
    }

    // `dispatch` already turns probe failures and usage errors into a JSON
    // payload; keep that payload nested under `result` so the host sees exactly
    // what one-shot mode would have printed.
    let (result, _exit_code) = cli::dispatch(&args);
    json!({ "id": id, "ok": true, "result": result })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_request_returns_a_result_payload() {
        let response = handle_request(r#"{"id":7,"argv":["version"]}"#);
        assert_eq!(response["id"], 7);
        assert_eq!(response["ok"], true);
        assert_eq!(response["result"]["name"], "dsh-probe");
        assert_eq!(response["result"]["ok"], true);
    }

    #[test]
    fn malformed_json_is_rejected_without_panicking() {
        let response = handle_request("{");
        assert_eq!(response["ok"], false);
        assert!(response["error"]
            .as_str()
            .unwrap()
            .contains("invalid request"));
    }

    #[test]
    fn non_string_argv_is_rejected() {
        let response = handle_request(r#"{"id":1,"argv":["performance",3]}"#);
        assert_eq!(response["ok"], false);
        assert_eq!(response["id"], 1);
    }

    #[test]
    fn usage_errors_stay_inside_the_result() {
        let response = handle_request(r#"{"id":"x","argv":["not-a-command"]}"#);
        assert_eq!(response["ok"], true);
        assert_eq!(response["result"]["ok"], false);
        assert_eq!(response["result"]["usageError"], true);
    }
}
