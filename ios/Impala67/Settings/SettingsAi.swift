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

/// „Aktives Modell“: Modelle aller Quellen nach Quelle gruppiert und durchsuchbar, manuelle Modell-ID.
private struct AiModelSection: View {
    let s: AiSettings
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
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
                    .buttonStyle(.glass)
                    .disabled(chat.modelsLoading)
                }
            )

            SettingsDivider()

            // Suchfeld
            HStack(spacing: Space.s2) {
                Icon("search", size: 14)
                    .foregroundStyle(Impala.text2)
                TextField("Modelle durchsuchen …", text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !query.isEmpty {
                    Button { query = "" } label: {
                        Icon("x", size: 12).foregroundStyle(Impala.text2)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, Space.s4)
            .padding(.vertical, Space.s2 + 2)

            SettingsDivider()

            // Modell-Liste nach Provider
            ForEach(s.sources) { src in
                let list = hits.filter { $0.providerId == src.id }
                if !list.isEmpty {
                    DisclosureGroup("\(src.label) (\(list.count))") {
                        ForEach(list, id: \.self) { m in
                            Button { chat.select(m) } label: {
                                HStack {
                                    Text(modelName(m.id))
                                        .font(.system(size: TextSize.sm))
                                        .foregroundStyle(Impala.text)
                                    Spacer()
                                    if m.providerId == s.activeId && m.id == s.model {
                                        Icon("check", size: 14)
                                            .foregroundStyle(Impala.accent)
                                            .transition(.scale.combined(with: .opacity))
                                    }
                                }
                                .padding(.vertical, 4)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, Space.s4)
                    .padding(.vertical, Space.s2)

                    SettingsDivider()
                }
            }

            if !chat.modelsLoading && chat.modelsChecked && chat.models.isEmpty {
                SettingsRow(
                    title: "Keine Modelle gefunden",
                    description: "Prüfe die unten hinterlegten Quellen und API-Schlüssel."
                )
                SettingsDivider()
            }

            // Manuelle Modell-ID
            DisclosureGroup("Manuelle Modell-ID", isExpanded: $manual) {
                VStack(spacing: Space.s2) {
                    TextField("Modell-ID (z. B. gpt-4o oder claude-3-5-sonnet)", text: $manualModel)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    HStack {
                        Picker("Quelle", selection: $manualProvider) {
                            ForEach(s.sources) { Text($0.label).tag($0.id) }
                        }
                        .pickerStyle(.menu)
                        Spacer()
                        Button("Übernehmen") {
                            AiSettings.select(store.core, providerId: manualProvider, model: manualModel.trimmingCharacters(in: .whitespaces))
                        }
                        .buttonStyle(.glassProminent)
                        .disabled(manualModel.trimmingCharacters(in: .whitespaces).isEmpty || manualProvider.isEmpty)
                    }
                }
                .padding(.vertical, 4)
            }
            .padding(.horizontal, Space.s4)
            .padding(.vertical, Space.s2)
        }
        .onAppear {
            chat.refreshModels()
            manualModel = s.model
            manualProvider = s.activeId
        }
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
                    .buttonStyle(.glassProminent)

                    ForEach(Array(AiSettings.presets.enumerated()), id: \.offset) { _, preset in
                        Button(preset.label) {
                            var p = preset.source
                            if s.sources.contains(where: { $0.id == p.id }) { p.id += "-\(UUID().uuidString.prefix(4).lowercased())" }
                            s.save(store.core, p)
                        }
                        .buttonStyle(.glass)
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
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: Space.s2) {
                TextField("Name", text: $name)
                    .textFieldStyle(.roundedBorder)
                TextField("Server-URL", text: $base, prompt: Text("https://…/v1"))
                    .textFieldStyle(.roundedBorder)
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("API-Key", text: $key, prompt: Text("Optional"))
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                if let status {
                    Text(status.text)
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(status.ok ? Impala.success : Impala.danger)
                        .transition(.opacity)
                }

                HStack {
                    Button("Entfernen", role: .destructive) { confirmRemove = true }
                        .buttonStyle(.glass)
                    Spacer()
                    Button(testing ? "Teste …" : "Verbindung testen") { test() }
                        .buttonStyle(.glass)
                        .disabled(testing)
                    Button("Speichern") {
                        s.save(store.core, AiSource(id: source.id, name: name.trimmingCharacters(in: .whitespaces),
                                                    base: cleanBase(base), key: key))
                        shell.chat.refreshModels(force: true)
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(!dirty)
                }
            }
            .padding(.top, 4)
            .padding(.bottom, 2)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(source.label).font(.system(size: TextSize.base, weight: .medium))
                Text(active ? "Aktive Quelle" : source.base.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: ""))
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, Space.s4)
        .padding(.vertical, Space.s2 + 2)
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

    private func cleanBase(_ s: String) -> String {
        var b = s.trimmingCharacters(in: .whitespacesAndNewlines)
        while b.hasSuffix("/") { b.removeLast() }
        return b
    }
}

/// „Lokale KI“: Handschrift-Erkennung mit Apple Vision und Semantische Suche.
private struct AiLocalSection: View {
    @Environment(ImpalaStore.self) private var store

    var body: some View {
        let _ = store.revision
        let jobs = store.core.heftOcrJobs(src: "apple")

        SettingsCardGroup(
            title: "Lokale KI",
            footnote: "Handschrifterkennung und semantische Suche laufen direkt auf dem iPad; deine Inhalte verlassen dafür das Gerät nicht."
        ) {
            SettingsRow(
                title: "Handschrifterkennung (Digital Ink)",
                description: "100 % lokal (Apple Vision) · \(jobs.isEmpty ? "Alle Notizen erkannt" : "\(jobs.count) Seiten in Bearbeitung")",
                leading: { StatusIndicator(tone: .ok) }
            )
            SettingsDivider()
            SettingsRow(
                title: "Semantische Suche & Verwandte Seiten",
                description: "Vektorsuche und inhaltliche Verknüpfungen direkt auf dem Gerät",
                leading: { StatusIndicator(tone: .ok) }
            )
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
                    .font(.system(size: TextSize.base, weight: .medium))
                    .foregroundStyle(Impala.text)
                Text("Tonfall, Fach und dauerhafte Vorgaben für den KI-Assistenten")
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)
                TextField("z. B. „Antworte prägnant und auf Deutsch.“", text: $instructions, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(3...7)
                HStack {
                    Spacer()
                    Button("Speichern") {
                        AiSettings.patch(store.core, ["customInstructions": instructions.trimmingCharacters(in: .whitespacesAndNewlines)])
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(instructions == s.customInstructions)
                }
            }
            .padding(.horizontal, Space.s4)
            .padding(.vertical, Space.s3)
        }
        .onAppear { instructions = s.customInstructions }
    }
}
