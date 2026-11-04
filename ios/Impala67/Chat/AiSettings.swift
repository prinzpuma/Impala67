import Foundation
import Security

/// API-Schlüssel der KI-Quellen: nur im Schlüsselbund dieses Geräts (nicht in den Kern-Einstellungen,
/// nicht in iCloud). Der Kern bekommt sie je Lauf über `AiOptions.providersJson` bzw. `aiListModelsWith`.
enum AiKeychain {
    private static let service = "org.impala67.ai-key"

    static func key(_ providerId: String) -> String? {
        var q = query(providerId)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Leer = Schlüssel vom Gerät löschen.
    static func set(_ key: String, for providerId: String) {
        SecItemDelete(query(providerId) as CFDictionary)
        let k = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !k.isEmpty else { return }
        var q = query(providerId)
        q[kSecValueData as String] = Data(k.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    private static func query(_ id: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: id]
    }
}

/// Eine KI-Quelle (`settings.aiProviders[]`); `key` ist der wirksame Schlüssel: aus dem Schlüsselbund,
/// sonst ein von einem anderen Gerät mitsynchronisierter.
struct AiSource: Identifiable, Equatable {
    var id: String
    var name: String
    var base: String
    var key: String

    var label: String { name.isEmpty ? id : name }
}

/// KI-Einstellungen aus dem Kern (`aiProviders`, `aiProviderId`, `aiModel`, `thinkingEnabled`,
/// `alwaysSendTools`, `customInstructions`) plus Schlüssel aus dem Schlüsselbund. Geschrieben wird nur über
/// `updateSettings` – ohne Schlüssel (fehlendes `key` lässt einen vorhandenen im Kern unangetastet).
struct AiSettings: Equatable {
    var sources: [AiSource]
    var providerId: String
    var model: String
    var thinkingEnabled: Bool
    var alwaysSendTools: Bool
    var customInstructions: String
    /// Sync-Schlüssel für „Impala AI“ (Cloudflare-Worker).
    var syncKey: String

    /// Schnell-Schaltflächen „Quelle hinzufügen“ (extras.js `data-provpreset`), zugleich die Voreinstellung.
    static let presets: [(label: String, source: AiSource)] = [
        ("Impala AI", AiSource(id: "cloudflare", name: "Impala AI", base: "https://impala67-sync.joshuagayer1.workers.dev", key: "")),
        ("LM Studio", AiSource(id: "local", name: "Lokal (LM Studio)", base: "http://localhost:1234/v1", key: "")),
        ("Gemini", AiSource(id: "google", name: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", key: "")),
        ("OpenAI", AiSource(id: "openai", name: "OpenAI", base: "https://api.openai.com/v1", key: "")),
    ]

    static func read(_ core: ImpalaCore) -> AiSettings {
        let s = (try? JSONSerialization.jsonObject(with: Data(core.settingsJson().utf8))) as? [String: Any] ?? [:]
        var sources = (s["aiProviders"] as? [[String: Any]] ?? []).compactMap { p -> AiSource? in
            guard let id = p["id"] as? String, !id.isEmpty else { return nil }
            let synced = p["key"] as? String ?? ""
            return AiSource(id: id, name: p["name"] as? String ?? "", base: p["base"] as? String ?? "",
                            key: AiKeychain.key(id) ?? synced)
        }
        if sources.isEmpty {
            sources = presets.map { var p = $0.source; p.key = AiKeychain.key(p.id) ?? ""; return p }
        }
        return AiSettings(
            sources: sources,
            providerId: s["aiProviderId"] as? String ?? "",
            model: s["aiModel"] as? String ?? "",
            thinkingEnabled: s["thinkingEnabled"] as? Bool ?? true,
            alwaysSendTools: s["alwaysSendTools"] as? Bool ?? true,
            customInstructions: s["customInstructions"] as? String ?? "",
            syncKey: s["cfSyncKey"] as? String ?? ""
        )
    }

    var activeId: String { providerId.isEmpty ? sources.first?.id ?? "" : providerId }

    func name(of providerId: String) -> String { sources.first { $0.id == providerId }?.label ?? providerId }

    /// Wie `currentModelLabel` in render.js.
    var label: String {
        let name = sources.first { $0.id == activeId }?.label
        if model.isEmpty { return "Kein Modell" }
        if model == "impala-ai" { return name ?? "Impala AI" }
        return (name.map { "\($0) · " } ?? "") + model
    }

    /// Quellen samt Schlüssel (nur an den Kern, nie gespeichert).
    var providersJson: String {
        let list = sources.map { ["id": $0.id, "name": $0.name, "base": $0.base, "key": $0.key] }
        let data = (try? JSONSerialization.data(withJSONObject: list)) ?? Data("[]".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    // MARK: Schreiben

    static func patch(_ core: ImpalaCore, _ values: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: values) else { return }
        try? core.updateSettings(patchJson: String(decoding: data, as: UTF8.self))
    }

    static func select(_ core: ImpalaCore, providerId: String, model: String) {
        patch(core, ["aiProviderId": providerId, "aiModel": model])
    }

    /// Quellen ohne Schlüssel in die Einstellungen; Schlüssel nur in den Schlüsselbund.
    static func saveSources(_ core: ImpalaCore, _ list: [AiSource]) {
        patch(core, ["aiProviders": list.map { ["id": $0.id, "name": $0.name, "base": $0.base] }])
    }

    /// Eine Quelle speichern (neu oder geändert); ein geänderter Schlüssel landet im Schlüsselbund.
    func save(_ core: ImpalaCore, _ source: AiSource) {
        let old = sources.first { $0.id == source.id }
        if old?.key != source.key { AiKeychain.set(source.key, for: source.id) }
        var list = sources
        if let i = list.firstIndex(where: { $0.id == source.id }) { list[i] = source } else { list.append(source) }
        Self.saveSources(core, list)
    }

    func remove(_ core: ImpalaCore, _ id: String) {
        AiKeychain.set("", for: id)
        Self.saveSources(core, sources.filter { $0.id != id })
        if providerId == id { Self.patch(core, ["aiProviderId": sources.first { $0.id != id }?.id ?? "", "aiModel": ""]) }
    }
}
