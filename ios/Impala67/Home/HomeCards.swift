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
    /// Gemerktes Tagesergebnis: Tag, Karte und deren Vorderseite (zum Erkennen von Änderungen).
    private static let lock = NSLock()
    private static var cached: (day: Int64, recall: Recall, front: String)?

    private static func today() -> Int64 {
        let offsetMs = TimeZone.current.secondsFromGMT() * 1000
        return Int64(Date().timeIntervalSince1970 * 1000 + Double(offsetMs)) / 86_400_000
    }

    /// Das Tagesergebnis aus dem Zwischenspeicher, solange der Tag gleich ist und die Karte noch gelernt,
    /// unverändert und nicht archiviert/gelöscht/pausiert ist (ein billiger Einzelzugriff); sonst neu gewählt.
    static func current(core: ImpalaCore) -> Recall? {
        lock.lock()
        let hit = cached
        lock.unlock()
        if let hit, hit.day == today(), let card = core.card(id: hit.recall.cardId),
           !card.suspended, !card.archived, !card.trashed, card.stage == .review, card.front == hit.front {
            return hit.recall
        }
        return compute(core: core)
    }

    /// Geht alle Karten durch: nur über `current` und im Hintergrund aufrufen.
    private static func compute(core: ImpalaCore) -> Recall? {
        let allDecks = core.decks()
        let cards = allDecks.flatMap { core.cardsInDeck(deck: $0.name) }
        let pool = cards.filter { !$0.suspended && !$0.archived && !$0.trashed && $0.stage == .review && markdownCardText(markdown: $0.front).count >= 3 }
        guard pool.count >= 5 else { return nil }

        let day = today()
        let hash = (UInt32(truncatingIfNeeded: day) &* 2654435761)
        let index = Int(hash % UInt32(pool.count))
        let card = pool[index]

        let question: String
        let answer: String
        if let cloze = clozeRecall(front: card.front) {
            question = markdownCardText(markdown: cloze.question)
            answer = cloze.answers.map { markdownCardText(markdown: $0) }.joined(separator: " · ")
        } else {
            question = markdownCardText(markdown: card.front)
            answer = markdownCardText(markdown: card.back)
        }

        guard !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let qCut = String(question.prefix(140))
        let aCut = String(answer.prefix(220))
        let result = Recall(cardId: card.id, deck: card.deck, question: qCut, answer: aCut)
        lock.lock()
        cached = (day, result, card.front)
        lock.unlock()
        return result
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
    let wide: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: wide ? 5 : 3) {
            if lines.isEmpty {
                Spacer()
                Text("Leere Seite")
                    .font(.system(size: wide ? 12 : 10, weight: .regular))
                    .foregroundStyle(Impala.text2.opacity(0.7))
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer()
            } else {
                ForEach(Array(lines.prefix(wide ? 7 : 3).enumerated()), id: \.offset) { _, line in
                    Text(line)
                        .font(.system(size: wide ? 12 : 9, weight: .regular))
                        .foregroundStyle(Impala.text2)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(wide ? 14 : 8)
        .frame(maxWidth: wide ? .infinity : 110, alignment: .topLeading)
        .frame(width: wide ? nil : 110, height: wide ? 185 : 74, alignment: .topLeading)
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

/// Vorschau für Hefte: Miniatur-Vorschau der zuletzt geöffneten Seite.
private struct HeftThumbnailPreview: View {
    let core: ImpalaCore
    let page: PageSummary
    let heftPageId: String?
    let wide: Bool
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
                PageIcon(page: page, size: wide ? 30 : 22)
                    .foregroundStyle(Impala.accent.opacity(0.4))
            }
        }
        .frame(maxWidth: wide ? .infinity : 110)
        .frame(width: wide ? nil : 110, height: wide ? 185 : 74)
        .clipShape(RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .stroke(Impala.edgeSoft, lineWidth: 1)
        )
        .task(id: "\(page.id)|\(heftPageId ?? "")|\(page.updated)|\(wide)") {
            guard let targetId = heftPageId else {
                thumbnail = nil
                return
            }
            // Volle Seiten zu rendern dauert Sekunden – nie auf dem Hauptthread.
            let core = core, pageId = page.id, scale = displayScale
            let renderWidth: CGFloat = wide ? 440 : 220
            let image = await Task.detached(priority: .utility) { () -> UIImage? in
                HeftExport.renderPage(core: core, pageId: pageId, heftPageId: targetId, width: renderWidth, scale: scale, imagePixels: 512)
            }.value
            guard !Task.isCancelled else { return }
            thumbnail = image
        }
    }
}

