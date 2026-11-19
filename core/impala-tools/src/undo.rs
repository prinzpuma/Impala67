//! Änderungs-Satz einer KI-Aktion bilden und zurückspielen.

use std::collections::BTreeSet;

use impala_heft::HeftDoc;
use impala_heft::diff::Shadow;
use impala_heft::diff_document;
use impala_model::Model;
use serde_json::{Value, json};

use crate::{Host, Tools, fail, ser, str_of, truthy_at};

// ---------------------------------------------------------------------------
// Änderungs-Satz und Rückgängig

/// Stand vor einer KI-Aktion (nur die potenziell betroffenen Sammlungen und die beschriebenen Hefte).
pub(crate) struct Snapshot {
    pages: Option<impala_model::JsMap<impala_model::Page>>,
    cards: Option<impala_model::JsMap<impala_model::Card>>,
    decks: Option<impala_model::JsMap<impala_model::Deck>>,
    hefte: Vec<(String, Option<HeftDoc>)>,
}

fn changed<T: PartialEq + serde::Serialize>(
    before: Option<&impala_model::JsMap<T>>,
    after: &impala_model::JsMap<T>,
) -> Value {
    let Some(before) = before else {
        return json!([]);
    };
    let ids: BTreeSet<&String> = before.keys().chain(after.keys()).collect();
    Value::Array(
        ids.into_iter()
            .filter(|id| before.get(id) != after.get(id))
            .map(|id| json!({ "id": id, "before": before.get(id).map(ser), "after": after.get(id).map(ser) }))
            .collect(),
    )
}

/// Heft-Vergleich ohne `rev` (der Zähler unterscheidet sich zwischen Geräten).
fn heft_json(doc: Option<&HeftDoc>) -> Value {
    doc.map_or(Value::Null, |d| json!({ "pages": ser(&d.pages) }))
}

impl Snapshot {
    pub(crate) fn take(operations: &[Value], tools: &Tools<'_>) -> Snapshot {
        let state = tools.host.model().state();
        let (mut need_pages, mut need_cards, mut need_decks) = (false, false, false);
        let mut hefte: Vec<(String, Option<HeftDoc>)> = vec![];
        for op in operations {
            let kind = op.get("op").and_then(Value::as_str);
            match kind {
                Some(
                    "page.create" | "page.append" | "page.replace" | "page.patch" | "page.props" | "page.rename"
                    | "page.move" | "page.trash" | "page.archive" | "page.unarchive" | "heft.append",
                ) => need_pages = true,
                Some(
                    "card.create" | "card.update" | "card.move" | "deck.create" | "deck.rename" | "deck.move"
                    | "deck.trash",
                ) => {
                    need_cards = true;
                    need_decks = true;
                }
                Some("card.trash" | "card.suspend" | "card.reset") => need_cards = true,
                _ => {
                    need_pages = true;
                    need_cards = true;
                    need_decks = true;
                }
            }
            if kind == Some("heft.append")
                && let Some(id) = tools.page_id(&str_of(&op["title"]))
                && !hefte.iter().any(|(h, _)| *h == id)
            {
                hefte.push((id.clone(), state.hefte.get(&id).cloned()));
            }
        }
        Snapshot {
            pages: need_pages.then(|| state.pages.clone()),
            cards: need_cards.then(|| state.cards.clone()),
            decks: need_decks.then(|| state.decks.clone()),
            hefte,
        }
    }

    pub(crate) fn undo_set(&self, model: &Model) -> Value {
        let state = model.state();
        let heft: Vec<Value> = self
            .hefte
            .iter()
            .filter_map(|(id, before)| {
                let after = state.hefte.get(id);
                let (b, a) = (heft_json(before.as_ref()), heft_json(after));
                (b != a).then(|| json!({ "id": id, "before": before.as_ref().map(ser), "after": after.map(ser) }))
            })
            .collect();
        json!({
            "pages": changed(self.pages.as_ref(), &state.pages),
            "cards": changed(self.cards.as_ref(), &state.cards),
            "decks": changed(self.decks.as_ref(), &state.decks),
            "heftDocs": heft,
        })
    }
}

fn now_of(model: &Model, key: &str, id: &str) -> Value {
    let state = model.state();
    match key {
        "pages" => state.pages.get(id).map(ser),
        "cards" => state.cards.get(id).map(ser),
        "decks" => state.decks.get(id).map(ser),
        _ => None,
    }
    .unwrap_or(Value::Null)
}

fn without(v: &Value, keys: &[&str]) -> Value {
    let mut v = v.clone();
    if let Value::Object(o) = &mut v {
        for k in keys {
            o.shift_remove(*k);
        }
    }
    v
}

fn list<'a>(set: &'a Value, key: &str) -> &'a [Value] {
    set.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
}

/// Vergleichsform eines Hefts: nur die Seiten (`rev` und `v` unterscheiden sich zwischen Geräten).
fn heft_value(v: &Value) -> Value {
    if v.is_null() { Value::Null } else { json!({ "pages": v.get("pages") }) }
}

