import Foundation
import Observation
import UIKit

/// Fehler eines Laufs; `aborted` = vom Nutzer gestoppt, `partial` = Teilantwort bis zum Abbruch.
struct ChatRunError: Equatable {
    let message: String
    let aborted: Bool
    var partial = ""
}

/// Wie viel vom Seitentext zuletzt mitging („Kontext: x von y Zeichen“).
struct ContextSent: Equatable {
    let pageId: String
    let sent: Int
    let total: Int
}

/// Umformulieren einer Antwort (chat-fullscreen.js `REFINE_PROMPTS`).
enum Refine: String, CaseIterable, Identifiable {
    case longer = "Länger", same = "Gleich", shorter = "Kürzer"
    var id: String { rawValue }
    var prompt: String {
        switch self {
        case .longer: "Bitte formuliere deine letzte Antwort ausführlicher und länger, mit mehr Details."
        case .same: "Bitte formuliere deine letzte Antwort in etwa gleicher Länge neu — anderer Wortlaut, gleicher Inhalt und Umfang."
        case .shorter: "Bitte formuliere deine letzte Antwort kürzer und knapper, auf das Wesentliche reduziert."
        }
    }
}

/// Zuletzt angezeigte Heftseite je Heft (Kontext und `view_heft_page` der KI).
@MainActor
enum HeftLastPage {
    static var index: [String: Int] = [:]
}

/// KI-Chat (wie `AiChatViewModel.kt`). Der Rust-Assistent (`AiAssistant.runAsync`) fährt die
/// Agent-Schleife mit Werkzeugen und speichert den Chat; hier landen nur seine Rückrufe im Zustand
/// (Entwurf, Gedankengang, Werkzeug, neue Einträge). Ein Lauf zur Zeit.
@MainActor @Observable
final class ChatModel {
    @ObservationIgnored private let core: ImpalaCore

    /// Offener Chat; leer = neuer Chat (die ID kommt mit dem Ende des ersten Laufs).
    private(set) var chatId = ""
    private(set) var messages: [ChatMessage] = []
    /// Antwortentwurf des laufenden Laufs (ganzer bisheriger Text).
    private(set) var draft = ""
    private(set) var thinking = ""
    private(set) var tool: String?
    private(set) var running = false
    /// Antwort, die gerade umformuliert wird (sie wird bis zum neuen Text durch den Entwurf ersetzt).
    private(set) var refining: String?
    private(set) var error: ChatRunError?
    private(set) var contextSent: ContextSent?
    /// Seiten, deren Inhalt nicht mitgeht (✕ am Seitenkontext-Chip, `S.contextOff`).
    var contextOff: Set<String> = []
    /// Kurzer Hinweis („Antwort kopiert.“), verschwindet von selbst.
    var notice: String?
    /// Rechtes KI-Panel aufgeklappt (Sparkles-Knopf unten rechts).
    var panelOpen = false
    /// Anhang der nächsten Nachricht (Bild, Datei, PDF, Heftseite).
    var attachment: ChatAttachment?
    /// Entwurf der Benutzereingabe (bleibt beim Tabwechsel erhalten).
    var inputDraft = ""

    /// Live-Modelle aller Quellen (`S.availableModels`), 30 s zwischengespeichert wie in ai.js.
    private(set) var models: [AiModel] = []
    private(set) var modelsLoading = false
    private(set) var modelsChecked = false
    @ObservationIgnored private var modelsAt = Date.distantPast

    @ObservationIgnored private var assistant: AiAssistant?
    @ObservationIgnored private var assistantKey = ""
    @ObservationIgnored private lazy var listener = RunListener(self)
    @ObservationIgnored private lazy var platform = RunPlatform(core: core)
    @ObservationIgnored private var runPageId: String?
    private static let draftInterval: TimeInterval = 0.08
    @ObservationIgnored private var pendingDraft: String?
    @ObservationIgnored private var draftFlush: Task<Void, Never>?
    @ObservationIgnored private var draftPublishedAt = Date.distantPast

