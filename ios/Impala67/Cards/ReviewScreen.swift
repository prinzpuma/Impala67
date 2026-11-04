import SwiftUI

/// Lernmodus (`ankiStudyHtml` in render-anki.js, `ReviewScreen.kt`): Frage → „Antwort zeigen“ dreht die
/// Karte um (3D-Flip mit Feder) → Antwort und die vier Bewertungen mit den Intervallen des Kerns.
/// Tastatur wie shortcuts.js: ␣ Antwort/Gut, 1–4 bewerten, ⌘Z letzte Bewertung zurück.
struct ReviewScreen: View {
    let deck: String?
    let mix: Bool
    @Environment(ImpalaStore.self) private var store
    @State private var model: ReviewModel?

    var body: some View {
        Group {
            if let model { ReviewBody(model: model) } else { Color.clear }
        }
        .onAppear { if model == nil { model = ReviewModel(core: store.core, deck: deck, mix: mix) } }
        // Lernzeit wie lernzeit.js (Kategorie `cards`, Quelle: Stapel).
        .learningTime(LearnContext(category: "cards", sourceId: deck))
        // Fremde oder eigene Änderungen (Bearbeiten, Sync): neu lesen, angezeigte Karte bleibt liegen.
        .onChange(of: store.cardsRevision) { model?.refresh() }
    }
}

private struct ReviewBody: View {
    @Bindable var model: ReviewModel
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var glass

    var body: some View {
        VStack(spacing: 0) {
            ReviewHeader(model: model) { exit() }
            ProgressView(value: model.progress)
                .tint(Impala.accent)
                .padding(.horizontal, Space.s4)
                .animation(.smooth(duration: 0.5), value: model.progress)
            if let card = model.card {
                ScrollView {
                    VStack(alignment: .leading, spacing: Space.s3) {
                        CardMeta(card: card)
                        FlipCard(card: card, showBack: model.showBack, reduceMotion: reduceMotion)
                        if shell.cards.feynman, !model.showBack {
                            FeynmanInput(text: $model.feynText, checking: model.checking) {
                                withAnimation(.smooth) { model.checkFeynman(chat: shell.chat) }
                            }
                            .transition(.opacity)
                        }
                        if model.showBack, let v = model.verdict, v.cardId == card.id {
                            FeynmanFeedback(verdict: v).transition(.opacity.combined(with: .move(edge: .bottom)))
                        }
                    }
                    .frame(maxWidth: 680)
                    .padding(.horizontal, Space.s6)
                    .padding(.vertical, Space.s4)
                    .frame(maxWidth: .infinity)
                    .id(card.id)
                    // Nächste Karte schiebt herein, die bewertete gleitet hinaus.
                    .transition(reduceMotion ? .opacity : .asymmetric(
                        insertion: .move(edge: .trailing).combined(with: .opacity),
                        removal: .move(edge: .leading).combined(with: .opacity)))
                }
                .scrollIndicators(.hidden)
                actions(card)
            } else if let q = model.queue {
                ReviewDone(queue: q, onRecheck: { withAnimation(.smooth) { model.refresh(unpin: true) } }, onExit: exit)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
            }
        }
        .background(Impala.panel)
        .animation(.smooth(duration: 0.38), value: model.card?.id)
        .sensoryFeedback(.impact(weight: .light), trigger: model.showBack) { _, now in now }
        .sensoryFeedback(trigger: model.graded) { _, _ in
            model.lastGrade == 1 ? SensoryFeedback.warning : SensoryFeedback.impact(flexibility: .solid, intensity: 0.7)
        }
        .alert("Das hat nicht geklappt", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(model.error ?? "") }
    }

