//! Speicheranzeige der Cloud-Quota (`formatStorageUsage`).

/// Quota je Konto auf dem Worker (`MAX_USER_BYTES` in `server/worker.js`).
pub const MAX_USER_STORAGE_BYTES: u64 = 1_000_000_000;

#[derive(Debug, Clone, PartialEq)]
pub struct StorageUsage {
    pub bytes: f64,
    pub limit: f64,
    /// MB mit einer Nachkommastelle.
    pub mb_used: f64,
    pub mb_limit: f64,
    /// 0–100, gerundet.
    pub percent: f64,
    /// z. B. `"12.3 MB / 1000 MB (1 %)"`.
    pub formatted: String,
}

/// `bytes`/`limit` wie `Number(x)`: unbrauchbare Werte (NaN, ±∞) zählen als 0 bzw. Standard-Quota.
// Abweichung von JS: ∞ ergab dort "Infinity MB"; hier zählt es als ungültig.
pub fn format_storage_usage(bytes: f64, limit: Option<f64>) -> StorageUsage {
    let used = if bytes.is_finite() { bytes.max(0.0) } else { 0.0 };
    let limit = limit.filter(|l| l.is_finite() && *l != 0.0).unwrap_or(MAX_USER_STORAGE_BYTES as f64);
    let cap = limit.max(1.0);
    let mb_text = to_fixed_1(used / 1_000_000.0);
    let mb_used = mb_text.parse().unwrap_or(0.0);
    let mb_limit = js_round(cap / 1_000_000.0);
    let percent = js_round(used / cap * 100.0).min(100.0);
    let formatted =
        format!("{} MB / {} MB ({} %)", to_fixed_1(mb_used), js_round_text(mb_limit), js_round_text(percent));
    StorageUsage { bytes: used, limit: cap, mb_used, mb_limit, percent, formatted }
}

/// `Math.round`: halbe Werte Richtung +∞.
fn js_round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 { f + 1.0 } else { f }
}

fn js_round_text(x: f64) -> String {
    crate::json::number_to_string(x)
}

/// `x.toFixed(1)` für x ≥ 0: rundet den exakten Dezimalwert, Gleichstand aufwärts
/// (Rusts `{:.1}` rundet Gleichstände zur geraden Ziffer: 0.25 → "0.2", JS "0.3").
fn to_fixed_1(x: f64) -> String {
    if x >= 1e21 {
        return crate::json::number_to_string(x);
    }
    let exact = format!("{x:.80}");
    let (int, frac) = exact.split_once('.').unwrap_or((&exact, "0"));
    let first = frac.as_bytes().first().map_or(0, |d| d - b'0');
    let rest = &frac[1.min(frac.len())..];
    let up = rest.as_bytes().first().is_some_and(|d| *d >= b'5');
    let mut tenths: u128 = int.parse::<u128>().unwrap_or(0) * 10 + u128::from(first);
    if up {
        tenths += 1;
    }
    format!("{}.{}", tenths / 10, tenths % 10)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_like_js() {
        let u = format_storage_usage(250_000.0, None);
        assert_eq!(u.formatted, "0.3 MB / 1000 MB (0 %)");
        assert_eq!(u.mb_used, 0.3);
        let u = format_storage_usage(5_000_000.0, Some(1_000_000_000.0));
        assert_eq!(u.formatted, "5.0 MB / 1000 MB (1 %)");
        let u = format_storage_usage(2e9, Some(1e9));
        assert_eq!((u.percent, u.formatted.as_str()), (100.0, "2000.0 MB / 1000 MB (100 %)"));
        let u = format_storage_usage(f64::NAN, Some(f64::NAN));
        assert_eq!(u.formatted, "0.0 MB / 1000 MB (0 %)");
        assert_eq!(format_storage_usage(-5.0, Some(0.5)).limit, 1.0);
        assert_eq!(to_fixed_1(0.05), "0.1");
        assert_eq!(to_fixed_1(0.04999), "0.0");
        assert_eq!(to_fixed_1(9.96), "10.0");
    }
}
