//! Eingabe für `calculate` (math.js in der PWA, eigene Auswertung in den Apps).
//!
//! Aufrufer schreiben Rechenwege gern in Programmier-Schreibweise (`let a = 2;`, `// Kommentar`,
//! `Math.sqrt`, `({ a, b })` als Ergebnis). Das ist dieselbe Rechnung in anderer Schreibweise und
//! wird hier vereinheitlicht; echtes Programmieren (Funktionen, `return`, Schleifen) wird mit einer
//! klaren Meldung abgelehnt, statt in einem unverständlichen Parserfehler zu enden.
//! (Ohne Regex-Crate: die Bibliothek bleibt für WASM klein.)

const SYNTAX: &str = "calculate rechnet math.js-Ausdrücke: a = 2; b = a * 3; [a, b] (eine Zuweisung je Zeile oder durch ; getrennt, die letzte Zeile ist das Ergebnis).";
const DECLS: [&str; 3] = ["let", "const", "var"];

fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$'
}

/// Stellen, an denen `word` als ganzes Wort steht (Byte-Index direkt dahinter).
fn word_ends<'a>(text: &'a str, word: &'a str) -> impl Iterator<Item = usize> + 'a {
    text.match_indices(word).filter_map(move |(i, _)| {
        let end = i + word.len();
        let before = text[..i].chars().next_back();
        let after = text[end..].chars().next();
        (!before.is_some_and(is_ident_char) && !after.is_some_and(is_ident_char)).then_some(end)
    })
}

fn has_word(text: &str, word: &str) -> bool {
    word_ends(text, word).next().is_some()
}

/// `for (…)` / `while (…)`: Schlüsselwort mit Klammer dahinter.
fn has_loop(text: &str) -> bool {
    ["for", "while"].iter().any(|w| word_ends(text, w).any(|end| text[end..].trim_start().starts_with('(')))
}

fn is_ident(s: &str) -> bool {
    let mut c = s.chars();
    c.next().is_some_and(|f| f.is_alphabetic() || f == '_') && c.all(|x| x.is_alphanumeric() || x == '_')
}

/// `let x = …` → `x = …` (nur am Anfang einer Anweisung).
fn strip_decl(segment: &str) -> String {
    let rest = segment.trim_start();
    let lead = &segment[..segment.len() - rest.len()];
    for kw in DECLS {
        if let Some(after) = rest.strip_prefix(kw)
            && after.starts_with([' ', '\t'])
        {
            return format!("{lead}{}", after.trim_start());
        }
    }
    segment.to_owned()
}

/// `Math.sqrt` → `sqrt` (math.js kennt dieselben Namen), nicht in `myMath.x`.
fn strip_math(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut last = 0;
    for (i, _) in line.match_indices("Math.") {
        if !line[..i].chars().next_back().is_some_and(is_ident_char) {
            out.push_str(&line[last..i]);
            last = i + "Math.".len();
        }
    }
    out.push_str(&line[last..]);
    out
}

/// Vereinheitlicht die Schreibweise, ohne die Rechnung zu ändern. `Err`: Text fürs Modell.
pub fn normalize_expression(expr: &str) -> Result<String, String> {
    let lines: Vec<String> = expr
        .lines()
        .map(|l| l.split_once("//").map_or(l, |(code, _)| code))
        .map(|l| l.split(';').map(strip_decl).collect::<Vec<_>>().join(";"))
        .map(|l| strip_math(&l).trim_end().to_owned())
        .filter(|l| !l.trim().is_empty())
        .collect();
    let body = lines.join("\n");
    if ["function", "return", "console"].iter().any(|w| has_word(&body, w)) || body.contains("=>") || has_loop(&body) {
        return Err(format!("Kein Programmcode (function, return, =>, Schleifen). {SYNTAX}"));
    }
    let body = body.trim().trim_end_matches(';').trim_end();
    if body.is_empty() {
        return Err(format!("calculate: expression ist leer. {SYNTAX}"));
    }
    Ok(match final_object(body) {
        Some((head, items)) => {
            let obj = format!("{{{}}}", items.join(", "));
            if head.is_empty() { obj } else { format!("{head}\n{obj}") }
        }
        None => body.to_owned(),
    })
}

/// Endet der Ausdruck mit einem Objekt als Ergebnis (`{ a, b }` oder `({ a, b })`, auch über
/// mehrere Zeilen)? Dann (davor, Einträge mit `a` → `a: a`).
fn final_object(body: &str) -> Option<(&str, Vec<String>)> {
    let end = body.strip_suffix(')').map_or(body, str::trim_end);
    let close = end.strip_suffix('}')?;
    // Passende öffnende Klammer von hinten suchen.
    let (mut depth, mut open) = (1usize, None);
    for (i, c) in close.char_indices().rev() {
        match c {
            '}' => depth += 1,
            '{' => {
                depth -= 1;
                if depth == 0 {
                    open = Some(i);
                    break;
                }
            }
            _ => {}
        }
    }
    let open = open?;
    let before = close[..open].trim_end();
    let before = if end.len() < body.len() { before.strip_suffix('(')?.trim_end() } else { before };
    // Das Objekt muss eine eigene Anweisung sein (Anfang, nach ; oder neue Zeile), keine Zuweisung o. Ä.
    let own_line = body[..open].contains('\n') && !before.ends_with(['=', ',', '(', '[']);
    if !(before.is_empty() || before.ends_with(';') || own_line) {
        return None;
    }
    let items = close[open + 1..]
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| if is_ident(s) { format!("{s}: {s}") } else { s.to_owned() })
        .collect();
    Some((before, items))
}

/// Hinweis zur Schreibweise, den die Agent-Schleife an einen Rechenfehler hängt.
pub fn syntax_hint() -> &'static str {
    SYNTAX
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn programmier_schreibweise_wird_math_js() {
        assert_eq!(normalize_expression("let a = 2; const b = a * 3; [a, b]").unwrap(), "a = 2; b = a * 3; [a, b]");
        assert_eq!(normalize_expression("var x = 4 // Ohm\nx * 2").unwrap(), "x = 4\nx * 2");
        assert_eq!(normalize_expression("a = 1;\nb = Math.sqrt(a);\n({ a, b });").unwrap(), "a = 1;\nb = sqrt(a);\n{a: a, b: b}");
        assert_eq!(normalize_expression("IB = 2; {IB: IB * 1000, x}").unwrap(), "IB = 2;\n{IB: IB * 1000, x: x}");
        assert_eq!(normalize_expression("const a = 1;\n\n({\n  a,\n  b: a * 2\n})").unwrap(), "a = 1;\n{a: a, b: a * 2}");
    }

    #[test]
    fn unveraendert_wenn_schon_math_js() {
        for e in ["2 + 3", "integrate(\"x^2\", \"x\", 0, 1)", "a = 2; b = a^2", "[1, 2, 3]", "letter = 3; letter * 2", "o = {a: 1}", "f(x) = x^2; f(3)", "format = 2; returns = 3"] {
            assert_eq!(normalize_expression(e).unwrap(), e, "{e}");
        }
    }

    #[test]
    fn programmcode_klar_abgelehnt() {
        let e = normalize_expression("(function() { var a = 1; return a; })()").unwrap_err();
        assert!(e.contains("Kein Programmcode") && e.contains("a = 2; b = a * 3"), "{e}");
        assert!(normalize_expression("x => x * 2").is_err());
        assert!(normalize_expression("for (i = 0; i < 3; i++) {}").is_err());
        assert!(normalize_expression("// nur Kommentar").is_err());
    }
}
