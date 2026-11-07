import SwiftUI

/// Semantische Bausteine für die Einstellungen nach Vorbild von `settings-ui.js` und `web/styles.css`.
/// Sorgt für ein einheitliches Erscheinungsbild mit Impala-Farb- und Maß-Tokens.

enum StatusTone {
    case ok, warn, danger, idle, syncing
}

/// Statuspunkt wie `.settings-status-dot` der PWA: 9×9pt Kreis mit 4pt Halo-Ring.
struct StatusIndicator: View {
    let tone: StatusTone

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 9, height: 9)
            .background(
                Circle()
                    .fill(haloColor)
                    .frame(width: 17, height: 17)
            )
            .frame(width: 17, height: 17)
            .phaseAnimator([false, true]) { dot, on in
                dot.scaleEffect(tone == .syncing && on ? 1.25 : 1)
                    .opacity(tone == .syncing && on ? 0.65 : 1)
            } animation: { _ in .easeInOut(duration: 0.6) }
            .accessibilityHidden(true)
    }

    private var color: Color {
        switch tone {
        case .ok: Impala.success
        case .warn: Impala.warn
        case .danger: Impala.danger
        case .syncing: Impala.accent
        case .idle: Impala.text2.opacity(0.55)
        }
    }

    private var haloColor: Color {
        switch tone {
        case .ok: Impala.success.opacity(0.18)
        case .warn: Impala.warn.opacity(0.20)
        case .danger: Impala.danger.opacity(0.20)
        case .syncing: Impala.accent.opacity(0.20)
        case .idle: Impala.edgeSoft
        }
    }
}

/// Punkt wie die Sync-Anzeige der PWA in der Seitenleiste: grün verbunden, pulsierend beim Synchronisieren, rot bei Fehler.
struct StatusDot: View {
    let state: SyncController.State

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 10, height: 10)
            .phaseAnimator([false, true]) { dot, on in
                dot.scaleEffect(pulsing && on ? 1.35 : 1).opacity(pulsing && on ? 0.6 : 1)
            } animation: { _ in .easeInOut(duration: 0.6) }
            .animation(.smooth, value: state)
            .accessibilityHidden(true)
    }

    private var pulsing: Bool { state == .syncing || state == .connecting }

    private var color: Color {
        switch state {
        case .connected: Color(uiColor: UIColor(hex: 0x37845A))
        case .syncing, .connecting: Impala.accent
        case .error: Impala.danger
        case .disconnected: Impala.text2.opacity(0.4)
        }
    }
}

/// Seitenkopf wie `.settings-page-head` der PWA: Titel 22pt bold, Untertitel 13pt.
struct SettingsPageHead: View {
    let title: String
    let description: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Impala.text)
            if !description.isEmpty {
                Text(description)
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)
            }
        }
        .padding(.bottom, Space.s4)
    }
}

/// Gruppe wie `.settings-group` und `.settings-group-card` der PWA: optionaler Titel, abgerundete Karte, Trennlinien und optionale Fußnote.
struct SettingsCardGroup<Content: View>: View {
    var title: String = ""
    var footnote: String? = nil
    var isDanger: Bool = false
    @ViewBuilder let content: () -> Content

    init(
        title: String = "",
        footnote: String? = nil,
        isDanger: Bool = false,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.title = title
        self.footnote = footnote
        self.isDanger = isDanger
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !title.isEmpty {
                Text(title)
                    .font(.system(size: TextSize.sm, weight: .semibold))
                    .foregroundStyle(isDanger ? Impala.danger : Impala.text2)
                    .padding(.horizontal, 4)
            }

            VStack(spacing: 0) {
                content()
            }
            .background(isDanger ? Impala.danger.opacity(0.07) : Impala.surface, in: RoundedRectangle(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(isDanger ? Impala.danger.opacity(0.32) : Impala.edgeSoft, lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg))

            if let footnote, !footnote.isEmpty {
                Text(footnote)
                    .font(.system(size: TextSize.xs))
                    .foregroundStyle(Impala.text2)
                    .padding(.horizontal, 4)
                    .padding(.top, 2)
            }
        }
        .padding(.bottom, Space.s4)
    }
}

