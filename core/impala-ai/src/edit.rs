//! Kleinste Änderungen an Seiten, wie sie die KI-Werkzeuge brauchen: gezieltes Ersetzen
//! (wörtlich, sonst leerraum-tolerant), Schutz vor Datenverlust beim Ersetzen ganzer Seiten
//! und Spaltenwerte (`props`) eines Verzeichnis-Eintrags gegen das Schema der Elternseite.
//! Fehlermeldungen nennen immer den nächsten Schritt – sie gehen wörtlich ans Modell.

use serde_json::{Map, Value};

use crate::js;

/// Ersetzt `search` genau einmal in `content`. Wörtlich zuerst; sonst mit Leerraum als
/// Platzhalter (Zeilenumbrüche/Einrückung/doppelte Leerzeichen egal).
pub fn patch(content: &str, search: &str, replace: &str) -> Result<String, String> {
    if search.is_empty() {
        return Err("search fehlt: wörtlichen Text aus der Seite angeben.".into());
    }
    let exact: Vec<usize> = content.match_indices(search).map(|(i, _)| i).collect();
    let span = match exact.len() {
        1 => Some((exact[0], exact[0] + search.len())),
        0 => loose_find(content, search)?,
        n => return Err(many(n, search)),
    };
    let Some((start, end)) = span else {
        return Err(not_found(content, search));
    };
    Ok(format!("{}{}{}", &content[..start], replace, &content[end..]))
}

fn many(n: usize, search: &str) -> String {
    format!("search „{}“ kommt {n}-mal vor. Mehr umgebenden Text mitgeben, damit die Stelle eindeutig ist.", short(search))
}

fn short(s: &str) -> String {
    let t = js::trim(s);
    if js::len16(t) > 80 { format!("{}…", js::head16(t, 80)) } else { t.to_owned() }
}

/// Leerraum beim toleranten Abgleich auf ein einzelnes `' '` normalisieren.
fn squash(prev: Option<char>, c: char) -> Option<char> {
    if js::is_ws(c) {
        if prev == Some(' ') { None } else { Some(' ') }
    } else {
        Some(c)
    }
}

/// Fundstelle mit zusammengefasstem Leerraum: `Ok(None)` = keine, `Err` = mehrdeutig.
fn loose_find(content: &str, search: &str) -> Result<Option<(usize, usize)>, String> {
    // Normalisierte Zeichen mit ihrem Byte-Bereich im Original.
    let mut norm: Vec<(char, usize, usize)> = Vec::with_capacity(content.len());
    for (i, c) in content.char_indices() {
        let end = i + c.len_utf8();
        match squash(norm.last().map(|n| n.0), c) {
            Some(n) => norm.push((n, i, end)),
            None => {
                if let Some(last) = norm.last_mut() {
                    last.2 = end;
                }
            }
        }
    }
    let mut needle: Vec<char> = Vec::new();
    for c in js::trim(search).chars() {
        if let Some(n) = squash(needle.last().copied(), c) {
            needle.push(n);
        }
    }
    if needle.is_empty() || needle.len() > norm.len() {
        return Ok(None);
    }
    let hits: Vec<usize> = (0..=norm.len() - needle.len())
        .filter(|&s| needle.iter().enumerate().all(|(k, c)| norm[s + k].0 == *c))
        .take(3)
        .collect();
    match hits.as_slice() {
        [] => Ok(None),
        [s] => Ok(Some((norm[*s].1, norm[s + needle.len() - 1].2))),
        _ => Err(many(hits.len(), search)),
    }
}

