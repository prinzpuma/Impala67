import CryptoKit
import Foundation
import Security

/// Google-Anmeldung für das Drive-Backup: OAuth 2.0 mit PKCE über `ASWebAuthenticationSession`
/// (SwiftUI `webAuthenticationSession`), Bereich `drive.appdata`. Braucht einen OAuth-Client vom Typ
/// **iOS** (Bundle-ID `org.impala67.app`) im selben Google-Cloud-Projekt wie die Web-Client-ID der PWA,
/// sonst sieht das iPad einen anderen App-Ordner. Die Client-ID steht in `ios/project.yml`
/// (`GOOGLE_IOS_CLIENT_ID` → Info.plist `ImpalaGoogleClientID`); sie ist kein Geheimnis.
/// Das Refresh-Token liegt nur im Schlüsselbund dieses Geräts, das Zugriffstoken nur im Speicher.
enum GoogleOAuth {
    static let scope = "https://www.googleapis.com/auth/drive.appdata"
    private static let suffix = ".apps.googleusercontent.com"

    /// Leer, solange in `project.yml` noch der Platzhalter steht.
    static var clientId: String {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "ImpalaGoogleClientID") as? String ?? "")
            .trimmingCharacters(in: .whitespaces)
        return raw.hasSuffix(suffix) && !raw.hasPrefix("DEINE_") ? raw : ""
    }

    /// Umgekehrte Client-ID als URL-Schema (so verlangt Google es für iOS-Clients).
    static var callbackScheme: String { "com.googleusercontent.apps." + clientId.replacingOccurrences(of: suffix, with: "") }
    static var redirectUri: String { callbackScheme + ":/oauth2redirect" }

    /// Ein Anmeldeversuch: PKCE-Prüfwert und `state` bleiben bis zum Rücksprung hier.
    struct Attempt {
        let url: URL
        let verifier: String
        let state: String
    }

    static func attempt() -> Attempt? {
        guard !clientId.isEmpty else { return nil }
        let verifier = randomToken(48)
        let state = randomToken(16)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64Url
        var c = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        c.queryItems = [
            .init(name: "client_id", value: clientId),
            .init(name: "redirect_uri", value: redirectUri),
            .init(name: "response_type", value: "code"),
            .init(name: "scope", value: scope),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state),
            .init(name: "prompt", value: "select_account consent"),
        ]
        return Attempt(url: c.url!, verifier: verifier, state: state)
    }

    struct Tokens {
        let access: String
        let expiresIn: Double
        let refresh: String?
    }

    enum Failure: Error { case cancelled, invalid(String), rejected }

    /// Code aus dem Rücksprung gegen Tokens tauschen.
    static func exchange(callback: URL, attempt: Attempt) async throws -> Tokens {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if let error = items.first(where: { $0.name == "error" })?.value {
            throw error == "access_denied" ? Failure.cancelled : Failure.invalid(error)
        }
        guard items.first(where: { $0.name == "state" })?.value == attempt.state,
              let code = items.first(where: { $0.name == "code" })?.value
        else { throw Failure.invalid("Ungültige Antwort von Google.") }
        let (data, _) = try await URLSession.shared.data(for: tokenRequest([
            "grant_type": "authorization_code", "code": code, "client_id": clientId,
            "redirect_uri": redirectUri, "code_verifier": attempt.verifier,
        ]))
        return try parse(data)
    }

    /// Still erneuern (läuft auf dem Drive-Thread des Kerns, daher synchron).
    static func refreshSync(_ refresh: String) throws -> Tokens {
        let request = tokenRequest(["grant_type": "refresh_token", "refresh_token": refresh, "client_id": clientId])
        final class Box: @unchecked Sendable { var result: Result<Data, Error> = .failure(Failure.invalid("Zeitüberschreitung")) }
        let box = Box()
        let done = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: request) { data, _, error in
            box.result = data.map { .success($0) } ?? .failure(error ?? Failure.invalid("Keine Antwort"))
            done.signal()
        }.resume()
        _ = done.wait(timeout: .now() + 30)
        return try parse(box.result.get())
    }

    /// „Abmelden“: Zugriff bei Google zurückziehen (Fehler egal).
    static func revoke(_ token: String) async {
        var c = URLComponents(string: "https://oauth2.googleapis.com/revoke")!
        c.queryItems = [.init(name: "token", value: token)]
        var request = URLRequest(url: c.url!)
        request.httpMethod = "POST"
        _ = try? await URLSession.shared.data(for: request)
    }

    private static func tokenRequest(_ form: [String: String]) -> URLRequest {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var c = URLComponents()
        c.queryItems = form.map { URLQueryItem(name: $0.key, value: $0.value) }
        request.httpBody = Data((c.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B").utf8)
        return request
    }

    private static func parse(_ data: Data) throws -> Tokens {
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard let access = json["access_token"] as? String else {
            // `invalid_grant`: Zustimmung widerrufen oder Refresh-Token abgelaufen.
            if json["error"] as? String == "invalid_grant" { throw Failure.rejected }
            throw Failure.invalid(json["error_description"] as? String ?? json["error"] as? String ?? "Google hat kein Zugriffstoken geliefert.")
        }
        return Tokens(access: access, expiresIn: (json["expires_in"] as? Double) ?? 3600, refresh: json["refresh_token"] as? String)
    }

    private static func randomToken(_ bytes: Int) -> String {
        var data = Data(count: bytes)
        _ = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, bytes, $0.baseAddress!) }
        return data.base64Url
    }
}