/// Standard-Trennlinie zwischen Einstellungszeilen.
struct SettingsDivider: View {
    var body: some View {
        Divider()
            .overlay(Impala.edgeSoft)
    }
}

/// Zeile wie `.settings-row` der PWA: Leading-Element, Titel (14pt semibold), Beschreibung (13pt) und Steuerelement rechts.
struct SettingsRow<Trailing: View, Leading: View>: View {
    let title: String
    var description: String? = nil
    let leading: Leading
    let trailing: Trailing

    init(
        title: String,
        description: String? = nil,
        @ViewBuilder leading: () -> Leading = { EmptyView() },
        @ViewBuilder trailing: () -> Trailing = { EmptyView() }
    ) {
        self.title = title
        self.description = description
        self.leading = leading()
        self.trailing = trailing()
    }

    var body: some View {
        HStack(alignment: .center, spacing: Space.s3) {
            if !(leading is EmptyView) {
                leading
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: TextSize.base, weight: .semibold))
                    .foregroundStyle(Impala.text)
                if let description, !description.isEmpty {
                    Text(description)
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: Space.s2)
            trailing
        }
        .frame(minHeight: 58)
        .padding(.horizontal, Space.s4)
        .padding(.vertical, 12)
    }
}

extension SettingsRow where Leading == EmptyView {
    init(
        title: String,
        description: String? = nil,
        @ViewBuilder trailing: () -> Trailing = { EmptyView() }
    ) {
        self.init(title: title, description: description, leading: { EmptyView() }, trailing: trailing)
    }
}

extension SettingsRow where Trailing == EmptyView, Leading == EmptyView {
    init(
        title: String,
        description: String? = nil
    ) {
        self.init(title: title, description: description, leading: { EmptyView() }, trailing: { EmptyView() })
    }
}

/// Schalter wie `.settings-switch` der PWA (42×24pt Kapsel mit 16pt Knopf).
struct ImpalaSwitch: View {
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            ZStack {
                Capsule()
                    .fill(isOn ? Impala.accent : Impala.surface)
                    .frame(width: 42, height: 24)
                    .overlay(
                        Capsule()
                            .strokeBorder(isOn ? Impala.accent : Impala.edge, lineWidth: 1)
                    )

                Circle()
                    .fill(Impala.panel)
                    .frame(width: 16, height: 16)
                    .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
                    .offset(x: isOn ? 9 : -9)
            }
            .animation(.snappy(duration: 0.16), value: isOn)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isButton)
    }
}

/// Zeile mit Schalter wie `.settings-switch` der PWA. Die gesamte Zeile schaltet um.
struct SettingsSwitchRow: View {
    let title: String
    var description: String? = nil
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            HStack(alignment: .center, spacing: Space.s3) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: TextSize.base, weight: .semibold))
                        .foregroundStyle(Impala.text)
                    if let description, !description.isEmpty {
                        Text(description)
                            .font(.system(size: TextSize.sm))
                            .foregroundStyle(Impala.text2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: Space.s2)
                ImpalaSwitch(isOn: $isOn)
                    .allowsHitTesting(false)
            }
            .contentShape(Rectangle())
            .frame(minHeight: 58)
            .padding(.horizontal, Space.s4)
            .padding(.vertical, 12)
        }
        .buttonStyle(.plain)
    }
}

