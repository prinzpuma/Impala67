//! Zeitregeln ohne Timer: Backoff für Wiederholungen und Reconnects, wann die Cloud
//! kompaktiert wird (`web/sync-transfer.js`, `web/sync-maintenance.js`). Die Timer selbst
//! stellt die Plattform.

/// `syncRetryDelayMs`: 1 s · 1,6^Versuch, höchstens 30 s.
pub fn retry_delay_ms(attempt: u32) -> u64 {
    backoff_ms(1000.0, attempt, 1.0)
}

/// Wartezeit vor dem nächsten WebSocket-Versuch (`scheduleReconnect`): Versuch zählt ab 1,
/// `jitter` ∈ [0,8; 1,2) liefert die Plattform aus ihrem Zufall.
pub fn reconnect_delay_ms(attempt: u32, jitter: f64) -> u64 {
    backoff_ms(1000.0, attempt, jitter)
}

fn backoff_ms(base: f64, attempt: u32, jitter: f64) -> u64 {
    let ms = (base * 1.6f64.powi(attempt.min(64) as i32) * jitter).round();
    ms.clamp(0.0, 30_000.0) as u64
}

/// Ab dieser Belegung (Prozent) wird die Cloud kompaktiert.
pub const CLOUD_COMPACT_THRESHOLD_PERCENT: f64 = 80.0;
/// Höchstens einmal je Woche, außer die Quota ist voll.
pub const CLOUD_COMPACT_COOLDOWN_MS: u64 = 7 * 24 * 60 * 60 * 1000;

/// `shouldCompactCloud`: verbunden, ≥ 80 % belegt und Abkühlzeit vorbei (oder ≥ 100 %).
/// `usage_percent`: `None`, wenn der Server noch nichts gemeldet hat.
pub fn should_compact_cloud(
    connected: bool,
    usage_percent: Option<f64>,
    last_compacted_at_ms: u64,
    now_ms: u64,
    bypass_cooldown: bool,
) -> bool {
    if !connected {
        return false;
    }
    if bypass_cooldown {
        return true;
    }
    let Some(percent) = usage_percent.filter(|p| p.is_finite()) else { return false };
    let cooldown_passed = now_ms.saturating_sub(last_compacted_at_ms) >= CLOUD_COMPACT_COOLDOWN_MS;
    percent >= CLOUD_COMPACT_THRESHOLD_PERCENT && (cooldown_passed || percent >= 100.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delays() {
        assert_eq!([0, 1, 2, 5, 7, 8, 50].map(retry_delay_ms), [1000, 1600, 2560, 10486, 26844, 30000, 30000]);
        assert_eq!(reconnect_delay_ms(1, 0.8), 1280);
    }

    #[test]
    fn compaction_rule() {
        let week = CLOUD_COMPACT_COOLDOWN_MS;
        assert!(!should_compact_cloud(false, Some(99.0), 0, week, true));
        assert!(should_compact_cloud(true, None, 0, 0, true));
        assert!(should_compact_cloud(true, Some(80.0), 0, week, false));
        assert!(!should_compact_cloud(true, Some(80.0), 1, week, false));
        assert!(should_compact_cloud(true, Some(100.0), 1, week, false));
        assert!(!should_compact_cloud(true, Some(79.0), 0, week, false));
        assert!(!should_compact_cloud(true, None, 0, week, false));
    }
}
