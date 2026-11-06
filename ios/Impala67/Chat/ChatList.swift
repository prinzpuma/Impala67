import SwiftUI

/// Chat-Liste der Seitenleiste (Pille „Chat“, `ChatList.kt` bzw. `renderChatList` der PWA): neuer Chat,
/// gespeicherte Chats (zuletzt geänderte zuerst). Antippen öffnet im KI-Panel, Halten: eigener Tab,
/// Umbenennen, Löschen.
struct ChatList: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Namespace private var rows
    @State private var renaming: ChatInfo?
    @State private var title = ""
    @State private var deleting: ChatInfo?
    @State private var list: [ChatInfo] = []
    @AppStorage(AppDensity.key) private var density = AppDensity.compact.rawValue

    var body: some View {
        let chat = shell.chat
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 1) {
                Button {
                    withAnimation(.smooth) { chat.newChat() }
                    if shell.active?.hasPrefix("chat:") == true { shell.goHome() }
                } label: {
                    HStack(spacing: Space.s2) {
                        Icon("plus", size: 14)
                        Text("Neuer Chat").font(.system(size: TextSize.sm))
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(chat.running ? Impala.text2.opacity(0.5) : Impala.text2)
                    .padding(.horizontal, Space.s2)
                    .frame(minHeight: 34)
                }
                .pressable()
                .disabled(chat.running)
                if list.isEmpty {
                    Text("Noch keine gespeicherten Chats.")
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text2)
                        .padding(Space.s2)
                }
                ForEach(list, id: \.id) { info in
                    row(info, active: chat.chatId == info.id)
                }
            }
            .animation(.smooth(duration: 0.25), value: list.map(\.id))
        }
        .scrollIndicators(.hidden)
        .task(id: store.chatsRevision) {
            let core = store.core
            let loaded = await Task.detached(priority: .userInitiated) { core.chats() }.value
            if !Task.isCancelled { list = loaded }
        }
        .alert("Chat umbenennen", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Titel", text: $title)
            Button("Speichern") { if let r = renaming { chat.rename(r.id, title) } }
            Button("Abbrechen", role: .cancel) {}
        }
        .confirmationDialog("Chat löschen", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Löschen", role: .destructive) {
                if let d = deleting {
                    chat.delete([d.id])
                    shell.close("chat:" + d.id)
                }
            }
            Button("Abbrechen", role: .cancel) {}
        } message: {
            Text(deleting.map { "„\($0.title.isEmpty ? "Chat" : $0.title)“ wird endgültig gelöscht." } ?? "")
        }
    }

    private func row(_ info: ChatInfo, active: Bool) -> some View {
        Button {
            withAnimation(.smooth) {
                if shell.active?.hasPrefix("chat:") == true { shell.open("chat:" + info.id) }
                shell.chat.open(info.id)
            }
        } label: {
            VStack(alignment: .leading, spacing: 1) {
                Text(info.title.isEmpty ? "Chat" : info.title)
                    .font(.system(size: TextSize.sm, weight: active ? .medium : .regular))
                    .foregroundStyle(Impala.text)
                    .lineLimit(1)
                Text(Self.when(info.updated))
                    .font(.system(size: TextSize.xs))
                    .foregroundStyle(Impala.text2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, Space.s2)
            .padding(.vertical, density == AppDensity.compact.rawValue ? 4 : 8)
            .frame(minHeight: density == AppDensity.compact.rawValue ? 32 : 40)
            .background {
                if active {
                    RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
                        .fill(Impala.activeTint)
                        .matchedGeometryEffect(id: "row", in: rows)
                }
            }
        }
        .pressable()
        .hoverEffect(.highlight)
        .disabled(shell.chat.running && !active)
        .contextMenu {
            Button { shell.chat.open(info.id, reveal: false); shell.openNewTab("chat:" + info.id) } label: {
                Label { Text("In eigenem Tab öffnen") } icon: { Icon("external") }
            }
            Button { title = info.title; renaming = info } label: {
                Label { Text("Umbenennen") } icon: { Icon("pen") }
            }
            Button(role: .destructive) { deleting = info } label: {
                Label { Text("Löschen") } icon: { Icon("trash") }
            }
        }
        .sensoryFeedback(.selection, trigger: active) { _, now in AppHaptics.isEnabled && now }
    }

    /// „vor 5 Minuten“ aus dem ISO-Zeitstempel des Kerns.
    static func when(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        return date?.formatted(.relative(presentation: .named)) ?? ""
    }
}