    init(core: ImpalaCore) {
        self.core = core
    }

    var settings: AiSettings { AiSettings.read(core) }

    // MARK: Senden

    /// Schickt eine Nachricht in den offenen (oder einen neuen) Chat; `activePageId`: geöffnete Seite als Kontext.
    func send(_ text: String, activePageId: String?) {
        let prompt = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty, !running else { return }
        error = nil
        let att = attachment
        attachment = nil
        var image: String?, textFile: AiFile?, pdfFile: AiFile?
        switch att?.kind {
        case .image(let url)?: image = url
        case .text(let f)?: textFile = f
        case .pdf(let f)?: pdfFile = f
        case nil: break
        }
        var mine = Self.message(role: "user", content: prompt)
        mine.image = image
        if let att { mine.extraJson = att.extraJson }
        messages.append(mine)
        resetLive()
        running = true
        runPageId = activePageId
        let request = AiRunRequest(
            chatId: chatId,
            text: prompt,
            image: image,
            textFile: textFile,
            pdfFile: pdfFile,
            activePageId: activePageId,
            heftPageIndex: activePageId.flatMap { HeftLastPage.index[$0] }.map { UInt32($0) },
            sendPageContext: activePageId.map { !contextOff.contains($0) } ?? false,
            anki: nil,
            useRag: false,
            utcOffsetMinutes: Int32(TimeZone.current.secondsFromGMT() / 60)
        )
        makeAssistant().runAsync(request: request, listener: listener)
    }

    /// Stopp-Knopf: bricht den Lauf ab; eine offene Rückfrage endet ohne Antwort.
    func stop() {
        assistant?.cancel()
        _ = platform.respond(nil)
    }

    /// Antwort auf eine Rückfrage (blockiert den Lauf-Thread bis hierher).
    func answer(_ mid: String, option: String) {
        guard platform.respond(option) else { return }
        if let i = messages.firstIndex(where: { $0.mid == mid }) {
            messages[i].answered = true
            messages[i].answer = option
        }
    }

    /// Eine KI-Änderung (Karte `edit`) zurücknehmen.
    func undo(_ mid: String) {
        guard !running, !chatId.isEmpty else { return }
        do { try core.undoAiChange(chatId: chatId, messageId: mid) } catch { show("Rückgängig fehlgeschlagen: \(error.localizedDescription)") }
        reload()
    }

    /// Stift an einer Nutzernachricht: ihr Text kommt zurück ins Feld, sie und alles danach fällt weg.
    /// Gesperrt, solange spätere KI-Änderungen nicht rückgängig gemacht sind.
    func editFrom(_ mid: String) -> String? {
        guard !running, let i = messages.firstIndex(where: { $0.mid == mid }) else { return nil }
        if messages[i...].contains(where: { $0.role == "edit" && $0.undone != true }) {
            show("Erst die späteren Seitenänderungen rückgängig machen, dann bearbeiten.")
            return nil
        }
        let text = messages[i].content ?? ""
        messages = Array(messages[..<i])
        error = nil
        persist()
        assistant?.forgetChatState(chatId: chatId)
        return text
    }

    /// „Anpassen“ einer Antwort: ersetzt sie an ihrer Stelle (Text kommt gestreamt als Entwurf).
    func refine(_ mid: String, _ mode: Refine) {
        guard !running, let idx = messages.firstIndex(where: { $0.mid == mid && $0.role == "assistant" }) else { return }
        let history: [[String: String]] = messages[...idx]
            .filter { $0.role == "user" || $0.role == "assistant" }
            .map { ["role": $0.role, "content": $0.content ?? ""] }
        let json = String(decoding: (try? JSONSerialization.data(withJSONObject: history)) ?? Data("[]".utf8), as: UTF8.self)
        running = true
        refining = mid
        clearDraft()
        let assistant = makeAssistant()
        let listener = listener
        let offset = Int32(TimeZone.current.secondsFromGMT() / 60)
        Task.detached {
            let result = Result<String, Error>(catching: { try assistant.refine(historyJson: json, instruction: mode.prompt, utcOffsetMinutes: offset, listener: listener) })
            await MainActor.run { self.finishRefine(mid, result) }
        }
    }

