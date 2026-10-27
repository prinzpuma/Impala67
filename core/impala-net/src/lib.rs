//! Gemeinsame HTTP-Schnittstelle für Drive, KI und Sync.
//!
//! Der Kern baut Anfragen ([`Request`]) und wertet Antworten ([`Response`]) aus; wer sie
//! verschickt, entscheidet die Plattform über [`HttpClient`]. Der Kern macht selbst keine
//! Ein-/Ausgabe: `send` ist asynchron, im Browser steckt `fetch` dahinter, auf iOS URLSession,
//! auf Android OkHttp. Standard für native Werkzeuge und Tests ist [`UreqClient`] (Feature
//! `client`) mit [`block_on`].

use std::fmt;
use std::future::Future;
use std::pin::pin;
use std::sync::Arc;
use std::task::{Context, Poll, Wake, Waker};
use std::thread::{self, Thread};

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

/// Verschickt Anfragen. Asynchron, ohne eigene Laufzeit: Die Plattform führt die Anfrage aus
/// (Browser: `fetch`), der Kern wartet nur auf das Ergebnis.
// Keine `Send`-Schranke: Im Browser hängen JS-Objekte am Client, und der Kern läuft dort in einem Thread.
#[allow(async_fn_in_trait)]
pub trait HttpClient {
    async fn send(&self, req: &Request) -> Result<Response, NetError>;

    /// Liefert den Körper stückweise an `on_chunk` (Streaming, z. B. SSE der KI-Anbieter).
    /// `on_chunk` gibt `false` zurück, um abzubrechen. Die gelieferte [`Response`] hat einen leeren `body`.
    /// Standard: ganze Antwort holen und in einem Stück liefern.
    async fn send_streaming(
        &self,
        req: &Request,
        on_chunk: &mut dyn FnMut(&[u8]) -> bool,
    ) -> Result<Response, NetError> {
        let mut res = self.send(req).await?;
        let body = std::mem::take(&mut res.body);
        if !on_chunk(&body) {
            return Err(NetError::Aborted);
        }
        Ok(res)
    }
}

impl<H: HttpClient + ?Sized> HttpClient for &H {
    async fn send(&self, req: &Request) -> Result<Response, NetError> {
        (**self).send(req).await
    }

    async fn send_streaming(
        &self,
        req: &Request,
        on_chunk: &mut dyn FnMut(&[u8]) -> bool,
    ) -> Result<Response, NetError> {
        (**self).send_streaming(req, on_chunk).await
    }
}

struct ThreadWaker(Thread);

impl Wake for ThreadWaker {
    fn wake(self: Arc<Self>) {
        self.0.unpark();
    }
}

/// Führt einen Kern-Ablauf auf dem aktuellen Thread zu Ende (native Werkzeuge, Tests,
/// blockierende Clients wie [`UreqClient`]). Nicht im Browser verwenden: Dort wartet der
/// Ablauf auf JS-Promises.
pub fn block_on<F: Future>(future: F) -> F::Output {
    let mut future = pin!(future);
    let waker = Waker::from(Arc::new(ThreadWaker(thread::current())));
    let mut cx = Context::from_waker(&waker);
    loop {
        if let Poll::Ready(out) = future.as_mut().poll(&mut cx) {
            return out;
        }
        thread::park();
    }
}

#[cfg(feature = "client")]
mod ureq_client;
#[cfg(feature = "client")]
pub use ureq_client::UreqClient;