    /// Zähler, „Antwort zeigen“ bzw. Bewertungen (Liquid Glass; der Knopf verwandelt sich in „Gut“)
    /// und die Fußleiste.
    @ViewBuilder
    private func actions(_ card: CardInfo) -> some View {
        VStack(spacing: Space.s3) {
            QueueCounts(queue: model.queue)
            GlassEffectContainer(spacing: Space.s2) {
                HStack(spacing: Space.s2) {
                    if model.showBack {
                        ForEach(Grade.all) { g in
                            GradeButton(grade: g, interval: model.preview.indices.contains(g.value - 1) ? model.preview[g.value - 1] : "", ns: glass) {
                                withAnimation(.smooth(duration: 0.38)) { model.grade(g.value) }
                            }
                        }
                    } else {
                        Button {
                            withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(duration: 0.6, bounce: 0.22)) { model.showBack = true }
                        } label: {
                            Text(shell.cards.feynman ? "Ohne Erklärung aufdecken" : "Antwort zeigen")
                                .font(.system(size: TextSize.md, weight: .semibold))
                                .foregroundStyle(Impala.onAccent)
                                .frame(minWidth: 220, minHeight: 52)
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .glassEffect(.regular.tint(Impala.accent).interactive(), in: Capsule())
                        .glassEffectID(3, in: glass)
                        .keyboardShortcut(shell.cards.feynman ? nil : KeyboardShortcut(.space, modifiers: []))
                    }
                }
            }
            HStack {
                FooterButton(label: "Bearbeiten", icon: "pen") {
                    shell.cards.editor = CardEditorTarget(cardId: card.id, deck: card.deck)
                }
                Spacer()
                FooterButton(label: "Aussetzen", icon: "pause") { withAnimation(.smooth) { model.suspend() } }
            }
        }
        .frame(maxWidth: 680)
        .padding(.horizontal, Space.s4)
        .padding(.bottom, Space.s3)
    }

    private func exit() { withAnimation(.smooth) { shell.cards.view = .decks } }
}

/// Kopf (`.study-head`): zurück zu den Stapeln, Stapelname, Rückgängig.
private struct ReviewHeader: View {
    let model: ReviewModel
    let onExit: () -> Void

    var body: some View {
        HStack {
            Button(action: onExit) {
                HStack(spacing: 2) {
                    Icon("chevron-left", size: 16)
                    Text("Stapel").font(.system(size: TextSize.base))
                }
                .foregroundStyle(Impala.text2)
                .frame(minHeight: 44)
            }
            .pressable()
            Spacer()
            Text((model.deck.map(Deck.label) ?? "Alle Stapel") + (model.mix ? " · gemischt" : ""))
                .font(.system(size: TextSize.sm, weight: .semibold))
                .foregroundStyle(Impala.text)
                .lineLimit(1)
            Spacer()
            Button { withAnimation(.smooth(duration: 0.38)) { model.undo() } } label: {
                Icon("undo", size: 17)
                    .foregroundStyle(Impala.text2.opacity(model.canUndo ? 1 : 0.35))
                    .frame(width: 44, height: 44)
            }
            .pressable()
            .disabled(!model.canUndo)
            .keyboardShortcut("z", modifiers: .command)
            .accessibilityLabel("Letzte Bewertung rückgängig")
        }
        .padding(.horizontal, Space.s3)
    }
}

/// Stapel links, Stufe rechts (`.study-meta-bar`).
private struct CardMeta: View {
    let card: CardInfo

    var body: some View {
        HStack(spacing: Space.s2) {
            Text(Deck.label(card.deck).uppercased())
                .font(.system(size: 11, weight: .semibold))
                .kerning(0.7)
                .foregroundStyle(Impala.text2)
                .lineLimit(1)
            Spacer(minLength: 0)
            if card.leech { Text("Leech").font(.system(size: 11, weight: .semibold)).foregroundStyle(Impala.danger) }
            Text(stage).font(.system(size: 11, weight: .semibold)).foregroundStyle(Impala.accent)
        }
    }

    private var stage: String {
        switch card.stage {
        case .new: "Neu"
        case .learning: "Lernen"
        case .relearning: "Neu lernen"
        case .review: "Wiederholen"
        }
    }
}

