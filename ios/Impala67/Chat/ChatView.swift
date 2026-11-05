import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Chatverlauf mit Eingabe (`ChatView.kt`, `web/chat-*.js`): im KI-Panel rechts und als Tab `chat:<id>`.
/// `activePageId`: geöffnete Seite als Kontext (im Tab keiner).
struct ChatView: View {
    let activePageId: String?
    var wide = false
    @Environment(ShellModel.self) private var shell
    @FocusState private var focused: Bool

    var body: some View {
        let chat = shell.chat
        let input = Binding(get: { chat.inputDraft }, set: { chat.inputDraft = $0 })
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: Space.s3) {
                    if chat.messages.isEmpty && !chat.running {
                        EmptyChat { prompt in chat.inputDraft = prompt; focused = true }
                    }
                    ForEach(Array(chat.messages.enumerated()), id: \.offset) { _, m in
                        ChatMessageRow(message: m) { text in chat.inputDraft = text; focused = true }
                            .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 8)), removal: .opacity))
                    }
                    if chat.running { LiveBlock(thinking: chat.thinking, draft: chat.draft, tool: chat.tool).transition(.opacity) }
                    if let e = chat.error { ChatErrorBox(error: e).transition(.opacity) }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(.horizontal, wide ? Space.s6 : Space.s3)
                .padding(.vertical, Space.s3)
                .frame(maxWidth: wide ? 760 : .infinity)
                .frame(maxWidth: .infinity)
                .animation(.smooth(duration: 0.3), value: chat.messages.count)
                .animation(.smooth(duration: 0.3), value: chat.running)
            }
            .defaultScrollAnchor(.bottom, for: .sizeChanges)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: chat.messages.count) { withAnimation(.smooth) { proxy.scrollTo("end", anchor: .bottom) } }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Composer(input: input, focused: $focused, activePageId: activePageId)
                .padding(.horizontal, wide ? Space.s6 : Space.s2)
                .padding(.bottom, Space.s2)
                .frame(maxWidth: wide ? 760 : .infinity)
                .frame(maxWidth: .infinity)
        }
        .overlay(alignment: .top) {
            if let n = chat.notice {
                Text(n)
                    .font(.system(size: TextSize.sm, weight: .medium))
                    .padding(.horizontal, Space.s3)
                    .padding(.vertical, Space.s2)
                    .impalaGlass()
                    .padding(.top, Space.s2)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.bouncy(duration: 0.35), value: chat.notice)
        .learningTime(LearnContext(category: "ai", sourceId: shell.chat.chatId.isEmpty ? nil : shell.chat.chatId))
    }
}

/// Leerer Chat: Begrüßung und Vorschläge (`ChatView.kt` `EmptyChat`).
private struct EmptyChat: View {
    let onPick: (String) -> Void

    private static let suggestions: [(icon: String, title: String, sub: String, prompt: String)] = [
        ("bulb", "Erklär's mir", "Schritt für Schritt, bis es klickt", "Erkläre mir Schritt für Schritt: "),
        ("cards", "Karteikarten", "Aus einem Thema oder deinen Notizen", "Erstelle Karteikarten zu: "),
        ("file", "Zusammenfassen", "Das Wichtigste kompakt auf einen Blick", "Fasse kompakt zusammen: "),
        ("target", "Quiz mich", "5 Prüfungsfragen mit Auflösung", "Stell mir 5 Prüfungsfragen zu: "),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: Space.s3) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(greeting).").font(.system(size: TextSize.lg, weight: .semibold))
                Text("Was möchtest du heute verstehen?").font(.system(size: TextSize.lg))
            }
            .foregroundStyle(Impala.text)
            .riseIn(0)
            Text("Frag nach deinen Notizen, lass dir etwas erklären oder dich abfragen. Formeln und Code erscheinen sauber gesetzt.")
                .font(.system(size: TextSize.sm))
                .foregroundStyle(Impala.text2)
                .riseIn(1)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: Space.s2)], spacing: Space.s2) {
                ForEach(Array(Self.suggestions.enumerated()), id: \.offset) { i, s in
                    Button { onPick(s.prompt) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Icon(s.icon, size: 16).foregroundStyle(Impala.accent)
                            Text(s.title).font(.system(size: TextSize.sm, weight: .semibold)).foregroundStyle(Impala.text)
                            Text(s.sub).font(.system(size: TextSize.xs)).foregroundStyle(Impala.text2).lineLimit(2)
                        }
                        .frame(maxWidth: .infinity, minHeight: 70, alignment: .topLeading)
                        .padding(Space.s3)
                        .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.md, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Radius.md, style: .continuous).stroke(Impala.edgeSoft))
                    }
                    .pressable()
                    .hoverEffect(.highlight)
                    .riseIn(i + 2)
                }
            }
        }
        .padding(.top, Space.s6)
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        return h < 5 ? "Gute Nacht" : h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend"
    }
}

