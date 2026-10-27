//! KI-Anbieter: Anfragen, Streaming-Parser, Agent-Schleife, LlmProvider.
//!
//! Neu geschrieben nach `web/ai.js` (ohne Oberfläche): Quellen und Familien
//! ([`provider`]), Anfrage-Bau ([`request`]), Antworten und SSE-Ströme ([`stream`]),
//! Denkblöcke ([`think`]), Prompt-Bau ([`prompt`]), Wiederholungen ([`chat`]) und die
//! Agent-Schleife ([`agent`]). Netz läuft über [`impala_net::HttpClient`]; KI-Schlüssel
//! kommen als Parameter und werden nie geloggt.

mod js;

pub mod agent;
pub mod api;
pub mod chat;
pub mod error;
pub mod message;
pub mod prompt;
pub mod provider;
pub mod request;
pub mod stream;
pub mod think;
pub mod tools;

pub use agent::{
    AgentEvent, AgentItem, AgentOutcome, AgentRequest, AgentSession, CancelToken, HeftPage, HeftPageContent, MAX_STEPS,
    ToolExecutor, ToolOutput, refine, refine_messages, run_agent,
};
pub use api::{
    EmbedRoute, ListedModel, PingResult, Sources, embed_provider, embed_remote, embed_route, list_models, ping_provider,
};
pub use chat::{ChatTurn, HttpProvider, LlmProvider, ModelInfo, complete};
pub use error::AiError;
pub use message::{AssistantMessage, Content, Message, Part, Role, ToolCall, ToolDef};
pub use prompt::{
    AnkiCard, AnkiView, Attachment, ChatEntry, ChatSummary, LocalTime, PageContext, RagHit, Workspace, rag_query,
};
pub use provider::{
    AiSettings, ChatConfig, DEFAULT_WORKER_URL, Family, LOCAL_MODEL_PREFIX, MODEL_PRESETS, Provider,
    ThinkingCapabilities, default_providers,
};
pub use request::{CloudflareAuth, RequestOptions};
pub use stream::{StreamParser, StreamUpdate};
pub use tools::builtin_tools;
