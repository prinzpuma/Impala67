use impala_model::Model;
use impala_model::search::NoteSearch;
use serde_json::{Value, json};

use crate::{Context, Host, run, run_flat, undo};

/// Modell im Speicher; Events bekommen fortlaufende IDs und Zeiten.
#[derive(Default)]
struct Mem {
    m: Model,
    s: NoteSearch,
    n: u64,
}

impl Host for Mem {
    fn model(&self) -> &Model {
        &self.m
    }
    fn model_search(&mut self) -> (&Model, &mut NoteSearch) {
        (&self.m, &mut self.s)
    }
    fn dispatch(&mut self, kind: &str, payload: Value) -> Result<(), String> {
        let id = self.new_id();
        let n = self.n;
        let now = format!("2026-11-19T10:{:02}:{:02}.{:03}Z", n / 60_000 % 60, n / 1000 % 60, n % 1000);
        self.m.apply_local(Model::local_event(kind, payload, &id, &now));
        Ok(())
    }
    fn new_id(&mut self) -> String {
        self.n += 1;
        format!("id-{}", self.n)
    }
}

impl Mem {
    fn page(&mut self, title: &str, parent: Option<&str>) -> String {
        let id = self.new_id();
        self.dispatch(
            "pageCreate",
            json!({ "id": id, "title": title, "parentId": parent, "content": "", "workspaceId": "default" }),
        )
        .unwrap();
        id
    }
    fn content(&self, id: &str) -> String {
        self.m.state().pages.get(id).map(|p| p.content().to_owned()).unwrap_or_default()
    }
}

fn ctx() -> Context {
    // Mittwoch, 28. Oktober 2026, 14:05 (UTC+1)
    Context::at(1_793_192_700_000, 60)
}

#[test]
fn change_legt_an_und_macht_rueckgaengig() {
    let mut h = Mem::default();
    let mathe = h.page("Mathe", None);
    h.dispatch("pageUpdate", json!({ "id": mathe, "patch": { "content": "Zeile A\nZeile B" } })).unwrap();
    let ops = json!({ "operations": [
        { "op": "page.create", "title": "Neu", "content": "Hallo", "parent": "Mathe" },
        { "op": "page.patch", "title": "Mathe", "search": "Zeile B", "replace": "Zeile C" },
        { "op": "card.create", "front": "Was ist 1+1?", "back": "2", "deck": "Rechnen" },
    ]});
    let (res, set) = run(&mut h, &ctx(), "change", &ops).unwrap();
    assert_eq!(res["ok"], true, "{res}");
    let set = set.unwrap();
    assert_eq!(set["pages"].as_array().unwrap().len(), 2);
    assert_eq!(h.content(&mathe), "Zeile A\nZeile C");
    assert_eq!(h.m.state().active_cards().len(), 1);

    undo(&mut h, &set).unwrap();
    assert_eq!(h.content(&mathe), "Zeile A\nZeile B");
    assert!(h.m.state().active_cards().is_empty());
    assert!(h.m.state().find_page("Neu", true).is_none());
}

