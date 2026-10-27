//! Wann automatisch gesynct wird (`web/drive-sync-policy.js` und der Auto-Sync-Teil von
//! `web/drive.js`). Die Plattform besitzt Timer und Ereignisse; hier steht nur die Entscheidung.

use serde_json::Value;

pub const DEFAULT_SYNC_MINUTES: u32 = 30;
/// Wählbare Intervalle (Minuten, Beschriftung).
pub const SYNC_INTERVAL_OPTIONS: [(u32, &str); 6] = [
    (5, "5 Minuten"),
    (15, "15 Minuten"),
    (30, "30 Minuten"),
    (60, "1 Stunde"),
    (180, "3 Stunden"),
    (1440, "Täglich (Backup-Modus)"),
];
/// Änderungen werden so lange gebündelt.
pub const AUTO_DELAY_MS: u64 = 3000;
/// Während getippt wird, erneut prüfen nach …
pub const EDIT_RECHECK_MS: u64 = 5000;
/// … höchstens so lange aufschieben, dann wird gesynct, egal wo der Cursor steht.
pub const MAX_DEFER_MS: f64 = 60_000.0;
/// Fokus allein ist keine Eingabe: nur ein Tastendruck in dieser Zeit zählt als Tippen.
pub const TYPING_IDLE_MS: f64 = 1500.0;

/// `normalizeDriveSyncMinutes` für den Einstellungswert `driveAutoSyncMinutes` (wie `Number(x)`).
pub fn sync_minutes(setting: Option<&Value>) -> u32 {
    let n = match setting {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() { 0.0 } else { t.parse().unwrap_or(f64::NAN) }
        }
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        _ => 0.0,
    };
    SYNC_INTERVAL_OPTIONS.iter().map(|(m, _)| *m).find(|m| f64::from(*m) == n).unwrap_or(DEFAULT_SYNC_MINUTES)
}

pub fn sync_interval_ms(setting: Option<&Value>) -> u64 {
    u64::from(sync_minutes(setting)) * 60_000
}

/// `driveSyncAfterChange`: nur ausdrücklich `true`.
pub fn sync_after_change(setting: Option<&Value>) -> bool {
    setting == Some(&Value::Bool(true))
}

/// Reine UI-Events stoßen keinen Sync an; sie reisen mit dem nächsten mit.
pub fn is_ui_only(event_type: &str) -> bool {
    event_type == "uiTabsSet"
}

/// Ändert ein Event das Intervall (Timer neu stellen)?
pub fn changes_interval(event: &Value) -> bool {
    event.get("type").and_then(Value::as_str) == Some("settingsSet")
        && event.get("payload").and_then(Value::as_object).is_some_and(|p| p.contains_key("driveAutoSyncMinutes"))
}

/// Was einen automatischen Sync auslöst.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoReason {
    Start,
    Change,
    Interval,
    Foreground,
    /// App geht in den Hintergrund: sofort, auch mitten in einer Eingabe.
    Background,
}

/// Entscheidung vor einem automatischen Sync.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gate {
    /// Nicht angemeldet oder schon ein Sync unterwegs: nichts tun.
    Skip,
    /// Offline: Status „Offline · wartet“.
    Offline,
    /// Nutzer tippt/zeichnet: über [`ChangeTimer`] später erneut.
    Defer,
    Run,
}

/// `autoSync`: Remote-Events nie mitten in eine Eingabe spielen; Hintergrund/Schließen
/// (`force`) sowie das Ende des Aufschiebens gehen durch.
pub fn auto_sync_gate(connected: bool, online: bool, editing: bool, force: bool, in_flight: bool) -> Gate {
    if !connected {
        Gate::Skip
    } else if !online {
        Gate::Offline
    } else if editing && !force {
        Gate::Defer
    } else if in_flight {
        Gate::Skip
    } else {
        Gate::Run
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeStep {
    /// Sync nach Änderung ist aus: Timer abbrechen.
    Cancel,
    /// Event zählt nicht (UI-Zustand).
    Ignore,
    /// Timer (neu) stellen; Status „Speichert…“.
    Schedule(u64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimerStep {
    /// Noch in Eingabe: in so vielen ms wieder fragen.
    Wait(u64),
    /// Jetzt syncen; `force` = trotz laufender Eingabe (Aufschieben ausgeschöpft).
    Sync { force: bool },
}

/// Bündelt Änderungen zu einem Sync (`scheduleAutoSync`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ChangeTimer {
    defer_since: Option<f64>,
}

impl ChangeTimer {
    /// Nach jedem lokalen Event.
    pub fn on_change(&mut self, now_ms: f64, after_change_enabled: bool, event_type: &str) -> ChangeStep {
        if !after_change_enabled {
            self.defer_since = None;
            return ChangeStep::Cancel;
        }
        if is_ui_only(event_type) {
            return ChangeStep::Ignore;
        }
        self.defer_since.get_or_insert(now_ms);
        ChangeStep::Schedule(AUTO_DELAY_MS)
    }

    /// Der Timer ist abgelaufen.
    // Abweichung von JS (drive.js:775/752): Nach Ablauf von MAX_DEFER_MS rief JS `autoSync` ohne
    // `force` – das prüfte das Tippen erneut und schob mit frischem Startzeitpunkt wieder auf.
    // Die Obergrenze [A5] griff so nie, solange weiter getippt wurde. Hier syncen wir dann wirklich.
    pub fn on_timer(&mut self, now_ms: f64, editing: bool) -> TimerStep {
        let since = *self.defer_since.get_or_insert(now_ms);
        if editing && now_ms - since < MAX_DEFER_MS {
            // JS: 5 s warten, dann erneut über scheduleAutoSync (weitere 3 s).
            return TimerStep::Wait(EDIT_RECHECK_MS + AUTO_DELAY_MS);
        }
        self.defer_since = None;
        TimerStep::Sync { force: editing }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn debounce_caps_deferral() {
        let mut t = ChangeTimer::default();
        assert_eq!(t.on_change(0.0, true, "uiTabsSet"), ChangeStep::Ignore);
        assert_eq!(t.on_change(0.0, true, "pageUpdate"), ChangeStep::Schedule(3000));
        assert_eq!(t.on_timer(3000.0, true), TimerStep::Wait(8000));
        assert_eq!(t.on_change(5000.0, true, "pageUpdate"), ChangeStep::Schedule(3000));
        assert_eq!(t.on_timer(59_000.0, true), TimerStep::Wait(8000));
        assert_eq!(t.on_timer(61_000.0, true), TimerStep::Sync { force: true });
        assert_eq!(t.on_change(62_000.0, true, "x"), ChangeStep::Schedule(3000));
        assert_eq!(t.on_timer(65_000.0, false), TimerStep::Sync { force: false });
        assert_eq!(t.on_change(0.0, false, "x"), ChangeStep::Cancel);
    }

    #[test]
    fn gate() {
        assert_eq!(auto_sync_gate(false, true, false, false, false), Gate::Skip);
        assert_eq!(auto_sync_gate(true, false, false, true, false), Gate::Offline);
        assert_eq!(auto_sync_gate(true, true, true, false, false), Gate::Defer);
        assert_eq!(auto_sync_gate(true, true, true, true, false), Gate::Run);
        assert_eq!(auto_sync_gate(true, true, false, false, true), Gate::Skip);
        assert!(changes_interval(&json!({"type": "settingsSet", "payload": {"driveAutoSyncMinutes": 5}})));
        assert!(!changes_interval(&json!({"type": "settingsSet", "payload": {"theme": 5}})));
    }
}