/// Vorschau für PDF-Dokumente.
private struct PdfPreview: View {
    let wide: Bool

    var body: some View {
        ZStack {
            Impala.surface
            Text("PDF")
                .font(.system(size: wide ? 13 : 11, weight: .semibold))
                .foregroundStyle(Impala.accent)
                .padding(.horizontal, wide ? 12 : 8)
                .padding(.vertical, wide ? 5 : 3)
                .background(Impala.accent.opacity(0.1), in: Capsule())
        }
        .frame(maxWidth: wide ? .infinity : 110)
        .frame(width: wide ? nil : 110, height: wide ? 185 : 74)
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
    let excerpt: [String]
    let heftPageIds: [String]
    let wide: Bool
    @Environment(ImpalaStore.self) private var store

    var body: some View {
        Group {
            if wide {
                VStack(alignment: .leading, spacing: Space.s3) {
                    preview
                    copy
                }
            } else {
                HStack(spacing: Space.s4) {
                    preview
                    copy
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Impala.panel, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous).stroke(Impala.edgeSoft, lineWidth: 1))
    }

    private var copy: some View {
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
    }

    private var activeHeftIndex: Int {
        guard !heftPageIds.isEmpty else { return 0 }
        let saved = HeftLastPage.index[page.id] ?? 0
        return min(max(0, saved), heftPageIds.count - 1)
    }

    private var activeHeftPageId: String? {
        guard !heftPageIds.isEmpty else { return nil }
        return heftPageIds[activeHeftIndex]
    }

    @ViewBuilder
    private var preview: some View {
        if page.kind == .heft {
            HeftThumbnailPreview(core: store.core, page: page, heftPageId: activeHeftPageId, wide: wide)
        } else if page.pdfId != nil {
            PdfPreview(wide: wide)
        } else {
            NoteExcerptPreview(lines: excerpt, wide: wide)
        }
    }

    private var metaText: String {
        let when = HomeFormat.whenText(page.updated)
        let whenSuffix = when.isEmpty ? "" : " · \(when)"
        if page.kind == .heft {
            let count = heftPageIds.count
            let at = count > 0 ? activeHeftIndex + 1 : 1
            let countText = count > 1 ? "Heft · Seite \(at) von \(count)" : "Heft"
            return "\(countText)\(whenSuffix)"
        } else if page.pdfId != nil {
            return "PDF\(whenSuffix)"
        } else {
            return "Notiz\(whenSuffix)"
        }
    }
}

/// Leerer Zustand für „Weitermachen“ wie `.hv-continue.empty` in der PWA.
struct EmptyContinueCard: View {
    let wide: Bool

    var body: some View {
        let badge = ZStack {
            Impala.surface
            Icon("plus", size: wide ? 24 : 18)
                .foregroundStyle(Impala.accent)
        }
        .frame(maxWidth: wide ? .infinity : 110)
        .frame(width: wide ? nil : 110, height: wide ? 185 : 74)
        .clipShape(RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .stroke(Impala.edgeSoft, lineWidth: 1)
        )

        let copy = VStack(alignment: .leading, spacing: 3) {
            Text("Noch keine Seiten")
                .font(.system(size: TextSize.xs, weight: .semibold))
                .foregroundStyle(Impala.text2)
            Text("Erste Seite anlegen")
                .font(.system(size: TextSize.lg, weight: .semibold))
                .foregroundStyle(Impala.text)
                .lineLimit(1)
        }

        Group {
            if wide {
                VStack(alignment: .leading, spacing: Space.s3) {
                    badge
                    copy
                }
            } else {
                HStack(spacing: Space.s4) {
                    badge
                    copy
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Impala.panel, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous).stroke(Impala.edgeSoft, lineWidth: 1))
    }
}
