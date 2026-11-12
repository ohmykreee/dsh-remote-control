//! Windows volume probe: WASAPI default render endpoint via Core Audio.

use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};

use super::Reading;
use crate::util;

pub const BACKEND: &str = "coreaudio";

fn failure(error: impl std::fmt::Display) -> String {
    format!("Core Audio: {error}")
}

fn ensure_com() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    });
}

fn endpoint() -> Result<IAudioEndpointVolume, String> {
    ensure_com();
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(failure)?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(failure)?;
        device
            .Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
            .map_err(failure)
    }
}

fn read_from(endpoint: &IAudioEndpointVolume) -> Result<Reading, String> {
    unsafe {
        let volume = endpoint.GetMasterVolumeLevelScalar().map_err(failure)?;
        let muted = endpoint.GetMute().map_err(failure)?.as_bool();
        Ok(Reading {
            volume: util::clamp(volume as f64, 0.0, 1.0),
            muted,
            backend: BACKEND.to_string(),
        })
    }
}

pub fn read() -> Result<Reading, String> {
    let endpoint = endpoint()?;
    read_from(&endpoint)
}

pub fn set(value: f64) -> Result<Reading, String> {
    let endpoint = endpoint()?;
    unsafe {
        endpoint
            .SetMasterVolumeLevelScalar(util::clamp(value, 0.0, 1.0) as f32, std::ptr::null())
            .map_err(failure)?;
    }
    read_from(&endpoint)
}

pub fn toggle() -> Result<Reading, String> {
    let endpoint = endpoint()?;
    let muted = unsafe { endpoint.GetMute().map_err(failure)?.as_bool() };
    unsafe {
        endpoint
            .SetMute(!muted, std::ptr::null())
            .map_err(failure)?;
    }
    read_from(&endpoint)
}
