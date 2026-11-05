import SwiftUI

/// „Weißt du's noch?“: Frage und Antwort einer schon gelernten Karte.
struct Recall: Sendable, Equatable {
    let cardId: String
    let deck: String
    let question: String
    let answer: String
}

/// Wählt täglich eine gelernte Karte für „Weißt du's noch?“ (wie home-view.js / HomeViewModel.kt).
/// Geht alle Karten durch: nur im Hintergrund aufrufen.
enum HomeRecall {
    private static let clozeRegex = try? NSRegularExpression(pattern: #"\{\{c\d+::(.*?)(?:::[^}]*)?\}\}"#)

    static func compute(core: ImpalaCore) -> Recall? {
        let allDecks = core.decks()
        let cards = allDecks.flatMap { core.cardsInDeck(deck: $0.name) }
        let pool = cards.filter { !$0.suspended && !$0.archived && !$0.trashed && $0.stage == .review && markdownCardText(markdown: $0.front).count >= 3 }
        guard pool.count >= 5 else { return nil }

        let offsetMs = TimeZone.current.secondsFromGMT() * 1000
        let day = Int64(Date().timeIntervalSince1970 * 1000 + Double(offsetMs)) / 86_400_000
        let hash = (UInt32(truncatingIfNeeded: day) &* 2654435761)
        let index = Int(hash % UInt32(pool.count))
        let card = pool[index]

        let front = card.front
        var question: String
        var answer: String

        let nsFront = front as NSString
        let fullRange = NSRange(location: 0, length: nsFront.length)
        if let regex = clozeRegex, regex.firstMatch(in: front, range: fullRange) != nil {
            let matches = regex.matches(in: front, range: fullRange)
            let clozeReplaced = regex.stringByReplacingMatches(in: front, range: fullRange, withTemplate: "＿＿＿")
            question = markdownCardText(markdown: clozeReplaced)
            let answers = matches.compactMap { match -> String? in
                guard match.numberOfRanges > 1 else { return nil }
                let r = match.range(at: 1)
                guard r.location != NSNotFound else { return nil }
                let text = nsFront.substring(with: r)
                return markdownCardText(markdown: text)
            }
            answer = answers.joined(separator: " · ")
        } else {
            question = markdownCardText(markdown: front)
            answer = markdownCardText(markdown: card.back)
        }

        guard !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let qCut = String(question.prefix(140))
        let aCut = String(answer.prefix(220))
        return Recall(cardId: card.id, deck: card.deck, question: qCut, answer: aCut)
    }
}

/// „Weißt du's noch?“ (`.hv-recall`): täglich eine Zufallskarte aus den bereits gelernten Karten,
/// nur zum Aufdecken ohne Bewertung.
struct RecallCard: View {
    let recall: Recall
    let onOpenDeck: () -> Void

