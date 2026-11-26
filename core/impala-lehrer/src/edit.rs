//! `edit_timeline`: Zeitstrahl anlegen oder ändern (Upsert von Knoten, Eltern auflösen, Prüfungen).
//! Fehlertexte sind so formuliert, dass auch kleine Modelle daraus die Korrektur ableiten können.

use serde::Serialize;
use serde_json::{Map, Value};

use crate::css::sanitize_css;
use crate::model::{
    Image, MAX_BODY, MAX_NODES, MAX_SVG, Node, Question, Source, Timeline, WorksheetProgress, find_in, find_title,
    year_of,
};
use crate::text::slug;

#[derive(Debug, Clone, Serialize)]
pub struct EditOut {
    pub timeline: Value,
    pub added: Vec<String>,
    pub updated: Vec<String>,
    pub removed: Vec<String>,
    /// Hinweise ohne Abbruch, z. B. Lektion früher datiert als ihre Voraussetzung.
    pub warnings: Vec<String>,
}

/// Gesendete Felder eines Knotens; `None` = nicht gesendet, `Some(None)` = ausdrücklich geleert.
#[derive(Default)]
struct Patch {
    id: Option<String>,
    title: Option<String>,
    era: Option<String>,
    year: Option<Option<f64>>,
    strand: Option<String>,
    summary: Option<String>,
    body: Option<String>,
    images: Option<Vec<Image>>,
    svg: Option<Option<String>>,
    sources: Option<Vec<Source>>,
    pretest: Option<Option<Question>>,
    quiz: Option<Vec<Question>>,
    worksheet: Option<Option<String>>,
    deck: Option<Option<String>>,
    parents: Option<Vec<String>>,
}

fn text_field(o: &Map<String, Value>, key: &str, ctx: &str) -> Result<Option<String>, String> {
    match o.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(Value::Number(n)) => Ok(Some(n.to_string())),
        Some(_) => Err(format!("edit_timeline: {ctx}„{key}“ muss Text sein.")),
    }
}

/// Text oder `null` (= leeren).
fn clearable(o: &Map<String, Value>, key: &str, ctx: &str) -> Result<Option<Option<String>>, String> {
    if matches!(o.get(key), Some(Value::Null)) {
        return Ok(Some(None));
    }
    Ok(text_field(o, key, ctx)?.map(|s| Some(s.trim().to_string()).filter(|s| !s.is_empty())))
}

fn list<'a>(o: &'a Map<String, Value>, key: &str, ctx: &str) -> Result<Option<&'a [Value]>, String> {
    match o.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Array(a)) => Ok(Some(a)),
        Some(_) => Err(format!("edit_timeline: {ctx}„{key}“ muss eine Liste sein.")),
    }
}

fn str_of(o: &Map<String, Value>, key: &str) -> String {
    o.get(key).and_then(Value::as_str).unwrap_or("").trim().to_string()
}

