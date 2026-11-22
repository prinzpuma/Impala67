//! Kleine Text-Helfer: Slugs, Zahlen aus Freitext, Lückentext-Lücken.

/// Slug: Kleinbuchstaben, Umlaute ausgeschrieben, Rest als `-`, höchstens 48 Zeichen.
pub fn slug(s: &str) -> String {
    let mut out = String::new();
    let mut sep = false;
    let mut buf = [0u8; 4];
    for ch in s.chars().flat_map(char::to_lowercase) {
        let piece: &str = match ch {
            'ä' => "ae",
            'ö' => "oe",
            'ü' => "ue",
            'ß' => "ss",
            'é' | 'è' | 'ê' => "e",
            'à' | 'á' | 'â' => "a",
            'í' | 'î' => "i",
            'ó' | 'ô' | 'ø' => "o",
            'ú' | 'û' => "u",
            'ç' => "c",
            'ñ' => "n",
            c if c.is_ascii_alphanumeric() => &*c.encode_utf8(&mut buf),
            _ => "-",
        };
        if piece == "-" {
            sep = true;
            continue;
        }
        if sep && !out.is_empty() {
            out.push('-');
        }
        sep = false;
        out.push_str(piece);
    }
    out.truncate(48);
    while out.ends_with('-') {
        out.pop();
    }
    out
}

/// Zahl am Anfang eines Freitexts: "1,5 V" → 1.5, "1.000,5" → 1000.5, "3e8 m/s" → 3e8.
/// Deutsches Komma, Tausendertrennzeichen und Einheiten am Ende werden toleriert.
pub fn parse_number(s: &str) -> Option<f64> {
    let s = s.trim().replace('\u{2212}', "-");
    let b: Vec<char> = s.chars().take(64).collect();
    let mut i = 0;
    let mut sign = "";
    if i < b.len() && (b[i] == '-' || b[i] == '+') {
        if b[i] == '-' {
            sign = "-";
        }
        i += 1;
    }
    let mut run = String::new();
    while i < b.len() && (b[i].is_ascii_digit() || b[i] == '.' || b[i] == ',') {
        run.push(b[i]);
        i += 1;
    }
    if !run.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }
    // Exponent nur, wenn unmittelbar „e“ und Ziffern folgen (sonst Einheit, z. B. "5 eV").
    let mut exp = String::new();
    if i < b.len() && (b[i] == 'e' || b[i] == 'E') {
        let mut j = i + 1;
        let mut e = String::from("e");
        if j < b.len() && (b[j] == '-' || b[j] == '+') {
            e.push(b[j]);
            j += 1;
        }
        let digits_from = j;
        while j < b.len() && b[j].is_ascii_digit() {
            e.push(b[j]);
            j += 1;
        }
        if j > digits_from {
            exp = e;
        }
    }
    let commas = run.matches(',').count();
    let dots = run.matches('.').count();
    let run = match (run.rfind(','), run.rfind('.')) {
        // Beides: das letzte Zeichen ist das Komma, das andere trennt Tausender.
        (Some(c), Some(d)) if c > d => run.replace('.', "").replace(',', "."),
        (Some(_), Some(_)) => run.replace(',', ""),
        (Some(_), None) if commas > 1 => run.replace(',', ""),
        (Some(_), None) => run.replace(',', "."),
        (None, Some(_)) if dots > 1 => run.replace('.', ""),
        _ => run,
    };
    format!("{sign}{run}{exp}").parse::<f64>().ok().filter(|x| x.is_finite())
}

/// Vergleichsform für Lückentext-Antworten: getrimmt, Leerräume zusammengefasst, kleingeschrieben.
pub fn norm(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// Lücken `{{a|b}}` eines Lückentexts als Liste ihrer Alternativen (je Lücke).
pub fn cloze_gaps(text: &str) -> Vec<Vec<String>> {
    let mut gaps = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else { break };
        let alts: Vec<String> = after[..end].split('|').map(|a| a.trim().to_string()).collect();
        gaps.push(alts);
        rest = &after[end + 2..];
    }
    gaps
}

/// Zahl für die Anzeige (deutsches Komma).
pub fn fmt_num(x: f64) -> String {
    x.to_string().replace('.', ",")
}
