//! Windows private-interface tier.
//!
//! Many Chinese desktop players expose no usable SMTC session (or advertise one
//! without a position). The reference project reads their top-level window
//! titles instead, and NetEase/WeSing additionally expose `MM:SS | MM:SS`
//! progress through the UI Automation text tree. This module implements the
//! window-title part and Cider's `Plugins/title.txt`; the accessibility part
//! lives in [`super::accessibility`].
//!
//! Window titles are read with `EnumWindows` and process image names with
//! `QueryFullProcessImageNameW`; neither touches the network.

use std::collections::HashMap;

use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
};

use super::super::catalog::{self, PrivateKind, Profile, Tier};
use super::super::{Media, ReadOptions};
use super::audio::{self, Activity};
use crate::util;

/// A visible or hidden top-level window belonging to a desktop process.
#[derive(Debug, Clone)]
pub struct WindowInfo {
    pub hwnd: isize,
    pub pid: u32,
    pub exe: String,
    pub title: String,
    pub visible: bool,
}

pub fn enumerate_windows() -> Vec<WindowInfo> {
    let mut windows: Vec<WindowInfo> = Vec::new();
    unsafe {
        let _ = EnumWindows(
            Some(enum_window),
            LPARAM(&mut windows as *mut Vec<WindowInfo> as isize),
        );
    }
    windows
}

unsafe extern "system" fn enum_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let windows = &mut *(lparam.0 as *mut Vec<WindowInfo>);
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == 0 {
        return BOOL(1);
    }
    let length = GetWindowTextLengthW(hwnd);
    if length <= 0 {
        return BOOL(1);
    }
    let mut buffer = vec![0u16; length as usize + 1];
    let copied = GetWindowTextW(hwnd, &mut buffer);
    if copied <= 0 {
        return BOOL(1);
    }
    let title = String::from_utf16_lossy(&buffer[..copied as usize]);
    if title.trim().is_empty() {
        return BOOL(1);
    }
    windows.push(WindowInfo {
        hwnd: hwnd.0 as isize,
        pid,
        exe: process_image_name(pid).unwrap_or_default(),
        title,
        visible: IsWindowVisible(hwnd).as_bool(),
    });
    BOOL(1)
}

/// Full executable name (no directory) for a process id.
pub fn process_image_name(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut size = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        result.ok()?;
        let path = String::from_utf16_lossy(&buffer[..size as usize]);
        path.rsplit(['\\', '/'])
            .next()
            .map(str::to_string)
            .filter(|name| !name.is_empty())
    }
}

/// Build a private-tier media payload for `profile`, if a matching window (or
/// Cider title file) exists.
pub fn read(
    profile: &'static Profile,
    windows: &[WindowInfo],
    activities: &HashMap<u32, Activity>,
    smtc: Option<&Media>,
    options: &ReadOptions,
) -> Option<Media> {
    if matches!(profile.private, PrivateKind::None) {
        return None;
    }
    let window = best_window(profile, windows)?;
    let (parsed, detail) = match profile.private {
        PrivateKind::CiderTitleFile => match crate::media::vendor::apple_music::cider_title() {
            Some(parsed) => (parsed, "cider-title"),
            None => (profile.parse_title(&window.title)?, "window-title"),
        },
        _ => (profile.parse_title(&window.title)?, "window-title"),
    };

    let app_id = if window.exe.is_empty() {
        profile.app_id.to_string()
    } else {
        window.exe.clone()
    };
    let mut media = Media::new(app_id);
    media.provider = Tier::Private.as_str().to_string();
    media.provider_detail = detail.to_string();
    media.title = parsed.title;
    media.artist = parsed.artist;
    media.playback_status = playback_status(profile, windows, activities, &window.exe, smtc);

    // The private tier is read-only. If a partial SMTC session exists we can
    // still use its transport controls, but never its seek grant.
    if let Some(smtc) = smtc {
        media.album = smtc.album.clone();
        media.album_artist = smtc.album_artist.clone();
        media.track_number = smtc.track_number;
        media.auto_repeat_mode = smtc.auto_repeat_mode.clone();
        media.shuffle_active = smtc.shuffle_active;
        media.can_play_pause = smtc.can_play_pause;
        media.can_next = smtc.can_next;
        media.can_previous = smtc.can_previous;
        if options.thumbnail {
            media.thumbnail = smtc.thumbnail.clone();
            media.thumbnail_type = smtc.thumbnail_type.clone();
        }
    } else {
        media.can_play_pause = false;
        media.can_next = false;
        media.can_previous = false;
    }
    media.can_seek = catalog::seek_allowed(Tier::Private, false, false);
    media.last_updated_at = util::now_ms();

    // Accessibility is the last resort for a read-only progress display. It is
    // never allowed to grant seek (see `catalog::seek_allowed`). NetEase defers
    // this to `vendor::netease::resolve` so CDP can take precedence.
    if profile.smtc_policy != catalog::SmtcPolicy::MetadataOnly {
        attach_progress(profile, windows, &mut media);
    }
    Some(media)
}

