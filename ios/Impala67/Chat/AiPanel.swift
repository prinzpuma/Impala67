import SwiftUI

/// Breite des KI-Panels rechts (wie `AiPanelWidth` der Android-App, etwas breiter fürs iPad).
let aiPanelWidth: CGFloat = 340

/// Rechte Spalte „KI-Coach“ (`#panel` der PWA, `DeskAiPanel.kt`): Kopf mit Status, Verlauf, Neuer Chat,
/// In eigenem Tab öffnen und Einklappen; darunter der Chat mit der offenen Seite als Kontext.
struct AiPanel: View {
    let activePageId: String?
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @State private var recentChats: [ChatInfo] = []

    var body: some View {
        let chat = shell.chat
        VStack(spacing: 0) {
            HStack(spacing: Space.s1) {
                Text("KI-Coach").font(.system(size: TextSize.sm, weight: .semibold)).foregroundStyle(Impala.text2)
                StatusChip()
                Spacer(minLength: 0)
                Menu {
                    if recentChats.isEmpty { Text("Noch keine gespeicherten Chats.") }
                    ForEach(recentChats, id: \.id) { info in
                        Button(info.title.isEmpty ? "Chat" : info.title) { chat.open(info.id) }
                    }
                } label: {
                    HeadIcon(icon: "history")
                }
                .disabled(chat.running)
                .accessibilityLabel("Alte Chats öffnen (Verlauf)")
                HeadButton(icon: "plus", label: "Neuen Chat starten") { withAnimation(.smooth) { chat.newChat() } }
                    .disabled(chat.running)
                HeadButton(icon: "expand", label: "Chat in eigenem Tab öffnen") {
                    shell.openNewTab("chat:" + chat.chatId)
                }
                .disabled(chat.running || chat.chatId.isEmpty)
                HeadButton(icon: "x", label: "KI einklappen") { shell.setAiPanel(false) }
            }
            .padding(.leading, Space.s3)
            .padding(.trailing, Space.s2)
            .padding(.vertical, Space.s2)
            Divider().overlay(Impala.edge)
            ChatView(activePageId: activePageId)
        }
        .frame(width: aiPanelWidth)
        .frame(maxHeight: .infinity)
        .background(Impala.panel)
        .task(id: store.chatsRevision) {
            let core = store.core
            let loaded = await Task.detached(priority: .utility) { Array(core.chats().prefix(40)) }.value
            if !Task.isCancelled { recentChats = loaded }
        }
        .overlay(alignment: .leading) { Rectangle().fill(Impala.edge).frame(width: 0.5) }
    }
}

/// Chat als eigener Tab `chat:<id>` (breit, ohne Seitenkontext).
struct ChatScreen: View {
    let chatId: String
    @Environment(ShellModel.self) private var shell

    var body: some View {
        ChatView(activePageId: nil, wide: true)
            .background(Impala.panel)
            .onAppear { shell.chat.open(chatId, reveal: false) }
            .onChange(of: chatId) { shell.chat.open(chatId, reveal: false) }
            // Lernzeit „ai“ nur im Chat-Tab wie lernzeit.js (`S.view === "chat"`), nicht im Seitenpanel.
            .learningTime(LearnContext(category: "ai", sourceId: chatId.isEmpty ? nil : chatId))
    }
}

/// Sparkles-Knopf unten rechts (eingeklapptes KI-Panel): Liquid Glass, federt beim Erscheinen.
struct AiOrbButton: View {
    @Environment(ShellModel.self) private var shell
    @State private var spin = 0

    var body: some View {
        Button {
            spin += 1
            shell.setAiPanel(true)
        } label: {
            Icon("sparkles", size: 22)
                .foregroundStyle(Impala.accent)
                .phaseAnimator([1.0, 1.18, 1.0], trigger: spin) { v, k in v.scaleEffect(k).rotationEffect(.degrees((k - 1) * 60)) }
                .frame(width: 56, height: 56)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: Circle())
        .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
        .keyboardShortcut("j", modifiers: .command)
        .accessibilityLabel("KI-Coach öffnen")
        .sensoryFeedback(.impact(weight: .medium), trigger: spin)
    }
}

/// „KI online/offline“: erreichbar, wenn die gewählte Quelle Modelle liefert; antippen prüft erneut,
/// offline geht es in die Einstellungen.
private struct StatusChip: View {
    @Environment(ShellModel.self) private var shell

    var body: some View {
        let chat = shell.chat
        let state = chat.online
        Button {
            if state == false { shell.sheet = .settings } else { chat.refreshModels(force: true) }
        } label: {
            HStack(spacing: Space.s1) {
                Circle()
                    .fill(state == true ? Impala.success : state == false ? Impala.danger : Impala.text2.opacity(0.5))
                    .frame(width: 7, height: 7)
                Text(state == true ? "KI online" : state == false ? "KI offline" : "KI …")
                    .font(.system(size: TextSize.xs))
                    .foregroundStyle(Impala.text2)
                    .contentTransition(.opacity)
            }
            .padding(.horizontal, Space.s2)
            .padding(.vertical, 2)
            .background(Impala.surface, in: Capsule())
        }
        .buttonStyle(.plain)
        .animation(.smooth, value: state)
        .onAppear { chat.refreshModels() }
    }
}

private struct HeadButton: View {
    let icon: String
    let label: String
    let action: () -> Void
    var body: some View {
        Button(action: action) { HeadIcon(icon: icon) }
            .pressable()
            .hoverEffect(.highlight)
            .accessibilityLabel(label)
    }
}

private struct HeadIcon: View {
    let icon: String
    @Environment(\.isEnabled) private var enabled
    var body: some View {
        Icon(icon, size: 15)
            .foregroundStyle(Impala.text2.opacity(enabled ? 1 : 0.3))
            .frame(width: 32, height: 32)
            .contentShape(Rectangle())
    }
}
