import SwiftUI

/// Eine Nachricht je nach Art (`role`), wie `renderMessage` der PWA bzw. `ChatParts.kt`.
struct ChatMessageRow: View {
    let message: ChatMessage
    let onEdit: (String) -> Void
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell

    var body: some View {
        let chat = shell.chat
        switch message.role {
        case "user":
            UserBubble(message: message, enabled: !chat.running) {
                if let mid = message.mid, let text = chat.editFrom(mid) { onEdit(text) }
            }
        case "assistant":
            if message.mid == nil || message.mid != chat.refining { AssistantMessage(message: message) }
        case "thought": ThinkBox(text: message.reasoning ?? "", live: false)
        case "tool": ToolChip(name: message.name ?? "", detail: message.detail, error: message.error == true)
        case "edit": EditCard(summary: message.summary ?? "KI-Änderungen", undone: message.undone == true, enabled: !chat.running) {
            if let mid = message.mid { chat.undo(mid) }
        }
        case "question": QuestionCard(message: message) { option in if let mid = message.mid { chat.answer(mid, option: option) } }
        default: EmptyView()
        }
    }
}

/// Nutzernachricht (rechts, Blase `--bubble`) mit Stift „Bearbeiten“.
private struct UserBubble: View {
    let message: ChatMessage
    let enabled: Bool
    let onEdit: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: Space.s1) {
            Spacer(minLength: 40)
            if message.mid != nil {
                Button(action: onEdit) { Icon("pen", size: 12).foregroundStyle(Impala.text2.opacity(0.6)).frame(width: 26, height: 26) }
                    .pressable()
                    .disabled(!enabled)
                    .accessibilityLabel("Nachricht bearbeiten")
            }
            VStack(alignment: .leading, spacing: Space.s1) {
                if let img = attachedImage {
                    Image(uiImage: img).resizable().scaledToFit().frame(maxWidth: 220, maxHeight: 180)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                } else if let name = attachmentName {
                    Text(name).font(.system(size: TextSize.xs, weight: .medium)).foregroundStyle(Impala.text2)
                }
                if let text = message.content, !text.isEmpty {
                    Text(text).font(.system(size: TextSize.base)).foregroundStyle(Impala.text).textSelection(.enabled)
                }
            }
            .padding(.horizontal, Space.s3)
            .padding(.vertical, Space.s2)
            .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        }
    }

    /// Angehängtes Bild (Data-URL) als Vorschau.
    private var attachedImage: UIImage? {
        guard let url = message.image, let comma = url.firstIndex(of: ","), url.hasPrefix("data:"),
              let data = Data(base64Encoded: String(url[url.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }

    /// Angehängte Datei (`extra.pdfFile`/`textFile`), nur als Name.
    private var attachmentName: String? {
        let extra = (try? JSONSerialization.jsonObject(with: Data(message.extraJson.utf8))) as? [String: Any] ?? [:]
        if let f = extra["pdfFile"] as? [String: Any] { return "PDF · " + (f["name"] as? String ?? "") }
        if let f = extra["textFile"] as? [String: Any] { return "Datei · " + (f["name"] as? String ?? "") }
        return message.image != nil ? "Bild" : nil
    }
}

/// Antwort als Markdown über die Blöcke des Notiz-Editors, darunter „Kopieren“ und „Anpassen“.
private struct AssistantMessage: View {
    let message: ChatMessage
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s1) {
            MarkdownView(message.content ?? "", core: store.core)
            HStack(spacing: Space.s1) {
                SmallAction(icon: "copy", label: "Kopieren") {
                    UIPasteboard.general.string = message.content ?? ""
                    shell.chat.show("Antwort kopiert.")
                }
                Menu {
                    ForEach(Refine.allCases) { r in
                        Button(r.rawValue) { if let mid = message.mid { shell.chat.refine(mid, r) } }
                    }
                } label: {
                    SmallActionLabel(icon: "sparkles", label: "Anpassen")
                }
                .disabled(shell.chat.running || message.mid == nil)
            }
            .sensoryFeedback(.success, trigger: shell.chat.notice) { _, n in n == "Antwort kopiert." }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SmallAction: View {
    let icon: String
    let label: String
    let action: () -> Void
    var body: some View {
        Button(action: action) { SmallActionLabel(icon: icon, label: label) }.pressable()
    }
}

private struct SmallActionLabel: View {
    let icon: String
    let label: String
    var body: some View {
        HStack(spacing: Space.s1) {
            Icon(icon, size: 12)
            Text(label).font(.system(size: TextSize.xs))
        }
        .foregroundStyle(Impala.text2)
        .padding(.horizontal, Space.s2)
        .padding(.vertical, Space.s1)
        .contentShape(Rectangle())
    }
}

/// Gedankengang: fertig eingeklappt mit Wortzahl (`thinkBoxHtml`), live die letzten zwei Zeilen.
struct ThinkBox: View {
    let text: String
    let live: Bool
    @State private var expanded = false

    var body: some View {
        Button {
            withAnimation(.smooth(duration: 0.25)) { expanded.toggle() }
        } label: {
            VStack(alignment: .leading, spacing: Space.s1) {
                HStack(spacing: Space.s1) {
                    Icon("brain", size: 13)
                    Text(live ? "Gedankengang…" : "Gedankengang (\(words) Wörter)")
                        .font(.system(size: TextSize.xs, weight: .semibold))
                    Spacer(minLength: 0)
                    Icon("chevron-down", size: 11).rotationEffect(.degrees(expanded ? 180 : 0))
                }
                if expanded || live {
                    Text(shown)
                        .font(.system(size: TextSize.xs).italic())
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .foregroundStyle(Impala.text2)
            .padding(Space.s2)
            .overlay(RoundedRectangle(cornerRadius: Radius.sm, style: .continuous).stroke(Impala.edgeSoft))
        }
        .buttonStyle(.plain)
    }

    private var words: Int { text.split(whereSeparator: \.isWhitespace).count }

    private var shown: String {
        if expanded { return text }
        return text.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\n").suffix(2).joined(separator: "\n")
    }
}

/// Werkzeug-Chip („Seite gelesen · …“).
private struct ToolChip: View {
    let name: String
    let detail: String?
    let error: Bool

    var body: some View {
        HStack(spacing: Space.s1) {
            Icon("gear", size: 12)
            Text(label).font(.system(size: TextSize.xs)).lineLimit(2)
        }
        .foregroundStyle(error ? Impala.danger : Impala.text2)
        .padding(.horizontal, Space.s2)
        .padding(.vertical, Space.s1)
        .overlay(RoundedRectangle(cornerRadius: Radius.sm, style: .continuous).stroke(Impala.edgeSoft))
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var label: String {
        var s = toolLabel(name)
        if let d = detail?.trimmingCharacters(in: .whitespaces), !d.isEmpty { s += " · " + d }
        if error { s += " — Fehler" }
        return s
    }
}

/// Änderungs-Karte mit „Rückgängig“ (`editCardHtml`).
private struct EditCard: View {
    let summary: String
    let undone: Bool
    let enabled: Bool
    let onUndo: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s1) {
            Text(summary).font(.system(size: TextSize.sm, weight: .semibold)).foregroundStyle(Impala.text)
            HStack {
                Text(undone ? "Rückgängig gemacht" : "Atomar gespeichert")
                    .font(.system(size: TextSize.xs))
                    .foregroundStyle(Impala.text2)
                    .contentTransition(.opacity)
                Spacer()
                Button(action: onUndo) {
                    Text("↺ Rückgängig")
                        .font(.system(size: TextSize.xs, weight: .medium))
                        .foregroundStyle(undone ? Impala.text2.opacity(0.4) : Impala.accent)
                        .padding(.horizontal, Space.s2)
                        .padding(.vertical, Space.s1)
                }
                .pressable()
                .disabled(undone || !enabled)
            }
        }
        .padding(Space.s3)
        .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.md, style: .continuous).stroke(Impala.edge))
        .animation(.smooth, value: undone)
        .sensoryFeedback(.impact(weight: .light), trigger: undone)
    }
}

/// Rückfrage (`ask_choice`, Bestätigung löschender Änderungen): Optionen als Knöpfe.
private struct QuestionCard: View {
    let message: ChatMessage
    let onAnswer: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s2) {
            Text("Rückfrage").font(.system(size: TextSize.xs, weight: .semibold)).foregroundStyle(Impala.text2)
            Text(message.question ?? "").font(.system(size: TextSize.base)).foregroundStyle(Impala.text)
            if message.answered == true {
                HStack(spacing: Space.s1) {
                    Icon("check", size: 14).foregroundStyle(Impala.success)
                    Text(message.answer ?? "").font(.system(size: TextSize.sm, weight: .semibold)).foregroundStyle(Impala.text)
                }
                .transition(.blurReplace)
            } else {
                ForEach(message.options ?? [], id: \.self) { option in
                    Button { onAnswer(option) } label: {
                        Text(option)
                            .font(.system(size: TextSize.sm))
                            .foregroundStyle(Impala.text)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, Space.s3)
                            .padding(.vertical, Space.s2)
                            .overlay(RoundedRectangle(cornerRadius: Radius.sm, style: .continuous).stroke(Impala.edge))
                    }
                    .pressable()
                }
            }
        }
        .padding(Space.s3)
        .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.md, style: .continuous).stroke(Impala.edge))
        .animation(.smooth, value: message.answered)
    }
}

