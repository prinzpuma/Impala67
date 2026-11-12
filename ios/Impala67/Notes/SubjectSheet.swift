import SwiftUI

/// „Fach festlegen“ wie `openSubjectDialog` der PWA: Automatisch (mit erkanntem Fach), die Fächer,
/// „Übersicht (Sammelseite)“ und „Sonstiges“. Gilt auch für alle Unterseiten. Erkennung im Kern
/// (`impala-fach`), gelesen im Hintergrund.
struct SubjectSheet: View {
    let page: PageSummary
    @Environment(ImpalaStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var info: PageSubject?

    private static let subjects = knownSubjects()

    var body: some View {
        NavigationStack {
            List {
                if let info {
                    Section {
                        Text(Self.status(info))
                            .font(.system(size: TextSize.sm))
                            .foregroundStyle(Impala.text2)
                    } footer: {
                        Text("Gilt auch für alle Unterseiten.")
                    }
                    Section {
                        row("Automatisch (erkannt: \(info.automatic))", value: nil, chosen: info.chosen)
                        ForEach(Self.subjects, id: \.self) { row($0, value: $0, chosen: info.chosen) }
                        row("\(overviewSubject()) (Sammelseite)", value: overviewSubject(), chosen: info.chosen)
                        row(defaultSubject(), value: defaultSubject(), chosen: info.chosen)
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Fach für „\(PageStyle.title(page))“")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
            }
        }
        .task {
            let core = store.core, id = page.id
            info = await Task.detached(priority: .userInitiated) { core.pageSubject(id: id) }.value
        }
    }

    private func row(_ label: String, value: String?, chosen: String?) -> some View {
        let active = value == chosen
        return Button {
            if !active { attempt("setPageSubject", { try store.core.setPageSubject(id: page.id, subject: value) }) }
            dismiss()
        } label: {
            HStack {
                Text(label).foregroundStyle(Impala.text)
                Spacer(minLength: 0)
                if active { Icon("check", size: 15).foregroundStyle(Impala.accent) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    /// Wie das Fach gerade zustande kommt (in der PWA nur am Menüpunkt zu sehen).
    static func status(_ s: PageSubject) -> String {
        let how = switch s.source {
        case "manual": "für diese Seite festgelegt"
        case "inherited": "von einer übergeordneten Seite"
        case "title": "am Titel erkannt"
        case "page-root": "am Titel einer übergeordneten Seite erkannt"
        case "overview": "Sammelseite"
        case "children": "aus den Unterseiten"
        case "content": "am Text erkannt"
        case "workspace": "aus dem Namen des Arbeitsbereichs"
        default: "nichts Eindeutiges erkannt"
        }
        return "Jetzt: \(s.name) – \(how)"
    }
}
