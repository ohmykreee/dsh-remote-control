//! Minimal MediaRemote bridge for macOS.
//!
//! `nowplaying-cli` is an optional third-party helper; a normal installation
//! should not need it. This module talks to the private `MediaRemote` framework
//! directly through `dlopen`/`dlsym` and the Objective-C runtime.
//!
//! Everything is resolved at runtime: the framework only lives in the dyld
//! shared cache on current macOS, and linking it would require a full Xcode SDK.
//! Media data is read through KVC from `MRNowPlayingController.response`, which
//! is the API that still returns a payload on macOS 15.4+ (the legacy
//! `MRMediaRemoteGetNowPlayingInfo` callback returns an empty dictionary).
//! Transport commands keep using the legacy `MRMediaRemoteSendCommand` and
//! `MRMediaRemoteSetElapsedTime` entry points.

#![deny(clippy::undocumented_unsafe_blocks)]

use std::cell::OnceCell;
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::time::{Duration, Instant};

type Id = *mut c_void;
type Sel = *mut c_void;

const RTLD_NOW: c_int = 2;
const RTLD_GLOBAL: c_int = 0x100;
const RTLD_DEFAULT: *mut c_void = -2isize as usize as *mut c_void;
const RESPONSE_TIMEOUT: Duration = Duration::from_millis(600);