    private func finishRefine(_ mid: String, _ result: Result<String, Error>) {
        switch result {
        case .success(let text):
            if let i = messages.firstIndex(where: { $0.mid == mid }) {
                messages[i].content = text
                messages[i].reasoning = nil
            }
            persist()
        case .failure(let e):
            if let f = e as? AiFailure, case .Aborted = f {} else { show("Anpassen fehlgeschlagen: \(Self.describe(e))") }
        }
        refining = nil
        finishRun()
    }

    // MARK: Chats

    /// Vorhandenen Chat öffnen (nicht während eines Laufs).
    func open(_ id: String, reveal: Bool = true) {
        guard !running else { return }
        if id != chatId { messages = core.chat(id: id)?.messages ?? [] }
        chatId = id
        error = nil
        if reveal { panelOpenIfNeeded() }
    }

    /// Leeren Chat beginnen (nicht während eines Laufs).
    func newChat(reveal: Bool = true) {
        guard !running else { return }
        chatId = ""
        messages = []
        error = nil
        if reveal { panelOpenIfNeeded() }
    }

    /// Chats löschen; den laufenden Chat nicht während seiner Antwort.
    func delete(_ ids: Set<String>) {
        let gone = ids.subtracting(running ? [chatId] : [])
        for id in gone { attempt("deleteChat", { try core.deleteChat(id: id) }) }
        if gone.contains(chatId) { chatId = ""; messages = []; error = nil }
    }

    /// Umbenennen; leerer Titel bleibt beim alten.
    func rename(_ id: String, _ title: String) {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, var chat = core.chat(id: id) else { return }
        chat.title = t
        _ = attempt("saveChat", { try core.saveChat(chat: chat) })
    }

    /// Fremde Änderung am offenen Chat (Sync) nachladen.
    func reloadIfIdle() {
        if !running { reload() }
    }

    // MARK: Modelle

    /// Modell-Liste neu holen, wenn sie älter als 30 s ist (Menü, Status-Chip, Einstellungen).
    func refreshModels(force: Bool = false) {
        guard !modelsLoading, force || Date().timeIntervalSince(modelsAt) > 30 else { return }
        modelsLoading = true
        let core = core
        let json = settings.providersJson
        Task.detached {
            let list = attempt("aiListModelsWith", { try core.aiListModelsWith(providersJson: json) })
            await MainActor.run {
                if let list { self.models = list; self.modelsAt = Date() }
                self.modelsLoading = false
                self.modelsChecked = true
            }
        }
    }

    /// Erreichbar, wenn die gewählte Quelle Modelle liefert (render.js `KI online`).
    var online: Bool? {
        guard modelsChecked, !modelsLoading else { return nil }
        let active = settings.activeId
        return models.contains { $0.providerId == active }
    }

    func select(_ m: AiModel) { AiSettings.select(core, providerId: m.providerId, model: m.id) }

    func setThinking(_ on: Bool) { AiSettings.patch(core, ["thinkingEnabled": on]) }

    func show(_ text: String) {
        notice = text
        Task { try? await Task.sleep(for: .seconds(2.2)); if notice == text { notice = nil } }
    }

    // MARK: Rückrufe des Laufs (Hauptthread)

    /// Entwurf höchstens alle 80 ms an die Ansicht geben (ai.js: Stream-Render alle 80 ms); der letzte Stand
    /// kommt immer an (verzögert nachgereicht, vor einem Fehler/Abbruch sofort).
    fileprivate func onDraft(_ text: String) {
        let wait = Self.draftInterval - Date().timeIntervalSince(draftPublishedAt)
        if wait <= 0 {
            publishDraft(text)
            return
        }
        pendingDraft = text
        if draftFlush == nil {
            draftFlush = Task {
                try? await Task.sleep(for: .seconds(wait))
                if Task.isCancelled { return }
                flushDraft()
            }
        }
    }