/// Änderungs-Satz zurückspielen (wie `undo` in `web/tools.js`); scheitert, wenn die Daten seitdem
/// erneut geändert wurden. Heft-Dokumente werden per Diff auf den alten Stand gebracht.
pub fn apply(host: &mut dyn Host, set: &Value) -> Result<(), String> {
    for key in ["pages", "cards", "decks", "heftDocs"] {
        for x in list(set, key) {
            let id = str_of(&x["id"]);
            let after = x.get("after").cloned().unwrap_or(Value::Null);
            let (now, after) = if key == "heftDocs" {
                (heft_json(host.model().state().hefte.get(&id)), heft_value(&after))
            } else {
                (now_of(host.model(), key, &id), after)
            };
            // Abweichung von der PWA: Der Änderungszeitpunkt einer Seite zählt nicht. Jedes Zurücknehmen setzt
            // ihn neu, wodurch die Aktion davor sonst nie mehr rückgängig zu machen wäre (nur ein Zeitstempel).
            let (now, after) = if key == "pages" {
                (without(&now, &["updated"]), without(&after, &["updated"]))
            } else {
                (now, after)
            };
            if now != after {
                return fail(
                    "Die betroffenen Daten wurden nach der KI-Aktion erneut geändert. Mache zuerst spätere Änderungen rückgängig.",
                );
            }
        }
    }
    let before_of = |x: &Value| x.get("before").filter(|b| !b.is_null()).cloned();
    // Alte Stapel zuerst, damit Karten nie auf fehlende Ziele zeigen.
    for x in list(set, "decks") {
        let id = str_of(&x["id"]);
        if before_of(x).is_some() && !host.model().state().decks.contains_key(&id) {
            host.dispatch("deckCreate", json!({ "name": id }))?;
        }
    }
    for x in list(set, "pages") {
        let (id, Some(before)) = (str_of(&x["id"]), before_of(x)) else { continue };
        if !host.model().state().pages.contains_key(&id) {
            host.dispatch("pageCreate", before.clone())?;
        }
        host.dispatch("pageUpdate", json!({ "id": id, "patch": without(&before, &["id", "created", "updated"]) }))?;
        // Nur bei echtem Papierkorb-Wechsel: pageRestore holt den ganzen Unterbaum zurück.
        let after = x.get("after").cloned().unwrap_or(Value::Null);
        if truthy_at(&before, "trashed") != truthy_at(&after, "trashed") {
            host.dispatch(
                if truthy_at(&before, "trashed") { "pageTrash" } else { "pageRestore" },
                json!({ "id": id }),
            )?;
        }
        if before.get("archived") != after.get("archived") {
            host.dispatch(
                if truthy_at(&before, "archived") { "pageArchive" } else { "pageUnarchive" },
                json!({ "id": id }),
            )?;
        }
    }
    for x in list(set, "cards") {
        let (id, Some(before)) = (str_of(&x["id"]), before_of(x)) else { continue };
        if !host.model().state().cards.contains_key(&id) {
            host.dispatch("cardCreate", before.clone())?;
        }
        host.dispatch(
            "cardUpdate",
            json!({ "id": id, "patch": without(&before, &["id", "created", "trashed", "trashedAt"]) }),
        )?;
        // cardRestore holt auch einen gelöschten Stapel zurück — daher nur bei echtem Wechsel.
        let now_trashed = host.model().state().cards.get(&id).is_some_and(|c| c.is_trashed());
        if truthy_at(&before, "trashed") != now_trashed {
            host.dispatch(
                if truthy_at(&before, "trashed") { "cardTrash" } else { "cardRestore" },
                json!({ "id": id }),
            )?;
        }
    }
    for x in list(set, "cards") {
        let id = str_of(&x["id"]);
        if before_of(x).is_none() && host.model().state().cards.contains_key(&id) {
            host.dispatch("cardDelete", json!({ "id": id }))?;
        }
    }
    for x in list(set, "pages") {
        let id = str_of(&x["id"]);
        if before_of(x).is_none() && host.model().state().pages.contains_key(&id) {
            host.dispatch("pageDelete", json!({ "id": id }))?;
        }
    }
    for x in list(set, "decks") {
        let id = str_of(&x["id"]);
        if before_of(x).is_none() && host.model().state().decks.contains_key(&id) {
            host.dispatch("deckDelete", json!({ "name": id }))?;
        }
    }
    for x in list(set, "decks") {
        let (id, Some(before)) = (str_of(&x["id"]), before_of(x)) else { continue };
        if let Some(order) = before.get("order").filter(|o| o.is_number()) {
            host.dispatch("deckReorder", json!({ "name": id, "order": order }))?;
        }
        host.dispatch(if truthy_at(&before, "trashed") { "deckTrash" } else { "deckRestore" }, json!({ "name": id }))?;
    }
    for x in list(set, "heftDocs") {
        let id = str_of(&x["id"]);
        let pages = x.get("before").and_then(|b| b.get("pages")).cloned().unwrap_or(json!([]));
        let target = HeftDoc::from_value(json!({ "v": 2, "rev": 0, "pages": pages }));
        let current = host.model().state().hefte.get(&id).cloned().unwrap_or_default();
        let (ops, _) = diff_document(Some(&Shadow::of(&current)), &target);
        if !ops.is_empty() {
            let ops = serde_json::to_value(&ops).map_err(|e| e.to_string())?;
            host.dispatch("heftOps", json!({ "pageId": id, "ops": ops }))?;
        }
    }
    Ok(())
}
