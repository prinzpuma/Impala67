//! Werkzeug `wikipedia`: passenden Artikel suchen und seine Kurzfassung mit Hauptbild holen.
//! Öffentliche Wikipedia-Schnittstellen ohne Schlüssel (Suche über `api.php`, Kurzfassung über
//! `rest_v1/page/summary`); beide erlauben Aufrufe direkt aus dem Browser (`origin=*`).
//! Anfragen bauen und Antworten auswerten sind reine Funktionen; gesendet wird über den
//! [`HttpClient`] der Plattform (PWA: `fetch`, Apps: `impala-net`).

use impala_net::{HttpClient, Method, Request, Response};
use serde_json::{Value, json};

use crate::js::encode_uri_component;

/// Länge der Einleitung im Ergebnis (Zeichen).
const EXTRACT_MAX: usize = 2500;
const SEARCH_LIMIT: usize = 5;
/// Wikimedia bittet um eine erkennbare Kennung; Browser dürfen `User-Agent` nicht setzen.
const AGENT: &str = "Impala67 (Lern-App)";

fn get(url: String) -> Request {
    Request::new(Method::Get, url).header("Api-User-Agent", AGENT)
}

/// Sprachkürzel aus den Argumenten (`de`, `en`, …); sonst Deutsch.
pub fn lang_of(args: &Value) -> String {
    let l = args.get("lang").and_then(Value::as_str).unwrap_or("").trim().to_ascii_lowercase();
    if (2..=3).contains(&l.len()) && l.chars().all(|c| c.is_ascii_lowercase()) { l } else { "de".into() }
}

pub fn search_request(lang: &str, query: &str) -> Request {
    get(format!(
        "https://{lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit={SEARCH_LIMIT}&srsearch={}",
        encode_uri_component(query)
    ))
}

pub fn summary_request(lang: &str, title: &str) -> Request {
    get(format!("https://{lang}.wikipedia.org/api/rest_v1/page/summary/{}", encode_uri_component(&title.replace(' ', "_"))))
}

/// Artikeltitel der Suche, bester zuerst: exakter Treffer (ohne Groß-/Kleinschreibung) vorn.
pub fn search_titles(body: &[u8], query: &str) -> Vec<String> {
    let v: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let mut titles: Vec<String> = v["query"]["search"]
        .as_array()
        .map(|a| a.iter().filter_map(|h| h["title"].as_str().map(str::to_owned)).collect())
        .unwrap_or_default();
    let q = query.trim().to_lowercase();
    if let Some(i) = titles.iter().position(|t| t.to_lowercase() == q) {
        let hit = titles.remove(i);
        titles.insert(0, hit);
    }
    titles
}

/// Ergebnis fürs Modell aus der Kurzfassung (`summary`) des gewählten Artikels.
pub fn result(lang: &str, title: &str, others: &[String], summary: &[u8]) -> Value {
    let s: Value = serde_json::from_slice(summary).unwrap_or(Value::Null);
    let text = |v: &Value| v.as_str().unwrap_or("").to_owned();
    let image = s["originalimage"]["source"].as_str().or_else(|| s["thumbnail"]["source"].as_str());
    let url = s["content_urls"]["desktop"]["page"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| format!("https://{lang}.wikipedia.org/wiki/{}", encode_uri_component(&title.replace(' ', "_"))));
    let extract: String = text(&s["extract"]).chars().take(EXTRACT_MAX).collect();
    let hint = if image.is_some() {
        "Bild passt zur Frage? Dann zeige es als ![Beschreibung](image) und nenne Wikipedia als Quelle. Im KI-Zeitstrahl: sources {kind:\"wiki\", ref:url, title}, images [{src:image, credit:\"Wikimedia Commons\"}]."
    } else {
        "Als Quelle angeben: url. Im KI-Zeitstrahl: sources {kind:\"wiki\", ref:url, title}."
    };
    json!({
        "title": s["title"].as_str().unwrap_or(title),
        "description": text(&s["description"]),
        "extract": extract,
        "url": url,
        "image": image,
        "other_results": others,
        "hint": hint,
    })
}

fn failed(res: &Response) -> Option<String> {
    (!res.is_success()).then(|| format!("Wikipedia antwortet mit Status {}.", res.status))
}

