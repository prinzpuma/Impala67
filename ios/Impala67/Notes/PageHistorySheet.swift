import SwiftUI

/// Seitenverlauf wie `renderHistoryModal` der PWA (`render.js`): Versionen aus dem Event-Log
/// (`pageHistory` im Kern) links, Vorschau rechts. Wiederherstellen schreibt einen neuen Stand,
/// der Verlauf bleibt vollständig; im Editor lässt es sich mit „Rückgängig“ zurücknehmen.
struct PageHistorySheet: View {
    let model: NoteModel
    @Environment(ImpalaStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var versions: [PageVersion]?
    @State private var selected = 0

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Verlauf")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Schließen") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Diese Version wiederherstellen") { restore() }
                            .disabled(!canRestore)
                    }
                }
        }
        .task {
            model.flush()
            let core = store.core
            let id = model.pageId
            let list = await Task.detached(priority: .userInitiated) {
                (try? core.pageHistory(id: id)) ?? []
            }.value
            versions = list
            selected = max(0, list.count - 1)
        }
    }

    @ViewBuilder private var content: some View {
        if let versions {
            if versions.isEmpty {
                Text("Keine Versionen")
                    .font(.system(size: TextSize.base))
                    .foregroundStyle(Impala.text2)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HStack(spacing: 0) {
                    list(versions)
                        .frame(width: 240)
                    Divider()
                    preview(versions[min(selected, versions.count - 1)])
                }
            }
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// Neueste zuerst, höchstens 50 wie in der PWA.
    private func list(_ versions: [PageVersion]) -> some View {
        let last = versions.count - 1
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 2) {
                ForEach(Array(stride(from: last, through: max(0, last - 49), by: -1)), id: \.self) { i in
                    Button { selected = i } label: {
                        HStack(spacing: Space.s2) {
                            Text(Self.when(versions[i].time))
                                .font(.system(size: TextSize.sm, weight: i == selected ? .semibold : .regular))
                                .foregroundStyle(i == selected ? Impala.accent : Impala.text)
                            Spacer(minLength: 0)
                            if i == last {
                                Text("aktuell")
                                    .font(.system(size: TextSize.xs))
                                    .foregroundStyle(Impala.text2)
                            }
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(i == selected ? Impala.activeTint : .clear, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                }
            }
            .padding(Space.s2)
        }
    }

    private func preview(_ v: PageVersion) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.s3) {
                Text(v.title.isEmpty ? "Unbenannt" : v.title)
                    .font(.system(size: TextSize.lg, weight: .bold))
                    .foregroundStyle(Impala.text)
                MarkdownView(v.content, core: store.core)
                    .id(selected)
            }
            .padding(Space.s4)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var canRestore: Bool {
        guard let versions, !versions.isEmpty else { return false }
        return selected < versions.count - 1
    }

    private func restore() {
        guard let versions, selected < versions.count else { return }
        let v = versions[selected]
        model.restoreVersion(title: v.title, content: v.content)
        model.showToast("Version wiederhergestellt", style: .success)
        dismiss()
    }

    /// ISO-Zeitpunkt → „12.11.2026, 14:37“.
    static func when(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return iso }
        return d.formatted(.dateTime.day(.twoDigits).month(.twoDigits).year().hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
    }
}
