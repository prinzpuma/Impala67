/**
 * Ein KI-Lauf (Agent, einfache Antwort oder Umformulieren) mit Abbruch (⏹).
 */
export class AiRun {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AiRunFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_airun_free(ptr, 0);
    }
    /**
     * Agent-Lauf. `input`: `{ settings, options, chat, workspace, ragHits, activePage, tools,
     * alwaysSendTools, customInstructions, embedModel, now, session }`; `on_event(ev)` mit
     * `{ type: "draft"|"thinking", text }`, `{ type: "tool", name }` oder `{ type: "item", item }`.
     * Ergebnis: `{ text, pageContext, session }`.
     * @param {any} input
     * @param {any} executor
     * @param {Function} on_event
     * @returns {Promise<any>}
     */
    agent(input, executor, on_event) {
        const ret = wasm.airun_agent(this.__wbg_ptr, addHeapObject(input), addHeapObject(executor), addHeapObject(on_event));
        return takeObject(ret);
    }
    cancel() {
        wasm.airun_cancel(this.__wbg_ptr);
    }
    /**
     * Einfache Antwort ohne Werkzeuge (`input`: `{ settings, options }`).
     * @param {any} input
     * @param {string} prompt
     * @param {string | null} [system]
     * @returns {Promise<any>}
     */
    complete(input, prompt, system) {
        const ptr0 = passStringToWasm0(prompt, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(system) ? 0 : passStringToWasm0(system, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.airun_complete(this.__wbg_ptr, addHeapObject(input), ptr0, len0, ptr1, len1);
        return takeObject(ret);
    }
    /**
     * `http`: `send(req)` → `{ status, headers, body }`, `open(req)` → `{ status, headers, read(), cancel() }`.
     * @param {any} http
     */
    constructor(http) {
        const ret = wasm.airun_new(addHeapObject(http));
        this.__wbg_ptr = ret;
        AiRunFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Antwort umformulieren: `history` (Nachrichten im API-Format), gestreamt an
     * `on_update({ type: "content"|"reasoning", text })`.
     * @param {any} input
     * @param {any} history
     * @param {string} instruction
     * @param {Function} on_update
     * @returns {Promise<any>}
     */
    refine(input, history, instruction, on_update) {
        const ptr0 = passStringToWasm0(instruction, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.airun_refine(this.__wbg_ptr, addHeapObject(input), addHeapObject(history), ptr0, len0, addHeapObject(on_update));
        return takeObject(ret);
    }
}
if (Symbol.dispose) AiRun.prototype[Symbol.dispose] = AiRun.prototype.free;

/**
 * Ein Gerät, ein Kern. Ein Durchgang zur Zeit (JS reiht alle Aufrufe ein).
 */
export class DriveCore {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DriveCoreFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_drivecore_free(ptr, 0);
    }
    /**
     * E-Mail des Kontos (nur Anzeige) oder `null`; wirft nur bei abgelehntem Token.
     * @returns {Promise<any>}
     */
    accountEmail() {
        const ret = wasm.drivecore_accountEmail(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Kurzweg beim Schließen: nur das eigene Änderungspaket hochladen. Liefert die Zahl der Events.
     * @param {boolean} allow_secrets
     * @returns {Promise<any>}
     */
    flushUpload(allow_secrets) {
        const ret = wasm.drivecore_flushUpload(this.__wbg_ptr, allow_secrets);
        return takeObject(ret);
    }
    /**
     * @param {any} http
     * @param {any} io
     */
    constructor(http, io) {
        const ret = wasm.drivecore_new(addHeapObject(http), addHeapObject(io));
        this.__wbg_ptr = ret;
        DriveCoreFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * `{ appBytes, usedBytes, limitBytes }` oder `null` ohne gültiges Token.
     * @returns {Promise<any>}
     */
    storageInfo() {
        const ret = wasm.drivecore_storageInfo(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Ein Durchgang. `mode`: `backup` (nur hochladen) oder `sync`, aus [`drive_mode`]; `restore`:
     * alles Fehlende holen („Aus Backup wiederherstellen“). `on_status(label)` meldet die Etappen
     * (darf `undefined` sein). Ergebnis: `{ imported, uploaded, conflicts, …, pulled, label }`.
     * @param {boolean} allow_secrets
     * @param {string} mode
     * @param {boolean} restore
     * @param {any} on_status
     * @returns {Promise<any>}
     */
    sync(allow_secrets, mode, restore, on_status) {
        const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.drivecore_sync(this.__wbg_ptr, allow_secrets, ptr0, len0, restore, addHeapObject(on_status));
        return takeObject(ret);
    }
}
if (Symbol.dispose) DriveCore.prototype[Symbol.dispose] = DriveCore.prototype.free;

/**
 * Ergebnis von [`heft_diff`]: Operationen und der Schatten des neuen Stands.
 */
export class HeftDiff {
    static __wrap(ptr) {
        const obj = Object.create(HeftDiff.prototype);
        obj.__wbg_ptr = ptr;
        HeftDiffFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        HeftDiffFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_heftdiff_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    get ops() {
        const ret = wasm.heftdiff_ops(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Den neuen Schatten übernehmen (nur einmal).
     * @returns {HeftShadow | undefined}
     */
    takeShadow() {
        const ret = wasm.heftdiff_takeShadow(this.__wbg_ptr);
        return ret === 0 ? undefined : HeftShadow.__wrap(ret);
    }
}
if (Symbol.dispose) HeftDiff.prototype[Symbol.dispose] = HeftDiff.prototype.free;

/**
 * Strich-Radierer einer Geste: kennt die Striche der Seite; jeder Aufruf entfernt die
 * getroffenen und liefert ihre Indizes in der aktuellen (schon verkürzten) Liste.
 */
export class HeftEraser {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        HeftEraserFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_hefteraser_free(ptr, 0);
    }
    /**
     * Radiert an (x, y): Indizes (in die Eingabe von `new`) der entfernten Striche.
     * @param {number} x
     * @param {number} y
     * @returns {Uint32Array}
     */
    eraseAt(x, y) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.hefteraser_eraseAt(retptr, this.__wbg_ptr, x, y);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export5(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Striche der Seite im Binärformat ([`unpack`]).
     * @param {Float64Array} coords
     * @param {Uint32Array} counts
     * @param {Float64Array} sizes
     * @param {Float64Array} bboxes
     * @param {string} shapes
     * @param {number} radius
     */
    constructor(coords, counts, sizes, bboxes, shapes, radius) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArrayF64ToWasm0(coords, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray32ToWasm0(counts, wasm.__wbindgen_export);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passArrayF64ToWasm0(sizes, wasm.__wbindgen_export);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passArrayF64ToWasm0(bboxes, wasm.__wbindgen_export);
            const len3 = WASM_VECTOR_LEN;
            const ptr4 = passStringToWasm0(shapes, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len4 = WASM_VECTOR_LEN;
            wasm.hefteraser_new(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, radius);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0;
            HeftEraserFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) HeftEraser.prototype[Symbol.dispose] = HeftEraser.prototype.free;

/**
 * Zuletzt veröffentlichter Stand eines Hefts (je Element nur eine Signatur).
 */
export class HeftShadow {
    static __wrap(ptr) {
        const obj = Object.create(HeftShadow.prototype);
        obj.__wbg_ptr = ptr;
        HeftShadowFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        HeftShadowFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_heftshadow_free(ptr, 0);
    }
    /**
     * Log-Operationen fortschreiben (gleiche Regeln wie der Reducer).
     * @param {any} ops
     */
    applyOps(ops) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.heftshadow_applyOps(retptr, this.__wbg_ptr, addBorrowedObject(ops));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            heap[stack_pointer++] = undefined;
        }
    }
    /**
     * Operationen, die diesen Stand in `doc` überführen.
     * @param {any} doc
     * @returns {HeftDiff}
     */
    diff(doc) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.heftshadow_diff(retptr, this.__wbg_ptr, addBorrowedObject(doc));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return HeftDiff.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            heap[stack_pointer++] = undefined;
        }
    }
    /**
     * Schatten eines Dokuments.
     * @param {any} doc
     * @returns {HeftShadow}
     */
    static of(doc) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.heftshadow_of(retptr, addBorrowedObject(doc));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return HeftShadow.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            heap[stack_pointer++] = undefined;
        }
    }
}
if (Symbol.dispose) HeftShadow.prototype[Symbol.dispose] = HeftShadow.prototype.free;

/**
 * Verschieben/Skalieren einer Auswahl während einer Geste: Die Ausgangsgeometrie bleibt im
 * Kern; jede Bewegung rechnet absolut von ihr aus und liefert die Geometrien aller Striche.
 */
export class HeftTransform {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        HeftTransformFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_hefttransform_free(ptr, 0);
    }
    /**
     * Geometrie aller Striche ([`pack_geometry`]) nach Verschieben um (dx, dy) (`moveStrokeFrom`).
     * @param {number} dx
     * @param {number} dy
     * @returns {any}
     */
    moveBy(dx, dy) {
        const ret = wasm.hefttransform_moveBy(this.__wbg_ptr, dx, dy);
        return takeObject(ret);
    }
    /**
     * Auswahl im Binärformat ([`unpack`]).
     * @param {Float64Array} coords
     * @param {Uint32Array} counts
     * @param {Float64Array} sizes
     * @param {Float64Array} bboxes
     * @param {string} shapes
     */
    constructor(coords, counts, sizes, bboxes, shapes) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArrayF64ToWasm0(coords, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray32ToWasm0(counts, wasm.__wbindgen_export);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passArrayF64ToWasm0(sizes, wasm.__wbindgen_export);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passArrayF64ToWasm0(bboxes, wasm.__wbindgen_export);
            const len3 = WASM_VECTOR_LEN;
            const ptr4 = passStringToWasm0(shapes, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len4 = WASM_VECTOR_LEN;
            wasm.hefttransform_new(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0;
            HeftTransformFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Nach Skalieren um den Anker (`scaleStrokeFrom`); die Dicke wächst mit.
     * @param {number} ax
     * @param {number} ay
     * @param {number} factor
     * @returns {any}
     */
    scaleBy(ax, ay, factor) {
        const ret = wasm.hefttransform_scaleBy(this.__wbg_ptr, ax, ay, factor);
        return takeObject(ret);
    }
}
if (Symbol.dispose) HeftTransform.prototype[Symbol.dispose] = HeftTransform.prototype.free;

/**
 * Erkenner mit (optionalem) großem Wörterbuch.
 */
export class InkEngine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        InkEngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_inkengine_free(ptr, 0);
    }
    /**
     * Wörter im Wörterbuch (0 ohne).
     * @returns {number}
     */
    get lexiconSize() {
        const ret = wasm.inkengine_lexiconSize(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * `lexicon`: Bytes von `handwriting-lexicon-de.txt` (UTF-8, ein Wort je Zeile). Ohne Angabe kein Wörterbuch.
     * @param {Uint8Array | null} [lexicon]
     */
    constructor(lexicon) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(lexicon) ? 0 : passArray8ToWasm0(lexicon, wasm.__wbindgen_export);
            var len0 = WASM_VECTOR_LEN;
            wasm.inkengine_new(retptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0;
            InkEngineFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Erkennt die Striche einer Seite (JSON). `known`: `{ Zeilenschlüssel: { text, confidence, status } }`
     * schon gelesener Zeilen; nur neue gehen durchs Modell. Ergebnis wie bisher:
     * `{ text, lines, lineCache, accounting: { total, recognized, uncertain, skipped, unassigned, balanced, groups } }`.
     * @param {string} strokes
     * @param {string} options
     * @param {string} known
     * @param {any} model
     * @returns {Promise<any>}
     */
    recognizePage(strokes, options, known, model) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(strokes, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(options, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(known, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len2 = WASM_VECTOR_LEN;
            wasm.inkengine_recognizePage(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, addHeapObject(model));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) InkEngine.prototype[Symbol.dispose] = InkEngine.prototype.free;

/**
 * Erfassungs-Zustandsmaschine (Tracker) für die PWA.
 */
export class LzSessionTracker {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        LzSessionTrackerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_lzsessiontracker_free(ptr, 0);
    }
    /**
     * @param {string} now_iso
     * @returns {any}
     */
    currentAsSession(now_iso) {
        const ptr0 = passStringToWasm0(now_iso, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.lzsessiontracker_currentAsSession(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * @returns {string | undefined}
     */
    get currentId() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.lzsessiontracker_currentId(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export5(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {number} now_ms
     * @param {string} now_iso
     * @returns {any}
     */
    finishSession(now_ms, now_iso) {
        const ptr0 = passStringToWasm0(now_iso, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.lzsessiontracker_finishSession(this.__wbg_ptr, now_ms, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * @returns {boolean}
     */
    get hasCurrent() {
        const ret = wasm.lzsessiontracker_hasCurrent(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get isActive() {
        const ret = wasm.lzsessiontracker_isActive(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} now_ms
     * @param {string} now_iso
     * @param {string} category
     * @param {string | null | undefined} source_id
     * @param {string | null | undefined} subject
     * @param {string | null | undefined} subject_source
     * @param {Function} uid_fn
     * @returns {any}
     */
    maybeSplitSegment(now_ms, now_iso, category, source_id, subject, subject_source, uid_fn) {
        try {
            const ptr0 = passStringToWasm0(now_iso, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(category, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            var ptr2 = isLikeNone(source_id) ? 0 : passStringToWasm0(source_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len2 = WASM_VECTOR_LEN;
            var ptr3 = isLikeNone(subject) ? 0 : passStringToWasm0(subject, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len3 = WASM_VECTOR_LEN;
            var ptr4 = isLikeNone(subject_source) ? 0 : passStringToWasm0(subject_source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len4 = WASM_VECTOR_LEN;
            const ret = wasm.lzsessiontracker_maybeSplitSegment(this.__wbg_ptr, now_ms, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, addBorrowedObject(uid_fn));
            return takeObject(ret);
        } finally {
            heap[stack_pointer++] = undefined;
        }
    }
    constructor() {
        const ret = wasm.lzsessiontracker_new();
        this.__wbg_ptr = ret;
        LzSessionTrackerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} now_ms
     * @param {string} now_iso
     * @param {string} category
     * @param {string | null | undefined} source_id
     * @param {string | null | undefined} subject
     * @param {string | null | undefined} subject_source
     * @param {Function} uid_fn
     * @returns {any}
     */
    openSegment(now_ms, now_iso, category, source_id, subject, subject_source, uid_fn) {
        try {
            const ptr0 = passStringToWasm0(now_iso, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(category, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            var ptr2 = isLikeNone(source_id) ? 0 : passStringToWasm0(source_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len2 = WASM_VECTOR_LEN;
            var ptr3 = isLikeNone(subject) ? 0 : passStringToWasm0(subject, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len3 = WASM_VECTOR_LEN;
            var ptr4 = isLikeNone(subject_source) ? 0 : passStringToWasm0(subject_source, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len4 = WASM_VECTOR_LEN;
            const ret = wasm.lzsessiontracker_openSegment(this.__wbg_ptr, now_ms, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, addBorrowedObject(uid_fn));
            return takeObject(ret);
        } finally {
            heap[stack_pointer++] = undefined;
        }
    }
    /**
     * @param {number} now_ms
     * @param {string} now_iso
     * @returns {any}
     */
    pauseSegment(now_ms, now_iso) {
        const ptr0 = passStringToWasm0(now_iso, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.lzsessiontracker_pauseSegment(this.__wbg_ptr, now_ms, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * @returns {number}
     */
    get pausedAtMs() {
        const ret = wasm.lzsessiontracker_pausedAtMs(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) LzSessionTracker.prototype[Symbol.dispose] = LzSessionTracker.prototype.free;

/**
 * Der Zustand der App samt Log-Anbindung (eine Instanz je Tab).
 */
export class ModelCore {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ModelCoreFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_modelcore_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    activeCards() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_activeCards(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string | null} [extra_name]
     * @returns {string}
     */
    activeDeckNames(extra_name) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(extra_name) ? 0 : passStringToWasm0(extra_name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            wasm.modelcore_activeDeckNames(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    activePages() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_activePages(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    allGrades() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_allGrades(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} id
     * @returns {string}
     */
    ancestorsOf(id) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_ancestorsOf(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Eigene, gespeicherte Änderung anwenden. Liefert, was sie berührt hat.
     * @param {string} event
     * @returns {string}
     */
    applyLocal(event) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(event, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_applyLocal(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Bereits gespeicherte Fremd-Events in Zeitreihenfolge anwenden. Liefert je angewandtem
     * Event `{ i, touched }` (Index in der Eingabe), in Anwendungsreihenfolge.
     * @param {string} events
     * @returns {string}
     */
    applyRemote(events) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(events, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_applyRemote(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    archivedCards() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_archivedCards(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    archivedDeckRoots() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_archivedDeckRoots(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    archivedPageRoots() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_archivedPageRoots(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    archivedPages() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_archivedPages(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} id
     * @returns {string}
     */
    backlinksOf(id) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_backlinksOf(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    baseSeq() {
        const ret = wasm.modelcore_baseSeq(this.__wbg_ptr);
        return ret;
    }
    /**
     * Welche Bilder JS aus dem Checkpoint lesen soll (`targets`: JSON-Liste oder `null` = alle).
     * @param {string} targets
     * @returns {string}
     */
    blobsToHydrate(targets) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(targets, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_blobsToHydrate(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * @param {string} root
     * @param {boolean} include_trashed
     * @returns {string}
     */
    cardsInDeckTree(root, include_trashed) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(root, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_cardsInDeckTree(retptr, this.__wbg_ptr, ptr0, len0, include_trashed);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @param {string} dirty
     */
    checkpointNotWritten(dirty) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(dirty, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_checkpointNotWritten(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Wie [`checkpoint_save`](Self::checkpoint_save), liefert aber direkt ein JS-Objekt ohne
     * zweites JSON-String-Escaping über den großen Checkpoint- und Teil-Texten.
     * @param {string} meta
     * @returns {any}
     */
    checkpointSaveJs(meta) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(meta, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_checkpointSaveJs(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Checkpoint berechnen: `{ info, after, blobHashes, heftHashes }` – `after` sind die Events
     * nach `baseSeq()` bis `info.maxSeq`, die Hashes die schon gespeicherten Teile. Liefert
     * `{ status, checkpoint?, blobs?, hefte? }`; bei `written` schreibt JS alles in einer Transaktion
     * und meldet einen Fehlschlag mit `checkpointNotWritten(Object.keys(blobs))`.
     * @param {string} meta
     * @returns {string}
     */
    checkpointSave(meta) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(meta, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_checkpointSave(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * @param {string | null} [id]
     * @returns {string}
     */
    childPagesOf(id) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(id) ? 0 : passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            wasm.modelcore_childPagesOf(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @param {string | null} [id]
     * @param {string | null} [workspace]
     * @param {string | null} [current]
     * @returns {string}
     */
    childWorkspace(id, workspace, current) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(id) ? 0 : passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(workspace) ? 0 : passStringToWasm0(workspace, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            var ptr2 = isLikeNone(current) ? 0 : passStringToWasm0(current, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len2 = WASM_VECTOR_LEN;
            wasm.modelcore_childWorkspace(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred4_0 = r0;
            deferred4_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Kinderlisten aller Knoten auf einmal: `[[Eltern-ID ("" = Wurzel), Workspace, [IDs]], …]`.
     * @returns {string}
     */
    childrenIndex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_childrenIndex(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string | null} [id]
     * @param {string | null} [workspace]
     * @param {string | null} [current]
     * @returns {string}
     */
    childrenOf(id, workspace, current) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(id) ? 0 : passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(workspace) ? 0 : passStringToWasm0(workspace, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            var ptr2 = isLikeNone(current) ? 0 : passStringToWasm0(current, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len2 = WASM_VECTOR_LEN;
            wasm.modelcore_childrenOf(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred4_0 = r0;
            deferred4_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Berechnet die Wochenziel-Prognose für gegebene Tage und Tempo.
     * @param {number} goal_min
     * @param {string} days_json
     * @param {number} today
     * @param {number} pace
     * @returns {any}
     */
    computeGoal(goal_min, days_json, today, pace) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(days_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_computeGoal(retptr, this.__wbg_ptr, goal_min, ptr0, len0, today, pace);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Gerettete Alt-Kopien früherer Konflikte (`resolved`: schon quittierte Kopien, JSON-Liste).
     * @param {string} resolved
     * @returns {string}
     */
    conflictLegacyItems(resolved) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(resolved, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_conflictLegacyItems(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Events einer Entscheidung: `{ events: [[type, payload], …] }` oder `{ error }`
     * (`copy-missing`, `loser-missing`; dann ist nichts zu tun).
     * @param {string} conflict
     * @param {string} action
     * @returns {string}
     */
    conflictResolve(conflict, action) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(conflict, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(action, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.modelcore_conflictResolve(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Fehlende Texte eines gespeicherten Konflikts aus dem Zustand ergänzen.
     * @param {string} conflict
     * @returns {string}
     */
    conflictWithTexts(conflict) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(conflict, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_conflictWithTexts(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * @param {string} deck
     * @returns {string}
     */
    deckConf(deck) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(deck, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_deckConf(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @param {string} collapsed_json
     * @param {number} now
     * @param {number} day_start
     * @param {number} day_end
     * @param {boolean} mix
     * @param {boolean} overlearn_lock
     * @returns {string}
     */
    deckTree(collapsed_json, now, day_start, day_end, mix, overlearn_lock) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(collapsed_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_deckTree(retptr, this.__wbg_ptr, ptr0, len0, now, day_start, day_end, mix, overlearn_lock);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * @param {string} today_label
     * @returns {string}
     */
    exportGradesMarkdown(today_label) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(today_label, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_exportGradesMarkdown(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    favoritePages() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_favoritePages(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} title
     * @param {boolean} include_archived
     * @returns {string | undefined}
     */
    findPage(title, include_archived) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(title, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_findPage(retptr, this.__wbg_ptr, ptr0, len0, include_archived);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v2;
            if (r0 !== 0) {
                v2 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export5(r0, r1 * 1, 1);
            }
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Von der Kompaktierung verworfene Bilder vergessen (JSON-Liste der Hashes).
     * @param {string} gone
     * @returns {number}
     */
    forgetHeftBlobs(gone) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(gone, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_forgetHeftBlobs(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {string} folder_id
     * @returns {number}
     */
    gnFolderDirectCount(folder_id) {
        const ptr0 = passStringToWasm0(folder_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.modelcore_gnFolderDirectCount(this.__wbg_ptr, ptr0, len0);
        return ret >>> 0;
    }
    /**
     * @returns {string}
     */
    gradesBySubject() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_gradesBySubject(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} hash
     * @returns {boolean}
     */
    hasHeftBlob(hash) {
        const ptr0 = passStringToWasm0(hash, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.modelcore_hasHeftBlob(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Operationen, die seitenfüllende Bilder älterer Importe zum Seitenhintergrund machen
     * (`null`, wenn nichts zu tun ist).
     * @param {string} page_id
     * @returns {string | undefined}
     */
    heftAdoptBackgroundOps(page_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(page_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_heftAdoptBackgroundOps(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v2;
            if (r0 !== 0) {
                v2 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export5(r0, r1 * 1, 1);
            }
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Bilddaten (dataURL), falls geladen.
     * @param {string} hash
     * @returns {string | undefined}
     */
    heftBlob(hash) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(hash, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_heftBlob(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v2;
            if (r0 !== 0) {
                v2 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export5(r0, r1 * 1, 1);
            }
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Ein ganzes Heft (`{ v, rev, pages }`).
     * @param {string} page_id
     * @returns {string | undefined}
     */
    heftDoc(page_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(page_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_heftDoc(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v2;
            if (r0 !== 0) {
                v2 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export5(r0, r1 * 1, 1);
            }
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Seiten-IDs aller Hefte mit Inhalt.
     * @returns {string}
     */
    heftIds() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_heftIds(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Bildreferenzen eines Hefts.
     * @param {string} page_id
     * @returns {string}
     */
    heftImageRefs(page_id) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(page_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_heftImageRefs(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Übersicht aller Hefte für den Handschrift-Index, ohne Punkte:
     * `[{ pageId, pages: [{ id, strokes, ocrText, images: [{ id, ref, scan, ocr, x, y, w, h }], bg }] }]`
     * (`strokes`: Anzahl; `ocr`: nur vorhanden, wenn das Bild schon erkannt ist).
     * @returns {string}
     */
    heftIndexSummary() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_heftIndexSummary(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Bildreferenzen aller Hefte (sortiert, ohne Doppelte): was die Kompaktierung behalten muss.
     * @returns {string}
     */
    heftLiveBlobs() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_heftLiveBlobs(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Kennzahlen (`{ rev, pages, ocrText, updated, bytes }`).
     * @param {string} page_id
     * @returns {string | undefined}
     */
    heftMeta(page_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(page_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_heftMeta(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v2;
            if (r0 !== 0) {
                v2 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export5(r0, r1 * 1, 1);
            }
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Eine Heftseite nach ihrer ID.
     * @param {string} page_id
     * @param {string} key
     * @returns {string | undefined}
     */
    heftPageById(page_id, key) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(page_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.modelcore_heftPageById(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v3;
            if (r0 !== 0) {
                v3 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export5(r0, r1 * 1, 1);
            }
            return v3;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * IDs der Heftseiten in Reihenfolge (`null` ohne Heft).
     * @param {string} page_id
     * @returns {string | undefined}
     */
    heftPageIds(page_id) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(page_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_heftPageIds(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v2;
            if (r0 !== 0) {
                v2 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export5(r0, r1 * 1, 1);
            }
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Eine Heftseite nach Position.
     * @param {string} page_id
     * @param {number} index
     * @returns {string | undefined}
     */
    heftPage(page_id, index) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(page_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_heftPage(retptr, this.__wbg_ptr, ptr0, len0, index);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v2;
            if (r0 !== 0) {
                v2 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export5(r0, r1 * 1, 1);
            }
            return v2;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Heft mit noch nicht gespeicherten Operationen (ändert nichts).
     * @param {string} page_id
     * @param {string} ops
     * @returns {string | undefined}
     */
    heftPreview(page_id, ops) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(page_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(ops, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.modelcore_heftPreview(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            if (r3) {
                throw takeObject(r2);
            }
            let v3;
            if (r0 !== 0) {
                v3 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export5(r0, r1 * 1, 1);
            }
            return v3;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Schatten des gespeicherten Hefts (Diff-Basis des Editors), direkt aus dem Kern.
     * @param {string} page_id
     * @returns {HeftShadow | undefined}
     */
    heftShadow(page_id) {
        const ptr0 = passStringToWasm0(page_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.modelcore_heftShadow(this.__wbg_ptr, ptr0, len0);
        return ret === 0 ? undefined : HeftShadow.__wrap(ret);
    }
    /**
     * Berechnet die Lernanalyse der Startseite:
     * Liefert `{ goal, subjects, time, forecast, headline, action, actionDeck }`
     * oder `null`, falls es noch gar keine Lerndaten gibt.
     * @param {number} now_ms
     * @param {number} goal_min
     * @param {string} days_json
     * @param {number} pace
     * @returns {any}
     */
    homeAnalysis(now_ms, goal_min, days_json, pace) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(days_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_homeAnalysis(retptr, this.__wbg_ptr, now_ms, goal_min, ptr0, len0, pace);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Gelesene Bilder übernehmen: `found` aus dem Checkpoint, `recovered` aus dem Log (beide `{ hash: data }`).
     * @param {string} targets
     * @param {string} found
     * @param {string} recovered
     */
    hydrateHeftBlobs(targets, found, recovered) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(targets, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(found, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(recovered, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len2 = WASM_VECTOR_LEN;
            wasm.modelcore_hydrateHeftBlobs(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Konflikt-Prüfung eines Imports. `fresh`: neue Fremd-Events; `local`: lokale Events nach
     * `unsyncedAfterSeq` (mehr braucht die Prüfung nicht); `history`: das ganze Log oder `null`.
     * `{ needHistory: true }`: mit dem ganzen Log erneut aufrufen. Sonst `{ added, conflicts, merged }`
     * (`added`: abgeleitete Events, die an `fresh` angehängt werden).
     * @param {string} fresh
     * @param {string} local
     * @param {number} unsynced_after_seq
     * @param {string | null | undefined} history
     * @param {Function} known
     * @param {Function} now
     * @returns {string}
     */
    importConflicts(fresh, local, unsynced_after_seq, history, known, now) {
        let deferred5_0;
        let deferred5_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(fresh, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(local, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            var ptr2 = isLikeNone(history) ? 0 : passStringToWasm0(history, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len2 = WASM_VECTOR_LEN;
            wasm.modelcore_importConflicts(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, unsynced_after_seq, ptr2, len2, addBorrowedObject(known), addBorrowedObject(now));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr4 = r0;
            var len4 = r1;
            if (r3) {
                ptr4 = 0; len4 = 0;
                throw takeObject(r2);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            heap[stack_pointer++] = undefined;
            heap[stack_pointer++] = undefined;
            wasm.__wbindgen_export5(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * @param {string} id
     * @returns {boolean}
     */
    isCardArchived(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.modelcore_isCardArchived(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @param {string} name
     * @returns {boolean}
     */
    isDeckArchived(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.modelcore_isDeckArchived(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @param {string} hash
     * @returns {boolean}
     */
    isHeftBlobLoaded(hash) {
        const ptr0 = passStringToWasm0(hash, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.modelcore_isHeftBlobLoaded(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @param {string} id
     * @returns {boolean}
     */
    isPageArchived(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.modelcore_isPageArchived(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Statistik-Kennzahlen (`anki-stats.js` `statsData`).
     * @param {string | null | undefined} deck
     * @param {number} now
     * @param {number | null} [think_ms]
     * @returns {string}
     */
    learningStats(deck, now, think_ms) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(deck) ? 0 : passStringToWasm0(deck, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            wasm.modelcore_learningStats(retptr, this.__wbg_ptr, ptr0, len0, now, !isLikeNone(think_ms), isLikeNone(think_ms) ? 0 : think_ms);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Patch für alte, lokal gespeicherte Zugangsdaten (`impala67.secrets`/`notion.secrets`), sonst `undefined`.
     * @param {string | null} [current]
     * @param {string | null} [older]
     * @returns {string | undefined}
     */
    legacySecretsPatch(current, older) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(current) ? 0 : passStringToWasm0(current, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(older) ? 0 : passStringToWasm0(older, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            wasm.modelcore_legacySecretsPatch(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v3;
            if (r0 !== 0) {
                v3 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export5(r0, r1 * 1, 1);
            }
            return v3;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {string} type_filter
     * @param {string} query
     * @returns {string}
     */
    libraryArchiveTree(type_filter, query) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(type_filter, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(query, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.modelcore_libraryArchiveTree(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred3_0 = r0;
            deferred3_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * @param {string | null | undefined} folder_id
     * @param {string} filter
     * @param {string} query
     * @returns {string}
     */
    libraryGnShelf(folder_id, filter, query) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(folder_id) ? 0 : passStringToWasm0(folder_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(filter, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(query, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len2 = WASM_VECTOR_LEN;
            wasm.modelcore_libraryGnShelf(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred4_0 = r0;
            deferred4_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * @param {string | null | undefined} smart
     * @param {string | null | undefined} tag
     * @param {string} query
     * @returns {string}
     */
    libraryNotionTree(smart, tag, query) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(smart) ? 0 : passStringToWasm0(smart, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(tag) ? 0 : passStringToWasm0(tag, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(query, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len2 = WASM_VECTOR_LEN;
            wasm.modelcore_libraryNotionTree(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred4_0 = r0;
            deferred4_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Start vorbereiten: `{ info, boundary }` (wie aus IndexedDB gelesen) und der Checkpoint als
     * JSON-Text. Er liegt als Text in IndexedDB: kein Objekt-Klonen beim Lesen, kein
     * `JSON.stringify` vor der Übergabe. Unlesbarer Text gilt als fehlender Checkpoint.
     * @param {string} meta
     * @param {string | null} [checkpoint]
     */
    loadBegin(meta, checkpoint) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(meta, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            var ptr1 = isLikeNone(checkpoint) ? 0 : passStringToWasm0(checkpoint, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            wasm.modelcore_loadBegin(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Events nachreichen (JSON-Liste, `seq`-Reihenfolge): `full` = Teil des ganzen Logs, sonst Rest nach dem Checkpoint.
     * @param {string} json
     * @param {boolean} full
     */
    loadEvents(json, full) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_loadEvents(retptr, this.__wbg_ptr, ptr0, len0, full);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Start ausführen. `{ needAll: true }`: das ganze Log nachreichen (`loadEvents(…, true)`) und
     * erneut aufrufen. Sonst der Bericht samt `clearCheckpoint` (Checkpoint verwerfen, Bilder behalten).
     * @param {string} now
     * @returns {string}
     */
    loadFinish(now) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(now, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_loadFinish(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Ein Heft des Checkpoints (JSON-Text unter seinem Hash).
     * @param {string} hash
     * @param {string} json
     */
    loadHeftDoc(hash, json) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(hash, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.modelcore_loadHeftDoc(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {number}
     */
    loadedSeq() {
        const ret = wasm.modelcore_loadedSeq(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {string}
     */
    loadedTime() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_loadedTime(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Eine eigene Änderung als Log-Event (vor dem Speichern).
     * @param {string} kind
     * @param {string} payload
     * @param {string} id
     * @param {string} now
     * @returns {string}
     */
    static localEvent(kind, payload, id, now) {
        let deferred6_0;
        let deferred6_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(payload, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passStringToWasm0(now, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len3 = WASM_VECTOR_LEN;
            wasm.modelcore_localEvent(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr5 = r0;
            var len5 = r1;
            if (r3) {
                ptr5 = 0; len5 = 0;
                throw takeObject(r2);
            }
            deferred6_0 = ptr5;
            deferred6_1 = len5;
            return getStringFromWasm0(ptr5, len5);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred6_0, deferred6_1, 1);
        }
    }
    /**
     * @param {string} local_json
     * @param {string} now
     * @returns {string}
     */
    mergedChatSessions(local_json, now) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(local_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(now, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.modelcore_mergedChatSessions(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred4_0, deferred4_1, 1);
        }
    }
    constructor() {
        const ret = wasm.modelcore_new();
        this.__wbg_ptr = ret;
        ModelCoreFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {string}
     */
    orphanArchivedCards() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_orphanArchivedCards(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    orphanTrashedCards() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_orphanTrashedCards(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string | null | undefined} page
     * @param {string} root
     * @returns {boolean}
     */
    pageInTree(page, root) {
        var ptr0 = isLikeNone(page) ? 0 : passStringToWasm0(page, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(root, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.modelcore_pageInTree(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret !== 0;
    }
    /**
     * @param {string} id
     * @returns {string}
     */
    pageSubtree(id) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_pageSubtree(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Alle Textfelder aller Seiten für die Blob-Prüfung des Syncs (`impala_sync::PageTexts`),
     * direkt aus dem Zustand statt über die Seiten-Ansichten und JSON.
     * @returns {string}
     */
    pageTexts() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_pageTexts(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * `[[titel, id], …]` – erste nicht gelöschte Seite je Titel.
     * @returns {string}
     */
    pagesByTitle() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_pagesByTitle(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Berechnet die Lernmuster für den Statistik-Tab:
     * `{ position, timer, hours, experiments, problems, empty }`.
     * @returns {any}
     */
    patternData() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_patternData(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Ein Feld eines Eintrags, das [`ModelCore::records`] auslässt (`content`).
     * @param {string} kind
     * @param {string} id
     * @param {string} key
     * @returns {any}
     */
    recordField(kind, id, key) {
        const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.modelcore_recordField(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        return takeObject(ret);
    }
    /**
     * Einträge einer Sammlung als `{ id: Eintrag }` (`ids`: JSON-Liste oder `null` = alle).
     * Seiten ohne `content`.
     * @param {string} kind
     * @param {string} ids
     * @returns {string}
     */
    records(kind, ids) {
        let deferred4_0;
        let deferred4_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(ids, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.modelcore_records(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr3 = r0;
            var len3 = r1;
            if (r3) {
                ptr3 = 0; len3 = 0;
                throw takeObject(r2);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * @param {string} keep
     * @returns {number}
     */
    releaseHeftBlobs(keep) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(keep, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_releaseHeftBlobs(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return r0 >>> 0;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * `false`, sobald ein verspätetes Fremd-Event mit neueren Events kollidiert ist: Der laufende
     * Zustand weicht dann vom sortierten Log ab, bis JS neu lädt.
     * @returns {boolean}
     */
    replayOrdered() {
        const ret = wasm.modelcore_replayOrdered(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Retention-Kennzahlen nach Wiederholungsabstand (`telemetrie.js` `retentionStatsForReviews`).
     * @param {string | null} [review_ids_json]
     * @returns {string}
     */
    retentionStats(review_ids_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(review_ids_json) ? 0 : passStringToWasm0(review_ids_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            wasm.modelcore_retentionStats(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
            var ptr2 = r0;
            var len2 = r1;
            if (r3) {
                ptr2 = 0; len2 = 0;
                throw takeObject(r2);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    reviews() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_reviews(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Seitensuche: `[{ id, score, terms, snippet }]`.
     * @param {string} query
     * @param {boolean} include_archived
     * @returns {string}
     */
    searchNotes(query, include_archived) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(query, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.modelcore_searchNotes(retptr, this.__wbg_ptr, ptr0, len0, include_archived);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Gerade offener Chat: sein Tab bleibt, auch bevor die Sitzung gespeichert ist.
     * @param {string | null} [id]
     */
    setCurrentChatId(id) {
        var ptr0 = isLikeNone(id) ? 0 : passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len0 = WASM_VECTOR_LEN;
        wasm.modelcore_setCurrentChatId(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @returns {string}
     */
    settings() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_settings(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} id
     * @returns {number}
     */
    sortKeyOf(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.modelcore_sortKeyOf(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Lernwarteschlange; Zeiten in ms seit 1970 (lokale Tagesgrenzen rechnet JS).
     * @param {string | null | undefined} deck
     * @param {number} now
     * @param {number} day_start
     * @param {number} day_end
     * @param {boolean} mix
     * @param {boolean} overlearn_lock
     * @returns {string}
     */
    studySnapshot(deck, now, day_start, day_end, mix, overlearn_lock) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(deck) ? 0 : passStringToWasm0(deck, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len0 = WASM_VECTOR_LEN;
            wasm.modelcore_studySnapshot(retptr, this.__wbg_ptr, ptr0, len0, now, day_start, day_end, mix, overlearn_lock);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * `{ tabs, activeTabId }` wie gespeichert.
     * @returns {string}
     */
    tabs() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_tabs(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    telemetry() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_telemetry(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Denkzeit-Median aus der Telemetrie (`telemetrie.js` `thinkMedian`).
     * @returns {number}
     */
    thinkMedian() {
        const ret = wasm.modelcore_thinkMedian(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {string}
     */
    trashedCards() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_trashedCards(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    trashedDeckRoots() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_trashedDeckRoots(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    trashedPages() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.modelcore_trashedPages(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) ModelCore.prototype[Symbol.dispose] = ModelCore.prototype.free;

/**
 * Hybrid-Suchindex (`rankRag`): Chunk-Vektoren, -Texte und Seitenangaben bleiben im Kern.
 */
export class RagIndex {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RagIndexFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ragindex_free(ptr, 0);
    }
    /**
     * `page_ids` und `texts` mit `\0` verbunden; `chunk_counts[i]` Chunks gehören zur Seite i,
     * ihre Vektoren stehen in dieser Reihenfolge zeilenweise in `matrix`.
     * @param {string} page_ids
     * @param {Uint32Array} chunk_counts
     * @param {string} texts
     * @param {Float32Array} matrix
     * @param {number} dim
     */
    constructor(page_ids, chunk_counts, texts, matrix, dim) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(page_ids, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray32ToWasm0(chunk_counts, wasm.__wbindgen_export);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(texts, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passArrayF32ToWasm0(matrix, wasm.__wbindgen_export);
            const len3 = WASM_VECTOR_LEN;
            wasm.ragindex_new(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, dim);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0;
            RagIndexFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Treffer wie `rankRag` als JSON-Array (`pageId`, `title`, `snippet`, `score`, …).
     * @param {string} query
     * @param {Float32Array} qv
     * @param {number} k
     * @returns {string}
     */
    rank(query, qv, k) {
        let deferred3_0;
        let deferred3_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(query, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArrayF32ToWasm0(qv, wasm.__wbindgen_export);
            const len1 = WASM_VECTOR_LEN;
            wasm.ragindex_rank(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1, k);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred3_0 = r0;
            deferred3_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Inhaltlich ähnliche Seiten (ohne Papierkorb/Archiv) als JSON-Array `[{ id, score }]`.
     * Braucht vorher [`RagIndex::set_pages`].
     * @param {string} page_id
     * @param {number} k
     * @returns {string}
     */
    related(page_id, k) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(page_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            wasm.ragindex_related(retptr, this.__wbg_ptr, ptr0, len0, k);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred2_0 = r0;
            deferred2_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Titel (mit `\0` verbunden) und Flags (Bit 0 Papierkorb, Bit 1 Archiv) je Seite in
     * Bau-Reihenfolge. Nur nach Änderungen an Seiten nötig, nicht je Anfrage.
     * @param {string} titles
     * @param {Uint8Array} flags
     */
    setPages(titles, flags) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(titles, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArray8ToWasm0(flags, wasm.__wbindgen_export);
            const len1 = WASM_VECTOR_LEN;
            wasm.ragindex_setPages(retptr, this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) RagIndex.prototype[Symbol.dispose] = RagIndex.prototype.free;

/**
 * Ein Konto: neue Zugangsdaten = neues `SyncCore`. Ein Durchgang zur Zeit (JS reiht ein).
 */
export class SyncCore {
    static __wrap(ptr) {
        const obj = Object.create(SyncCore.prototype);
        obj.__wbg_ptr = ptr;
        SyncCoreFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SyncCoreFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_synccore_free(ptr, 0);
    }
    /**
     * Cloud-Kompaktierung: abgleichen, Generationsschnitt, Neuaufbau.
     * @param {boolean} bypass_cooldown
     * @returns {Promise<any>}
     */
    compactCloud(bypass_cooldown) {
        const ret = wasm.synccore_compactCloud(this.__wbg_ptr, bypass_cooldown);
        return takeObject(ret);
    }
    /**
     * WebSocket-Nachricht → `{ action: "none" | "sync" | "rejected", forceAll?, message? }`.
     * Während eines Durchgangs wird der Zustand danach nachgezogen.
     * @param {string} text
     * @returns {Promise<any>}
     */
    handleServerMessage(text) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.synccore_handleServerMessage(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * Nach jedem lokalen Event: `true`, wenn ein Durchgang nötig ist.
     * @param {any} ev
     * @returns {boolean}
     */
    noteLocalEvent(ev) {
        const ret = wasm.synccore_noteLocalEvent(this.__wbg_ptr, addHeapObject(ev));
        return ret !== 0;
    }
    /**
     * Leitet den Schlüssel ab (PBKDF2), lädt den Sync-Zustand und liefert den Client.
     * `on_progress(label, current, total)` darf `undefined` sein.
     * @param {string} base_url
     * @param {string} sync_key
     * @param {string} client_id
     * @param {any} http
     * @param {any} store
     * @param {any} on_progress
     * @returns {Promise<SyncCore>}
     */
    static open(base_url, sync_key, client_id, http, store, on_progress) {
        const ptr0 = passStringToWasm0(base_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(sync_key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(client_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.synccore_open(ptr0, len0, ptr1, len1, ptr2, len2, addHeapObject(http), addHeapObject(store), addHeapObject(on_progress));
        return takeObject(ret);
    }
    /**
     * Löscht alle Pakete und Dateien auf dem Server (Generationsschnitt).
     * @returns {Promise<any>}
     */
    resetCloud() {
        const ret = wasm.synccore_resetCloud(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * `{ lastSyncedSeq, lastUploadedSeq, generation, usage }` – während eines Durchgangs `null`.
     * @returns {any}
     */
    state() {
        const ret = wasm.synccore_state(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Der laufende Durchgang endet an der nächsten Etappe (Fehler mit `code: "stopped"`).
     */
    stop() {
        wasm.synccore_stop(this.__wbg_ptr);
    }
    /**
     * Ein Durchgang (Abrufen → Dateien → Senden); volle Quota verdichtet die Cloud einmal.
     * @param {boolean} force_all
     * @returns {Promise<any>}
     */
    sync(force_all) {
        const ret = wasm.synccore_sync(this.__wbg_ptr, force_all);
        return takeObject(ret);
    }
    /**
     * @returns {string}
     */
    get wsAuthMessage() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.synccore_wsAuthMessage(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get wsUrl() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.synccore_wsUrl(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) SyncCore.prototype[Symbol.dispose] = SyncCore.prototype.free;

/**
 * Ergebnis von [`VectorIndex::top_k`].
 */
export class TopK {
    static __wrap(ptr) {
        const obj = Object.create(TopK.prototype);
        obj.__wbg_ptr = ptr;
        TopKFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TopKFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_topk_free(ptr, 0);
    }
    /**
     * @returns {Uint32Array}
     */
    get indices() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.topk_indices(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export5(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {Float32Array}
     */
    get scores() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.topk_scores(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayF32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export5(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) TopK.prototype[Symbol.dispose] = TopK.prototype.free;

/**
 * Flache Vektor-Matrix (`n × dim`) samt vorberechneten Zeilenbeträgen.
 */
export class VectorIndex {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        VectorIndexFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_vectorindex_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get length() {
        const ret = wasm.vectorindex_length(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Übernimmt die Matrix (ein Kopiervorgang aus dem `Float32Array`).
     * @param {Float32Array} matrix
     * @param {number} dim
     */
    constructor(matrix, dim) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArrayF32ToWasm0(matrix, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.vectorindex_new(retptr, ptr0, len0, dim);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0;
            VectorIndexFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Die `k` ähnlichsten Zeilen, absteigend (bei Gleichstand kleinere Zeile zuerst).
     * @param {Float32Array} query
     * @param {number} k
     * @returns {TopK}
     */
    topK(query, k) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArrayF32ToWasm0(query, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            wasm.vectorindex_topK(retptr, this.__wbg_ptr, ptr0, len0, k);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return TopK.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) VectorIndex.prototype[Symbol.dispose] = VectorIndex.prototype.free;

/**
 * Aktive Quelle samt Modell und Familie (Anzeige, Profiler): `{ providerId, base, model, family }`.
 * @param {any} settings
 * @returns {any}
 */
export function aiChatConfig(settings) {
    const ret = wasm.aiChatConfig(addHeapObject(settings));
    return takeObject(ret);
}

/**
 * Vektoren über `POST /embeddings` einer Cloud-Quelle (`provider`: `{ id, base, key }`).
 * @param {any} http
 * @param {any} provider
 * @param {string} model
 * @param {string[]} texts
 * @returns {Promise<any>}
 */
export function aiEmbedRemote(http, provider, model, texts) {
    const ptr0 = passStringToWasm0(model, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayJsValueToWasm0(texts, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.aiEmbedRemote(addHeapObject(http), addHeapObject(provider), ptr0, len0, ptr1, len1);
    return takeObject(ret);
}

/**
 * Modelle aller Quellen: `[{ id, providerId }]`.
 * @param {any} http
 * @param {any} providers
 * @param {string} sync_url
 * @returns {Promise<any>}
 */
export function aiListModels(http, providers, sync_url) {
    const ptr0 = passStringToWasm0(sync_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.aiListModels(addHeapObject(http), addHeapObject(providers), ptr0, len0);
    return takeObject(ret);
}

/**
 * Modell-Vorschläge der Einstellungen: `[{ value, label, provider }]`.
 * @returns {any}
 */
export function aiModelPresets() {
    const ret = wasm.aiModelPresets();
    return takeObject(ret);
}

/**
 * Argumente von `ask_choice` säubern: `{ question, options }` oder `{ error }`.
 * @param {any} args
 * @returns {any}
 */
export function aiNormalizeAskChoice(args) {
    const ret = wasm.aiNormalizeAskChoice(addHeapObject(args));
    return takeObject(ret);
}

/**
 * Verbindungstest einer Quelle: `{ ok, models, status, suggestedBase, error }`.
 * @param {any} http
 * @param {any} provider
 * @param {any} providers
 * @param {string} sync_url
 * @returns {Promise<any>}
 */
export function aiPingProvider(http, provider, providers, sync_url) {
    const ptr0 = passStringToWasm0(sync_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.aiPingProvider(addHeapObject(http), addHeapObject(provider), addHeapObject(providers), ptr0, len0);
    return takeObject(ret);
}

/**
 * Wann die automatische Notizsuche läuft: Suchtext oder `undefined`.
 * @param {string} text
 * @returns {string | undefined}
 */
export function aiRagQuery(text) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.aiRagQuery(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        let v2;
        if (r0 !== 0) {
            v2 = getStringFromWasm0(r0, r1);
            wasm.__wbindgen_export5(r0, r1 * 1, 1);
        }
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Dokumentierte Thinking-Stufen für Quelle und Modell (`settings` wie bei [`AiRun::agent`]).
 * @param {any} settings
 * @returns {any}
 */
export function aiThinkingCapabilities(settings) {
    const ret = wasm.aiThinkingCapabilities(addHeapObject(settings));
    return takeObject(ret);
}

/**
 * Eingebaute Werkzeug-Definitionen (`[{ type: "function", function }]`).
 * @returns {any}
 */
export function aiToolDefs() {
    const ret = wasm.aiToolDefs();
    return takeObject(ret);
}

/**
 * Zählt Duplikate innerhalb der Karten und gegenüber bestehenden Schlüsseln/Karten.
 * @param {any} cards
 * @param {any} existing
 * @returns {number}
 */
export function cardDuplicateCount(cards, existing) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.cardDuplicateCount(retptr, addBorrowedObject(cards), addBorrowedObject(existing));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return r0 >>> 0;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
        heap[stack_pointer++] = undefined;
    }
}

/**
 * CSV-Format schreiben (`impala67-karten.csv`).
 * @param {any} cards
 * @returns {string}
 */
export function cardExportCsv(cards) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.cardExportCsv(retptr, addBorrowedObject(cards));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr1 = r0;
        var len1 = r1;
        if (r3) {
            ptr1 = 0; len1 = 0;
            throw takeObject(r2);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Impala-TXT-Format schreiben (`impala67-karten.txt`).
 * @param {any} cards
 * @returns {string}
 */
export function cardExportTxt(cards) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.cardExportTxt(retptr, addBorrowedObject(cards));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr1 = r0;
        var len1 = r1;
        if (r3) {
            ptr1 = 0; len1 = 0;
            throw takeObject(r2);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Eindeutiger Kartenschlüssel für Duplikate.
 * @param {string} front
 * @param {string} back
 * @param {string} deck
 * @returns {string}
 */
export function cardKey(front, back, deck) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(front, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(back, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(deck, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        wasm.cardKey(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred4_0 = r0;
        deferred4_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Erkennt das Format automatisch (Impala-TXT vs. Tabelle/Anki) und parst Karten.
 * @param {string} text
 * @param {string} default_deck
 * @returns {any}
 */
export function cardParseCardText(text, default_deck) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(default_deck, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.cardParseCardText(ptr0, len0, ptr1, len1);
    return takeObject(ret);
}

/**
 * CSV/TSV-Datei mit Trennzeichen-Erkennung in Zeilen zerlegen.
 * @param {string} text
 * @returns {any}
 */
export function cardParseCsv(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.cardParseCsv(ptr0, len0);
    return takeObject(ret);
}

/**
 * Impala-TXT-Dateien einlesen.
 * @param {string} text
 * @param {string} default_deck
 * @returns {any}
 */
export function cardParseImpalaTxt(text, default_deck) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(default_deck, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.cardParseImpalaTxt(ptr0, len0, ptr1, len1);
    return takeObject(ret);
}

/**
 * Tabellarische Karten (CSV/TSV oder Anki-Text) einlesen.
 * @param {string} text
 * @param {string} default_deck
 * @returns {any}
 */
export function cardParseTableCards(text, default_deck) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(default_deck, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.cardParseTableCards(ptr0, len0, ptr1, len1);
    return takeObject(ret);
}

/**
 * HTML aus Anki-Feldern in Klartext/Markdown umwandeln.
 * @param {string} html
 * @returns {string}
 */
export function cardStripHtml(html) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(html, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.cardStripHtml(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * @param {string} pool_json
 * @param {string} recent_used_ids_json
 * @param {string} recent_focuses_json
 * @param {string} known_subjects_json
 * @returns {string}
 */
export function chooseArticleNotes(pool_json, recent_used_ids_json, recent_focuses_json, known_subjects_json) {
    let deferred6_0;
    let deferred6_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(pool_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(recent_used_ids_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(recent_focuses_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(known_subjects_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len3 = WASM_VECTOR_LEN;
        wasm.chooseArticleNotes(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr5 = r0;
        var len5 = r1;
        if (r3) {
            ptr5 = 0; len5 = 0;
            throw takeObject(r2);
        }
        deferred6_0 = ptr5;
        deferred6_1 = len5;
        return getStringFromWasm0(ptr5, len5);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred6_0, deferred6_1, 1);
    }
}

/**
 * Rückseite einer Karte: Lücke `idx` wird markiert, andere bleiben unmaskiert.
 * @param {string} text
 * @param {number} idx
 * @returns {string}
 */
export function clozeBack(text, idx) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.clozeBack(retptr, ptr0, len0, idx);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Vorderseite einer Karte: Lücke `idx` wird verdeckt, andere bleiben unmaskiert.
 * @param {string} text
 * @param {number} idx
 * @returns {string}
 */
export function clozeFront(text, idx) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.clozeFront(retptr, ptr0, len0, idx);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Wandelt `==Markierung==` in `{{cN::Markierung}}` um; `null`, wenn keine Markierung da ist.
 * @param {string} line
 * @returns {string | undefined}
 */
export function clozeHighlightsToCloze(line) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(line, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.clozeHighlightsToCloze(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        let v2;
        if (r0 !== 0) {
            v2 = getStringFromWasm0(r0, r1);
            wasm.__wbindgen_export5(r0, r1 * 1, 1);
        }
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Gefundene Lücken-Nummern aufsteigend ohne Doppelte.
 * @param {string} text
 * @returns {Uint32Array}
 */
export function clozeIndexes(text) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.clozeIndexes(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v2 = getArrayU32FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export5(r0, r1 * 4, 4);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Maskiert alle Lücken mit `＿＿＿` und liefert `{ question, answers }` oder `null`.
 * @param {string} front
 * @returns {any}
 */
export function clozeRecall(front) {
    const ptr0 = passStringToWasm0(front, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.clozeRecall(ptr0, len0);
    return takeObject(ret);
}

/**
 * Findet alle Zeilen eines Seiteninhalts, die als Lückentext taugen.
 * @param {string} content
 * @returns {string[]}
 */
export function clozeSourcesFromContent(content) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.clozeSourcesFromContent(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v2 = getArrayJsValueFromWasm0(r0, r1);
        wasm.__wbindgen_export5(r0, r1 * 4, 4);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Entfernt Zeilenpräfixe (`-`, `*`, `#`, `> `, Checkboxen).
 * @param {string} line
 * @returns {string}
 */
export function clozeStripLinePrefix(line) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(line, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.clozeStripLinePrefix(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Markierten Text in `{{cN::…}}` setzen; liefert `{ text, cursor }`.
 * @param {string} text
 * @param {number} u16_start
 * @param {number} u16_end
 * @returns {any}
 */
export function clozeWrap(text, u16_start, u16_end) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.clozeWrap(ptr0, len0, u16_start, u16_end);
    return takeObject(ret);
}

/**
 * Kompaktiert das Event-Log und liefert die Indizes der behaltenen Events in Log-Reihenfolge.
 * Die Events bleiben in JS; der Kern fragt nur die Felder ab, die die Regeln lesen.
 * Wirft, wenn ein Event eine Form hat, die nur die JS-Implementierung abdeckt.
 * `live` (Bilder, die ein Heft gerade zeigt) und `since` (Schonfrist, ISO-Zeit) zusammen: auch
 * Bilder ohne Heftseite fallen weg (`impala_sync::compact_with`); fehlt eins, gilt die alte Regel.
 * @param {Array<any>} events
 * @param {string[] | null} [live]
 * @param {string | null} [since]
 * @returns {Uint32Array}
 */
export function compactOrder(events, live, since) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        var ptr0 = isLikeNone(live) ? 0 : passArrayJsValueToWasm0(live, wasm.__wbindgen_export);
        var len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(since) ? 0 : passStringToWasm0(since, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        wasm.compactOrder(retptr, addHeapObject(events), ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v3 = getArrayU32FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export5(r0, r1 * 4, 4);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Berechnet Statistik-Kennzahlen aus übergebenen Karten, Reviews und Telemetrie (`statsData`).
 * @param {string} cards_json
 * @param {string} reviews_json
 * @param {string} telemetry_json
 * @param {string | null | undefined} deck
 * @param {number} now_ms
 * @param {number | null} [think_ms]
 * @returns {string}
 */
export function computeCardStats(cards_json, reviews_json, telemetry_json, deck, now_ms, think_ms) {
    let deferred6_0;
    let deferred6_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(cards_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(reviews_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(telemetry_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        var ptr3 = isLikeNone(deck) ? 0 : passStringToWasm0(deck, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len3 = WASM_VECTOR_LEN;
        wasm.computeCardStats(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, now_ms, !isLikeNone(think_ms), isLikeNone(think_ms) ? 0 : think_ms);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr5 = r0;
        var len5 = r1;
        if (r3) {
            ptr5 = 0; len5 = 0;
            throw takeObject(r2);
        }
        deferred6_0 = ptr5;
        deferred6_1 = len5;
        return getStringFromWasm0(ptr5, len5);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred6_0, deferred6_1, 1);
    }
}

/**
 * Freie Funktion zur Wochenziel-Berechnung ohne Modellinstanz.
 * @param {number} goal_min
 * @param {string} days_json
 * @param {number} today
 * @param {number} pace
 * @returns {any}
 */
export function computeGoalStandalone(goal_min, days_json, today, pace) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(days_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.computeGoalStandalone(retptr, goal_min, ptr0, len0, today, pace);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Zweispaltiger Vergleich zweier Fassungen: `[{ left, right, changed, start } | { gap }]`, `null`
 * bei zu großer abweichender Mitte.
 * @param {string} left
 * @param {string} right
 * @returns {string}
 */
export function conflictDiffRows(left, right) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(left, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(right, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.conflictDiffRows(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred3_0 = r0;
        deferred3_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Art, Titel, Zeit, Entscheidungen und Schlüssel eines Konflikts für den Dialog.
 * @param {string} conflict
 * @returns {string}
 */
export function conflictInfo(conflict) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(conflict, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.conflictInfo(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr2 = r0;
        var len2 = r1;
        if (r3) {
            ptr2 = 0; len2 = 0;
            throw takeObject(r2);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Titel ohne Konflikt-Präfixe und Zeitstempel.
 * @param {string} title
 * @returns {string}
 */
export function conflictTitle(title) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(title, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.conflictTitle(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Liegt der Stapel `deck` im Teilbaum `root` (`"Eltern::Kind"`)?
 * @param {string} deck
 * @param {string} root
 * @returns {boolean}
 */
export function deckInTree(deck, root) {
    const ptr0 = passStringToWasm0(deck, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(root, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.deckInTree(ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * Letzter Namensteil eines Stapels („Mathe::Analysis“ → „Analysis“).
 * @param {string} name
 * @returns {string}
 */
export function deckLabel(name) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.deckLabel(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Elternteil eines Stapels („Mathe::Analysis“ → "Mathe", "Mathe" → undefined/null).
 * @param {string} name
 * @returns {string | undefined}
 */
export function deckParent(name) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.deckParent(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        let v2;
        if (r0 !== 0) {
            v2 = getStringFromWasm0(r0, r1);
            wasm.__wbindgen_export5(r0, r1 * 1, 1);
        }
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @param {string} title
 * @param {string} id
 * @returns {string}
 */
export function defaultCover(title, id) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(title, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.defaultCover(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred3_0 = r0;
        deferred3_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Geltender Drive-Modus (`backup` | `sync`) aus `cfSyncKey` und `driveMode` der Einstellungen.
 * @param {string} cf_sync_key
 * @param {string} setting
 * @returns {string}
 */
export function driveMode(cf_sync_key, setting) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(cf_sync_key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(setting, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.driveMode(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred3_0 = r0;
        deferred3_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Darf „Sync“ gewählt werden? Nur ohne Cloudflare-Schlüssel.
 * @param {string} cf_sync_key
 * @returns {boolean}
 */
export function driveModeSelectable(cf_sync_key) {
    const ptr0 = passStringToWasm0(cf_sync_key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.driveModeSelectable(ptr0, len0);
    return ret !== 0;
}

/**
 * @param {string} key
 * @returns {string}
 */
export function folderTone(key) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.folderTone(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Speicheranzeige wie der Client sie meldet (für den Zustand vor dem ersten Abruf).
 * @param {number} bytes
 * @param {number | null} [limit]
 * @returns {any}
 */
export function formatStorageUsage(bytes, limit) {
    const ret = wasm.formatStorageUsage(bytes, !isLikeNone(limit), isLikeNone(limit) ? 0 : limit);
    return takeObject(ret);
}

/**
 * Neuer Sync-Schlüssel (`impala-xxxx-…`).
 * @returns {string}
 */
export function generateSyncKey() {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.generateSyncKey(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr1 = r0;
        var len1 = r1;
        if (r3) {
            ptr1 = 0; len1 = 0;
            throw takeObject(r2);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * @param {number} grade
 * @returns {number}
 */
export function gradeTier(grade) {
    const ret = wasm.gradeTier(grade);
    return ret;
}

/**
 * @param {string} list_json
 * @returns {number | undefined}
 */
export function gradesWeightedAverage(list_json) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-32);
        const ptr0 = passStringToWasm0(list_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.gradesWeightedAverage(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r2 = getDataViewMemory0().getFloat64(retptr + 8 * 1, true);
        var r4 = getDataViewMemory0().getInt32(retptr + 4 * 4, true);
        var r5 = getDataViewMemory0().getInt32(retptr + 4 * 5, true);
        if (r5) {
            throw takeObject(r4);
        }
        return r0 === 0 ? undefined : r2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(32);
    }
}

/**
 * Geometrie `{ pts, shape, size }` setzen und Grenzen neu rechnen (`applyStrokeGeometry`).
 * @param {any} geometry
 * @returns {any}
 */
export function heftApplyGeometry(geometry) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.heftApplyGeometry(retptr, addBorrowedObject(geometry));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Seite für ein Hintergrundbild von `w`×`h` Pixeln: `{ height, x, y, w, h }` (Seitenhöhe und Lage des
 * Bildes; die Seite übernimmt das Format des Bildes).
 * @param {number} w
 * @param {number} h
 * @returns {any}
 */
export function heftBackgroundFit(w, h) {
    const ret = wasm.heftBackgroundFit(w, h);
    return takeObject(ret);
}

/**
 * ID eines Bild-Blobs aus seinen Daten (Teil des gespeicherten Formats).
 * @param {string} data
 * @returns {string}
 */
export function heftBlobId(data) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(data, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.heftBlobId(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * PDF aus JPEG-Seitenbildern (A4, zentriert). `jpegs` hintereinander, `lengths`/`widths`/`heights` je Seite.
 * @param {Uint8Array} jpegs
 * @param {Uint32Array} lengths
 * @param {Uint32Array} widths
 * @param {Uint32Array} heights
 * @returns {Uint8Array}
 */
export function heftBuildPdf(jpegs, lengths, widths, heights) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArray8ToWasm0(jpegs, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(lengths, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(widths, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(heights, wasm.__wbindgen_export);
        const len3 = WASM_VECTOR_LEN;
        wasm.heftBuildPdf(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v5 = getArrayU8FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export5(r0, r1 * 1, 1);
        return v5;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @param {number} total
 * @param {number} selected
 * @returns {boolean}
 */
export function heftCanDeletePages(total, selected) {
    const ret = wasm.heftCanDeletePages(total, selected);
    return ret !== 0;
}

/**
 * Durchsuchbarer Seitentext: Stricherkennung, danach der Text aller Scan-Bilder.
 * @param {string} stroke_text
 * @param {any} page
 * @returns {string}
 */
export function heftComposePageText(stroke_text, page) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(stroke_text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.heftComposePageText(retptr, ptr0, len0, addBorrowedObject(page));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr2 = r0;
        var len2 = r1;
        if (r3) {
            ptr2 = 0; len2 = 0;
            throw takeObject(r2);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
        wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Operationen, die ein leeres Heft in `doc` überführen.
 * @param {any} doc
 * @returns {HeftDiff}
 */
export function heftDiffFromEmpty(doc) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.heftDiffFromEmpty(retptr, addBorrowedObject(doc));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return HeftDiff.__wrap(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Kopien der Striche, 28 Einheiten versetzt; `uid` liefert die neuen IDs.
 * @param {any} selection
 * @param {Function} uid
 * @returns {any}
 */
export function heftDuplicateStrokes(selection, uid) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.heftDuplicateStrokes(retptr, addBorrowedObject(selection), addBorrowedObject(uid));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Leere Heftseite.
 * @param {string} id
 * @param {string | null} [paper]
 * @returns {any}
 */
export function heftEmptyPage(id, paper) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(paper) ? 0 : passStringToWasm0(paper, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.heftEmptyPage(ptr0, len0, ptr1, len1);
    return takeObject(ret);
}

/**
 * Dateiname für Exporte aus dem Seitentitel.
 * @param {string | null} [title]
 * @returns {string}
 */
export function heftExportName(title) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        var ptr0 = isLikeNone(title) ? 0 : passStringToWasm0(title, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len0 = WASM_VECTOR_LEN;
        wasm.heftExportName(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Formerkennung (Linie, Pfeil, Dreieck, Rechteck, Ellipse) aus Stiftpunkten; `null` ohne Form.
 * @param {any} points
 * @returns {any}
 */
export function heftFitShape(points) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.heftFitShape(retptr, addBorrowedObject(points));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Oberstes Element unter dem Punkt (`hitBox`); `frames` flach `[x, y, w, h]` je Element
 * (`h` 0/NaN ⇒ 60). Index oder -1.
 * @param {Float64Array} frames
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function heftHitBox(frames, x, y) {
    const ptr0 = passArrayF64ToWasm0(frames, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.heftHitBox(ptr0, len0, x, y);
    return ret;
}

/**
 * Getroffener Eckgriff oder `null`.
 * @param {number} x
 * @param {number} y
 * @param {any} bounds
 * @param {number} hit_radius
 * @returns {any}
 */
export function heftHitLassoHandle(x, y, bounds, hit_radius) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.heftHitLassoHandle(retptr, x, y, addBorrowedObject(bounds), hit_radius);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Einfügeposition (`start`, `before`, `after`, sonst Ende).
 * @param {string} position
 * @param {number} current
 * @param {number} len
 * @returns {number}
 */
export function heftInsertAt(position, current, len) {
    const ptr0 = passStringToWasm0(position, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.heftInsertAt(ptr0, len0, current, len);
    return ret >>> 0;
}

/**
 * Liegt der Punkt im (um `tolerance` erweiterten) Auswahlrahmen?
 * @param {number} x
 * @param {number} y
 * @param {any} bounds
 * @param {number} tolerance
 * @returns {boolean}
 */
export function heftIsLassoBodyHit(x, y, bounds, tolerance) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.heftIsLassoBodyHit(retptr, x, y, addBorrowedObject(bounds), tolerance);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return r0 !== 0;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Gemeinsame Grenzen der Striche (Binärformat, [`unpack`]; ohne Rand), `null` ohne Punkte.
 * @param {Float64Array} coords
 * @param {Uint32Array} counts
 * @param {Float64Array} sizes
 * @param {Float64Array} bboxes
 * @param {string} shapes
 * @returns {any}
 */
export function heftLassoBounds(coords, counts, sizes, bboxes, shapes) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArrayF64ToWasm0(coords, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(counts, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(sizes, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayF64ToWasm0(bboxes, wasm.__wbindgen_export);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(shapes, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len4 = WASM_VECTOR_LEN;
        wasm.heftLassoBounds(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Die vier Eckgriffe `{ tl, tr, bl, br }` eines Auswahlrahmens.
 * @param {any} bounds
 * @returns {any}
 */
export function heftLassoHandles(bounds) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.heftLassoHandles(retptr, addBorrowedObject(bounds));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Was ein Fingertipp im Lasso-Modus bewirkt: `"interact"`, `"dismiss"` oder `"none"`.
 * @param {boolean} is_touch
 * @param {boolean} lasso_tool
 * @param {boolean} on_lasso
 * @returns {string}
 */
export function heftLassoTouchAction(is_touch, lasso_tool, on_lasso) {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.heftLassoTouchAction(retptr, is_touch, lasso_tool, on_lasso);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred1_0 = r0;
        deferred1_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Neue Seitenreihenfolge nach Verschieben von `from` nach `to` (Indizes), `undefined` wenn ungültig.
 * @param {number} len
 * @param {number} from
 * @param {number} to
 * @returns {Uint32Array | undefined}
 */
export function heftMovePage(len, from, to) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.heftMovePage(retptr, len, from, to);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        let v1;
        if (r0 !== 0) {
            v1 = getArrayU32FromWasm0(r0, r1).slice();
            wasm.__wbindgen_export5(r0, r1 * 4, 4);
        }
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * @param {number} px
 * @param {number} py
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @returns {boolean}
 */
export function heftNearPoint(px, py, x, y, radius) {
    const ret = wasm.heftNearPoint(px, py, x, y, radius);
    return ret !== 0;
}

/**
 * Braucht `page` eine (erneute) Erkennung durch Quelle `src` (`pwa`, `android`, `apple`)?
 * @param {any} page
 * @param {string} src
 * @returns {boolean}
 */
export function heftNeedsOcr(page, src) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(src, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.heftNeedsOcr(retptr, addBorrowedObject(page), ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return r0 !== 0;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Fingerabdruck der Striche und Scan-Texte einer Seite.
 * @param {any} page
 * @returns {string}
 */
export function heftOcrKey(page) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.heftOcrKey(retptr, addBorrowedObject(page));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr1 = r0;
        var len1 = r1;
        if (r3) {
            ptr1 = 0; len1 = 0;
            throw takeObject(r2);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * `ocr`-Operation für `page` (oder `null`, wenn veraltet/überflüssig/niedrigerer Rang).
 * @param {any} page
 * @param {string} stroke_text
 * @param {string} src
 * @param {string | null} [expected_key]
 * @returns {any}
 */
export function heftOcrOp(page, stroke_text, src, expected_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(stroke_text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(src, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(expected_key) ? 0 : passStringToWasm0(expected_key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len2 = WASM_VECTOR_LEN;
        wasm.heftOcrOp(retptr, addBorrowedObject(page), ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Punkt im Polygon (`poly` flach `[x, y, …]`).
 * @param {number} x
 * @param {number} y
 * @param {Float64Array} poly
 * @returns {boolean}
 */
export function heftPointInPolygon(x, y, poly) {
    const ptr0 = passArrayF64ToWasm0(poly, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.heftPointInPolygon(x, y, ptr0, len0);
    return ret !== 0;
}

/**
 * Indizes der vom Lasso (`poly` flach) umschlossenen Striche (Binärformat, [`unpack`]).
 * @param {Float64Array} coords
 * @param {Uint32Array} counts
 * @param {Float64Array} sizes
 * @param {Float64Array} bboxes
 * @param {string} shapes
 * @param {Float64Array} poly
 * @returns {Uint32Array}
 */
export function heftSelectByLasso(coords, counts, sizes, bboxes, shapes, poly) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passArrayF64ToWasm0(coords, wasm.__wbindgen_export);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(counts, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(sizes, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayF64ToWasm0(bboxes, wasm.__wbindgen_export);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(shapes, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passArrayF64ToWasm0(poly, wasm.__wbindgen_export);
        const len5 = WASM_VECTOR_LEN;
        wasm.heftSelectByLasso(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v7 = getArrayU32FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export5(r0, r1 * 4, 4);
        return v7;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Grenzen samt Rand (`strokeBounds`), `null` ohne Punkte und Form.
 * @param {any} s
 * @returns {any}
 */
export function heftStrokeBounds(s) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.heftStrokeBounds(retptr, addBorrowedObject(s));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Umriss (Punkte bzw. abgetastete Form) zum Zeichnen der Auswahl.
 * @param {any} s
 * @returns {any}
 */
export function heftStrokeOutline(s) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.heftStrokeOutline(retptr, addBorrowedObject(s));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Verschobene Geometrie `{ pts, shape, size, bbox }` (`translateStroke`).
 * @param {any} s
 * @param {number} dx
 * @param {number} dy
 * @returns {any}
 */
export function heftTranslate(s, dx, dy) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.heftTranslate(retptr, addBorrowedObject(s), dx, dy);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Editierabstand zweier Texte (Zeichenfehler der Erkennung).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function inkLevenshtein(a, b) {
    const ptr0 = passStringToWasm0(a, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(b, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.inkLevenshtein(ptr0, len0, ptr1, len1);
    return ret >>> 0;
}

/**
 * Lesereihenfolge der Striche einer (waagerechten) Zeile als Indizes.
 * @param {string} strokes
 * @returns {Uint32Array}
 */
export function inkOrderLineStrokes(strokes) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(strokes, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.inkOrderLineStrokes(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v2 = getArrayU32FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export5(r0, r1 * 4, 4);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Textzeilen einer Seite: je Zeile die Indizes ihrer Striche (JSON) in Lesereihenfolge.
 * @param {string} strokes
 * @returns {any}
 */
export function inkSegmentLines(strokes) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(strokes, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.inkSegmentLines(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Schaltet durch die Vorgaben 120, 300, 480, 720 min.
 * @param {number} current
 * @returns {number}
 */
export function lzCycleWeekGoal(current) {
    const ret = wasm.lzCycleWeekGoal(current);
    return ret >>> 0;
}

/**
 * Home-Hinweis als Enum-Objekt `{ kind: "...", ... }`.
 * @param {number} streak
 * @param {number} today_seconds
 * @param {number} week_seconds
 * @param {number} goal_min
 * @param {number} current_hour
 * @returns {any}
 */
export function lzHomeNudge(streak, today_seconds, week_seconds, goal_min, current_hour) {
    const ret = wasm.lzHomeNudge(streak, today_seconds, week_seconds, goal_min, current_hour);
    return takeObject(ret);
}

/**
 * Fertig formulierter deutscher Satz für die Begrüßung auf der Startseite.
 * @param {number} streak
 * @param {number} today_seconds
 * @param {number} week_seconds
 * @param {number} goal_min
 * @param {number} current_hour
 * @returns {string}
 */
export function lzHomeNudgeText(streak, today_seconds, week_seconds, goal_min, current_hour) {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.lzHomeNudgeText(retptr, streak, today_seconds, week_seconds, goal_min, current_hour);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred1_0 = r0;
        deferred1_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Intervall-Vereinigung: Vereinigt überlappende Zeitabschnitte (Wanduhrzeit).
 * @param {any} sessions
 * @returns {number}
 */
export function lzMergedSeconds(sessions) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.lzMergedSeconds(retptr, addBorrowedObject(sessions));
        var r0 = getDataViewMemory0().getFloat64(retptr + 8 * 0, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        return r0;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Wochenziel normalisieren (mindestens 30 min, Standard 300).
 * @param {number} stored
 * @returns {number}
 */
export function lzNormalizeWeekGoal(stored) {
    const ret = wasm.lzNormalizeWeekGoal(stored);
    return ret >>> 0;
}

/**
 * Aufeinanderfolgende Tage mit mindestens 5 Minuten Lernzeit.
 * @param {any} totals
 * @param {number} now_ms
 * @returns {number}
 */
export function lzStreakDays(totals, now_ms) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.lzStreakDays(retptr, addBorrowedObject(totals), now_ms);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return r0 >>> 0;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Gruppiert Sitzungen nach Kalendertag (lokal nach Beginn der Sitzung).
 * @param {any} sessions
 * @param {any} live
 * @returns {any}
 */
export function lzTotalsByDay(sessions, live) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.lzTotalsByDay(retptr, addBorrowedObject(sessions), addBorrowedObject(live));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Die 7 Tage der Woche (Mo–So) als Sekunden-Array.
 * @param {any} totals
 * @param {number} now_ms
 * @param {number} week_offset
 * @returns {any}
 */
export function lzWeekData(totals, now_ms, week_offset) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.lzWeekData(retptr, addBorrowedObject(totals), now_ms, week_offset);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Klartext einer Karte (Bilder/HTML raus, Formeln als „…“).
 * @param {string} md
 * @returns {string}
 */
export function mdCardText(md) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(md, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.mdCardText(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * @param {any} block
 * @param {string} new_id
 * @returns {any}
 */
export function mdContinuationBlock(block, new_id) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(new_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.mdContinuationBlock(retptr, addBorrowedObject(block), ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * @param {any} block
 * @param {string} target_type
 * @returns {any}
 */
export function mdConvertBlock(block, target_type) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(target_type, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.mdConvertBlock(retptr, addBorrowedObject(block), ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Bis zu 7 Vorschauzeilen einer Seite.
 * @param {string} title
 * @param {string} content
 * @returns {string[]}
 */
export function mdExcerpt(title, content) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(title, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(content, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.mdExcerpt(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v3 = getArrayJsValueFromWasm0(r0, r1);
        wasm.__wbindgen_export5(r0, r1 * 4, 4);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Erste Zeile ohne Überschrift und Markdown-Zeichen, höchstens 80 Zeichen.
 * @param {string} content
 * @returns {string}
 */
export function mdFirstLine(content) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.mdFirstLine(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * @param {any} block
 * @param {number} delta
 * @returns {any}
 */
export function mdIndentBlock(block, delta) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.mdIndentBlock(retptr, addBorrowedObject(block), delta);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * @param {any} blocks
 * @returns {any}
 */
export function mdListNumbers(blocks) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.mdListNumbers(retptr, addBorrowedObject(blocks));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * MIME-Typ aus Dateiname oder URL (`""` wenn unbekannt).
 * @param {string} name
 * @returns {string}
 */
export function mdMimeFromName(name) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.mdMimeFromName(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Markdown → Blöcke. `uid` liefert die Block-IDs (`U.uid`).
 * @param {string} md
 * @param {Function} uid
 * @returns {any}
 */
export function mdParse(md, uid) {
    try {
        const ptr0 = passStringToWasm0(md, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.mdParse(ptr0, len0, addBorrowedObject(uid));
        return takeObject(ret);
    } finally {
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Klartext eines Blocks.
 * @param {any} block
 * @returns {string}
 */
export function mdPlainText(block) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.mdPlainText(retptr, addBorrowedObject(block));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr1 = r0;
        var len1 = r1;
        if (r3) {
            ptr1 = 0; len1 = 0;
            throw takeObject(r2);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Blöcke → Markdown.
 * @param {any} blocks
 * @returns {string}
 */
export function mdSerialize(blocks) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.mdSerialize(retptr, addBorrowedObject(blocks));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr1 = r0;
        var len1 = r1;
        if (r3) {
            ptr1 = 0; len1 = 0;
            throw takeObject(r2);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Ein Block → Markdown (Zwischenablage).
 * @param {any} block
 * @returns {string}
 */
export function mdSerializeBlock(block) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.mdSerializeBlock(retptr, addBorrowedObject(block));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr1 = r0;
        var len1 = r1;
        if (r3) {
            ptr1 = 0; len1 = 0;
            throw takeObject(r2);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * @param {string} line
 * @returns {any}
 */
export function mdShortcutType(line) {
    const ptr0 = passStringToWasm0(line, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.mdShortcutType(ptr0, len0);
    return takeObject(ret);
}

/**
 * Erster Fließtext-Absatz, höchstens 180 Zeichen.
 * @param {string} body
 * @returns {string}
 */
export function mdTeaser(body) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.mdTeaser(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * @param {string} text
 * @param {number} start_utf16
 * @param {number} end_utf16
 * @param {string} before
 * @param {string} after
 * @returns {any}
 */
export function mdWrapMarkers(text, start_utf16, end_utf16, before, after) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(before, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(after, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.mdWrapMarkers(ptr0, len0, start_utf16, end_utf16, ptr1, len1, ptr2, len2);
    return takeObject(ret);
}

/**
 * Drei-Wege-Abgleich eines Textes: `{ ok: true, text }` oder `{ ok: false }`.
 * @param {string} base
 * @param {string} mine
 * @param {string} theirs
 * @returns {string}
 */
export function merge3(base, mine, theirs) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(base, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(mine, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(theirs, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len2 = WASM_VECTOR_LEN;
        wasm.merge3(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred4_0 = r0;
        deferred4_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred4_0, deferred4_1, 1);
    }
}

/**
 * @param {string} raw_json
 * @param {string} now
 * @returns {string | undefined}
 */
export function normalizeChatSession(raw_json, now) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(raw_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(now, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.normalizeChatSession(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        let v3;
        if (r0 !== 0) {
            v3 = getStringFromWasm0(r0, r1);
            wasm.__wbindgen_export5(r0, r1 * 1, 1);
        }
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Normalisiert Einstellungstext wie `normalize` in `settings-schema.js`.
 * @param {string} text
 * @returns {string}
 */
export function normalizeSettingsText(text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.normalizeSettingsText(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Seitenverlauf aus dem Log (`[{ t, title, content }]`).
 * @param {string} events
 * @param {string} id
 * @returns {string}
 */
export function pageHistory(events, id) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(events, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.pageHistory(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr3 = r0;
        var len3 = r1;
        if (r3) {
            ptr3 = 0; len3 = 0;
            throw takeObject(r2);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred4_0, deferred4_1, 1);
    }
}

/**
 * @param {string} topics_raw
 * @param {string} history_first_topics_json
 * @returns {string | undefined}
 */
export function pickArticleTopic(topics_raw, history_first_topics_json) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(topics_raw, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(history_first_topics_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.pickArticleTopic(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        let v3;
        if (r0 !== 0) {
            v3 = getStringFromWasm0(r0, r1);
            wasm.__wbindgen_export5(r0, r1 * 1, 1);
        }
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Abschnitte für die Einbettung (Überschriften beginnen neue, Nachbarn überlappen leicht).
 * @param {string} text
 * @returns {string[]}
 */
export function ragChunk(text) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.ragChunk(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v2 = getArrayJsValueFromWasm0(r0, r1);
        wasm.__wbindgen_export5(r0, r1 * 4, 4);
        return v2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Gesamttext einer Seite für [`rag_chunk`]: Titel, Inhalt, PDF-Volltexte und Handschrift.
 * `heft_pages`: JSON `[{ texts: [..], ocrText }]` (leer: kein Heft-Dokument geladen).
 * @param {string} title
 * @param {string} content
 * @param {string | null | undefined} pdf_text
 * @param {string[]} inline_pdf_texts
 * @param {string} heft_pages
 * @param {string | null} [heft_meta_ocr]
 * @returns {string}
 */
export function ragIndexText(title, content, pdf_text, inline_pdf_texts, heft_pages, heft_meta_ocr) {
    let deferred7_0;
    let deferred7_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(title, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(content, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(pdf_text) ? 0 : passStringToWasm0(pdf_text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayJsValueToWasm0(inline_pdf_texts, wasm.__wbindgen_export);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(heft_pages, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len4 = WASM_VECTOR_LEN;
        var ptr5 = isLikeNone(heft_meta_ocr) ? 0 : passStringToWasm0(heft_meta_ocr, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len5 = WASM_VECTOR_LEN;
        wasm.ragIndexText(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred7_0 = r0;
        deferred7_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred7_0, deferred7_1, 1);
    }
}

/**
 * Blob-Ids der im Inhalt eingebetteten Dateien (`:::file <id>`), ohne die Seiten-PDF.
 * @param {string} content
 * @param {string | null} [pdf_id]
 * @returns {string[]}
 */
export function ragInlineFileIds(content, pdf_id) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(pdf_id) ? 0 : passStringToWasm0(pdf_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        wasm.ragInlineFileIds(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v3 = getArrayJsValueFromWasm0(r0, r1);
        wasm.__wbindgen_export5(r0, r1 * 4, 4);
        return v3;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Ist die Datei eine PDF (MIME-Typ oder Endung)?
 * @param {string | null} [mime]
 * @param {string | null} [name]
 * @returns {boolean}
 */
export function ragIsPdf(mime, name) {
    var ptr0 = isLikeNone(mime) ? 0 : passStringToWasm0(mime, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(name) ? 0 : passStringToWasm0(name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.ragIsPdf(ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * Wartezeit vor dem n-ten WebSocket-Neuaufbau (Versuch ab 1, Zufall aus JS).
 * @param {number} attempt
 * @returns {number}
 */
export function reconnectDelayMs(attempt) {
    const ret = wasm.reconnectDelayMs(attempt);
    return ret;
}

/**
 * Filtert und begrenzt Chats (`[{ id, title, messages: [..] }]` als JSON) für das Befehls-Menü; liefert passende Chat-IDs als JSON-Array.
 * @param {string} chats_json
 * @param {string} query
 * @param {boolean} include_messages
 * @param {number} limit
 * @returns {string}
 */
export function searchChats(chats_json, query, include_messages, limit) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(chats_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(query, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.searchChats(retptr, ptr0, len0, ptr1, len1, include_messages, limit);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred3_0 = r0;
        deferred3_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Filtert Schnell-Aktionen (`[[id, label], …]` als JSON) nach `query`; liefert passende IDs als JSON-Array.
 * @param {string} actions_json
 * @param {string} query
 * @returns {string}
 */
export function searchFilterActions(actions_json, query) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(actions_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(query, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.searchFilterActions(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred3_0 = r0;
        deferred3_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Formatiert den Brotkrumen-Pfad einer Seite (`Workspace › Eltern › …`).
 * @param {string | null | undefined} workspace_name
 * @param {string[]} ancestor_titles
 * @returns {string}
 */
export function searchFormatPagePath(workspace_name, ancestor_titles) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        var ptr0 = isLikeNone(workspace_name) ? 0 : passStringToWasm0(workspace_name, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(ancestor_titles, wasm.__wbindgen_export);
        const len1 = WASM_VECTOR_LEN;
        wasm.searchFormatPagePath(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred3_0 = r0;
        deferred3_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Markierungsbereiche in UTF-16-Code-Units als flache Liste `[start0, end0, start1, end1, …]`.
 * @param {string} text
 * @param {string} query
 * @param {string[]} terms
 * @returns {Uint32Array}
 */
export function searchHighlightRanges(text, query, terms) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(query, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(terms, wasm.__wbindgen_export);
        const len2 = WASM_VECTOR_LEN;
        wasm.searchHighlightRanges(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var v4 = getArrayU32FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export5(r0, r1 * 4, 4);
        return v4;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Vorschau-Ausschnitt (`snippet.replace(/\s+/g, " ").trim().slice(0, 110)`).
 * @param {string} snippet
 * @returns {string}
 */
export function searchPreview(snippet) {
    let deferred2_0;
    let deferred2_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(snippet, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.searchPreview(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred2_0 = r0;
        deferred2_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Durchsucht den Standard-Einstellungskatalog (`platform`: `"web"`, `"native"`, oder leer für alle).
 * Liefert `[{ id, section, score }]` als JSON.
 * @param {string} query
 * @param {number} limit
 * @param {string | null} [platform]
 * @returns {string}
 */
export function searchSettingsCatalog(query, limit, platform) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(query, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(platform) ? 0 : passStringToWasm0(platform, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        wasm.searchSettingsCatalog(retptr, ptr0, len0, limit, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred3_0 = r0;
        deferred3_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Ist es Zeit für eine Cloud-Kompaktierung?
 * @param {boolean} connected
 * @param {number | null | undefined} usage_percent
 * @param {number} last_compacted_at_ms
 * @param {number} now_ms
 * @param {boolean} bypass_cooldown
 * @returns {boolean}
 */
export function shouldCompactCloud(connected, usage_percent, last_compacted_at_ms, now_ms, bypass_cooldown) {
    const ret = wasm.shouldCompactCloud(connected, !isLikeNone(usage_percent), isLikeNone(usage_percent) ? 0 : usage_percent, last_compacted_at_ms, now_ms, bypass_cooldown);
    return ret !== 0;
}

/**
 * @param {string} list_json
 * @returns {string}
 */
export function sortChatSessions(list_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(list_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.sortChatSessions(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr2 = r0;
        var len2 = r1;
        if (r3) {
            ptr2 = 0; len2 = 0;
            throw takeObject(r2);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Neue Karte, fällig ab `t` (ISO-Zeitpunkt des Events; unlesbar ⇒ jetzt).
 * @param {string} t
 * @returns {any}
 */
export function srsNewCard(t) {
    const ptr0 = passStringToWasm0(t, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.srsNewCard(ptr0, len0);
    return takeObject(ret);
}

/**
 * Intervall-Texte der vier Antwort-Knöpfe (Nochmal, Schwer, Gut, Einfach).
 * @param {any} card
 * @param {number} now_ms
 * @returns {string[]}
 */
export function srsPreview(card, now_ms) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.srsPreview(retptr, addBorrowedObject(card), now_ms);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        if (r3) {
            throw takeObject(r2);
        }
        var v1 = getArrayJsValueFromWasm0(r0, r1);
        wasm.__wbindgen_export5(r0, r1 * 4, 4);
        return v1;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Lernstand nach einer Bewertung (`grade` 1…4). `fuzz`: Zufallszahl in [0, 1) oder ohne Fuzz.
 * @param {any} card
 * @param {number} grade
 * @param {number} now_ms
 * @param {number | null} [fuzz]
 * @returns {any}
 */
export function srsRate(card, grade, now_ms, fuzz) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.srsRate(retptr, addBorrowedObject(card), grade, now_ms, !isLikeNone(fuzz), isLikeNone(fuzz) ? 0 : fuzz);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * Abrufwahrscheinlichkeit jetzt; `undefined` bei neuen oder unlesbaren Karten.
 * @param {any} card
 * @param {number} now_ms
 * @returns {number | undefined}
 */
export function srsRetrievability(card, now_ms) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.srsRetrievability(retptr, addBorrowedObject(card), now_ms);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r2 = getDataViewMemory0().getFloat64(retptr + 8 * 1, true);
        return r0 === 0 ? undefined : r2;
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        heap[stack_pointer++] = undefined;
    }
}

/**
 * `{ userId, authToken }` ohne PBKDF2 (KI-Anmeldung am Worker); wirft bei ungültigem Schlüssel.
 * @param {string} sync_key
 * @returns {any}
 */
export function syncAuth(sync_key) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(sync_key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.syncAuth(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Wartezeit vor dem n-ten HTTP-Wiederholversuch.
 * @param {number} attempt
 * @returns {number}
 */
export function syncRetryDelayMs(attempt) {
    const ret = wasm.syncRetryDelayMs(attempt);
    return ret;
}

/**
 * @returns {number}
 */
export function wsPingIntervalMs() {
    const ret = wasm.wsPingIntervalMs();
    return ret;
}

/**
 * @returns {string}
 */
export function wsPingMessage() {
    let deferred1_0;
    let deferred1_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.wsPingMessage(retptr);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        deferred1_0 = r0;
        deferred1_1 = r1;
        return getStringFromWasm0(r0, r1);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export5(deferred1_0, deferred1_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_30c8987f7c2ed4e2: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return addHeapObject(ret);
        },
        __wbg___wbindgen_is_falsy_16bd49b68658263e: function(arg0) {
            const ret = !getObject(arg0);
            return ret;
        },
        __wbg___wbindgen_is_function_1f9d30630b8b1d3d: function(arg0) {
            const ret = typeof(getObject(arg0)) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_e343b7d08827ba72: function(arg0) {
            const ret = getObject(arg0) === null;
            return ret;
        },
        __wbg___wbindgen_is_object_3c45d4f2dde4e749: function(arg0) {
            const val = getObject(arg0);
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_90b56bc79aad6f6c: function(arg0) {
            const ret = typeof(getObject(arg0)) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_8865fb403f8fe9d8: function(arg0) {
            const ret = getObject(arg0) === undefined;
            return ret;
        },
        __wbg___wbindgen_number_get_2e0e7dee9f701a71: function(arg0, arg1) {
            const obj = getObject(arg1);
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_0380ccaa2f57f0d9: function(arg0, arg1) {
            const obj = getObject(arg1);
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_dcc1a90847f04c41: function(arg0) {
            getObject(arg0)._wbg_cb_unref();
        },
        __wbg_apply_a910804df6e1e433: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = getObject(arg0).apply(getObject(arg1), getObject(arg2));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_call_1875a20c43a36133: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = getObject(arg0).call(getObject(arg1), getObject(arg2), getObject(arg3));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_call_187d372bd5fdd4aa: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_call_6137034ef55c9d0f: function() { return handleError(function (arg0, arg1) {
            const ret = getObject(arg0).call(getObject(arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_call_939a2607c4484b0b: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            const ret = getObject(arg0).call(getObject(arg1), getObject(arg2), getObject(arg3), getObject(arg4));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_from_296ca31f8d0f1c52: function(arg0) {
            const ret = Array.from(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_getRandomValues_a608c4436c19407a: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_getTimezoneOffset_2e851fdaecc2dc92: function(arg0) {
            const ret = getObject(arg0).getTimezoneOffset();
            return ret;
        },
        __wbg_get_1cb66d26171de5d7: function(arg0, arg1) {
            const ret = Reflect.get(getObject(arg0), getObject(arg1));
            return addHeapObject(ret);
        },
        __wbg_get_31af05bd4842a84f: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(getObject(arg0), getObject(arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_get_6c896e0571ddae51: function(arg0, arg1) {
            const ret = getObject(arg0)[arg1 >>> 0];
            return addHeapObject(ret);
        },
        __wbg_get_unchecked_288889d017702237: function(arg0, arg1) {
            const ret = getObject(arg0)[arg1 >>> 0];
            return addHeapObject(ret);
        },
        __wbg_instanceof_ArrayBuffer_a99f175873e5d9b8: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Error_80a725f81f2e102d: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof Error;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Promise_e1dc6893aa1ece28: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof Promise;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_828cef2aaacafc31: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_e15a2ff68ffdbef2: function(arg0) {
            const ret = Array.isArray(getObject(arg0));
            return ret;
        },
        __wbg_keys_440be172f17c0265: function(arg0) {
            const ret = Object.keys(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_length_58572db4c38f3c3e: function(arg0) {
            const ret = getObject(arg0).length;
            return ret;
        },
        __wbg_length_7f3c00c40364105e: function(arg0) {
            const ret = getObject(arg0).length;
            return ret;
        },
        __wbg_length_d4bdea10311bd9cf: function(arg0) {
            const ret = getObject(arg0).length;
            return ret;
        },
        __wbg_message_5f8387f0c32b90a7: function(arg0) {
            const ret = getObject(arg0).message;
            return addHeapObject(ret);
        },
        __wbg_new_1dbf7428bba60a42: function(arg0) {
            const ret = new Uint8Array(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_new_343a093a3c2ffb4e: function(arg0, arg1) {
            const ret = new Error(getStringFromWasm0(arg0, arg1));
            return addHeapObject(ret);
        },
        __wbg_new_34e56228080aa9f8: function(arg0) {
            const ret = new Date(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_new_5502aad30c185fc8: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return __wasm_bindgen_func_elem_4781(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return addHeapObject(ret);
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_617a8cdb8bb1130e: function() {
            const ret = new Object();
            return addHeapObject(ret);
        },
        __wbg_new_63c4c65d2534e5d3: function(arg0) {
            const ret = new Float32Array(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_new_ee2291f50781bf1d: function() {
            const ret = new Array();
            return addHeapObject(ret);
        },
        __wbg_new_from_slice_37a3c3a194266cb8: function(arg0, arg1) {
            const ret = new Uint32Array(getArrayU32FromWasm0(arg0, arg1));
            return addHeapObject(ret);
        },
        __wbg_new_from_slice_9a868026ffa4208a: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return addHeapObject(ret);
        },
        __wbg_new_from_slice_ca6ad97db1f4779a: function(arg0, arg1) {
            const ret = new Float32Array(getArrayF32FromWasm0(arg0, arg1));
            return addHeapObject(ret);
        },
        __wbg_new_from_slice_f545fd22ddc142b8: function(arg0, arg1) {
            const ret = new Float64Array(getArrayF64FromWasm0(arg0, arg1));
            return addHeapObject(ret);
        },
        __wbg_new_typed_b01cb72a8af741a3: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return __wasm_bindgen_func_elem_4781(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return addHeapObject(ret);
            } finally {
                state0.a = 0;
            }
        },
        __wbg_now_aa4ccb83129e9e55: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_of_20798cb14708764f: function(arg0, arg1) {
            const ret = Array.of(getObject(arg0), getObject(arg1));
            return addHeapObject(ret);
        },
        __wbg_of_d5dbecdc59e02e34: function(arg0) {
            const ret = Array.of(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_parse_0fc53dead14b3b42: function() { return handleError(function (arg0, arg1) {
            const ret = JSON.parse(getStringFromWasm0(arg0, arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_prototypesetcall_8b03c01e2c0f8066: function(arg0, arg1, arg2) {
            Float32Array.prototype.set.call(getArrayF32FromWasm0(arg0, arg1), getObject(arg2));
        },
        __wbg_prototypesetcall_bc27214492979395: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), getObject(arg2));
        },
        __wbg_push_2baf45db356cf468: function(arg0, arg1) {
            const ret = getObject(arg0).push(getObject(arg1));
            return ret;
        },
        __wbg_queueMicrotask_9833f9a49df95a49: function(arg0) {
            const ret = getObject(arg0).queueMicrotask;
            return addHeapObject(ret);
        },
        __wbg_queueMicrotask_a72f977e97f23c5f: function(arg0) {
            queueMicrotask(getObject(arg0));
        },
        __wbg_random_5a4cafd2f02395ff: function() {
            const ret = Math.random();
            return ret;
        },
        __wbg_resolve_0076e10020304ede: function(arg0) {
            const ret = Promise.resolve(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_set_145a351398b48c65: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(getObject(arg0), getObject(arg1), getObject(arg2));
            return ret;
        }, arguments); },
        __wbg_set_name_2c630595dc90a7aa: function(arg0, arg1, arg2) {
            getObject(arg0).name = getStringFromWasm0(arg1, arg2);
        },
        __wbg_static_accessor_GLOBAL_266715b9d96ba635: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_10fb7dc1ae063179: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_static_accessor_SELF_0b583911f537483a: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_static_accessor_WINDOW_d7f903d1508cbdc4: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_stringify_52ff602c1cc4fbb6: function() { return handleError(function (arg0) {
            const ret = JSON.stringify(getObject(arg0));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_synccore_new: function(arg0) {
            const ret = SyncCore.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_then_c949d5a25a4e78f8: function(arg0, arg1, arg2) {
            const ret = getObject(arg0).then(getObject(arg1), getObject(arg2));
            return addHeapObject(ret);
        },
        __wbg_then_e71170d78fcf8954: function(arg0, arg1) {
            const ret = getObject(arg0).then(getObject(arg1));
            return addHeapObject(ret);
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 202, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, __wasm_bindgen_func_elem_4725);
            return addHeapObject(ret);
        },
        __wbindgen_generic_0000000000000002: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return addHeapObject(ret);
        },
        __wbindgen_generic_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
        __wbindgen_object_clone_ref: function(arg0) {
            const ret = getObject(arg0);
            return addHeapObject(ret);
        },
        __wbindgen_object_drop_ref: function(arg0) {
            takeObject(arg0);
        },
    };
    return {
        __proto__: null,
        "./impala_core_bg.js": import0,
    };
}

function __wasm_bindgen_func_elem_4781(arg0, arg1, arg2, arg3) {
    wasm.__wasm_bindgen_func_elem_4781(arg0, arg1, addHeapObject(arg2), addHeapObject(arg3));
}

function __wasm_bindgen_func_elem_4725(arg0, arg1, arg2) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.__wasm_bindgen_func_elem_4725(retptr, arg0, arg1, addHeapObject(arg2));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

const AiRunFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_airun_free(ptr, 1));
const DriveCoreFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_drivecore_free(ptr, 1));
const HeftDiffFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_heftdiff_free(ptr, 1));
const HeftEraserFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_hefteraser_free(ptr, 1));
const HeftShadowFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_heftshadow_free(ptr, 1));
const HeftTransformFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_hefttransform_free(ptr, 1));
const InkEngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_inkengine_free(ptr, 1));
const LzSessionTrackerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_lzsessiontracker_free(ptr, 1));
const ModelCoreFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_modelcore_free(ptr, 1));
const RagIndexFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ragindex_free(ptr, 1));
const SyncCoreFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_synccore_free(ptr, 1));
const TopKFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_topk_free(ptr, 1));
const VectorIndexFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_vectorindex_free(ptr, 1));

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function addBorrowedObject(obj) {
    if (stack_pointer == 1) throw new Error('out of js stack');
    heap[--stack_pointer] = obj;
    return stack_pointer;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_export4(state.a, state.b));

function dropObject(idx) {
    if (idx < 1028) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(takeObject(mem.getUint32(i, true)));
    }
    return result;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        wasm.__wbindgen_export3(addHeapObject(e));
    }
}

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_export4(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    const mem = getDataViewMemory0();
    for (let i = 0; i < array.length; i++) {
        mem.setUint32(ptr + 4 * i, addHeapObject(array[i]), true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let stack_pointer = 1024;

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('impala_core_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