/// Die Karte: vorne die Frage, hinten Frage (abgeblendet), „Antwort“ und Rückseite (Akzentrand) – wie die
/// eine Karte der PWA (`.card-face front/back`). Umdrehen über die Y-Achse mit Perspektive.
private struct FlipCard: View {
    let card: CardInfo
    let showBack: Bool
    let reduceMotion: Bool
    @Environment(ImpalaStore.self) private var store

    var body: some View {
        // Die Rückseite (Frage + Antwort) bestimmt die Größe; die Vorderseite liegt deckungsgleich darüber,
        // damit beide Seiten beim Drehen gleich groß sind.
        face(back: true) {
            SideLabel("Frage")
            MarkdownView(card.front, core: store.core).opacity(0.6)
            AnswerDivider()
            MarkdownView(card.back, core: store.core)
        }
        .modifier(FlipFace(angle: showBack ? 180 : 0, back: true, flat: reduceMotion))
        .overlay {
            face(back: false) {
                SideLabel("Frage")
                MarkdownView(card.front, core: store.core)
            }
            .modifier(FlipFace(angle: showBack ? 180 : 0, back: false, flat: reduceMotion))
        }
    }

    private func face(back: Bool, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: Space.s3, content: content)
            .padding(18)
            .frame(maxWidth: .infinity, minHeight: 220, maxHeight: back ? nil : .infinity, alignment: .topLeading)
            .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous)
                .stroke(back ? Impala.accentBorder : Impala.edgeSoft, lineWidth: 1))
    }
}

/// Eine Kartenseite drehen: sichtbar bis 90° (vorne) bzw. ab 90° (hinten). Animierbar, damit der
/// Wechsel genau auf der Kante passiert. „Bewegung reduzieren“: nur überblenden.
private struct FlipFace: ViewModifier, Animatable {
    var angle: Double
    let back: Bool
    let flat: Bool

    var animatableData: Double {
        get { angle }
        set { angle = newValue }
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        let visible = back ? angle >= 90 : angle < 90
        if flat {
            content.opacity(back ? angle / 180 : 1 - angle / 180)
                .allowsHitTesting(visible)
        } else {
            content
                .opacity(visible ? 1 : 0)
                .rotation3DEffect(.degrees(back ? angle - 180 : angle), axis: (x: 0, y: 1, z: 0), perspective: 0.45)
                .allowsHitTesting(visible)
                .accessibilityHidden(!visible)
        }
    }
}

private struct SideLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased()).font(.system(size: 11)).kerning(0.5).foregroundStyle(Impala.text2)
    }
}

/// Trennlinie mit „Antwort“ (`.study-divider`).
private struct AnswerDivider: View {
    var body: some View {
        HStack(spacing: Space.s3) {
            Rectangle().fill(Impala.edge).frame(height: 1)
            Text("Antwort").font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2).fixedSize()
            Rectangle().fill(Impala.edge).frame(height: 1)
        }
    }
}

/// „N neu · N lernen · N wdh.“ über den Knöpfen.
private struct QueueCounts: View {
    let queue: StudyQueue?

    var body: some View {
        let q = queue
        Text("\(count(q?.new ?? 0, Impala.success)) neu · \(count(q?.learn ?? 0, Impala.accent)) lernen · \(count(q?.review ?? 0, Impala.accent)) wdh.")
            .font(.system(size: TextSize.sm))
            .foregroundStyle(Impala.text2)
            .contentTransition(.numericText())
    }

    private func count(_ n: UInt64, _ color: Color) -> Text {
        Text("\(n)").bold().foregroundStyle(color)
    }
}

/// Bewertung mit Farbe der PWA (`.grades button`): Nochmal rot, Schwer gelb, Gut Akzent, Einfach grün.
private struct Grade: Identifiable {
    let value: Int
    let label: String
    let tone: Color
    var id: Int { value }

