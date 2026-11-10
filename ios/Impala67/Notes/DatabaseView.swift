import SwiftUI

/// Spalten für „Als Vorlesungsübersicht“ (`LECTURE_SCHEMA` in web/db-view.js); die erste Zahlenspalte ist die Laufnummer.
let lectureSchema: [DbColumn] = [
    DbColumn(name: "Thema", kind: "title"), DbColumn(name: "Nr", kind: "number"), DbColumn(name: "Datum", kind: "date"),
    DbColumn(name: "Schwierigkeit", kind: "select"), DbColumn(name: "Status", kind: "select"),
    DbColumn(name: "Klausurrelevanz", kind: "select"), DbColumn(name: "Themen", kind: "multi_select"),
    DbColumn(name: "Folien", kind: "text"),
]

private let readOnlyKinds: Set<String> = [
    "formula", "rollup", "created_time", "last_edited_time", "created_by", "last_edited_by",
    "people", "relation", "files", "button", "unique_id", "verification",
]
private let pillKinds: Set<String> = ["select", "status", "multi_select"]
private let wideKinds: Set<String> = ["text", "rich_text", "url", "email"]

// Bekannte Stufen bekommen eine sprechende Farbe, alles andere eine stabile aus dem Namen (db-view.js `tone`).
private let toneByValue: [String: String] = [
    "leicht": "green", "niedrig": "green", "gering": "green", "erledigt": "green", "fertig": "green",
    "done": "green", "zusammengefasst": "green", "bestanden": "green",
    "mittel": "yellow", "in arbeit": "yellow", "in bearbeitung": "yellow", "in progress": "yellow", "teilweise": "yellow",
    "schwer": "orange", "hoch": "orange", "wichtig": "orange",
    "sehr schwer": "red", "sehr hoch": "red", "offen": "red", "nicht begonnen": "gray", "not started": "gray",
]
private let tones = ["blue", "purple", "pink", "green", "orange", "yellow", "red", "gray"]

private func tone(_ v: String) -> String {
    if let known = toneByValue[v.lowercased()] { return known }
    // Wie `(h * 31 + ch.charCodeAt(0)) | 0` über die Zeichen der PWA – gleiche Farbe auf allen Geräten.
    var h: Int32 = 0
    for scalar in v.unicodeScalars { h = h &* 31 &+ Int32(String(scalar).utf16.first ?? 0) }
    return tones[Int(h.magnitude % UInt32(tones.count))]
}

private func pillValues(_ kind: String, _ v: String) -> [String] {
    (kind == "multi_select" ? v.components(separatedBy: ",") : [v])
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
}

private func isIsoDate(_ s: String) -> Bool { s.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil }

private let isoDay: DateFormatter = {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f
}()

/// Deutsches Datum wie `toLocaleDateString("de-DE", { day, month: "short", year })`.
private func deDate(_ iso: String) -> String {
    guard let d = isoDay.date(from: iso) else { return iso }
    return d.formatted(.dateTime.day().month(.abbreviated).year().locale(Locale(identifier: "de_DE")))
}

private struct DbRow: Identifiable {
    let page: PageSummary
    let props: [String: String]
    var id: String { page.id }
}

private struct DbData {
    let workspaceId: String
    let number: DbColumn?
    let columns: [DbColumn]
    let rows: [DbRow]

    static func read(_ core: ImpalaCore, _ pageId: String) -> DbData? {
        guard let schema = core.pageDb(id: pageId), let page = core.page(id: pageId) else { return nil }
        let all = schema.filter { $0.kind != "title" }
        let number = all.first { $0.kind == "number" }
        let ws = page.summary.workspaceId
        let rows = core.childrenOf(parentId: pageId, workspaceId: ws).map { DbRow(page: $0, props: core.pageProps(id: $0.id)) }
        return DbData(workspaceId: ws, number: number, columns: all.filter { $0 != number }, rows: rows)
    }
}

