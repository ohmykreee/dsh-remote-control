//! macOS location (source only, untested).
//!
//! CoreLocation only grants authorization to an application bundle that ships
//! `NSLocationUsageDescription` (and is signed/notarized). A child sidecar
//! process has no bundle identity, so `CLLocationManager` would be denied. The
//! probe therefore reports a clear error and Node falls back to IP
//! geolocation/timezone; manual coordinates remain available in settings.

use super::Reading;

pub fn read() -> Result<Reading, String> {
    Err(
        "CoreLocation requires an application bundle with a location usage description; \
         falling back to IP location"
            .to_string(),
    )
}
