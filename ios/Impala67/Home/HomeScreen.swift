import SwiftUI

/// Startseite, erster Teil der PWA-Startseite (`homeViewHtml` in home-view.js): Datum, „+ Neue Seite“,
/// Begrüßung, „Weitermachen“ mit der zuletzt bearbeiteten Seite und angeheftete Seiten.
/// Lernzeit, Karten und Tagesartikel folgen (siehe `android/app/…/home/` als Vorlage).
struct HomeScreen: View {
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell

    var body: some View {
        let _ = store.pagesRevision
        let recent = store.core.recentPages(limit: 40)
        let last = recent.first
        let pins = recent.filter(\.favorite).prefix(6)
        ScrollView {
            VStack(alignment: .leading, spacing: Space.s6) {
                HStack {
                    Text(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Locale(identifier: "de_DE"))))
                        .font(.system(size: TextSize.sm, weight: .medium))
                        .foregroundStyle(Impala.text2)
                    Spacer()
                    Menu {
                        MenuItem("Notiz", icon: "note") { create(.note) }
                        MenuItem("Heft", icon: "notebook") { create(.heft) }
                    } label: {
                        Text("+ Neue Seite")
                            .font(.system(size: TextSize.sm, weight: .semibold))
                            .foregroundStyle(Impala.accent)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 36)
                            .background(Impala.accent.opacity(0.09), in: Capsule())
                            .overlay(Capsule().stroke(Impala.accent.opacity(0.36), lineWidth: 1))
                    }
                }
                VStack(alignment: .leading, spacing: Space.s2) {
                    Text("\(Self.greeting()).")
                        .font(.system(size: TextSize.xl, weight: .bold, design: .rounded))
                        .foregroundStyle(Impala.text)
                    Text(last == nil ? "Leg deine erste Seite an. Sobald du lernst, füllt sich diese Seite." : "Schön, dass du da bist.")
                        .font(.system(size: TextSize.md))
                        .foregroundStyle(Impala.text2)
                }
                if let last {
                    Button { shell.open(last.id) } label: { ContinueCard(page: last) }
                        .pressable()
                }
                if !pins.isEmpty {
                    FlowRow(pins: Array(pins)) { shell.open($0) }
                }
            }
            .padding(Space.s6)
            .frame(maxWidth: 860, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Impala.panel)
    }

    /// Wie render.js: Nacht bis 5, Morgen bis 11, Tag bis 18.
    static func greeting(_ date: Date = .now) -> String {
        let h = Calendar.current.component(.hour, from: date)
        return h < 5 ? "Gute Nacht" : h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend"
    }

    private func create(_ kind: PageKind) {
        let id: String? = switch kind {
        case .note: try? store.core.createPage(title: "", content: "", parentId: nil, workspaceId: nil)
        case .heft: try? store.core.createHeft(title: "Heft", parentId: nil, workspaceId: nil)
        }
        if let id { shell.openNewTab(id) }
    }
}

/// `.hv-continue`: Karte mit Symbol, „Weitermachen“, Titel und Zeitpunkt.
private struct ContinueCard: View {
    let page: PageSummary

    var body: some View {
        HStack(spacing: Space.s4) {
            PageIcon(page: page, size: 26)
                .foregroundStyle(Impala.accent)
                .frame(width: 64, height: 64)
                .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text("Weitermachen").font(.system(size: TextSize.xs, weight: .semibold)).foregroundStyle(Impala.text2)
                Text(PageStyle.title(page)).font(.system(size: TextSize.lg, weight: .semibold)).foregroundStyle(Impala.text).lineLimit(1)
                Text(page.kind == .heft ? "Heft" : "Notiz").font(.system(size: TextSize.sm)).foregroundStyle(Impala.text2)
            }
            Spacer(minLength: 0)
        }
        .padding(Space.s3)
        .background(Impala.panel, in: RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous).stroke(Impala.edgeSoft, lineWidth: 1))
    }
}

/// `.hv-pins`: angeheftete Seiten als Pillen.
private struct FlowRow: View {
    let pins: [PageSummary]
    let open: (String) -> Void

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: Space.s2) {
                ForEach(pins) { p in
                    Button { open(p.id) } label: {
                        Text(PageStyle.title(p))
                            .font(.system(size: TextSize.sm, weight: .medium))
                            .foregroundStyle(Impala.text)
                            .padding(.horizontal, 14)
                            .frame(minHeight: 34)
                            .background(Impala.accent.opacity(0.09), in: Capsule())
                    }
                    .pressable()
                }
            }
        }
        .scrollIndicators(.hidden)
    }
}
