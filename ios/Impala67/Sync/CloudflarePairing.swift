import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI
import VisionKit

/// Kopplung per QR-Code wie die PWA (settings.js `handleCfPairing`, qr-scanner.js `parseCfPairingData`)
/// und `CloudflarePairing.kt`: Link auf die PWA mit `#cf-pair=<Base64(JSON {url, key})>`.
enum CfPairing {
    static let pwaUrl = "https://prinzpuma.github.io/Impala67/"

    static func link(url: String, key: String) -> String {
        let json = (try? JSONSerialization.data(withJSONObject: ["url": url, "key": key], options: [.sortedKeys])) ?? Data()
        return pwaUrl + "#cf-pair=" + json.base64EncodedString()
    }

    /// Kopplungs-Link, rohes JSON oder nur die Base64-Daten; `nil`, wenn URL oder Schlüssel fehlen.
    static func parse(_ scanned: String) -> (url: String, key: String)? {
        let text = scanned.trimmingCharacters(in: .whitespacesAndNewlines)
        if let range = text.range(of: "#cf-pair=") {
            return fromBase64(String(text[range.upperBound...]))
        }
        return fromJson(Data(text.utf8)) ?? fromBase64(text)
    }

    private static func fromJson(_ data: Data) -> (url: String, key: String)? {
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        let url = (obj["url"] as? String ?? "").trimmingCharacters(in: .whitespaces)
        let key = (obj["key"] as? String ?? "").trimmingCharacters(in: .whitespaces)
        return url.isEmpty || key.isEmpty ? nil : (url, key)
    }

    /// `atob` verzeiht fehlendes Padding; URL-sichere Zeichen gleich mit annehmen.
    private static func fromBase64(_ raw: String) -> (url: String, key: String)? {
        var s = (raw.removingPercentEncoding ?? raw)
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
            .filter { !$0.isWhitespace }
        while s.count % 4 != 0 { s.append("=") }
        guard let data = Data(base64Encoded: s) else { return nil }
        return fromJson(data)
    }

    /// QR-Code als scharfes Bild (CoreImage, Fehlerkorrektur M).
    static func qrImage(_ text: String, size: CGFloat = 640) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scale = size / output.extent.width
        let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let cg = CIContext().createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

/// „Gerät koppeln (QR-Code)“: QR mit dem Kopplungs-Link und „Kopplungs-Link kopieren“
/// (Texte wie `CfPairingDialog`).
struct CfPairingSheet: View {
    let url: String
    let key: String
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        let link = CfPairing.link(url: url, key: key)
        NavigationStack {
            VStack(spacing: Space.s4) {
                Text("Scanne diesen QR-Code mit der Impala67-App auf deinem Smartphone/Tablet (unter Einstellungen → Sync → QR-Code scannen).")
                    .font(.system(size: TextSize.base))
                    .foregroundStyle(Impala.text2)
                    .multilineTextAlignment(.center)
                if let image = CfPairing.qrImage(link) {
                    Image(uiImage: image)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 240, height: 240)
                        .padding(Space.s3)
                        .background(.white, in: RoundedRectangle(cornerRadius: Radius.md))
                        .accessibilityLabel("Kopplungs-QR-Code")
                        .riseIn(1)
                }
                Button {
                    UIPasteboard.general.string = link
                    withAnimation(.smooth) { copied = true }
                } label: {
                    Label(copied ? "Kopiert" : "Kopplungs-Link kopieren", image: "i-copy")
                        .contentTransition(.interpolate)
                }
                .buttonStyle(.glass)
                .sensoryFeedback(.success, trigger: copied)
                if copied {
                    Text("Kopplungs-Link kopiert! Sende ihn an dein Smartphone (z. B. via Notizen/Mail).")
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text2)
                        .multilineTextAlignment(.center)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .padding(Space.s6)
            .frame(maxWidth: 420)
            .navigationTitle("Gerät automatisch koppeln")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Schließen") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

/// „QR-Code scannen“: VisionKit-Scanner im Sheet; liefert den ersten Impala67-Kopplungscode.
struct CfScannerSheet: View {
    let onResult: (_ url: String, _ key: String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var status = "Richte die Kamera auf den Kopplungs-QR-Code."

    var body: some View {
        NavigationStack {
            Group {
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    QrScanner { text in
                        guard let pairing = CfPairing.parse(text) else {
                            status = "Unbekannter QR-Code. Bitte Impala67-Code scannen."
                            return false
                        }
                        dismiss()
                        onResult(pairing.url, pairing.key)
                        return true
                    }
                    .ignoresSafeArea()
                    .overlay(alignment: .bottom) {
                        Text(status)
                            .font(.system(size: TextSize.sm, weight: .medium))
                            .padding(.horizontal, Space.s4)
                            .padding(.vertical, Space.s2)
                            .impalaGlass()
                            .padding(Space.s6)
                            .contentTransition(.interpolate)
                            .animation(.smooth, value: status)
                    }
                } else {
                    Placeholder(icon: "camera", title: "Kamera nicht verfügbar",
                                text: "Erlaube den Kamerazugriff in den Einstellungen oder kopiere den Kopplungs-Link vom anderen Gerät.")
                }
            }
            .navigationTitle("QR-Code scannen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } } }
        }
    }
}

/// `DataScannerViewController` nur für QR-Codes. `onCode` gibt `true` zurück, wenn der Code passt.
private struct QrScanner: UIViewControllerRepresentable {
    let onCode: (String) -> Bool

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            isHighlightingEnabled: true
        )
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }

    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {
        context.coordinator.onCode = onCode
    }

    static func dismantleUIViewController(_ vc: DataScannerViewController, coordinator: Coordinator) {
        vc.stopScanning()
    }

    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var onCode: (String) -> Bool
        private var done = false
        init(onCode: @escaping (String) -> Bool) { self.onCode = onCode }

        func dataScanner(_ scanner: DataScannerViewController, didAdd added: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !done else { return }
            for item in added {
                if case .barcode(let code) = item, let text = code.payloadStringValue, onCode(text) {
                    done = true
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    scanner.stopScanning()
                    return
                }
            }
        }
    }
}
