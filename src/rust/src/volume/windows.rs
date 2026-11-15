//! Windows volume probe: WASAPI default render endpoint via Core Audio.

#![deny(clippy::undocumented_unsafe_blocks)]

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
    ONCE.call_once(|| {
        // SAFETY: COM initialization is process-wide and idempotent. S_FALSE or
        // RPC_E_CHANGED_MODE means COM is already initialized and is harmless.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
    });
}

fn endpoint() -> Result<IAudioEndpointVolume, String> {
    ensure_com();
    // SAFETY: COM is initialized on this thread above. The returned interfaces
    // are owned by the `windows` crate and released on drop; a null outer
    // unknown and context are valid for these activation calls.
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
    // SAFETY: `endpoint` is a live COM interface obtained from `endpoint()`;
    // both getters follow the IAudioEndpointVolume contract and their HRESULTs
    // are converted to errors before the values are used.
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
    // SAFETY: `endpoint` is a live COM interface; the value is clamped to the
    // documented 0.0..=1.0 scalar range and a null event context is accepted.
    unsafe {
        endpoint
            .SetMasterVolumeLevelScalar(util::clamp(value, 0.0, 1.0) as f32, std::ptr::null())
            .map_err(failure)?;
    }
    read_from(&endpoint)
}

pub fn toggle() -> Result<Reading, String> {
    let endpoint = endpoint()?;
    // SAFETY: `endpoint` is a live COM interface and `GetMute` reports its
    // HRESULT before the boolean is used.
    let muted = unsafe { endpoint.GetMute().map_err(failure)?.as_bool() };
    // SAFETY: the same live endpoint is used; the negated boolean is a valid
    // mute state and a null event context is accepted.
    unsafe {
        endpoint
            .SetMute(!muted, std::ptr::null())
            .map_err(failure)?;
    }
    read_from(&endpoint)
}
