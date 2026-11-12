import SwiftUI
import UIKit

/// Heft-Verlauf wie in `heft-storage.js` der PWA: beim Schreiben höchstens alle 10 Minuten ein Stand
/// des ganzen Hefts (`heftSnapshot`), bis zu 20 Stände der letzten 24 Stunden. Nur auf diesem Gerät
/// (Application Support/heft-history/<Heft-ID>/<Zeit>.json), nie im Sync. Wiederherstellen sichert
/// vorher den jetzigen Stand, damit sich auch das Wiederherstellen zurücknehmen lässt.
enum HeftHistory {
    struct Entry: Identifiable, Hashable, Sendable {
        let url: URL
        let time: Date
        var id: URL { url }
    }

    private static let gap: TimeInterval = 10 * 60
    private static let ttl: TimeInterval = 24 * 60 * 60
    private static let maxCount = 20
    /// Letzter Stand je Heft, damit nicht jedes Speichern den Ordner liest (nur aus der Schreib-Warteschlange).
    nonisolated(unsafe) private static var last: [String: Date] = [:]
    private static let lock = NSLock()

    private static func dir(_ pageId: String) -> URL? {
        guard let base = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        else { return nil }
        let safe = pageId.replacingOccurrences(of: "/", with: "_")
        return base.appending(path: "heft-history", directoryHint: .isDirectory).appending(path: safe, directoryHint: .isDirectory)
    }

    /// Stände des Hefts, neueste zuerst (abgelaufene fallen weg).
    static func list(_ pageId: String) -> [Entry] {
        guard let dir = dir(pageId),
              let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return [] }
        let cutoff = Date().addingTimeInterval(-ttl)
        return files.compactMap { url -> Entry? in
            guard url.pathExtension == "json", let ms = Double(url.deletingPathExtension().lastPathComponent) else { return nil }
            let t = Date(timeIntervalSince1970: ms / 1000)
            return t >= cutoff ? Entry(url: url, time: t) : nil
        }
        .sorted { $0.time > $1.time }
    }

    static func load(_ entry: Entry) -> String? {
        try? String(contentsOf: entry.url, encoding: .utf8)
    }

    /// Nach dem Speichern aufrufen (Schreib-Warteschlange des Hefts): gedrosselt auf einen Stand je 10 Minuten.
    static func maybeSnapshot(core: ImpalaCore, pageId: String) {
        lock.lock()
        let known = last[pageId]
        lock.unlock()
        let newest = known ?? list(pageId).first?.time ?? .distantPast
        guard Date().timeIntervalSince(newest) >= gap else {
            if known == nil { remember(pageId, newest) }
            return
        }
        snapshot(core: core, pageId: pageId)
    }

    /// Jetzigen Stand sofort sichern (vor dem Wiederherstellen), dann aufräumen.
    @discardableResult
    static func snapshot(core: ImpalaCore, pageId: String) -> Bool {
        guard let dir = dir(pageId),
              let json = attempt("heftSnapshot", { try core.heftSnapshot(pageId: pageId) }) else { return false }
        let now = Date()
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let name = String(Int64(now.timeIntervalSince1970 * 1000)) + ".json"
            try json.write(to: dir.appending(path: name), atomically: true, encoding: .utf8)
        } catch {
            return false
        }
        remember(pageId, now)
        prune(pageId)
        return true
    }

    /// Stand übernehmen; der jetzige Stand kommt vorher als eigener Eintrag in den Verlauf.
    static func restore(core: ImpalaCore, pageId: String, entry: Entry) -> Bool {
        guard let json = load(entry) else { return false }
        snapshot(core: core, pageId: pageId)
        return attempt("heftRestore", { try core.heftRestore(pageId: pageId, snapshot: json) }) != nil
    }

    private static func remember(_ pageId: String, _ t: Date) {
        lock.lock()
        last[pageId] = t
        lock.unlock()
    }

    /// Höchstens 20 Stände der letzten 24 Stunden behalten.
    private static func prune(_ pageId: String) {
        guard let dir = dir(pageId),
              let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return }
        let keep = Set(list(pageId).prefix(maxCount).map(\.url.lastPathComponent))
        for f in files where !keep.contains(f.lastPathComponent) {
            try? FileManager.default.removeItem(at: f)
        }
    }
}