/// „Nicht gefunden“ mit der ähnlichsten Zeile (meiste gemeinsame Wörter) als Hilfe.
fn not_found(content: &str, search: &str) -> String {
    let words = |s: &str| -> Vec<String> {
        s.split(|c: char| !c.is_alphanumeric()).filter(|w| w.chars().count() > 2).map(str::to_lowercase).collect()
    };
    let first = search.lines().map(js::trim).find(|l| !l.is_empty()).unwrap_or("");
    let wanted = words(first);
    let best = content
        .lines()
        .map(js::trim)
        .filter(|l| !l.is_empty())
        .map(|l| (words(l).iter().filter(|w| wanted.contains(w)).count(), l))
        .filter(|(n, _)| *n > 0)
        .max_by_key(|(n, _)| *n);
    match best {
        Some((_, line)) => format!(
            "search nicht gefunden. Ähnlichste Zeile: „{}“. search muss wörtlich aus dem gelesenen Inhalt stammen.",
            short(line)
        ),
        None => "search nicht gefunden. Seite erst lesen und search wörtlich aus dem Inhalt kopieren.".into(),
    }
}

/// `Some(Fehler)`, wenn das Ersetzen des ganzen Inhalts spürbar Inhalt löschen würde
/// (Überschriften fehlen oder weniger als 60 % der Länge). Kurze Seiten sind frei.
pub fn replace_guard(old: &str, new: &str) -> Option<String> {
    let old_len = js::len16(js::trim(old));
    if old_len < 300 {
        return None;
    }
    let new_lines: Vec<&str> = new.lines().map(js::trim).collect();
    let lost: Vec<&str> =
        old.lines().map(js::trim).filter(|l| l.starts_with('#') && !new_lines.contains(l)).take(4).collect();
    let new_len = js::len16(js::trim(new));
    if lost.is_empty() && new_len * 10 >= old_len * 6 {
        return None;
    }
    let what = if lost.is_empty() {
        format!("nur {new_len} von {old_len} Zeichen bleiben")
    } else {
        format!("Abschnitte fehlen: {}", lost.join(" | "))
    };
    Some(format!(
        "Ersetzen würde Inhalt löschen ({what}). Für kleine Änderungen edit_page mit edits oder append nutzen; nur wenn das Löschen gewollt ist, allow_deleting_content=true setzen."
    ))
}

