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

/// Ausschnitt eines langen Textes zum Lesen (`read_pages`): höchstens `max` Zeichen ab `offset`
/// bzw. kurz vor der ersten Stelle von `find` (Groß-/Kleinschreibung egal). Ein Hinweis am Ende
/// nennt das nächste `offset` und weitere Fundstellen, damit sich auch sehr lange Seiten und
/// Hefte gezielt lesen lassen statt nur ihr Anfang. Zeichen = Unicode-Zeichen.
pub fn read_window(text: &str, max: usize, offset: Option<usize>, find: Option<&str>) -> String {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let find = find.map(str::trim).filter(|f| !f.is_empty());
    let hits: Vec<usize> = find.map_or_else(Vec::new, |f| {
        let lower: Vec<char> = chars.iter().map(|c| c.to_lowercase().next().unwrap_or(*c)).collect();
        let needle: Vec<char> = f.chars().map(|c| c.to_lowercase().next().unwrap_or(c)).collect();
        (0..lower.len().saturating_sub(needle.len() - 1)).filter(|&i| lower[i..].starts_with(&needle)).collect()
    });
    let mut notes = vec![];
    let from = offset.unwrap_or(0).min(n);
    // Mit find und offset: erste Fundstelle ab offset.
    let start = match (find, hits.iter().find(|&&h| h >= from)) {
        (Some(_), Some(&hit)) => {
            // Ab Zeilenanfang, bis zu 300 Zeichen vor der Fundstelle.
            let floor = hit.saturating_sub(300).max(from);
            (floor..hit).rev().find(|&i| chars[i] == '\n').map_or(floor, |i| i + 1)
        }
        (Some(f), None) => {
            notes.push(format!("„{f}“ kommt {} nicht vor.", if from > 0 { "ab dort" } else { "im Text" }));
            from
        }
        (None, _) => from,
    };
    let end = (start + max).min(n);
    let mut out = String::new();
    if start > 0 {
        out.push_str(&format!("[… Zeichen 0–{start} ausgelassen]\n"));
    }
    out.extend(&chars[start..end]);
    if end < n {
        notes.push(format!("gekürzt: Zeichen {start}–{end} von {n} gezeigt, weiter mit offset={end}"));
    }
    if let Some(f) = find {
        let later: Vec<String> = hits.iter().filter(|&&h| h >= end).take(5).map(usize::to_string).collect();
        if !later.is_empty() {
            notes.push(format!("„{f}“ auch bei Zeichen {} (find mit offset ab dort)", later.join(", ")));
        }
    }
    if !notes.is_empty() {
        out.push_str(&format!("\n[… {}]", notes.join("; ")));
    }
    out
}

/// Spalten eines Verzeichnisses als `{Name: Typ}` für Meldungen und Leseergebnisse – dieselbe
/// Form wie `props` (`{Spalte: Wert}`), die Schlüssel lassen sich also direkt übernehmen.
/// (Früher „Name (Typ)“: Modelle schrieben dann „Thema (title)“ als Spaltennamen.)
pub fn columns(schema: &Value) -> Value {
    let map: Map<String, Value> = schema
        .as_array()
        .map(|cols| {
            cols.iter()
                .filter_map(|c| {
                    let name = c.get("name").and_then(Value::as_str)?;
                    let ty = c.get("type").and_then(Value::as_str).unwrap_or("text");
                    Some((name.to_owned(), Value::from(ty)))
                })
                .collect()
        })
        .unwrap_or_default();
    Value::Object(map)
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
        let title_hint = title_col.map(|t| format!(" „{t}“ ist der Seitentitel.")).unwrap_or_default();
        return Err(format!(
            "Unbekannte Spalte(n): {}. Spalten von „{folder}“ ({{Name: Typ}}): {}.{title_hint}",
            unknown.join(", "),
            columns(schema)
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
    fn lange_texte_gezielt_lesen() {
        let text = format!("{}\nEarly-Effekt: r_o = V_A / I_C\n{}\nEarly nochmal", "a".repeat(2000), "b".repeat(3000));
        // Ohne Angaben: Anfang + nächstes offset.
        let w = read_window(&text, 1000, None, None);
        assert!(w.starts_with("aaa") && w.contains("weiter mit offset=1000"), "{w}");
        // find: ab der Zeile der Fundstelle, weitere Fundstelle genannt.
        let w = read_window(&text, 1000, None, Some("early-effekt"));
        assert!(w.starts_with("[… Zeichen 0–2001 ausgelassen]\nEarly-Effekt: r_o"), "{w}");
        let w = read_window(&text, 1000, None, Some("Early"));
        assert!(w.contains("„Early“ auch bei Zeichen"), "{w}");
        // offset: weiterlesen; Ende ohne Hinweis.
        let n = text.chars().count();
        assert!(!read_window(&text, 10_000, Some(n - 5), None).contains("weiter mit"));
        assert!(read_window(&text, 100, None, Some("gibtsnicht")).contains("kommt im Text nicht vor"));
        assert_eq!(read_window("kurz", 100, None, None), "kurz");
    }

    #[test]
    fn spalten_gegen_schema() {
        let schema = json!([{"name":"Thema","type":"title"},{"name":"Nr","type":"number"},{"name":"Themen","type":"multi_select"}]);
        let p = merge_props(&schema, &Value::Null, &json!({"nr": 4, "Themen": ["Lager", "Gelenke"]}), "4 · Lager", "VL").unwrap();
        assert_eq!(p, json!({"Nr": 4, "Themen": "Lager, Gelenke", "Thema": "4 · Lager"}));
        let p = merge_props(&schema, &json!({"Nr": 1, "Themen": "a"}), &json!({"Themen": null}), "t", "VL").unwrap();
        assert_eq!(p, json!({"Nr": 1}));
        let e = merge_props(&schema, &Value::Null, &json!({"Status": "x"}), "t", "VL").unwrap_err();
        assert!(e.contains("Status") && e.contains(r#""Nr":"number""#) && e.contains("„Thema“ ist der Seitentitel"), "{e}");
        assert_eq!(columns(&schema), json!({"Thema": "title", "Nr": "number", "Themen": "multi_select"}));
        assert!(merge_props(&Value::Null, &Value::Null, &json!({"a": 1}), "t", "Ordner").unwrap_err().contains("kein Verzeichnis"));
    }
}
