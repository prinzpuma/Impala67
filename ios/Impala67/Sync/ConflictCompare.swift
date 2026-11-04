import SwiftUI

/// Gegenüberstellung eines Konflikts (`compareHtml` in conflict-ui.js, wie `ConflictCompare.kt`):
/// zeilengenauer Vergleich (Kern: `conflictDiffRows`) bei geänderten Seiten, eine Spalte bei gelöschten
/// oder geretteten Kopien.
struct ConflictCompare: View {
    let c: ConflictInfo
    let copyText: String
    @State private var showCopy = false

    var body: some View {
        switch c.kind {
        case .legacy: legacy
        case .delete:
            CompareShell {
                Note("Das Löschen gewinnt beim Zusammenführen. Der geänderte Stand ist hier gerettet.")
            } content: {
                Pane(label: "Geänderter Stand", time: c.changedAt, text: copyText, accent: Impala.danger)
            }
        case .both: both
        }
    }

    @ViewBuilder
    private var legacy: some View {
        let single = Pane(label: ConflictText.copyLabel, time: c.time, text: copyText, accent: Impala.success)
        if c.recommended == .keepWinner {
            // `details.cf-more`: bei sicher verwerfbaren Kopien eingeklappt.
            VStack(alignment: .leading, spacing: Space.s2) {
                Button(showCopy ? "Inhalt der Kopie ausblenden" : "Inhalt der Kopie ansehen") {
                    withAnimation(.smooth) { showCopy.toggle() }
                }
                .font(.system(size: TextSize.sm))
                if showCopy {
                    CompareShell(bar: nil) { single }.transition(.opacity.combined(with: .scale(scale: 0.98, anchor: .top)))
                }
            }
        } else if c.pageId != nil, let rows = conflictDiffRows(left: c.remoteContent ?? "", right: copyText) {
            DiffCompare(rows: rows, leftLabel: ConflictText.currentLabel, leftTime: c.remoteTime,
                        rightLabel: ConflictText.copyLabel, rightTime: c.time,
                        legend: [("− nur in der aktuellen Seite", Impala.danger), ("+ nur in der Kopie", Impala.success)])
        } else {
            CompareShell(bar: nil) { single }
        }
    }

    @ViewBuilder
    private var both: some View {
        let left = c.localContent ?? ""
        let right = c.remoteContent ?? ""
        if left.isEmpty && right.isEmpty {
            Note("Die Änderung betrifft nur den Seitenstatus, nicht den Text.").padding(Space.s3)
        } else if let rows = conflictDiffRows(left: left, right: right) {
            DiffCompare(rows: rows, leftLabel: ConflictText.here, leftTime: c.localTime,
                        rightLabel: ConflictText.other, rightTime: c.remoteTime,
                        legend: [("− nur auf diesem Gerät", Impala.danger), ("+ nur auf Drive / anderem Gerät", Impala.success)])
        } else {
            CompareShell {
                Note("Sehr große Seite: Die Fassungen unterscheiden sich auf über 400 Zeilen. Beide Volltexte stehen nebeneinander.")
            } content: {
                HStack(spacing: Space.s2) {
                    Pane(label: ConflictText.here, time: c.localTime, text: left, accent: Impala.danger)
                    Pane(label: ConflictText.other, time: c.remoteTime, text: right, accent: Impala.success)
                }
                .padding(Space.s2)
            }
        }
    }
}

/// Feste Höhe des Vergleichs (web: `cf-compare`).
private let compareHeight: CGFloat = 360
private let mono = Font.system(size: 12.5, design: .monospaced)

/// Zeilenvergleich mit fester Kopfzeile, Legende und „Nächste Änderung“ (`cf-table`).
private struct DiffCompare: View {
    let rows: [DiffRow]
    let leftLabel: String
    let leftTime: String?
    let rightLabel: String
    let rightTime: String?
    let legend: [(String, Color)]
    @State private var jump = 0
    @State private var visible: Set<Int> = []

