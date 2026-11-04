import SwiftUI

/// Auswertung der Lernzeit wie web/lernzeit.js (`mergedSeconds`, `totalsByDay`, `weekData`, `streakDays`)
/// und `LearningTime.kt`: Überlappende Abschnitte zweier Geräte zählen nur einmal (Wanduhr-Zeit).
/// Kandidat für den Rust-Kern, sobald die PWA die Auswertung ebenfalls dorthin verlagert.
struct LearningTime {
    /// Sekunden je Kalendertag (lokal, Schlüssel `JJJJ-MM-TT`), nach Beginn der Sitzung.
    private let totals: [String: Int]
    private let calendar: Calendar

    init(_ sessions: [LearningSessionInfo], calendar: Calendar = .monday) {
        self.calendar = calendar
        var groups: [String: [LearningSessionInfo]] = [:]
        for s in sessions where s.durationSeconds > 0 {
            guard let start = ISODate.parse(s.startedAt) else { continue }
            groups[Self.key(start, calendar), default: []].append(s)
        }
        totals = groups.mapValues(Self.mergedSeconds)
    }

    func seconds(_ day: Date) -> Int { totals[Self.key(day, calendar)] ?? 0 }

    /// Die 7 Tage der laufenden Woche (Mo–So).
    func week(_ today: Date = .now) -> [Int] {
        guard let monday = calendar.dateInterval(of: .weekOfYear, for: today)?.start else { return Array(repeating: 0, count: 7) }
        return (0..<7).map { seconds(calendar.date(byAdding: .day, value: $0, to: monday) ?? monday) }
    }

    /// Aufeinanderfolgende Tage mit ≥ 5 Minuten; ein noch leerer heutiger Tag bricht die Serie nicht.
    func streakDays(_ today: Date = .now) -> Int {
        var streak = 0
        for i in 0..<365 {
            let day = calendar.date(byAdding: .day, value: -i, to: today) ?? today
            if seconds(day) >= 5 * 60 { streak += 1 } else if i == 0 { continue } else { break }
        }
        return streak
    }

    /// Montag als 0, Sonntag als 6.
    static func weekdayIndex(_ date: Date = .now) -> Int {
        (Calendar.current.component(.weekday, from: date) + 5) % 7
    }

    private static func key(_ date: Date, _ calendar: Calendar) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private static func mergedSeconds(_ sessions: [LearningSessionInfo]) -> Int {
        var intervals: [(Date, Date)] = []
        for s in sessions {
            if !s.segments.isEmpty {
                for seg in s.segments {
                    if let a = ISODate.parse(seg.startedAt), let b = ISODate.parse(seg.endedAt), b >= a { intervals.append((a, b)) }
                }
            } else if let a = ISODate.parse(s.startedAt) {
                let b = ISODate.parse(s.endedAt) ?? a.addingTimeInterval(Double(s.durationSeconds))
                intervals.append((a, max(a, b)))
            }
        }
        intervals.sort { $0.0 < $1.0 }
        var total: TimeInterval = 0
        var cur: (Date, Date)?
        for (a, b) in intervals {
            if let c = cur, a <= c.1 {
                cur = (c.0, max(c.1, b))
            } else {
                if let c = cur { total += c.1.timeIntervalSince(c.0) }
                cur = (a, b)
            }
        }
        if let c = cur { total += c.1.timeIntervalSince(c.0) }
        return Int(total.rounded())
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

    static func normalized(_ stored: Int) -> Int { stored >= 30 ? stored : 300 }

    static func next(after current: Int) -> Int {
        let i = presets.firstIndex(of: current) ?? -1
        return presets[(i + 1) % presets.count]
    }
}

// MARK: - Erfassung

/// Wo gerade gelernt wird (lernzeit.js `categoryNow`): Kategorie und Quelle (Stapel, Seite, Chat).
struct LearnContext: Equatable {
    let category: String
    let sourceId: String?
}

/// Lernzeit-Erfassung wie lernzeit.js und `LearningTracker.kt`: Sitzungen aus aktiven Abschnitten. Nach
/// 60 s ohne Eingabe pausiert sie („Lernst du noch?“); nach 15 min Pause beginnt eine neue Sitzung.
/// Gespeichert wird über den Kern (`saveLearningSession`, Event `learningSessionUpsert`).
@MainActor @Observable
final class LearningTracker {
    static let shared = LearningTracker()

    static let sessionGap: TimeInterval = 15 * 60
    static let idleAfter: TimeInterval = 60

    private struct Session {
        let id = UUID().uuidString
        let startedAt = ISODate.string()
        let ctx: LearnContext
        var segments: [TimeSegment] = []
        var activeStart: Date?
        var pausedAt: Date?
    }

    /// Pausiert wegen fehlender Eingaben (zeigt „Lernst du noch?“).
    private(set) var idle = false
    @ObservationIgnored private var current: Session?
    @ObservationIgnored private var lastActivity = Date()
    @ObservationIgnored private weak var core: ImpalaCore?

    /// Abschnitt öffnen oder fortsetzen (`openSegment`).
    func open(_ ctx: LearnContext, core: ImpalaCore) {
        self.core = core
        lastActivity = Date()
        idle = false
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
    func pause() {
        guard var s = current, let start = s.activeStart else { return }
        s.segments.append(TimeSegment(startedAt: ISODate.string(start), endedAt: ISODate.string()))
        s.activeStart = nil
        s.pausedAt = Date()
        current = s
        persist(s)
    }

    /// Eingabe: hält die Sitzung wach und setzt sie nach „Lernst du noch?“ fort.
    func poke() {
        lastActivity = Date()
        if idle, let ctx = current?.ctx, let core { open(ctx, core: core) }
    }

    /// Takt (alle 5 s): nach 60 s ohne Eingabe pausieren.
    func tick() {
        guard current?.activeStart != nil, Date().timeIntervalSince(lastActivity) > Self.idleAfter else { return }
        pause()
        idle = true
    }

    /// Ansicht verlassen: pausieren, ohne nachzufragen.
    func leave() {
        pause()
        idle = false
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
            .overlay(alignment: .bottom) {
                if tracker.idle {
                    IdlePill { tracker.poke() }
                        .padding(.bottom, 96)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.spring(duration: 0.4, bounce: 0.2), value: tracker.idle)
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

/// „Lernst du noch?“ (`#lzAnimal`) als schwebende Glas-Pille: Antippen setzt die Lernzeit fort.
private struct IdlePill: View {
    let onResume: () -> Void

    var body: some View {
        Button(action: onResume) {
            HStack(spacing: Space.s3) {
                Icon("hand", size: 20).foregroundStyle(Impala.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Lernst du noch?").font(.system(size: TextSize.base, weight: .semibold)).foregroundStyle(Impala.text)
                    Text("Berühre mich, um die Lernzeit fortzusetzen.").font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2)
                }
            }
            .padding(.horizontal, Space.s4)
            .padding(.vertical, Space.s3)
            .impalaGlass(in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous), interactive: true)
        }
        .buttonStyle(.plain)
    }
}
