// Texte für den Abschreib-Modus (abschreiben.js): Stoff aus dem SSE-Studium
// (Mathe, Elektrotechnik, Physik, Chemie, Energie), damit die Erkennung genau
// die Fachwörter und Formeln lernt, die später im Heft vorkommen.
// Nur Zeichen aus dem Handschrift-Vokabular (handwriting/vocabulary.py).
// Keine Texte aus data/benchmark_test_strokes.json übernehmen (sonst Leakage).
// Reihenfolge nicht ändern: Index bestimmt, ob ein Text Mess- oder Trainingsdaten liefert.

export const ABSCHREIB_TEXTE = [
	{ titel: "Gradient", text: "Der Gradient grad f zeigt in die Richtung des steilsten Anstiegs. Seine Länge gibt an, wie schnell f dort wächst. Ist der Gradient null, liegt ein kritischer Punkt vor: Maximum, Minimum oder Sattelpunkt." },
	{ titel: "Determinante", text: "Für eine 2x2-Matrix gilt det A = a*d - b*c. Ist die Determinante null, sind die Spalten linear abhängig und A ist nicht invertierbar. Der Betrag der Determinante ist der Faktor, um den A Flächen streckt." },
	{ titel: "Wachstum und Zerfall", text: "Die Gleichung y' = λ*y beschreibt Wachstum und Zerfall. Ihre Lösung lautet y(t) = C*e^(λt). Für λ < 0 klingt sie ab, für λ > 0 wächst sie exponentiell." },
	{ titel: "Federpendel", text: "Ein Federpendel gehorcht der Gleichung m*x'' = -k*x. Es schwingt mit der Kreisfrequenz √(k/m). Eine doppelte Masse macht die Schwingung also um den Faktor √2 langsamer." },
	{ titel: "Polarkoordinaten", text: "In Polarkoordinaten gilt x = r*cos(t) und y = r*sin(t). Beim Integrieren kommt der Faktor r dazu: dx dy = r dr dt. Damit ergibt sich die Kreisfläche zu π*R^2." },
	{ titel: "Fourierreihe", text: "Jede periodische Funktion lässt sich als Summe von Sinus- und Kosinusschwingungen schreiben. Die Koeffizienten verraten, wie stark jede Frequenz vertreten ist. So zerlegt ein Equalizer Musik in Bässe und Höhen." },
	{ titel: "Satz von Gauß", text: "Der Satz von Gauß verbindet Volumen und Rand: Das Integral der Divergenz über ein Volumen ist gleich dem Fluss durch seine Oberfläche. Für das elektrische Feld heißt das: Der Fluss durch eine geschlossene Fläche hängt nur von der eingeschlossenen Ladung ab." },
	{ titel: "Taylorreihe", text: "Die Taylorreihe nähert eine Funktion durch ein Polynom an: sin(x) = x - x^3/6 + x^5/120 - ... Für kleine Winkel reicht schon der erste Term. Deshalb rechnet man beim Pendel einfach mit sin(x) = x." },
	{ titel: "Kondensator", text: "Ein Kondensator speichert Ladung: Q = C*U. Die gespeicherte Energie beträgt W = 1/2 * C * U^2. Beim Aufladen über einen Widerstand steigt die Spannung mit der Zeitkonstante R*C." },
	{ titel: "Wechselstrom", text: "Im Stromnetz schwingt die Spannung 50-mal pro Sekunde. Der Effektivwert von 230 V entspricht einer Spitze von etwa 325 V, denn 230 * √2 = 325. Spulen und Kondensatoren verschieben Strom und Spannung gegeneinander." },
	{ titel: "Kirchhoff", text: "Nach der Knotenregel ist die Summe aller Ströme in einem Knoten null. Nach der Maschenregel addieren sich alle Spannungen in einer Masche zu null. Mit beiden Regeln lässt sich jedes Netzwerk aus Widerständen berechnen." },
	{ titel: "Blindwiderstand", text: "Der Blindwiderstand einer Spule wächst mit der Frequenz: X = 2*π*f*L. Beim Kondensator ist es umgekehrt: X = 1/(2*π*f*C). Bei der Resonanzfrequenz heben sich beide genau auf." },
	{ titel: "Coulomb", text: "Zwei Ladungen ziehen sich an oder stoßen sich ab. Die Kraft sinkt mit dem Quadrat des Abstands: F = k*q1*q2/r^2. Doppelter Abstand bedeutet also nur noch ein Viertel der Kraft." },
	{ titel: "Lorentzkraft", text: "Bewegt sich eine Ladung durch ein Magnetfeld, wirkt die Lorentzkraft F = q*v*B senkrecht zur Bewegung. Deshalb laufen Elektronen im Magnetfeld auf Kreisbahnen. Nach demselben Prinzip drehen sich Elektromotoren." },
	{ titel: "Induktion", text: "Ändert sich der magnetische Fluss durch eine Leiterschleife, wird eine Spannung induziert. Nach Lenz wirkt der induzierte Strom seiner Ursache entgegen. Jeder Generator im Kraftwerk nutzt dieses Prinzip." },
	{ titel: "Wellen", text: "Für jede Welle gilt c = λ*f. Grünes Licht mit 500 nm Wellenlänge schwingt also rund 600 Billionen Mal pro Sekunde. Zwei Wellen verstärken sich, wenn ihr Gangunterschied ein Vielfaches von λ ist." },
	{ titel: "Redox", text: "Bei einer Redoxreaktion wandern Elektronen. Oxidation ist Elektronenabgabe, Reduktion ist Elektronenaufnahme. Merksatz: Das Reduktionsmittel gibt ab, das Oxidationsmittel nimmt auf." },
	{ titel: "Akku", text: "In einem Lithium-Ionen-Akku wandern beim Laden Lithium-Ionen zur Graphit-Anode. Beim Entladen fließen sie zurück, und Elektronen treiben den Strom durch das Gerät. Eine Zelle liefert etwa 3,7 V." },
	{ titel: "Ideales Gas", text: "Für ein ideales Gas gilt p*V = n*R*T. Verdoppelt man die Temperatur bei festem Volumen, verdoppelt sich der Druck. Deshalb sollte man Spraydosen nie in die pralle Sonne legen." },
	{ titel: "Elektrolyse", text: "Bei der Elektrolyse wird Wasser mit Strom zerlegt: 2 H2O -> 2 H2 + O2. Der Wasserstoff kann später in einer Brennstoffzelle wieder Strom liefern. So lässt sich Solarstrom aus dem Sommer für den Winter speichern." },
	{ titel: "Solarzelle", text: "Eine Solarzelle besteht aus dotiertem Silizium. Trifft Licht auf den pn-Übergang, entstehen freie Ladungsträger und ein Strom fließt. Gute Module wandeln heute über 22 % des Sonnenlichts in Strom um." },
	{ titel: "Windkraft", text: "Die Leistung des Windes wächst mit der dritten Potenz der Geschwindigkeit: P ist proportional zu v^3. Doppelter Wind bringt also achtfache Leistung. Mehr als 59 % kann aber keine Turbine entnehmen, das ist die Betz-Grenze." },
	{ titel: "Carnot", text: "Keine Wärmekraftmaschine schlägt den Carnot-Prozess: Wirkungsgrad = 1 - Tk/Tw. Bei 600 K und 300 K sind höchstens 50 % möglich. Deshalb arbeiten Kraftwerke mit möglichst heißem Dampf." },
	{ titel: "Kilowattstunde", text: "Eine Kilowattstunde sind 3,6 Millionen Joule. Damit fährt ein E-Auto etwa 6 km weit oder ein Kühlschrank läuft einen Tag. Ein Mensch leistet auf dem Fahrrad dauerhaft nur rund 100 W." },
];

// Jeder vierte Text (Index 3, 7, 11, ...) ist eine Messzeile und darf nie ins Training.
export function abschreibSplit(textIndex) {
	return textIndex % 4 === 3 ? "eval" : "train";
}
