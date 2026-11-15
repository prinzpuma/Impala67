//! Ortszeit der App für Tagesgrenzen: Der Kern fragt den Versatz **je Zeitpunkt** ab, damit
//! Einträge aus der Sommerzeit auch im Winter auf dem richtigen Tag landen.

use std::sync::Arc;

use impala_srs::{CachedZone, LocalZone};

/// Versatz der Ortszeit zu UTC in Minuten für einen Zeitpunkt (iOS: `TimeZone.current
/// .secondsFromGMT(for:)`, Android: `TimeZone.getDefault().getOffset(ms)`).
#[uniffi::export(with_foreign)]
pub trait DeviceZone: Send + Sync {
    fn offset_minutes(&self, utc_ms: i64) -> i32;
}

pub(crate) fn local_zone(zone: Arc<dyn DeviceZone>) -> impl LocalZone {
    CachedZone::new(move |ms| i64::from(zone.offset_minutes(ms)))
}

#[cfg(test)]
pub(crate) struct Fixed(pub i32);

#[cfg(test)]
impl DeviceZone for Fixed {
    fn offset_minutes(&self, _: i64) -> i32 {
        self.0
    }
}

#[cfg(test)]
pub(crate) fn utc() -> Arc<dyn DeviceZone> {
    Arc::new(Fixed(0))
}
