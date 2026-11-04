import SwiftUI

/// Einstellungen der Startseite aus den Kern-Einstellungen (synchronisiert wie in der PWA):
/// `homeUserName`, `homeArticle`, `homeArticleTopics`.
struct HomeSettings {
    var name = ""
    var article = true
    var topics = ""
    var relatedPages = true

    static func read(_ core: ImpalaCore) -> HomeSettings {
        let s = (try? JSONSerialization.jsonObject(with: Data(core.settingsJson().utf8))) as? [String: Any] ?? [:]
        return HomeSettings(
            name: (s["homeUserName"] as? String ?? "").trimmingCharacters(in: .whitespaces),
            article: s["homeArticle"] as? Bool ?? true,
            topics: s["homeArticleTopics"] as? String ?? "",
            relatedPages: s["relatedPages"] as? Bool ?? true
        )
    }
}

/// „Startseite anpassen“ (Zahnrad, wie `data-set="home"`): dieselben Felder wie in den Einstellungen
/// unter Darstellung → Oberfläche und Lernen → Wochenziel.
struct HomeCustomizeSheet: View {
    var body: some View {
        NavigationStack {
            Form {
                HomeSettingsSections()
                WeekGoalSection()
            }
            .navigationTitle("Startseite anpassen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { CloseButton() } }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Wochenziel der Lernzeit (nur dieses Gerät, wie in der PWA).
struct WeekGoalSection: View {
    @AppStorage(WeekGoal.key) private var goal = 300

    var body: some View {
        Section {
            Picker("Wochenziel", selection: $goal) {
                ForEach(WeekGoal.presets, id: \.self) { Text(HomeFormat.dur(Double($0))).tag($0) }
            }
        } header: {
            Text("Lernzeit")
        } footer: {
            Text("Lernzeit pro Woche (nur dieses Gerät, wie in der PWA).")
        }
        .onAppear { goal = WeekGoal.normalized(goal) }
    }
}

/// Begrüßungsname und Tagesartikel (settings-renderer.js, Gruppe „Oberfläche“).
struct HomeSettingsSections: View {
    @Environment(ImpalaStore.self) private var store
    @State private var name = ""
    @State private var article = true
    @State private var topics = ""
    @State private var relatedPages = true
    @State private var loaded = false

    var body: some View {
        Group {
            Section {
                TextField("Optional", text: $name)
                    .textContentType(.givenName)
                    .onSubmit(saveName)
            } header: {
                Text("Begrüßungsname")
            } footer: {
                Text("Erscheint in der Begrüßung auf der Startseite")
            }
            Section {
                Toggle("Tagesartikel", isOn: $article)
                    .tint(Impala.accent)
                    .onChange(of: article) { _, on in if loaded { AiSettings.patch(store.core, ["homeArticle": on]) } }
                if article {
                    TextField("Automatisch", text: $topics, axis: .vertical)
                        .onSubmit(saveTopics)
                    if !suggestions.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(suggestions.prefix(6), id: \.self) { s in
                                    Button {
                                        let trimmed = topics.trimmingCharacters(in: .whitespaces)
                                        topics = trimmed.isEmpty ? s : "\(trimmed), \(s)"
                                        saveTopics()
                                    } label: {
                                        Text("+ \(s)")
                                            .font(.system(size: TextSize.xs, weight: .medium))
                                            .foregroundStyle(Impala.accent)
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 4)
                                            .background(Impala.activeTint, in: Capsule())
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            } footer: {
                Text(article
                     ? "Die KI fasst deine Notizen einmal am Tag als kurzen Artikel auf der Startseite zusammen. Themen kommagetrennt, sie wechseln täglich; leer = aus allen Notizen."
                     : "Die KI fasst deine Notizen einmal am Tag als kurzen Artikel auf der Startseite zusammen.")
            }
            Section {
                Toggle("Verwandte Seiten", isOn: $relatedPages)
                    .tint(Impala.accent)
                    .onChange(of: relatedPages) { _, on in if loaded { AiSettings.patch(store.core, ["relatedPages": on]) } }
            } footer: {
                Text("Zeigt unter jeder Notiz bis zu drei inhaltlich ähnliche Seiten (braucht das Embedding-Modell unter KI).")
            }
        }
        .animation(.smooth, value: article)
        .onAppear {
            let s = HomeSettings.read(store.core)
            name = s.name
            article = s.article
            topics = s.topics
            relatedPages = s.relatedPages
            Task { loaded = true }
        }
        .onDisappear {
            saveName()
            saveTopics()
        }
    }

    private var suggestions: [String] {
        let own = Set(topics.components(separatedBy: CharacterSet(charactersIn: ",;\n")).map { $0.trimmingCharacters(in: .whitespaces).lowercased() })
        let ws = store.core.workspaces().map(\.name)
        return ws.filter { !own.contains($0.lowercased()) && !$0.isEmpty }
    }

    private func saveName() {
        let v = name.trimmingCharacters(in: .whitespaces)
        if v != HomeSettings.read(store.core).name { AiSettings.patch(store.core, ["homeUserName": v]) }
    }

    private func saveTopics() {
        let v = topics.trimmingCharacters(in: .whitespacesAndNewlines)
        if v != HomeSettings.read(store.core).topics { AiSettings.patch(store.core, ["homeArticleTopics": v]) }
    }
}

/// Texte und Zeitangaben wie home-view.js.
enum HomeFormat {
    static let days = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

    /// `dur()`: „45 Min“, „2 h“, „1 h 30“.
    static func dur(_ minutes: Double) -> String {
        let m = Int(minutes.rounded())
        let h = m / 60, r = m % 60
        return h > 0 ? "\(h) h" + (r > 0 ? " \(r)" : "") : "\(m) Min"
    }

    static func days(_ n: Int, _ one: String = "Tag", _ many: String = "Tagen") -> String { "\(n) " + (n == 1 ? one : many) }

    /// Ein Satz, was heute zählt: Streak in Gefahr > Ziel in Reichweite > Ziel geschafft > heutige Zeit.
    static func nudge(streak: Int, todaySeconds: Int, weekMin: Double, goalMin: Int, now: Date = .now) -> String {
        let todayMin = Int((Double(todaySeconds) / 60).rounded())
        let left = Double(goalMin) - weekMin
        if streak > 0 && todayMin == 0 && Calendar.current.component(.hour, from: now) >= 14 {
            return " Dein Streak von \(days(streak)) wartet noch auf heute."
        }
        if left > 0 && left <= 60 { return " Nur noch \(dur(left)) bis zum Wochenziel." }
        if left <= 0 && weekMin > 0 { return " Das Wochenziel hast du schon geschafft." }
        if todayMin > 0 { return " Heute schon \(dur(Double(todayMin))) gelernt." }
        return ""
    }
}
