//! MIME-Typ aus der Dateiendung (für URLs und Dateien ohne `file.type`), wie `mimeFromName`.

use crate::js::no_lt;

const MIME_EXT: &[(&str, &str)] = &[
    ("mp4", "video/mp4"),
    ("m4v", "video/mp4"),
    ("webm", "video/webm"),
    ("mov", "video/quicktime"),
    ("mkv", "video/x-matroska"),
    ("mp3", "audio/mpeg"),
    ("m4a", "audio/mp4"),
    ("wav", "audio/wav"),
    ("ogg", "audio/ogg"),
    ("oga", "audio/ogg"),
    ("opus", "audio/ogg"),
    ("flac", "audio/flac"),
    ("pdf", "application/pdf"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("svg", "image/svg+xml"),
    ("avif", "image/avif"),
];

/// Wie JS `/\.([a-z0-9]+)(?:[?#].*)?$/` auf dem kleingeschriebenen Namen: der erste Punkt, nach
/// dem nur noch Endung (+ optional `?…`/`#…`) folgt, entscheidet – unbekannte Endung ⇒ `None`.
pub fn mime_from_name(name: &str) -> Option<&'static str> {
    let lower = name.to_lowercase();
    let ext = lower.match_indices('.').find_map(|(k, _)| {
        let rest = &lower[k + 1..];
        let tail = rest.trim_start_matches(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit());
        let ext = &rest[..rest.len() - tail.len()];
        let ok = !ext.is_empty() && (tail.is_empty() || (tail.starts_with(['?', '#']) && no_lt(&tail[1..])));
        ok.then_some(ext)
    })?;
    MIME_EXT.iter().find(|(e, _)| *e == ext).map(|(_, m)| *m)
}