    private func publishDraft(_ text: String) {
        pendingDraft = nil
        draftFlush?.cancel()
        draftFlush = nil
        draftPublishedAt = Date()
        draft = text
    }

    /// Wartenden Entwurf sofort veröffentlichen.
    private func flushDraft() {
        if let text = pendingDraft { publishDraft(text) }
    }

    /// Entwurf verwerfen (Antwort fertig oder neuer Lauf): kein nachgereichter Stand darf ihn wieder füllen.
    private func clearDraft() {
        pendingDraft = nil
        draftFlush?.cancel()
        draftFlush = nil
        draft = ""
    }
    fileprivate func onThinking(_ text: String) { thinking = text }
    fileprivate func onTool(_ name: String) { tool = name }

    fileprivate func onMessage(_ m: ChatMessage) {
        switch m.role {
        case "assistant": clearDraft(); thinking = ""
        case "thought": thinking = ""
        case "tool": tool = nil
        default: break
        }
        messages.append(m)
    }

    fileprivate func onFinished(_ o: AiOutcome) {
        chatId = o.chatId
        if let page = runPageId, let total = o.contextTotal {
            contextSent = ContextSent(pageId: page, sent: Int(o.contextSent ?? 0), total: Int(total))
        }
        finishRun()
        reload()
    }

    fileprivate func onFailed(_ message: String, aborted: Bool) {
        if !aborted { Profiler.shared.error("ai-error", message, name: "ai.chat") }
        flushDraft()
        error = ChatRunError(message: message, aborted: aborted, partial: aborted ? draft : "")
        finishRun()
        reload()
    }

    // MARK: Intern

    private func panelOpenIfNeeded() { panelOpen = true }

    private func resetLive() {
        clearDraft()
        thinking = ""
        tool = nil
    }

    private func finishRun() {
        resetLive()
        running = false
    }

    private func reload() {
        guard !chatId.isEmpty, let chat = core.chat(id: chatId) else { return }
        messages = chat.messages
    }

    /// Gekürzten bzw. umformulierten Verlauf im Kern speichern.
    private func persist() {
        guard !chatId.isEmpty, var chat = core.chat(id: chatId) else { return }
        chat.messages = messages
        _ = attempt("saveChat", { try core.saveChat(chat: chat) })
    }

    /// Einfache Antwort ohne Werkzeuge und Chat (`AI.complete` der PWA: Tagesartikel); läuft im Hintergrund.
    func complete(_ prompt: String, system: String?) async throws -> String {
        let a = makeAssistant()
        return try await Task.detached { try a.complete(prompt: prompt, system: system) }.value
    }

    /// Der Assistent hält Zustand je Chat (Zusammenfassung, Werkzeuge); neu gebaut wird er nur, wenn sich
    /// Quellen, Schlüssel oder der Sync-Schlüssel ändern. Modell und Verhalten liest der Kern bei jedem Lauf.
    private func makeAssistant() -> AiAssistant {
        let s = settings
        let key = s.providersJson + "|" + s.syncKey
        if let assistant, key == assistantKey { return assistant }
        let options = AiOptions(
            providersJson: s.providersJson,
            providerId: nil,
            model: nil,
            thinkingEnabled: nil,
            customInstructions: nil,
            alwaysSendTools: nil,
            syncKey: s.syncKey.isEmpty ? nil : s.syncKey,
            workerUrl: nil
        )
        let a = AiAssistant(core: core, options: options, platform: platform, search: nil)
        assistant = a
        assistantKey = key
        return a
    }

    static func describe(_ e: Error) -> String {
        guard let f = e as? AiFailure else { return e.localizedDescription }
        switch f {
        case .Busy: return "Es läuft bereits eine KI-Anfrage."
        case .Aborted: return "Abgebrochen."
        case .Timeout(let r), .Network(let r), .Other(let r): return r
        case .Http(_, let r, _): return r
        }
    }

