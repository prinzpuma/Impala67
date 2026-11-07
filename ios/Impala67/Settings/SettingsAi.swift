import SwiftUI

/// KI-Einstellungen (settings-renderer.js `renderAi`, `SettingsAiModels.kt`): aktives Modell, Quellen,
/// lokale KI und Verhalten. API-Schlüssel liegen nur im Schlüsselbund dieses iPads (`AiKeychain`), nie in den
/// synchronisierten Einstellungen.
struct AiSettingsSections: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell

    var body: some View {
        let _ = store.settingsRevision
        let s = AiSettings.read(store.core)
        VStack(alignment: .leading, spacing: 0) {
            SettingsPageHead(
                title: "KI",
                description: "Modelle, Zugänge und lokale KI – alles auf einer Seite."
            )
            AiModelSection(s: s)
            AiSourcesSection(s: s)
            AiLocalSection()
            AiBehaviorSection(s: s)
        }
    }
}

/// „Aktives Modell“: Modelle aller Quellen nach Quelle gruppiert und durchsuchbar, Favoriten oben, manuelle Modell-ID.
private struct AiModelSection: View {
    let s: AiSettings
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @AppStorage("impala67FavModels") private var favModelsRaw = ""
    @State private var query = ""
    @State private var manual = false
    @State private var manualModel = ""
    @State private var manualProvider = ""

