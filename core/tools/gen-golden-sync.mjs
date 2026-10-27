// Schreibt die Golden-Files für `cargo test -p impala-sync` aus den JS-Originalen:
// - tests/golden/compact/*.json: Event-Liste plus die Indizes, die web/compact-events.js behält.
// - tests/golden/protocol.json: Wire-Format, Chunk-Grenzen, verschlüsselte Pakete (fester
//   Schlüssel, IVs aus einem Byte-Zähler wie CounterRandom), Blob-Regeln, Worker-Auswertung.
// Neu erzeugen nur, wenn sich das JS-Verhalten bewusst ändert: node core/tools/gen-golden-sync.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compactEvents } from "../../web/compact-events.js";
import { sampleLog } from "./sample-log.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../impala-sync/tests/golden");
const dir = path.join(root, "compact");
fs.mkdirSync(dir, { recursive: true });

const t = (h) => `2026-03-01T${String(h).padStart(2, "0")}:00:00.000Z`;
// Handverlesene Grenzfälle, jeder mit Kommentar im Event-Feld `why`.
const edge = [
	{ why: "Inhalt älter als Löschung: fällt", t: t(1), seq: 1, type: "pageUpdate", payload: { id: "a", patch: { content: "x" } } },
	{ why: "gleiche Zeit wie Löschung: fällt (<=)", t: t(2), seq: 2, type: "pageUpdate", payload: { id: "a", patch: { title: "y" } } },
	{ why: "Löschung", t: t(2), seq: 3, type: "pageDelete", payload: { id: "a" } },
	{ why: "nach Löschung: bleibt", t: t(3), seq: 4, type: "pageUpdate", payload: { id: "a", patch: { title: "z" } } },
	{ why: "Löschung mit leerem t zählt nicht", t: "", seq: 5, type: "cardDelete", payload: { id: "k" } },
	{ why: "Karte bleibt", t: t(1), seq: 6, type: "cardUpdate", payload: { id: "k", patch: { front: "f" } } },
	{ why: "von neuerem überdeckt", t: t(4), seq: 7, type: "cardUpdate", payload: { id: "k", patch: { front: "g" } } },
	{ why: "leerer Patch bleibt", t: t(5), seq: 8, type: "cardUpdate", payload: { id: "k", patch: {} } },
	{ why: "neuester", t: t(6), seq: 9, type: "cardUpdate", payload: { id: "k", patch: { front: "h", back: "b" } } },
	{ why: "ohne patch bleibt", t: t(6), seq: 10, type: "pageUpdate", payload: { id: "b" } },
	{ why: "ohne payload bleibt", t: t(6), seq: 11, type: "pageUpdate", payload: null },
	{ why: "settings überdeckt", t: t(1), seq: 12, type: "settingsSet", payload: { theme: "dark" } },
	{ why: "settings bleibt", t: t(2), seq: 13, type: "settingsSet", payload: { theme: "light", font: 12 } },
	{ why: "settings leer bleibt", t: t(3), seq: 14, type: "settingsSet", payload: null },
	{ why: "Tabs alt", t: t(1), seq: 15, type: "uiTabsSet", payload: { tabs: ["a"] } },
	{ why: "Tabs neu", t: t(2), seq: 16, type: "uiTabsSet" },
	{ why: "Baum ohne key fällt", t: t(2), seq: 17, type: "uiTreeSet", payload: { open: true } },
	{ why: "Baum leerer key ist ein key", t: t(2), seq: 18, type: "uiTreeSet", payload: { key: "" } },
	{ why: "Chat-Gleichstand: späteres gewinnt", t: t(1), seq: 19, type: "chatUpsert", payload: { id: "c", updated: t(9) } },
	{ why: "Chat-Gleichstand: späteres gewinnt", t: t(2), seq: 20, type: "chatUpsert", payload: { id: "c", updated: t(9) } },
	{ why: "Chat ohne updated nimmt t", t: t(10), seq: 21, type: "chatUpsert", payload: { id: "d" } },
	{ why: "Chat älteres updated verliert", t: t(11), seq: 22, type: "chatUpsert", payload: { id: "d", updated: t(1) } },
	{ why: "Chat ohne id bleibt", t: t(11), seq: 23, type: "chatUpsert", payload: { id: "" } },
	{ why: "Artikel ohne id fällt", t: t(11), seq: 24, type: "homeArticleUpsert", payload: {} },
	{ why: "Bild referenziert", t: t(1), seq: 25, type: "heftBlob", payload: { hash: "H1" } },
	{ why: "Bild nicht referenziert", t: t(1), seq: 26, type: "heftBlob", payload: { hash: "H2" } },
	{ why: "Bild ohne Hash", t: t(1), seq: 27, type: "heftBlob", payload: {} },
	{ why: "Ops mit null und Strings", t: t(2), seq: 28, type: "heftOps", payload: { ops: [null, { o: "s" }, { o: { ref: "H1" } }, { o: { ref: "" } }] } },
	{ why: "Snap mit falsy Seite", t: t(2), seq: 29, type: "heftSnap", payload: { doc: { pages: [0, { images: [null, { ref: "H3" }] }, {}] } } },
	{ why: "Bild aus Snap", t: t(1), seq: 30, type: "heftBlob", payload: { hash: "H3" } },
	{ why: "gleiches t, seq entscheidet", t: t(7), seq: 32, type: "settingsSet", payload: { a: 1 } },
	{ why: "gleiches t, seq entscheidet", t: t(7), seq: 31, type: "settingsSet", payload: { a: 2 } },
	{ why: "ohne seq zählt als 0", t: t(7), type: "settingsSet", payload: { b: 1 } },
	{ why: "unbekannter Typ bleibt", t: t(7), seq: 33, type: "teleEvent", payload: "kein Objekt" },
	{ why: "ohne Typ bleibt", t: t(7), seq: 34 },
	...Array.from({ length: 12 }, (_, i) => ({ why: "Verlaufs-Schutz: 10 Inhalte bleiben", t: t(12 + i), seq: 40 + i, type: "pageUpdate", payload: { id: "v", patch: { content: "v" + i } } })),
	...Array.from({ length: 34 }, (_, i) => ({ why: "nur 30 neueste Artikel (Gleichstand: Reihenfolge)", t: t(i % 24), seq: 60 + i, type: "homeArticleUpsert", payload: { id: "art" + i, created: i < 6 ? t(1) : "2026-02-" + String(1 + (i % 27)).padStart(2, "0") } })),
];

const cases = { "edge-cases": edge };
for (const [name, seed, n, size] of [["small-1", 1, 60, 20], ["small-2", 2, 150, 20], ["medium-3", 3, 800, 30], ["medium-4", 4, 1500, 30], ["large-5", 5, 2500, 8]]) {
	cases[name] = sampleLog(seed, n, { contentSize: size });
}
for (const [name, list] of Object.entries(cases)) {
	const events = JSON.parse(JSON.stringify(list)); // genau das, was Rust liest
	const index = new Map(events.map((ev, i) => [ev, i]));
	const kept = compactEvents(events).map((ev) => index.get(ev));
	const body = "{\n\"kept\": " + JSON.stringify(kept) + ",\n\"events\": [\n" + events.map((ev) => JSON.stringify(ev)).join(",\n") + "\n]}\n";
	fs.writeFileSync(path.join(dir, name + ".json"), body);
	console.log(`${name}: ${events.length} Events, ${kept.length} behalten`);
}

// Das Protokoll v4 (Wire-Format, Pakete, E2EE) hat kein JS-Original mehr: Der Rust-Kern ist die
// Referenz, tests/golden/protocol.json bleibt als eingefrorener Stand der letzten JS-Fassung.
process.exit(0);
