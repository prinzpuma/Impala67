//! KI-Quellen (Einstellungen → KI): Voreinstellungen, Erkennung der Anbieter-Familie,
//! aufgelöste Chat-Konfiguration und dokumentierte Thinking-Stufen je Modell.

use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::js;

/// Standard-Worker für Sync und „Impala AI“.
pub const DEFAULT_WORKER_URL: &str = "https://impala67-sync.joshuagayer1.workers.dev";
/// Kopfzeile und Version des Sync-Protokolls; der Worker verlangt sie auch für `/models`.
pub const SYNC_PROTOCOL_HEADER: &str = "X-Impala-Sync-Protocol";
pub const SYNC_PROTOCOL: u32 = 4;
/// Modell-IDs mit diesem Präfix laufen lokal im Gerät (z. B. `local:bekko-a8m`), nie über eine API.
pub const LOCAL_MODEL_PREFIX: &str = "local:";
/// Anbieter-ID der lokalen Quelle.
pub const LOCAL_PROVIDER_ID: &str = "local";

/// Eine KI-Quelle wie in `settings.aiProviders` gespeichert (Schlüssel bleibt lokal).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Provider {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub base: String,
    #[serde(default)]
    pub key: String,
}

impl Provider {
    pub fn new(id: &str, name: &str, base: &str) -> Self {
        Provider { id: id.into(), name: name.into(), base: base.into(), key: String::new() }
    }
}

/// Voreingestellte Quellen (Reihenfolge wie in den Standard-Einstellungen).
pub fn default_providers() -> Vec<Provider> {
    vec![
        Provider::new("cloudflare", "Impala AI", DEFAULT_WORKER_URL),
        Provider::new("google", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai"),
        Provider::new("openai", "OpenAI", "https://api.openai.com/v1"),
        Provider::new(LOCAL_PROVIDER_ID, "Lokal (LM Studio)", "http://localhost:1234/v1"),
    ]
}

/// Vorschläge im Modell-Menü.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelPreset {
    pub value: &'static str,
    pub label: &'static str,
    pub provider: &'static str,
}

pub const MODEL_PRESETS: [ModelPreset; 9] = [
    ModelPreset { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash", provider: "google" },
    ModelPreset { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", provider: "google" },
    ModelPreset { value: "gemma-4-31b-it", label: "Gemma 4 31B", provider: "google" },
    ModelPreset { value: "gemma-4-26b-a4b-it", label: "Gemma 4 26B A4B", provider: "google" },
    ModelPreset { value: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "openai" },
    ModelPreset { value: "gpt-5.6-terra", label: "GPT-5.6 Terra", provider: "openai" },
    ModelPreset { value: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "openai" },
    ModelPreset { value: "impala-ai", label: "Impala AI", provider: "cloudflare" },
    ModelPreset { value: "local-model", label: "Lokales Modell", provider: "local" },
];

/// Anbieter-Familie: bestimmt Transport (Cloudflare-Worker vs. OpenAI-kompatibel) und Eigenheiten.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Family {
    Cloudflare,
    Local,
    Google,
    Deepseek,
    Openai,
    Other,
}

static CF_TAG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(r"(?-u:\b)(cloudflare|workers\.dev|impala{}*ai)(?-u:\b)", js::WS_CLASS))
        .expect("gültiges Muster")
});
static CF_BASE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"workers\.dev|/api/ai(?-u:\b)").expect("gültiges Muster"));
static LOCAL_BASE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\.local(?::|/|$)").expect("gültiges Muster")
});
static LOCAL_TAG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(r"(?-u:\b)(local|lm(?:-|{})?studio|ollama|llama\.cpp|jan)(?-u:\b)", js::WS_CLASS))
        .expect("gültiges Muster")
});
static GOOGLE_TAG: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?-u:\b)(google|gemini|gemma)(?-u:\b)").expect("gültiges Muster"));
static WORD: LazyLock<[Regex; 2]> = LazyLock::new(|| {
    [
        Regex::new(r"(?-u:\b)deepseek(?-u:\b)").expect("gültiges Muster"),
        Regex::new(r"(?-u:\b)openai(?-u:\b)").expect("gültiges Muster"),
    ]
});

