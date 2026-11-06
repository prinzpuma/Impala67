import SwiftUI

/// Titel und Symbol einer Seite wie in der PWA (`DEFAULT_PAGE_EMOJI` in icons.js, `NotesModel.kt`).
enum PageStyle {
    /// Platzhalter-Emojis, die als Symbol gezeigt werden statt als Text.
    private static let defaultIcon = ["📓": "notebook", "📄": "file", "📝": "note", "📅": "calendar"]

    static func title(_ p: PageSummary) -> String {
        p.title.trimmingCharacters(in: .whitespaces).isEmpty ? "Unbenannt" : p.title
    }

    /// Eigenes Emoji der Seite; `nil`, wenn ein Symbol gezeigt wird.
    static func emoji(_ p: PageSummary) -> String? {
        let icon = p.icon.trimmingCharacters(in: .whitespaces)
        return icon.isEmpty || defaultIcon[icon] != nil ? nil : icon
    }

    static func iconName(_ p: PageSummary) -> String {
        defaultIcon[p.icon] ?? (p.kind == .heft ? "notebook" : "note")
    }
}

/// Emoji oder Sprite-Symbol einer Seite.
struct PageIcon: View {
    let page: PageSummary
    var size: CGFloat = 15

    var body: some View {
        if let emoji = PageStyle.emoji(page) {
            Text(emoji).font(.system(size: size - 1))
        } else {
            Icon(PageStyle.iconName(page), size: size)
        }
    }
}
