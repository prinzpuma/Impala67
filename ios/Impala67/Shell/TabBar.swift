import SwiftUI

/// Tab-Leiste über dem Inhalt (`#tabs` der PWA, `DeskTabBar.kt`): Chips mit Symbol, Titel und ✕,
/// aktiv mit Akzent-Tönung; „+“ öffnet einen neuen Tab. Die Tabs liegen im Kern und gelten auf allen Geräten.
struct TabBar: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @AppStorage(AppTabsPosition.key) private var tabsPosition = AppTabsPosition.top.rawValue
    @Namespace private var highlight

    var body: some View {
        let _ = store.pageMetaRevision
        HStack(spacing: Space.s1) {
            Button { shell.toggleSidebar() } label: {
                Icon("columns", size: 16)
                    .foregroundStyle(Impala.text2)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Linke Spalte ein-/ausklappen")

            Button { shell.goBack() } label: {
                Icon("chevron-left", size: 15)
                    .foregroundStyle(shell.canGoBack ? Impala.text : Impala.text2.opacity(0.35))
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!shell.canGoBack)
            .accessibilityLabel("Zurück")

            Button { shell.goForward() } label: {
                Icon("chevron-right", size: 15)
                    .foregroundStyle(shell.canGoForward ? Impala.text : Impala.text2.opacity(0.35))
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!shell.canGoForward)
            .accessibilityLabel("Vor")

            if tabsPosition == AppTabsPosition.sidebar.rawValue {
                HStack(spacing: 6) {
                    if let a = shell.active {
                        let inf = info(a)
                        if let emoji = inf.emoji { Text(emoji).font(.system(size: TextSize.sm)) }
                        else { Icon(inf.icon, size: 15).foregroundStyle(Impala.text2) }
                        Text(inf.title)
                            .font(.system(size: TextSize.sm, weight: .medium))
                            .foregroundStyle(Impala.text)
                            .lineLimit(1)
                    } else if shell.libraryOpen {
                        Text("Bibliothek")
                            .font(.system(size: TextSize.sm, weight: .medium))
                            .foregroundStyle(Impala.text)
                    } else {
                        Text("Startseite")
                            .font(.system(size: TextSize.sm, weight: .medium))
                            .foregroundStyle(Impala.text)
                    }
                }
                .padding(.leading, Space.s1)
                Spacer()
            } else {
                ScrollView(.horizontal) {
                    HStack(spacing: Space.s1) {
                        ForEach(shell.tabs, id: \.self) { tab in
                            TabChip(info: info(tab), active: !shell.libraryOpen && tab == shell.active, ns: highlight, onOpen: { shell.open(tab) }, onClose: { shell.close(tab) })
                                .transition(.asymmetric(insertion: .scale(scale: 0.85).combined(with: .opacity), removal: .opacity.combined(with: .scale(scale: 0.9))))
                        }
                    }
                    .padding(.vertical, 2)
                    .animation(.bouncy(duration: 0.35), value: shell.tabs)
                    .animation(.smooth(duration: 0.3), value: shell.active)
                }
                .scrollIndicators(.hidden)
            }
            Menu {
                MenuItem("Neue Notiz", icon: "note") { newPage(.note) }
                MenuItem("Neues Heft", icon: "notebook") { newPage(.heft) }
                TemplateMenuSection(create: newPage)
                MenuItem("Seite suchen", icon: "search") { shell.sheet = .search }
            } label: {
                Icon("plus", size: 15)
                    .foregroundStyle(Impala.text2)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Neuer Tab")
        }
        .padding(.horizontal, Space.s2)
        .padding(.vertical, 6)
        .background(Impala.panel)
        .overlay(alignment: .bottom) { Rectangle().fill(Impala.edgeSoft).frame(height: 1) }
    }

    private func info(_ tab: String) -> (title: String, icon: String, emoji: String?) {
        if tab.hasPrefix("chat:") {
            let _ = store.chatsRevision
            let title = store.core.chat(id: String(tab.dropFirst(5)))?.title ?? ""
            return (title.isEmpty ? "Chat" : title, "sparkles", nil)
        }
        if tab == "anki:main" { return ("Karteikarten", "cards", nil) }
        if tab == "nlm:main" { return ("Gemini Notebook", "book", nil) }
        guard let p = store.core.page(id: tab)?.summary else { return ("Ohne Titel", "file", nil) }
        return (PageStyle.title(p), PageStyle.iconName(p), PageStyle.emoji(p))
    }

    private func newPage(_ choice: NewPageChoice) {
        if let id = store.core.createNew(choice, parent: nil, workspace: nil) { shell.openNewTab(id) }
    }
}

private struct TabChip: View {
    let info: (title: String, icon: String, emoji: String?)
    let active: Bool
    let ns: Namespace.ID
    let onOpen: () -> Void
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            if let emoji = info.emoji { Text(emoji).font(.system(size: TextSize.xs)) } else { Icon(info.icon, size: 14) }
            Text(info.title)
                .font(.system(size: TextSize.sm))
                .lineLimit(1)
            Button(action: onClose) {
                Icon("x", size: 12)
                    .frame(width: 22, height: 22)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Tab schließen")
        }
        .foregroundStyle(active ? Impala.text : Impala.text2)
        .padding(.leading, Space.s2)
        .padding(.trailing, 2)
        .frame(minWidth: 96, maxWidth: 170, minHeight: 32, alignment: .leading)
        .background {
            if active {
                RoundedRectangle(cornerRadius: Radius.sm, style: .continuous)
                    .fill(Impala.activeTint)
                    .matchedGeometryEffect(id: "tab", in: ns)
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: Radius.sm))
        .onTapGesture(perform: onOpen)
        .hoverEffect(.highlight)
    }
}
