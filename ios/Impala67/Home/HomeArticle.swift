import SwiftUI

/// Tagesartikel (web/home-article.js): Die KI fasst Notizen einmal am Tag als kurzen Artikel zusammen.
/// Speichern, Gelesen und Sync macht der Kern (`homeArticles`, `saveHomeArticle`, `markHomeArticleRead`);
/// liegt der Artikel eines anderen Geräts schon vor, schreibt das iPad keinen eigenen. Geschrieben wird
/// über den Rust-Assistenten (`AiAssistant.complete`, gleiche Anweisung wie die PWA).
///
/// Auswahl vereinfacht gegenüber der PWA (ohne Fach-Erkennung `FACH`): Thema aus `homeArticleTopics`
/// (das am längsten nicht behandelte), daraus bevorzugt Notizen, die in den letzten 7 Artikeln nicht
/// vorkamen, neueste zuerst; archivierte nur als Randnotiz. Kandidat für den Kern.
@MainActor @Observable
final class HomeArticleWriter {
    /// Eine Instanz je App-Start (die Startseite wird bei jedem Tabwechsel neu gebaut).
    static let shared = HomeArticleWriter()

    enum Phase { case idle, busy }

    private(set) var phase = Phase.idle
    private(set) var error = ""
    /// Ein automatischer Versuch je App-Start (wie `tried`).
    @ObservationIgnored private var tried = false

    private static let recent = 7, activeNotes = 4, archivedNotes = 2, minText = 40
    private static let noteChars = 1800, archivedChars = 500, notesTotal = 9000

    static func enabled(_ core: ImpalaCore) -> Bool { HomeSettings.read(core).article }

    /// Der Artikel für die Startseite: der neueste, solange er ungelesen oder von heute ist.
    static func current(_ list: [HomeArticleInfo]) -> HomeArticleInfo? {
        guard let a = list.first, a.readAt == nil || a.day == ISODate.today() else { return nil }
        return a
    }

    private static func due(_ core: ImpalaCore) -> Bool {
        guard let a = core.homeArticles(limit: 1).first else { return true }
        return a.readAt != nil && a.day != ISODate.today()
    }

