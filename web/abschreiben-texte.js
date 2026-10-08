// Texte für den Abschreib-Modus (abschreiben.js).
// Nur Zeichen aus dem Handschrift-Vokabular (handwriting/vocabulary.py):
// Buchstaben, äöüÄÖÜß, Ziffern, Leerzeichen und .,!?-+:/*=()@#%'
// Keine Texte aus data/benchmark_test_strokes.json übernehmen (sonst Leakage).
// Reihenfolge nicht ändern: Index bestimmt, ob ein Text Mess- oder Trainingsdaten liefert.

export const ABSCHREIB_TEXTE = [
	{ titel: "Drei Herzen", text: "Ein Oktopus hat drei Herzen und blaues Blut. Zwei Herzen pumpen das Blut durch die Kiemen, das dritte versorgt den Körper. Beim Schwimmen hört dieses dritte Herz sogar auf zu schlagen. Deshalb kriechen Oktopusse lieber, als dass sie schwimmen." },
	{ titel: "Ewiger Honig", text: "Honig verdirbt fast nie. Er enthält kaum Wasser und ist leicht sauer, darin können Bakterien nicht überleben. In alten ägyptischen Gräbern fanden Forscher Töpfe mit Honig, die mehrere tausend Jahre alt waren." },
	{ titel: "Falsche Beeren", text: "Botanisch gesehen ist die Banane eine Beere, die Erdbeere aber nicht. Auch Gurken, Kürbisse und Tomaten zählen zu den Beeren. Die Erdbeere ist eine Sammelnussfrucht: Die kleinen gelben Punkte auf ihr sind die eigentlichen Früchte." },
	{ titel: "Langer Tag", text: "Auf der Venus dauert ein Tag länger als ein Jahr. Für eine Drehung um sich selbst braucht sie 243 Erdtage, für eine Runde um die Sonne nur 225. Außerdem dreht sie sich andersherum als die Erde, die Sonne geht dort im Westen auf." },
	{ titel: "Kleopatra", text: "Kleopatra lebte zeitlich näher an der ersten Mondlandung als am Bau der großen Pyramide von Gizeh. Die Pyramide war zu ihrer Zeit schon etwa 2500 Jahre alt. Von Kleopatra bis zur Mondlandung 1969 vergingen dagegen nur rund 2000 Jahre." },
	{ titel: "Victor jagt", text: "Victor jagt zwölf Boxkämpfer quer über den großen Sylter Deich. Falsches Üben von Xylophonmusik quält jeden größeren Zwerg. Beide Sätze enthalten jeden Buchstaben des Alphabets mindestens einmal. Man nennt solche Sätze Pangramme." },
	{ titel: "Acht Minuten", text: "Das Licht der Sonne braucht etwa 8 Minuten und 20 Sekunden bis zur Erde. Wenn wir die Sonne ansehen, sehen wir sie also so, wie sie vor über acht Minuten war. Das Licht ferner Sterne ist oft sogar Tausende Jahre unterwegs." },
	{ titel: "Wachsender Turm", text: "Der Eiffelturm ist im Sommer bis zu 15 cm höher als im Winter. Das Eisen dehnt sich bei Wärme aus. Gebaut wurde er 1889 für die Weltausstellung in Paris und sollte eigentlich nach 20 Jahren wieder abgerissen werden." },
	{ titel: "Würfel", text: "Wombats sind die einzigen Tiere, die würfelförmigen Kot machen. Die Würfel rollen nicht weg und markieren so das Revier auf Steinen und Baumstämmen. Wie genau der Darm die Ecken formt, haben Forscher erst 2018 herausgefunden." },
	{ titel: "Zahlenzauber", text: "Rechne einmal 111111111 * 111111111 aus. Das Ergebnis ist 12345678987654321, eine Zahl, die von 1 bis 9 hinauf und wieder hinunter läuft. Auch 9 * 9 = 81 und 99 * 99 = 9801 folgen einem hübschen Muster." },
	{ titel: "Schachbrett", text: "Ein alter Herrscher wollte den Erfinder des Schachspiels belohnen. Der wünschte sich ein Reiskorn auf dem ersten Feld, zwei auf dem zweiten, vier auf dem dritten und so weiter. Auf allen 64 Feldern zusammen wären das über 18 Trillionen Körner gewesen." },
	{ titel: "Schweres Sternchen", text: "Ein Neutronenstern ist so dicht gepackt, dass ein Teelöffel davon auf der Erde etwa eine Milliarde Tonnen wiegen würde. Dabei hat so ein Stern nur einen Durchmesser von ungefähr 20 Kilometern, kaum größer als eine Stadt." },
	{ titel: "Kochen am Gipfel", text: "Auf der Zugspitze kocht Wasser schon bei etwa 90 Grad. Oben ist der Luftdruck niedriger, deshalb verdampft das Wasser früher. Nudeln brauchen dort länger, weil das Wasser nie so heiß wird wie im Tal." },
	{ titel: "Fleißiges Herz", text: "Ein menschliches Herz schlägt etwa 100000 Mal am Tag. In einem langen Leben kommen so fast drei Milliarden Schläge zusammen. Dabei pumpt es jeden Tag rund 7000 Liter Blut durch den Körper." },
	{ titel: "Haie und Bäume", text: "Haie gibt es schon länger als Bäume. Die ersten Haie schwammen vor über 400 Millionen Jahren durch die Meere. Die ersten echten Bäume wuchsen erst einige Millionen Jahre später an Land." },
	{ titel: "Der See ohne Grenze", text: "Am Bodensee treffen Deutschland, Österreich und die Schweiz aufeinander. Wo genau die Grenzen im Wasser verlaufen, wurde nie verbindlich festgelegt. Es ist eine der wenigen Stellen in Europa ohne klare Grenze." },
	{ titel: "Drei f", text: "Seit der Rechtschreibreform schreibt man Schifffahrt mit drei f. Kaffeeersatz hat sogar drei e hintereinander. Eines der längsten Wörter im Duden ist Kraftfahrzeug-Haftpflichtversicherung. Im Alltag sagt das aber niemand, wir sagen einfach Autoversicherung." },
	{ titel: "Ada Lovelace", text: "Ada Lovelace schrieb 1843 das erste Computerprogramm der Welt. Es war für eine Rechenmaschine gedacht, die nie fertig gebaut wurde. Sie ahnte schon damals, dass solche Maschinen eines Tages auch Musik komponieren könnten." },
	{ titel: "Kaltes Licht", text: "Glühwürmchen erzeugen Licht fast ganz ohne Wärme. Ein Großteil der Energie wird zu Licht. Eine alte Glühbirne dagegen verwandelt den größten Teil ihres Stroms in Wärme und nur wenige Prozent in Licht." },
	{ titel: "Lernen mit Pausen", text: "Wer Vokabeln an mehreren Tagen wiederholt, behält sie viel länger als jemand, der alles am Abend vor der Prüfung lernt. Diesen Effekt nennt man verteiltes Lernen. Karteikarten mit wachsenden Abständen nutzen genau diesen Trick." },
	{ titel: "Ohmsches Gesetz", text: "In der Physik gilt U = R * I. Die Spannung ist also Widerstand mal Stromstärke. Bei 230 Volt und einem Widerstand von 46 Ohm fließen genau 5 Ampere. Verdoppelt man den Widerstand, halbiert sich der Strom." },
	{ titel: "Schlafkönige", text: "Koalas schlafen bis zu 20 Stunden am Tag. Ihre Nahrung, die Blätter des Eukalyptus, liefert kaum Energie und ist schwer zu verdauen. Wer so wenig Energie bekommt, spart sie am besten im Schlaf." },
	{ titel: "Pfannkuchen", text: "Für vier Pfannkuchen brauchst du 200 g Mehl, 2 Eier, 300 ml Milch und eine Prise Salz. Alles glatt rühren und den Teig 10 Minuten ruhen lassen. Dann in einer heißen Pfanne mit etwas Butter von beiden Seiten goldbraun backen." },
	{ titel: "Der höchste Berg", text: "Der Mount Everest ist 8849 Meter hoch und wächst noch immer um einige Millimeter pro Jahr. Die indische Platte schiebt sich langsam unter Asien. Gemessen vom Erdmittelpunkt ist aber der Chimborazo in Ecuador der höchste Gipfel." },
	{ titel: "Postkarte aus 2075", text: "Liebe Grüße aus dem Jahr 2075! Die Züge fahren pünktlich, die Hausaufgaben macht niemand mehr allein und Briefe schreibt man wieder mit der Hand. Nur das WLAN im Zug ist immer noch genauso schlecht wie früher." },
	{ titel: "Geschwindigkeit", text: "Die Geschwindigkeit ist Strecke durch Zeit, also v = s / t. Ein Zug fährt 360 km in 2 Stunden und ist damit im Schnitt 180 km/h schnell. Ein Gepard schafft kurz über 100 km/h, aber nur für wenige hundert Meter." },
	{ titel: "Bienensprache", text: "Honigbienen tanzen, um anderen Bienen den Weg zu Blüten zu zeigen. Die Richtung des Tanzes zeigt den Winkel zur Sonne, die Dauer verrät die Entfernung. Für ein Glas Honig fliegen Bienen zusammen etwa dreimal um die Erde." },
	{ titel: "Der Mond entfernt sich", text: "Der Mond entfernt sich jedes Jahr um etwa 3,8 cm von der Erde. Das haben Forscher mit Laserstrahlen gemessen, die sie an Spiegeln auf dem Mond reflektieren ließen. Die Spiegel stellten Astronauten 1969 dort ab." },
	{ titel: "Eine kurze Geschichte", text: "Es war einmal ein Igel, der jeden Morgen um sieben Uhr zum Bäcker ging. Er kaufte immer genau ein Brötchen und zwei Kekse. Eines Tages war der Bäcker krank. Der Igel ging nach Hause, backte selbst und eröffnete eine Woche später seine eigene Bäckerei." },
	{ titel: "Quadratzahlen", text: "Die Summe der ersten ungeraden Zahlen ist immer eine Quadratzahl: 1 + 3 = 4, 1 + 3 + 5 = 9 und 1 + 3 + 5 + 7 = 16. Legt man Steine in Winkeln um ein Quadrat, sieht man sofort, warum das so ist." },
	{ titel: "Elefanten", text: "Elefanten können über den Boden kommunizieren. Sie erzeugen sehr tiefe Töne, die als Schwingungen viele Kilometer weit laufen. Andere Elefanten spüren diese Signale mit ihren Füßen und ihrem Rüssel." },
	{ titel: "Papier falten", text: "Ein Blatt Papier lässt sich kaum öfter als sieben Mal falten. Mit jeder Faltung verdoppelt sich die Dicke. Könnte man es 42 Mal falten, wäre der Stapel dicker als der Weg von der Erde bis zum Mond." },
];

// Jeder vierte Text liefert Messzeilen (nie Training), der Rest Trainingsdaten.
export function abschreibSplit(textIndex) {
	return textIndex % 4 === 3 ? "eval" : "train";
}
