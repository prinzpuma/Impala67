//! Heft-Export: SVG einer Seite und PDF aus Seitenbildern. Die Plattform zeichnet die Seiten selbst
//! (Canvas, Core Graphics …) und liefert dem Kern nur die JPEGs; das PDF-Gerüst (A4, zentriert,
//! Byte für Byte wie in der PWA) baut der Kern.

use impala_heft::Image;
use impala_heft::export::{self, EXPORT_W, PdfPage};
use impala_heft::ink::{SvgOptions, page_svg};

use crate::{CoreError, ImpalaCore, invalid};

/// Ein gerendertes Seitenbild für [`heft_build_pdf`].
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HeftPdfPage {
    /// Farb-JPEG (RGB, kein Graustufen-JPEG).
    pub jpeg: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Pixelgröße einer Seite bei gegebener Breite.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct HeftRasterSize {
    pub width: u32,
    pub height: u32,
    /// Pixel je Seiteneinheit (Seitenkoordinaten × `scale` = Pixel).
    pub scale: f64,
}

/// Größe, in der die Plattform eine Seite für den Export rendern soll (`width`: `None` = 2480 px, 300 dpi auf A4).
#[uniffi::export]
pub fn heft_export_size(width: Option<u32>) -> HeftRasterSize {
    let (width, height, scale) = export::page_canvas_size(width.filter(|w| *w > 0).unwrap_or(EXPORT_W));
    HeftRasterSize { width, height, scale }
}

/// Dateiname für Exporte aus dem Heft-Titel (ohne Endung; verbotene Zeichen ersetzt, höchstens 80 Zeichen).
#[uniffi::export]
pub fn heft_export_file_name(title: Option<String>) -> String {
    export::export_file_name(title.as_deref())
}

/// PDF mit einer A4-Seite je Bild, in der gegebenen Reihenfolge.
#[uniffi::export]
pub fn heft_build_pdf(pages: Vec<HeftPdfPage>) -> Result<Vec<u8>, CoreError> {
    if pages.is_empty() || pages.iter().any(|p| p.jpeg.is_empty() || p.width == 0 || p.height == 0) {
        return Err(invalid("PDF: mindestens eine Seite, jede mit JPEG und Größe"));
    }
    let pages: Vec<PdfPage> =
        pages.iter().map(|p| PdfPage { jpeg: &p.jpeg, width: p.width, height: p.height }).collect();
    Ok(export::build_pdf(&pages))
}

#[uniffi::export]
impl ImpalaCore {
    /// Eine Heftseite als eigenständiges SVG (Papier, Bilder, Striche, Textfelder). `paper_ink` ist die
    /// Farbe des Papiermusters (CSS). Fehlende Bilddaten lädt der Kern nach; Textfelder brechen nur an
    /// Zeilenumbrüchen um (die Schriftmetrik kennt nur die Plattform).
    pub fn heft_page_svg(&self, page_id: String, heft_page_id: String, paper_ink: String) -> Result<String, CoreError> {
        let mut guard = self.lock();
        let inner = &mut *guard;
        let missing: Vec<String> = inner
            .heft_page(&page_id, &heft_page_id)?
            .images
            .iter()
            .filter_map(|i| i.r#ref.clone().filter(|r| !r.is_empty()))
            .filter(|r| !inner.model.state().hefte.blobs.contains_key(r))
            .collect();
        if !missing.is_empty() {
            inner.model.hydrate_heft_blobs(&inner.storage, Some(&missing))?;
        }
        let page = inner.heft_page(&page_id, &heft_page_id)?;
        let blobs = &inner.model.state().hefte.blobs;
        let href = |im: &Image| match im.r#ref.as_deref().filter(|r| !r.is_empty()) {
            Some(r) => blobs.get(r).cloned(),
            None => im.src.clone(),
        };
        Ok(page_svg(page, &SvgOptions { paper_ink: &paper_ink, image_href: &href }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::heft::HeftStroke;

    #[test]
    fn export_svg_pdf_name() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let heft = core.create_heft("Skizze".into(), None, None).unwrap();
        let page = core.heft_page_ids(heft.clone())[0].clone();
        let stroke = HeftStroke {
            id: "s".into(),
            tool: "pen".into(),
            color: "#123456".into(),
            size: 3.0,
            points: vec![10.0, 10.0, 0.5, 90.0, 40.0, 0.5, 150.0, 20.0, 0.5],
            shape: None,
        };
        core.heft_set_strokes(heft.clone(), page.clone(), vec![stroke]).unwrap();
        core.heft_add_text(heft.clone(), page.clone(), "Titel".into(), 40.0, 40.0, None, None, None).unwrap();
        core.heft_add_image(heft.clone(), page.clone(), vec![1, 2, 3], "image/png".into(), 0.0, 0.0, 20.0, 20.0)
            .unwrap();
        let svg = core.heft_page_svg(heft, page, "#888".into()).unwrap();
        assert!(svg.starts_with("<svg") && svg.contains("#123456") && svg.contains("Titel"));
        assert!(svg.contains("href=\"data:image/png;base64,AQID\""));

        let size = heft_export_size(None);
        assert_eq!((size.width, size.height), (2480, 3507));
        assert_eq!(heft_export_size(Some(1000)).height, 1414);
        assert_eq!(heft_export_file_name(Some("a/b:c".into())), "a_b_c");
        assert_eq!(heft_export_file_name(None), "Heft");

        let page = HeftPdfPage { jpeg: vec![0xff, 0xd8, 0xff, 0xd9], width: 100, height: 141 };
        let pdf = heft_build_pdf(vec![page.clone(), page]).unwrap();
        assert!(pdf.starts_with(b"%PDF-1.4") && pdf.ends_with(b"%%EOF"));
        assert!(String::from_utf8_lossy(&pdf).contains("/Count 2"));
        assert!(heft_build_pdf(vec![]).is_err());
    }
}
