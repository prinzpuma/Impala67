//! Zufallsquelle für IVs, Schlüssel und Salze – austauschbar, damit Tests deterministisch sind.

use std::sync::atomic::{AtomicU8, Ordering};

use crate::CryptoError;

pub trait Random: Send + Sync {
    fn fill(&self, buf: &mut [u8]) -> Result<(), CryptoError>;
}

/// Kryptografischer Zufall des Betriebssystems (im Browser `crypto.getRandomValues`).
#[derive(Debug, Default, Clone, Copy)]
pub struct OsRandom;

impl Random for OsRandom {
    fn fill(&self, buf: &mut [u8]) -> Result<(), CryptoError> {
        getrandom::fill(buf).map_err(|e| CryptoError::Random(e.to_string()))
    }
}

/// Nur für Tests: zählt Byte für Byte hoch (0, 1, 2, …, 255, 0, …), ab `start`.
/// Die Golden-Generatoren ersetzen `crypto.getRandomValues` durch denselben Zähler.
#[derive(Debug, Default)]
pub struct CounterRandom(AtomicU8);

impl CounterRandom {
    pub fn new(start: u8) -> Self {
        CounterRandom(AtomicU8::new(start))
    }
}

impl Random for CounterRandom {
    fn fill(&self, buf: &mut [u8]) -> Result<(), CryptoError> {
        for b in buf {
            *b = self.0.fetch_add(1, Ordering::Relaxed);
        }
        Ok(())
    }
}
