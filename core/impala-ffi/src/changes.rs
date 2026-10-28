//! Änderungs-Meldungen an die Oberfläche. Jede angewandte Änderung (eigene wie fremde aus dem Sync)
//! sammelt der Kern als [`Changes`]; nach dem Aufruf – außerhalb der Sperre, damit die Plattform
//! im Rückruf gleich wieder lesen darf – geht die Sammlung an den [`ChangeListener`].

use std::sync::Arc;

use impala_model::{Ids, LogEvent, Touched, touched};

use crate::{ImpalaCore, Inner, Shared, lock};

/// Rückruf der App. Kommt aus dem aufrufenden Thread oder dem Sync-Thread: schnell zurückkehren
/// (z. B. auf den UI-Thread weiterreichen).
#[uniffi::export(with_foreign)]
pub trait ChangeListener: Send + Sync {
    fn on_changed(&self, changes: Changes);
}

/// Was sich seit der letzten Meldung geändert hat. `*_all`: die ganze Sammlung neu lesen.
#[derive(Debug, Clone, Default, PartialEq, uniffi::Record)]
pub struct Changes {
    /// Zustand neu geladen (Import, sortiertes Neuladen): alles neu lesen.
    pub everything: bool,
    /// Mindestens eine Änderung kam von einem anderen Gerät.
    pub remote: bool,
    pub pages: Vec<String>,
    pub pages_all: bool,
    pub cards: Vec<String>,
    pub cards_all: bool,
    pub chats: Vec<String>,
    pub chats_all: bool,
    pub decks: bool,
    pub reviews: bool,
    pub grades: bool,
    pub learning_sessions: bool,
    pub home_articles: bool,
    pub settings: bool,
    pub workspaces: bool,
    pub heft_folders: bool,
    /// Geänderte Hefte (Seiten-IDs): offene Heftansicht nachziehen.
    pub hefte: Vec<String>,
    /// Neu eingetroffene Heft-Bilder (Hash): Bilder neu zeichnen.
    pub heft_images: Vec<String>,
    /// Seiten, deren offene Ansicht schließen (Papierkorb, Archiv, endgültig gelöscht).
    pub closed_pages: Vec<String>,
}

fn add_ids(list: &mut Vec<String>, all: &mut bool, ids: Ids) {
    match ids {
        Ids::None => {}
        Ids::All => *all = true,
        Ids::Some(ids) => {
            for id in ids {
                if !list.contains(&id) {
                    list.push(id);
                }
            }
        }
    }
}

fn add_one(list: &mut Vec<String>, id: Option<String>) {
    if let Some(id) = id
        && !list.contains(&id)
    {
        list.push(id);
    }
}

impl Changes {
    pub(crate) fn is_empty(&self) -> bool {
        *self == Changes::default()
    }

    fn add(&mut self, t: Touched, remote: bool) {
        self.remote |= remote;
        add_ids(&mut self.pages, &mut self.pages_all, t.pages);
        add_ids(&mut self.cards, &mut self.cards_all, t.cards);
        add_ids(&mut self.chats, &mut self.chats_all, t.chat_sessions);
        self.decks |= t.decks;
        self.reviews |= t.reviews;
        self.grades |= t.grades;
        self.learning_sessions |= t.learning_sessions;
        self.home_articles |= t.home_articles;
        self.settings |= t.settings;
        self.workspaces |= t.workspaces;
        self.heft_folders |= t.gn_folders;
        add_one(&mut self.hefte, t.heft);
        add_one(&mut self.heft_images, t.blob);
        for id in t.closed_pages {
            add_one(&mut self.closed_pages, Some(id));
        }
    }
}

impl Inner {
    /// `ev` wurde gerade angewandt.
    pub(crate) fn note(&mut self, ev: &LogEvent, remote: bool) {
        let t = touched(ev, self.model.state());
        self.pending.add(t, remote);
    }

    /// Gespeicherte Fremd-Events in Zeitreihenfolge anwenden und vormerken.
    pub(crate) fn apply_remote(&mut self, mut events: Vec<LogEvent>) {
        impala_model::order::sort_events(&mut events);
        for ev in events {
            // `touched` liest nur diese Felder; so muss kein großes Heft-Bild kopiert werden.
            let mut p = serde_json::Map::new();
            for k in ["id", "pageId", "hash"] {
                if let Some(v) = ev.payload.get(k) {
                    p.insert(k.into(), v.clone());
                }
            }
            let probe = LogEvent::new(ev.id.clone(), ev.t.clone(), ev.kind.clone(), serde_json::Value::Object(p));
            self.model.apply_remote_one(ev);
            self.note(&probe, true);
        }
    }

    /// Der ganze Zustand wurde neu geladen.
    pub(crate) fn note_everything(&mut self, remote: bool) {
        self.pending.everything = true;
        self.pending.remote |= remote;
    }
}

/// Gesammelte Änderungen melden. Nur ohne gehaltene Sperre rufen.
pub(crate) fn notify(shared: &Shared) {
    let (changes, listener) = {
        let mut inner = lock(shared);
        if inner.pending.is_empty() {
            return;
        }
        let Some(listener) = inner.listener.clone() else {
            inner.pending = Changes::default();
            return;
        };
        (std::mem::take(&mut inner.pending), listener)
    };
    listener.on_changed(changes);
}

#[uniffi::export]
impl ImpalaCore {
    /// Meldet künftig jede Änderung (ersetzt einen früheren Empfänger; `None` meldet ab).
    pub fn set_change_listener(&self, listener: Option<Arc<dyn ChangeListener>>) {
        let mut inner = self.lock();
        inner.pending = Changes::default();
        inner.listener = listener;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    #[derive(Default)]
    struct Recorder(Mutex<Vec<Changes>>);

    impl ChangeListener for Recorder {
        fn on_changed(&self, changes: Changes) {
            self.0.lock().unwrap().push(changes);
        }
    }

    #[test]
    fn meldet_eigene_aenderungen() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let rec = Arc::new(Recorder::default());
        core.set_change_listener(Some(rec.clone()));
        let id = core.create_page("A".into(), "".into(), None, None).unwrap();
        core.trash_page(id.clone()).unwrap();
        let got = rec.0.lock().unwrap().clone();
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].pages, std::slice::from_ref(&id));
        assert!(!got[0].remote);
        assert!(got[1].pages_all);
        assert_eq!(got[1].closed_pages, [id]);
    }

    #[test]
    fn rueckruf_darf_wieder_lesen() {
        struct Reader(Arc<ImpalaCore>, Mutex<usize>);
        impl ChangeListener for Reader {
            fn on_changed(&self, _: Changes) {
                *self.1.lock().unwrap() = self.0.recent_pages(10).len();
            }
        }
        let core = ImpalaCore::open_in_memory().unwrap();
        let reader = Arc::new(Reader(core.clone(), Mutex::new(0)));
        core.set_change_listener(Some(reader.clone()));
        core.create_page("A".into(), "".into(), None, None).unwrap();
        assert_eq!(*reader.1.lock().unwrap(), 1);
        core.set_change_listener(None);
    }
}
