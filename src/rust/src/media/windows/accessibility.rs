//! Windows UI Automation tier.
//!
//! This is the last resort for a read-only progress display. It is used only
//! for clients the reference project reads this way (NetEase and WeSing), and
//! it never performs a transport action or grants seek. The scan runs on a
//! short-lived worker thread with a timeout so a slow/hung accessibility
//! provider cannot stall the probe.

#![deny(clippy::undocumented_unsafe_blocks)]

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
        // SAFETY: `hwnd` is only read through UIA and is validated by
        // `ElementFromHandle`; the worker owns no other state that could race
        // with the main thread, and the result is sent back by value.
        let _ = sender.send(unsafe { read_progress(hwnd) });
    });
    receiver.recv_timeout(SCAN_TIMEOUT).ok().flatten()
}

fn ensure_com() {
    // SAFETY: COM initialization is idempotent for the process; the return code
    // is intentionally ignored because an already-initialized apartment is
    // acceptable (S_FALSE/RPC_E_CHANGED_MODE).
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
    // SAFETY: VARIANT_0_0 is a C union whose all-zero bit pattern is VT_EMPTY,
    // a valid initial state; every field is then overwritten before use.
    let mut inner: VARIANT_0_0 = unsafe { std::mem::zeroed() };
    inner.vt = VT_I4;
    inner.Anonymous.lVal = UIA_TextControlTypeId.0;
    // SAFETY: `VariantInit` only initializes the provided VARIANT storage and
    // does not read its previous contents.
    let mut value: VARIANT = unsafe { VariantInit() };
    // SAFETY: `value` was just initialized by VariantInit; writing the inner
    // union member for VT_I4 is valid and the value is only read by COM later.
    unsafe {
        std::ptr::write(
            std::ptr::addr_of_mut!(value.Anonymous.Anonymous),
            std::mem::ManuallyDrop::new(inner),
        );
    }
    value
}