/// Eingabeleiste in Liquid Glass: Seitenkontext-Chip, Anhang, Textfeld, Anhängen (📎), Diktat,
/// Modellmenü, Senden bzw. Stopp.
private struct Composer: View {
    @Binding var input: String
    var focused: FocusState<Bool>.Binding
    let activePageId: String?
    @Environment(ImpalaStore.self) private var store
    @Environment(ShellModel.self) private var shell
    @Namespace private var glass
    @State private var dictation = Dictation()
    @State private var photo: PhotosPickerItem?
    @State private var pickPhoto = false
    @State private var pickFile = false
    @State private var attachError: String?

    var body: some View {
        let chat = shell.chat
        let canSend = !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let heft = activePageId.flatMap { store.core.page(id: $0)?.summary }.flatMap { $0.kind == .heft ? $0 : nil }
        VStack(alignment: .leading, spacing: Space.s2) {
            if let id = activePageId, let page = store.core.page(id: id)?.summary {
                ContextChip(page: page)
            }
            if let att = chat.attachment {
                AttachmentChip(attachment: att) { withAnimation(.snappy) { chat.attachment = nil } }
                    .transition(.scale(scale: 0.9, anchor: .leading).combined(with: .opacity))
            }
            if dictation.listening {
                Text(dictation.partial.isEmpty ? "Ich höre zu …" : dictation.partial)
                    .font(.system(size: TextSize.sm))
                    .foregroundStyle(Impala.text2)
                    .lineLimit(2)
            }
            TextField("Frag deinen KI-Coach…", text: $input, axis: .vertical)
                .font(.system(size: TextSize.base))
                .lineLimit(1...8)
                .focused(focused)
                .onKeyPress(.return, phases: .down) { press in
                    // Enter sendet, Shift+Enter bricht um (wie die PWA).
                    if press.modifiers.contains(.shift) { return .ignored }
                    submit()
                    return .handled
                }
            HStack(spacing: Space.s2) {
                Menu {
                    Button { pickPhoto = true } label: { Label { Text("Foto") } icon: { Icon("image") } }
                    Button { pickFile = true } label: { Label { Text("Datei oder PDF") } icon: { Icon("file") } }
                    if let heft {
                        Button {
                            attach(ChatAttachment.heftPage(core: store.core, pageId: heft.id), fail: "Heftseite konnte nicht gelesen werden.")
                        } label: { Label { Text("Heftseite anhängen") } icon: { Icon("pen-tool") } }
                    }
                } label: {
                    Icon("paperclip", size: 15).foregroundStyle(Impala.text2).frame(width: 30, height: 30).contentShape(Rectangle())
                }
                .accessibilityLabel("Anhängen")
                Button { dictation.toggle() } label: {
                    Icon("mic", size: 15)
                        .foregroundStyle(dictation.listening ? Impala.accent : Impala.text2)
                        .symbolEffect(.pulse, isActive: dictation.listening)
                        .frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(dictation.listening ? "Diktat beenden" : "Diktieren")
                ModelMenu()
                Spacer(minLength: 0)
                GlassEffectContainer {
                    if chat.running {
                        RoundButton(icon: "stop", label: "Antwort abbrechen", prominent: false) { chat.stop() }
                            .glassEffectID("send", in: glass)
                    } else {
                        RoundButton(icon: "arrow-up", label: "Senden", prominent: canSend) { submit() }
                            .disabled(!canSend)
                            .glassEffectID("send", in: glass)
                    }
                }
                .animation(.bouncy(duration: 0.3), value: chat.running)
            }
        }
        .padding(.horizontal, Space.s3)
        .padding(.vertical, Space.s2)
        .impalaGlass(in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .sensoryFeedback(.impact(weight: .light), trigger: chat.running) { _, now in now }
        .animation(.snappy, value: chat.attachment?.id)
        .animation(.snappy, value: dictation.listening)
        .onAppear {
            dictation.onFinal = { said in
                let base = input.trimmingCharacters(in: .whitespaces)
                input = base.isEmpty ? said : base + " " + said
            }
        }
        .photosPicker(isPresented: $pickPhoto, selection: $photo, matching: .images)
        .onChange(of: photo) { _, item in
            guard let item else { return }
            photo = nil
            Task {
                let img = (try? await item.loadTransferable(type: Data.self)).flatMap(UIImage.init(data:))
                attach(img.flatMap { ChatAttachment.image($0, name: "Foto") }, fail: "Foto konnte nicht gelesen werden.")
            }
        }
        .fileImporter(isPresented: $pickFile, allowedContentTypes: [.pdf, .image, .plainText, .text, .commaSeparatedText, .json, .sourceCode, .data]) { result in
            guard case .success(let url) = result else { return }
            attach(ChatAttachment.file(url), fail: "Datei konnte nicht gelesen werden (PDF ohne Text oder kein Textformat).")
        }
        .alert("Anhang", isPresented: Binding(get: { attachError != nil || dictation.error != nil },
                                              set: { if !$0 { attachError = nil; dictation.error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(attachError ?? dictation.error ?? "") }
    }

    private func attach(_ att: ChatAttachment?, fail: String) {
        if let att { shell.chat.attachment = att } else { attachError = fail }
    }

    private func submit() {
        let chat = shell.chat
        if dictation.listening { dictation.stop() }
        guard !chat.running, !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        chat.send(input, activePageId: activePageId)
        input = ""
    }
}

/// Anhang über dem Textfeld: Vorschau bzw. Dateisymbol, Name, ✕ entfernt ihn.
private struct AttachmentChip: View {
    let attachment: ChatAttachment
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: Space.s2) {
            if let img = attachment.preview {
                Image(uiImage: img).resizable().scaledToFill().frame(width: 34, height: 34)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.xs, style: .continuous))
            } else {
                Icon("file", size: 14).foregroundStyle(Impala.text2).frame(width: 34, height: 34)
                    .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.xs, style: .continuous))
            }
            Text(attachment.name).font(.system(size: TextSize.xs, weight: .medium)).foregroundStyle(Impala.text).lineLimit(1)
            Button(action: onRemove) { Icon("x", size: 10).foregroundStyle(Impala.text2).frame(width: 24, height: 24) }
                .buttonStyle(.plain)
                .accessibilityLabel("Anhang entfernen")
        }
        .padding(.trailing, Space.s1)
        .padding(Space.s1)
        .background(Impala.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
    }
}

