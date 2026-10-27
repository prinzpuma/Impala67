//! Anzeige-Zustand (`web/drive-status.js`, `web/backup-status.js`, Drive-Teil von
//! `web/settings-action-state.js`): EINE Aussage aus Anmeldung, Netz und letztem Sync.

use serde_json::Value;

use crate::DriveError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthState {
    Disconnected,
    Connecting,
    Connected,
    /// Sitzung bekannt, Token abgelaufen (Googles Web-Anmeldung hält eine Stunde – Normalfall).
    RenewalRequired,
}

impl AuthState {
    pub fn as_str(self) -> &'static str {
        match self {
            AuthState::Disconnected => "disconnected",
            AuthState::Connecting => "connecting",
            AuthState::Connected => "connected",
            AuthState::RenewalRequired => "renewal-required",
        }
    }
}

/// `driveAuthState`.
pub fn auth_state(token_valid: bool, session_known: bool) -> AuthState {
    match (token_valid, session_known) {
        (true, _) => AuthState::Connected,
        (false, true) => AuthState::RenewalRequired,
        (false, false) => AuthState::Disconnected,
    }
}

/// Ablaufzeit eines frischen Tokens: eine Minute Puffer, ohne Angabe eine Stunde.
pub fn token_expiry_ms(now_ms: f64, expires_in_s: Option<f64>) -> f64 {
    let secs = expires_in_s.filter(|s| s.is_finite() && *s != 0.0).unwrap_or(3600.0);
    now_ms + secs * 1000.0 - 60_000.0
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiState {
    Idle,
    Syncing,
    Waiting,
    Ok,
    Error,
}

impl UiState {
    pub fn as_str(self) -> &'static str {
        match self {
            UiState::Idle => "idle",
            UiState::Syncing => "syncing",
            UiState::Waiting => "waiting",
            UiState::Ok => "ok",
            UiState::Error => "error",
        }
    }
}

/// Letzter Sync-Zustand für die Anzeige (`syncUi`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncUi {
    pub state: UiState,
    pub label: String,
    pub detail: String,
}

impl SyncUi {
    pub fn idle() -> SyncUi {
        SyncUi { state: UiState::Idle, label: String::new(), detail: String::new() }
    }

    /// `emitSyncStatus`: ohne Detail gilt die Beschriftung.
    pub fn new(state: UiState, label: &str, detail: &str) -> SyncUi {
        let detail = if detail.is_empty() { label } else { detail };
        SyncUi { state, label: label.to_owned(), detail: detail.to_owned() }
    }

    /// Nach einem gescheiterten Sync. `None`: Anmeldung abgelaufen – das zeigt der Auth-Zustand
    /// („Pausiert“), kein Fehler.
    pub fn failed(error: &DriveError, online: bool) -> Option<SyncUi> {
        if *error == DriveError::SessionExpired {
            return None;
        }
        let message = error.to_string();
        Some(if online {
            SyncUi::new(UiState::Error, "Sync fehlgeschlagen", &message)
        } else {
            SyncUi::new(UiState::Waiting, "Offline", &message)
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusView {
    pub state: UiState,
    pub label: String,
    pub detail: String,
}

/// `driveStatusView`.
pub fn status_view(auth: AuthState, sync: &SyncUi, online: bool, email: &str) -> StatusView {
    let view = |state, label: &str, detail: &str| StatusView { state, label: label.into(), detail: detail.into() };
    match auth {
        AuthState::Connecting => view(UiState::Syncing, "Anmeldung läuft…", "Google-Verbindung wird hergestellt"),
        AuthState::Disconnected => view(UiState::Idle, "Nicht verbunden", "Google Drive ist nicht verbunden"),
        _ if !online => view(UiState::Waiting, "Offline", "Drive-Sync wartet auf eine Internetverbindung"),
        AuthState::RenewalRequired => {
            view(UiState::Idle, "Pausiert", "Sichert weiter, sobald du auf „Jetzt sichern“ tippst")
        }
        _ if sync.state != UiState::Idle => {
            let label = if sync.label.is_empty() { "Drive-Sync" } else { &sync.label };
            let detail = if sync.detail.is_empty() { label } else { &sync.detail };
            view(sync.state, label, detail)
        }
        _ if email.is_empty() => view(UiState::Idle, "Verbunden", "Google Drive ist verbunden"),
        _ => view(UiState::Idle, "Verbunden", &format!("Verbunden als {email}")),
    }
}

/// Hauptknopf der Drive-Einstellungen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriveAction {
    /// Client-ID fehlt: erst einrichten.
    Setup,
    Sync,
}

/// `driveActionState`: Aktion und Beschriftung.
pub fn action_state(has_client: bool, connected: bool, needs_login: bool) -> (DriveAction, &'static str) {
    match (has_client, needs_login, connected) {
        (false, _, _) => (DriveAction::Setup, "Drive einrichten"),
        (true, true, _) => (DriveAction::Sync, "Jetzt sichern"),
        (true, false, true) => (DriveAction::Sync, "Drive synchronisieren"),
        (true, false, false) => (DriveAction::Sync, "Mit Google anmelden & synchronisieren"),
    }
}

// ---- Datensicherheit (backup-status.js) ---------------------------------------------

/// Ab diesem Alter gilt Ungesichertes als liegengeblieben.
pub const BACKUP_STALE_MS: f64 = 24.0 * 3600e3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackupLevel {
    /// Nichts Ungesichertes.
    Safe,
    /// Frisch, wird gleich mitgenommen.
    Pending,
    /// Sync eingerichtet, hängt aber hinterher.
    Stale,
    /// Gar kein Sync: Daten nur auf diesem Gerät.
    Local,
}

impl BackupLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            BackupLevel::Safe => "safe",
            BackupLevel::Pending => "pending",
            BackupLevel::Stale => "stale",
            BackupLevel::Local => "local",
        }
    }