/// Zeile zum Navigieren in einen Bereich mit Aktionstaste rechts (z. B. in der Übersicht).
struct SettingsLinkRow: View {
    let title: String
    var description: String? = nil
    var statusDot: StatusTone? = nil
    var icon: String? = nil
    var actionTitle: String = "Verwalten"
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: Space.s3) {
                if let statusDot {
                    StatusIndicator(tone: statusDot)
                } else if let icon {
                    Icon(icon, size: 16)
                        .foregroundStyle(Impala.accent)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: TextSize.base, weight: .semibold))
                        .foregroundStyle(Impala.text)
                    if let description, !description.isEmpty {
                        Text(description)
                            .font(.system(size: TextSize.sm))
                            .foregroundStyle(Impala.text2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: Space.s2)
                HStack(spacing: 4) {
                    Text(actionTitle)
                        .font(.system(size: TextSize.sm, weight: .medium))
                        .foregroundStyle(Impala.accent)
                    Icon("chevron-right", size: 12)
                        .foregroundStyle(Impala.accent)
                }
            }
            .contentShape(Rectangle())
            .frame(minHeight: 58)
            .padding(.horizontal, Space.s4)
            .padding(.vertical, 12)
        }
        .buttonStyle(.plain)
    }
}

/// Segment-Auswahl wie `.settings-segmented` der PWA.
struct SettingsSegmented<Value: Hashable>: View {
    let options: [(value: Value, label: String)]
    @Binding var selection: Value

    init(options: [(value: Value, label: String)], selection: Binding<Value>) {
        self.options = options
        self._selection = selection
    }

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.value) { item in
                Button {
                    selection = item.value
                } label: {
                    Text(item.label)
                        .font(.system(size: TextSize.sm, weight: .semibold))
                        .foregroundStyle(selection == item.value ? Impala.text : Impala.text2)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 5)
                        .frame(minHeight: 30)
                        .background {
                            if selection == item.value {
                                Capsule()
                                    .fill(Impala.panel)
                                    .shadow(color: .black.opacity(0.16), radius: 3, y: 1)
                                    .overlay(Capsule().strokeBorder(Impala.edgeSoft, lineWidth: 1))
                            }
                        }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(Impala.accent.opacity(0.08), in: Capsule())
        .overlay(Capsule().strokeBorder(Impala.edgeSoft, lineWidth: 1))
        .animation(.snappy(duration: 0.16), value: selection)
    }
}

/// Fortschritts- und Auslastungsbalken wie `.settings-meter` der PWA.
struct SettingsMeter: View {
    let fraction: Double
    var tone: StatusTone = .syncing

    var body: some View {
        GeometryReader { geo in
            let w = fraction > 0 ? max(4, geo.size.width * min(max(fraction, 0), 1)) : 0
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Impala.activeTint)
                Capsule()
                    .fill(barColor)
                    .frame(width: w)
            }
        }
        .frame(height: 6)
        .clipShape(Capsule())
    }

    private var barColor: Color {
        switch tone {
        case .ok: Impala.success
        case .warn: Impala.warn
        case .danger: Impala.danger
        case .syncing: Impala.accent
        case .idle: Impala.text2.opacity(0.55)
        }
    }
}

/// Kachel wie in `#overview-status .settings-group-card` der PWA.
struct SettingsOverviewTile: View {
    let title: String
    let description: String
    let statusTone: StatusTone
    var meterFraction: Double? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                StatusIndicator(tone: statusTone)
                    .padding(.top, 4)

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: TextSize.base, weight: .semibold))
                        .foregroundStyle(Impala.text)

                    Text(description)
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text2)
                        .fixedSize(horizontal: false, vertical: true)

                    if let meterFraction {
                        SettingsMeter(fraction: meterFraction, tone: statusTone)
                            .padding(.top, 4)
                    }
                }
            }

            if let actionTitle, let action {
                Spacer(minLength: 10)
                Button(action: action) {
                    Text(actionTitle)
                        .font(.system(size: TextSize.sm, weight: .semibold))
                        .foregroundStyle(Impala.text)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 5)
                        .frame(minHeight: 30)
                        .background(Impala.activeTint, in: Capsule())
                }
                .buttonStyle(.plain)
                .padding(.leading, 21)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.lg)
                .strokeBorder(Impala.edgeSoft, lineWidth: 1)
        )
    }
}