/// Refresh-Token im Schlüsselbund (`…ThisDeviceOnly`, wie die KI-Schlüssel).
enum DriveKeychain {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "org.impala67.drive",
        kSecAttrAccount as String: "refresh-token",
    ]

    static var refreshToken: String? {
        get {
            var q = query
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            var out: CFTypeRef?
            guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
            return String(data: data, encoding: .utf8)
        }
        set {
            SecItemDelete(query as CFDictionary)
            guard let newValue, !newValue.isEmpty else { return }
            var q = query
            q[kSecValueData as String] = Data(newValue.utf8)
            // Nach dem ersten Entsperren: auch der Hintergrund-Sync kommt dran.
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(q as CFDictionary, nil)
        }
    }
}

/// Tokens für den Rust-Drive-Thread (`DriveTokens`): Zugriffstoken im Speicher, still über das
/// Refresh-Token erneuert. Wird von beliebigen Threads gerufen.
final class DriveTokenStore: DriveTokens, @unchecked Sendable {
    private let lock = NSLock()
    private var access: String?
    private var expiresAt = Date.distantPast
    private let onExpired: @Sendable () -> Void

    init(onExpired: @escaping @Sendable () -> Void) { self.onExpired = onExpired }

    func remember(_ t: GoogleOAuth.Tokens) {
        lock.withLock {
            access = t.access
            // Etwas früher erneuern als Google es verlangt.
            expiresAt = Date().addingTimeInterval(max(60, t.expiresIn - 300))
        }
        if let refresh = t.refresh { DriveKeychain.refreshToken = refresh }
    }

    func forget() -> String? {
        lock.withLock {
            defer { access = nil; expiresAt = .distantPast }
            return access
        }
    }

    func accessToken() -> String? {
        if let t = lock.withLock({ Date() < expiresAt ? access : nil }) { return t }
        return refresh()
    }

    func renewToken(rejected: String) -> String? {
        lock.withLock { if access == rejected { access = nil; expiresAt = .distantPast } }
        return refresh()
    }

    func tokenExpired() {
        _ = forget()
        onExpired()
    }

    private func refresh() -> String? {
        guard let refresh = DriveKeychain.refreshToken else { return nil }
        do {
            let tokens = try GoogleOAuth.refreshSync(refresh)
            remember(tokens)
            return tokens.access
        } catch GoogleOAuth.Failure.rejected {
            DriveKeychain.refreshToken = nil
            return nil
        } catch {
            return nil
        }
    }
}

private extension Data {
    var base64Url: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
