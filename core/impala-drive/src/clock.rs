//! Zeit für den Drive-Ablauf: Uhr und Warten als Trait (der Kern hat keine eigene Uhr) und die
//! Uhren-Drift-Schätzung über den `Date`-Header der Drive-Antworten.

/// Uhr und Warten (Backoff; Warten ist asynchron). Tests nageln die Zeit fest.
#[allow(async_fn_in_trait)]
pub trait Clock {
    /// Gerätezeit in ms seit 1970 (`Date.now()`).
    fn now_ms(&self) -> f64;
    /// Wartet `ms` Millisekunden, ohne den Thread zu blockieren; die Plattform liefert das Future
    /// (Browser: `setTimeout`-Promise).
    async fn sleep_ms(&self, ms: u64);
}

/// Systemuhr (nicht im Browser-WASM: dort gibt es weder `SystemTime` noch blockierendes Warten).
#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
impl Clock for SystemClock {
    fn now_ms(&self) -> f64 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0.0, |d| d.as_secs_f64() * 1000.0)
    }

    // Native Standardlösung: blockiert den aufrufenden Thread (der Kern selbst wartet nie).
    async fn sleep_ms(&self, ms: u64) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
}

/// Ab diesem Versatz warnt der Sync (Konflikte werden per Zeitstempel entschieden).
pub const CLOCK_SKEW_WARN_MS: f64 = 120_000.0;
/// Ab diesem Versatz wird er in neue Zeitstempel hineinkorrigiert (`U.setClockOffset`).
pub const CLOCK_APPLY_MS: f64 = 15_000.0;
/// Messungen altern: älter als 10 min zählen nicht mehr.
const SAMPLE_MAX_AGE_MS: f64 = 600_000.0;
const MAX_SAMPLES: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq)]
struct Sample {
    offset: f64,
    rtt: f64,
    at: f64,
}

/// NTP-artige Schätzung des Versatzes Gerät − Server: Der `Date`-Header gilt in der Mitte des
/// Round-Trips (+500 ms, weil er auf Sekunden abgerundet ist); von den jüngsten Messungen gewinnt
/// die mit der kleinsten Round-Trip-Zeit.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ClockSkew {
    samples: Vec<Sample>,
    skew_ms: f64,
}

impl ClockSkew {
    /// Eine Antwort: gesendet bei `t0`, empfangen bei `t1` (Gerätezeit), Server-Datum `server_ms`.
    pub fn observe(&mut self, t0: f64, t1: f64, server_ms: f64) {
        self.samples.push(Sample { offset: (t0 + t1) / 2.0 - (server_ms + 500.0), rtt: t1 - t0, at: t1 });
        self.samples.retain(|s| t1 - s.at < SAMPLE_MAX_AGE_MS);
        let skip = self.samples.len().saturating_sub(MAX_SAMPLES);
        self.samples.drain(..skip);
        if let Some(best) = self.samples.iter().reduce(|a, b| if b.rtt < a.rtt { b } else { a }) {
            self.skew_ms = best.offset;
        }
    }

    /// Geschätzter Versatz (positiv: Geräteuhr geht vor).
    pub fn skew_ms(&self) -> f64 {
        self.skew_ms
    }

    /// Was die Plattform als Uhr-Korrektur setzt (unter der Schwelle 0: Netzrauschen).
    pub fn applied_offset_ms(&self) -> f64 {
        if self.skew_ms.abs() > CLOCK_APPLY_MS { self.skew_ms } else { 0.0 }
    }

    /// Versatz in ganzen Minuten, wenn er die Warnschwelle überschreitet.
    pub fn warning_minutes(&self) -> Option<u64> {
        (self.skew_ms.abs() > CLOCK_SKEW_WARN_MS).then(|| (self.skew_ms.abs() / 60_000.0).round() as u64)
    }
}

/// Wartezeit vor Wiederholung `attempt` (0, 1, 2) nach 429/5xx: `(500 << attempt) · (1 + jitter)`,
/// `jitter` in `[0, 1)`.
pub fn retry_delay_ms(attempt: u32, jitter: f64) -> u64 {
    ((500u64 << attempt.min(16)) as f64 * (1.0 + jitter.clamp(0.0, 1.0))) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skew_prefers_fast_samples_and_ages() {
        let mut c = ClockSkew::default();
        c.observe(1000.0, 1000.0, 500.0 - 30_000.0);
        assert_eq!(c.skew_ms(), 30_000.0);
        assert_eq!(c.applied_offset_ms(), 30_000.0);
        c.observe(2000.0, 4000.0, 0.0); // langsam: verliert
        assert_eq!(c.skew_ms(), 30_000.0);
        c.observe(700_000.0, 700_100.0, 700_050.0 - 500.0 - 5000.0); // alte Messungen verfallen
        assert_eq!(c.skew_ms(), 5000.0);
        assert_eq!(c.applied_offset_ms(), 0.0);
        assert_eq!(c.warning_minutes(), None);
        c.observe(800_000.0, 800_000.0, 800_000.0 - 500.0 - 180_000.0);
        assert_eq!(c.warning_minutes(), Some(3));
    }

    #[test]
    fn retry_delays() {
        assert_eq!([0, 1, 2].map(|a| retry_delay_ms(a, 0.5)), [750, 1500, 3000]);
        assert_eq!(retry_delay_ms(0, 0.0), 500);
    }
}
