//! Small shared helpers: time, numbers, image sniffing/data URLs, commands.
//!
//! Some helpers are only used by the Linux/macOS probes; the Windows build still
//! compiles this module with them present.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;

/// Current UNIX time in milliseconds.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Convert a WinRT `TimeSpan` (100 ns ticks) to seconds.
pub fn ticks_to_seconds(ticks: i64) -> f64 {
    ticks as f64 / 10_000_000.0
}

/// Convert a WinRT `DateTime` (100 ns ticks since 1601-01-01 UTC) to UNIX ms.
pub fn winrt_time_to_unix_ms(universal_time: i64) -> i64 {
    universal_time / 10_000 - 11_644_473_600_000
}

/// Round to one decimal place, the precision used by the original probes.
pub fn round1(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }
    (value * 10.0).round() / 10.0
}

/// Clamp a value into `[low, high]`, ignoring NaN by returning `low`.
pub fn clamp(value: f64, low: f64, high: f64) -> f64 {
    if value.is_nan() {
        low
    } else {
        value.max(low).min(high)
    }
}

/// Detect an image MIME type from the magic bytes we can render in a browser.
pub fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("image/bmp");
    }
    if bytes.len() > 12
        && &bytes[4..8] == b"ftyp"
        && (&bytes[8..12] == b"avif" || &bytes[8..12] == b"avis")
    {
        return Some("image/avif");
    }
    None
}

/// Build a `data:` URL for image bytes, or `None` when the type is unknown.
pub fn image_data_url(bytes: &[u8]) -> Option<String> {
    let mime = sniff_image_mime(bytes)?;
    Some(data_url(mime, bytes))
}

/// Build a `data:<mime>;base64,` URL.
pub fn data_url(mime: &str, bytes: &[u8]) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{mime};base64,{encoded}")
}

/// Read a local image file into a data URL, capped by `max_bytes`.
pub fn file_image_data_url(path: &Path, max_bytes: u64) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > max_bytes {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    image_data_url(&bytes)
}

/// Decode a `file://` URL into a path (percent-decoding `%20` style escapes).
pub fn file_url_to_path(url: &str) -> Option<PathBuf> {
    let raw = url.strip_prefix("file://")?;
    // file:///home/x -> /home/x, file://localhost/home/x -> /home/x
    let raw = raw.strip_prefix("localhost").unwrap_or(raw);
    Some(PathBuf::from(percent_decode(raw)))
}

/// Minimal percent-decoder for file URLs; returns the input when malformed.
pub fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
            if let Some(value) = hex.and_then(|hex| u8::from_str_radix(hex, 16).ok()) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The current user's home directory, without pulling in a `dirs` dependency.
pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

/// A temporary directory that removes itself (and its contents) on drop.
pub struct TempDir {
    path: PathBuf,
}

