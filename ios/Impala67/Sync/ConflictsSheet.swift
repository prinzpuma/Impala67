import SwiftUI

/// Sync-Konflikte (web/conflict-ui.js, Dialog `conflict-modal`; Vorlage `ConflictsScreen.kt`): Liste der
/// offenen Konflikte, je Konflikt Gegenüberstellung und Entscheidungen, „Alle … mit Empfehlung lösen“.
/// Liste, Empfehlung und Entscheidungen kommen aus dem Kern (`conflicts`, `resolveConflict`, …).
struct ConflictsSheet: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var selected: String?
    @State private var resolvedOne = false
    @State private var confirmBulk = false
    @State private var message: String?
    @State private var resolvedTick = 0

    var body: some View {
        let _ = store.revision
        let list = store.core.conflicts()
        let index = list.firstIndex { $0.key == selected } ?? 0
        let bulkN = list.filter { $0.recommended != nil }.count
        Group {
            if list.isEmpty {
                Placeholder(icon: "check-circle", title: "Keine offenen Konflikte.", text: "Alle Geräte sind sich einig.")
                    .onAppear { if resolvedOne { dismiss() } }
            } else {
                let current = list[min(index, list.count - 1)]
                HStack(spacing: 0) {
                    if sizeClass == .regular && list.count > 1 {
                        ConflictList(list: list, selected: current.key) { key in
                            withAnimation(.smooth(duration: 0.25)) { selected = key }
                        }
                        .frame(width: 240)
                        Divider()
                    }
                    ConflictDetail(c: current, index: index, count: list.count, wide: sizeClass == .regular) { action in
                        choose(current, action)
                    }
                    .id(current.key)
                    .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
                }
                .animation(.smooth(duration: 0.3), value: current.key)
            }
        }
        .background(Impala.panel)
        .overlay(alignment: .bottom) {
            if let message {
                Text(message)
                    .font(.system(size: TextSize.sm, weight: .medium))
                    .padding(.horizontal, Space.s4)
                    .padding(.vertical, Space.s2)
                    .impalaGlass()
                    .padding(Space.s4)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task(id: message) {
                        try? await Task.sleep(for: .seconds(3))
                        withAnimation(.smooth) { self.message = nil }
                    }
            }
        }
        .animation(.smooth, value: message)
        .sensoryFeedback(.success, trigger: resolvedTick)
        .navigationTitle(ConflictText.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if bulkN >= 2 {
                ToolbarItem(placement: .primaryAction) {
                    Button(ConflictText.bulkButton(bulkN)) { confirmBulk = true }
                        .buttonStyle(.glassProminent)
                }
            }
            if sizeClass != .regular && list.count > 1 {
                ToolbarItemGroup(placement: .bottomBar) {
                    Button { step(list, index, -1) } label: { Icon("chevron-left") }
                        .accessibilityLabel("Vorheriger Konflikt")
                    Text("\(index + 1) / \(list.count)")
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text2)
                        .contentTransition(.numericText())
                    Button { step(list, index, 1) } label: { Icon("chevron-right") }
                        .accessibilityLabel("Nächster Konflikt")
                }
            }
        }
        .confirmationDialog("Alle \(bulkN) Konflikte lösen?", isPresented: $confirmBulk, titleVisibility: .visible) {
            Button("Mit Empfehlung lösen") { resolveRecommended() }
            Button("Abbrechen", role: .cancel) {}
        } message: {
            Text("Bei \(bulkN) Konflikten wird die Empfehlung übernommen. Die jeweils andere Fassung landet im Papierkorb und lässt sich dort wiederherstellen.")
        }
    }

    private func step(_ list: [ConflictInfo], _ index: Int, _ delta: Int) {
        withAnimation(.smooth(duration: 0.25)) { selected = list[(index + delta + list.count) % list.count].key }
    }

    private func choose(_ c: ConflictInfo, _ action: ConflictAction) {
        do {
            try store.core.resolveConflict(key: c.key, resolution: action.resolution)
            resolvedOne = true
            resolvedTick += 1
            selected = nil
        } catch {
            message = ConflictText.failed
        }
    }

    private func resolveRecommended() {
        let result = store.core.resolveConflictsRecommended()
        let done = Int(result.resolved)
        if done > 0 {
            resolvedOne = true
            resolvedTick += 1
            message = "\(done) \(done == 1 ? "Konflikt" : "Konflikte") gelöst."
        }
        if result.error != nil { message = ConflictText.bulkFailed }
    }
}