    var body: some View {
        let chat = shell.chat
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let hits = chat.models.filter { q.isEmpty || "\($0.id) \(s.name(of: $0.providerId))".lowercased().contains(q) }

        SettingsCardGroup(
            title: "Aktives Modell",
            footnote: "Nur wenn die Quelle das Modell nicht auflistet, die Modell-ID von Hand eingeben."
        ) {
            // Status-Zeile
            SettingsRow(
                title: s.model.isEmpty ? "Kein Modell gewählt" : modelName(s.model),
                description: s.model.isEmpty ? "Wähle ein verfügbares Chat-Modell" : s.name(of: s.activeId),
                leading: { StatusIndicator(tone: s.model.isEmpty ? .warn : .ok) },
                trailing: {
                    Button(chat.modelsLoading ? "Lädt …" : "Neu laden") {
                        chat.refreshModels(force: true)
                    }
                    .settingsButton(.secondary)
                    .disabled(chat.modelsLoading)
                }
            )

            SettingsDivider()

            // Modell-Suchleiste (.settings-model-search)
            HStack(spacing: Space.s2) {
                HStack(spacing: 6) {
                    Icon("search", size: 14)
                        .foregroundStyle(Impala.text2)
                    TextField("Modelle durchsuchen …", text: $query)
                        .textFieldStyle(.plain)
                        .font(.system(size: TextSize.sm))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if !query.isEmpty {
                        Button {
                            query = ""
                        } label: {
                            Icon("x", size: 12)
                                .foregroundStyle(Impala.text2)
                                .padding(3)
                                .background(Impala.edgeSoft.opacity(0.4), in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Impala.panel, in: Capsule())
                .overlay(Capsule().strokeBorder(Impala.edgeSoft, lineWidth: 1))

                Text("\(hits.count) von \(chat.models.count) Modelle")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Impala.text2)
            }
            .padding(.horizontal, Space.s4)
            .padding(.vertical, Space.s2 + 2)

            SettingsDivider()

            // Scrollbare PWA-Modellliste mit Favoriten (.settings-model-list)
            ScrollView {
                VStack(alignment: .leading, spacing: 1) {
                    if chat.modelsLoading && chat.models.isEmpty {
                        Text("Lädt …")
                            .font(.system(size: TextSize.sm))
                            .foregroundStyle(Impala.text2)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.vertical, 24)
                    } else if chat.models.isEmpty {
                        Text("Keine Modelle gefunden. Prüfe die unten hinterlegten Quellen.")
                            .font(.system(size: TextSize.sm))
                            .foregroundStyle(Impala.text2)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.vertical, 24)
                            .padding(.horizontal, 16)
                    } else if hits.isEmpty {
                        Text("Kein Modell passt zu „\(query)“.")
                            .font(.system(size: TextSize.sm))
                            .foregroundStyle(Impala.text2)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.vertical, 24)
                    } else {
                        let favHits = hits.filter { isFav($0) }
                        if !favHits.isEmpty {
                            Text("FAVORITEN")
                                .font(.system(size: 11, weight: .bold))
                                .tracking(0.5)
                                .foregroundStyle(Impala.text2)
                                .padding(.horizontal, 12)
                                .padding(.top, 8)
                                .padding(.bottom, 2)

                            ForEach(favHits, id: \.self) { m in
                                modelRow(m, srcLabel: s.name(of: m.providerId), chat: chat)
                            }
                        }

                        ForEach(s.sources) { src in
                            let list = hits.filter { $0.providerId == src.id }
                            if !list.isEmpty {
                                Text("\(src.label.uppercased()) (\(list.count))")
                                    .font(.system(size: 11, weight: .bold))
                                    .tracking(0.5)
                                    .foregroundStyle(Impala.text2)
                                    .padding(.horizontal, 12)
                                    .padding(.top, 8)
                                    .padding(.bottom, 2)

                                ForEach(list, id: \.self) { m in
                                    modelRow(m, srcLabel: src.label, chat: chat)
                                }
                            }
                        }
                    }
                }
                .padding(.vertical, 4)
            }
            .frame(minHeight: 160, maxHeight: 280)
            .background(Impala.panel.opacity(0.45))

            SettingsDivider()

            // Aufklappbereich „Manuelle Modell-ID“
            SettingsDisclosure(
                title: "Manuelle Modell-ID",
                subtitle: "Falls die Quelle ein Modell nicht automatisch auflistet",
                isExpanded: $manual
            ) {
                VStack(alignment: .leading, spacing: Space.s2) {
                    TextField("Modell-ID (z. B. gpt-4o oder claude-3-5-sonnet)", text: $manualModel)
                        .settingsInputStyle()
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    HStack(spacing: Space.s2) {
                        Picker("Quelle", selection: $manualProvider) {
                            ForEach(s.sources) { Text($0.label).tag($0.id) }
                        }
                        .pickerStyle(.menu)
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .frame(minHeight: 34)
                        .background(Impala.panel, in: RoundedRectangle(cornerRadius: Radius.sm))
                        .overlay(
                            RoundedRectangle(cornerRadius: Radius.sm)
                                .strokeBorder(Impala.edgeSoft, lineWidth: 1)
                        )

                        Spacer()

                        Button("Übernehmen") {
                            AiSettings.select(store.core, providerId: manualProvider, model: manualModel.trimmingCharacters(in: .whitespaces))
                        }
                        .settingsButton(.primary)
                        .disabled(manualModel.trimmingCharacters(in: .whitespaces).isEmpty || manualProvider.isEmpty)
                    }
                }
                .padding(.horizontal, Space.s4)
                .padding(.vertical, Space.s3)
            }
        }
        .onAppear {
            chat.refreshModels()
            manualModel = s.model
            manualProvider = s.activeId
        }
        .onChange(of: s.model) {
            if !manual { manualModel = s.model }
        }
        .onChange(of: s.activeId) {
            if !manual { manualProvider = s.activeId }
        }
    }

    @ViewBuilder
    private func modelRow(_ m: AiModel, srcLabel: String, chat: ChatModel) -> some View {
        let isActive = m.providerId == s.activeId && m.id == s.model
        HStack(spacing: 2) {
            Button {
                chat.select(m)
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(modelName(m.id))
                            .font(.system(size: TextSize.xs, weight: .semibold))
                            .foregroundStyle(isActive ? Impala.accent : Impala.text)
                            .lineLimit(1)
                        Text(srcLabel)
                            .font(.system(size: 11))
                            .foregroundStyle(isActive ? Impala.accent : Impala.text2)
                            .lineLimit(1)
                    }
                    Spacer()
                    if isActive {
                        Icon("check", size: 13)
                            .foregroundStyle(Impala.accent)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .frame(minHeight: 36)
                .background(isActive ? Impala.activeTint : Color.clear, in: RoundedRectangle(cornerRadius: Radius.sm))
            }
            .buttonStyle(.plain)

            Button {
                toggleFav(m)
            } label: {
                Text(isFav(m) ? "★" : "☆")
                    .font(.system(size: 15))
                    .foregroundStyle(isFav(m) ? Impala.warn : Impala.text2)
                    .frame(width: 30, height: 34)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 6)
    }

    private var favKeys: Set<String> {
        Set(favModelsRaw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
    }

    private func modelKey(_ m: AiModel) -> String {
        "\(m.providerId)::\(m.id)" // wie `favModels` in state.js
    }

    private func isFav(_ m: AiModel) -> Bool {
        favKeys.contains(modelKey(m))
    }

    private func toggleFav(_ m: AiModel) {
        var set = favKeys
        let key = modelKey(m)
        if set.contains(key) {
            set.remove(key)
        } else {
            set.insert(key)
        }
        favModelsRaw = set.sorted().joined(separator: ",")
    }

    private func modelName(_ id: String) -> String { id == "impala-ai" ? "Impala AI" : id }
}

/// „Quellen“: je Quelle Name, Server-URL und API-Key (aufklappbar, aktive offen), Verbindung testen.
private struct AiSourcesSection: View {
    let s: AiSettings
    @Environment(ImpalaStore.self) private var store

    var body: some View {
        SettingsCardGroup(
            title: "Quellen",
            footnote: "API-Schlüssel bleiben nur auf diesem iPad (Schlüsselbund) und werden nicht synchronisiert. Zugangsdaten gelten erst nach „Speichern“."
        ) {
            ForEach(s.sources) { src in
                SourceRow(source: src, s: s, active: src.id == s.activeId)
                SettingsDivider()
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Space.s2) {
                    Button("Quelle hinzufügen") {
                        s.save(store.core, AiSource(id: "custom-\(UUID().uuidString.prefix(8).lowercased())", name: "Neue Quelle", base: "", key: ""))
                    }
                    .settingsButton(.primary)

                    ForEach(Array(AiSettings.presets.enumerated()), id: \.offset) { _, preset in
                        Button(preset.label) {
                            var p = preset.source
                            if s.sources.contains(where: { $0.id == p.id }) { p.id += "-\(UUID().uuidString.prefix(4).lowercased())" }
                            s.save(store.core, p)
                        }
                        .settingsButton(.secondary)
                    }
                }
                .padding(.horizontal, Space.s4)
                .padding(.vertical, Space.s3)
            }
        }
    }
}

