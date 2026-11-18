// Szenarien des KI-Benchmarks. Vorlage sind echte Gespräche, in denen Gemini/Claude die
// Impala-MCP-Verbindung benutzt haben (Export aus Antigravity und Claude Code, Nov. 2026):
// Heft-Korrektur („schau was ich gemacht habe, stimmt das, wie mache ich weiter“), Fristen
// und Organisation aus den Fachseiten, „erklär es kürzer/einfacher“, Tracker pflegen,
// Karteikarten mit Unterstapeln, Lernpfad zum aktuellen Thema. Dazu das lange PDF und ein
// langer Chat. Jede Runde läuft in beiden Modi: in der App (Rust-Agent) und über MCP.
//
// Prüfungen: re (Treffer im Antworttext), tool (Werkzeuggruppe benutzt), fn (Funktion über
// das Protokoll; bekommt (rec, ctx) mit ctx.prev = frühere Runden dieses Szenarios).
// rec.changes enthält Schreibwünsche in einer Form: { op, title, content, search, replace, front, back, deck }.

const re = (label, pattern) => ({ label, re: pattern });
const tool = (label, group) => ({ label, tool: group });
const fn = (label, test) => ({ label, fn: test });
const ops = (rec, op) => rec.changes.filter((o) => o?.op === op);
// Einzelne Karten, egal ob je Operation eine Karte (front/back) oder mehrere (cards: […]) kamen.
const cards = (rec) => ops(rec, "card.create").flatMap((o) => (Array.isArray(o.cards) ? o.cards.map((c) => ({ ...c, deck: o.deck })) : [o]));
// „Kurz“ zählt nur, wenn die Antwort auch inhaltlich etwas getroffen hat (needsContent).
const short = (max) => ({ ...fn(`kurz (≤ ${max} Zeichen)`, (r) => String(r.text || "").length <= max), needsContent: true });
const FOUND_2I = /±\s*2\s*i|\+\-\s*2\s*i|2\s*i\b|imaginär|komplex/i;
const viewed = (page) => fn(`Heftseite ${page} angesehen`, (r) => r.tools.some((t) => t.group === "heft" && t.page === page && !t.error));
const writes = (rec, title) => rec.changes.filter((o) => title.test(String(o.title || "")));
const written = (rec, title) => writes(rec, title).map((o) => [o.content, o.text, o.replace].filter(Boolean).join("\n")).join("\n");

const HEFT = "Aufbau-Übungsblatt · Von Blatt 2 zu Blatt 4";

// Vorlesungsverzeichnis: Eintrag „4 · Lager …“ (Kontinuumsmechanik) ist nur ein Gerüst; VL 1 zeigt
// das Schema (> 📄 Folien, > [!blue] 🎯 Kern, ### 🔑 Das Wichtigste, ### 📝 Zusammenfassung).
const KM4 = /lager/i;
const allChanges = (r, c) => [...(c?.prev || []).flatMap((p) => p.changes), ...r.changes];
const km4Text = (changes) => changes.filter((o) => KM4.test(String(o.title || ""))).map((o) => [o.content, o.text, o.replace].filter(Boolean).join("\n")).join("\n");
const km4Props = (changes) => Object.assign({}, ...changes.filter((o) => KM4.test(String(o.title || "")) && o.props).map((o) => o.props));
const schemaChecks = (all) => [
	fn("kein Duplikat (bestehenden Eintrag 4 ergänzt)", (r, c) => !all(r, c).some((o) => o.op === "page.create" && KM4.test(String(o.title || ""))) && all(r, c).some((o) => o.op !== "page.create" && KM4.test(String(o.title || "")))),
	fn("Schema: 🎯 Kern + 🔑 Das Wichtigste + 📝 Zusammenfassung", (r, c) => { const t = km4Text(all(r, c)); return /🎯\s*\*?\*?Kern/.test(t) && /🔑\s*Das Wichtigste/.test(t) && /📝\s*Zusammenfassung/.test(t); }),
	fn("Inhalt aus V04 ergänzt (3D-Lager/6 FG oder mehrteilige Tragwerke/Gelenke)", (r, c) => /6\s*Freiheitsgrad|3D|räumlich|mehrteilig|Gelenk|Abzähl|f\s*=\s*3\s*n/i.test(km4Text(all(r, c)))),
	fn("Spalten gefüllt (≥ 3 von Teil, Schwierigkeit, Klausurrelevanz, Themen)", (r, c) => ["Teil", "Schwierigkeit", "Klausurrelevanz", "Themen"].filter((k) => String(km4Props(all(r, c))[k] || "").trim()).length >= 3),
	fn("nur Eintrag 4 verändert, nichts gelöscht", (r, c) => all(r, c).length > 0 && all(r, c).every((o) => KM4.test(String(o.title || "")) && !/trash|archive|rename/.test(String(o.op)))),
];

