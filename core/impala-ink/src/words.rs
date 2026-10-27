//! Kleines Wörterbuch häufiger Wörter: Bonus in der Beam-Search und Ein-Fehler-Korrektur.
//! Die 5.000 häufigsten Wörter stehen nur einmal im Repo (`web/handwriting-words-de.js`).

use std::collections::HashSet;
use std::sync::OnceLock;

const WORDS_JS: &str = include_str!("../../../web/handwriting-words-de.js");

/// Notiz-, Kalender- und Mathe-Begriffe zusätzlich zur Häufigkeitsliste (wie `COMMON_WORDS` in handwriting-ctc.js).
const EXTRA: &str = "der die das und in den von zu mit sich des auf für ist im dem nicht ein eine als auch es an \
    werden aus er hat dass sie nach wird bei einer um am sind noch wie einem über einen so zum war haben nur oder \
    aber vor zur bis mehr durch man sein wurde sei prozent ich du wir ihr mein meine meiner dein deine unser kann \
    können muss müssen soll sollte sollten wollen geht gibt gut sehr hier da dort jetzt immer wieder schon dann \
    wenn weil alle alles viele nichts etwas notiz notizen aufgabe aufgaben projekt projekte idee ideen ziel ziele \
    datum heute morgen gestern wichtig dringend treffen meeting bericht arbeit schule studium thema kapitel seite \
    seiten punkt punkte text texte zeile zeilen lernen lesen schreiben übung übungen beispiel beispiele frage \
    fragen antwort antworten code test fehler plan neu neue neues groß große klein kleine montag dienstag \
    mittwoch donnerstag freitag samstag sonntag januar februar märz april mai juni juli august september oktober \
    november dezember jahr woche monat tag stunde sin cos tan lim log exp max min grad";

pub(crate) struct Words {
    set: HashSet<&'static str>,
    /// Für die Korrektur: Wort als Zeichenfolge (Levenshtein je Zeichen)
    chars: Vec<(&'static str, Vec<char>)>,
}

pub(crate) fn words() -> &'static Words {
    static WORDS: OnceLock<Words> = OnceLock::new();
    WORDS.get_or_init(|| {
        // Wortliste steht im JS zwischen den beiden Backticks
        let list = WORDS_JS.split('`').nth(1).unwrap_or("");
        let mut set = HashSet::new();
        let mut chars = Vec::new();
        for w in list.split_whitespace().chain(EXTRA.split_whitespace()) {
            if set.insert(w) {
                chars.push((w, w.chars().collect()));
            }
        }
        Words { set, chars }
    })
}

impl Words {
    pub(crate) fn contains(&self, lower: &str) -> bool {
        self.set.contains(lower)
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = &(&'static str, Vec<char>)> {
        self.chars.iter()
    }
}

/// Bekanntes Wort ohne Satzzeichen am Rand (mindestens 2 Buchstaben).
pub(crate) fn is_known_word(word: &str) -> bool {
    let core = word.trim_matches(|c: char| !c.is_alphabetic()).to_lowercase();
    core.chars().count() >= 2 && words().contains(&core)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn liste_geladen() {
        let w = words();
        assert!(w.chars.len() > 5000, "{}", w.chars.len());
        assert!(w.contains("prozent") && w.contains("stunde") && w.contains("die"));
        assert!(is_known_word("(Heute,") && !is_known_word("x"));
    }
}
