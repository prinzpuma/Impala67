import SwiftUI

/// Semantische Bausteine für die Einstellungen nach Vorbild von `settings-ui.js` und `SettingsParts.kt`.
/// Sorgt für ein einheitliches, ruhiges Erscheinungsbild mit Impala-Farb- und Maß-Tokens.

enum StatusTone {
    case ok, warn, danger, idle, syncing
}

/// Statuspunkt wie `.settings-status-dot` der PWA.
struct StatusIndicator: View {
    let tone: StatusTone

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 9, height: 9)
            .phaseAnimator([false, true]) { dot, on in
                dot.scaleEffect(tone == .syncing && on ? 1.35 : 1).opacity(tone == .syncing && on ? 0.6 : 1)
            } animation: { _ in .easeInOut(duration: 0.6) }
            .accessibilityHidden(true)
    }

    private var color: Color {
        switch tone {
        case .ok: Impala.success
        case .warn: Impala.warn
        case .danger: Impala.danger
        case .syncing: Impala.accent
        case .idle: Impala.text2.opacity(0.4)
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

/// Seitenkopf wie `UI.page` der PWA: großer Titel und beschreibender Untertitel.
struct SettingsPageHead: View {
    let title: String
    let description: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: TextSize.xl, weight: .bold))
                .foregroundStyle(Impala.text)
            Text(description)
                .font(.system(size: TextSize.sm))
                .foregroundStyle(Impala.text2)
        }
        .padding(.bottom, Space.s2)
    }
}

/// Gruppe wie `UI.group` der PWA / `PanelCard` in Android: Überschrift über einer Karte, Trennlinien und optionale Fußnote.
struct SettingsCardGroup<Content: View>: View {
    let title: String
    var footnote: String? = nil
    var isDanger: Bool = false
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: TextSize.sm, weight: .semibold))
                .foregroundStyle(isDanger ? Impala.danger : Impala.text2)
                .padding(.horizontal, 4)

            VStack(spacing: 0) {
                content()
            }
            .background(isDanger ? Impala.danger.opacity(0.06) : Impala.surface, in: RoundedRectangle(cornerRadius: Radius.lg))
            .overlay {
                RoundedRectangle(cornerRadius: Radius.lg)
                    .strokeBorder(isDanger ? Impala.danger.opacity(0.3) : Impala.edgeSoft, lineWidth: 1)
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

/// Zeile wie `UI.row` der PWA: Leading-Element, Titel, Beschreibung und Steuerelement rechts.
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
                    .font(.system(size: TextSize.base, weight: .medium))
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
        .padding(.horizontal, Space.s4)
        .padding(.vertical, Space.rowPadding + 3)
    }
}

extension SettingsRow where Leading == EmptyView {
    init(
        title: String,
        description: String? = nil,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.init(title: title, description: description, leading: { EmptyView() }, trailing: trailing)
    }
}

/// Zeile mit Schalter wie `switchControl` der PWA.
struct SettingsSwitchRow: View {
    let title: String
    var description: String? = nil
    @Binding var isOn: Bool

    var body: some View {
        HStack(alignment: .center, spacing: Space.s3) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: TextSize.base, weight: .medium))
                    .foregroundStyle(Impala.text)
                if let description, !description.isEmpty {
                    Text(description)
                        .font(.system(size: TextSize.sm))
                        .foregroundStyle(Impala.text2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: Space.s2)
            Toggle("", isOn: $isOn)
                .labelsHidden()
                .tint(Impala.accent)
        }
        .padding(.horizontal, Space.s4)
        .padding(.vertical, Space.rowPadding + 3)
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
                        .font(.system(size: TextSize.base, weight: .medium))
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
            .padding(.horizontal, Space.s4)
            .padding(.vertical, Space.rowPadding + 3)
        }
        .buttonStyle(.plain)
    }
}