export const SCENARIOS = [
	{
		id: "heft",
		name: "Heft-Korrektur: Was habe ich gemacht, stimmt es, wie geht es weiter?",
		turns: [
			{
				text: `Schau mal in mein Heft „${HEFT}“: Was habe ich auf Seite 1 und 2 schon gemacht und stimmt das? Halte dich kurz.`,
				checks: [tool("Heft als Bild gelesen", "heft"), viewed(1), viewed(2),
					re("Aufgabe 1: x(t) = 5e^(−2t) richtig", /5\s*·?\s*e\s*\^?\s*\(?\s*[-−]\s*2\s*t/i),
					re("2a: x = k·e^(−2t) + 3", /\+\s*3\b/),
					re("2b: a = 2, b = −1 bzw. 2 sin − cos", /2\s*·?\s*sin\s*\(?t\)?\s*[-−]\s*(1\s*·?\s*)?cos|a\s*=\s*2.*b\s*=\s*[-−]\s*1/is),
					short(1800)],
			},
			{
				text: "Jetzt Seite 3, Aufgabe 3. Stimmt mein Rechenweg da? Wenn nicht, sag mir genau, in welcher Zeile der Fehler ist.",
				checks: [viewed(3), re("Fehler erkannt: a = ±2i statt ±2", FOUND_2I),
					fn("Fehlerzeile benannt (a² = −4 → Wurzel)", (r) => FOUND_2I.test(r.plain) && /a\s*\^?\s*²?\s*2?\s*=\s*[-−]\s*4|wurzel/i.test(r.plain)),
					fn("Endergebnis C₁cos(2t)+C₂sin(2t) als richtig bestätigt", (r) => FOUND_2I.test(r.plain) && /cos\s*\(?\s*2\s*t/i.test(r.plain) && /(ergebnis|lösung|endergebnis)[^.\n]{0,80}(stimmt|richtig|korrekt)|(stimmt|richtig|korrekt)[^.\n]{0,80}(ergebnis|lösung)/i.test(r.plain))],
			},
			{
				text: "Auf Seite 4 bin ich bei Aufgabe 4 bis x(t) = e^(-t)(C1 cos(2t) + C2 sin(2t)) gekommen. Wie mache ich weiter? Erklär mir nur den nächsten Schritt, nicht die ganze Lösung.",
				checks: [re("x(0) = 1 einsetzen → C₁ = 1", /C_?1\s*=\s*1\b/i), re("ẋ(0) = 0: erst ableiten", /ableit|ẋ\s*\(\s*t\s*\)\s*=|x'\s*\(\s*t\s*\)\s*=|produktregel/i),
					fn("nicht gleich die ganze Lösung (kein C₂ = 1/2)", (r) => !/C_?2\s*=\s*(1\s*\/\s*2|0[,.]5|½)/i.test(r.plain)), short(1500)],
			},
		],
	},
	{
		id: "orga",
		name: "Fristen und Organisation aus den Fachseiten",
		turns: [
			{ text: "Bis wann muss ich das Protokoll für Lab 1 (Dioden) im Elektronik-Praktikum abgeben? Diese oder nächste Woche?",
				checks: [re("So 22.11.", /22\.\s*(11|nov)/i), re("Wochentag Sonntag", /sonntag|\bso\b/i), tool("Notizen gelesen", "read")] },
			{ text: "Und welche Report-Termine kommen danach noch?",
				checks: [re("06.12.", /0?6\.\s*(12|dez)/i), re("20.12.", /20\.\s*(12|dez)/i), re("31.01.", /31\.\s*(0?1|jan)/i), re("14.02.", /14\.\s*(0?2|feb)/i)] },
			{ text: "Wann ist die DGL-Klausur und welche Hilfsmittel darf ich mitnehmen?",
				checks: [re("01.03.2027", /0?1\.\s*(0?3|märz)\.?\s*(20)?27/i), re("nicht-programmierbarer Taschenrechner", /taschenrechner/i)] },
			{ text: "In welcher FKP-Übungsgruppe bin ich und wo findet die statt?",
				checks: [re("Gruppe 2", /gruppe\s*2/i), re("Geb. 101, SR 01 016/18", /01\s*016|101/), re("Dienstag 14:15", /di(enstag)?|14[:.]15/i)] },
			{ text: "Was ist in DGL gerade die aktuelle Pflichtabgabe und bis wann genau?",
				checks: [re("Blatt 04", /blatt\s*0?4|übungsblatt\s*0?4/i), re("Mi 18.11., 14:00", /18\.\s*(11|nov)/i), re("14:00 Uhr", /14[:.]00|14\s*uhr/i)] },
		],
	},
	{
		id: "erklaeren",
		name: "Aktuelle Vorlesung kurz erklären, dann einfacher",
		turns: [
			{ text: "Erklär mir kurz und knackig, was wir heute in DGL in der Vorlesung machen und was ich davor schon können muss.",
				checks: [re("heute VL 5: Nichtlineare DGLs", /nichtlinear/i), re("Fixpunkte/Linearisierung/Jacobi", /fixpunkt|lineari|jacobi|gleichgewicht/i),
					re("Voraussetzung: Systeme/Eigenwerte (VL 4)", /eigenwert|system|matrix/i), short(1800)] },
			{ text: "Das ist mir zu komplex. Erklär es mir simpler und in kleineren Häppchen.",
				checks: [fn("kürzer oder höchstens gleich lang wie vorher", (r, c) => r.text.length <= (c.prev[0]?.text?.length || 9e9) * 1.1),
					fn("in Häppchen gegliedert (≥ 3 Abschnitte/Punkte)", (r) => (r.text.match(/^\s*(#+|[-*•]|\d+[.)]|\*\*)/gm) || []).length >= 3),
					re("Alltagsbild/Beispiel", /stell dir|beispiel|wie (ein|eine)|kaninchen|räuber|beute|ball|tal|kugel/i)] },
			{ text: "Kann ich bei so etwas die Mitternachtsformel nehmen?",
				checks: [re("Antwort ja/nein klar", /\b(ja|nein)\b/i), re("abc-Formel genannt/erklärt", /b\s*\^?\s*²?\s*2?\s*[-−]\s*4\s*·?\s*a\s*·?\s*c|abc|mitternacht/i)] },
		],
	},
	{
		id: "schreiben",
		name: "Tracker pflegen und Karteikarten mit Unterstapel (Schreiben nur simuliert)",
		turns: [
			{
				text: "Ich war heute in der FKP-Übung und habe Blatt 02 erledigt. Trag das im Übungsblatt-Tracker auf der Seite „Festkörperphysik“ ein und erhöhe die Anwesenheit auf 2 von mind. 7. Sonst nichts ändern.",
				checks: [tool("Schreibwerkzeug benutzt", "write"),
					fn("Blatt 02 abgehakt", (r) => /\[x\]\s*Blatt\s*0?2/i.test(written(r, /festkörperphysik/i))),
					fn("Anwesenheit 2 von 7", (r) => /2\s*von\s*(mind\.?\s*)?7/i.test(written(r, /festkörperphysik/i))),
					fn("kein Datenverlust (Ersetzen behält den Rest)", (r) => writes(r, /festkörperphysik/i).every((o) => o.op !== "page.replace" || /Themenüberblick/.test(String(o.content || "")) && /Organisation/.test(String(o.content || "")))),
					fn("nichts umbenannt/gelöscht", (r) => !r.changes.some((o) => /rename|trash|archive|move/.test(String(o?.op))))],
			},
			{
				text: "Mach mir 5 Karteikarten zur Vorbereitung von Lab 1 (Dioden) aus meiner Seite „Lab 1 · Dioden“, in den Stapel „Elektronik::Praktikum::Lab 1“. Kurze Frage vorne, präzise Antwort hinten.",
				checks: [fn("genau 5 Karten", (r) => cards(r).length === 5),
					fn("Unterstapel Elektronik::Praktikum::Lab 1", (r) => cards(r).length > 0 && cards(r).every((o) => /elektronik\s*::\s*praktikum\s*::\s*lab\s*1/i.test(String(o.deck || "")))),
					fn("Inhalt passt zu Dioden/Lab 1", (r) => cards(r).filter((o) => /diod|V_?f|durchlass|LED|gleichricht|1N4148|BAT41|ZD3V9|brumm|r_?D|temperatur|quiz|report/i.test(`${o.front} ${o.back}`)).length >= 4),
					fn("Vorder- und Rückseite gefüllt", (r) => cards(r).length > 0 && cards(r).every((o) => String(o.front || "").trim() && String(o.back || "").trim()))],
			},
		],
	},
	{
		id: "verzeichnis",
		name: "Neue Drive-Datei (KM V04.pdf) ins Vorlesungsverzeichnis einbauen (Schreiben nur simuliert)",
		// Text der echten Folien aus dem Drive (uni-sync); anlegen mit:
		// python -I -c "import pypdf,sys; …" "G:/Meine Ablage/SSE/3_Semester/Kontinuumsmechanik/Vorlesung/V04.pdf" tools/ai-bench/results/km-v04.txt
		pdf: { file: "results/km-v04.txt", name: "V04.pdf" },
		turns: [
			{
				text: "Ich habe mit uni-sync neue Dateien ins Drive geladen, darunter Kontinuumsmechanik/Vorlesung/V04.pdf (hängt an). Bau die Vorlesung in mein Vorlesungsverzeichnis von Kontinuumsmechanik ein: Inhalt nach dem bisherigen Schema wie bei VL 1 und die Spalten der Datenbank ausfüllen.",
				attachPdf: true,
				checks: [tool("Verzeichnis/VL 1 gelesen", "read"), ...schemaChecks((r) => r.changes)],
			},
			{
				text: "Prüf nochmal selbst: Ist der Eintrag jetzt genauso aufgebaut wie VL 1 und sind alle Spalten gefüllt? Wenn nicht, korrigier es.",
				checks: schemaChecks(allChanges),
			},
		],
	},
	{
		id: "lernpfad",
		name: "Lernpfad: von Blatt 2 zum Oszillator",
		turns: [
			{ text: "Ich kann nur das Mathe von DGL-Blatt 2, der harmonische Oszillator ist für mich ein komischer Sprung. Gib mir 4 kurze Übungsaufgaben, die von ganz einfach (Blatt-2-Niveau) bis zum gedämpften Oszillator führen. Nur die Aufgaben, noch keine Lösungen.",
				checks: [fn("3–6 Aufgaben", (r) => { const n = (r.text.match(/^\s*(\*\*)?(aufgabe\s*\d|\d+[.)]|#+\s*(aufgabe|stufe))/gim) || []).length; return n >= 3 && n <= 6; }),
					re("beginnt mit 1. Ordnung", /ẋ|x'(?!')|\\dot\{?x|dx\s*\/\s*dt/i), re("endet mit 2. Ordnung + Dämpfung", /ẍ|x''|\\ddot|d\^?2x|d²x/i),
					fn("keine Lösungen verraten", (r) => !/(^|\n)\s*(\*\*)?(lösung|ergebnis)\s*:?\s*(\*\*)?\s*[:x=]/i.test(r.plain))] },
			{ text: "Ok, bei Aufgabe 1 komme ich auf x(t) = 3e^(2t), wenn x(0) = 3 ist. Stimmt das für deine Aufgabe 1?",
				checks: [fn("prüft gegen die eigene Aufgabe 1 aus Runde 1", (r) => /stimmt|richtig|korrekt|falsch|nicht ganz|fast/i.test(r.text)), fn("Begründung mit Einsetzen/Probe", (r) => /einsetz|probe|ableit|vorzeichen|exponent/i.test(r.text))] },
		],
	},
	{
		id: "pdf",
		name: "Langes PDF (Skript S. 96–160, ~35 k Zeichen) + Rechnen + Gedächtnis",
		pdf: { heft: "Skript", from: 96, to: 160, name: "Electronics_Skript_S96-160.pdf" },
		turns: [
			{
				text: "Ich hänge dir einen Ausschnitt aus meinem Elektronik-Skript an. Im Analysebeispiel 1c liegt Vi = 6 V an. In welchem Betriebsbereich ist der Transistor dort und woran erkennt man das? Nenne die Zahlen aus dem Beispiel.",
				attachPdf: true,
				checks: [re("Sättigung erkannt", /sättig|saturat/i), re("V_BC ≈ +3,445 V genannt", /3[,.]44/), re("I_C/I_E ≈ 1,6 mA", /1[,.]6\s*mA/i)],
			},
			{
				text: "Rechne Analysebeispiel 2 mit β = 150 statt 100 nach (VDD = 15 V, RB1 = 100 kΩ, RB2 = 50 kΩ, RE = 3 kΩ, RC = 5 kΩ, VBE = 0,7 V). Gib IB, IC und VC an und sag, ob der Transistor noch im aktiven Bereich ist.",
				checks: [re("IB ≈ 8,84 µA", /8[,.]8\d?\s*(µ|u|mikro)/i), re("IC ≈ 1,33 mA", /1[,.]3[23]\d?\s*mA/i), re("VC ≈ 8,37 V", /8[,.]3[5-9]\d?\s*V/i), re("aktiver Bereich bestätigt", /aktiv|forward/i)],
			},
			{
				text: "Weiter hinten im PDF gibt es einen Teil zum Early-Effekt. Was ist die Early-Spannung und wie hängt der Ausgangswiderstand r_o damit zusammen? Wenn der Teil im Anhang gekürzt ist, schau im Heft „Skript“ nach.",
				checks: [re("Early-Spannung V_A erklärt", /V_?A\b|Early-Spannung/i), re("r_o = V_A / I_C", /r_?o\s*[=≈]\s*\(?\s*V_?A|V_?A\s*\/\s*I_?C/i), re("Basisweitenmodulation/Steigung erwähnt", /basisweite|base.?width|steigung|kennlinie|U_?CE|V_?CE/i)],
			},
			{
				text: "Welchen Wert hatte IC im Originalbeispiel mit β = 100, und um wie viel Prozent steigt IC mit β = 150?",
				checks: [re("Original IC ≈ 1,28/1,29 mA", /1[,.]2[89]\s*mA/i), re("Anstieg ≈ 3–4 %", /\b[34]([,.]\d+)?\s*%/)],
			},
		],
	},
	{
		id: "memory",
		name: "Langer Chat (9 Runden, Verlauf wird zusammengefasst) – Gedächtnis",
		turns: [
			{ text: "Merk dir bitte für später: Meine Elektronik-Klausur ist am 12. Februar im Hörsaal HS 1015, und mein Lernpartner heißt Malte. Bestätige kurz, du musst nichts speichern.", checks: [re("bestätigt", /12\.?\s*feb|malte|1015|notiert|gemerkt/i)] },
			{ text: "Erklär mir kurz die Emitterschaltung: Verstärkung, Phasenlage, Ein- und Ausgangswiderstand.", checks: [re("Phasendrehung 180°", /180|invert|gegenphas/i)] },
			{ text: "Was bedeutet CMRR beim Differenzverstärker?", checks: [re("Gleichtakt/Differenz", /gleichtakt|common.?mode/i)] },
			{ text: "Worin unterscheiden sich NMOS und PMOS?", checks: [re("Elektronen/Löcher", /elektron|löcher|loch/i)] },
			{ text: "Wozu dient ein Stromspiegel?", checks: [re("Strom kopieren/Konstantstrom", /kopier|spiegel|konstant|referenz/i)] },
			{ text: "Wie funktioniert eine Z-Diode als Spannungsstabilisierung?", checks: [re("Durchbruch/Sperrrichtung", /durchbruch|sperr|breakdown|zener/i)] },
			{ text: "Was ist der Miller-Effekt?", checks: [re("Kapazität vergrößert", /kapazit|\(1\s*[+−-]|verstärk/i)] },
			{ text: "Wofür ist der 741 bekannt?", checks: [re("Operationsverstärker", /operationsverstärker|op-?amp|opv/i)] },
			{
				text: "Wann und wo war nochmal meine Klausur, und wie heißt mein Lernpartner?",
				checks: [re("12. Februar", /12\.?\s*(feb|februar|0?2\.)/i), re("HS 1015", /1015/), re("Malte", /malte/i)],
			},
		],
	},
];
