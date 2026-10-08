// Texte für den Abschreib-Modus (abschreiben.js): Stoff aus Semester 3 (Fächer laut
// Impala-Seite „Semester 3“), damit die Erkennung genau die Fachwörter und Formeln
// lernt, die später im Heft vorkommen.
// Nur Zeichen aus dem Handschrift-Vokabular (handwriting/vocabulary.py).
// Keine Texte aus data/benchmark_test_strokes.json übernehmen (sonst Leakage).
// Reihenfolge nicht ändern: Index bestimmt, ob ein Text Mess- oder Trainingsdaten liefert.

export const ABSCHREIB_TEXTE = [
	{ titel: "Trennung der Variablen", text: "Bei der Trennung der Variablen bringt man alle y auf eine Seite und alle x auf die andere. Aus y' = 2xy wird dy/y = 2x dx. Integrieren liefert ln(y) = x^2 + C, also y = K*e^(x^2)." },
	{ titel: "Charakteristisches Polynom", text: "Für y'' + 3y' + 2y = 0 setzt man y = e^(λx) an. Das charakteristische Polynom λ^2 + 3λ + 2 = 0 hat die Nullstellen -1 und -2. Die Lösung lautet y = C1*e^(-x) + C2*e^(-2x)." },
	{ titel: "Laplace", text: "Die Laplace-Transformation macht aus einer DGL eine algebraische Gleichung. Aus y' wird s*Y(s) - y(0). Nach der Partialbruchzerlegung transformiert man einfach zurück." },
	{ titel: "Phasenraum", text: "Bei linearen DGL-Systemen entscheiden die Eigenwerte über das Verhalten. Zwei negative reelle Eigenwerte ergeben einen stabilen Knoten. Komplexe Eigenwerte mit negativem Realteil ergeben einen Strudel." },
	{ titel: "Elektronegativität", text: "Im Periodensystem steigt die Elektronegativität nach rechts oben an. Fluor ist mit 4,0 das elektronegativste Element. Je größer der Unterschied zweier Atome, desto polarer ist ihre Bindung." },
	{ titel: "pH-Wert", text: "Der pH-Wert ist der negative dekadische Logarithmus der Oxonium-Konzentration: pH = -lg(c). Reines Wasser hat bei 25 Grad den pH 7. Eine Einheit weniger bedeutet zehnmal mehr Säure." },
	{ titel: "Gleichgewicht", text: "Das Massenwirkungsgesetz beschreibt das chemische Gleichgewicht: K = c(C)*c(D)/(c(A)*c(B)). Nach Le Chatelier weicht ein Gleichgewicht jedem äußeren Zwang aus. Mehr Druck begünstigt die Seite mit weniger Gasteilchen." },
	{ titel: "Spannungsreihe", text: "Bei der Oxidation gibt ein Stoff Elektronen ab, bei der Reduktion nimmt er sie auf. Zink löst sich in Kupfersulfat-Lösung, weil Zink unedler ist: Zn + Cu2+ -> Zn2+ + Cu. Die Spannungsreihe sagt voraus, welche Reaktion freiwillig abläuft." },
	{ titel: "Einschaltvorgang", text: "Beim Einschalten eines RC-Glieds steigt die Kondensatorspannung nach u(t) = U0*(1 - e^(-t/(R*C))). Nach einer Zeitkonstante sind 63 % erreicht. Nach fünf Zeitkonstanten gilt der Kondensator als voll geladen." },
	{ titel: "Ersatzspannungsquelle", text: "Jede lineare Schaltung lässt sich von außen durch eine Spannungsquelle mit Innenwiderstand ersetzen. Die Leerlaufspannung ist die Quellspannung, und es gilt Ri = U0/IK. Das ist die Ersatzspannungsquelle nach Thevenin." },
	{ titel: "Wheatstone-Brücke", text: "Eine Wheatstone-Brücke ist abgeglichen, wenn R1/R2 = R3/R4 gilt. Dann ist die Diagonalspannung null. So lassen sich sehr kleine Widerstandsänderungen messen, zum Beispiel bei Dehnungsmessstreifen." },
	{ titel: "De Morgan", text: "Nach De Morgan gilt: NICHT(A UND B) = (NICHT A) ODER (NICHT B). Damit lässt sich jedes Gatter aus NAND-Gattern bauen. Eine Wahrheitstabelle mit drei Eingängen hat 2^3 = 8 Zeilen." },
	{ titel: "Diode", text: "Eine Siliziumdiode leitet ab etwa 0,7 V in Durchlassrichtung. In Sperrrichtung fließt fast kein Strom, bis die Durchbruchspannung erreicht ist. Der Graetz-Gleichrichter nutzt mit vier Dioden beide Halbwellen." },
	{ titel: "Bipolartransistor", text: "Beim Bipolartransistor steuert ein kleiner Basisstrom einen großen Kollektorstrom: IC = β*IB. Mit β = 200 und IB = 10 uA fließen also 2 mA. Im aktiven Bereich gilt UBE = 0,7 V." },
	{ titel: "Operationsverstärker", text: "Ein invertierender Verstärker hat die Verstärkung V = -R2/R1. Mit R1 = 1 kOhm und R2 = 10 kOhm wird das Signal zehnfach verstärkt und umgedreht. Bei der Versorgungsspannung von 15 V ist aber Schluss." },
	{ titel: "MOSFET", text: "Ein MOSFET ist in Sättigung, wenn UDS >= UGS - Ut gilt. Dann hängt der Drainstrom kaum noch von UDS ab. Im CMOS-Inverter arbeitet immer ein Transistor als Pull-Up und einer als Pull-Down." },
	{ titel: "Statik", text: "Ein Körper ist im Gleichgewicht, wenn die Summe aller Kräfte und die Summe aller Momente null sind. In der Ebene liefert das drei Gleichungen. Damit lassen sich die Lagerkräfte eines Balkens bestimmen." },
	{ titel: "Steiner", text: "Der Satz von Steiner verschiebt ein Flächenträgheitsmoment: I = Is + A*a^2. Liegt die Fläche weit weg von der Achse, wird der Balken viel steifer. Deshalb haben Doppel-T-Träger ihr Material außen." },
	{ titel: "Hooke", text: "Nach Hooke ist die Spannung proportional zur Dehnung: Spannung = E * Dehnung. Stahl hat einen E-Modul von etwa 210000 N/mm^2. Ein Stab verlängert sich unter der Kraft F um F*L/(E*A)." },
	{ titel: "Biegelinie", text: "Die Biegelinie folgt aus E*I*w'''' = q(x). Viermal integrieren ergibt vier Konstanten. Sie folgen aus den Randbedingungen: An einer festen Einspannung sind Durchbiegung und Neigung null." },
	{ titel: "Bändermodell", text: "Im Bändermodell trennt eine Bandlücke das Valenzband vom Leitungsband. Bei Metallen überlappen die Bänder, bei Isolatoren ist die Lücke groß. Silizium hat eine Bandlücke von 1,1 eV und ist deshalb ein Halbleiter." },
	{ titel: "Dotierung", text: "Baut man Phosphor in Silizium ein, bringt jedes Atom ein freies Elektron mit: n-Dotierung. Bor erzeugt dagegen Löcher: p-Dotierung. Am pn-Übergang entsteht eine Raumladungszone ohne freie Ladungsträger." },
	{ titel: "Externe Kosten", text: "Externe Kosten entstehen, wenn ein Schaden nicht im Preis steckt, etwa bei CO2-Emissionen. Eine CO2-Steuer macht diese Kosten sichtbar. Der Emissionshandel setzt dagegen eine feste Obergrenze und lässt den Preis frei." },
	{ titel: "Python", text: "def quadrat(x): return x*x berechnet ein Quadrat. Die Schleife for i in range(3): print(i) gibt 0, 1 und 2 aus. Listen beginnen in Python immer beim Index 0." },
];

// Jeder vierte Text (Index 3, 7, 11, ...) ist eine Messzeile und darf nie ins Training.
export function abschreibSplit(textIndex) {
	return textIndex % 4 === 3 ? "eval" : "train";
}