private struct SourceRow: View {
    let source: AiSource
    let s: AiSettings
    let active: Bool
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @State private var open = false
    @State private var name = ""
    @State private var base = ""
    @State private var key = ""
    @State private var status: (ok: Bool, text: String)?
    @State private var testing = false
    @State private var confirmRemove = false

    var body: some View {
        let dirty = name != source.name || base != source.base || key != source.key
        SettingsDisclosure(
            title: source.label,
            subtitle: active ? "Aktive Quelle" : cleanDisplayUrl(source.base),
            badge: active ? "Aktiv" : nil,
            isExpanded: $open
        ) {
            SettingsInputRow(title: "Name") {
                TextField("Name", text: $name)
                    .settingsInputStyle()
            }

            SettingsDivider()

            SettingsInputRow(title: "Server-URL", description: "OpenAI-kompatibler Endpunkt") {
                TextField("https://…/v1", text: $base)
                    .settingsInputStyle()
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }

            SettingsDivider()

            SettingsInputRow(title: "API-Schlüssel", description: "Bleibt lokal im Schlüsselbund") {
                SecureField("Optional", text: $key)
                    .settingsInputStyle()
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }

            if let status {
                SettingsDivider()
                HStack(spacing: Space.s2) {
                    StatusIndicator(tone: status.ok ? .ok : .danger)
                    Text(status.text)
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(status.ok ? Impala.success : Impala.danger)
                }
                .padding(.horizontal, Space.s4)
                .padding(.vertical, 8)
            }

            SettingsDivider()

            HStack(spacing: 8) {
                Button(testing ? "Teste …" : "Verbindung testen") {
                    test()
                }
                .settingsButton(.primary)
                .disabled(testing)

                Button("Speichern") {
                    s.save(store.core, AiSource(
                        id: source.id,
                        name: name.trimmingCharacters(in: .whitespaces),
                        base: cleanBase(base),
                        key: key
                    ))
                    shell.chat.refreshModels(force: true)
                }
                .settingsButton(.secondary)
                .disabled(!dirty)

                Spacer()

                Button("Entfernen") {
                    confirmRemove = true
                }
                .settingsButton(.danger)
            }
            .padding(.horizontal, Space.s4)
            .padding(.vertical, 10)
        }
        .onAppear {
            open = active
            reset()
        }
        .onChange(of: source) { reset() }
        .confirmationDialog("Quelle entfernen", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Entfernen", role: .destructive) { s.remove(store.core, source.id) }
            Button("Abbrechen", role: .cancel) {}
        } message: {
            Text("„\(source.label)“ wird auf allen Geräten entfernt, der Schlüssel von diesem iPad gelöscht.")
        }
    }

    private func reset() {
        name = source.name
        base = source.base
        key = source.key
    }