    var body: some View {
        let starts = rows.indices.filter {
            if case .line(_, _, let changed, let start) = rows[$0] { return changed && start }
            return false
        }
        ScrollViewReader { proxy in
            CompareShell {
                ForEach(legend.indices, id: \.self) { Legend(text: legend[$0].0, color: legend[$0].1) }
                if !starts.isEmpty {
                    Button("Nächste Änderung (\(starts.count))") {
                        let top = visible.min() ?? -1
                        let next = starts.first { $0 > top } ?? starts[0]
                        withAnimation(.smooth) { proxy.scrollTo(next, anchor: .top) }
                        jump += 1
                    }
                    .font(.system(size: TextSize.xs))
                    .lineLimit(1)
                    .sensoryFeedback(.selection, trigger: jump)
                }
            } content: {
                VStack(spacing: 0) {
                    HStack(alignment: .top) {
                        Header(label: leftLabel, time: leftTime)
                        Header(label: rightLabel, time: rightTime)
                    }
                    .padding(Space.s2)
                    .background(Impala.panel)
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(rows.indices, id: \.self) { i in
                                DiffLine(row: rows[i])
                                    .id(i)
                                    .onAppear { visible.insert(i) }
                                    .onDisappear { visible.remove(i) }
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct DiffLine: View {
    let row: DiffRow

    var body: some View {
        switch row {
        case .gap(let count):
            Text("··· \(count) unveränderte Zeilen ···")
                .font(.system(size: TextSize.xs))
                .foregroundStyle(Impala.text2)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
        case .line(let left, let right, let changed, _):
            HStack(alignment: .top, spacing: 0) {
                DiffCell(text: left, mark: changed ? "−" : "", tint: changed ? Impala.danger : nil)
                DiffCell(text: right, mark: changed ? "+" : "", tint: changed ? Impala.success : nil)
            }
        }
    }
}

/// Eine Hälfte einer Zeile; fehlt sie (`nil`), bleibt sie leer und blass.
private struct DiffCell: View {
    let text: String?
    let mark: String
    let tint: Color?

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Text(mark).font(mono.bold()).foregroundStyle(Impala.text2).frame(width: 16)
            Text(text ?? " ").font(mono).foregroundStyle(Impala.text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 1)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint != nil && text != nil ? tint!.opacity(0.16) : .clear)
        .opacity(text == nil ? 0.3 : 1)
    }
}

/// Einzelne Textfläche mit Überschrift, Zeit und Scroll (`cf-pane`).
private struct Pane: View {
    let label: String
    let time: String?
    let text: String
    let accent: Color

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: Space.s2) {
                RoundedRectangle(cornerRadius: 1.5).fill(accent).frame(width: 3, height: 18)
                Header(label: label, time: time)
            }
            .padding(.horizontal, Space.s3)
            .padding(.vertical, Space.s2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Impala.panel)
            ScrollView {
                Text(text.isEmpty ? ConflictText.noText : text)
                    .font(mono)
                    .foregroundStyle(Impala.text)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Space.s3)
            }
        }
        .background(Impala.surface)
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
    }
}

private struct Header: View {
    let label: String
    let time: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label).font(.system(size: TextSize.sm, weight: .semibold)).lineLimit(1)
            Text(ConflictText.time(time)).font(.system(size: 11)).foregroundStyle(Impala.text2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct Note: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2)
    }
}

private struct Legend: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text)
            .font(.system(size: TextSize.xs))
            .foregroundStyle(Impala.text2)
            .padding(.horizontal, Space.s2)
            .padding(.vertical, 2)
            .background(color.opacity(0.18), in: Capsule())
    }
}

/// Rahmen eines Vergleichs: optionale Leiste oben, Inhalt füllt den Rest.
private struct CompareShell<Bar: View, Content: View>: View {
    let bar: Bar?
    let content: Content

    init(@ViewBuilder bar: () -> Bar, @ViewBuilder content: () -> Content) {
        self.bar = bar()
        self.content = content()
    }

    init(bar: Bar?, @ViewBuilder content: () -> Content) where Bar == EmptyView {
        self.bar = nil
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            if let bar {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: Space.s2) { Spacer(minLength: 0); bar }
                    ScrollView(.horizontal, showsIndicators: false) { HStack(spacing: Space.s2) { bar } }
                }
                .padding(.horizontal, Space.s3)
                .padding(.vertical, Space.s2)
            }
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity)
        .frame(height: compareHeight)
        .background(Impala.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: Radius.lg))
        .clipShape(RoundedRectangle(cornerRadius: Radius.lg))
    }
}