    /// Startet höchstens einen Versuch je App-Start, leicht verzögert; automatisch nur bei erreichbarer KI.
    func ensure(core: ImpalaCore, chat: ChatModel, manual: Bool = false) {
        guard !tried, phase == .idle, Self.enabled(core), Self.due(core) else { return }
        tried = true
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            guard Self.due(core) else { return }
            if !manual && chat.online == false { error = "KI nicht erreichbar."; return }
            phase = .busy
            error = ""
            do {
                let input = try await write(core: core, chat: chat)
                if Self.due(core) { _ = try core.saveHomeArticle(input: input) }
            } catch {
                self.error = (error as? ArticleError)?.text ?? ChatModel.describe(error)
            }
            phase = .idle
        }
    }

    func retry(core: ImpalaCore, chat: ChatModel) {
        guard phase == .idle else { return }
        tried = false
        ensure(core: core, chat: chat, manual: true)
    }

    private struct Note {
        let id: String
        let title: String
        let text: String
        let archived: Bool
    }

    private struct ArticleError: Error { let text: String }

    private func write(core: ImpalaCore, chat: ChatModel) async throws -> HomeArticleInput {
        let history = core.homeArticles(limit: 30)
        let topic = Self.pickTopic(HomeSettings.read(core).topics, history)
        let notes = Self.chooseNotes(core: core, ids: Self.pool(core: core, topic: topic), history: history)
        if notes.isEmpty && topic == nil {
            throw ArticleError(text: "Noch keine Notizen mit Inhalt — trag Themen in den Einstellungen ein.")
        }
        let subject = topic ?? notes.first?.title ?? "Notizen"
        let earlier = history.prefix(5).map { "„\($0.title)“" }.joined(separator: ", ")
        var prompt = "Schreibe einen kurzen Artikel (250–400 Wörter) über: \(subject).\n"
        prompt += notes.isEmpty
            ? "Zu diesem Thema gibt es noch keine Notizen — schreibe aus allgemeinem Wissen.\n"
            : "Grundlage sind meine Notizen unten: Fasse ihre Kernaussagen verständlich zusammen und verknüpfe sie. "
                + "Was nicht aus den Notizen stammt (Hintergrund, Beispiele, Zusammenhänge), schreibst du in einen eigenen Abschnitt „## Hintergrund“ am Ende. "
                + "Widerspricht eine Notiz gesichertem Wissen, weise im Hintergrund kurz darauf hin. "
                + "Archivierte Notizen sind älterer Stoff: höchstens am Rand als Verweis oder Zusammenhang erwähnen, nie zum Hauptthema machen.\n"
        if !earlier.isEmpty { prompt += "Frühere Artikel hießen \(earlier) — wähle einen anderen Schwerpunkt oder Blickwinkel.\n" }
        prompt += "Format: Erste Zeile „# Überschrift“ — sie nennt das konkrete Thema (z. B. „Wechselstrom mit komplexen Zeigern“), nicht nur das Fach. "
            + "Danach Markdown-Fließtext. Keine Einleitung wie „Hier ist dein Artikel“."
        for n in notes { prompt += "\n\n--- \(n.archived ? "Archivierte Notiz" : "Notiz"): \(n.title) ---\n\(n.text)" }

        let raw = try await chat.complete(prompt, system: "Du schreibst kurze, gut lesbare Wissensartikel auf Deutsch für Lernende. Sachlich, anschaulich, ohne Floskeln.")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { throw ArticleError(text: "Die KI hat keinen Text geliefert.") }
        var title = notes.first?.title ?? subject
        var body = raw
        if let first = raw.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first,
           first.hasPrefix("# ") {
            title = first.dropFirst(2).trimmingCharacters(in: .whitespaces)
            body = String(raw.dropFirst(first.count)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return HomeArticleInput(
            id: nil, day: ISODate.today(), title: title, body: body, topics: [subject], focus: nil,
            sources: notes.map { ArticleSource(id: $0.id, title: $0.title, archived: $0.archived) }
        )
    }

    /// Eigenes Thema: das am längsten nicht mehr behandelte (nie behandelte zuerst, in Eingabereihenfolge).
    private static func pickTopic(_ raw: String, _ history: [HomeArticleInfo]) -> String? {
        let own = raw.split(whereSeparator: { ",;\n".contains($0) })
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        guard !own.isEmpty else { return nil }
        func lastUse(_ t: String) -> Int {
            history.firstIndex { ($0.topics.first ?? "").lowercased() == t.lowercased() } ?? .max
        }
        return own.reduce(own[0]) { lastUse($1) > lastUse($0) ? $1 : $0 }
    }

    /// Notizen zum Thema: Seite gleichen Titels samt Unterseiten, sonst Treffer der Suche; ohne Thema alle.
    private static func pool(core: ImpalaCore, topic: String?) -> [String] {
        guard let topic else { return core.recentPages(limit: 200).map(\.id) + core.archivedPages().map(\.id) }
        if let root = core.findPageByTitle(title: topic), root.title.lowercased() == topic.lowercased() {
            return core.pageSubtree(id: root.id)
        }
        return Array(core.search(query: topic, includeArchived: true).prefix(8).map(\.pageId))
    }

    private static func chooseNotes(core: ImpalaCore, ids: [String], history: [HomeArticleInfo]) -> [Note] {
        let used = Set(history.prefix(recent).flatMap { $0.sources.map(\.id) })
        let usable = Array(Set(ids)).compactMap(core.page(id:))
            .filter { !$0.trashed && $0.summary.kind == .note && $0.content.trimmingCharacters(in: .whitespacesAndNewlines).count >= minText }
            .sorted { a, b in
                let ua = used.contains(a.summary.id), ub = used.contains(b.summary.id)
                return ua != ub ? !ua : a.summary.updated > b.summary.updated
            }
        let onlyArchived = !usable.contains { !$0.archived }
        let main = usable.filter { !$0.archived || onlyArchived }.prefix(activeNotes)
        let side = onlyArchived ? [] : usable.filter(\.archived).prefix(archivedNotes)
        var budget = notesTotal
        return (Array(main) + Array(side)).compactMap { p in
            let limit = min(p.archived ? archivedChars : noteChars, max(0, budget))
            let text = String(p.content.trimmingCharacters(in: .whitespacesAndNewlines).prefix(limit))
            budget -= text.count
            guard !text.isEmpty else { return nil }
            return Note(id: p.summary.id, title: p.summary.title.isEmpty ? "Ohne Titel" : p.summary.title, text: text, archived: p.archived)
        }
    }
}

// MARK: - Ansicht

/// Tagesartikel auf der Startseite (`homeHtml`): aufklappbar mit Anriss, Quellen und „Gelesen“; gelesen
/// nur ein Hinweis; während des Schreibens bzw. nach einem Fehler eine Zeile mit „Erneut versuchen“.
struct ArticleSection: View {
    let articles: [HomeArticleInfo]
    let writer: HomeArticleWriter
    let onRetry: () -> Void
    let onHistory: () -> Void
    @Environment(ImpalaStore.self) private var store

    var body: some View {
        let history = articles.count > 1 ? "Verlauf (\(articles.count))" : nil
        if let a = HomeArticleWriter.current(articles) {
            if a.readAt != nil {
                note {
                    Text("Tagesartikel „\(a.title)“ gelesen. ")
                    LinkButton("Nochmal lesen", action: onHistory)
                }
            } else {
                ArticleCard(article: a, history: history, onHistory: onHistory) {
                    attempt(try store.core.markHomeArticleRead(id: a.id), "markHomeArticleRead")
                }
            }
        } else if writer.phase == .busy {
            note {
                ProgressView().controlSize(.small)
                Text("Dein Tagesartikel wird geschrieben …")
            }
        } else if !writer.error.isEmpty {
            note {
                Text("Kein Tagesartikel: \(writer.error) ")
                LinkButton("Erneut versuchen", action: onRetry)
                if let history { LinkButton(history, action: onHistory) }
            }
        }
    }

    private func note<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        HStack(spacing: Space.s2) { content() }
            .font(.system(size: TextSize.sm))
            .foregroundStyle(Impala.text2)
            .padding(.top, Space.s4)
            .transition(.opacity)
    }
}

