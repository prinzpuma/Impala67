//! Wann der Start-Checkpoint gespeichert wird (`checkpoint-scheduler.js`), als reine
//! Zustandsmaschine ohne Timer: Die Plattform meldet Ereignisse und führt die Antwort aus.
//!
//! Regel: Ein großer Checkpoint-Write blockiert kurz. Deshalb erst nach echter Ruhe
//! ([`Config::quiet_ms`] ohne Eingabe, danach Leerlauf), nie während ein Stift schreibt, und
//! bei einem gleichzeitigen Zustandswechsel höchstens [`Config::max_attempts`] Versuche.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Config {
    pub quiet_ms: u64,
    /// Höchstwartezeit auf Leerlauf (`requestIdleCallback`-Timeout).
    pub idle_timeout_ms: u64,
    pub max_attempts: u32,
}

impl Default for Config {
    fn default() -> Self {
        Self { quiet_ms: 5000, idle_timeout_ms: 5000, max_attempts: 3 }
    }
}

/// Was die Plattform tun soll.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Nichts.
    None,
    /// (Neu) warten: nach `quiet_ms` Ruhe, dann im Leerlauf (spätestens `idle_timeout_ms`)
    /// [`Scheduler::due`] melden. Ein schon laufender Wecker wird ersetzt.
    Wait { quiet_ms: u64, idle_timeout_ms: u64 },
    /// Jetzt speichern, danach [`Scheduler::finished`] melden.
    Save,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Waiting,
    Saving,
    Stopped,
}

#[derive(Debug, Clone)]
pub struct Scheduler {
    cfg: Config,
    phase: Phase,
    attempts: u32,
    /// Während des Speicherns erneut angefordert: der Lauf sah den neuen Stand evtl. nicht.
    rerun: bool,
}

impl Scheduler {
    pub fn new(cfg: Config) -> Self {
        Self {
            cfg: Config { max_attempts: cfg.max_attempts.max(1), ..cfg },
            phase: Phase::Idle,
            attempts: 0,
            rerun: false,
        }
    }

    fn wait(&mut self) -> Action {
        self.phase = Phase::Waiting;
        Action::Wait { quiet_ms: self.cfg.quiet_ms, idle_timeout_ms: self.cfg.idle_timeout_ms }
    }

    /// Zustand hat sich geändert – Checkpoint vormerken.
    pub fn schedule(&mut self) -> Action {
        match self.phase {
            Phase::Stopped => Action::None,
            Phase::Saving => {
                self.rerun = true;
                Action::None
            }
            Phase::Idle | Phase::Waiting => self.wait(),
        }
    }

    /// Nutzereingabe (Zeiger, Tastatur): verschiebt nur einen wartenden Termin.
    ///
    /// Abweichung von JS: Dort startete Eingabe während eines laufenden Speicherns einen
    /// zweiten Wecker, der ein paralleles Speichern auslösen konnte.
    pub fn activity(&mut self) -> Action {
        if self.phase == Phase::Waiting { self.wait() } else { Action::None }
    }

    /// Der Wecker ist abgelaufen. `writing`: Gerade wird geschrieben/gezeichnet → weiter warten.
    pub fn due(&mut self, writing: bool) -> Action {
        if self.phase != Phase::Waiting {
            return Action::None;
        }
        if writing {
            return self.wait();
        }
        self.attempts += 1;
        self.phase = Phase::Saving;
        Action::Save
    }

    /// Speichern beendet. `saved = false`: Zustand war inzwischen veraltet oder Fehler.
    pub fn finished(&mut self, saved: bool) -> Action {
        if self.phase != Phase::Saving {
            return Action::None;
        }
        if saved || self.attempts >= self.cfg.max_attempts {
            self.attempts = 0;
            self.phase = Phase::Idle;
            if std::mem::take(&mut self.rerun) {
                return self.wait();
            }
            return Action::None;
        }
        self.rerun = false; // der Wiederholungsversuch sieht den neuen Stand ohnehin
        self.wait()
    }

    pub fn stop(&mut self) {
        self.phase = Phase::Stopped;
    }

    pub fn attempts(&self) -> u32 {
        self.attempts
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_then_settles() {
        let mut s = Scheduler::new(Config::default());
        assert!(matches!(s.schedule(), Action::Wait { quiet_ms: 5000, .. }));
        assert!(matches!(s.due(true), Action::Wait { .. }), "Stift schreibt: weiter warten");
        assert_eq!(s.due(false), Action::Save);
        assert_eq!(s.schedule(), Action::None, "läuft: nur vormerken");
        assert!(matches!(s.finished(false), Action::Wait { .. }));
        assert_eq!(s.due(false), Action::Save);
        assert!(matches!(s.finished(false), Action::Wait { .. }));
        assert_eq!(s.due(false), Action::Save);
        assert_eq!(s.finished(false), Action::None, "nach 3 Versuchen aufgeben");
        assert_eq!(s.activity(), Action::None);
        assert!(matches!(s.schedule(), Action::Wait { .. }));
        assert_eq!(s.due(false), Action::Save);
        s.schedule();
        assert!(matches!(s.finished(true), Action::Wait { .. }), "vorgemerkt: erneut");
        s.stop();
        assert_eq!(s.schedule(), Action::None);
    }
}