    static let all = [
        Grade(value: 1, label: "Nochmal", tone: Impala.danger),
        Grade(value: 2, label: "Schwer", tone: Impala.warn),
        Grade(value: 3, label: "Gut", tone: Impala.accent),
        Grade(value: 4, label: "Einfach", tone: Impala.success),
    ]
}

private struct GradeButton: View {
    let grade: Grade
    let interval: String
    let ns: Namespace.ID
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 1) {
                Text(grade.label).font(.system(size: TextSize.base, weight: .semibold)).foregroundStyle(Impala.text)
                Text(interval).font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2).monospacedDigit()
            }
            .lineLimit(1)
            .frame(maxWidth: .infinity, minHeight: 56)
            .contentShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.tint(grade.tone.opacity(grade.value == 3 ? 0.4 : 0.26)).interactive(),
                     in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .glassEffectID(grade.value, in: ns)
        .keyboardShortcut(KeyEquivalent(Character("\(grade.value)")), modifiers: [])
        .background {
            // ␣ = Gut (wie in der PWA).
            if grade.value == 3 { Button("", action: action).keyboardShortcut(.space, modifiers: []).hidden() }
        }
        .accessibilityLabel("\(grade.label), \(interval)")
    }
}

private struct FooterButton: View {
    let label: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Icon(icon, size: 15)
                Text(label).font(.system(size: TextSize.sm))
            }
            .foregroundStyle(Impala.text2)
            .frame(minHeight: 40)
        }
        .pressable()
    }
}

/// Ende der Sitzung: „Gratulation!“, „Geschafft!“ (später heute noch Lernschritte) oder nichts fällig.
private struct ReviewDone: View {
    let queue: StudyQueue
    let onRecheck: () -> Void
    let onExit: () -> Void

    var body: some View {
        let waiting = queue.finishedForNow && !queue.done
        VStack(spacing: Space.s3) {
            Icon("party", size: 40)
                .foregroundStyle(queue.done ? Impala.success : Impala.accent)
            Text(title).font(.system(size: 26, weight: .bold, design: .rounded)).foregroundStyle(Impala.text)
            ForEach(lines, id: \.self) {
                Text($0).font(.system(size: TextSize.base)).foregroundStyle(Impala.text2).multilineTextAlignment(.center)
            }
            HStack(spacing: Space.s2) {
                if waiting { TintButton(title: "Erneut prüfen", strong: true, action: onRecheck) }
                TintButton(title: "Zur Stapelübersicht", strong: !waiting, action: onExit)
            }
            .padding(.top, Space.s2)
        }
        .frame(maxWidth: 460)
        .padding(Space.s6)
    }

    private var title: String {
        queue.done ? "Gratulation!" : queue.finishedForNow ? "Geschafft!" : "Keine Karten fällig"
    }

    private var lines: [String] {
        if queue.done { return ["Du hast diesen Stapel für heute fertig — keine fälligen Karten und keine offenen Lernschritte mehr."] }
        if queue.finishedForNow {
            let at = queue.nextLearnAt.flatMap(Self.time)
            return ["Du hast diesen Stapel für den Moment fertig gelernt.",
                    at.map { "Die nächste Lernkarte ist ab \($0) Uhr wieder dran." } ?? "Lernkarten sind später heute wieder dran."]
        }
        return ["Für diesen Stapel gibt es gerade keine weiteren fälligen Karten zum Lernen."]
    }

    /// ISO-Zeitpunkt → „HH:mm“.
    static func time(_ iso: String) -> String? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return nil }
        return d.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
    }
}

/// Getönter Knopf (`TintButton` der Android-App, `.primary`/Standard-Knopf der PWA).
struct TintButton: View {
    let title: String
    var strong = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: TextSize.sm, weight: .semibold))
                .foregroundStyle(strong ? Impala.onAccent : Impala.accent)
                .padding(.horizontal, 16)
                .frame(minHeight: 40)
                .background(strong ? Impala.accent : Impala.accent.opacity(0.1), in: Capsule())
        }
        .pressable()
    }
}
