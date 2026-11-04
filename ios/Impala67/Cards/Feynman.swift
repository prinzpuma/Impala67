import SwiftUI

/// Ergebnis der KI-Prüfung (experimente.js `checkFeynman`, `Feynman.kt`): Rubrik und vorgeschlagene Note 1–4.
struct FeynmanVerdict: Equatable {
    let cardId: String
    let hit: [String]
    let missing: [String]
    let wrong: [String]
    let comment: String
    let note: Int

    static let gradeNames = [1: "Nochmal", 2: "Schwer", 3: "Gut", 4: "Einfach"]

    /// Erklärung gegen die Rückseite prüfen lassen (gleicher Prompt wie die PWA). Wirft bei KI-Fehlern.
    @MainActor
    static func check(chat: ChatModel, card: CardInfo, explanation: String) async throws -> FeynmanVerdict {
        let raw = try await chat.complete(
            "Karteikarte:\nFrage: \(card.front)\nMusterantwort: \(card.back)\n\nErklärung des Lernenden:\n"
                + explanation.trimmingCharacters(in: .whitespacesAndNewlines)
                + "\n\nBewerte die Erklärung als Rubrik. Antworte NUR als JSON:\n"
                + #"{"getroffen":["Kernpunkt …"],"fehlend":["…"],"falsch":["…"],"note":3,"kommentar":"1–2 Sätze"}"#
                + "\nnote: 1=Nochmal, 2=Schwer, 3=Gut, 4=Einfach.",
            system: "Du bist ein knapper, präziser Lern-Coach. Antworte auf Deutsch."
        )
        let json: [String: Any] = {
            guard let a = raw.firstIndex(of: "{"), let b = raw.lastIndex(of: "}"), a < b,
                  let obj = try? JSONSerialization.jsonObject(with: Data(raw[a...b].utf8)) as? [String: Any] else { return [:] }
            return obj
        }()
        func list(_ key: String) -> [String] {
            ((json[key] as? [Any]) ?? []).map { "\($0)" }.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        }
        let n = (json["note"] as? NSNumber)?.intValue ?? Int("\(json["note"] ?? "")") ?? 3
        return FeynmanVerdict(cardId: card.id, hit: list("getroffen"), missing: list("fehlend"), wrong: list("falsch"),
                              comment: (json["kommentar"] as? String) ?? "", note: (1...4).contains(n) ? n : 3)
    }
}

/// Erklär-Feld im Feynman-Lernmodus (render-anki.js `.feyn-inline`): tippen oder diktieren, ⌘↩ prüft.
/// „Prüfen & aufdecken“ deckt nach der Prüfung auf; „Ohne Erklärung aufdecken“ direkt (unten in den Aktionen).
struct FeynmanInput: View {
    @Binding var text: String
    let checking: Bool
    let onCheck: () -> Void
    @State private var dictation = Dictation()

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s2) {
            HStack(spacing: Space.s1) {
                Icon("explain", size: 15)
                Text("Erkläre die Antwort in eigenen Worten — so einfach, dass es ein Kind versteht.")
            }
            .font(.system(size: TextSize.sm))
            .foregroundStyle(Impala.text2)
            TextField("Meine Erklärung … (⌘↩ = prüfen)", text: $text, axis: .vertical)
                .lineLimit(4...10)
                .font(.system(size: TextSize.base))
                .padding(Space.s3)
                .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
                .disabled(checking)
                .onKeyPress(.return, phases: .down) { press in
                    guard press.modifiers.contains(.command) else { return .ignored }
                    onCheck()
                    return .handled
                }
            if dictation.listening {
                Text(dictation.partial.isEmpty ? "Ich höre zu …" : dictation.partial)
                    .font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2).lineLimit(2)
            }
            HStack(spacing: Space.s2) {
                TintButton(title: dictation.listening ? "Stopp" : "Diktieren") { dictation.toggle() }
                TintButton(title: checking ? "Prüfe …" : "Prüfen & aufdecken", strong: true) { if !checking { onCheck() } }
            }
        }
        .onAppear {
            dictation.onFinal = { said in
                let base = text.trimmingCharacters(in: .whitespaces)
                text = base.isEmpty ? said : base + " " + said
            }
        }
        .alert("Diktat", isPresented: Binding(get: { dictation.error != nil }, set: { if !$0 { dictation.error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(dictation.error ?? "") }
    }
}

/// Rubrik der KI über den Bewertungen (experimente.js `verdictHtml`).
struct FeynmanFeedback: View {
    let verdict: FeynmanVerdict

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(verdict.hit, id: \.self) { Text("✓ " + $0).foregroundStyle(Impala.success) }
            ForEach(verdict.missing, id: \.self) { Text("! fehlt: " + $0).foregroundStyle(Impala.warn) }
            ForEach(verdict.wrong, id: \.self) { Text("✗ " + $0).foregroundStyle(Impala.danger) }
            if !verdict.comment.isEmpty { Text(verdict.comment).foregroundStyle(Impala.text) }
            Text("KI-Vorschlag: „\(FeynmanVerdict.gradeNames[verdict.note] ?? "Gut")“ — bestätige mit den Bewertungs-Buttons. Die Entscheidung bleibt bei dir.")
                .fontWeight(.semibold)
                .foregroundStyle(Impala.text)
        }
        .font(.system(size: TextSize.sm))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Space.s3)
        .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
    }
}
