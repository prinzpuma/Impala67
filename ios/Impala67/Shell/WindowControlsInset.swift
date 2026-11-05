import SwiftUI
import UIKit

/// Abstand nach links, den die Fensterknöpfe von iPadOS (Schließen/Verkleinern/Vollbild oben links im
/// Fenstermodus) brauchen. Die Seitenleiste blendet ihre Navigationsleiste aus, also reserviert das System
/// dort keinen Platz: Ohne Abstand lagen die Knöpfe über der Home-Pille und schluckten Tipps darauf.
/// Gemessen über die Ecken-angepasste Safe Area von UIKit; ohne Fensterknöpfe ist der Abstand 0.
struct WindowControlsInset: UIViewRepresentable {
    @Binding var leading: CGFloat

    func makeUIView(context: Context) -> Probe { Probe() }

    func updateUIView(_ probe: Probe, context: Context) {
        probe.onChange = { value in
            if abs(leading - value) > 0.5 { leading = value }
        }
    }

    final class Probe: UIView {
        var onChange: ((CGFloat) -> Void)?
        private let marker = UIView()

        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
            marker.translatesAutoresizingMaskIntoConstraints = false
            addSubview(marker)
            let guide = layoutGuide(for: .safeArea(cornerAdaptation: .horizontal))
            NSLayoutConstraint.activate([
                marker.leadingAnchor.constraint(equalTo: guide.leadingAnchor),
                marker.topAnchor.constraint(equalTo: topAnchor),
                marker.widthAnchor.constraint(equalToConstant: 0),
                marker.heightAnchor.constraint(equalToConstant: 0),
            ])
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) wird nicht genutzt") }

        override func layoutSubviews() {
            super.layoutSubviews()
            let value = max(0, marker.frame.minX)
            // Nicht während des SwiftUI-Layouts den Zustand ändern.
            DispatchQueue.main.async { [weak self] in self?.onChange?(value) }
        }
    }
}
