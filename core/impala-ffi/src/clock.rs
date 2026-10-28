//! Hybride logische Uhr für Event-Zeitstempel (wie `U.now`/`U.observeTime` in `web/util.js`):
//! monoton, um einen gemessenen Versatz korrigiert, und auf gesehene fremde Zeitstempel
//! nachgezogen, solange sie nicht mehr als 24 h in der Zukunft liegen (kaputte Uhr).

use std::time::{SystemTime, UNIX_EPOCH};

use impala_srs::Timestamp;

/// Fremde Zeitstempel weiter als das in der Zukunft werden nicht übernommen.
const MAX_ADOPT_AHEAD_MS: i64 = 86_400_000;

#[derive(Debug, Default)]
pub struct Clock {
    offset_ms: i64,
    last_ms: i64,
}

fn wall_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

impl Clock {
    /// Versatz der Geräteuhr (gemessen gegen einen Server); positiv = Gerät geht vor.
    pub fn set_offset(&mut self, ms: i64) {
        self.offset_ms = ms;
    }

    /// Nächster Zeitstempel als ISO-Text; nie gleich oder früher als der vorige.
    pub fn now(&mut self) -> String {
        self.now_at(wall_ms())
    }

    fn now_at(&mut self, wall: i64) -> String {
        let t = (wall - self.offset_ms).max(self.last_ms + 1);
        self.last_ms = t;
        Timestamp::from_millis(t).to_iso()
    }

    /// Fremden Zeitstempel sehen: `true`, wenn die Uhr ihn übernommen hat.
    pub fn observe(&mut self, iso: &str) -> bool {
        self.observe_at(iso, wall_ms())
    }

    fn observe_at(&mut self, iso: &str, wall: i64) -> bool {
        let Some(ms) = Timestamp::parse_iso(iso).map(Timestamp::millis) else {
            return false;
        };
        if ms > wall - self.offset_ms + MAX_ADOPT_AHEAD_MS {
            return false;
        }
        self.last_ms = self.last_ms.max(ms);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WALL: i64 = 1_790_000_000_000;

    #[test]
    fn monoton() {
        let mut c = Clock::default();
        let a = c.now_at(WALL);
        let b = c.now_at(WALL);
        let d = c.now_at(WALL - 5_000);
        assert!(a < b && b < d, "{a} {b} {d}");
        assert_eq!(b, Timestamp::from_millis(WALL + 1).to_iso());
    }

    #[test]
    fn zieht_auf_fremde_zeit_nach() {
        let mut c = Clock::default();
        let ahead = Timestamp::from_millis(WALL + 60_000).to_iso();
        assert!(c.observe_at(&ahead, WALL));
        assert_eq!(c.now_at(WALL), Timestamp::from_millis(WALL + 60_001).to_iso());
    }

    #[test]
    fn ignoriert_kaputte_uhren_und_unsinn() {
        let mut c = Clock::default();
        let far = Timestamp::from_millis(WALL + MAX_ADOPT_AHEAD_MS + 1).to_iso();
        assert!(!c.observe_at(&far, WALL));
        assert!(!c.observe_at("gestern", WALL));
        assert_eq!(c.now_at(WALL), Timestamp::from_millis(WALL).to_iso());
    }

    #[test]
    fn versatz() {
        let mut c = Clock::default();
        c.set_offset(2_000);
        assert_eq!(c.now_at(WALL), Timestamp::from_millis(WALL - 2_000).to_iso());
    }
}
