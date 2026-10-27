//! Zeitpunkt als Millisekunden seit 1970 (UTC). Gespeichert wird er wie im JS-Datenmodell als
//! ISO-Text (`Date.prototype.toISOString`, z. B. `2026-03-01T10:00:00.000Z`), damit Karten
//! zwischen JS und Rust austauschbar bleiben und `due`-Vergleiche als Text weiter stimmen.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;

pub const MS_PER_MINUTE: i64 = 60_000;
pub const MS_PER_DAY: i64 = 86_400_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Timestamp(pub i64);

impl Timestamp {
    pub fn from_millis(ms: i64) -> Self {
        Timestamp(ms)
    }

    pub fn millis(self) -> i64 {
        self.0
    }

    pub fn add_millis(self, ms: i64) -> Self {
        Timestamp(self.0.saturating_add(ms))
    }

    /// Tage (mit Bruchteil) von `earlier` bis `self`.
    pub fn days_since(self, earlier: Timestamp) -> f64 {
        (self.0 - earlier.0) as f64 / MS_PER_DAY as f64
    }

    /// Liest ISO-8601 wie es `toISOString` schreibt, dazu die üblichen Varianten: ohne
    /// Millisekunden/Sekunden, mit `±hh:mm`, nur Datum, sechsstellige Jahre (`+012345`).
    /// Abweichung: Datum+Uhrzeit ohne Zonenangabe gilt als UTC (JS nähme die Ortszeit) –
    /// kommt in gespeicherten Daten nicht vor.
    pub fn parse_iso(s: &str) -> Option<Self> {
        let (year, rest) = parse_year(s)?;
        let (month, rest) = fixed(rest.strip_prefix('-')?, 2)?;
        let (day, rest) = fixed(rest.strip_prefix('-')?, 2)?;
        if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
            return None;
        }
        let mut ms = days_from_civil(year, month, day) * MS_PER_DAY;
        if rest.is_empty() {
            return Some(Timestamp(ms));
        }
        let rest = rest.strip_prefix('T')?;
        let (h, rest) = fixed(rest, 2)?;
        let (mi, mut rest) = fixed(rest.strip_prefix(':')?, 2)?;
        let mut sec = 0;
        let mut frac = 0;
        if let Some(r) = rest.strip_prefix(':') {
            (sec, rest) = fixed(r, 2)?;
            if let Some(r) = rest.strip_prefix('.') {
                let digits = r.len() - r.trim_start_matches(|c: char| c.is_ascii_digit()).len();
                if digits == 0 {
                    return None;
                }
                // Millisekunden: erste drei Ziffern, Rest abgeschnitten (wie V8)
                let ms_part: String = r[..digits].chars().chain("00".chars()).take(3).collect();
                frac = ms_part.parse::<i64>().ok()?;
                rest = &r[digits..];
            }
        }
        if h > 24 || mi > 59 || sec > 59 || (h == 24 && (mi, sec, frac) != (0, 0, 0)) {
            return None;
        }
        ms += ((h * 60 + mi) * 60 + sec) * 1000 + frac;
        let offset = match rest {
            "Z" | "" => 0,
            _ => {
                let sign = match rest.as_bytes()[0] {
                    b'+' => 1,
                    b'-' => -1,
                    _ => return None,
                };
                let (oh, r) = fixed(&rest[1..], 2)?;
                let (om, r) = fixed(r.strip_prefix(':').unwrap_or(r), 2)?;
                if !r.is_empty() || oh > 23 || om > 59 {
                    return None;
                }
                sign * (oh * 60 + om) * MS_PER_MINUTE
            }
        };
        Some(Timestamp(ms - offset))
    }

    /// Wie `toISOString`: `YYYY-MM-DDTHH:MM:SS.sssZ`, außerhalb 0000–9999 mit `±YYYYYY`.
    pub fn to_iso(self) -> String {
        let days = self.0.div_euclid(MS_PER_DAY);
        let ms = self.0.rem_euclid(MS_PER_DAY);
        let (y, m, d) = civil_from_days(days);
        let year = if (0..=9999).contains(&y) {
            format!("{y:04}")
        } else {
            format!("{}{:06}", if y < 0 { '-' } else { '+' }, y.abs())
        };
        format!(
            "{year}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
            ms / 3_600_000,
            ms / 60_000 % 60,
            ms / 1000 % 60,
            ms % 1000
        )
    }
}

impl fmt::Display for Timestamp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_iso())
    }
}

impl Serialize for Timestamp {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_iso())
    }
}

impl<'de> Deserialize<'de> for Timestamp {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Timestamp::parse_iso(&s).ok_or_else(|| serde::de::Error::custom(format!("kein ISO-Zeitpunkt: {s:?}")))
    }
}

fn parse_year(s: &str) -> Option<(i64, &str)> {
    match s.as_bytes().first()? {
        b'+' | b'-' => {
            let (y, rest) = fixed(&s[1..], 6)?;
            Some((if s.starts_with('-') { -y } else { y }, rest))
        }
        _ => fixed(s, 4),
    }
}

/// Genau `n` ASCII-Ziffern.
fn fixed(s: &str, n: usize) -> Option<(i64, &str)> {
    let head = s.get(..n)?;
    if !head.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((head.parse().ok()?, &s[n..]))
}

fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

// Kalenderumrechnung nach H. Hinnant („chrono-Compatible Low-Level Date Algorithms“).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_hin_und_zurueck() {
        for s in [
            "1970-01-01T00:00:00.000Z",
            "2026-03-01T10:00:00.123Z",
            "2024-02-29T23:59:59.999Z",
            "0001-01-01T00:00:00.000Z",
            "+012345-06-07T08:09:10.011Z",
            "-000001-12-31T00:00:00.000Z",
        ] {
            assert_eq!(Timestamp::parse_iso(s).unwrap().to_iso(), s);
        }
        let t = |s| Timestamp::parse_iso(s).map(Timestamp::millis);
        assert_eq!(t("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(t("1970-01-01"), Some(0));
        assert_eq!(t("1970-01-01T01:00+01:00"), Some(0));
        assert_eq!(t("1970-01-01T00:00:00.5Z"), Some(500));
        for bad in
            ["", "kaputt", "2026-02-30", "2026-13-01", "2026-01-01T25:00Z", "2026-01-01T10:00:00.Z", "2026-01-01X"]
        {
            assert_eq!(t(bad), None, "{bad}");
        }
    }
}