/// Datenbank-Seite (`dbViewHtml` in web/db-view.js, `DatabaseView.kt`): die Unterseiten als Karten mit
/// ihren Eigenschaften, darüber die Anzahl, darunter „Neue Zeile“. Karten und Bedienelemente in Liquid
/// Glass; jede Änderung ist ein `pageUpdate` der Zeile über den Kern.
struct DatabaseView: View {
    @Environment(ImpalaStore.self) private var store
    let pageId: String
    @State private var data: DbData?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let db = data {
                content(db)
            }
        }
        // Zellwerte, neue Zeilen und Titel sind Seiten-Metadaten; Tippen im Notiztext lädt nicht neu.
        .task(id: "\(pageId):\(store.pageMetaRevision)") {
            let core = store.core
            let id = pageId
            let next = await Task.detached(priority: .userInitiated) { DbData.read(core, id) }.value
            if !Task.isCancelled { data = next }
        }
    }

    /// Vorschläge je Auswahl-Spalte: alle bereits benutzten Werte (`datalist`).
    private func suggestions(_ db: DbData) -> [String: [String]] {
        var out: [String: [String]] = [:]
        for col in db.columns where col.kind == "select" || col.kind == "status" {
            out[col.name] = db.rows.compactMap { r -> String? in
                let v = r.props[col.name]?.trimmingCharacters(in: .whitespaces) ?? ""
                return v.isEmpty ? nil : v
            }.uniqued()
        }
        return out
    }

    @ViewBuilder
    private func content(_ db: DbData) -> some View {
        let options = suggestions(db)
        GlassEffectContainer(spacing: Space.s2) {
            HStack(spacing: Space.s2) {
                Text(db.rows.count == 1 ? "1 Eintrag" : "\(db.rows.count) Einträge")
                    .font(.system(size: TextSize.sm, weight: .medium))
                    .foregroundStyle(Impala.text2)
                    .padding(.horizontal, Space.s3).padding(.vertical, 6)
                    .impalaGlass()
                Spacer(minLength: 0)
                Button { addRow(db) } label: {
                    HStack(spacing: 6) {
                        Icon("plus", size: 14)
                        Text("Neue Zeile").font(.system(size: TextSize.sm, weight: .semibold))
                    }
                    .foregroundStyle(Impala.accent)
                    .padding(.horizontal, Space.s3).padding(.vertical, 6)
                    .impalaGlass(in: Capsule(), tint: Impala.accent.opacity(0.25), interactive: true)
                }
                .pressable()
                .accessibilityLabel("Neue Zeile anlegen")
            }
        }
        ForEach(Array(db.rows.enumerated()), id: \.element.id) { index, row in
            DbItem(row: row, db: db, suggestions: options)
                .riseIn(min(index, 8))
        }
        if db.rows.isEmpty {
            Text("Noch keine Einträge – „Neue Zeile“ legt eine Unterseite an.")
                .font(.system(size: TextSize.sm))
                .foregroundStyle(Impala.text2)
                .padding(.horizontal, Space.s1)
        }
    }

    private func addRow(_ db: DbData) {
        if AppHaptics.isEnabled { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
        _ = attempt("createPage", { try store.core.createPage(title: "Neue Zeile", content: "", parentId: pageId, workspaceId: db.workspaceId) })
    }
}

/// Eine Karte: „#Nr“, Icon und Titel (öffnet die Unterseite), darunter die Eigenschaften im
/// umbrechenden Raster wie `.db-props`.
private struct DbItem: View {
    @Environment(ShellModel.self) private var shell
    let row: DbRow
    let db: DbData
    let suggestions: [String: [String]]

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
        VStack(alignment: .leading, spacing: Space.s1) {
            Button { shell.open(row.page.id) } label: {
                HStack(spacing: Space.s2) {
                    let no = db.number.flatMap { row.props[$0.name]?.trimmingCharacters(in: .whitespaces) } ?? ""
                    if !no.isEmpty {
                        Text("#\(no)")
                            .font(.system(size: TextSize.xs, weight: .bold).monospacedDigit())
                            .foregroundStyle(Impala.accent)
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .impalaGlass(in: Capsule(), tint: Impala.accent.opacity(0.18))
                    }
                    PageIcon(page: row.page, size: 17)
                    Text(PageStyle.title(row.page))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Impala.text)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, Space.s2).padding(.vertical, 2)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityLabel("\(PageStyle.title(row.page)) öffnen")

            if !db.columns.isEmpty {
                SpanGrid(minCell: 124) {
                    ForEach(db.columns, id: \.name) { col in
                        DbField(rowId: row.page.id, col: col, raw: row.props[col.name] ?? "", suggestions: suggestions[col.name] ?? [])
                            .layoutValue(key: SpanKey.self, value: col.kind == "multi_select" ? Int.max : wideKinds.contains(col.kind) ? 2 : 1)
                    }
                }
            }
        }
        .padding(.horizontal, Space.s2).padding(.top, 10).padding(.bottom, Space.s2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .impalaGlass(in: shape)
    }
}