/// Reiter „Verlauf“ der Seitenübersicht (`pagesHistoryHtml` der PWA): je Stand die erste Seite als
/// Vorschau mit Uhrzeit, Antippen fragt nach und stellt wieder her.
struct HeftHistoryGrid: View {
    let pageId: String
    let tileWidth: CGFloat
    let onRestored: () -> Void
    @Environment(ImpalaStore.self) private var store
    @Environment(\.displayScale) private var displayScale
    @State private var entries: [HeftHistory.Entry]?
    @State private var thumbs: [URL: UIImage] = [:]
    @State private var confirm: HeftHistory.Entry?
    @State private var failed = false

    var body: some View {
        VStack(spacing: Space.s3) {
            if let entries {
                if entries.isEmpty {
                    Text("Noch keine Stände. Sie entstehen automatisch beim Schreiben (höchstens alle 10 Min., nur auf diesem Gerät).")
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text2)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 360)
                        .padding(.top, 40)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: tileWidth, maximum: 200), spacing: 18)], spacing: 14) {
                        ForEach(entries) { tile($0) }
                    }
                    Text("Letzte 24 h · antippen zum Wiederherstellen")
                        .font(.system(size: TextSize.xs))
                        .foregroundStyle(Impala.text2)
                }
            } else {
                ProgressView().padding(.top, 40)
            }
        }
        .frame(maxWidth: .infinity)
        .task {
            let id = pageId
            entries = await Task.detached(priority: .userInitiated) { HeftHistory.list(id) }.value
        }
        .confirmationDialog(
            confirm.map { "Stand von \(Self.when($0.time)) wiederherstellen?" } ?? "",
            isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
            titleVisibility: .visible
        ) {
            Button("Wiederherstellen") { if let e = confirm { restore(e) } }
            Button("Abbrechen", role: .cancel) { confirm = nil }
        } message: {
            Text("Der jetzige Stand wird vorher im Verlauf gesichert und lässt sich so zurückholen.")
        }
        .alert("Wiederherstellen fehlgeschlagen", isPresented: $failed) {
            Button("OK", role: .cancel) {}
        }
    }

    private func tile(_ e: HeftHistory.Entry) -> some View {
        let shape = RoundedRectangle(cornerRadius: Radius.xs)
        return Button { confirm = e } label: {
            VStack(spacing: 6) {
                Impala.paper
                    .aspectRatio(thumbs[e.url].map { $0.size.width / $0.size.height } ?? 1000.0 / 1414.0, contentMode: .fit)
                    .overlay {
                        if let img = thumbs[e.url] { Image(uiImage: img).resizable().transition(.opacity) }
                    }
                    .clipShape(shape)
                    .overlay(shape.strokeBorder(.black.opacity(0.14), lineWidth: 1))
                    .shadow(color: .black.opacity(0.18), radius: 6, y: 2)
                    .padding(4)
                Text(Self.when(e.time))
                    .font(.system(size: TextSize.xs, weight: .semibold).monospacedDigit())
                    .foregroundStyle(Impala.text2)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Stand von \(Self.when(e.time)) wiederherstellen")
        .task(id: e.url) {
            let core = store.core, pid = pageId, width = tileWidth, scale = displayScale
            let img = await Task.detached(priority: .utility) { () -> UIImage? in
                guard let json = HeftHistory.load(e), let first = heftSnapshotFirstPage(snapshot: json) else { return nil }
                return HeftExport.renderPage(first, core: core, pageId: pid, width: width, scale: scale, imagePixels: 512)
            }.value
            if !Task.isCancelled, let img { thumbs[e.url] = img }
        }
    }

    private func restore(_ e: HeftHistory.Entry) {
        confirm = nil
        if HeftHistory.restore(core: store.core, pageId: pageId, entry: e) { onRestored() } else { failed = true }
    }

    /// „12.11., 14:30“ wie `fmt` in heft-pages-ui.js.
    static func when(_ t: Date) -> String {
        t.formatted(.dateTime.day(.twoDigits).month(.twoDigits).hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
    }
}