impl TempDir {
    pub fn create(prefix: &str) -> Result<Self, String> {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        // The DSH sandbox can deny writes to the system temp directory for
        // binaries living under the plugin workspace. The probe therefore
        // accepts a host-provided directory (`DSH_RC_TMPDIR`) and falls back to
        // the working directory / executable directory, both of which are
        // writable for an installed plugin.
        let mut bases: Vec<PathBuf> = Vec::new();
        if let Some(configured) = std::env::var_os("DSH_RC_TMPDIR") {
            if !configured.is_empty() {
                bases.push(PathBuf::from(configured));
            }
        }
        bases.push(std::env::temp_dir());
        if let Ok(current) = std::env::current_dir() {
            bases.push(current);
        }
        if let Ok(executable) = std::env::current_exe() {
            if let Some(directory) = executable.parent() {
                bases.push(directory.to_path_buf());
            }
        }

        let mut last_error = String::new();
        for base in bases {
            let _ = std::fs::create_dir_all(&base);
            for attempt in 0..8 {
                let unique = format!(
                    "{prefix}-{}-{}-{}-{attempt}",
                    std::process::id(),
                    now_ms(),
                    COUNTER.fetch_add(1, Ordering::Relaxed)
                );
                let path = base.join(unique);
                match std::fs::create_dir(&path) {
                    Ok(()) => return Ok(Self { path }),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => {
                        last_error = format!(
                            "could not create temporary directory {}: {error}",
                            path.display()
                        );
                        break;
                    }
                }
            }
        }
        Err(if last_error.is_empty() {
            "could not create a unique temporary directory".to_string()
        } else {
            last_error
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Copy `source` into `target`, including the `-wal`/`-shm` sidecars SQLite may
/// keep open. A missing sidecar is not an error: the main database is still
/// readable.
pub fn copy_sqlite_database(source: &Path, target: &Path) -> Result<(), String> {
    std::fs::copy(source, target)
        .map_err(|error| format!("could not copy {}: {error}", source.display()))?;
    let source_text = source.to_string_lossy();
    let target_text = target.to_string_lossy();
    for suffix in ["-wal", "-shm"] {
        let extra = format!("{source_text}{suffix}");
        if Path::new(&extra).is_file() {
            let _ = std::fs::copy(&extra, format!("{target_text}{suffix}"));
        }
    }
    Ok(())
}

/// Look up an executable on `PATH` without spawning a shell.
pub fn find_executable(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file())
}

/// Run a command and return trimmed stdout, or a readable error.
pub fn command_output(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("{program}: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr.trim();
        return Err(if message.is_empty() {
            format!("{program} exited with {}", output.status)
        } else {
            format!("{program}: {message}")
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Run a command that already includes its resolved path.
pub fn run_path_command(program: &Path, args: &[&str]) -> Result<String, String> {
    let program = program.to_string_lossy();
    command_output(&program, args)
}

/// Run a command with a hard timeout. Used by the macOS accessibility reader:
/// UI scripting can block for seconds when an application is busy, and a
/// display-only progress read must never stall the probe.
pub fn command_output_timeout(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let mut child = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("{program}: {error}"))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|error| format!("{program}: {error}"))?;
                if !status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let message = stderr.trim();
                    return Err(if message.is_empty() {
                        format!("{program} exited with {status}")
                    } else {
                        format!("{program}: {message}")
                    });
                }
                return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
            }
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "{program} timed out after {} ms",
                        timeout.as_millis()
                    ));
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(error) => return Err(format!("{program}: {error}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_winrt_time() {
        // 2024-01-01T00:00:00Z
        let ticks = 133_485_408_000_000_000_i64;
        assert_eq!(winrt_time_to_unix_ms(ticks), 1_704_067_200_000);
    }

    #[test]
    fn converts_ticks() {
        assert!((ticks_to_seconds(15_000_000) - 1.5).abs() < f64::EPSILON);
    }

    #[test]
    fn sniffs_common_images() {
        assert_eq!(
            sniff_image_mime(&[0xFF, 0xD8, 0xFF, 0xE0]),
            Some("image/jpeg")
        );
        assert_eq!(
            sniff_image_mime(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
            Some("image/png")
        );
        assert_eq!(sniff_image_mime(b"not an image"), None);
    }

    #[test]
    fn makes_data_url() {
        assert_eq!(
            data_url("image/png", &[1, 2, 3]),
            "data:image/png;base64,AQID"
        );
    }

    #[test]
    fn decodes_file_urls() {
        assert_eq!(percent_decode("a%20b%2Fc"), "a b/c");
        assert_eq!(
            file_url_to_path("file:///home/user/a%20b.png"),
            Some(PathBuf::from("/home/user/a b.png"))
        );
    }

    #[test]
    fn creates_and_removes_temp_dir() {
        let dir = TempDir::create("dsh-probe-util-test").expect("create temp dir");
        std::fs::write(dir.path().join("probe.txt"), b"ok").expect("write temp file");
        assert!(dir.path().is_dir());
    }

    #[test]
    fn clamps_and_rounds() {
        assert_eq!(clamp(f64::NAN, 0.0, 1.0), 0.0);
        assert_eq!(clamp(2.0, 0.0, 1.0), 1.0);
        assert_eq!(round1(1.259), 1.3);
    }
}