/// Ein Feld: Name klein darüber, Wert darunter. Auswahl-Spalten öffnen ein Menü mit den benutzten
/// Werten, Datum einen Kalender, alles andere wird zum Eingabefeld (fertig mit Enter oder Fokusverlust).
private struct DbField: View {
    @Environment(ImpalaStore.self) private var store
    let rowId: String
    let col: DbColumn
    let raw: String
    let suggestions: [String]
    @State private var editing = false
    @State private var text = ""
    @State private var picking = false
    @State private var day = Date()
    @FocusState private var focused: Bool

    private var readOnly: Bool { readOnlyKinds.contains(col.kind) }
    // Nur echte ISO-Tage als Datumsfeld; Bereiche/Freitext bleiben Text, sonst gingen sie verloren.
    private var isDate: Bool { col.kind == "date" && (raw.isEmpty || isIsoDate(raw)) }
    private var isSelect: Bool { col.kind == "select" || col.kind == "status" }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(col.name)
                .font(.system(size: 11))
                .foregroundStyle(Impala.text2)
                .lineLimit(1)
                .padding(.horizontal, 6)
            value
                .frame(maxWidth: .infinity, minHeight: 30, alignment: .leading)
        }
        .padding(.horizontal, 3).padding(.vertical, 2)
    }

    @ViewBuilder
    private var value: some View {
        if readOnly {
            DbShow(kind: col.kind, raw: raw, readOnly: true).padding(.horizontal, 6)
        } else if editing {
            TextField("", text: $text)
                .font(.system(size: TextSize.base))
                .foregroundStyle(Impala.text)
                .keyboardType(keyboard)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focused)
                .submitLabel(.done)
                .onSubmit(finish)
                .onChange(of: focused) { _, now in if !now { finish() } }
                .onAppear { focused = true }
                .padding(.horizontal, 8).padding(.vertical, 5)
                .impalaGlass(in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous), tint: Impala.accent.opacity(0.12))
        } else if isDate {
            Button {
                day = isoDay.date(from: raw) ?? Date()
                picking = true
            } label: { tappable }
            .buttonStyle(.plain)
            .popover(isPresented: $picking) { datePicker }
        } else if isSelect {
            Menu {
                ForEach(suggestions, id: \.self) { v in
                    Button(v) { set(v) }
                }
                if !suggestions.isEmpty { Divider() }
                Button { startEditing() } label: { Label("Eigener Wert…", systemImage: "pencil") }
                if !raw.isEmpty {
                    Button(role: .destructive) { set("") } label: { Label("Leeren", systemImage: "xmark") }
                }
            } label: { tappable }
            .buttonStyle(.plain)
        } else {
            Button(action: startEditing) { tappable }
                .buttonStyle(.plain)
        }
    }

    private var tappable: some View {
        DbShow(kind: col.kind, raw: raw, readOnly: false)
            .padding(.horizontal, 6).padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
            .hoverEffect(.highlight)
    }

    private var datePicker: some View {
        VStack(spacing: Space.s3) {
            DatePicker(col.name, selection: $day, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .environment(\.locale, Locale(identifier: "de_DE"))
                .labelsHidden()
            HStack {
                Button(raw.isEmpty ? "Abbrechen" : "Leeren", role: raw.isEmpty ? .cancel : .destructive) {
                    picking = false
                    if !raw.isEmpty { set("") }
                }
                Spacer()
                Button("Übernehmen") {
                    picking = false
                    set(isoDay.string(from: day))
                }
                .buttonStyle(.glassProminent)
            }
        }
        .padding(Space.s4)
        .frame(width: 340)
        .presentationCompactAdaptation(.popover)
    }

    private var keyboard: UIKeyboardType {
        switch col.kind {
        case "number": .decimalPad
        case "url": .URL
        case "email": .emailAddress
        default: .default
        }
    }

    private func startEditing() {
        text = raw
        editing = true
    }

    private func finish() {
        guard editing else { return }
        editing = false
        if text != raw { set(text) }
    }

    private func set(_ value: String) {
        _ = attempt("setPageProp", { try store.core.setPageProp(id: rowId, name: col.name, value: value) })
    }
}