#[test]
fn ordnerfilter_pfade_und_duplikat_schutz() {
    let mut h = Mem::default();
    let km = h.page("Kontinuumsmechanik", None);
    let vl = h.page("Vorlesungen", Some(&km));
    h.page("4 · Lager", Some(&vl));
    let mathe = h.page("Mathe", None);
    h.page("Vorlesungen", Some(&mathe));
    let c = ctx();

    let (r, _) = run_flat(&mut h, &c, "list_pages", &json!({ "parent": "Kontinuumsmechanik" })).unwrap();
    let titles: Vec<&str> = r["pages"].as_array().unwrap().iter().map(|p| p["title"].as_str().unwrap()).collect();
    assert_eq!(titles.len(), 2, "{titles:?}");
    assert!(titles.contains(&"4 · Lager") && titles.contains(&"Kontinuumsmechanik/Vorlesungen"));
    let (r, _) = run_flat(&mut h, &c, "list_pages", &json!({ "query": "Kontinuumsmechanik/Vorlesungen/4" })).unwrap();
    assert_eq!(r["pages"].as_array().unwrap().len(), 1);
    let (r, _) = run_flat(&mut h, &c, "list_pages", &json!({ "parent": "GibtsNicht" })).unwrap();
    assert!(r["error"].as_str().unwrap().contains("Ordner nicht gefunden"));

    let dup = json!({ "pages": [{ "title": "Vorlesungen", "parent": "Kontinuumsmechanik" }] });
    let (r, _) = run_flat(&mut h, &c, "create_pages", &dup).unwrap();
    assert!(r["error"].as_str().unwrap().contains("existiert bereits"), "{r}");
    let (r, _) =
        run_flat(&mut h, &c, "create_pages", &json!({ "pages": [{ "title": "4 · Lager", "parent": "Mathe" }] }))
            .unwrap();
    assert_eq!(r["ok"], true, "{r}");
    // Heft anlegen: kind heft, ID in der Antwort und in list_pages
    let (r, _) = run_flat(&mut h, &c, "create_pages", &json!({ "pages": [{ "title": "Blatt 5", "heft": true }] })).unwrap();
    assert_eq!(r["ok"], true, "{r}");
    let heft = h.m.state().find_page("Blatt 5", true).map(|p| (p.is_heft(), p.id().to_owned())).unwrap();
    assert!(heft.0);
    let (r, _) = run_flat(&mut h, &c, "list_pages", &json!({ "query": "Blatt 5" })).unwrap();
    assert_eq!(r["pages"][0]["id"], heft.1, "{r}");
    // Teil-Treffer in der Suche
    h.dispatch("pageUpdate", json!({ "id": mathe, "patch": { "content": "Eigenwerte und Eigenvektoren" } })).unwrap();
    let (r, _) = run_flat(&mut h, &c, "search", &json!({ "query": "eigenwert" })).unwrap();
    assert_eq!(r["results"][0]["title"], "Mathe", "{r}");
}

#[test]
fn trockenlauf_und_validierung() {
    let mut h = Mem::default();
    h.page("Seite", None);
    let c = ctx();
    let (r, set) =
        run_flat(&mut h, &c, "create_pages", &json!({ "dry_run": true, "pages": [{ "title": "Zwei" }] })).unwrap();
    assert_eq!((r["dryRun"].clone(), set), (Value::Bool(true), None));
    assert_eq!(r["ops"][0]["op"], "page.create");
    assert!(h.m.state().find_page("Zwei", true).is_none());
    let (r, _) = run(
        &mut h,
        &c,
        "change",
        &json!({ "operations": [
            { "op": "page.create", "title": "Eins" },
            { "op": "page.patch", "title": "Seite", "search": "gibtsnicht", "replace": "x" },
        ]}),
    )
    .unwrap();
    assert!(r["error"].as_str().unwrap().contains("Keine Änderungen ausgeführt"), "{r}");
    assert!(h.m.state().find_page("Eins", true).is_none());
    let (r, _) = run(&mut h, &c, "inspect", &json!({ "kind": "context" })).unwrap();
    assert!(r["now"].as_str().unwrap().starts_with("Mittwoch, 28. Oktober 2026, 14:05"), "{r}");
    assert!(run(&mut h, &c, "calculate", &json!({})).is_none());
}

#[test]
fn chats_aus_dem_kontext() {
    let mut h = Mem::default();
    let mut c = ctx();
    c.chats = Some(vec![json!({ "id": "c1", "title": "Lernplan", "updated": "2026-11-01T10:00:00Z",
        "messages": [{ "role": "user", "content": "Wann ist die Klausur in Analysis?" }] })]);
    let (r, _) = run(&mut h, &c, "inspect", &json!({ "kind": "chats", "query": "klausur" })).unwrap();
    assert_eq!(r["totalMatches"], 1, "{r}");
    assert_eq!(r["results"][0]["chatTitle"], "Lernplan");
}
