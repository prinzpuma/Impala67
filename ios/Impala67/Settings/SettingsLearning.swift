import SwiftUI

/// Einstellungen für den Bereich „Lernen“ (settings-renderer.js `renderLearning`, `SettingsLearning.kt`):
/// Lernverhalten (Overlearning, Selbsteinschätzung, Telemetrie, Pausen-Erinnerung, Wochenziel),
/// Beta-Lernfunktionen und Controller-Steuerung.
struct LearningSettingsSections: View {
    @AppStorage("impala67Overlearn") private var overlearn = true
    @AppStorage("impala67Confidence") private var confidence = false
    @AppStorage("impala67Telemetry") private var telemetry = true
    @AppStorage("impala67BreakReminder") private var breakReminder = true
    @AppStorage(WeekGoal.key) private var weekGoal = 300

    @AppStorage("impala67ControllerEnabled") private var controllerEnabled = false
    @AppStorage("impala67PadHud") private var padHud = true
    @AppStorage("impala67PadVib") private var padVib = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SettingsPageHead(
                title: "Lernen",
                description: "Wie Karteikarten abgefragt werden und welche Lernhilfen dich unterstützen."
            )

            // MARK: - Lernverhalten
            SettingsCardGroup(title: "Lernverhalten") {
                SettingsSwitchRow(
                    title: "Overlearning-Sperre",
                    description: "Verhindert sofortiges Wiederholen frisch bewerteter Karten",
                    isOn: $overlearn
                )
                SettingsDivider()
                SettingsSwitchRow(
                    title: "Selbsteinschätzung abfragen",
                    description: confidence
                        ? "Du bewertest deine Sicherheit bewusst"
                        : "Die App schätzt Sicherheit aus der Antwortzeit",
                    isOn: $confidence
                )
                SettingsDivider()
                SettingsSwitchRow(
                    title: "Lernanalyse aufzeichnen",
                    description: "Speichert Lernzeiten und Bewertungen für Statistik und Lernanalyse – nur auf deinen eigenen Geräten",
                    isOn: $telemetry
                )
                SettingsDivider()
                SettingsSwitchRow(
                    title: "Pausen-Erinnerung",
                    description: "Erinnert nach 40 Minuten Lernen an eine kurze Pause",
                    isOn: $breakReminder
                )
                SettingsDivider()
                SettingsRow(title: "Wochenziel", description: "Lernzeit pro Woche (nur dieses Gerät)") {
                    Picker("Wochenziel", selection: $weekGoal) {
                        ForEach(WeekGoal.presets, id: \.self) { minutes in
                            Text(HomeFormat.dur(Double(minutes))).tag(minutes)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.menu)
                }
            }

            // MARK: - Beta-Lernfunktionen
            SettingsCardGroup(
                title: "Beta-Lernfunktionen",
                footnote: "Beta-Funktionen sind standardmäßig aus und lassen sich einzeln aktivieren."
            ) {
                SettingsRow(
                    title: "Elaborative Interrogation",
                    description: "Die KI fragt nach guten Bewertungen nach dem „Warum?“ zur Festigung"
                )
                SettingsDivider()
                SettingsRow(
                    title: "Fragen-Variation",
                    description: "Formuliert die Vorderseite bekannter Karten zur Abwechslung um"
                )
                SettingsDivider()
                SettingsRow(
                    title: "Gestufte Hinweise",
                    description: "Gibt stufenweise Hilfestellungen vor dem Aufdecken der Antwort"
                )
                SettingsDivider()
                SettingsRow(
                    title: "Distraktor-Quiz",
                    description: "Erzeugt aus Karteikarten Multiple-Choice-Fragen mit plausiblen Fallen"
                )
                SettingsDivider()
                SettingsRow(
                    title: "Fehler-Detektor",
                    description: "Generiert fehlerhafte Beispieltexte zur aktiven Fehlersuche"
                )
            }

            // MARK: - Mit Controller lernen
            SettingsCardGroup(
                title: "Mit Controller lernen",
                footnote: "Unterstützt kabellose Bluetooth-Controller (PlayStation DualSense, Xbox Wireless, Nintendo Switch Pro und MFi-Controller)."
            ) {
                SettingsSwitchRow(
                    title: "Controller-Steuerung",
                    description: "Karten abfragen, umdrehen und bewerten per Gamepad",
                    isOn: $controllerEnabled
                )
                if controllerEnabled {
                    SettingsDivider()
                    SettingsSwitchRow(
                        title: "Tastenhinweise (HUD)",
                        description: "Blendet Tastenbelegung während des Lernens dezent am Bildschirmrand ein",
                        isOn: $padHud
                    )
                    SettingsDivider()
                    SettingsSwitchRow(
                        title: "Vibration",
                        description: "Taktile Rückmeldung beim Umdrehen und Bewerten",
                        isOn: $padVib
                    )
                    SettingsDivider()
                    SettingsRow(
                        title: "Tastenbelegung",
                        description: "A = Aufdecken · B / 1 = Nochmal · X / 2 = Schwer · Y / 3 = Gut · RB / 4 = Einfach"
                    )
                }
            }
        }
        .onAppear {
            weekGoal = WeekGoal.normalized(weekGoal)
        }
    }
}
