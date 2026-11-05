import SwiftUI

/// Tabelle mit direkt bearbeitbaren Zellen (web/editor-table.js, wie `TableEditor.kt`): Tab/Shift+Tab
/// zur Nachbarzelle, Tab in der letzten Zelle legt eine Zeile an, Enter springt in die Zelle darunter.
/// Darunter „+ Zeile“ und „+ Spalte“. Zeilenumbrüche in Zellen stehen im Markdown als `<br>`.
struct TableEditor: View {
    let rows: [[String]]
    let onChange: ([[String]]) -> Void

    private struct Cell: Hashable {
        let r: Int
        let c: Int
    }

    @FocusState private var focus: Cell?

    private var cols: Int { rows.map(\.count).max() ?? 0 }

    /// Rechteckiges Raster (fehlende Zellen leer).
    private var grid: [[String]] {
        let n = cols
        return rows.map { r in (0..<n).map { $0 < r.count ? r[$0] : "" } }
    }

    var body: some View {
        let g = grid
        VStack(alignment: .leading, spacing: Space.s1) {
            ScrollView(.horizontal, showsIndicators: false) {
                Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
                    ForEach(g.indices, id: \.self) { r in
                        GridRow {
                            ForEach(g[r].indices, id: \.self) { c in
                                cell(g, r, c)
                            }
                        }
                    }
                }
                .overlay(Rectangle().strokeBorder(Impala.edge))
            }
            HStack(spacing: Space.s1) {
                Button("+ Zeile") { addRow(g, focusAt: 0) }
                Button("+ Spalte") {
                    let c = cols
                    onChange(g.map { $0 + [""] })
                    DispatchQueue.main.async { focus = Cell(r: 0, c: c) }
                }
            }
            .font(.system(size: TextSize.sm))
            .foregroundStyle(Impala.text2)
            .buttonStyle(.plain)
            .padding(.vertical, Space.s1)
        }
        .padding(.vertical, Space.s1)
        .onAppear { if focus == nil { focus = Cell(r: 0, c: 0) } }
    }

    private func cell(_ g: [[String]], _ r: Int, _ c: Int) -> some View {
        let shown = g[r][c].replacingOccurrences(of: "<br\\s*/?>", with: "\n", options: [.regularExpression, .caseInsensitive])
        return TextField("", text: Binding(get: { shown }, set: { v in
            // Enter der Bildschirmtastatur kommt als Zeilenumbruch: wie Enter → Zelle darunter.
            if v.filter({ $0 == "\n" }).count > shown.filter({ $0 == "\n" }).count {
                go(g, r + 1, c)
            } else {
                var next = g
                next[r][c] = v.replacingOccurrences(of: "\n", with: "<br>")
                onChange(next)
            }
        }), axis: .vertical)
        .font(.system(size: TextSize.base, weight: r == 0 ? .semibold : .regular))
        .foregroundStyle(Impala.text)
        .focused($focus, equals: Cell(r: r, c: c))
        .padding(.horizontal, 10).padding(.vertical, 6)
        .frame(width: 150, alignment: .topLeading)
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .background(r == 0 ? Impala.surface : Color.clear)
        .border(Impala.edge, width: 0.5)
        .onKeyPress(.tab, phases: .down) { press in
            go(g, r, press.modifiers.contains(.shift) ? c - 1 : c + 1)
            return .handled
        }
    }

    private func addRow(_ g: [[String]], focusAt c: Int) {
        onChange(g + [Array(repeating: "", count: cols)])
        let target = Cell(r: g.count, c: c)
        DispatchQueue.main.async { focus = target }
    }

    private func go(_ g: [[String]], _ r: Int, _ c: Int) {
        if c >= cols {
            if r + 1 < g.count { focus = Cell(r: r + 1, c: 0) } else { addRow(g, focusAt: 0) }
        } else if c < 0 {
            if r > 0 { focus = Cell(r: r - 1, c: cols - 1) }
        } else if r >= g.count {
            addRow(g, focusAt: c)
        } else if r >= 0 {
            focus = Cell(r: r, c: c)
        }
    }
}