fn parse_patch(v: &Value, k: usize) -> Result<Patch, String> {
    let Some(o) = v.as_object() else {
        return Err(format!("edit_timeline: Knoten Nr. {} in „nodes“ muss ein Objekt sein.", k + 1));
    };
    let label = {
        let t = str_of(o, "title");
        if t.is_empty() { str_of(o, "id") } else { t }
    };
    let ctx = if label.is_empty() { format!("Knoten Nr. {}: ", k + 1) } else { format!("Knoten „{label}“: ") };
    let mut p = Patch {
        id: text_field(o, "id", &ctx)?.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        title: text_field(o, "title", &ctx)?.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        era: text_field(o, "era", &ctx)?,
        strand: text_field(o, "strand", &ctx)?.map(|s| s.trim().to_string()),
        summary: text_field(o, "summary", &ctx)?,
        body: text_field(o, "body", &ctx)?,
        ..Patch::default()
    };
    if let Some(b) = &p.body {
        let len = b.chars().count();
        if len > MAX_BODY {
            return Err(format!(
                "edit_timeline: {ctx}„body“ ist zu lang ({len} Zeichen, höchstens {MAX_BODY}) – auf mehrere Knoten aufteilen."
            ));
        }
    }
    p.year = match o.get("year") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(v) => match year_of(v) {
            Some(y) => Some(Some(y)),
            None if v.as_str().is_some_and(|s| s.trim().is_empty()) => Some(None),
            None => return Err(format!("edit_timeline: {ctx}„year“ muss eine Jahreszahl sein (z. B. 1827, -350 für v. Chr.).")),
        },
    };
    p.svg = clearable(o, "svg", &ctx)?;
    if let Some(Some(svg)) = &p.svg {
        if !svg.to_ascii_lowercase().starts_with("<svg") {
            return Err(format!("edit_timeline: {ctx}„svg“ muss mit <svg beginnen."));
        }
        if svg.len() > MAX_SVG {
            return Err(format!("edit_timeline: {ctx}„svg“ ist zu groß (höchstens {} KB).", MAX_SVG / 1024));
        }
    }
    p.worksheet = clearable(o, "worksheet", &ctx)?;
    p.deck = clearable(o, "deck", &ctx)?;
    if let Some(items) = list(o, "images", &ctx)? {
        // Nur https:// und eingebettete Bilder; alles andere wird verworfen.
        p.images = Some(
            items
                .iter()
                .filter_map(Value::as_object)
                .map(|i| Image { src: str_of(i, "src"), caption: str_of(i, "caption"), credit: str_of(i, "credit") })
                .filter(|i| i.src.starts_with("https://") || i.src.starts_with("data:image/"))
                .collect(),
        );
    }
    if let Some(items) = list(o, "sources", &ctx)? {
        p.sources = Some(
            items
                .iter()
                .filter_map(Value::as_object)
                .map(|s| {
                    let kind = str_of(s, "kind");
                    let kind = if matches!(kind.as_str(), "page" | "wiki" | "url") { kind } else { "url".into() };
                    Source { kind, reference: str_of(s, "ref"), title: str_of(s, "title") }
                })
                .filter(|s| !s.reference.is_empty())
                .collect(),
        );
    }
    if let Some(pt) = o.get("pretest") {
        if pt.is_null() {
            p.pretest = Some(None);
        } else {
            let q = Question::from_value(pt)
                .and_then(|q| q.validate().map(|()| q))
                .map_err(|e| format!("edit_timeline: {ctx}„pretest“: {e}"))?;
            p.pretest = Some(Some(q));
        }
    }
    if let Some(items) = list(o, "quiz", &ctx)? {
        let mut qs = Vec::new();
        for (qi, item) in items.iter().enumerate() {
            let q = Question::from_value(item)
                .and_then(|q| q.validate().map(|()| q))
                .map_err(|e| format!("edit_timeline: {ctx}Frage {} im „quiz“: {e}", qi + 1))?;
            qs.push(q);
        }
        p.quiz = Some(qs);
    }
    match o.get("parents") {
        None | Some(Value::Null) => {}
        Some(Value::String(s)) => p.parents = Some(vec![s.trim().to_string()]),
        Some(Value::Array(a)) => {
            p.parents = Some(a.iter().filter_map(Value::as_str).map(|s| s.trim().to_string()).collect())
        }
        Some(_) => return Err(format!("edit_timeline: {ctx}„parents“ muss eine Liste von ids oder Titeln sein.")),
    }
    Ok(p)
}