    private func test() {
        testing = true
        status = nil
        let core = store.core
        let b = cleanBase(base)
        let k = key.trimmingCharacters(in: .whitespacesAndNewlines)
        Task.detached {
            let r = core.aiPingProvider(base: b, key: k)
            await MainActor.run {
                testing = false
                if r.ok {
                    status = (true, "Verbunden · \(r.models) Modelle gefunden.")
                } else {
                    if let suggested = r.suggestedBase { base = suggested }
                    status = (false, r.error ?? "Keine Verbindung.")
                }
            }
        }
    }

    private func cleanDisplayUrl(_ url: String) -> String {
        url.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "")
    }

    private func cleanBase(_ s: String) -> String {
        var b = s.trimmingCharacters(in: .whitespacesAndNewlines)
        while b.hasSuffix("/") { b.removeLast() }
        return b
    }
}

/// „Lokale KI“: Handschrift-Erkennung mit Apple Vision und Semantische Suche.
private struct AiLocalSection: View {
    @Environment(ImpalaStore.self) private var store
    /// Offene Erkennungsaufträge; laufen über alle Hefte, daher im Hintergrund gezählt (`.task` unten).
    @State private var jobCount = 0

    var body: some View {
        SettingsCardGroup(
            title: "Lokale KI",
            footnote: "Handschrifterkennung und semantische Suche laufen direkt auf dem iPad; deine Inhalte verlassen dafür das Gerät nicht."
        ) {
            SettingsRow(
                title: "Handschrifterkennung (Digital Ink)",
                description: "100 % lokal (Apple Vision) · \(jobCount == 0 ? "Alle Notizen erkannt" : "\(jobCount) Seiten in Bearbeitung")",
                leading: { StatusIndicator(tone: .ok) }
            )
            SettingsDivider()
            SettingsRow(
                title: "Semantische Suche & Verwandte Seiten",
                description: "Vektorsuche und inhaltliche Verknüpfungen direkt auf dem Gerät",
                leading: { StatusIndicator(tone: .ok) }
            )
        }
        // Neue Aufträge entstehen bei Heftänderungen (auch von anderen Geräten), erledigte beim Erkennen.
        .task(id: [store.pageMetaRevision, store.remoteRevision]) {
            let core = store.core
            let next = await Task.detached(priority: .utility) { core.heftOcrJobs(src: "apple").count }.value
            if !Task.isCancelled { jobCount = next }
        }
    }
}

/// „Verhalten“: Werkzeuge mitsenden, Gedankengang, eigene Anweisungen.
private struct AiBehaviorSection: View {
    let s: AiSettings
    @Environment(ImpalaStore.self) private var store
    @State private var instructions = ""

    var body: some View {
        SettingsCardGroup(title: "Verhalten") {
            SettingsSwitchRow(
                title: "Tools mitsenden",
                description: "Stellt der KI die App-Werkzeuge zur Verfügung",
                isOn: Binding(
                    get: { s.alwaysSendTools },
                    set: { AiSettings.patch(store.core, ["alwaysSendTools": $0]) }
                )
            )
            SettingsDivider()
            SettingsSwitchRow(
                title: "Gedankengang (Denkaufwand)",
                description: "Zeigt Denkprozesse von Modellen mit Denkaufwand an",
                isOn: Binding(
                    get: { s.thinkingEnabled },
                    set: { AiSettings.patch(store.core, ["thinkingEnabled": $0]) }
                )
            )
            SettingsDivider()
            VStack(alignment: .leading, spacing: Space.s2) {
                Text("Eigene Anweisungen")
                    .font(.system(size: TextSize.base, weight: .semibold))
                    .foregroundStyle(Impala.text)
                Text("Tonfall, Fach und dauerhafte Vorgaben für den KI-Assistenten")
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)
                TextField("z. B. „Antworte prägnant und auf Deutsch.“", text: $instructions, axis: .vertical)
                    .settingsInputStyle()
                    .lineLimit(4...8)
                HStack {
                    Spacer()
                    Button("Speichern") {
                        AiSettings.patch(store.core, ["customInstructions": instructions.trimmingCharacters(in: .whitespacesAndNewlines)])
                    }
                    .settingsButton(.primary)
                    .disabled(instructions == s.customInstructions)
                }
            }
            .padding(.horizontal, Space.s4)
            .padding(.vertical, Space.s3)
        }
        .onAppear { instructions = s.customInstructions }
        .onChange(of: s.customInstructions) { instructions = s.customInstructions }
    }
}
