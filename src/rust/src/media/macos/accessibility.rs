//! macOS accessibility tier.
//!
//! MediaRemote (`nowplaying-cli`) is the system interface and normally provides
//! a complete timeline. When it cannot identify a track (notably Cider, an
//! Apple Music client), UI scripting through `System Events` is the last resort.
//! It reads a `MM:SS | MM:SS` label only: it never sends a transport action and
//! never grants seek.
//!
//! The script is wrapped in a hard timeout because accessibility queries can
//! block while the target application is busy.

use std::time::Duration;

use crate::media::catalog;
use crate::util;

const SCRIPT: &str = r#"
on run argv
  set targetName to item 1 of argv
  tell application "System Events"
    if not (exists process targetName) then return ""
    tell process targetName
      repeat with w in windows
        try
          repeat with e in (entire contents of w)
            try
              if class of e is static text then
                set candidates to {value of e, name of e}
                repeat with candidate in candidates
                  try
                    if candidate is not missing value then
                      set textValue to candidate as string
                      if textValue contains ":" and (textValue contains "/" or textValue contains "|") then
                        return textValue
                      end if
                    end if
                  end try
                end repeat
              end if
            end try
          end repeat
        end try
      end repeat
    end tell
  end tell
  return ""
end run
"#;

/// Read progress from the accessibility tree of one macOS application.
pub fn progress(process_name: &str) -> Option<(f64, f64)> {
    let output = util::command_output_timeout(
        "/usr/bin/osascript",
        &["-e", SCRIPT, process_name],
        Duration::from_millis(1500),
    )
    .ok()?;
    catalog::parse_progress_text(output.trim())
}