/// Führt `wikipedia` aus: `{ query, lang? }` → Artikel mit Einleitung, Link und Bild oder `{ error }`.
pub async fn run(http: &impl HttpClient, args: &Value) -> Value {
    let query = args.get("query").and_then(Value::as_str).unwrap_or("").trim().to_owned();
    if query.is_empty() {
        return json!({ "error": "wikipedia: query fehlt – nenne einen Suchbegriff oder Artikeltitel." });
    }
    let lang = lang_of(args);
    let unreachable = |e: impala_net::NetError| json!({ "error": format!("Wikipedia nicht erreichbar: {e}") });
    let found = match http.send(&search_request(&lang, &query)).await {
        Ok(res) => res,
        Err(e) => return unreachable(e),
    };
    if let Some(e) = failed(&found) {
        return json!({ "error": e });
    }
    let titles = search_titles(&found.body, &query);
    let Some((title, others)) = titles.split_first() else {
        return json!({ "error": format!("Kein Wikipedia-Artikel zu „{query}“ – anderen Begriff oder lang: \"en\" versuchen.") });
    };
    let summary = match http.send(&summary_request(&lang, title)).await {
        Ok(res) => res,
        Err(e) => return unreachable(e),
    };
    if let Some(e) = failed(&summary) {
        return json!({ "error": e });
    }
    result(&lang, title, others, &summary.body)
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use impala_net::{NetError, block_on};

    use super::*;

    /// Falscher Server: Antworten nach URL-Anfang, Anfragen werden mitgeschrieben.
    struct Fake {
        routes: Vec<(&'static str, u16, String)>,
        seen: RefCell<Vec<Request>>,
    }

    impl HttpClient for Fake {
        async fn send(&self, req: &Request) -> Result<Response, NetError> {
            self.seen.borrow_mut().push(req.clone());
            let (_, status, body) = self
                .routes
                .iter()
                .find(|(p, _, _)| req.url.contains(p))
                .ok_or_else(|| NetError::Connect("offline".into()))?;
            Ok(Response { status: *status, headers: vec![], body: body.clone().into_bytes() })
        }
    }

    fn fake(routes: Vec<(&'static str, u16, String)>) -> Fake {
        Fake { routes, seen: RefCell::new(vec![]) }
    }

    const SEARCH: &str = r#"{"query":{"search":[{"title":"Transistor"},{"title":"Bipolartransistor"},{"title":"Feldeffekttransistor"}]}}"#;

    #[test]
    fn exakter_treffer_vorn_und_ergebnis_mit_bild() {
        let summary = json!({
            "title": "Bipolartransistor", "description": "Transistortyp", "extract": "Ein Bipolartransistor …",
            "originalimage": { "source": "https://upload.wikimedia.org/a.gif" },
            "content_urls": { "desktop": { "page": "https://de.wikipedia.org/wiki/Bipolartransistor" } }
        });
        let http = fake(vec![("api.php", 200, SEARCH.into()), ("summary/Bipolartransistor", 200, summary.to_string())]);
        let out = block_on(run(&http, &json!({ "query": "bipolartransistor" })));
        assert_eq!(out["title"], "Bipolartransistor");
        assert_eq!(out["image"], "https://upload.wikimedia.org/a.gif");
        assert_eq!(out["other_results"], json!(["Transistor", "Feldeffekttransistor"]));
        assert!(out["hint"].as_str().unwrap().contains("![Beschreibung](image)"));
        let seen = http.seen.borrow();
        assert!(seen[0].url.starts_with("https://de.wikipedia.org/w/api.php?") && seen[0].url.contains("srsearch=bipolartransistor"));
        assert!(seen.iter().all(|r| r.headers.iter().any(|(k, _)| k == "Api-User-Agent")));
    }

    #[test]
    fn titel_und_suchbegriff_werden_kodiert_sprache_geprueft() {
        assert!(search_request("en", "Ohm's law & co").url.ends_with("srsearch=Ohm's%20law%20%26%20co"));
        assert!(summary_request("de", "Ohmsches Gesetz").url.ends_with("/summary/Ohmsches_Gesetz"));
        assert_eq!(lang_of(&json!({ "lang": "EN" })), "en");
        assert_eq!(lang_of(&json!({ "lang": "x/../" })), "de");
        assert_eq!(lang_of(&json!({})), "de");
    }

    #[test]
    fn ohne_bild_und_ohne_link_aus_titel() {
        let out = result("de", "Kirchhoffsche Regeln", &[], br#"{"title":"Kirchhoffsche Regeln","extract":"x"}"#);
        assert_eq!(out["image"], Value::Null);
        assert_eq!(out["url"], "https://de.wikipedia.org/wiki/Kirchhoffsche_Regeln");
        assert!(!out["hint"].as_str().unwrap().contains("!["));
    }

    #[test]
    fn fehler_verstaendlich() {
        let leer = fake(vec![("api.php", 200, r#"{"query":{"search":[]}}"#.into())]);
        assert!(block_on(run(&leer, &json!({ "query": "Xyzzy" })))["error"].as_str().unwrap().contains("Kein Wikipedia-Artikel"));
        assert!(block_on(run(&leer, &json!({})))["error"].as_str().unwrap().contains("query fehlt"));
        let offline = fake(vec![]);
        assert!(block_on(run(&offline, &json!({ "query": "Ohm" })))["error"].as_str().unwrap().contains("nicht erreichbar"));
        let kaputt = fake(vec![("api.php", 503, String::new())]);
        assert!(block_on(run(&kaputt, &json!({ "query": "Ohm" })))["error"].as_str().unwrap().contains("503"));
    }
}