/// Neue eindeutige Knoten-id aus dem Titel (`-2`, `-3`, … bei Kollision).
fn unique_id(nodes: &[Node], title: &str) -> String {
    let base = match slug(title) {
        s if s.is_empty() => "knoten".to_string(),
        s => s,
    };
    let mut id = base.clone();
    let mut n = 2;
    while nodes.iter().any(|x| x.id == id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
}

fn push_unique(v: &mut Vec<String>, id: &str) {
    if !v.iter().any(|x| x == id) {
        v.push(id.to_string());
    }
}

fn valid_date(d: &str) -> bool {
    let b = d.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && d.chars().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
        && matches!(d[5..7].parse::<u8>(), Ok(1..=12))
        && matches!(d[8..10].parse::<u8>(), Ok(1..=31))
}

fn valid_accent(a: &str) -> bool {
    let h = a.strip_prefix('#').unwrap_or("");
    matches!(h.len(), 3 | 4 | 6 | 8) && h.chars().all(|c| c.is_ascii_hexdigit())
}

/// Legt einen Zeitstrahl an (`tl` = `None`) oder ändert ihn. Gibt den neuen Zeitstrahl und die
/// Ids der angelegten, geänderten und entfernten Knoten zurück. Bei Fehlern bleibt alles unverändert.
pub fn apply_edit(tl: Option<Value>, edit: &Value, now: &str) -> Result<EditOut, String> {
    let Some(o) = edit.as_object() else {
        return Err("edit_timeline: Die Argumente müssen ein Objekt sein.".into());
    };
    let title = text_field(o, "title", "")?.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let Some(title) = title else {
        return Err("edit_timeline: „title“ fehlt – nenne den Titel des Zeitstrahls.".into());
    };
    let mut t = match tl.as_ref().filter(|v| !v.is_null()) {
        Some(v) => Timeline::parse(v)?,
        None => Timeline {
            id: format!(
                "zs-{}",
                match slug(&title) {
                    s if s.is_empty() => "neu".to_string(),
                    s => s,
                }
            ),
            title: title.clone(),
            created: now.to_string(),
            ..Timeline::default()
        },
    };
    t.v = 1;
    if let Some(s) = text_field(o, "new_title", "")?.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        t.title = s;
    }
    if let Some(s) = text_field(o, "subject", "")? {
        t.subject = s;
    }
    if let Some(s) = text_field(o, "description", "")? {
        t.description = s;
    }
    if let Some(css) = text_field(o, "theme_css", "")? {
        t.theme.css = sanitize_css(&css);
    }
    if let Some(k) = text_field(o, "kind", "")? {
        t.kind = match k.trim() {
            "path" => "path".into(),
            "history" | "" => String::new(),
            other => return Err(format!("edit_timeline: „kind“ „{other}“ unbekannt (history oder path).")),
        };
    }
    if let Some(d) = text_field(o, "exam", "")? {
        let d = d.trim();
        if !d.is_empty() && !valid_date(d) {
            return Err("edit_timeline: „exam“ muss ein Datum JJJJ-MM-TT sein (leer = kein Klausurtermin).".into());
        }
        t.exam = d.to_string();
    }
    if let Some(a) = o.get("accent") {
        match a {
            Value::Null => t.theme.accent.clear(),
            Value::String(s) if s.trim().is_empty() => t.theme.accent.clear(),
            Value::String(s) if valid_accent(s.trim()) => t.theme.accent = s.trim().to_string(),
            _ => {}
        }
    }
    if let Some(b) = o.get("brief").filter(|v| !v.is_null()) {
        let Some(bo) = b.as_object() else {
            return Err("edit_timeline: „brief“ muss ein Objekt sein.".into());
        };
        if let Some(s) = text_field(bo, "goal", "brief: ")? {
            t.brief.goal = s;
        }
        if let Some(s) = text_field(bo, "level", "brief: ")? {
            t.brief.level = s;
        }
        if let Some(s) = text_field(bo, "style", "brief: ")? {
            t.brief.style = s;
        }
        if let Some(s) = text_field(bo, "notes", "brief: ")? {
            t.brief.notes = s;
        }
        if let Some(w) = bo.get("wiki").and_then(Value::as_bool) {
            t.brief.wiki = w;
        }
        if let Some(pages) = list(bo, "material_pages", "brief: ")? {
            let mut ids: Vec<String> = Vec::new();
            for p in pages.iter().filter_map(Value::as_str).map(str::trim).filter(|s| !s.is_empty()) {
                push_unique(&mut ids, p);
            }
            t.brief.material_pages = ids;
        }
    }

    let mut removed: Vec<String> = Vec::new();
    match o.get("remove_nodes") {
        None | Some(Value::Null) => {}
        Some(Value::Array(keys)) => {
            for key in keys.iter().filter_map(Value::as_str) {
                // Unbekannte Einträge sind schon weg: kein Fehler (wiederholbar).
                if let Some(i) = find_in(&t.nodes, key) {
                    let gone = t.nodes.remove(i);
                    push_unique(&mut removed, &gone.id);
                }
            }
            for n in &mut t.nodes {
                n.parents.retain(|p| !removed.contains(p));
            }
        }
        Some(_) => return Err("edit_timeline: „remove_nodes“ muss eine Liste von ids oder Titeln sein.".into()),
    }

    let (mut added, mut updated): (Vec<String>, Vec<String>) = (Vec::new(), Vec::new());
    // Eltern erst nach allen Upserts auflösen, damit Knoten aus demselben Aufruf als Eltern gelten.
    let mut parent_wishes: Vec<(String, Vec<String>)> = Vec::new();
    match o.get("nodes") {
        None | Some(Value::Null) => {}
        Some(Value::Array(items)) => {
            for (k, item) in items.iter().enumerate() {
                let p = parse_patch(item, k)?;
                let hit =
                    p.id.as_deref()
                        .and_then(|id| t.nodes.iter().position(|n| n.id == id))
                        .or_else(|| p.title.as_deref().and_then(|ti| find_title(&t.nodes, ti)));
                let i = match hit {
                    Some(i) => {
                        push_unique(&mut updated, &t.nodes[i].id.clone());
                        i
                    }
                    None => {
                        let Some(ti) = &p.title else {
                            return Err(format!(
                                "edit_timeline: Knoten Nr. {} ist neu und braucht einen „title“.",
                                k + 1
                            ));
                        };
                        let id = p.id.clone().unwrap_or_else(|| unique_id(&t.nodes, ti));
                        push_unique(&mut added, &id);
                        t.nodes.push(Node { id, ..Node::default() });
                        t.nodes.len() - 1
                    }
                };
                let id = t.nodes[i].id.clone();
                if let Some(ps) = p.parents.clone() {
                    parent_wishes.retain(|(n, _)| n != &id);
                    parent_wishes.push((id, ps));
                }
                apply_patch(&mut t.nodes[i], p);
            }
        }
        Some(_) => return Err("edit_timeline: „nodes“ muss eine Liste von Knoten-Objekten sein.".into()),
    }

    for (id, wanted) in parent_wishes {
        let mut resolved: Vec<String> = Vec::new();
        for w in wanted {
            let Some(pi) = find_in(&t.nodes, &w) else {
                return Err(format!("edit_timeline: Elternknoten „{w}“ unbekannt – zuerst anlegen oder id prüfen."));
            };
            let pid = t.nodes[pi].id.clone();
            if pid == id {
                return Err(format!("edit_timeline: Knoten „{w}“ kann nicht sein eigener Elternknoten sein."));
            }
            push_unique(&mut resolved, &pid);
        }
        if let Some(n) = t.nodes.iter_mut().find(|n| n.id == id) {
            n.parents = resolved;
        }
    }

    if t.nodes.len() > MAX_NODES {
        return Err(format!(
            "edit_timeline: Zu viele Knoten ({}, höchstens {MAX_NODES}) – Knoten zusammenfassen oder entfernen.",
            t.nodes.len()
        ));
    }
    if let Some(c) = t.find_cycle() {
        return Err(format!(
            "edit_timeline: Zyklus bei Knoten „{}“ – ein Knoten darf nicht (auch nicht über Umwege) sein eigener Vorgänger sein.",
            t.nodes[c].title
        ));
    }
    t.updated = now.to_string();
    let warnings = year_warnings(&t);
    Ok(EditOut { timeline: t.to_value(), added, updated, removed, warnings })
}

