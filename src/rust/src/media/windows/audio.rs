//! Per-process audio activity on the default render endpoint.
//!
//! Several desktop players (QQ Music, KuGou, KuWo, Soda, Spotify) do not refresh
//! their SMTC playback status unless the Windows media flyout is open. The
//! reference project therefore uses the audio session meter/state to decide
//! whether the client is actually playing. The probe exposes the same signal so
//! the private tier and incomplete system sessions can correct their status.

use std::collections::HashMap;

use windows::core::Interface;
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2,
    IMMDeviceEnumerator, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};

/// Aggregated state for one process.
#[derive(Debug, Clone, Default)]
pub struct Activity {
    pub active: bool,
    pub audible: bool,
    pub exe: Option<String>,
}

impl Activity {
    /// The client is producing sound or its audio session is active.
    pub fn is_playing(&self) -> bool {
        self.active || self.audible
    }
}

fn ensure_com() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    });
}

/// Snapshot every session on the default multimedia render endpoint.
///
/// An empty map simply means Core Audio could not be queried; callers then keep
/// the status reported by the system media session.
pub fn snapshot() -> HashMap<u32, Activity> {
    ensure_com();
    let mut activities: HashMap<u32, Activity> = HashMap::new();
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                Ok(value) => value,
                Err(_) => return activities,
            };
        let device = match enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) {
            Ok(value) => value,
            Err(_) => return activities,
        };
        let manager: IAudioSessionManager2 = match device.Activate(CLSCTX_ALL, None) {
            Ok(value) => value,
            Err(_) => return activities,
        };
        let sessions = match manager.GetSessionEnumerator() {
            Ok(value) => value,
            Err(_) => return activities,
        };
        let count = sessions.GetCount().unwrap_or(0);
        for index in 0..count {
            let Ok(control) = sessions.GetSession(index) else {
                continue;
            };
            let process_id = control
                .cast::<IAudioSessionControl2>()
                .ok()
                .and_then(|control| control.GetProcessId().ok())
                .unwrap_or(0);
            if process_id == 0 {
                continue;
            }
            let peak = control
                .cast::<IAudioMeterInformation>()
                .ok()
                .and_then(|meter| meter.GetPeakValue().ok())
                .unwrap_or(0.0);
            let state = control.GetState().ok();
            let entry = activities.entry(process_id).or_insert_with(|| Activity {
                exe: super::private::process_image_name(process_id),
                ..Activity::default()
            });
            if state == Some(AudioSessionStateActive) {
                entry.active = true;
            }
            if peak > 0.00001 {
                entry.audible = true;
            }
        }
    }
    activities
}

/// Audio activity for one executable (case-insensitive).
pub fn for_exe<'a>(activities: &'a HashMap<u32, Activity>, exe: &str) -> Option<&'a Activity> {
    activities.values().find(|activity| {
        activity
            .exe
            .as_deref()
            .map(|candidate| candidate.eq_ignore_ascii_case(exe))
            .unwrap_or(false)
    })
}

/// Audio activity for one process id.
pub fn for_pid<'a>(activities: &'a HashMap<u32, Activity>, pid: u32) -> Option<&'a Activity> {
    activities.get(&pid)
}
