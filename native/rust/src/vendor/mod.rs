//! Vendor-specific local integrations.
//!
//! Each child module reads one third-party desktop client's local data (never
//! its network API). Keep this folder for vendor-only code so the generic
//! media/notification/performance probes stay platform-focused.

pub mod netease;
