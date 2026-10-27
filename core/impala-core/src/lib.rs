//! Impala67-Kern: reine, plattformneutrale Logik für PWA (WASM) und native Apps (UniFFI).
//! Jedes Fachgebiet ist ein eigenes Crate; diese Fassade bündelt sie unter einem Namen.

pub use impala_ai as ai;
pub use impala_crypto as crypto;
pub use impala_drive as drive;
pub use impala_heft as heft;
pub use impala_ink as ink;
pub use impala_markdown as markdown;
pub use impala_model as model;
pub use impala_net as net;
pub use impala_search as search;
pub use impala_srs as srs;
pub use impala_storage as storage;
pub use impala_sync as sync;