/// Spalten eines Verzeichnisses als „Name (Typ)“-Liste für Meldungen und Leseergebnisse.
pub fn columns(schema: &Value) -> Vec<String> {
    schema
        .as_array()
        .map(|cols| {
            cols.iter()
                .filter_map(|c| {
                    let name = c.get("name").and_then(Value::as_str)?;
                    let ty = c.get("type").and_then(Value::as_str).unwrap_or("text");
                    Some(format!("{name} ({ty})"))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Spaltenwerte zusammenführen: `null` löscht, Listen werden „a, b“, die Titelspalte folgt
/// dem Seitentitel. Mit Schema (`[{name,type}]` des Verzeichnisses) werden Spaltennamen ohne
/// Rücksicht auf Groß-/Kleinschreibung zugeordnet; unbekannte sind ein Fehler mit Spaltenliste.
/// Ohne Schema (Elternseite ist kein Verzeichnis) ist `props` ein Fehler. Ergebnis `Null`, wenn leer.
pub fn merge_props(schema: &Value, current: &Value, update: &Value, title: &str, folder: &str) -> Result<Value, String> {
    let Some(update) = update.as_object() else {
        return Err("props muss ein Objekt {Spalte: Wert} sein.".into());
    };
    let cols: Vec<(&str, &str)> = schema
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|c| {
                    Some((c.get("name")?.as_str()?, c.get("type").and_then(Value::as_str).unwrap_or("text")))
                })
                .collect()
        })
        .unwrap_or_default();
    if cols.is_empty() {
        return Err(if folder.is_empty() {
            "props geht nur bei Einträgen eines Verzeichnisses (Seite mit Spalten); diese Seite hat keine Elternseite.".into()
        } else {
            format!("„{folder}“ ist kein Verzeichnis (keine Spalten) – props weglassen.")
        });
    }
    let title_col = cols.iter().find(|(_, t)| *t == "title").map(|(n, _)| *n);
    let mut out: Map<String, Value> = current.as_object().cloned().unwrap_or_default();
    let mut unknown = vec![];
    for (key, v) in update {
        let k = js::trim(key).to_lowercase();
        let Some((name, _)) = cols.iter().find(|(n, _)| n.to_lowercase() == k) else {
            unknown.push(key.as_str());
            continue;
        };
        if Some(*name) == title_col {
            continue;
        }
        match v {
            Value::Null => {
                out.remove(*name);
            }
            Value::Array(items) => {
                let list: Vec<String> = items.iter().filter(|x| !x.is_null()).map(js::string).collect();
                out.insert((*name).to_owned(), Value::from(list.join(", ")));
            }
            other => {
                out.insert((*name).to_owned(), other.clone());
            }
        }
    }
    if !unknown.is_empty() {
        return Err(format!(
            "Unbekannte Spalte(n): {}. Spalten von „{folder}“: {}.",
            unknown.join(", "),
            columns(schema).join(", ")
        ));
    }
    if let Some(tc) = title_col
        && (out.contains_key(tc) || current.as_object().is_none_or(Map::is_empty))
        && !title.is_empty()
    {
        out.insert(tc.to_owned(), Value::from(title));
    }
    Ok(if out.is_empty() { Value::Null } else { Value::Object(out) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn patch_woertlich_und_tolerant() {
        assert_eq!(patch("a [ ] Blatt 02\nb", "[ ] Blatt 02", "[x] Blatt 02").unwrap(), "a [x] Blatt 02\nb");
        // Leerraum egal, Original außerhalb bleibt unberührt
        assert_eq!(patch("x  Anwesenheit:\n 1 von 7\ny", "Anwesenheit: 1 von 7", "Anwesenheit: 2 von 7").unwrap(), "x  Anwesenheit: 2 von 7\ny");
        // Wiederholte Symbole (z. B. == vs. =) werden nicht zusammengeworfen.
        assert!(patch("a == b\n", "a = b", "a := b").is_err());
        assert!(patch("ab ab", "ab", "c").unwrap_err().contains("2-mal"));
        let e = patch("## Organisation\nAnwesenheit 1 von 7", "Anwesenheit: 3", "x").unwrap_err();
        assert!(e.contains("Ähnlichste Zeile: „Anwesenheit 1 von 7“"), "{e}");
        assert!(patch("a", "", "b").is_err());
    }

    #[test]
    fn schutz_beim_ersetzen() {
        let old = format!("# A\n{}\n## Organisation\n{}", "x".repeat(200), "y".repeat(200));
        assert!(replace_guard(&old, &format!("# A\n{}", "x".repeat(380))).unwrap().contains("## Organisation"));
        assert!(replace_guard(&old, &format!("{old}\nneu")).is_none());
        assert!(replace_guard(&old, "# A\n## Organisation\nkurz").unwrap().contains("Zeichen bleiben"));
        assert!(replace_guard("kurz", "").is_none());
    }

    #[test]
    fn spalten_gegen_schema() {
        let schema = json!([{"name":"Thema","type":"title"},{"name":"Nr","type":"number"},{"name":"Themen","type":"multi_select"}]);
        let p = merge_props(&schema, &Value::Null, &json!({"nr": 4, "Themen": ["Lager", "Gelenke"]}), "4 · Lager", "VL").unwrap();
        assert_eq!(p, json!({"Nr": 4, "Themen": "Lager, Gelenke", "Thema": "4 · Lager"}));
        let p = merge_props(&schema, &json!({"Nr": 1, "Themen": "a"}), &json!({"Themen": null}), "t", "VL").unwrap();
        assert_eq!(p, json!({"Nr": 1}));
        let e = merge_props(&schema, &Value::Null, &json!({"Status": "x"}), "t", "VL").unwrap_err();
        assert!(e.contains("Status") && e.contains("Nr (number)"), "{e}");
        assert!(merge_props(&Value::Null, &Value::Null, &json!({"a": 1}), "t", "Ordner").unwrap_err().contains("kein Verzeichnis"));
    }
}
