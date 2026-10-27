//! Export-Geometrie und PDF-Hülle (`heft-export.js`; das Rendern selbst bleibt Canvas).

use crate::doc::{HeftDoc, PAGE_H, PAGE_W};
use crate::json::{js_is_space, js_round, js_to_fixed};

/// Exportbreite in Pixeln: 300 dpi auf A4.
pub const EXPORT_W: u32 = 2480;
/// A4 in PDF-Punkten.
pub const A4_W: f64 = 595.28;
pub const A4_H: f64 = 841.89;

/// Pixelgröße und Maßstab einer Seite bei gegebener Breite (`paintInto`: Höhe folgt A4).
pub fn page_canvas_size(width: u32) -> (u32, u32, f64) {
    let k = width as f64 / PAGE_W;
    (width, js_round(PAGE_H * k) as u32, k)
}

/// Lage eines Seitenbilds auf der A4-Seite: eingepasst und zentriert, `(w, h, x, y)` in Punkten.
pub fn pdf_image_box(px_w: u32, px_h: u32) -> (f64, f64, f64, f64) {
    let k = (A4_W / px_w as f64).min(A4_H / px_h as f64);
    let (w, h) = (px_w as f64 * k, px_h as f64 * k);
    (w, h, (A4_W - w) / 2.0, (A4_H - h) / 2.0)
}

/// Ein Seitenbild für [`build_pdf`]: JPEG-Daten und Pixelgröße.
pub struct PdfPage<'a> {
    pub jpeg: &'a [u8],
    pub width: u32,
    pub height: u32,
}

/// PDF 1.4 mit je einer A4-Seite pro JPEG (`buildPdf`), Byte für Byte wie JS.
pub fn build_pdf(pages: &[PdfPage]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let count = 3 + pages.len() * 3;
    let mut offsets = vec![0usize; count];
    out.extend_from_slice(b"%PDF-1.4\n");
    let page_obj = |i: usize| 3 + i * 3;
    let obj = |out: &mut Vec<u8>, offsets: &mut Vec<usize>, num: usize, body: &str| {
        offsets[num] = out.len();
        out.extend_from_slice(format!("{num} 0 obj\n{body}\nendobj\n").as_bytes());
    };
    obj(&mut out, &mut offsets, 1, "<< /Type /Catalog /Pages 2 0 R >>");
    let kids: Vec<String> = (0..pages.len()).map(|i| format!("{} 0 R", page_obj(i))).collect();
    obj(&mut out, &mut offsets, 2, &format!("<< /Type /Pages /Kids [{}] /Count {} >>", kids.join(" "), pages.len()));
    for (i, sh) in pages.iter().enumerate() {
        let (w, h, ox, oy) = pdf_image_box(sh.width, sh.height);
        let (img, cnt) = (4 + i * 3, 5 + i * 3);
        obj(
            &mut out,
            &mut offsets,
            page_obj(i),
            &format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im{i} {img} 0 R >> >> /Contents {cnt} 0 R >>"
            ),
        );
        offsets[img] = out.len();
        out.extend_from_slice(
            format!(
                "{img} 0 obj\n<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
                sh.width,
                sh.height,
                sh.jpeg.len()
            )
            .as_bytes(),
        );
        out.extend_from_slice(sh.jpeg);
        out.extend_from_slice(b"\nendstream\nendobj\n");
        let f = |v: f64| js_to_fixed(v, 2);
        let cs = format!("q {} 0 0 {} {} {} cm /Im{i} Do Q", f(w), f(h), f(ox), f(oy));
        obj(&mut out, &mut offsets, cnt, &format!("<< /Length {} >>\nstream\n{cs}\nendstream", cs.len()));
    }
    let xref_at = out.len();
    let mut xref = format!("xref\n0 {count}\n0000000000 65535 f \n");
    for off in offsets.iter().skip(1) {
        xref.push_str(&format!("{off:010} 00000 n \n"));
    }
    out.extend_from_slice(
        format!("{xref}trailer\n<< /Size {count} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF").as_bytes(),
    );
    out
}

/// Dateiname für den Export (`exportName`): verbotene Zeichen → `_`, getrimmt, höchstens
/// 80 UTF-16-Einheiten, sonst „Heft“.
///
/// Abweichung: JS kürzt mitten in einem Ersatzzeichenpaar (Emoji) und lässt dann eine halbe
/// Kodierung stehen; Rust kürzt davor.
pub fn export_file_name(title: Option<&str>) -> String {
    let title = title.filter(|t| !t.is_empty()).unwrap_or("Heft");
    let cleaned: String = title.chars().map(|c| if r#"\/:*?"<>|#"#.contains(c) { '_' } else { c }).collect();
    let trimmed = cleaned.trim_matches(js_is_space);
    let mut units = 0;
    let cut: String = trimmed
        .chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= 80
        })
        .collect();
    if cut.is_empty() { "Heft".to_owned() } else { cut }
}

/// Zu exportierende Seiten (`exportIdxs`): die gewählten, sonst alle.
pub fn export_indices(doc: &HeftDoc, chosen: &[usize]) -> Vec<usize> {
    if chosen.is_empty() { (0..doc.pages.len()).collect() } else { chosen.to_vec() }
}
