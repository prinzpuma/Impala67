import SwiftUI

/// KI-Einstellungen (settings-renderer.js `renderAi`, `SettingsAiModels.kt`): aktives Modell, Quellen,
/// Verhalten. API-Schlüssel liegen nur im Schlüsselbund dieses iPads (`AiKeychain`), nie in den
/// synchronisierten Einstellungen.
struct AiSettingsSections: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell

    var body: some View {
        let _ = store.settingsRevision
        let s = AiSettings.read(store.core)
        AiModelSection(s: s)
        AiSourcesSection(s: s)
        AiBehaviorSection(s: s)
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
        Section {
            HStack(spacing: Space.s3) {
                Circle().fill(s.model.isEmpty ? Impala.warn : Impala.accent).frame(width: 10, height: 10)
                VStack(alignment: .leading, spacing: 2) {
                    Text(s.model.isEmpty ? "Kein Modell gewählt" : modelName(s.model))
                        .font(.system(size: TextSize.md, weight: .semibold))
                        .contentTransition(.interpolate)
                    Text(s.model.isEmpty ? "Wähle ein verfügbares Chat-Modell" : s.name(of: s.activeId))
                        .font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
                }
                .animation(.smooth, value: s.model)
                Spacer()
                Button(chat.modelsLoading ? "Lädt …" : "Neu laden") { chat.refreshModels(force: true) }
                    .buttonStyle(.glass)
                    .disabled(chat.modelsLoading)
            }
            TextField("Modelle durchsuchen …", text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            ForEach(s.sources) { src in
                let list = hits.filter { $0.providerId == src.id }
                if !list.isEmpty {
                    DisclosureGroup("\(src.label) (\(list.count))") {
                        ForEach(list, id: \.self) { m in
                            Button { chat.select(m) } label: {
                                HStack {
                                    Text(modelName(m.id)).foregroundStyle(Impala.text)
                                    Spacer()
                                    if m.providerId == s.activeId && m.id == s.model {
                                        Icon("check", size: 14).foregroundStyle(Impala.accent).transition(.scale.combined(with: .opacity))
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if !chat.modelsLoading && chat.modelsChecked && chat.models.isEmpty {
                Text("Keine Modelle gefunden. Prüfe die Quellen unten.").font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
            }
            DisclosureGroup("Manuelle Modell-ID", isExpanded: $manual) {
                TextField("Modell-ID", text: $manualModel)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Picker("Quelle", selection: $manualProvider) {
                    ForEach(s.sources) { Text($0.label).tag($0.id) }
                }
                Button("Übernehmen") {
                    AiSettings.select(store.core, providerId: manualProvider, model: manualModel.trimmingCharacters(in: .whitespaces))
                }
                .disabled(manualModel.trimmingCharacters(in: .whitespaces).isEmpty || manualProvider.isEmpty)
            }
        } header: {
            Text("KI · Aktives Modell")
        } footer: {
            Text("Nur wenn die Quelle das Modell nicht auflistet, die Modell-ID von Hand eingeben.")
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
        Section {
            ForEach(s.sources) { src in
                SourceRow(source: src, s: s, active: src.id == s.activeId)
            }
            ScrollView(.horizontal) {
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
            }
            .scrollIndicators(.hidden)
        } header: {
            Text("Quellen")
        } footer: {
            Text("API-Schlüssel bleiben nur auf diesem iPad (Schlüsselbund) und werden nicht synchronisiert. Zugangsdaten gelten erst nach „Speichern“.")
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
            TextField("Name", text: $name)
            TextField("Server-URL", text: $base, prompt: Text("https://…/v1"))
                .textContentType(.URL)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField("API-Key", text: $key, prompt: Text("Optional"))
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
            .animation(.smooth, value: dirty)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(source.label).font(.system(size: TextSize.md, weight: .medium))
                Text(active ? "Aktive Quelle" : source.base.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: ""))
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)
                    .lineLimit(1)
            }
        }
        .onAppear {
            open = active
            reset()
        }
        .onChange(of: source) { reset() }
        .animation(.smooth, value: status?.text)
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

    /// Leerzeichen und abschließende „/“ weg (wie `cleanBase` der Android-App).
    private func cleanBase(_ s: String) -> String {
        var b = s.trimmingCharacters(in: .whitespacesAndNewlines)
        while b.hasSuffix("/") { b.removeLast() }
        return b
    }
}

/// „Verhalten“: Werkzeuge mitsenden, Gedankengang, eigene Anweisungen.
private struct AiBehaviorSection: View {
    let s: AiSettings
    @Environment(ImpalaStore.self) private var store
    @State private var instructions = ""

    var body: some View {
        Section {
            Toggle(isOn: Binding(get: { s.alwaysSendTools }, set: { AiSettings.patch(store.core, ["alwaysSendTools": $0]) })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Tools mitsenden")
                    Text("Stellt der KI die App-Werkzeuge zur Verfügung").font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
                }
            }
            Toggle("Gedankengang (Denkaufwand)", isOn: Binding(get: { s.thinkingEnabled }, set: { AiSettings.patch(store.core, ["thinkingEnabled": $0]) }))
            VStack(alignment: .leading, spacing: Space.s2) {
                Text("Eigene Anweisungen")
                TextField("z. B. „Antworte knapp und auf Deutsch.“", text: $instructions, axis: .vertical)
                    .lineLimit(3...8)
                HStack {
                    Spacer()
                    Button("Speichern") { AiSettings.patch(store.core, ["customInstructions": instructions.trimmingCharacters(in: .whitespacesAndNewlines)]) }
                        .buttonStyle(.glass)
                        .disabled(instructions == s.customInstructions)
                }
            }
        } header: {
            Text("KI · Verhalten")
        }
        .onAppear { instructions = s.customInstructions }
    }
}
