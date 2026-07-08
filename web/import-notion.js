"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { DB } from "./db.js";

// ---------- Notion-API Migration ----------
export const NOTION_MIGRATOR = (() => {
	// Abbrechen-Unterstützung: cancel() setzt das Flag, checkCancelled() wirft an
	// den nächsten Kontrollpunkten (Seiten-/Block-Schleifen) eine markierte Ausnahme.
	let cancelled = false;
	function cancel() { cancelled = true; }
	function checkCancelled() {
		if (cancelled) {
			const e = new Error("Abgebrochen");
			e.cancelled = true;
			throw e;
		}
	}

	async function req(token, path, opts) {
		// Drosselung: kurze Pause, um Notion API-Limits (3 Req/s) zu respektieren
		await new Promise((resolve) => setTimeout(resolve, 250));

		const url = (S.settings.corsProxy || "https://corsproxy.io/?") + encodeURIComponent("https://api.notion.com/v1" + path);

		for (let attempt = 0; attempt < 5; attempt++) {
			const res = await fetch(url, {
				method: (opts && opts.method) || "GET",
				headers: {
					"Authorization": "Bearer " + token,
					"Notion-Version": "2022-06-28",
					"Content-Type": "application/json",
				},
				body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
			});

			if (res.status === 429) {
				const retryAfter = Number(res.headers.get("Retry-After")) || 2;
				await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
				continue;
			}

			if (!res.ok) throw new Error("Notion-API Fehler " + res.status + ": " + (await res.text()).slice(0, 200));
			return res.json();
		}
		throw new Error("Notion-API Fehler: Zu viele Versuche nach Rate-Limit (429)");
	}

	// Rich-Text → Markdown: behält Fett/Kursiv/Code/Durchgestrichen/Links UND
	// Notion-Farben ({red}…{/} bzw. {bg-red}…{/} — die Syntax des Block-Editors)
	// sowie Inline-Formeln ($…$) bei.
	const NOTION_COLOR_MAP = { gray: "gray", brown: "orange", orange: "orange", yellow: "yellow", green: "green", blue: "blue", purple: "purple", pink: "pink", red: "red" };
	const plainText = (arr) => (arr || []).map((x) => (x.text ? x.text.content : x.plain_text || "")).join("");
	const parseRichText = (arr) => {
		if (!arr || !arr.length) return "";
		return arr.map((x) => {
			if (x.type === "equation" && x.equation) return "$" + (x.equation.expression || "") + "$";
			let text = x.text ? x.text.content : (x.plain_text || "");
			if (!text) return "";
			const ann = x.annotations || {};
			if (ann.code) text = "`" + text + "`";
			if (ann.bold) text = "**" + text + "**";
			if (ann.italic) text = "*" + text + "*";
			if (ann.strikethrough) text = "~~" + text + "~~";
			if (ann.underline) text = "<u>" + text + "</u>";
			let c = ann.color || "";
			if (c && c !== "default") {
				if (c.endsWith("_background")) {
					const bg = c.slice(0, -11);
					text = "{bg-" + (NOTION_COLOR_MAP[bg] || bg) + "}" + text + "{/}";
				} else {
					text = "{" + (NOTION_COLOR_MAP[c] || c) + "}" + text + "{/}";
				}
			}
			if (x.type === "text" && x.text && x.text.link) {
				const href = x.text.link.url || "";
				// notion.so-Links in lokale Raute-Links (#id) zurückübersetzen, falls gemappt
				const r = href.match(/^https?:\/\/(www\.)?notion\.so\/([0-9a-fA-F]{32})/);
				const l = r ? reverseMap()[normId(r[2])] : null;
				text = "[" + text + "](" + (l ? "#" + l : href) + ")";
			}
			return text;
		}).join("");
	};

	const normId = (s) => String(s || "").replace(/-/g, "").toLowerCase();

	// Liest die Notion-Struktur rekursiv ein — wir respektieren die Eltern-Kind-Beziehungen
	// exakt, um die Ordnerhierarchie lokal originalgetreu abzubilden.
	async function loadAllChildren(token, blockId) {
		const out = [];
		let cursor;
		for (let i = 0; i < 30; i++) {
			const path = "/blocks/" + blockId + "/children" + (cursor ? "?start_cursor=" + cursor : "");
			const data = await req(token, path);
			out.push(...(data.results || []));
			if (!data.has_more) break;
			cursor = data.next_cursor;
		}
		return out;
	}

	// Notion-Blöcke → lokales Markdown (mit Tabellen, Spalten, Toggles, etc.)
	async function blocksToMd(token, blocks, ctx) {
		const lines = [];
		for (let i = 0; i < blocks.length; i++) {
			checkCancelled();
			const b = blocks[i];
			const t = b.type;
			const body = b[t] || {};
			const rich = body.rich_text || [];

			if (t === "child_page" && ctx && ctx.onChildPage) { await ctx.onChildPage(b.id); continue; }
			if (t === "child_database" && ctx && ctx.onChildDb) { lines.push(await ctx.onChildDb(b.id, body.title)); continue; }

			if (t === "paragraph") lines.push(parseRichText(rich));
			else if (t.startsWith("heading_")) {
				const n = t.slice(8);
				lines.push("#".repeat(Number(n)) + " " + parseRichText(rich));
			} else if (t === "bulleted_list_item") {
				lines.push("- " + parseRichText(rich));
				if (b.has_children) {
					const kids = await loadAllChildren(token, b.id);
					const sub = await blocksToMd(token, kids, ctx);
					lines.push(...sub.split("\n").filter((l) => l.trim()).map((l) => "  " + l));
				}
			} else if (t === "numbered_list_item") {
				lines.push("1. " + parseRichText(rich));
				if (b.has_children) {
					const kids = await loadAllChildren(token, b.id);
					const sub = await blocksToMd(token, kids, ctx);
					lines.push(...sub.split("\n").filter((l) => l.trim()).map((l) => "  " + l));
				}
			} else if (t === "to_do") {
				lines.push("- [" + (body.checked ? "x" : " ") + "] " + parseRichText(rich));
				if (b.has_children) {
					const kids = await loadAllChildren(token, b.id);
					const sub = await blocksToMd(token, kids, ctx);
					lines.push(...sub.split("\n").filter((l) => l.trim()).map((l) => "  " + l));
				}
			} else if (t === "toggle") {
				const kids = b.has_children ? await loadAllChildren(token, b.id) : [];
				const sub = await blocksToMd(token, kids, ctx);
				lines.push("<details><summary>" + parseRichText(rich) + "</summary>\n" + sub + "\n</details>");
			} else if (t === "code") {
				lines.push("```" + (body.language || "text") + "\n" + plainText(rich) + "\n```");
			} else if (t === "equation" && body.expression) {
				lines.push("$$\n" + body.expression + "\n$$");
			} else if (t === "divider") {
				lines.push("---");
			} else if (t === "quote") {
				const txt = parseRichText(rich);
				if (b.has_children) {
					const kids = await loadAllChildren(token, b.id);
					const sub = await blocksToMd(token, kids, ctx);
					lines.push("> " + txt + "\n" + sub.split("\n").map((l) => "> " + l).join("\n"));
				} else {
					lines.push("> " + txt);
				}
			} else if (t === "callout") {
				const txt = parseRichText(rich);
				let icon = "";
				if (body.icon && body.icon.type === "emoji") icon = body.icon.emoji + " ";
				let color = "blue";
				const bg = (body.color || "").match(/^([a-z]+)_background$/);
				if (bg) color = bg[1];
				if (b.has_children) {
					const kids = await loadAllChildren(token, b.id);
					const sub = await blocksToMd(token, kids, ctx);
					lines.push("> [!" + color + "] " + icon + txt + "\n" + sub.split("\n").map((l) => "> " + l).join("\n"));
				} else {
					lines.push("> [!" + color + "] " + icon + txt);
				}
			} else if (t === "image" && body.type === "external") {
				lines.push("![Bild](" + (body.external.url || "") + ")");
			} else if (t === "image" && body.type === "file") {
				lines.push("![Bild](" + (body.file.url || "") + ")");
			} else if (t === "table" && b.has_children) {
				try {
					const rows = await loadAllChildren(token, b.id);
					const mdRows = [];
					for (const r of rows) {
						if (r.type !== "table_row") continue;
						const cells = (r.table_row || {}).cells || [];
						mdRows.push("| " + cells.map(parseRichText).join(" | ") + " |");
					}
					if (mdRows.length) {
						const width = (body.table_width || 1);
						const sep = "| " + Array.from({ length: width }, () => "---").join(" | ") + " |";
						mdRows.splice(body.has_column_header ? 1 : 0, 0, sep);
						lines.push(mdRows.join("\n"));
					}
				} catch (err) { console.warn("Tabelle konnte nicht gelesen werden", err); }
			} else if (t === "column_list" && b.has_children) {
				const cols = await loadAllChildren(token, b.id);
				const mdCols = [];
				for (const col of cols) {
					if (col.type !== "column" || !col.has_children) continue;
					const kids = await loadAllChildren(token, col.id);
					mdCols.push(await blocksToMd(token, kids, ctx));
				}
				if (mdCols.length) {
					lines.push(":::columns\n" + mdCols.join("\n:::split\n") + "\n:::end");
				}
			} else if (t === "file" && body.type === "external") {
				lines.push("📎 [Datei](" + (body.external.url || "") + ")");
			} else if (t === "file" && body.type === "file") {
				lines.push("📎 [Datei](" + (body.file.url || "") + ")");
			}
		}
		return lines.join("\n\n");
	}

	function titleAndIconOf(pgData) {
		const p = pgData.properties || {};
		const titleKey = Object.keys(p).find((k) => p[k].type === "title");
		const title = titleKey ? plainText(p[titleKey].title) : "Ohne Titel";
		const icon = pgData.icon && pgData.icon.type === "emoji" ? pgData.icon.emoji : null;
		return { title: title || "Ohne Titel", icon };
	}

	async function listRemotePages(token, onCount) {
		const out = [];
		let cursor;
		for (let i = 0; i < 30; i++) {
			const body = cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 };
			const data = await req(token, "/search", { method: "POST", body });
			const pages = (data.results || []).filter((x) => x.object === "page");
			out.push(...pages);
			if (onCount) onCount(out.length);
			if (!data.has_more) break;
			cursor = data.next_cursor;
		}
		return out;
	}

	async function remoteParentId(token, pgData) {
		const par = pgData.parent || {};
		if (par.type === "page_id") return normId(par.page_id);
		if (par.type === "database_id") {
			// Elternseite der Datenbank ermitteln — so landen Zeilen in derselben Hierarchie.
			try {
				const db = await req(token, "/databases/" + par.database_id);
				const dp = db.parent || {};
				if (dp.type === "page_id") return normId(dp.page_id);
			} catch {}
			return normId(par.database_id);
		}
		return null;
	}

	// Umkehr-Mapping: remote Notion-UUID → lokale Seiten-ID
	function reverseMap() {
		const rev = {};
		Object.entries(S.settings.notionMap || {}).forEach(([lid, nid]) => { rev[normId(nid)] = lid; });
		Object.keys(S.pages).forEach((id) => { if (/^[0-9a-f]{32}$/.test(id)) rev[id] = id; });
		return rev;
	}

	function localIdForRemote(remoteId, revMap) {
		const n = normId(remoteId);
		return revMap[n] || (S.pages[n] ? n : null);
	}

	// Sucht nach einer lokalen Seite, die denselben Titel UND Inhalt hat.
	// Verhindert, dass beim Erstimport lokal bestehende Seiten dupliziert werden.
	const normText = (s) => String(s || "").replace(/[\s\n\r#*-]/g, "").toLowerCase();
	function findMergeCandidate(title, content) {
		const t = normText(title);
		const c = normText(content);
		if (!t) return null;
		return Object.values(S.pages).find((pg) => !pg.trashed && !isLinked(pg) && normText(pg.title) === t && normText(pg.content) === c);
	}

	const isLinked = (pg) => /^[0-9a-f]{32}$/.test(pg.id) || !!(S.settings.notionMap && S.settings.notionMap[pg.id]);

	// Notion parent cache für Datenbank-Zeilen (Zeilen haben remote eine database_id,
	// sollen lokal aber direkt unter die Datenbank-Seite gehängt werden).
	const dbParentCache = {};

	async function pullRemotePage(token, pgData, ctx) {
		const nid = normId(pgData.id);
		const rev = ctx.rev || reverseMap();
		const { title, icon } = titleAndIconOf(pgData);

		// Ablageort exakt wie in Notion bestimmen
		let parentLocal = ctx.parentLocal;
		if (parentLocal === undefined) {
			const pnid = await remoteParentId(token, pgData);
			parentLocal = pnid ? localIdForRemote(pnid, rev) : null;
		}
		if (parentLocal && (!S.pages[parentLocal] || S.pages[parentLocal].trashed)) parentLocal = null;

		// Inhalt lesen; Unterseiten nur einsammeln (kommen einzeln dran). Datenbanken
		// landen als Markdown-Tabelle direkt in der Seite, und ihre Zeilen-Seiten
		// werden zusätzlich als Unterseiten importiert (über childPageIds).
		const children = await loadAllChildren(token, nid);
		const childPageIds = [];
		const childDbIds = [];
		const md = await blocksToMd(token, children, {
			onChildPage: async (childId) => { childPageIds.push(normId(childId)); },
			// Echte Datenbanken statt eingefrorener Markdown-Tabellen: eigene lokale
			// Datenbank-Seite (Schema in pg.db), jede Zeile eine Unterseite mit props.
			onChildDb: async (dbId, dbTitle) => {
				try {
					const dbn = normId(dbId);
					const db = await req(token, "/databases/" + dbId);
					const schema = Object.entries(db.properties || {}).map(([name, p]) => ({ name, type: p.type }));
					schema.sort((a, b) => (a.type === "title" ? -1 : 0) - (b.type === "title" ? -1 : 0));
					const dTitle = dbTitle || plainText(db.title) || "Datenbank";
					const dIcon = db.icon && db.icon.type === "emoji" ? db.icon.emoji : "🗃";
					dbParentCache[dbn] = dbn; // Zeilen gehören lokal UNTER die Datenbank-Seite
					childDbIds.push(dbn);
					if (!S.pages[dbn]) {
						await STATE.dispatch("pageCreate", { id: dbn, title: dTitle, content: "", workspaceId: S.currentWorkspaceId || "default", icon: dIcon, db: { schema } });
					} else {
						await STATE.dispatch("pageUpdate", { id: dbn, patch: { title: dTitle, icon: dIcon, db: { schema } } });
						if (S.pages[dbn].trashed) await STATE.dispatch("pageRestore", { id: dbn });
					}
					let cursor;
					for (let i = 0; i < 20; i++) {
						const body = cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 };
						const q = await req(token, "/databases/" + dbId + "/query", { method: "POST", body });
						for (const row of q.results || []) {
							checkCancelled();
							const rres = await pullRemotePage(token, row, { rev, merged: ctx.merged, parentLocal: dbn, restoreTrashed: true });
							for (const cid of rres.childPageIds) await importPageAndChildren(token, cid, rres.id, 0, { rev, visited: new Set([cid]) });
						}
						if (!q.has_more) break;
						cursor = q.next_cursor;
					}
					return "[🗃 " + dTitle + "](#" + dbn + ")\n\n";
				} catch (err) { console.warn("Datenbank " + dbId + " konnte nicht gelesen werden", err); return ""; }
			},
		});

		// Lokales Gegenstück: importiert (ID = Notion-UUID), gemappt — oder zusammenführen
		let id = localIdForRemote(nid, rev);
		if (!id) {
			const dupe = findMergeCandidate(title, md);
			if (dupe) {
				id = dupe.id;
				rev[nid] = id;
				const map = { ...(S.settings.notionMap || {}) };
				map[id] = nid;
				await STATE.dispatch("settingsSet", { notionMap: map });
				if (ctx.merged) ctx.merged.n++;
			}
		}
		if (id && S.pages[id] && S.pages[id].trashed && ctx.restoreTrashed) await STATE.dispatch("pageRestore", { id });

		// Workspace: vom Elternteil erben; Wurzelseiten behalten ihren bisherigen Workspace
		let wsId;
		if (parentLocal && S.pages[parentLocal]) wsId = S.pages[parentLocal].workspaceId || "default";
		else if (id && S.pages[id]) wsId = S.pages[id].workspaceId || "default";
		else wsId = S.currentWorkspaceId || "default";

		// Datenbank-Zeile? Dann alle Eigenschaften lesbar in props übernehmen —
		// sie füllen die editierbare Tabellen-Ansicht der lokalen Datenbank-Seite.
		let props = null;
		if ((pgData.parent || {}).type === "database_id") {
			props = {};
			for (const k of Object.keys(pgData.properties || {})) {
				if ((pgData.properties[k] || {}).type === "title") continue;
				props[k] = propToText(pgData.properties[k]);
			}
		}

		if (!id || !S.pages[id]) {
			id = nid;
			await STATE.dispatch("pageCreate", { id, title, parentId: parentLocal, content: md, workspaceId: wsId, icon, props });
		} else {
			const patch = { title, icon, content: md, workspaceId: wsId };
			if (props) patch.props = props;
			await STATE.dispatch("pageUpdate", { id, patch });
			// Verschieben separat über pageMove — dort greift der Zyklus-Schutz
			if ((S.pages[id].parentId || null) !== (parentLocal || null)) await STATE.dispatch("pageMove", { id, parentId: parentLocal });
		}
		// Datenbank-Seiten aus dem Inhalt unter diese Seite hängen (Ort wie in Notion)
		for (const dbLocal of childDbIds) {
			if (S.pages[dbLocal] && dbLocal !== id && (S.pages[dbLocal].parentId || null) !== id) await STATE.dispatch("pageMove", { id: dbLocal, parentId: id });
		}
		return { id, childPageIds };
	}

	async function importPageAndChildren(token, blockId, parentLocal, depth, opts) {
		checkCancelled();
		opts = opts || {};
		if ((depth || 0) > 20) return null;
		const pgData = await req(token, "/pages/" + blockId);
		const res = await pullRemotePage(token, pgData, {
			rev: opts.rev, merged: opts.merged, parentLocal, restoreTrashed: true,
		});
		if (opts.counter) {
			opts.counter.n++;
			if (opts.onStatus) opts.onStatus(opts.counter.n, (S.pages[res.id] || {}).title || "");
		}
		for (const cid of res.childPageIds) {
			if (opts.visited) {
				if (opts.visited.has(cid)) continue;
				opts.visited.add(cid);
			}
			await importPageAndChildren(token, cid, res.id, (depth || 0) + 1, opts);
		}
		return res.id;
	}

	async function mergeDuplicates() {
		let merged = 0;
		const groups = {};
		for (const pg of STATE.activePages()) {
			const t = normText(pg.title);
			if (!t) continue;
			const key = t.toLowerCase() + "" + normText(pg.content);
			(groups[key] = groups[key] || []).push(pg);
		}
		for (const key in groups) {
			const keeper = groups[key].find((pg) => isLinked(pg));
			if (!keeper) continue;
			for (const dupe of groups[key]) {
				if (dupe.id === keeper.id || isLinked(dupe)) continue;
				for (const child of Object.values(S.pages)) {
					if (child.parentId === dupe.id) await STATE.dispatch("pageMove", { id: child.id, parentId: keeper.id });
				}
				await STATE.dispatch("pageTrash", { id: dupe.id });
				merged++;
			}
		}
		return merged;
	}

	async function alignWorkspaces() {
		const visited = new Set();
		async function walk(pid, wsId) {
			for (const pg of Object.values(S.pages)) {
				if (pg.parentId !== pid || visited.has(pg.id)) continue;
				visited.add(pg.id);
				if ((pg.workspaceId || "default") !== wsId) await STATE.dispatch("pageUpdate", { id: pg.id, patch: { workspaceId: wsId } });
				await walk(pg.id, wsId);
			}
		}
		for (const pg of Object.values(S.pages)) {
			if (pg.parentId && S.pages[pg.parentId]) continue;
			visited.add(pg.id);
			await walk(pg.id, pg.workspaceId || "default");
		}
	}

	// ---------- Push: lokales Markdown → Notion-Blöcke ----------
	const rt = (text) => {
		const s = String(text == null ? "" : text);
		const out = [];
		for (let i = 0; i < s.length && out.length < 90; i += 1900) out.push({ type: "text", text: { content: s.slice(i, i + 1900) } });
		return out.length ? out : [{ type: "text", text: { content: "" } }];
	};

	const REV_COLOR = { gray: "gray", brown: "brown", orange: "orange", yellow: "yellow", green: "green", blue: "blue", purple: "purple", pink: "pink", red: "red" };
	function mdRichText(text) {
		const out = [];
		const push = (content, ann, href) => {
			if (!content) return;
			for (let i = 0; i < content.length && out.length < 95; i += 1900) {
				const seg = { type: "text", text: { content: content.slice(i, i + 1900) } };
				if (href) seg.text.link = { url: href };
				if (ann && Object.keys(ann).length) seg.annotations = { ...ann };
				out.push(seg);
			}
		};
		const RE = /(\*\*([\s\S]+?)\*\*)|(~~([\s\S]+?)~~)|(`([^`]+)`)|(==([^=\n]+)==)|(\{(bg-)?([a-z]+)\}([\s\S]*?)\{\/\})|(\$([^$\n]+)\$)|(!?\[([^\]]*)\]\(([^)\s]+)\))|(\*([^*\n]+)\*)|(<u>([\s\S]+?)<\/u>)/;
		const walk = (s, ann) => {
			let m;
			while (s && (m = RE.exec(s))) {
				if (m.index > 0) push(s.slice(0, m.index), ann);
				if (m[1]) walk(m[2], { ...ann, bold: true });
				else if (m[3]) walk(m[4], { ...ann, strikethrough: true });
				else if (m[5]) push(m[6], { ...ann, code: true });
				else if (m[7]) push(m[8], { ...ann, color: "yellow_background" });
				else if (m[9]) {
					const base = REV_COLOR[m[11]];
					walk(m[12], base ? { ...ann, color: m[10] ? base + "_background" : base } : { ...ann });
				} else if (m[13] && out.length < 95) out.push({ type: "equation", equation: { expression: m[14] } });
				else if (m[15]) {
					let href = /^(https?:|mailto:)/.test(m[17]) ? m[17] : null;
					const loc = m[17].match(/^#([0-9a-fA-F-]{32,36})$/);
					const lnid = loc ? (notionIdOf(loc[1]) || notionIdOf(loc[1].replace(/-/g, ""))) : null;
					if (lnid) href = "https://www.notion.so/" + lnid;
					push(m[16] || m[17], ann, href);
				}
				else if (m[18]) walk(m[19], { ...ann, italic: true });
				else if (m[20]) walk(m[21], { ...ann, underline: true });
				s = s.slice(m.index + m[0].length);
			}
			if (s) push(s, ann);
		};
		walk(String(text == null ? "" : text), {});
		return out.length ? out : [{ type: "text", text: { content: "" } }];
	}

	const LANG_ALIAS = { js: "javascript", ts: "typescript", py: "python", sh: "bash", yml: "yaml", text: "plain text", txt: "plain text", plaintext: "plain text", cpp: "c++", cs: "c#", md: "markdown" };
	const NOTION_LANGS = new Set(["abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript", "c++", "c#", "css", "dart", "diff", "docker", "elixir", "elm", "erlang", "flow", "fortran", "f#", "gherkin", "glsl", "go", "graphql", "groovy", "haskell", "html", "java", "javascript", "json", "julia", "kotlin", "latex", "less", "lisp", "livescript", "lua", "makefile", "markdown", "markup", "matlab", "mermaid", "nix", "objective-c", "ocaml", "pascal", "perl", "php", "plain text", "powershell", "prolog", "protobuf", "python", "r", "reason", "ruby", "rust", "sass", "scala", "scheme", "scss", "shell", "sql", "swift", "typescript", "vb.net", "verilog", "vhdl", "visual basic", "webassembly", "xml", "yaml"]);
	const notionLang = (lang) => {
		const l = (lang || "").toLowerCase();
		return NOTION_LANGS.has(l) ? l : LANG_ALIAS[l] || "plain text";
	};

	const LIST_RE = /^(\s*)(- \[( |x)\] |- |\d+\. )(.*)$/;
	function listRun(lines, start, blocks) {
		let i = start;
		const stack = [{ children: blocks, depth: -1 }];
		while (i < lines.length) {
			const m = lines[i].match(LIST_RE);
			if (!m) break;
			const depth = Math.floor(m[1].replace(/\t/g, "  ").length / 2);
			const blk = m[2].startsWith("- [")
				? { type: "to_do", to_do: { checked: m[3] === "x", rich_text: mdRichText(m[4]) } }
				: m[2] === "- "
					? { type: "bulleted_list_item", bulleted_list_item: { rich_text: mdRichText(m[4]) } }
					: { type: "numbered_list_item", numbered_list_item: { rich_text: mdRichText(m[4]) } };
			while (stack.length > 1 && depth <= stack[stack.length - 1].depth) stack.pop();
			const top = stack[stack.length - 1];
			if (top.blk) (top.blk[top.blk.type].children = top.blk[top.blk.type].children || []).push(blk);
			else top.children.push(blk);
			stack.push({ blk, depth });
			i++;
		}
		return i;
	}

	function linesToBlocks(lines) {
		const blocks = [];
		let i = 0;
		while (i < lines.length) {
			const line = lines[i];
			const t = line.trim();
			if (t.startsWith("```")) {
				const lang = t.slice(3).trim();
				const body = [];
				i++;
				while (i < lines.length && !lines[i].trim().startsWith("```")) { body.push(lines[i]); i++; }
				i++;
				blocks.push({ type: "code", code: { language: notionLang(lang), rich_text: [{ type: "text", text: { content: body.join("\n").slice(0, 1900) } }] } });
				continue;
			}
			if (t.startsWith("$$")) {
				let expr = t.slice(2);
				if (expr.endsWith("$$")) expr = expr.slice(0, -2);
				else { i++; while (i < lines.length && !lines[i].trim().endsWith("$$")) { expr += "\n" + lines[i]; i++; } if (i < lines.length) expr += "\n" + lines[i].trim().slice(0, -2); }
				blocks.push({ type: "equation", equation: { expression: expr.trim() } });
				i++;
				continue;
			}
			if (t === ":::columns") {
				const cols = [[]];
				i++;
				let nest = 0;
				while (i < lines.length) {
					const c = lines[i].trim();
					if (c === ":::columns") nest++;
					if (c === ":::end" && nest === 0) break;
					if (c === ":::end") nest--;
					if (c === ":::split" && nest === 0) cols.push([]);
					else cols[cols.length - 1].push(lines[i]);
					i++;
				}
				i++;
				blocks.push({ type: "column_list", column_list: { children: cols.map((c) => ({ type: "column", column: { children: linesToBlocks(c) } })) } });
				continue;
			}
			if (t.startsWith("<details>")) {
				const sm = t.match(/<summary>([\s\S]*?)<\/summary>/);
				const body = [];
				i++;
				while (i < lines.length && !lines[i].trim().startsWith("</details>")) { body.push(lines[i]); i++; }
				i++;
				blocks.push({ type: "toggle", toggle: { rich_text: mdRichText(sm ? sm[1] : "Toggle"), children: linesToBlocks(body) } });
				continue;
			}
			if (t.startsWith("|") && t.endsWith("|")) {
				const rows = [];
				while (i < lines.length) {
					const r = lines[i].trim();
					if (!(r.startsWith("|") && r.endsWith("|"))) break;
					const cells = r.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
					if (!cells.every((c) => /^:?-{3,}:?$/.test(c))) rows.push(cells);
					i++;
				}
				const width = Math.max(1, ...rows.map((r) => r.length));
				blocks.push({ type: "table", table: { table_width: width, has_column_header: rows.length > 1, has_row_header: false, children: rows.map((r) => ({ type: "table_row", table_row: { cells: Array.from({ length: width }, (_, ci) => mdRichText(r[ci] || "")) } })) } });
				continue;
			}
			if (LIST_RE.test(line) && t) { i = listRun(lines, i, blocks); continue; }
			if (!t) { i++; continue; }
			const img = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
			if (img) {
				if (/^https?:\/\//.test(img[2])) blocks.push({ type: "image", image: { type: "external", external: { url: img[2] } } });
				else blocks.push({ type: "paragraph", paragraph: { rich_text: mdRichText("\ud83d\uddbc *" + (img[1] || "Bild") + "* (lokales Bild — Notions API erlaubt keinen Datei-Upload)") } });
				i++;
				continue;
			}
			const co = t.match(/^> \[!([a-z]+)\] ?([\s\S]*)$/);
			if (co) {
				const cont = [];
				i++;
				while (i < lines.length && /^>(\s|$)/.test(lines[i].trim()) && !/^> \[!/.test(lines[i].trim())) {
					cont.push(lines[i].trim().replace(/^>\s?/, ""));
					i++;
				}
				let txt = co[2];
				let icon = "\ud83d\udca1";
				const em = txt.match(/^(\p{Extended_Pictographic}️?)\s+/u);
				if (em) { icon = em[1]; txt = txt.slice(em[0].length); }
				const base = REV_COLOR[co[1]] || "blue";
				const cob = { type: "callout", callout: { icon: { type: "emoji", emoji: icon }, color: base + "_background", rich_text: mdRichText(txt) } };
				if (cont.filter((l) => l.trim()).length) cob.callout.children = linesToBlocks(cont);
				blocks.push(cob);
				continue;
			}
			if (t.startsWith(">")) {
				const cont = [];
				i++;
				while (i < lines.length && /^>(\s|$)/.test(lines[i].trim()) && !/^> \[!/.test(lines[i].trim())) {
					cont.push(lines[i].trim().replace(/^>\s?/, ""));
					i++;
				}
				const qb = { type: "quote", quote: { rich_text: mdRichText(t.replace(/^>\s?/, "")) } };
				if (cont.filter((l) => l.trim()).length) qb.quote.children = linesToBlocks(cont);
				blocks.push(qb);
				continue;
			}
			if (t.startsWith("### ")) blocks.push({ type: "heading_3", heading_3: { rich_text: mdRichText(t.slice(4)) } });
			else if (t.startsWith("## ")) blocks.push({ type: "heading_2", heading_2: { rich_text: mdRichText(t.slice(3)) } });
			else if (t.startsWith("# ")) blocks.push({ type: "heading_1", heading_1: { rich_text: mdRichText(t.slice(2)) } });
			else if (/^(-{3,}|\*{3,})$/.test(t)) blocks.push({ type: "divider", divider: {} });
			else blocks.push({ type: "paragraph", paragraph: { rich_text: mdRichText(t) } });
			i++;
		}
		return blocks;
	}

	function clampChildren(blocks, level) {
		const out = [];
		for (const b of blocks) {
			out.push(b);
			const body = b[b.type];
			if (!body || !Array.isArray(body.children) || b.type === "table" || b.type === "column_list") continue;
			if (level >= 1) { out.push(...clampChildren(body.children, level)); delete body.children; }
			else body.children = clampChildren(body.children, level + 1);
		}
		return out;
	}

	function mdToBlocks(md) {
		return linesToBlocks(String(md || "").replace(/\r/g, "").split("\n"));
	}

	async function appendBlocks(token, notionId, blocks) {
		blocks = clampChildren(blocks, 0);
		for (let i = 0; i < blocks.length; i += 90) {
			checkCancelled();
			await req(token, "/blocks/" + notionId + "/children", { method: "PATCH", body: { children: blocks.slice(i, i + 90) } });
		}
	}

	function notionIdOf(localId) {
		if (/^[0-9a-f]{32}$/.test(localId)) return localId;
		return (S.settings.notionMap || {})[localId] || null;
	}

	function propsToNotion(pg) {
		const parent = pg.parentId ? S.pages[pg.parentId] : null;
		const schema = parent && parent.db && parent.db.schema;
		if (!schema || !pg.props) return null;
		const out = {};
		for (const col of schema) {
			if (col.type === "title" || !(col.name in pg.props)) continue;
			const v = String(pg.props[col.name] == null ? "" : pg.props[col.name]).trim();
			const t = col.type;
			if (t === "rich_text") out[col.name] = { rich_text: v ? mdRichText(v) : [] };
			else if (t === "number") { const n = parseFloat(v.replace(",", ".")); out[col.name] = { number: isNaN(n) ? null : n }; }
			else if (t === "select") out[col.name] = { select: v ? { name: v } : null };
			else if (t === "status") { if (v) out[col.name] = { status: { name: v } }; }
			else if (t === "multi_select") out[col.name] = { multi_select: v ? v.split(",").map((s) => ({ name: s.trim() })).filter((o) => o.name) : [] };
			else if (t === "checkbox") out[col.name] = { checkbox: /^(✅|✔|x|ja|true|1)$/i.test(v) };
			else if (t === "url") out[col.name] = { url: v || null };
			else if (t === "email") out[col.name] = { email: v || null };
			else if (t === "phone_number") out[col.name] = { phone_number: v || null };
			else if (t === "date") {
				const parts = v.split("→").map((s) => s.trim()).filter(Boolean);
				out[col.name] = { date: parts.length ? { start: parts[0], end: parts[1] || null } : null };
			}
		}
		return Object.keys(out).length ? out : null;
	}

	async function pushPage(token, pg, notionId) {
		await req(token, "/pages/" + notionId, { method: "PATCH", body: {
			properties: { title: { title: rt(pg.title) }, ...(propsToNotion(pg) || {}) },
			icon: pg.icon ? { type: "emoji", emoji: pg.icon } : undefined,
		} });
		const children = await loadAllChildren(token, notionId);
		for (const b of children) {
			if (b.type === "child_page" || b.type === "child_database") continue;
			await req(token, "/blocks/" + b.id, { method: "DELETE" });
		}
		await appendBlocks(token, notionId, mdToBlocks(pg.content));
	}

	async function createRemote(token, pg, parentNotionId) {
		const blocks = clampChildren(mdToBlocks(pg.content), 0);
		const parentPg = pg.parentId ? S.pages[pg.parentId] : null;
		const isDbRow = !!(parentPg && parentPg.db);
		const data = await req(token, "/pages", { method: "POST", body: {
			parent: isDbRow ? { database_id: parentNotionId } : { page_id: parentNotionId },
			icon: pg.icon ? { type: "emoji", emoji: pg.icon } : undefined,
			properties: { title: { title: rt(pg.title) }, ...(propsToNotion(pg) || {}) },
			children: blocks.slice(0, 90),
		} });
		const newId = (data.id || "").replace(/-/g, "");
		if (newId && blocks.length > 90) await appendBlocks(token, newId, blocks.slice(90));
		return newId;
	}

	// Hilfsfunktion zur Typkonvertierung von Notion Properties für die Datenbank
	function propToText(prop) {
		if (!prop) return "";
		const t = prop.type;
		if (t === "rich_text") return plainText(prop.rich_text);
		if (t === "number") return prop.number != null ? String(prop.number) : "";
		if (t === "select") return prop.select ? prop.select.name || "" : "";
		if (t === "status") return prop.status ? prop.status.name || "" : "";
		if (t === "multi_select") return (prop.multi_select || []).map((x) => x.name || "").join(", ");
		if (t === "checkbox") return prop.checkbox ? "✅" : "❌";
		if (t === "url") return prop.url || "";
		if (t === "email") return prop.email || "";
		if (t === "phone_number") return prop.phone_number || "";
		if (t === "date" && prop.date) {
			const d = prop.date;
			return d.start + (d.end ? " → " + d.end : "");
		}
		return "";
	}

	return {
		cancel,
		async migrate(token, pageId, onStatus) {
			cancelled = false;
			const rev = reverseMap();
			const merged = { n: 0 };
			const counter = { n: 0 };
			const reportProgress = (n, title) => { if (onStatus) onStatus("Importiere (" + n + " Seiten bisher) — zuletzt „" + title + "“…", null); };
			if (pageId) {
				if (onStatus) onStatus("Lese Notion-Seite…", null);
				const rootId = await importPageAndChildren(token, pageId, undefined, 0, {
					rev, merged, counter, visited: new Set([normId(pageId)]), onStatus: reportProgress,
				});
				await alignWorkspaces();
				await mergeDuplicates();
				return rootId;
			}
			if (onStatus) onStatus("Suche freigegebene Notion-Seiten…", null);
			const remote = await listRemotePages(token, (n) => { if (onStatus) onStatus("Suche freigegebene Notion-Seiten… (" + n + ")", null); });
			if (!remote.length) throw new Error("Keine freigegebenen Seiten gefunden. Teile Seiten in Notion zuerst mit deiner Integration.");
			const byId = {};
			remote.forEach((r) => { byId[normId(r.id)] = r; });
			const order = [];
			const seen = new Set();
			async function addInOrder(r) {
				const nid = normId(r.id);
				if (seen.has(nid)) return;
				seen.add(nid);
				const pnid = await remoteParentId(token, r);
				if (pnid && byId[pnid]) await addInOrder(byId[pnid]);
				order.push(r);
			}
			for (const r of remote) await addInOrder(r);
			let lastId = null;
			const visited = new Set(order.map((r) => normId(r.id)));
			for (let i = 0; i < order.length; i++) {
				checkCancelled();
				const { title } = titleAndIconOf(order[i]);
				if (onStatus) onStatus("Importiere " + (i + 1) + "/" + order.length + " — „" + title + "“…", (i + 1) / order.length);
				const res = await pullRemotePage(token, order[i], { rev, merged, restoreTrashed: true });
				lastId = res.id;
				for (const cid of res.childPageIds) {
					if (visited.has(cid)) continue;
					visited.add(cid);
					await importPageAndChildren(token, cid, res.id, 0, { rev, merged, counter, visited, onStatus: reportProgress });
				}
			}
			await alignWorkspaces();
			await mergeDuplicates();
			return lastId;
		},

		async sync(token, rootPageId, onStatus) {
			cancelled = false;
			const say = (s, f) => { if (onStatus) onStatus(s, f); };
			const rev = reverseMap();
			const mergedCounter = { n: 0 };
			const meta = { ...(S.settings.notionMeta || {}) };
			say("Lese Notion-Seiten…", null);
			const remote = await listRemotePages(token, (n) => say("Lese Notion-Seiten… (" + n + ")", null));
			const remoteById = {};
			remote.forEach((r) => { remoteById[normId(r.id)] = r; });
			let pulled = 0, pushed = 0, created = 0;

			const order = [];
			const seen = new Set();
			async function addInOrder(r) {
				const nid = normId(r.id);
				if (seen.has(nid)) return;
				seen.add(nid);
				const pnid = await remoteParentId(token, r);
				if (pnid && remoteById[pnid]) await addInOrder(remoteById[pnid]);
				order.push(r);
			}
			for (const r of remote) await addInOrder(r);

			for (let i = 0; i < order.length; i++) {
				checkCancelled();
				const r = order[i];
				const nid = normId(r.id);
				const redit = r.last_edited_time || "";
				const localId = localIdForRemote(nid, rev);
				const localPg = localId ? S.pages[localId] : null;
				if (localPg && localPg.trashed) continue;
				const m = meta[nid];
				if (!localPg && localId && m) continue;
				const remoteChanged = !m || redit > (m.r || "");
				const localChanged = !!localPg && (!m || (localPg.updated || "") > (m.l || ""));
				if (!localPg || (remoteChanged && (!localChanged || redit >= (localPg.updated || "")))) {
					say("⬇ Übernehme " + (i + 1) + "/" + order.length + "…", (i + 1) / (order.length + 1) * 0.5);
					const res = await pullRemotePage(token, r, { rev, merged: mergedCounter });
					meta[nid] = { r: redit, l: (S.pages[res.id] || {}).updated || "" };
					pulled++;
					for (const cid of res.childPageIds) {
						if (remoteById[cid] || localIdForRemote(cid, rev)) continue;
						await importPageAndChildren(token, cid, res.id, 0, { rev, merged: mergedCounter, visited: new Set([cid]) });
					}
				}
			}
			await alignWorkspaces();

			const activeById = {};
			STATE.activePages().forEach((pg) => { activeById[pg.id] = pg; });
			const localOrder = [];
			const lseen = new Set();
			const addLocal = (pg) => {
				if (lseen.has(pg.id)) return;
				lseen.add(pg.id);
				if (pg.parentId && activeById[pg.parentId]) addLocal(activeById[pg.parentId]);
				localOrder.push(pg);
			};
			Object.values(activeById).forEach(addLocal);
			const mapPatch = { ...(S.settings.notionMap || {}) };
			const nidOf = (localId) => (/^[0-9a-f]{32}$/.test(localId) ? localId : mapPatch[localId] || null);
			for (let i = 0; i < localOrder.length; i++) {
				checkCancelled();
				const pg = localOrder[i];
				say("⬆ Prüfe " + (i + 1) + "/" + localOrder.length + "…", 0.5 + (i + 1) / (localOrder.length + 1) * 0.5);
				const nid = nidOf(pg.id);
				if (nid && remoteById[nid]) {
					const m = meta[nid];
					const redit = remoteById[nid].last_edited_time || "";
					const localChanged = !m || (pg.updated || "") > (m.l || "");
					const remoteNewer = redit > (pg.updated || "");
					if (localChanged && !remoteNewer) {
						await pushPage(token, pg, nid);
						const fresh = await req(token, "/pages/" + nid);
						meta[nid] = { r: fresh.last_edited_time || redit, l: pg.updated || "" };
						pushed++;
					} else if (!m) {
						meta[nid] = { r: redit, l: pg.updated || "" };
					}
				} else if (!nid) {
					const parentNid = pg.parentId ? nidOf(pg.parentId) : null;
					const target = parentNid || (rootPageId ? normId(rootPageId) : "");
					if (!target) continue;
					const newId = await createRemote(token, pg, target);
					if (newId) {
						mapPatch[pg.id] = newId;
						rev[newId] = pg.id;
						const fresh = await req(token, "/pages/" + newId);
						meta[newId] = { r: fresh.last_edited_time || "", l: pg.updated || "" };
						created++;
					}
				}
			}

			await STATE.dispatch("settingsSet", { notionMap: mapPatch, notionMeta: meta });
			const mergedTrash = await mergeDuplicates();
			await STATE.dispatch("settingsSet", { notionLastSync: U.now() });
			return { pulled, pushed, created, merged: mergedCounter.n + mergedTrash };
		},
	};
})();