    @State private var isOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s2) {
            HStack {
                Text("Weißt du's noch?")
                    .font(.system(size: TextSize.xs, weight: .semibold))
                    .foregroundStyle(Impala.text2)
                Spacer()
                if !isOpen {
                    Text("Antwort zeigen")
                        .font(.system(size: TextSize.xs, weight: .semibold))
                        .foregroundStyle(Impala.accent)
                }
            }
            Text(recall.question)
                .font(.system(size: TextSize.md))
                .lineSpacing(4)
                .foregroundStyle(Impala.text)
                .frame(maxWidth: .infinity, alignment: .leading)

            if isOpen {
                Divider()
                    .overlay(Impala.edgeSoft)
                    .padding(.vertical, Space.s1)

                Text(recall.answer)
                    .font(.system(size: TextSize.md))
                    .lineSpacing(4)
                    .foregroundStyle(Impala.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transition(.opacity.combined(with: .move(edge: .top)))

                HStack {
                    Spacer()
                    Button(action: onOpenDeck) {
                        Text("Im Stapel lernen →")
                            .font(.system(size: TextSize.xs, weight: .semibold))
                            .foregroundStyle(Impala.accent)
                    }
                    .buttonStyle(.plain)
                    .padding(.top, Space.s1)
                }
            }
        }
        .padding(.horizontal, Space.s4)
        .padding(.vertical, Space.s3)
        .background(isOpen ? Impala.surface : Impala.activeTint, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                .stroke(isOpen ? Impala.edgeSoft : Color.clear, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .onTapGesture {
            withAnimation(.spring(duration: 0.35, bounce: 0.15)) {
                isOpen.toggle()
            }
        }
    }
}

/// Vorschau für Notizen: Auszug der ersten Zeilen (`mdExcerpt`).
private struct NoteExcerptPreview: View {
    let lines: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if lines.isEmpty {
                Spacer()
                Text("Leere Seite")
                    .font(.system(size: 10, weight: .regular))
                    .foregroundStyle(Impala.text2.opacity(0.7))
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer()
            } else {
                ForEach(lines.prefix(3).indices, id: \.self) { i in
                    Text(lines[i])
                        .font(.system(size: 9, weight: .regular))
                        .foregroundStyle(Impala.text2)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(8)
        .frame(width: 110, height: 74, alignment: .topLeading)
        .background(Impala.surface)
        .mask(
            LinearGradient(
                stops: [
                    .init(color: .black, location: 0),
                    .init(color: .black, location: 0.65),
                    .init(color: .black.opacity(0.1), location: 1.0)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .stroke(Impala.edgeSoft, lineWidth: 1)
        )
    }
}

/// Vorschau für Hefte: Miniatur-Vorschau der letzten Seite.
private struct HeftThumbnailPreview: View {
    let core: ImpalaCore
    let page: PageSummary
    @Environment(\.displayScale) private var displayScale
    @State private var thumbnail: UIImage?

    var body: some View {
        ZStack {
            Impala.paper
            if let thumbnail {
                Image(uiImage: thumbnail)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                PageIcon(page: page, size: 22)
                    .foregroundStyle(Impala.accent.opacity(0.4))
            }
        }
        .frame(width: 110, height: 74)
        .clipShape(RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .stroke(Impala.edgeSoft, lineWidth: 1)
        )
        .task(id: "\(page.id)|\(page.updated)") {
            // Volle Seiten zu rendern dauert Sekunden – nie auf dem Hauptthread.
            let core = core, pageId = page.id, scale = displayScale
            let image = await Task.detached(priority: .utility) { () -> UIImage? in
                guard let last = core.heftPageIds(pageId: pageId).last else { return nil }
                return HeftExport.renderPage(core: core, pageId: pageId, heftPageId: last, width: 220, scale: scale, imagePixels: 512)
            }.value
            guard !Task.isCancelled else { return }
            thumbnail = image
        }
    }
}

/// Vorschau für PDF-Dokumente.
private struct PdfPreview: View {
    var body: some View {
        ZStack {
            Impala.surface
            Text("PDF")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Impala.accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Impala.accent.opacity(0.1), in: Capsule())
        }
        .frame(width: 110, height: 74)
        .clipShape(RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .stroke(Impala.edgeSoft, lineWidth: 1)
        )
    }
}

/// `.hv-continue`: Karte mit Vorschau, „Weitermachen“, Titel und Zeitpunkt.
struct ContinueCard: View {
    let page: PageSummary
    @Environment(ImpalaStore.self) private var store

    var body: some View {
        HStack(spacing: Space.s4) {
            preview
            VStack(alignment: .leading, spacing: 3) {
                Text("Weitermachen")
                    .font(.system(size: TextSize.xs, weight: .semibold))
                    .foregroundStyle(Impala.text2)
                Text(PageStyle.title(page))
                    .font(.system(size: TextSize.lg, weight: .semibold))
                    .foregroundStyle(Impala.text)
                    .lineLimit(1)
                Text(metaText)
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)
            }
            Spacer(minLength: 0)
        }
        .padding(Space.s3)
        .background(Impala.panel, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous).stroke(Impala.edgeSoft, lineWidth: 1))
    }

    @ViewBuilder
    private var preview: some View {
        if page.kind == .heft {
            HeftThumbnailPreview(core: store.core, page: page)
        } else if page.pdfId != nil {
            PdfPreview()
        } else {
            let content = store.core.page(id: page.id)?.content ?? ""
            let excerpt = markdownExcerpt(title: page.title, content: content)
            NoteExcerptPreview(lines: excerpt)
        }
    }

    private var metaText: String {
        let when = HomeFormat.whenText(page.updated)
        let whenSuffix = when.isEmpty ? "" : " · \(when)"
        if page.kind == .heft {
            let count = store.core.heftPageIds(pageId: page.id).count
            let countText = count > 1 ? "Heft · Seite \(count) von \(count)" : "Heft"
            return "\(countText)\(whenSuffix)"
        } else if page.pdfId != nil {
            return "PDF\(whenSuffix)"
        } else {
            return "Notiz\(whenSuffix)"
        }
    }
}