/// `.hv-article`: Karte mit Thema, Titel und Anriss; Antippen klappt den Artikel weich auf.
private struct ArticleCard: View {
    let article: HomeArticleInfo
    let history: String?
    let onHistory: () -> Void
    let onRead: () -> Void
    @State private var open = false
    @Environment(ImpalaStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s1) {
            Button {
                withAnimation(.spring(duration: 0.45, bounce: 0.12)) { open.toggle() }
            } label: {
                VStack(alignment: .leading, spacing: Space.s1) {
                    Text("Tagesartikel · " + article.topics.joined(separator: " · "))
                        .font(.system(size: TextSize.xs, weight: .semibold)).foregroundStyle(Impala.text2)
                    Text(article.title).font(.system(size: TextSize.lg, weight: .semibold)).foregroundStyle(Impala.text)
                        .multilineTextAlignment(.leading)
                    if !open {
                        Text(markdownTeaser(body: article.body))
                            .font(.system(size: TextSize.md)).foregroundStyle(Impala.text2).lineSpacing(4)
                            .multilineTextAlignment(.leading)
                        Text("Weiterlesen").font(.system(size: TextSize.xs)).foregroundStyle(Impala.accent).padding(.top, Space.s1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            if open {
                VStack(alignment: .leading, spacing: Space.s3) {
                    Divider().overlay(Impala.edgeSoft)
                    MarkdownView(article.body, core: store.core).frame(maxWidth: 640, alignment: .leading)
                    ArticleSources(sources: article.sources)
                    HStack(spacing: Space.s4) {
                        Button(action: onRead) {
                            Text("Gelesen").font(.system(size: TextSize.sm, weight: .semibold)).foregroundStyle(Impala.accent)
                                .padding(.horizontal, 14).frame(minHeight: 36)
                                .background(Impala.accent.opacity(0.09), in: Capsule())
                                .overlay(Capsule().stroke(Impala.accent.opacity(0.36), lineWidth: 1))
                        }
                        .pressable()
                        .sensoryFeedback(.success, trigger: article.readAt != nil)
                        if let history { LinkButton(history, action: onHistory) }
                    }
                    .padding(.top, Space.s2)
                }
                .padding(.top, Space.s3)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.horizontal, Space.s6)
        .padding(.vertical, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(open ? Impala.surface : Impala.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(open ? Impala.edgeSoft : .clear, lineWidth: 1))
        .padding(.top, Space.s6)
    }
}

/// „Aus deinen Notizen“ (`.hv-article-src`): Quellen als Pillen, Antippen öffnet die Seite.
private struct ArticleSources: View {
    let sources: [ArticleSource]
    var onOpen: (() -> Void)?
    @Environment(ShellModel.self) private var shell

    var body: some View {
        if !sources.isEmpty {
            VStack(alignment: .leading, spacing: Space.s2) {
                Text("Aus deinen Notizen").font(.system(size: TextSize.xs, weight: .semibold)).foregroundStyle(Impala.text2)
                ScrollView(.horizontal) {
                    HStack(spacing: Space.s2) {
                        ForEach(sources, id: \.id) { s in
                            Button {
                                shell.open(s.id)
                                onOpen?()
                            } label: {
                                Text(s.title + (s.archived ? " · Archiv" : ""))
                                    .font(.system(size: TextSize.sm, weight: .medium)).foregroundStyle(Impala.text)
                                    .padding(.horizontal, 14).frame(minHeight: 34)
                                    .background(Impala.accent.opacity(0.09), in: Capsule())
                            }
                            .pressable()
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
            .padding(.top, Space.s2)
        }
    }
}

/// Verlauf der Tagesartikel (`openHistory`): neueste zuerst und aufgeklappt.
struct ArticleHistorySheet: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var open: Set<String> = []

    var body: some View {
        let _ = store.homeRevision
        let list = store.core.homeArticles(limit: 30)
        NavigationStack {
            List(list, id: \.id) { a in
                VStack(alignment: .leading, spacing: Space.s2) {
                    Button {
                        withAnimation(.smooth) { if open.contains(a.id) { open.remove(a.id) } else { open.insert(a.id) } }
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Self.date(a.created) + " · " + a.topics.joined(separator: " · "))
                                .font(.system(size: TextSize.xs, weight: .semibold)).foregroundStyle(Impala.text2)
                            Text(a.title).font(.system(size: TextSize.md, weight: .semibold)).foregroundStyle(Impala.text)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    if open.contains(a.id) {
                        MarkdownView(a.body, core: store.core)
                        ArticleSources(sources: a.sources) { dismiss() }
                    }
                }
                .padding(.vertical, Space.s1)
            }
            .listStyle(.plain)
            .overlay { if list.isEmpty { Placeholder(icon: "book-open", title: "Noch keine Artikel", text: "") } }
            .navigationTitle("Tagesartikel")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { CloseButton() } }
            .onAppear { if let first = list.first { open = [first.id] } }
        }
        .presentationDetents([.large])
    }

    /// `DATE_FMT` der PWA: „Mi., 4. Nov.“
    private static func date(_ iso: String) -> String {
        guard let d = ISODate.parse(iso) else { return "" }
        return d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).locale(Locale(identifier: "de_DE")))
    }
}

/// `.hv-link`: unterstrichener Text-Knopf.
struct LinkButton: View {
    let title: String
    let action: () -> Void

    init(_ title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    var body: some View {
        Button(title, action: action)
            .buttonStyle(.plain)
            .underline()
            .foregroundStyle(Impala.text2)
    }
}
