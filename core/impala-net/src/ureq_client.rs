//! Standard-[`HttpClient`] auf Basis von ureq.

use std::io::Read;
use std::time::Duration;

use crate::{HttpClient, NetError, Request, Response};

pub struct UreqClient {
    agent: ureq::Agent,
}

impl UreqClient {
    /// `timeout` begrenzt Verbindungsaufbau und Warten auf den Antwortkopf, nicht den Körper:
    /// Ein langer KI-Stream darf länger laufen (Leerlauf-Grenzen setzt der Aufrufer).
    pub fn new(timeout: Duration) -> Self {
        let config = ureq::Agent::config_builder()
            .timeout_connect(Some(timeout))
            .timeout_recv_response(Some(timeout))
            // Statuscodes ≥ 400 sind normale Antworten, kein Transportfehler.
            .http_status_as_error(false)
            .build();
        UreqClient { agent: config.into() }
    }

    fn call(&self, req: &Request) -> Result<ureq::http::Response<ureq::Body>, NetError> {
        let mut builder = ureq::http::Request::builder().method(req.method.as_str()).uri(&req.url);
        for (k, v) in &req.headers {
            builder = builder.header(k, v);
        }
        let request = builder.body(req.body.clone()).map_err(|e| NetError::Other(e.to_string()))?;
        self.agent.run(request).map_err(map_err)
    }
}

impl Default for UreqClient {
    fn default() -> Self {
        Self::new(Duration::from_secs(60))
    }
}

fn map_err(e: ureq::Error) -> NetError {
    match e {
        ureq::Error::Timeout(_) => NetError::Timeout,
        ureq::Error::Io(e) => NetError::Connect(e.to_string()),
        ureq::Error::HostNotFound | ureq::Error::ConnectionFailed => NetError::Connect(e.to_string()),
        other => NetError::Other(other.to_string()),
    }
}

fn head(res: &ureq::http::Response<ureq::Body>) -> Response {
    let headers =
        res.headers().iter().map(|(k, v)| (k.as_str().to_owned(), v.to_str().unwrap_or("").to_owned())).collect();
    Response { status: res.status().as_u16(), headers, body: Vec::new() }
}

impl HttpClient for UreqClient {
    fn send(&self, req: &Request) -> Result<Response, NetError> {
        let mut res = self.call(req)?;
        let mut out = head(&res);
        out.body = res.body_mut().with_config().limit(u64::MAX).read_to_vec().map_err(map_err)?;
        Ok(out)
    }

    fn send_streaming(&self, req: &Request, on_chunk: &mut dyn FnMut(&[u8]) -> bool) -> Result<Response, NetError> {
        let mut res = self.call(req)?;
        let out = head(&res);
        let mut reader = res.body_mut().as_reader();
        let mut buf = [0u8; 8192];
        loop {
            let n = reader.read(&mut buf).map_err(|e| NetError::Connect(e.to_string()))?;
            if n == 0 {
                return Ok(out);
            }
            if !on_chunk(&buf[..n]) {
                return Err(NetError::Aborted);
            }
        }
    }
}

