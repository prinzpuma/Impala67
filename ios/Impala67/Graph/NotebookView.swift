import SwiftUI
import UIKit

/// Gemini Notebook (ehemals NotebookLM, web/notebooklm.js `renderPane`): Google erlaubt kein Einbetten,
/// deshalb öffnet es extern. „Seiten als Quelle kopieren…“ legt die gewählten Seiten als EINEN Text in die
/// Zwischenablage (`# Titel` + Inhalt, getrennt durch `---`, wie `copyPages`) und öffnet Gemini Notebook.
/// Downloads (Podcast, Video, Folien) bleiben in der PWA lokal und synchronisieren nicht; auf dem iPad
/// kommen sie über das Slash-Menü als Datei in eine Notiz.
struct NotebookView: View {
    @Environment(\.openURL) private var openURL
    @State private var picking = false
    @State private var notice: String?
    /// Hintergrund; in der Bibliothek durchsichtig, damit das Papier-Panel durchscheint.
    let background: Color

    init(background: Color = Impala.panel) {
        self.background = background
    }

    static let product = "Gemini Notebook"
    static let url = URL(string: "https://notebooklm.google.com/")!

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.s4) {
                HStack(spacing: Space.s3) {
                    Icon("book", size: 26).foregroundStyle(Impala.accent)
                    Text(Self.product).font(.system(size: TextSize.xl, weight: .bold, design: .rounded)).foregroundStyle(Impala.text)
                }
                .riseIn(0)
                Text("Google hat NotebookLM in \(Self.product) umbenannt — gleiches Produkt, neuer Name. Einbetten in der App blockiert Google, deshalb öffnet es extern.")
                    .font(.system(size: TextSize.md)).foregroundStyle(Impala.text2)
                    .riseIn(1)
                VStack(alignment: .leading, spacing: Space.s3) {
                    action("Seiten als Quelle kopieren…", icon: "library", primary: true) { picking = true }
                    action("\(Self.product) öffnen", icon: "external") { openURL(Self.url) }
                }
                .riseIn(2)
                VStack(alignment: .leading, spacing: Space.s2) {
                    step("1", "Seiten wählen – ihr Inhalt landet als ein Text in der Zwischenablage.")
                    step("2", "In \(Self.product): „Quelle hinzufügen → Kopierter Text“ → Einfügen.")
                    step("3", "Ergebnisse wie Audio-Übersicht oder Folien herunterladen und über „/Datei“ in eine Notiz einfügen.")
                }
                .padding(Space.s4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                .riseIn(3)
                Text("Die Download-Inbox der PWA bleibt auf dem jeweiligen Gerät und wird nicht synchronisiert.")
                    .font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2)
                    .riseIn(4)
            }
            .padding(Space.s6)
            .frame(maxWidth: 640, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(background)
        .overlay(alignment: .bottom) {
            if let notice {
                Text(notice)
                    .font(.system(size: TextSize.sm, weight: .medium)).foregroundStyle(Impala.text)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Space.s4).padding(.vertical, Space.s3)
                    .impalaGlass(in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
                    .padding(Space.s4)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.4, bounce: 0.2), value: notice)
        .sheet(isPresented: $picking) {
            NotebookPicker { count in
                show("\(count) \(count == 1 ? "Seite" : "Seiten") kopiert — in \(Self.product): „Quelle hinzufügen → Kopierter Text“ → Einfügen.")
                openURL(Self.url)
            }
        }
    }

    private func show(_ text: String) {
        notice = text
        Task {
            try? await Task.sleep(for: .seconds(4))
            if notice == text { notice = nil }
        }
    }

    private func action(_ title: String, icon: String, primary: Bool = false, run: @escaping () -> Void) -> some View {
        Button(action: run) {
            HStack(spacing: Space.s2) {
                Icon(icon, size: 16)
                Text(title).font(.system(size: TextSize.base, weight: .semibold))
            }
            .foregroundStyle(primary ? Impala.onAccent : Impala.accent)
            .padding(.horizontal, Space.s4)
            .frame(minHeight: 44)
            .background(primary ? Impala.accent : Impala.accent.opacity(0.09), in: Capsule())
            .overlay(Capsule().stroke(Impala.accent.opacity(primary ? 0 : 0.36), lineWidth: 1))
        }
        .pressable()
    }

    private func step(_ n: String, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Space.s3) {
            Text(n).font(.system(size: TextSize.sm, weight: .bold, design: .rounded)).foregroundStyle(Impala.accent)
            Text(text).font(.system(size: TextSize.sm)).foregroundStyle(Impala.text)
        }
    }
}

/// Seiten-Auswahl (`openPicker`): Suche, Häkchen, „N ausgewählt“; Kopieren legt den Text ab.
private struct NotebookPicker: View {
    let onCopied: (Int) -> Void
    @Environment(ImpalaStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var picked: [String] = []
    @State private var empty = false
    /// Einmal beim Öffnen im Hintergrund geladen; das Filtern beim Tippen läuft lokal darauf.
    @State private var pages: [PageSummary] = []

    var body: some View {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let shown = q.isEmpty ? pages : pages.filter { PageStyle.title($0).lowercased().contains(q) }
        NavigationStack {
            List(shown) { p in
                Button {
                    withAnimation(.snappy) {
                        if let i = picked.firstIndex(of: p.id) { picked.remove(at: i) } else { picked.append(p.id) }
                    }
                } label: {
                    HStack(spacing: Space.s2) {
                        PageIcon(page: p).foregroundStyle(Impala.text2)
                        Text(PageStyle.title(p)).foregroundStyle(Impala.text).lineLimit(1)
                        Spacer()
                        Image(systemName: picked.contains(p.id) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(picked.contains(p.id) ? Impala.accent : Impala.text2.opacity(0.5))
                            .contentTransition(.symbolEffect(.replace))
                    }
                }
            }
            .listStyle(.plain)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Seiten filtern")
            .sensoryFeedback(.selection, trigger: picked.count)
            .navigationTitle("Seiten als Quelle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(picked.isEmpty ? "Kopieren" : "\(picked.count) kopieren") { copy() }
                        .disabled(picked.isEmpty)
                }
            }
            .alert("Die gewählten Seiten sind leer.", isPresented: $empty) { Button("OK", role: .cancel) {} }
        }
        .presentationDetents([.large])
        .task {
            let core = store.core
            let next = await Task.detached(priority: .userInitiated) {
                core.recentPages(limit: 500).filter { $0.kind == .note }
            }.value
            if !Task.isCancelled { pages = next }
        }
    }

    private func copy() {
        let text = picked.compactMap { store.core.page(id: $0) }
            .map { "# " + ($0.summary.title.isEmpty ? "Ohne Titel" : $0.summary.title) + "\n\n" + $0.content }
            .joined(separator: "\n\n---\n\n")
        guard !picked.compactMap({ store.core.page(id: $0)?.content }).allSatisfy({ $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
            empty = true
            return
        }
        UIPasteboard.general.string = text
        let count = picked.count
        dismiss()
        onCopied(count)
    }
}
