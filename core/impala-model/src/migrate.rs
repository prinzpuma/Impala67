//! Migrationen alter Datenformate, die nicht im Checkpoint-Format stecken (siehe
//! `docs/ARCHITEKTUR.md`, B6). Gespeichertes Altes wird gelesen, nie stillschweigend verworfen.
//!
//! Alte Zugangsdaten (`state.js` `migrateLegacySecretsToSync`): Frühere Versionen legten
//! API-Schlüssel und Notion-Token im localStorage ab (`impala67.secrets`, davor `notion.secrets`).
//! Sie werden einmalig als `settingsSet` übernommen; danach löscht die Hülle die alten Einträge.
//! Weitere Altlasten liegen dort, wo sie gelesen werden: Checkpoint-Format 1 (`impala-storage`),
//! Seiten ohne `created` und der alte Name der Cloudflare-Quelle ([`State::restore`](crate::State::restore)),
//! Checkpoints ohne Tagesartikel/Archiv-Abgleich ([`Model::load`](crate::Model::load)).

use serde_json::Value;

use crate::js::{self, Object};
use crate::types::Settings;

/// Liest den alten Speicherinhalt (`impala67.secrets`, sonst `notion.secrets`). Kaputtes JSON: leer.
pub fn parse_legacy_secrets(current: Option<&str>, older: Option<&str>) -> Value {
    let text = [current, older].into_iter().flatten().find(|s| !s.is_empty()).unwrap_or("{}");
    serde_json::from_str(text).unwrap_or_else(|_| Value::Object(Object::new()))
}

/// Patch für `settingsSet` aus alten Zugangsdaten; nur, was in den Einstellungen noch fehlt.
/// `None`: nichts zu übernehmen (dann auch die alten Einträge stehen lassen, wie JS).
pub fn legacy_secrets_patch(settings: &Settings, legacy: &Value) -> Option<Object> {
    let mut patch = Object::new();
    let field = |k: &str| js::or(legacy.get(k)).cloned();
    if let Some(t) = field("notionToken")
        && !settings.truthy("notionToken")
    {
        patch.insert("notionToken".into(), t);
    }
    if let Some(p) = field("corsProxy")
        && !settings.truthy("corsProxy")
    {
        patch.insert("corsProxy".into(), p);
    }
    let keys = legacy.get("providerKeys").filter(|k| js::truthy(k));
    let mut changed = false;
    let providers: Vec<Value> = settings
        .ai_providers
        .iter()
        .flatten()
        .map(|pr| {
            let id = pr.get("id").map(js::to_string).unwrap_or_else(|| "undefined".into());
            let key = keys.and_then(|k| k.get(&id)).filter(|k| js::truthy(k));
            match key {
                Some(k) if !pr.get("key").is_some_and(js::truthy) => {
                    changed = true;
                    let mut o = pr.as_object().cloned().unwrap_or_default();
                    o.insert("key".into(), k.clone());
                    Value::Object(o)
                }
                _ => pr.clone(),
            }
        })
        .collect();
    if changed {
        patch.insert("aiProviders".into(), Value::Array(providers));
    }
    (!patch.is_empty()).then_some(patch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn alte_schluessel_nur_wo_leer() {
        let s = crate::types::default_settings();
        let legacy = parse_legacy_secrets(
            None,
            Some(r#"{"notionToken":"n","providerKeys":{"openai":"sk","local":""},"corsProxy":""}"#),
        );
        let patch = legacy_secrets_patch(&s, &legacy).unwrap();
        assert_eq!(patch["notionToken"], json!("n"));
        assert!(!patch.contains_key("corsProxy"));
        assert_eq!(patch["aiProviders"][2]["key"], json!("sk"));
        assert_eq!(patch["aiProviders"][3]["key"], json!(""));
        assert_eq!(legacy_secrets_patch(&s, &parse_legacy_secrets(Some("kaputt"), None)), None);
    }
}