/// Familie aus ID, Name und Basis-URL.
pub fn family(provider: &Provider) -> Family {
    let tag = [provider.id.as_str(), provider.name.as_str()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    let base = provider.base.to_lowercase();
    if provider.id == "cloudflare" || CF_TAG.is_match(&tag) || CF_BASE.is_match(&base) {
        Family::Cloudflare
    } else if LOCAL_BASE.is_match(&base) || LOCAL_TAG.is_match(&tag) {
        Family::Local
    } else if base.contains("generativelanguage")
        || base.contains("googleapis")
        || base.contains("google")
        || GOOGLE_TAG.is_match(&tag)
    {
        Family::Google
    } else if WORD[0].is_match(&tag) || base.contains("deepseek") {
        Family::Deepseek
    } else if base.contains("api.openai.com") || WORD[1].is_match(&tag) {
        Family::Openai
    } else {
        Family::Other
    }
}

/// Basis-URL ohne abschließende Schrägstriche.
pub fn clean_base(base: &str) -> &str {
    base.trim_end_matches('/')
}

/// Einstellungen, aus denen die Chat-Konfiguration entsteht.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AiSettings {
    pub providers: Vec<Provider>,
    pub active_provider_id: String,
    pub model: String,
    pub thinking_enabled: bool,
}

/// Aufgelöste Konfiguration einer Anfrage. Gilt für einen ganzen Lauf samt Wiederholungen.
#[derive(Clone, PartialEq, Eq, Default)]
pub struct ChatConfig {
    pub provider_id: String,
    pub base: String,
    /// API-Schlüssel – nie loggen (siehe `Debug`).
    pub key: String,
    pub model: String,
    pub family: Option<Family>,
    pub thinking_enabled: bool,
}

impl std::fmt::Debug for ChatConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChatConfig")
            .field("provider_id", &self.provider_id)
            .field("base", &self.base)
            .field("key", &if self.key.is_empty() { "" } else { "***" })
            .field("model", &self.model)
            .field("family", &self.family)
            .field("thinking_enabled", &self.thinking_enabled)
            .finish()
    }
}

/// Alte Cloudflare-Modellnamen laufen heute alle über „impala-ai“.
fn cloudflare_model(model: &str) -> &str {
    let legacy = model.is_empty()
        || matches!(model, "qwen/qwen3.6-27b" | "qwen/qwen3.8-27b" | "llama-3.3-70b-versatile" | "cloudflare-auto")
        || model.starts_with("openai/gpt-oss");
    if legacy { "impala-ai" } else { model }
}

impl ChatConfig {
    /// Aktive Quelle (sonst die erste) samt Modell.
    pub fn resolve(settings: &AiSettings) -> Self {
        let provider = settings
            .providers
            .iter()
            .find(|p| p.id == settings.active_provider_id)
            .or_else(|| settings.providers.first());
        let fam = provider.map_or(Family::Other, family);
        let model = if fam == Family::Cloudflare { cloudflare_model(&settings.model) } else { &settings.model };
        ChatConfig {
            provider_id: provider.map(|p| p.id.clone()).unwrap_or_default(),
            base: provider.map(|p| clean_base(&p.base).to_owned()).unwrap_or_default(),
            key: provider.map(|p| p.key.clone()).unwrap_or_default(),
            model: model.to_owned(),
            family: Some(fam),
            thinking_enabled: settings.thinking_enabled,
        }
    }

    pub fn family(&self) -> Family {
        self.family.unwrap_or(Family::Other)
    }
}

/// Quellen, deren `/models` sich abfragen lässt: offizielle Clouds nur mit Schlüssel.
pub fn model_providers(providers: &[Provider]) -> Vec<&Provider> {
    providers
        .iter()
        .filter(|p| {
            let base = clean_base(&p.base).to_lowercase();
            let is_cf = p.id == "cloudflare" || base.contains("workers.dev");
            let official = base.contains("api.openai.com") || base.contains("generativelanguage.googleapis.com");
            !base.is_empty() && (!p.key.is_empty() || is_cf || !official)
        })
        .collect()
}

/// Zeigt `base` auf den Cloudflare-Worker? (`sync_url`: eingerichtete Sync-Adresse)
pub fn is_cloudflare_base(base: &str, sync_url: &str, providers: &[Provider]) -> bool {
    let clean = clean_base(base).to_lowercase();
    if clean.is_empty() {
        return false;
    }
    if CF_BASE.is_match(&clean) {
        return true;
    }
    let sync = clean_base(sync_url).to_lowercase();
    if !sync.is_empty() && clean == sync {
        return true;
    }
    providers.iter().any(|p| clean_base(&p.base).to_lowercase() == clean && family(p) == Family::Cloudflare)
}

