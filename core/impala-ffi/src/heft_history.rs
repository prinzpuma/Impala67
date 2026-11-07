//! Verlauf eines Hefts (heft-storage.js `encodeDoc`, heft.js `restoreDoc`): Die App sichert Stände
//! lokal (bewusst nicht synchronisiert) und spielt einen davon als gewöhnliches `heftOps`-Event mit
//! dem Unterschied zum aktuellen Stand zurück – das synchronisiert von allein und ist umkehrbar.

use impala_heft::{HeftDoc, Shadow, diff_document};
use serde_json::{Value, json};

use crate::heft::{HeftPageData, page_data};
use crate::heft_items::HeftEdit;
use crate::{CoreError, ImpalaCore, invalid};

#[uniffi::export]
impl ImpalaCore {
    /// Aktueller Stand eines Hefts als `{ v: 2, pages }` (wie `encodeDoc` der PWA).
    pub fn heft_snapshot(&self, page_id: String) -> Result<String, CoreError> {
        let inner = self.lock();
        let doc = inner.heft(&page_id)?;
        serde_json::to_string(&json!({ "v": 2, "pages": doc.pages })).map_err(|e| invalid(e.to_string()))
    }

    /// Gesicherten Stand wiederherstellen: EIN Event mit dem Unterschied, dazu die Umkehr.
    pub fn heft_restore(&self, page_id: String, snapshot: String) -> Result<HeftEdit, CoreError> {
        let value: Value = serde_json::from_str(&snapshot).map_err(|e| invalid(format!("Stand: {e}")))?;
        let target = HeftDoc::from_value(value);
        if target.pages.is_empty() {
            return Err(invalid("Stand ohne Seiten"));
        }
        let mut inner = self.lock();
        let (ops, _) = diff_document(Some(&Shadow::of(inner.heft(&page_id)?)), &target);
        inner.heft_edit(&page_id, ops, Vec::new())
    }
}

/// Erste Seite eines gesicherten Stands (Vorschaubild im Verlauf); `None` bei leerem oder kaputtem Stand.
#[uniffi::export]
pub fn heft_snapshot_first_page(snapshot: String) -> Option<HeftPageData> {
    let value: Value = serde_json::from_str(&snapshot).ok()?;
    HeftDoc::from_value(value).pages.first().map(page_data)
}

#[cfg(test)]
mod tests {
    use crate::ImpalaCore;
    use crate::heft::HeftStroke;
    use crate::heft_items::HeftChange;

    #[test]
    fn stand_sichern_und_wiederherstellen() {
        let core = ImpalaCore::open_in_memory().unwrap();
        let heft = core.create_heft("Test".into(), None, None).unwrap();
        let page = core.heft_page_ids(heft.clone())[0].clone();
        let stroke = HeftStroke {
            id: "a".into(),
            tool: "pen".into(),
            color: "#000".into(),
            size: 3.0,
            points: vec![10.0, 10.0, 0.5, 60.0, 30.0, 0.5],
            shape: None,
        };
        core.heft_apply(heft.clone(), vec![HeftChange::AddStroke { page: page.clone(), stroke }]).unwrap();
        let snap = core.heft_snapshot(heft.clone()).unwrap();
        assert_eq!(super::heft_snapshot_first_page(snap.clone()).unwrap().strokes.len(), 1);

        // Danach: Strich weg, zweite Seite dazu.
        core.heft_remove_strokes(heft.clone(), page.clone(), vec!["a".into()]).unwrap();
        core.heft_add_page(heft.clone(), None, None).unwrap();
        assert_eq!(core.heft_page_ids(heft.clone()).len(), 2);

        let edit = core.heft_restore(heft.clone(), snap).unwrap();
        assert_eq!(core.heft_page_ids(heft.clone()), std::slice::from_ref(&page));
        assert_eq!(core.heft_page(heft.clone(), page.clone()).unwrap().strokes.len(), 1);

        // Die Umkehr bringt den Stand vor dem Wiederherstellen zurück.
        core.heft_apply_ops(heft.clone(), edit.undo).unwrap();
        assert_eq!(core.heft_page_ids(heft.clone()).len(), 2);
        assert!(core.heft_page(heft.clone(), page).unwrap().strokes.is_empty());
    }
}
