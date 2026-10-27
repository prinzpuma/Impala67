//! Fehler der KI-Anfragen mit den Meldungen, die die App dem Nutzer zeigt.

use std::fmt;

use serde_json::Value;

use crate::js;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AiError {
    /// HTTP-Status ≥ 400 oder Fehler mitten im Datenstrom.
    Http {
        status: u16,
        message: String,
        retry_after_ms: u64,
    },
    /// Keine Verbindung (Netz, DNS, CORS).
    Network(String),
    /// Zeitüberschreitung in einer Phase („die Verbindung“, „den Datenstrom“ …).
    Timeout {
        phase: &'static str,
        ms: u64,
    },
    Aborted,
    /// Fehlende Einrichtung oder unbrauchbare Antwort – Text wird so angezeigt.
    Other(String),
}

/// Obergrenze für Wartezeiten aus `Retry-After`.
const MAX_RETRY_MS: u64 = 60_000;

impl AiError {
    /// HTTP-Fehler aus Status und Antworttext. OpenAI-kompatible Anbieter liefern
    /// `{error:{message, metadata.raw}}`, der Worker `{error:"…"}`.
    pub fn http(status: u16, text: &str, retry_after_ms: u64) -> Self {
        let detail = serde_json::from_str::<Value>(text).ok().and_then(|json| {
            let e = json.get("error")?;
            let d = match e {
                Value::String(s) => s.clone(),
                _ => js::first_truthy([e.pointer("/metadata/raw"), e.get("message")]),
            };
            (!d.is_empty()).then_some(d)
        });
        let message = match detail {
            Some(d) if status == 429 => {
                format!(
                    "KI-Limit des Anbieters erreicht: {d} Warte kurz oder wähle unter Einstellungen → KI einen anderen Anbieter."
                )
            }
            Some(d) => format!("KI-Fehler {status}: {d}"),
            None => format!("KI-Fehler {status}: {}", js::head16(text, 300)),
        };
        let mut retry = retry_after_ms;
        if retry == 0 && status == 429 {
            retry = retry_hint(text).unwrap_or(0);
        }
        AiError::Http { status, message, retry_after_ms: retry.min(MAX_RETRY_MS) }
    }

    pub fn status(&self) -> Option<u16> {
        match self {
            AiError::Http { status, .. } => Some(*status),
            _ => None,
        }
    }

    pub fn retry_after_ms(&self) -> u64 {
        match self {
            AiError::Http { retry_after_ms, .. } => *retry_after_ms,
            _ => 0,
        }
    }
}

/// „try again in 12.5s“ im Fehlertext (Groq & Co.).
fn retry_hint(text: &str) -> Option<u64> {
    let lower = text.to_lowercase();
    let mut from = 0;
    while let Some(at) = lower[from..].find("try again in") {
        let rest = lower[from + at + 12..].trim_start_matches(js::is_ws);
        let num: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        let after = rest[num.len()..].trim_start_matches(js::is_ws);
        if let (Ok(secs), true) =
            (num.trim_end_matches('.').parse::<f64>(), after.starts_with('s') && !num.starts_with('.'))
        {
            return Some((secs * 1000.0).ceil() as u64);
        }
        from += at + 12;
    }
    None
}

impl fmt::Display for AiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AiError::Http { message, .. } => f.write_str(message),
            AiError::Network(m) => write!(
                f,
                "Keine Verbindung zum KI-Server ({m}). Prüfe Internet, Endpoint und CORS in den Einstellungen → KI."
            ),
            AiError::Timeout { phase, ms } => write!(
                f,
                "Zeitüberschreitung: Der KI-Server hat {phase} nicht innerhalb von {} Sekunden abgeschlossen.",
                (*ms as f64 / 1000.0).round()
            ),
            AiError::Aborted => f.write_str("Abgebrochen."),
            AiError::Other(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for AiError {}

/// `Retry-After` als Sekunden oder HTTP-Datum (`now_ms`: aktuelle Zeit in ms seit 1970).
pub fn retry_after_header(raw: Option<&str>, now_ms: u64) -> u64 {
    let Some(raw) = raw.map(js::trim).filter(|s| !s.is_empty()) else { return 0 };
    if let Ok(secs) = raw.parse::<f64>() {
        return if secs.is_finite() && secs > 0.0 { (secs * 1000.0) as u64 } else { 0 };
    }
    http_date_ms(raw).map_or(0, |t| t.saturating_sub(now_ms))
}

/// IMF-fixdate („Sun, 06 Nov 1994 08:49:37 GMT“) in ms seit 1970.
fn http_date_ms(s: &str) -> Option<u64> {
    let parts: Vec<&str> = s.split_whitespace().collect();
    let [_, day, month, year, time, _] = parts.as_slice() else { return None };
    const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    let month = MONTHS.iter().position(|m| month.eq_ignore_ascii_case(m))? as i64 + 1;
    let (day, year): (i64, i64) = (day.parse().ok()?, year.parse().ok()?);
    let hms: Vec<i64> = time.split(':').map(|x| x.parse().ok()).collect::<Option<_>>()?;
    let [h, mi, se] = hms.as_slice() else { return None };
    // Tage seit 1970 (Algorithmus von H. Hinnant).
    let (y, m) = if month <= 2 { (year - 1, month + 9) } else { (year, month - 3) };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(((days * 24 + h) * 60 + mi) * 60 + se).ok().map(|s| s * 1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn meldungen() {
        let e = AiError::http(429, r#"{"error":{"message":"Rate limit. Please try again in 2.5s."}}"#, 0);
        assert_eq!(e.retry_after_ms(), 2500);
        assert!(e.to_string().starts_with("KI-Limit des Anbieters erreicht: Rate limit."));
        assert_eq!(AiError::http(500, "kaputt", 0).to_string(), "KI-Fehler 500: kaputt");
        assert_eq!(AiError::http(400, r#"{"error":"nein"}"#, 0).to_string(), "KI-Fehler 400: nein");
    }

    #[test]
    fn retry_after() {
        assert_eq!(retry_after_header(Some("3"), 0), 3000);
        assert_eq!(retry_after_header(Some("Thu, 01 Jan 1970 00:00:10 GMT"), 4000), 6000);
        assert_eq!(retry_after_header(Some("bald"), 0), 0);
    }
}
