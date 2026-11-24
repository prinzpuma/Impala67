import Foundation
import Network

/// Sucht den laufenden Impala67-MCP-Server im lokalen WLAN per Bonjour (`_impala-dev._tcp`),
/// löst die erreichbare IPv4-Adresse + Port auf und meldet sie an `DevBridge`.
@MainActor
final class DevBridgeDiscovery {
    static let serviceType = "_impala-dev._tcp"

    var onFound: ((String, UInt16) -> Void)?

    private var browser: NWBrowser?
    private var probes: [NWEndpoint: NWConnection] = [:]
    private let queue = DispatchQueue(label: "org.impala67.devbridge.bonjour")

    func start() {
        guard browser == nil else { return }
        let params = NWParameters()
        params.includePeerToPeer = true
        let b = NWBrowser(for: .bonjour(type: Self.serviceType, domain: nil), using: params)
        b.browseResultsChangedHandler = { [weak self] results, _ in
            let endpoints = results.map(\.endpoint)
            Task { @MainActor in self?.handle(endpoints) }
        }
        b.start(queue: queue)
        browser = b
    }

    func stop() {
        browser?.cancel()
        browser = nil
        for conn in probes.values { conn.cancel() }
        probes.removeAll()
    }

    private func handle(_ endpoints: [NWEndpoint]) {
        for endpoint in endpoints where probes[endpoint] == nil {
            let params = NWParameters.tcp
            if let ip = params.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options {
                ip.version = .v4
            }
            let conn = NWConnection(to: endpoint, using: params)
            probes[endpoint] = conn
            conn.stateUpdateHandler = { [weak self, weak conn] state in
                switch state {
                case .ready:
                    let remote = conn?.currentPath?.remoteEndpoint
                    conn?.cancel()
                    Task { @MainActor in
                        self?.probes.removeValue(forKey: endpoint)
                        if case .hostPort(let host, let port) = remote,
                           let ip = Self.ipv4String(host) {
                            self?.onFound?(ip, port.rawValue)
                        }
                    }
                case .failed, .cancelled:
                    Task { @MainActor in
                        self?.probes.removeValue(forKey: endpoint)
                    }
                default:
                    break
                }
            }
            conn.start(queue: queue)
        }
    }

    private static func ipv4String(_ host: NWEndpoint.Host) -> String? {
        switch host {
        case .ipv4(let addr):
            let b = [UInt8](addr.rawValue)
            guard b.count == 4 else { return nil }
            return "\(b[0]).\(b[1]).\(b[2]).\(b[3])"
        case .name(let name, _):
            return name
        default:
            return nil
        }
    }
}