    static func message(role: String, content: String?) -> ChatMessage {
        ChatMessage(
            mid: nil, role: role, content: content, model: nil, reasoning: nil, name: nil, detail: nil,
            error: nil, summary: nil, undone: nil, question: nil, options: nil, answered: nil,
            answer: nil, image: nil, extraJson: "{}"
        )
    }
}

/// Rückrufe des Kerns aus dem Lauf-Thread → Hauptthread (FIFO über die Haupt-Queue). Entwurf und
/// Gedankengang kommen bei jedem Token; sie werden je Durchlauf der Haupt-Queue zusammengefasst.
private final class RunListener: AiListener, @unchecked Sendable {
    private weak var model: ChatModel?
    private let lock = NSLock()
    private var draft: String?
    private var thinking: String?

    init(_ model: ChatModel) { self.model = model }

    private func main(_ f: @escaping @MainActor (ChatModel) -> Void) {
        let target = model
        DispatchQueue.main.async {
            MainActor.assumeIsolated { if let target { f(target) } }
        }
    }

    func onDraft(text: String) {
        let first = lock.withLock { () -> Bool in defer { draft = text }; return draft == nil }
        if first { main { m in if let t = self.lock.withLock({ () -> String? in defer { self.draft = nil }; return self.draft }) { m.onDraft(t) } } }
    }

    func onThinking(text: String) {
        let first = lock.withLock { () -> Bool in defer { thinking = text }; return thinking == nil }
        if first { main { m in if let t = self.lock.withLock({ () -> String? in defer { self.thinking = nil }; return self.thinking }) { m.onThinking(t) } } }
    }

    func onToolStarted(name: String) { main { $0.onTool(name) } }
    func onMessage(message: ChatMessage) { main { $0.onMessage(message) } }
    func onFinished(outcome: AiOutcome) { main { $0.onFinished(outcome) } }
    func onFailed(message: String, aborted: Bool) { main { $0.onFailed(message, aborted: aborted) } }
}

/// Was nur die App kann (`AiPlatform`): Rückfragen beantworten lassen (blockiert den Lauf-Thread bis
/// zur Antwort) und Heftseiten als Bild liefern. Zusatzwerkzeuge (`calculate`) gibt es nicht.
private final class RunPlatform: AiPlatform, @unchecked Sendable {
    private let core: ImpalaCore
    private let lock = NSLock()
    private var waiting: DispatchSemaphore?
    private var reply: String?

    init(core: ImpalaCore) { self.core = core }

    func ask(question: String, options: [String]) -> String? {
        let sem = DispatchSemaphore(value: 0)
        lock.withLock { waiting = sem; reply = nil }
        sem.wait()
        return lock.withLock { reply }
    }

    /// Beantwortet die offene Rückfrage (`nil` = abgebrochen); `false`, wenn keine offen ist.
    func respond(_ answer: String?) -> Bool {
        lock.withLock {
            guard let w = waiting else { return false }
            reply = answer
            waiting = nil
            w.signal()
            return true
        }
    }

    func heftPageImage(pageId: String, pageIndex: UInt32) -> String? {
        let core = core
        let render = { () -> String? in
            MainActor.assumeIsolated {
                let ids = core.heftPageIds(pageId: pageId)
                guard ids.indices.contains(Int(pageIndex)),
                      let img = HeftThumbnail.render(core: core, pageId: pageId, heftPageId: ids[Int(pageIndex)], width: 1000, scale: 1),
                      let jpeg = img.jpegData(compressionQuality: 0.85) else { return nil }
                return "data:image/jpeg;base64," + jpeg.base64EncodedString()
            }
        }
        return Thread.isMainThread ? render() : DispatchQueue.main.sync(execute: render)
    }

    func supportedTools() -> [String] { [] }
    func runTool(name: String, argsJson: String) -> String? { nil }
}