/// Find `MM:SS | MM:SS` progress for a profile's window. The caller decides
/// whether accessibility is appropriate; this only performs the scan.
pub fn progress_for_profile(profile: &Profile, windows: &[WindowInfo]) -> Option<(f64, f64)> {
    if !profile.accessibility {
        return None;
    }
    let window = best_window(profile, windows)?;
    super::accessibility::progress(window.hwnd)
}

/// Attach UI Automation progress to a media item.
pub fn attach_progress(profile: &Profile, windows: &[WindowInfo], media: &mut Media) -> bool {
    let Some((position, total)) = progress_for_profile(profile, windows) else {
        return false;
    };
    if total <= 0.0 {
        return false;
    }
    media.position = position;
    media.start_time = 0.0;
    media.end_time = total;
    media.min_seek_time = 0.0;
    media.max_seek_time = total;
    media.last_updated_at = util::now_ms();
    if media.provider_detail.contains("smtc") {
        media.provider_detail = "smtc+uia".to_string();
    } else {
        media.provider_detail = format!("{}+uia", media.provider_detail);
    }
    true
}

/// Audio activity for a profile, using the first matching window process.
pub fn profile_activity<'a>(
    profile: &Profile,
    windows: &[WindowInfo],
    activities: &'a HashMap<u32, Activity>,
) -> Option<&'a Activity> {
    if let Some(activity) = windows
        .iter()
        .filter(|window| {
            catalog::profile_for_process(&window.exe)
                .map(|candidate| candidate.app == profile.app)
                .unwrap_or(false)
        })
        .find_map(|window| {
            audio::for_exe(activities, &window.exe)
                .or_else(|| audio::for_pid(activities, window.pid))
        })
    {
        return Some(activity);
    }
    // Some clients play audio through a helper process (KuWo's `KwService`)
    // that owns no window. Match the audio session by its process profile.
    activities.values().find(|activity| {
        activity
            .exe
            .as_deref()
            .and_then(catalog::profile_for_process)
            .map(|candidate| candidate.app == profile.app)
            .unwrap_or(false)
    })
}

fn playback_status(
    profile: &Profile,
    windows: &[WindowInfo],
    activities: &HashMap<u32, Activity>,
    exe: &str,
    smtc: Option<&Media>,
) -> String {
    if let Some(activity) = audio::for_exe(activities, exe) {
        return if activity.is_playing() {
            "Playing".to_string()
        } else {
            "Paused".to_string()
        };
    }
    if let Some(activity) = profile_activity(profile, windows, activities) {
        return if activity.is_playing() {
            "Playing".to_string()
        } else {
            "Paused".to_string()
        };
    }
    smtc.map(|media| media.playback_status.clone())
        .unwrap_or_else(|| "Paused".to_string())
}

fn best_window<'a>(profile: &Profile, windows: &'a [WindowInfo]) -> Option<&'a WindowInfo> {
    let mut candidates: Vec<&WindowInfo> = windows
        .iter()
        .filter(|window| {
            catalog::profile_for_process(&window.exe)
                .map(|candidate| candidate.app == profile.app)
                .unwrap_or(false)
        })
        .collect();
    // Keep enumeration (z-order) order inside each visibility class.
    candidates.sort_by_key(|window| !window.visible);

    for window in &candidates {
        if profile.parse_title(&window.title).is_some() {
            return Some(window);
        }
    }
    if matches!(profile.private, PrivateKind::CiderTitleFile)
        && crate::media::vendor::apple_music::cider_title().is_some()
        && !candidates.is_empty()
    {
        return candidates.first().copied();
    }
    candidates.first().copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_image_name_of_current_process_exists() {
        let name = process_image_name(std::process::id()).unwrap_or_default();
        assert!(name.to_lowercase().ends_with(".exe"), "{name}");
    }
}
