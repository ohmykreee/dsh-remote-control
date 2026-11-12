//! Windows UI Automation tier.
//!
//! This is the last resort for a read-only progress display. It is used only
//! for clients the reference project reads this way (NetEase and WeSing), and
//! it never performs a transport action or grants seek. The scan runs on a
//! short-lived worker thread with a timeout so a slow/hung accessibility
//! provider cannot stall the probe.

use std::ffi::c_void;
use std::sync::mpsc;
use std::time::Duration;

use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::System::Variant::{VariantInit, VARIANT, VARIANT_0_0, VT_I4};
use windows::Win32::UI::Accessibility::{
    CUIAutomation8, IUIAutomation, TreeScope_Descendants, UIA_ControlTypePropertyId,
    UIA_TextControlTypeId,
};

const SCAN_TIMEOUT: Duration = Duration::from_millis(800);
const MAX_TEXT_ELEMENTS: i32 = 5000;

/// Read `MM:SS | MM:SS` progress from the window's accessibility text tree.
pub fn progress(hwnd: isize) -> Option<(f64, f64)> {
    if hwnd == 0 {
        return None;
    }
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = sender.send(unsafe { read_progress(hwnd) });
    });
    receiver.recv_timeout(SCAN_TIMEOUT).ok().flatten()
}

fn ensure_com() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

unsafe fn read_progress(hwnd: isize) -> Option<(f64, f64)> {
    ensure_com();
    let automation: IUIAutomation =
        CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER).ok()?;
    let window = automation
        .ElementFromHandle(HWND(hwnd as *mut c_void))
        .ok()?;
    let condition_value = text_control_variant();
    let condition = automation
        .CreatePropertyCondition(UIA_ControlTypePropertyId, &condition_value)
        .ok()?;
    let elements = window.FindAll(TreeScope_Descendants, &condition).ok()?;
    let count = elements.Length().ok()?.min(MAX_TEXT_ELEMENTS);
    for index in 0..count {
        let Ok(element) = elements.GetElement(index) else {
            continue;
        };
        let Ok(name) = element.CurrentName() else {
            continue;
        };
        if let Some(progress) = crate::media::catalog::parse_progress_text(&name.to_string()) {
            return Some(progress);
        }
    }
    None
}

fn text_control_variant() -> VARIANT {
    // Build the inner VARIANT_0_0 separately and write it into the union; this
    // avoids assigning through the `ManuallyDrop` field of VARIANT_0.
    let mut inner: VARIANT_0_0 = unsafe { std::mem::zeroed() };
    inner.vt = VT_I4;
    inner.Anonymous.lVal = UIA_TextControlTypeId.0;
    let mut value: VARIANT = unsafe { VariantInit() };
    unsafe {
        std::ptr::write(
            std::ptr::addr_of_mut!(value.Anonymous.Anonymous),
            std::mem::ManuallyDrop::new(inner),
        );
    }
    value
}
