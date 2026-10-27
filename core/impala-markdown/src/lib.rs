//! Markdown ↔ Blöcke des Editors (Seiteninhalt `pg.content`) und reine Text-Auswertung
//! (Klartext, Vorschauen, Wiki-/Seitenlinks, Backlink-Regel).
//!
//! Maßstab ist web/editor-markdown.js: `serialize(parse(md))` ergibt dasselbe wie im JS
//! (Golden-Tests in `tests/`). HTML-Rendering bleibt in der PWA (`marked`).

mod block;
mod js;
mod mime;
mod parse;
mod serialize;
mod text;

pub use block::{Block, BlockKind, HeadingLevel, ListStyle};
pub use mime::mime_from_name;
pub use parse::parse;
pub use serialize::{serialize, serialize_block};
pub use text::{card_text, excerpt, first_line, links_to, page_link, plain_text, teaser, wiki_links};

/// Neu formatieren: `serialize(parse(md))` (Block-IDs sind dabei egal).
pub fn normalize(md: &str) -> String {
    serialize(&parse(md, &mut String::new))
}
