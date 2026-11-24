import SwiftUI

/// Auswertung der Lernzeit wie web/lernzeit.js (`mergedSeconds`, `totalsByDay`, `weekData`, `streakDays`)
/// über den Rust-Kern (`study_records.rs`, `learning_time.rs`).
struct LearningTime {
    /// Sekunden je Kalendertag (lokal, Schlüssel `JJJJ-MM-TT`), nach Beginn der Sitzung.
    private let totals: [String: Int]
    private let calendar: Calendar

    init(_ sessions: [LearningSessionInfo], calendar: Calendar = .monday) {
        self.calendar = calendar
        let rawTotals = learningTimeTotalsByDay(sessions: sessions, zone: SystemZone.shared)
        self.totals = rawTotals.mapValues { Int($0) }
    }

    func seconds(_ day: Date) -> Int { totals[Self.key(day, calendar)] ?? 0 }

    /// Die 7 Tage der laufenden Woche (Mo–So).
    func week(_ today: Date = .now) -> [Int] {
        week(offset: 0, today: today)
    }

    /// Die 7 Tage einer Woche relativ zur aktuellen (`offset = 0`: diese Woche, `-1`: letzte Woche).
    func week(offset: Int, today: Date = .now) -> [Int] {
        let ms = Int64(today.timeIntervalSince1970 * 1000)
        let raw = learningTimeWeekData(totals: totals.mapValues { UInt64($0) }, nowMs: ms, weekOffset: Int32(offset), zone: SystemZone.shared)
        return raw.map { Int($0) }
    }

    /// Aufeinanderfolgende Tage mit ≥ 5 Minuten; ein noch leerer heutiger Tag bricht die Serie nicht.
    func streakDays(_ today: Date = .now) -> Int {
        let ms = Int64(today.timeIntervalSince1970 * 1000)
        return Int(learningTimeStreakDays(totals: totals.mapValues { UInt64($0) }, nowMs: ms, zone: SystemZone.shared))
    }

    /// Montag als 0, Sonntag als 6.
    static func weekdayIndex(_ date: Date = .now) -> Int {
        let ms = Int64(date.timeIntervalSince1970 * 1000)
        return Int(learningTimeWeekdayIndex(nowMs: ms, zone: SystemZone.shared))
    }

    private static func key(_ date: Date, _ calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

extension Calendar {
    /// Gregorianisch, Woche ab Montag, lokale Zeitzone (wie `weekData` der PWA).
    static var monday: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.firstWeekday = 2
        c.timeZone = .current
        return c
    }
}

/// ISO-Zeitpunkte wie `toISOString()` der PWA (mit Millisekunden, UTC).
enum ISODate {
    static func parse(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }

    static func string(_ date: Date = .now) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date)
    }

    /// Heutiger Tag als `JJJJ-MM-TT` (lokal, wie `today()` in home-article.js).
    static func today(_ date: Date = .now) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

/// Wochenziel in Minuten (lernzeit.js `weekGoalMinutes`, nur dieses Gerät wie in der PWA): mindestens 30,
/// sonst 300; „Ziel ändern“ schaltet durch 2 h, 5 h, 8 h und 12 h.
enum WeekGoal {
    static let key = "weekGoalMinutes"
    static let presets = [120, 300, 480, 720]

    static func normalized(_ stored: Int) -> Int {
        Int(learningTimeNormalizeGoal(stored: UInt32(max(0, stored))))
    }

    static func next(after current: Int) -> Int {
        Int(learningTimeCycleGoal(current: UInt32(max(0, current))))
    }
}

// MARK: - Erfassung

/// Wo gerade gelernt wird (lernzeit.js `categoryNow`): Kategorie und Quelle (Stapel, Seite, Chat).
struct LearnContext: Equatable {
    let category: String
    let sourceId: String?
}

/// Lernzeit-Erfassung wie lernzeit.js und `LearningTracker.kt`: Sitzungen aus aktiven Abschnitten. Nach
/// 60 s ohne Eingabe (Notizen: 3 min) pausiert sie rückwirkend ab der letzten Eingabe und zeigt (außer in
/// Notizen) das Leerlauf-Tier; jede Eingabe setzt fort. Nach 15 min Pause beginnt eine neue Sitzung.
/// Gespeichert wird über den Kern (`saveLearningSession`, Event `learningSessionUpsert`).
@MainActor @Observable
final class LearningTracker {
    static let shared = LearningTracker()

    static let sessionGap: TimeInterval = 15 * 60
    static let idleAfter: TimeInterval = 60
    /// Notizen liest man oft länger ohne Eingabe.
    static let notesIdleAfter: TimeInterval = 3 * 60
    /// Nach der ersten Eingabe bleibt das Tier noch kurz sichtbar (lernzeit.js `ANIMAL_LINGER_MS`).
    static let animalLinger: Duration = .milliseconds(2500)

    private struct Session {
        let id = UUID().uuidString
        let startedAt = ISODate.string()
        let ctx: LearnContext
        var segments: [TimeSegment] = []
        var activeStart: Date?
        var pausedAt: Date?
    }