/// Liste der offenen Konflikte (breite Ansicht) mit gleitender Markierung.
private struct ConflictList: View {
    let list: [ConflictInfo]
    let selected: String
    let onSelect: (String) -> Void
    @Namespace private var ns

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 4) {
                ForEach(list, id: \.key) { c in
                    Button { onSelect(c.key) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.title).font(.system(size: TextSize.sm, weight: .semibold)).foregroundStyle(Impala.text).lineLimit(1)
                            Text(ConflictText.kindLabel(c)).font(.system(size: 11)).foregroundStyle(Impala.text2)
                            Text(ConflictText.time(c.time)).font(.system(size: 11)).foregroundStyle(Impala.text2)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.horizontal, Space.s3)
                        .padding(.vertical, Space.s2)
                        .background {
                            if c.key == selected {
                                RoundedRectangle(cornerRadius: Radius.md).fill(Impala.activeTint)
                                    .matchedGeometryEffect(id: "sel", in: ns)
                            }
                        }
                    }
                    .pressable()
                    .hoverEffect(.highlight)
                }
            }
            .padding(Space.s2)
        }
    }
}

/// Detail des gewählten Konflikts: Titel, Erklärung, Gegenüberstellung, Entscheidungen.
private struct ConflictDetail: View {
    @Environment(ImpalaStore.self) private var store
    let c: ConflictInfo
    let index: Int
    let count: Int
    let wide: Bool
    let onChoose: (ConflictAction) -> Void
    @State private var more = false

    var body: some View {
        let actions = ConflictText.actions(c)
        let copyText = c.copyPageId.flatMap { store.core.page(id: $0)?.content } ?? ""
        ScrollView {
            VStack(alignment: .leading, spacing: Space.s2) {
                Text("Konflikt \(index + 1) von \(count) · \(ConflictText.kindLabel(c))")
                    .font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2)
                Text(c.title).font(.system(size: TextSize.lg, weight: .semibold)).foregroundStyle(Impala.text)
                Text(ConflictText.explain(c)).font(.system(size: TextSize.base)).foregroundStyle(Impala.text2)
                if let reason = c.reason {
                    Button(more ? "Weniger dazu" : "Mehr dazu") { withAnimation(.smooth) { more.toggle() } }
                        .font(.system(size: TextSize.sm))
                    if more {
                        Text(reason).font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                }
                ConflictCompare(c: c, copyText: copyText)
                    .padding(.vertical, Space.s2)
                let layout = wide ? AnyLayout(HStackLayout(alignment: .top, spacing: Space.s2)) : AnyLayout(VStackLayout(spacing: Space.s2))
                layout {
                    ForEach(Array(actions.enumerated()), id: \.element.id) { i, a in
                        ActionCard(action: a) { onChoose(a) }.riseIn(i)
                    }
                }
            }
            .padding(.horizontal, Space.s4)
            .padding(.vertical, Space.s3)
        }
    }
}

/// Entscheidungskarte (`cf-action`): die empfohlene mit Akzent-Tönung und Badge.
private struct ActionCard: View {
    let action: ConflictAction
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: Space.s1) {
                HStack(spacing: Space.s2) {
                    Text(action.title).font(.system(size: TextSize.base, weight: .semibold)).foregroundStyle(Impala.text)
                    if action.recommended, let badge = action.badge {
                        Text(badge)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Impala.onAccent)
                            .padding(.horizontal, Space.s2)
                            .padding(.vertical, 2)
                            .background(Impala.accent, in: Capsule())
                    }
                }
                Text(action.sub).font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(Space.s3)
            .background(action.recommended ? Impala.accent.opacity(0.09) : Impala.surface, in: RoundedRectangle(cornerRadius: Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Radius.lg).stroke(action.recommended ? Impala.accentBorder : Impala.edge, lineWidth: 1))
        }
        .pressable()
        .hoverEffect(.lift)
    }
}
