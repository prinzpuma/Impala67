import SwiftUI

/// Tab-Leiste über dem Inhalt (`#tabs` der PWA, `DeskTabBar.kt`): Chips mit Symbol, Titel und ✕,
/// aktiv mit Akzent-Tönung; „+“ öffnet einen neuen Tab. Die Tabs liegen im Kern und gelten auf allen Geräten.
struct TabBar: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @AppStorage(AppTabsPosition.key) private var tabsPosition = AppTabsPosition.top.rawValue
    @AppStorage(AppDensity.key) private var density = AppDensity.compact.rawValue
    @Namespace private var highlight

    var body: some View {
        let _ = store.pageMetaRevision
        let isCompact = density == AppDensity.compact.rawValue
        HStack(spacing: Space.s1) {
            Button { shell.toggleSidebar() } label: {
                Icon("columns", size: 16)
                    .foregroundStyle(Impala.text2)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityLabel("Linke Spalte ein-/ausklappen")

            Button { shell.goBack() } label: {
                Icon("chevron-left", size: 15)
                    .foregroundStyle(shell.canGoBack ? Impala.text : Impala.text2.opacity(0.35))
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!shell.canGoBack)
            .hoverEffect(.highlight)
            .contextMenu {
                ForEach(shell.backHistoryItems()) { item in
                    MenuItem(item.title, icon: item.icon) { shell.jumpToHistory(item.index) }
                }
            }
            .accessibilityLabel("Zurück")

            Button { shell.goForward() } label: {
                Icon("chevron-right", size: 15)
                    .foregroundStyle(shell.canGoForward ? Impala.text : Impala.text2.opacity(0.35))
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!shell.canGoForward)
            .hoverEffect(.highlight)
            .contextMenu {
                ForEach(shell.forwardHistoryItems()) { item in
                    MenuItem(item.title, icon: item.icon) { shell.jumpToHistory(item.index) }
                }
            }
            .accessibilityLabel("Vor")

            if tabsPosition == AppTabsPosition.sidebar.rawValue {
                // In der PWA (.tabs-in-sidebar): #tabbar hat .tabstrip { display: none }.
                // Zeigt nur die Navigationsknöpfe ☰ ‹ › (kein redundanter Titel, kein Doppel-Plus).
                Spacer()
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 2) {
                        ForEach(shell.tabs, id: \.self) { tab in
                            TabChip(
                                info: info(tab),
                                active: !shell.libraryOpen && tab == shell.active,
                                ns: highlight,
                                onOpen: { shell.openTab(tab) },
                                onClose: { shell.close(tab) }
                            )
                            .transition(.asymmetric(
                                insertion: .scale(scale: 0.85).combined(with: .opacity),
                                removal: .opacity.combined(with: .scale(scale: 0.9))
                            ))
                        }

                        // „+“ sitzt wie `#btnTabNew` direkt hinter dem letzten Tab (inkl. Neuer Chat wie PWA/DeskTabBar)
                        Menu {
                            MenuItem("Neuer Chat", icon: "sparkles") {
                                shell.openNewTab("chat:\(UUID().uuidString)")
                            }
                            MenuItem("Neue Notiz", icon: "note") { newPage(.note) }
                            MenuItem("Neues Heft", icon: "notebook") { newPage(.heft) }
                            TemplateMenuSection(create: newPage)
                            MenuItem("In neuem Tab öffnen…", icon: "search") { shell.sheet = .search }
                        } label: {
                            Icon("plus", size: 15)
                                .foregroundStyle(Impala.text2)
                                .frame(width: 28, height: 28)
                                .background(Impala.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .hoverEffect(.highlight)
                        .accessibilityLabel("Neuen Tab öffnen")
                        .padding(.leading, 2)
                    }
                    .padding(.vertical, 2)
                    .animation(.bouncy(duration: 0.35), value: shell.tabs)
                    .animation(.smooth(duration: 0.3), value: shell.active)
                }
            }
        }
        .padding(.horizontal, Space.s2)
        .padding(.vertical, isCompact ? 4 : 6)
        .frame(minHeight: isCompact ? 36 : 42)
        .background(Impala.panel)
        .overlay(alignment: .bottom) { Rectangle().fill(Impala.edgeSoft).frame(height: 1) }
    }

    private func info(_ tab: String) -> (title: String, icon: String, emoji: String?) {
        let item = shell.tabInfo(tab)
        return (item.title, item.icon, item.emoji)
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

    @AppStorage(AppDensity.key) private var density = AppDensity.compact.rawValue

    var body: some View {
        let isCompact = density == AppDensity.compact.rawValue
        HStack(spacing: 6) {
            if let emoji = info.emoji { Text(emoji).font(.system(size: TextSize.xs)) } else { Icon(info.icon, size: 14) }
            Text(info.title)
                .font(.system(size: TextSize.sm))
                .lineLimit(1)
            Button(action: onClose) {
                Icon("x", size: 12)
                    .frame(width: 20, height: 20)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .accessibilityLabel("Tab schließen")
        }
        .foregroundStyle(active ? Impala.text : Impala.text2)
        .padding(.leading, Space.s2)
        .padding(.trailing, 2)
        .frame(minWidth: 96, maxWidth: 170, minHeight: isCompact ? 28 : 32, alignment: .leading)
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