    /// Wie lange „Später“ den Hinweis ausblendet (wer bewusst ohne Sync arbeitet: seltener).
    pub fn snooze_ms(self) -> f64 {
        if self == BackupLevel::Local { 14.0 * 24.0 * 3600e3 } else { 3.0 * 24.0 * 3600e3 }
    }

    /// Hinweis auf der Startseite nur bei echtem Handlungsbedarf.
    pub fn needs_hint(self) -> bool {
        matches!(self, BackupLevel::Stale | BackupLevel::Local)
    }
}

/// `backupView`: `unsafe_since` ist der Zeitstempel des ältesten ungesicherten eigenen Events.
pub fn backup_view(has_channel: bool, unsafe_since: Option<&str>, now_ms: f64) -> (BackupLevel, Option<String>) {
    let Some((since, ms)) = unsafe_since.and_then(|s| Some((s, parse_iso_ms(s)?))) else {
        return (BackupLevel::Safe, None);
    };
    let level = if now_ms - ms < BACKUP_STALE_MS {
        BackupLevel::Pending
    } else if has_channel {
        BackupLevel::Stale
    } else {
        BackupLevel::Local
    };
    (level, Some(since.to_owned()))
}

/// Bis zu welcher lokalen `seq` alles außerhalb des Geräts liegt (Cloudflare nur, wenn aktiv;
/// der Drive-Wasserstand gilt auch nach dem Abmelden).
pub fn protected_seq(cloudflare_active: bool, cloudflare_uploaded: u64, drive_uploaded: u64) -> u64 {
    (if cloudflare_active { cloudflare_uploaded } else { 0 }).max(drive_uploaded)
}

/// Zeitstempel des ersten eigenen (nicht importierten, nicht abgeleiteten) Events über dem
/// Wasserstand (`isLocalOnly`). Events in `seq`-Reihenfolge.
pub fn first_unsafe_at(events: &[Value], protected_seq: u64) -> Option<String> {
    let flag = |ev: &Value, k: &str| ev.get(k).is_some_and(|v| !matches!(v, Value::Null | Value::Bool(false)));
    events
        .iter()
        .find(|ev| {
            ev.get("seq").and_then(Value::as_u64).unwrap_or(0) > protected_seq
                && !flag(ev, "_remote")
                && !flag(ev, "_derived")
        })
        .and_then(|ev| ev.get("t").and_then(Value::as_str).filter(|t| !t.is_empty()).map(str::to_owned))
}

/// ISO-Zeit (`YYYY-MM-DDTHH:MM:SS[.sss]Z` oder ohne Uhrzeit) in ms; sonst `None` (`Date.parse` → NaN).
pub fn parse_iso_ms(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    let num = |r: std::ops::Range<usize>| -> Option<i64> {
        let part = s.get(r)?;
        part.bytes().all(|c| c.is_ascii_digit()).then(|| part.parse().ok())?
    };
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    if b.get(4) != Some(&b'-') || b.get(7) != Some(&b'-') || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let mut ms = 0i64;
    if b.len() > 10 {
        if b.get(10) != Some(&b'T') || b.get(13) != Some(&b':') || b.get(16) != Some(&b':') || b.last() != Some(&b'Z') {
            return None;
        }
        let (h, mi, sec) = (num(11..13)?, num(14..16)?, num(17..19)?);
        let frac = match &s[19..s.len() - 1] {
            "" => 0,
            f if f.len() == 4 && f.starts_with('.') => num(20..23)?,
            _ => return None,
        };
        if h > 24 || mi > 59 || sec > 59 {
            return None;
        }
        ms = ((h * 60 + mi) * 60 + sec) * 1000 + frac;
    }
    Some((crate::api::days_from_civil(y, m, d) * 86_400_000 + ms) as f64)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn iso() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:01.500Z"), Some(1500.0));
        assert_eq!(parse_iso_ms("2026-10-27T14:05:00Z"), parse_iso_ms("2026-10-27T14:05:00.000Z"));
        assert_eq!(parse_iso_ms("kaputt"), None);
        assert_eq!(parse_iso_ms("2026-13-01"), None);
    }

    #[test]
    fn unsafe_events() {
        let evs = [
            json!({"seq": 3, "t": "a"}),
            json!({"seq": 4, "t": "b", "_remote": true}),
            json!({"seq": 5, "t": "c", "_derived": true}),
            json!({"seq": 6, "t": "d"}),
        ];
        assert_eq!(first_unsafe_at(&evs, 3).as_deref(), Some("d"));
        assert_eq!(first_unsafe_at(&evs, 2).as_deref(), Some("a"));
        assert_eq!(first_unsafe_at(&evs, 6), None);
        assert_eq!(protected_seq(false, 9, 4), 4);
        assert_eq!(protected_seq(true, 9, 4), 9);
    }

    #[test]
    fn failed_sync_ui() {
        assert_eq!(SyncUi::failed(&DriveError::SessionExpired, true), None);
        let ui = SyncUi::failed(&DriveError::Http { status: 500, body: "x".into() }, false).unwrap();
        assert_eq!(
            (ui.state, ui.label.as_str(), ui.detail.as_str()),
            (UiState::Waiting, "Offline", "Drive-Fehler 500: x")
        );
        assert_eq!(token_expiry_ms(0.0, None), 3_540_000.0);
    }
}
