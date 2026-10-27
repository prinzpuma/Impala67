//! Gemeinsame HTTP-Schnittstelle für Drive, KI und Sync.
//!
//! Der Kern baut Anfragen ([`Request`]) und wertet Antworten ([`Response`]) aus; wer sie
//! verschickt, entscheidet die Plattform über [`HttpClient`]. Standard ist [`UreqClient`]
//! (Feature `client`); iOS/Android/Web dürfen ihren eigenen Client einsetzen.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

impl Method {
    pub fn as_str(self) -> &'static str {
        match self {
            Method::Get => "GET",
            Method::Post => "POST",
            Method::Put => "PUT",
            Method::Patch => "PATCH",
            Method::Delete => "DELETE",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub method: Method,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Request {
    pub fn new(method: Method, url: impl Into<String>) -> Self {
        Request { method, url: url.into(), headers: Vec::new(), body: Vec::new() }
    }

    pub fn header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }

    pub fn body(mut self, body: impl Into<Vec<u8>>) -> Self {
        self.body = body.into();
        self
    }

    /// Setzt den Körper als JSON-Text samt `Content-Type`.
    pub fn json_text(self, json: impl Into<String>) -> Self {
        self.header("Content-Type", "application/json").body(json.into().into_bytes())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Response {
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// Erster Header mit diesem Namen (Groß-/Kleinschreibung egal).
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

/// Fehler beim Transport (keine Verbindung, Zeitüberschreitung, abgebrochen).
/// HTTP-Statuscodes ≥ 400 sind kein `NetError`, sondern eine normale [`Response`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NetError {
    Connect(String),
    Timeout,
    Aborted,
    Other(String),
}

impl fmt::Display for NetError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NetError::Connect(m) => write!(f, "Verbindung fehlgeschlagen: {m}"),
            NetError::Timeout => f.write_str("Zeitüberschreitung"),
            NetError::Aborted => f.write_str("abgebrochen"),
            NetError::Other(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for NetError {}

/// Verschickt Anfragen. Blockierend: Plattformen rufen den Kern aus einem Hintergrund-Thread.
pub trait HttpClient: Send + Sync {
    fn send(&self, req: &Request) -> Result<Response, NetError>;

    /// Liefert den Körper stückweise an `on_chunk` (Streaming, z. B. SSE der KI-Anbieter).
    /// `on_chunk` gibt `false` zurück, um abzubrechen. Die gelieferte [`Response`] hat einen leeren `body`.
    /// Standard: ganze Antwort holen und in einem Stück liefern.
    fn send_streaming(&self, req: &Request, on_chunk: &mut dyn FnMut(&[u8]) -> bool) -> Result<Response, NetError> {
        let mut res = self.send(req)?;
        let body = std::mem::take(&mut res.body);
        if !on_chunk(&body) {
            return Err(NetError::Aborted);
        }
        Ok(res)
    }
}

#[cfg(feature = "client")]
mod ureq_client;
#[cfg(feature = "client")]
pub use ureq_client::UreqClient;
