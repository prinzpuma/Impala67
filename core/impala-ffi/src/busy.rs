//! Wer hält die Kern-Sperre? Für den Hänger-Profiler der Apps: Hängt der Hauptthread, weil er auf
//! die Sperre wartet, nennt [`core_lock_holder`] die Stelle, die sie gerade hält (Sync-Import,
//! Checkpoint, Handschrift …); [`core_long_lock_holds`] liefert alle Sperren ab
//! [`LONG_HOLD_MS`] seit dem letzten Abruf. Die Stelle ist die aufrufende Zeile in dieser Hülle
//! (`#[track_caller]`), z. B. `impala-ffi/src/heft.rs:274` – das ist eine Kern-Funktion.
//!
//! Prozessweit ein Platz: Die Apps haben genau einen Kern. (Laufen Tests mit mehreren Kernen
//! parallel, mischen sich nur diese Diagnosedaten.)

use std::panic::Location;
use std::sync::{Mutex, MutexGuard};
use std::time::Instant;

/// Ab dieser Dauer landet ein Halten der Sperre in [`core_long_lock_holds`].
const LONG_HOLD_MS: f64 = 100.0;
/// Höchstens so viele lange Sperren bis zum nächsten Abruf (die neuesten bleiben).
const MAX_HOLDS: usize = 64;

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct CoreLockHold {
    /// Aufrufende Stelle in `impala-ffi` (`Datei:Zeile`).
    pub site: String,
    /// Thread-Name (`impala-sync`, …), leer bei namenlosen Threads der Plattform.
    pub thread: String,
    /// Bisherige bzw. gesamte Dauer.
    pub ms: f64,
}

struct Holder {
    site: &'static Location<'static>,
    thread: String,
    since: Instant,
}

static HOLDER: Mutex<Option<Holder>> = Mutex::new(None);
static LONG: Mutex<Vec<CoreLockHold>> = Mutex::new(Vec::new());

fn slot<T>(m: &'static Mutex<T>) -> MutexGuard<'static, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn site(l: &Location) -> String {
    format!("{}:{}", l.file().replace('\\', "/"), l.line())
}

/// Die Sperre ist genommen: Halter merken.
pub(crate) fn acquired(site: &'static Location<'static>) {
    let thread = std::thread::current().name().unwrap_or("").to_owned();
    *slot(&HOLDER) = Some(Holder { site, thread, since: Instant::now() });
}

/// Die Sperre wird freigegeben: lange Halter vormerken.
pub(crate) fn released() {
    let Some(h) = slot(&HOLDER).take() else { return };
    let ms = h.since.elapsed().as_secs_f64() * 1000.0;
    if ms >= LONG_HOLD_MS {
        let mut long = slot(&LONG);
        if long.len() >= MAX_HOLDS {
            long.remove(0);
        }
        long.push(CoreLockHold { site: site(h.site), thread: h.thread, ms });
    }
}

/// Wer hält die Kern-Sperre gerade (und seit wann)? `None`: frei. Wartet nie auf die Sperre.
#[uniffi::export]
pub fn core_lock_holder() -> Option<CoreLockHold> {
    slot(&HOLDER).as_ref().map(|h| CoreLockHold {
        site: site(h.site),
        thread: h.thread.clone(),
        ms: h.since.elapsed().as_secs_f64() * 1000.0,
    })
}

/// Alle Sperren ab 100 ms seit dem letzten Aufruf (älteste zuerst); leert die Liste.
#[uniffi::export]
pub fn core_long_lock_holds() -> Vec<CoreLockHold> {
    std::mem::take(&mut *slot(&LONG))
}
