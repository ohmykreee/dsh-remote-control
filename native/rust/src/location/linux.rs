//! Linux location: GeoClue2 over D-Bus.
//!
//! GeoClue is the system location service used by GNOME/KDE. A client asks the
//! manager for a client object, sets `DesktopId`, calls `Start`, then reads the
//! `Location` object. Authorization is controlled by the desktop/GeoClue
//! policy; failures are returned so Node can fall back to IP geolocation.

use std::time::Duration;

use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::OwnedObjectPath;

use super::Reading;

const GEOCLUE_SERVICE: &str = "org.freedesktop.GeoClue2";
const GEOCLUE_MANAGER_PATH: &str = "/org/freedesktop/GeoClue2/Manager";
const GEOCLUE_MANAGER_INTERFACE: &str = "org.freedesktop.GeoClue2.Manager";
const GEOCLUE_CLIENT_INTERFACE: &str = "org.freedesktop.GeoClue2.Client";
const GEOCLUE_LOCATION_INTERFACE: &str = "org.freedesktop.GeoClue2.Location";

fn failure(error: impl std::fmt::Display) -> String {
    format!("GeoClue: {error}")
}

pub fn read() -> Result<Reading, String> {
    let connection = Connection::system()
        .map_err(|error| format!("system D-Bus unavailable for GeoClue: {error}"))?;
    let manager = Proxy::new(
        &connection,
        GEOCLUE_SERVICE,
        GEOCLUE_MANAGER_PATH,
        GEOCLUE_MANAGER_INTERFACE,
    )
    .map_err(failure)?;
    let client_path: OwnedObjectPath = manager.call("CreateClient", &()).map_err(failure)?;
    let client = Proxy::new(
        &connection,
        GEOCLUE_SERVICE,
        client_path.as_str(),
        GEOCLUE_CLIENT_INTERFACE,
    )
    .map_err(failure)?;
    client
        .set_property("DesktopId", "dsh-remote-control")
        .map_err(failure)?;
    let _: () = client.call("Start", &()).map_err(failure)?;

    let mut location_path: OwnedObjectPath = client.get_property("Location").map_err(failure)?;
    // Start() is asynchronous; wait briefly for GeoClue to resolve a location.
    for _ in 0..50 {
        if location_path.as_str() != "/" {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
        location_path = client.get_property("Location").map_err(failure)?;
    }
    let result = if location_path.as_str() == "/" {
        Err("GeoClue did not return a location".to_string())
    } else {
        let location = Proxy::new(
            &connection,
            GEOCLUE_SERVICE,
            location_path.as_str(),
            GEOCLUE_LOCATION_INTERFACE,
        )
        .map_err(failure)?;
        let latitude: f64 = location.get_property("Latitude").map_err(failure)?;
        let longitude: f64 = location.get_property("Longitude").map_err(failure)?;
        let accuracy: f64 = location
            .get_property("Accuracy")
            .map_err(failure)
            .unwrap_or(0.0);
        if !latitude.is_finite()
            || !longitude.is_finite()
            || latitude.abs() > 90.0
            || longitude.abs() > 180.0
        {
            Err("GeoClue returned an invalid coordinate".to_string())
        } else {
            Ok(Reading {
                latitude,
                longitude,
                accuracy: if accuracy > 0.0 { Some(accuracy) } else { None },
                source: "linux-geoclue2",
            })
        }
    };
    let _: () = client.call("Stop", &()).unwrap_or(());
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn geoclue_interfaces_are_named() {
        assert_eq!(GEOCLUE_SERVICE, "org.freedesktop.GeoClue2");
        assert!(GEOCLUE_MANAGER_INTERFACE.ends_with("Manager"));
    }
}