/// Anzeige eines Werts: Pillen, deutsches Datum oder Text; leer „–“ (`showHtml`).
private struct DbShow: View {
    let kind: String
    let raw: String
    let readOnly: Bool

    var body: some View {
        if raw.isEmpty {
            Text("–").font(.system(size: TextSize.base)).foregroundStyle(Impala.text2.opacity(0.45))
        } else if pillKinds.contains(kind) {
            SpanGrid(minCell: 0, spacing: 4) {
                ForEach(pillValues(kind, raw), id: \.self) { v in
                    // Mehrfachauswahl (Themen o. Ä.) bleibt neutral grau – Farbe nur, wo sie eine Stufe bedeutet.
                    let c = noteColor(kind == "multi_select" ? "gray" : tone(v))
                    Text(v)
                        .font(.system(size: TextSize.xs, weight: .semibold))
                        .foregroundStyle(c)
                        .lineLimit(1)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .impalaGlass(in: Capsule(), tint: c.opacity(kind == "multi_select" ? 0.12 : 0.28))
                }
            }
        } else if kind == "date", isIsoDate(raw) {
            Text(deDate(raw)).font(.system(size: TextSize.base)).foregroundStyle(Impala.text)
        } else {
            Text(raw).font(.system(size: TextSize.base)).foregroundStyle(readOnly ? Impala.text2 : Impala.text)
        }
    }
}

/// Wie viele Rasterspalten ein Feld belegt (`Int.max` = ganze Zeile).
private struct SpanKey: LayoutValueKey {
    static let defaultValue = 1
}

/// Umbrechendes Raster wie `.db-props` (Mindestbreite je Spalte, breite Felder über zwei Spalten,
/// Mehrfachauswahl über die ganze Zeile). Mit `minCell: 0` ein einfacher Zeilenumbruch nach Eigenbreite
/// (für Pillen).
private struct SpanGrid: Layout {
    var minCell: CGFloat
    var spacing: CGFloat = 0

    private struct Placed {
        let index: Int
        let origin: CGPoint
        let size: CGSize
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 600
        let placed = place(width: width, subviews: subviews)
        let height = placed.map { $0.origin.y + $0.size.height }.max() ?? 0
        let used = minCell > 0 ? width : min(width, placed.map { $0.origin.x + $0.size.width }.max() ?? 0)
        return CGSize(width: used, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for p in place(width: bounds.width, subviews: subviews) {
            subviews[p.index].place(at: CGPoint(x: bounds.minX + p.origin.x, y: bounds.minY + p.origin.y),
                                    proposal: ProposedViewSize(p.size))
        }
    }

    private func place(width: CGFloat, subviews: Subviews) -> [Placed] {
        var out: [Placed] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        let cols = minCell > 0 ? max(1, Int(width / minCell)) : 0
        let cell = cols > 0 ? width / CGFloat(cols) : 0
        for (i, view) in subviews.enumerated() {
            let w: CGFloat
            if cols > 0 {
                w = cell * CGFloat(min(view[SpanKey.self], cols))
            } else {
                w = min(view.sizeThatFits(.unspecified).width, width)
            }
            if x > 0, x + w > width + 0.5 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            let h = view.sizeThatFits(ProposedViewSize(width: w, height: nil)).height
            out.append(Placed(index: i, origin: CGPoint(x: x, y: y), size: CGSize(width: w, height: h)))
            x += w + (cols > 0 ? 0 : spacing)
            rowHeight = max(rowHeight, h)
        }
        return out
    }
}

private extension Array where Element == String {
    func uniqued() -> [String] {
        var seen = Set<String>()
        return filter { seen.insert($0).inserted }
    }
}