/// Knopfvarianten für Einstellungsaktionen wie `.settings-actions button` der PWA.
enum SettingsButtonVariant {
    case primary, secondary, danger
}

struct SettingsButtonStyle: ButtonStyle {
    var variant: SettingsButtonVariant = .secondary

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: TextSize.xs, weight: .semibold))
            .foregroundStyle(textColor)
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .frame(minHeight: 32)
            .background(backgroundColor, in: RoundedRectangle(cornerRadius: Radius.sm))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.sm)
                    .strokeBorder(borderColor, lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.75 : 1.0)
    }

    private var textColor: Color {
        switch variant {
        case .primary: Impala.accent
        case .secondary: Impala.text
        case .danger: Impala.danger
        }
    }

    private var backgroundColor: Color {
        switch variant {
        case .primary: Impala.activeTint
        case .secondary: Impala.surface
        case .danger: Impala.panel
        }
    }

    private var borderColor: Color {
        switch variant {
        case .primary: Impala.accentBorder
        case .secondary: Impala.edgeSoft
        case .danger: Impala.danger.opacity(0.38)
        }
    }
}

extension View {
    func settingsButton(_ variant: SettingsButtonVariant = .secondary) -> some View {
        buttonStyle(SettingsButtonStyle(variant: variant))
    }
}

/// Eingabefeld-Stil wie `.settings-input-row input` der PWA.
struct SettingsInputField: ViewModifier {
    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
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
    }
}

extension View {
    func settingsInputStyle() -> some View {
        modifier(SettingsInputField())
    }
}

/// Zeile mit Eingabefeld wie `.settings-input-row` der PWA.
struct SettingsInputRow<Field: View>: View {
    let title: String
    var description: String? = nil
    let field: Field

    init(
        title: String,
        description: String? = nil,
        @ViewBuilder field: () -> Field
    ) {
        self.title = title
        self.description = description
        self.field = field()
    }

    var body: some View {
        HStack(alignment: .center, spacing: Space.s3) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: TextSize.base, weight: .semibold))
                    .foregroundStyle(Impala.text)
                if let description, !description.isEmpty {
                    Text(description)
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: Space.s2)
            field
                .frame(maxWidth: 260)
        }
        .frame(minHeight: 58)
        .padding(.horizontal, Space.s4)
        .padding(.vertical, 12)
    }
}

/// Aufklappbarer Abschnitt wie `.settings-disclosure` der PWA.
struct SettingsDisclosure<Content: View>: View {
    let title: String
    var subtitle: String? = nil
    var badge: String? = nil
    @Binding var isExpanded: Bool
    @ViewBuilder let content: () -> Content

    init(
        title: String,
        subtitle: String? = nil,
        badge: String? = nil,
        isExpanded: Binding<Bool>,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.title = title
        self.subtitle = subtitle
        self.badge = badge
        self._isExpanded = isExpanded
        self.content = content
    }

    var body: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.snappy(duration: 0.2)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(alignment: .center, spacing: Space.s3) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title)
                            .font(.system(size: TextSize.base, weight: .semibold))
                            .foregroundStyle(Impala.text)
                        if let subtitle, !subtitle.isEmpty {
                            Text(subtitle)
                                .font(.system(size: TextSize.xs))
                                .foregroundStyle(Impala.text2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    Spacer(minLength: Space.s2)

                    if let badge, !badge.isEmpty {
                        Text(badge)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Impala.accent)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(Impala.activeTint, in: Capsule())
                    }

                    Icon("chevron-right", size: 13)
                        .foregroundStyle(Impala.text2)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
                .contentShape(Rectangle())
                .frame(minHeight: 54)
                .padding(.horizontal, Space.s4)
                .padding(.vertical, 11)
            }
            .buttonStyle(.plain)

            if isExpanded {
                SettingsDivider()
                VStack(alignment: .leading, spacing: 0) {
                    content()
                }
                .background(Impala.panel.opacity(0.4))
            }
        }
    }
}