/// Antwort in Arbeit: Gedankengang, gestreamter Entwurf oder Statuszeile.
struct LiveBlock: View {
    let thinking: String
    let draft: String
    let tool: String?
    @Environment(ImpalaStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s2) {
            if !thinking.isEmpty { ThinkBox(text: thinking, live: true) }
            if !draft.isEmpty {
                MarkdownView(draft, core: store.core)
            } else {
                Text(tool.map { toolLabel($0) + " …" } ?? "Denkt nach…")
                    .font(.system(size: TextSize.sm).italic())
                    .foregroundStyle(Impala.text2)
                    .phaseAnimator([0.45, 1]) { t, o in t.opacity(o) } animation: { _ in .easeInOut(duration: 0.8) }
                    .contentTransition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Abbruch oder Fehler des Laufs; bei Fehlern der Weg zu den KI-Einstellungen.
struct ChatErrorBox: View {
    let error: ChatRunError
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s2) {
            if error.aborted {
                if !error.partial.isEmpty { MarkdownView(error.partial, core: store.core) }
                Text("(Abgebrochen.)").font(.system(size: TextSize.sm).italic()).foregroundStyle(Impala.text2)
            } else {
                Text("Fehler: " + error.message).font(.system(size: TextSize.sm)).foregroundStyle(Impala.danger)
                Button("KI-Einstellungen öffnen") { shell.sheet = .settings }
                    .font(.system(size: TextSize.sm, weight: .medium))
                    .tint(Impala.accent)
            }
        }
        .padding(Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(error.aborted ? Impala.surface : Impala.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
    }
}

/// Werkzeugnamen wie `TOOL_LABELS` in web/render.js.
func toolLabel(_ name: String) -> String { toolLabels[name] ?? name }

private let toolLabels: [String: String] = [
    "inspect": "App-Daten gelesen", "change": "Änderungen ausgeführt", "view_heft_page": "Heftseite angesehen",
    "read_page": "Seite gelesen", "search_notes": "Notizen durchsucht", "semantic_search": "Semantische Suche",
    "create_page": "Seite erstellt", "append_to_page": "Seite ergänzt", "replace_page_content": "Seite überschrieben",
    "create_flashcard": "Karteikarte erstellt", "create_cloze_card": "Cloze-Karten erstellt", "move_page": "Seite verschoben",
    "list_pages": "Seiten aufgelistet", "list_due_cards": "Fällige Karten", "send_to_notebooklm": "An NotebookLM",
    "ask_choice": "Rückfrage gestellt", "delete_page": "Seite gelöscht", "delete_flashcard": "Karte gelöscht",
    "delete_deck": "Stapel gelöscht", "create_flashcards": "Karteikarten erstellt", "delete_flashcards": "Karten gelöscht",
    "list_flashcards": "Karten durchgesehen", "list_decks": "Stapel aufgelistet", "create_deck": "Stapel angelegt",
    "rename_deck": "Stapel umbenannt", "move_deck": "Stapel verschoben", "move_flashcards": "Karten verschoben",
    "update_flashcard": "Karte überarbeitet", "suspend_flashcards": "Karten pausiert",
    "reset_card_progress": "Lernfortschritt zurückgesetzt", "get_context": "Kontext geholt",
    "write_to_heft": "Ins Heft geschrieben", "get_heft_page_image": "Heftseite angesehen",
    "search_chat_history": "Frühere Chats durchsucht", "calculate": "Gerechnet", "request_tools": "Werkzeuge freigeschaltet",
]