#[link(name = "System")]
extern "C" {
    fn dlopen(filename: *const c_char, flags: c_int) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

struct Runtime {
    objc_get_class: unsafe extern "C" fn(*const c_char) -> Id,
    sel_register_name: unsafe extern "C" fn(*const c_char) -> Sel,
    msg_send: *mut c_void,
    send_command: unsafe extern "C" fn(c_int, Id) -> u8,
    set_elapsed: Option<unsafe extern "C" fn(f64)>,
    run_loop: Option<unsafe extern "C" fn(Id, f64, u8) -> i32>,
    default_mode: Option<Id>,
    pool_push: Option<unsafe extern "C" fn() -> Id>,
    pool_pop: Option<unsafe extern "C" fn(Id)>,
}

thread_local! {
    /// Resolved once per thread. `Runtime` contains raw ObjC/MediaRemote
    /// function pointers; keeping it thread-local avoids asserting `Send`/`Sync`
    /// for a table whose framework handles are thread-affine.
    static RUNTIME: OnceCell<Option<Runtime>> = OnceCell::new();
}

#[derive(Debug, Clone)]
pub(super) struct Reading {
    pub app_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub position: f64,
    pub playback_rate: f64,
    pub playback_state: i64,
}

fn load_runtime() -> Option<Runtime> {
    // SAFETY: `dlopen` receives a static NUL-terminated path and the handle is
    // kept alive for the process. `dlsym` results are transmuted only after a
    // null check, and each cast uses the C ABI matching the symbol's documented
    // signature (checked against MediaRemote's symbols on macOS 26).
    unsafe {
        let path =
            CString::new("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote")
                .ok()?;
        let media = dlopen(path.as_ptr(), RTLD_NOW | RTLD_GLOBAL);
        if media.is_null() {
            return None;
        }

        let objc_get_class: unsafe extern "C" fn(*const c_char) -> Id =
            std::mem::transmute(symbol(RTLD_DEFAULT, "objc_getClass")?);
        let sel_register_name: unsafe extern "C" fn(*const c_char) -> Sel =
            std::mem::transmute(symbol(RTLD_DEFAULT, "sel_registerName")?);
        let msg_send = symbol(RTLD_DEFAULT, "objc_msgSend")?;
        let send_command: unsafe extern "C" fn(c_int, Id) -> u8 =
            std::mem::transmute(symbol(media, "MRMediaRemoteSendCommand")?);
        let set_elapsed = symbol(media, "MRMediaRemoteSetElapsedTime")
            .map(|pointer| std::mem::transmute::<*mut c_void, unsafe extern "C" fn(f64)>(pointer));
        let run_loop = symbol(RTLD_DEFAULT, "CFRunLoopRunInMode").map(|pointer| {
            std::mem::transmute::<*mut c_void, unsafe extern "C" fn(Id, f64, u8) -> i32>(pointer)
        });
        let default_mode = symbol(RTLD_DEFAULT, "kCFRunLoopDefaultMode")
            .map(|pointer| *(pointer as *const Id))
            .filter(|mode| !mode.is_null());
        let pool_push = symbol(RTLD_DEFAULT, "objc_autoreleasePoolPush").map(|pointer| {
            std::mem::transmute::<*mut c_void, unsafe extern "C" fn() -> Id>(pointer)
        });
        let pool_pop = symbol(RTLD_DEFAULT, "objc_autoreleasePoolPop")
            .map(|pointer| std::mem::transmute::<*mut c_void, unsafe extern "C" fn(Id)>(pointer));

        Some(Runtime {
            objc_get_class,
            sel_register_name,
            msg_send,
            send_command,
            set_elapsed,
            run_loop,
            default_mode,
            pool_push,
            pool_pop,
        })
    }
}

unsafe fn symbol(handle: *mut c_void, name: &str) -> Option<*mut c_void> {
    let name = CString::new(name).ok()?;
    let pointer = dlsym(handle, name.as_ptr());
    if pointer.is_null() {
        None
    } else {
        Some(pointer)
    }
}

fn with_runtime<T>(f: impl FnOnce(&Runtime) -> T) -> Option<T> {
    RUNTIME.with(|slot| slot.get_or_init(load_runtime).as_ref().map(f))
}

unsafe fn class(rt: &Runtime, name: &str) -> Option<Id> {
    let name = CString::new(name).ok()?;
    let class = (rt.objc_get_class)(name.as_ptr());
    if class.is_null() {
        None
    } else {
        Some(class)
    }
}

unsafe fn selector(rt: &Runtime, name: &str) -> Sel {
    match CString::new(name) {
        Ok(name) => (rt.sel_register_name)(name.as_ptr()),
        Err(_) => std::ptr::null_mut(),
    }
}

unsafe fn msg0(rt: &Runtime, receiver: Id, name: &str) -> Id {
    let send: unsafe extern "C" fn(Id, Sel) -> Id = std::mem::transmute(rt.msg_send);
    send(receiver, selector(rt, name))
}

unsafe fn msg1(rt: &Runtime, receiver: Id, name: &str, argument: Id) -> Id {
    let send: unsafe extern "C" fn(Id, Sel, Id) -> Id = std::mem::transmute(rt.msg_send);
    send(receiver, selector(rt, name), argument)
}

unsafe fn msg_index(rt: &Runtime, receiver: Id, name: &str, index: usize) -> Id {
    let send: unsafe extern "C" fn(Id, Sel, usize) -> Id = std::mem::transmute(rt.msg_send);
    send(receiver, selector(rt, name), index)
}

unsafe fn msg_void(rt: &Runtime, receiver: Id, name: &str) {
    let send: unsafe extern "C" fn(Id, Sel) = std::mem::transmute(rt.msg_send);
    send(receiver, selector(rt, name));
}

unsafe fn nsstring(rt: &Runtime, text: &str) -> Id {
    let Some(string_class) = class(rt, "NSString") else {
        return std::ptr::null_mut();
    };
    let text = CString::new(text).unwrap_or_default();
    let send: unsafe extern "C" fn(Id, Sel, *const c_char) -> Id = std::mem::transmute(rt.msg_send);
    send(
        string_class,
        selector(rt, "stringWithUTF8String:"),
        text.as_ptr(),
    )
}

unsafe fn number_bool(rt: &Runtime, value: bool) -> Id {
    let Some(number_class) = class(rt, "NSNumber") else {
        return std::ptr::null_mut();
    };
    let send: unsafe extern "C" fn(Id, Sel, u8) -> Id = std::mem::transmute(rt.msg_send);
    send(
        number_class,
        selector(rt, "numberWithBool:"),
        u8::from(value),
    )
}

unsafe fn kvc_get(rt: &Runtime, object: Id, key: &str) -> Id {
    if object.is_null() {
        return std::ptr::null_mut();
    }
    msg1(rt, object, "valueForKey:", nsstring(rt, key))
}

unsafe fn kvc_set_bool(rt: &Runtime, object: Id, key: &str, value: bool) {
    if object.is_null() {
        return;
    }
    let send: unsafe extern "C" fn(Id, Sel, Id, Id) = std::mem::transmute(rt.msg_send);
    send(
        object,
        selector(rt, "setValue:forKey:"),
        number_bool(rt, value),
        nsstring(rt, key),
    );
}

unsafe fn string_value(rt: &Runtime, object: Id) -> String {
    if object.is_null() {
        return String::new();
    }
    let send: unsafe extern "C" fn(Id, Sel) -> *const c_char = std::mem::transmute(rt.msg_send);
    let pointer = send(object, selector(rt, "UTF8String"));
    if pointer.is_null() {
        String::new()
    } else {
        CStr::from_ptr(pointer).to_string_lossy().into_owned()
    }
}

unsafe fn number_value(rt: &Runtime, object: Id) -> f64 {
    if object.is_null() {
        return 0.0;
    }
    let send: unsafe extern "C" fn(Id, Sel) -> f64 = std::mem::transmute(rt.msg_send);
    let value = send(object, selector(rt, "doubleValue"));
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

unsafe fn count_value(rt: &Runtime, object: Id) -> usize {
    if object.is_null() {
        return 0;
    }
    let send: unsafe extern "C" fn(Id, Sel) -> usize = std::mem::transmute(rt.msg_send);
    send(object, selector(rt, "count"))
}

pub(super) fn available() -> bool {
    with_runtime(|rt| {
        // SAFETY: class lookup only reads the Objective-C runtime's class table;
        // `rt` is an immutable function table and the class names are static.
        unsafe {
            class(rt, "MRDestination").is_some()
                && class(rt, "MRNowPlayingControllerConfiguration").is_some()
                && class(rt, "MRNowPlayingController").is_some()
        }
    })
    .unwrap_or(false)
}

/// Read the user-selected Now Playing session, or `None` when nothing is
/// playing / the private API is unavailable.
pub(super) fn read() -> Option<Reading> {
    with_runtime(|rt| {
        // SAFETY: the autorelease pool brackets all Objective-C object creation
        // in `read_inner`; every returned value is owned Rust data, and the pool
        // is popped on both success and failure paths.
        unsafe {
            let pool = rt.pool_push.map(|push| push());
            let reading = read_inner(rt);
            if let (Some(pop), Some(pool)) = (rt.pool_pop, pool) {
                pop(pool);
            }
            reading
        }
    })
    .flatten()
}

unsafe fn read_inner(rt: &Runtime) -> Option<Reading> {
    let destination_class = class(rt, "MRDestination")?;
    let destination = msg0(rt, destination_class, "userSelectedDestination");
    if destination.is_null() {
        return None;
    }

    let config_class = class(rt, "MRNowPlayingControllerConfiguration")?;
    let config = msg1(
        rt,
        msg0(rt, config_class, "alloc"),
        "initWithDestination:",
        destination,
    );
    if config.is_null() {
        return None;
    }
    kvc_set_bool(rt, config, "singleShot", false);
    kvc_set_bool(rt, config, "requestPlaybackState", true);
    kvc_set_bool(rt, config, "requestPlaybackQueue", true);

    let controller_class = class(rt, "MRNowPlayingController")?;
    let controller = msg1(
        rt,
        msg0(rt, controller_class, "alloc"),
        "initWithConfiguration:",
        config,
    );
    if controller.is_null() {
        return None;
    }
    msg_void(rt, controller, "beginLoadingUpdates");
    let response = poll_response(rt, controller);
    let reading = if response.is_null() {
        None
    } else {
        extract(rt, response)
    };
    msg_void(rt, controller, "endLoadingUpdates");
    reading
}

unsafe fn poll_response(rt: &Runtime, controller: Id) -> Id {
    let deadline = Instant::now() + RESPONSE_TIMEOUT;
    loop {
        let response = kvc_get(rt, controller, "response");
        if !response.is_null() {
            return response;
        }
        if Instant::now() >= deadline {
            return std::ptr::null_mut();
        }
        match (rt.run_loop, rt.default_mode) {
            (Some(run_loop), Some(mode)) => {
                run_loop(mode, 0.05, 0);
            }
            _ => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

unsafe fn extract(rt: &Runtime, response: Id) -> Option<Reading> {
    let playback_rate = number_value(rt, kvc_get(rt, response, "playbackRate"));
    let playback_state = number_value(rt, kvc_get(rt, response, "playbackState")) as i64;

    let queue = kvc_get(rt, response, "playbackQueue");
    let items = kvc_get(rt, queue, "contentItems");
    let count = count_value(rt, items);
    if count == 0 {
        return None;
    }
    let location = number_value(rt, kvc_get(rt, queue, "location")).max(0.0) as usize;
    let index = location.min(count - 1);
    let item = msg_index(rt, items, "objectAtIndex:", index);
    let metadata = kvc_get(rt, item, "metadata");
    if metadata.is_null() {
        return None;
    }

    let title = string_value(rt, kvc_get(rt, metadata, "title"));
    let artist = string_value(rt, kvc_get(rt, metadata, "trackArtistName"));
    if title.trim().is_empty() && artist.trim().is_empty() {
        return None;
    }
    let album = string_value(rt, kvc_get(rt, metadata, "albumName"));
    let duration = number_value(rt, kvc_get(rt, metadata, "duration")).max(0.0);
    let position = number_value(rt, kvc_get(rt, metadata, "elapsedTime")).max(0.0);

    let player_path = kvc_get(rt, response, "playerPath");
    let client = kvc_get(rt, player_path, "client");
    let mut app_id = string_value(rt, kvc_get(rt, client, "bundleIdentifier"));
    if app_id.trim().is_empty() {
        app_id = "macOS".to_string();
    }

    Some(Reading {
        app_id,
        title,
        artist,
        album,
        duration,
        position,
        playback_rate,
        playback_state,
    })
}

fn send_command(rt: &Runtime, command: c_int) -> Result<(), String> {
    // SAFETY: `send_command` was resolved from MediaRemote with the
    // `Boolean(c_int, CFDictionaryRef)` signature; command ids come from the
    // documented MRMediaRemoteCommand enum and a null userInfo is accepted.
    let accepted = unsafe { (rt.send_command)(command, std::ptr::null_mut()) };
    if accepted != 0 {
        Ok(())
    } else {
        Err("MediaRemote rejected the media command".to_string())
    }
}

pub(super) fn control(action: &str, position: f64) -> Result<(), String> {
    with_runtime(|rt| match action {
        "playpause" => send_command(rt, 2),
        "next" => send_command(rt, 4),
        "previous" => send_command(rt, 5),
        "seek" => {
            let set_elapsed = rt
                .set_elapsed
                .ok_or_else(|| "MediaRemote seek is unavailable".to_string())?;
            // SAFETY: the symbol was resolved with the `void(double)` ABI and
            // the position is clamped to a non-negative finite value.
            unsafe { set_elapsed(position.max(0.0)) };
            Ok(())
        }
        other => Err(format!("unsupported media action: {other}")),
    })
    .unwrap_or_else(|| Err("MediaRemote is unavailable".to_string()))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    /// Publish a fake Now Playing session from this process and read it back.
    /// This exercises the same controller path a real player uses, without
    /// requiring Music/Spotify or an interactive desktop session.
    #[test]
    fn reads_a_fake_now_playing_session() {
        with_runtime(|rt| {
            // SAFETY: this test intentionally publishes a fake Now Playing entry
            // through the same private symbols; all objects are created in this
            // process, kept alive for the call, and no raw pointer escapes.
            unsafe {
                let path = CString::new(
                    "/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote",
                )
                .expect("path");
                let media = dlopen(path.as_ptr(), RTLD_NOW | RTLD_GLOBAL);
                assert!(!media.is_null(), "dlopen MediaRemote");
                let can_be_now_playing: unsafe extern "C" fn(u8) = std::mem::transmute(
                    symbol(media, "MRMediaRemoteSetCanBeNowPlayingApplication")
                        .expect("can be playing"),
                );
                let set_info: unsafe extern "C" fn(Id) = std::mem::transmute(
                    symbol(media, "MRMediaRemoteSetNowPlayingInfo").expect("set info"),
                );
                can_be_now_playing(1);

                let info = msg0(
                    rt,
                    class(rt, "NSMutableDictionary").expect("NSMutableDictionary"),
                    "dictionary",
                );
                let set_object: unsafe extern "C" fn(Id, Sel, Id, Id) =
                    std::mem::transmute(rt.msg_send);
                let number: unsafe extern "C" fn(Id, Sel, f64) -> Id =
                    std::mem::transmute(rt.msg_send);
                let number_class = class(rt, "NSNumber").expect("NSNumber");
                for (key, value) in [
                    (
                        "kMRMediaRemoteNowPlayingInfoTitle",
                        nsstring(rt, "Probe Test Song"),
                    ),
                    (
                        "kMRMediaRemoteNowPlayingInfoArtist",
                        nsstring(rt, "Probe Artist"),
                    ),
                    (
                        "kMRMediaRemoteNowPlayingInfoAlbum",
                        nsstring(rt, "Probe Album"),
                    ),
                ] {
                    set_object(
                        info,
                        selector(rt, "setObject:forKey:"),
                        value,
                        nsstring(rt, key),
                    );
                }
                for (key, value) in [
                    ("kMRMediaRemoteNowPlayingInfoDuration", 240.0),
                    ("kMRMediaRemoteNowPlayingInfoElapsedTime", 42.0),
                    ("kMRMediaRemoteNowPlayingInfoPlaybackRate", 1.0),
                ] {
                    set_object(
                        info,
                        selector(rt, "setObject:forKey:"),
                        number(number_class, selector(rt, "numberWithDouble:"), value),
                        nsstring(rt, key),
                    );
                }
                set_info(info);
                std::thread::sleep(Duration::from_millis(200));

                let reading = read().expect("read the fake session");
                assert_eq!(reading.title, "Probe Test Song");
                assert_eq!(reading.artist, "Probe Artist");
                assert_eq!(reading.album, "Probe Album");
                assert!((reading.duration - 240.0).abs() < 0.5);
                assert!((reading.position - 42.0).abs() < 2.0);
                assert!(reading.playback_rate > 0.0);
                assert!(!reading.app_id.is_empty());
            }
        })
        .expect("load MediaRemote");
    }
}
