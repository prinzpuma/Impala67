import AVFoundation
import Observation
import Speech

/// Diktat wie voice.js der PWA (dort Web Speech API): Mikrofon an, deutsche Spracherkennung (auf dem
/// Gerät, wenn möglich), beim Stoppen geht der erkannte Text an `onFinal`. Für die Chat-Eingabe und die
/// Erklärung im Feynman-Modus.
@MainActor @Observable
final class Dictation {
    private(set) var listening = false
    /// Bisher erkannter Text der laufenden Aufnahme.
    private(set) var partial = ""
    var error: String?
    @ObservationIgnored var onFinal: ((String) -> Void)?

    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private var task: SFSpeechRecognitionTask?
    @ObservationIgnored private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "de-DE"))

    func toggle() {
        if listening { stop() } else { start() }
    }

    func start() {
        guard !listening else { return }
        Task {
            guard await Self.authorize() else {
                error = "Mikrofon oder Spracherkennung nicht erlaubt (Einstellungen → Impala67)."
                return
            }
            begin()
        }
    }

    /// Aufnahme beenden; das Endergebnis kommt danach über die Erkennung.
    func stop() {
        guard listening else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        // Falls die Erkennung kein Endergebnis mehr meldet: spätestens nach 1,5 s abschließen.
        Task {
            try? await Task.sleep(for: .milliseconds(1500))
            finish()
        }
    }

    private func begin() {
        guard let recognizer, recognizer.isAvailable else {
            error = "Spracherkennung ist gerade nicht verfügbar."
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            self.error = "Mikrofon konnte nicht gestartet werden."
            return
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        req.addsPunctuation = true
        request = req
        Self.feed(engine.inputNode, into: req)
        engine.prepare()
        do {
            try engine.start()
        } catch {
            engine.inputNode.removeTap(onBus: 0)
            self.error = "Mikrofon konnte nicht gestartet werden."
            return
        }
        partial = ""
        listening = true
        task = Self.recognize(recognizer, req) { [weak self] text, done in
            guard let self else { return }
            if let text { self.partial = text }
            if done { self.finish() }
        }
    }

    private func finish() {
        guard listening else { return }
        listening = false
        if engine.isRunning {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        task?.cancel()
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let text = partial.trimmingCharacters(in: .whitespacesAndNewlines)
        partial = ""
        if !text.isEmpty { onFinal?(text) }
    }

    // Rückrufe kommen von Audio- bzw. Erkennungs-Threads: außerhalb des Hauptakteurs anmelden.

    private nonisolated static func feed(_ input: AVAudioInputNode, into req: SFSpeechAudioBufferRecognitionRequest) {
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
            req.append(buffer)
        }
    }

    private nonisolated static func recognize(
        _ recognizer: SFSpeechRecognizer, _ req: SFSpeechAudioBufferRecognitionRequest,
        _ update: @escaping @MainActor (String?, Bool) -> Void
    ) -> SFSpeechRecognitionTask {
        recognizer.recognitionTask(with: req) { result, error in
            let text = result?.bestTranscription.formattedString
            let done = error != nil || (result?.isFinal ?? false)
            DispatchQueue.main.async { MainActor.assumeIsolated { update(text, done) } }
        }
    }

    private nonisolated static func authorize() async -> Bool {
        let speech = await withCheckedContinuation { c in
            SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0 == .authorized) }
        }
        guard speech else { return false }
        return await AVAudioApplication.requestRecordPermission()
    }
}