/// Dokumentierte Thinking-Stufen des Chat-Adapters für ein Modell.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingCapabilities {
    pub levels: Vec<&'static str>,
    pub include_thoughts: bool,
    /// Stufe für „Thinking aus“; `None` = nicht abschaltbar.
    pub off_effort: Option<&'static str>,
    pub off_label: Option<&'static str>,
    pub source: &'static str,
}

impl ThinkingCapabilities {
    fn new(levels: &[&'static str], include: bool, off: (&'static str, &'static str), source: &'static str) -> Self {
        ThinkingCapabilities {
            levels: levels.to_vec(),
            include_thoughts: include,
            off_effort: Some(off.0),
            off_label: Some(off.1),
            source,
        }
    }

    pub fn declared(config: &ChatConfig) -> Self {
        const FULL: [&str; 4] = ["none", "low", "medium", "high"];
        let model = config.model.to_lowercase();
        // Google liefert IDs auch als „models/gemini-…“ – das Präfix gehört zum Transportweg.
        let model = model.strip_prefix("models/").unwrap_or(&model);
        let gpt5 = model.strip_prefix("gpt-5").is_some_and(|r| r.is_empty() || r.starts_with(['.', '-']));
        let pro = model.match_indices("-pro").any(|(i, _)| {
            let rest = &model[i + 4..];
            rest.is_empty() || rest.starts_with('-')
        });
        match config.family() {
            Family::Cloudflare => Self::new(&FULL, true, ("none", "Aus"), "groq-openai"),
            Family::Google if model.starts_with("gemini-3.") => {
                Self::new(&["minimal", "low", "medium", "high"], true, ("minimal", "Minimal"), "gemini-openai")
            }
            Family::Google if model.starts_with("gemini-2.5-flash") => {
                Self::new(&FULL, true, ("none", "Aus"), "gemini-openai")
            }
            Family::Google if model.starts_with("gemini-2.5-pro") => {
                Self::new(&["low", "medium", "high"], true, ("low", "Niedrig"), "gemini-openai")
            }
            Family::Openai if gpt5 && !pro => Self::new(&FULL, false, ("none", "Aus"), "openai"),
            Family::Local if ["gemma", "qwen", "deepseek", "reasoning", "r1"].iter().any(|m| model.contains(m)) => {
                Self::new(&FULL, false, ("none", "Aus"), "local-openai")
            }
            _ => ThinkingCapabilities {
                levels: vec![],
                include_thoughts: false,
                off_effort: None,
                off_label: None,
                source: "none",
            },
        }
    }

    /// Hinweis für die Oberfläche, wenn das Modell keine steuerbare Stufe hat.
    pub fn unsupported_note(&self, model: &str) -> Option<&'static str> {
        (!model.is_empty() && self.levels.is_empty()).then_some(
            "Für dieses Modell ist über den aktuellen Chat-Adapter keine steuerbare Thinking-Stufe dokumentiert.",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(id: &str, name: &str, base: &str) -> Provider {
        Provider::new(id, name, base)
    }

    #[test]
    fn familien() {
        assert_eq!(family(&p("x", "Mein Worker", "https://a.workers.dev")), Family::Cloudflare);
        assert_eq!(family(&p("x", "Impala  AI", "")), Family::Cloudflare);
        assert_eq!(family(&p("x", "LM Studio", "http://box:1234")), Family::Local);
        assert_eq!(family(&p("x", "", "http://nas.local/v1")), Family::Local);
        assert_eq!(family(&p("x", "DeepSeek", "https://api.deepseek.com")), Family::Deepseek);
        assert_eq!(family(&p("openai", "", "")), Family::Openai);
        assert_eq!(family(&p("x", "Groq", "https://api.groq.com/openai/v1")), Family::Other);
    }

    #[test]
    fn cloudflare_modell() {
        let settings = AiSettings {
            providers: default_providers(),
            active_provider_id: "cloudflare".into(),
            model: "openai/gpt-oss-120b".into(),
            thinking_enabled: true,
        };
        assert_eq!(ChatConfig::resolve(&settings).model, "impala-ai");
    }
}
