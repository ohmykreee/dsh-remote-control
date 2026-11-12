//! `dsh-probe`: native OS probe sidecar for the DSH LAN console.
//!
//! The Node host executes this binary with a subcommand and parses one line of
//! JSON from stdout. Native OS APIs are used per platform:
//!   * Windows: WinRT SMTC, Core Audio (WASAPI endpoint), Win32 power info
//!   * Linux:   MPRIS over D-Bus (zbus), wpctl/pactl/amixer, /proc + sysfs
//!   * macOS:   nowplaying-cli/osascript (source only, untested)
//!
//! WASM is deliberately not used: WinRT, Core Audio, D-Bus and IOKit are not
//! reachable from a WebAssembly sandbox.

mod cli;
mod daemon;
mod location;
mod media;
mod notifications;
mod perf;
mod util;
mod volume;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // The long-lived mode must own stdout (JSON lines) and stdin (requests);
    // it never returns through the one-shot printing path below.
    if args.first().map(String::as_str) == Some("daemon") {
        std::process::exit(daemon::run());
    }
    let (value, exit_code) = cli::dispatch(&args);
    match serde_json::to_string(&value) {
        Ok(text) => println!("{text}"),
        Err(error) => {
            // serde_json only fails here if a custom value contains invalid data;
            // still emit something the bridge can parse.
            println!(
                "{{\"ok\":false,\"error\":{}}}",
                serde_json::Value::String(format!("failed to encode probe result: {error}"))
            );
            std::process::exit(1);
        }
    }
    std::process::exit(exit_code);
}
