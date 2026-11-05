import SwiftUI

/// Backup-Hinweis der Startseite (home-view.js `backupAlert`, backup-status.js, Android `HomeBackup.kt`):
/// nur wenn Änderungen dieses Geräts seit über 24 h nirgends gesichert sind. „Später“ blendet ihn
/// 3 Tage (Sync hängt) bzw. 14 Tage (gar kein Sync) aus.
struct BackupAlert: View {
    let view: DriveBackupView
    let onBackup: () -> Void
    let onLater: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let isStale = view.level == .stale
        let text = isStale
            ? "Änderungen seit \(HomeFormat.whenText(view.unsafeSince ?? "")) sind noch nicht gesichert."
            : "Deine Notizen liegen bisher nur auf diesem Gerät."

        HStack(spacing: Space.s4) {
            Text(text)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button("Jetzt sichern", action: onBackup)
                .underline()
                .buttonStyle(.plain)
            Button("Später", action: onLater)
                .buttonStyle(.plain)
                .opacity(0.75)
        }
        .font(.system(size: TextSize.sm))
        .foregroundStyle(scheme == .dark ? Impala.warn : Color(uiColor: UIColor(hex: 0x8A6412)))
        .padding(.horizontal, Space.s4)
        .padding(.vertical, Space.s2)
        .background(scheme == .dark ? Impala.warn.opacity(0.12) : Color(uiColor: UIColor(hex: 0xF8EECF)), in: Capsule())
    }
}