/// Runder Knopf der Eingabe (Senden: Akzent, Stopp: getöntes Glas).
private struct RoundButton: View {
    let icon: String
    let label: String
    let prominent: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Icon(icon, size: 15)
                .foregroundStyle(prominent ? Impala.onAccent : Impala.text)
                .frame(width: 34, height: 34)
        }
        .buttonStyle(.plain)
        .glassEffect(prominent ? .regular.tint(Impala.accent).interactive() : .regular.interactive(), in: Circle())
        .accessibilityLabel(label)
        .keyboardShortcut(icon == "stop" ? KeyEquivalent(".") : .return, modifiers: .command)
    }
}

/// Seitenkontext-Chip: Inhalt der offenen Seite geht mit; ✕ schaltet ihn für diese Seite ab.
private struct ContextChip: View {
    let page: PageSummary
    @Environment(ShellModel.self) private var shell

    var body: some View {
        let chat = shell.chat
        let off = chat.contextOff.contains(page.id)
        let sent = chat.contextSent.flatMap { $0.pageId == page.id ? $0 : nil }
        Button {
            withAnimation(.snappy) {
                if off { chat.contextOff.remove(page.id) } else { chat.contextOff.insert(page.id) }
            }
        } label: {
            HStack(spacing: Space.s1) {
                Icon(page.kind == .heft ? "pen-tool" : "file", size: 12)
                VStack(alignment: .leading, spacing: 0) {
                    Text(page.title.isEmpty ? "Ohne Titel" : page.title)
                        .font(.system(size: TextSize.xs, weight: .medium))
                        .foregroundStyle(Impala.text)
                        .lineLimit(1)
                    Text(off ? "Seitenkontext aus · antippen zum Mitsenden"
                         : sent.map { $0.sent < $0.total ? "Anfang mitgesendet (\($0.sent) von \($0.total) Zeichen)" : "Seitenkontext · wird mitgesendet" }
                         ?? "Seitenkontext · wird mitgesendet")
                        .font(.system(size: 11))
                        .lineLimit(1)
                }
                if !off { Icon("x", size: 10) }
            }
            .foregroundStyle(Impala.text2)
            .opacity(off ? 0.6 : 1)
            .padding(.horizontal, Space.s2)
            .padding(.vertical, Space.s1)
            .background(Impala.surface, in: RoundedRectangle(cornerRadius: Radius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(off ? "Seitenkontext wieder mitsenden" : "Seitenkontext entfernen")
    }
}

/// Modellmenü (render.js `modelMenuInnerHtml`): Modelle je Quelle, Denkaufwand, Einstellungen.
struct ModelMenu: View {
    @Environment(ShellModel.self) private var shell
    @Environment(ImpalaStore.self) private var store

    var body: some View {
        let chat = shell.chat
        let _ = store.settingsRevision
        let s = chat.settings
        Menu {
            Section("Verfügbare Modelle") {
                if chat.modelsLoading { Text("Modelle werden aktualisiert…") }
                ForEach(s.sources) { src in
                    let list = chat.models.filter { $0.providerId == src.id }
                    if !list.isEmpty {
                        Menu(src.label) {
                            ForEach(list, id: \.self) { m in
                                Button { chat.select(m) } label: {
                                    if m.providerId == s.activeId && m.id == s.model { Label(modelName(m.id), systemImage: "checkmark") } else { Text(modelName(m.id)) }
                                }
                            }
                        }
                    }
                }
                if chat.models.isEmpty && !chat.modelsLoading { Text("Gerade ist kein Modell erreichbar oder geladen.") }
            }
            Section {
                Toggle("Gedankengang (Denkaufwand)", isOn: Binding(get: { s.thinkingEnabled }, set: { chat.setThinking($0) }))
                Button("Modelle neu laden") { chat.refreshModels(force: true) }
                Button("KI-Einstellungen …") { shell.sheet = .settings }
            }
        } label: {
            HStack(spacing: Space.s1) {
                Icon("model", size: 13)
                Text(s.label).font(.system(size: TextSize.xs)).lineLimit(1)
                Icon("chevron-down", size: 10)
            }
            .foregroundStyle(Impala.text2)
            .padding(.horizontal, Space.s2)
            .frame(minHeight: 28)
            .contentShape(Rectangle())
        }
        .menuOrder(.fixed)
        .onAppear { chat.refreshModels() }
    }

    private func modelName(_ id: String) -> String { id == "impala-ai" ? "Impala AI" : id }
}