/// Lektionen, die früher datiert sind als eine ihrer Voraussetzungen (die Linie zeigt Jahre exakt).
fn year_warnings(t: &Timeline) -> Vec<String> {
    if t.is_path() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for n in &t.nodes {
        let Some(y) = n.year else { continue };
        for p in n.parents.iter().filter_map(|id| t.nodes.iter().find(|x| &x.id == id)) {
            if let Some(py) = p.year.filter(|&py| py > y) {
                out.push(format!(
                    "„{}“ ({}) liegt vor seiner Voraussetzung „{}“ ({}) – echtes Jahr prüfen oder Voraussetzung entfernen.",
                    n.title, y, p.title, py
                ));
            }
        }
    }
    out
}

/// Überschreibt nur die gesendeten Felder. Den Fortschritt liefert nie die Eingabe: Er bleibt,
/// außer wenn das Quiz oder das Arbeitsblatt wechselt (dann gilt der alte Stand nicht mehr).
fn apply_patch(n: &mut Node, p: Patch) {
    if let Some(v) = p.title {
        n.title = v;
    }
    if let Some(v) = p.era {
        n.era = v;
    }
    if let Some(v) = p.year {
        n.year = v;
    }
    if let Some(v) = p.strand {
        n.strand = v;
    }
    if let Some(v) = p.summary {
        n.summary = v;
    }
    if let Some(v) = p.body {
        n.body = v;
    }
    if let Some(v) = p.images {
        n.images = v;
    }
    if let Some(v) = p.svg {
        n.svg = v;
    }
    if let Some(v) = p.sources {
        n.sources = v;
    }
    if let Some(v) = p.deck {
        n.deck = v;
    }
    if let Some(pt) = p.pretest {
        if pt != n.pretest {
            n.progress.pretest_done = false;
        }
        n.pretest = pt;
    }
    if let Some(q) = p.quiz {
        if q != n.quiz {
            n.progress.quiz = None;
            n.progress.quiz_passed = false;
        }
        n.quiz = q;
    }
    if let Some(w) = p.worksheet {
        if w != n.worksheet {
            n.progress.worksheet = WorksheetProgress::default();
        }
        n.worksheet = w;
    }
}