    /// Pausiert wegen fehlender Eingaben.
    private(set) var idle = false
    /// Leerlauf-Tier sichtbar (nicht in Notizen) und seine Pose, bei jeder Pause die nächste.
    private(set) var showsAnimal = false
    private(set) var pose = IdlePose.allCases.randomElement() ?? .peek
    /// Der KI-Knopf unten rechts ist sichtbar (setzt `AiOrbButton`): Tier weicht aus, Plakette zieht hinein.
    var orbShown = false
    @ObservationIgnored private var current: Session?
    @ObservationIgnored private var lastActivity = Date()
    @ObservationIgnored private weak var core: ImpalaCore?
    @ObservationIgnored private var animalLeave: Task<Void, Never>?

    /// Abschnitt öffnen oder fortsetzen (`openSegment`).
    func open(_ ctx: LearnContext, core: ImpalaCore) {
        self.core = core
        lastActivity = Date()
        idle = false
        hideAnimal()
        if var s = current, s.ctx == ctx {
            if s.activeStart != nil { return }
            if let p = s.pausedAt, Date().timeIntervalSince(p) <= Self.sessionGap {
                s.activeStart = Date()
                s.pausedAt = nil
                current = s
                return
            }
        }
        pause()
        var s = Session(ctx: ctx)
        s.activeStart = Date()
        current = s
    }

    /// Abschnitt schließen und die Sitzung speichern (`pauseSegment` + `persistCurrent`).
    /// `at`: Ende des Abschnitts – beim Leerlauf rückwirkend die letzte Eingabe.
    func pause(at: Date = Date()) {
        guard var s = current, let start = s.activeStart else { return }
        let end = max(at, start)
        s.segments.append(TimeSegment(startedAt: ISODate.string(start), endedAt: ISODate.string(end)))
        s.activeStart = nil
        s.pausedAt = end
        current = s
        persist(s)
    }

    /// Eingabe: hält die Sitzung wach und setzt sie nach einer Leerlauf-Pause sofort fort. Das Tier geht erst kurz
    /// danach – sonst ist es beim ersten Touch weg, bevor man es wahrnimmt.
    func poke() {
        lastActivity = Date()
        guard idle, let ctx = current?.ctx, let core else { return }
        let wasShowing = showsAnimal
        open(ctx, core: core)
        guard wasShowing else { return }
        showsAnimal = true
        animalLeave = Task { [weak self] in
            try? await Task.sleep(for: Self.animalLinger)
            guard !Task.isCancelled else { return }
            self?.showsAnimal = false
        }
    }

    private func hideAnimal() {
        animalLeave?.cancel()
        animalLeave = nil
        showsAnimal = false
    }

    /// Takt (alle 5 s): nach 60 s (Notizen: 3 min) ohne Eingabe rückwirkend pausieren.
    func tick() {
        guard let s = current, s.activeStart != nil else { return }
        let limit = s.ctx.category == "notes" ? Self.notesIdleAfter : Self.idleAfter
        guard Date().timeIntervalSince(lastActivity) > limit else { return }
        pause(at: lastActivity)
        let all = IdlePose.allCases
        pose = all[((all.firstIndex(of: pose) ?? 0) + 1) % all.count]
        animalLeave?.cancel()
        showsAnimal = s.ctx.category != "notes"
        idle = true
    }

    /// Ansicht verlassen: pausieren, ohne nachzufragen.
    func leave() {
        pause()
        idle = false
        hideAnimal()
    }

    private func persist(_ s: Session) {
        let seconds = s.segments.reduce(0.0) { sum, seg in
            guard let a = ISODate.parse(seg.startedAt), let b = ISODate.parse(seg.endedAt) else { return sum }
            return sum + max(0, b.timeIntervalSince(a))
        }
        guard seconds >= 1, let end = s.segments.last?.endedAt else { return }
        _ = try? core?.saveLearningSession(input: LearningSessionInput(
            id: s.id, startedAt: s.startedAt, endedAt: end, durationSeconds: UInt64(seconds),
            segments: s.segments, category: s.ctx.category, subject: nil, subjectSource: nil, sourceId: s.ctx.sourceId
        ))
    }
}

extension View {
    /// Misst die Lernzeit, solange die Ansicht sichtbar und die App im Vordergrund ist.
    func learningTime(_ ctx: LearnContext) -> some View { modifier(LearningTimeModifier(ctx: ctx)) }
}

private struct LearningTimeModifier: ViewModifier {
    let ctx: LearnContext
    @Environment(ImpalaStore.self) private var store
    @Environment(\.scenePhase) private var phase
    private var tracker: LearningTracker { .shared }

    func body(content: Content) -> some View {
        content
            .simultaneousGesture(TapGesture().onEnded { tracker.poke() })
            .onContinuousHover { _ in tracker.poke() }
            .overlay(alignment: .bottomTrailing) {
                if tracker.showsAnimal && !(tracker.pose == .badge && tracker.orbShown) {
                    IdleAnimal(pose: tracker.pose, avoidOrb: tracker.orbShown)
                }
            }
            .animation(.spring(duration: 0.4, bounce: 0.2), value: tracker.showsAnimal)
            .onAppear { tracker.open(ctx, core: store.core) }
            .onDisappear { tracker.leave() }
            .onChange(of: ctx) { tracker.open(ctx, core: store.core) }
            .onChange(of: phase) { _, p in
                if p == .active { tracker.open(ctx, core: store.core) } else { tracker.leave() }
            }
            // Bewertungen (auch per Tastatur) ändern Karten: zählt als Eingabe.
            .onChange(of: store.cardsRevision) { tracker.poke() }
            .task(id: ctx.category + (ctx.sourceId ?? "")) {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(5))
                    tracker.tick()
                }
            }
    }
}
