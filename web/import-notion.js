"use strict";

import { S, STATE } from "./state.js";
import { U } from "./util.js";
import { DB } from "./db.js";

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
			const col = ann.color || "default";
			if (col !== "default") {
				const base = NOTION_COLOR_MAP[col.replace("_background", "")];
				if (base) text = "{" + (col.endsWith("_background") ? "bg-" : "") + base + "}" + text + "{/}";
			}
			if (x.href) {
				const nm = String(x.href).match(/notion\.so\/(?:[^/?#]*-)?([0-9a-f]{32})/);
				const loc = nm ? localIdForRemote(nm[1]) : null;
				text = "[" + text + "](" + (loc ? "#" + loc : x.href) + ")";
			}
			return text;
		}).join("");
	};

	async function loadAllChildren(token, blockId) {
		let results = [];
		let cursor;
		for (let i = 0; i < 50; i++) {
			const qs = cursor ? "?start_cursor=" + cursor + "&page_size=100" : "?page_size=100";
			const data = await req(token, "/blocks/" + blockId + "/children" + qs);
			results = results.concat(data.results || []);
			if (!data.has_more) break;
			cursor = data.next_cursor;
		}
		return results;
	}

	const normId = (id) => String(id || "").replace(/-/g, "");
	const normText = (s) => String(s || "").replace(/\r/g, "").trim();

	function reverseMap() {
		const rev = {};
		const map = S.settings.notionMap || {};
		for (const localId in map) rev[map[localId]] = localId;
		return rev;
	}

	function localIdForRemote(nid, rev) {
		if (S.pages[nid]) return nid;
		return (rev || reverseMap())[nid] || null;
	}

	const isLinked = (pg) => /^[0-9a-f]{32}$/.test(pg.id) || !!(S.settings.notionMap || {})[pg.id];

	function findMergeCandidate(title, content) {
		const t = normText(title).toLowerCase();
		if (!t) return null;
		const cands = STATE.activePages().filter((pg) => !isLinked(pg) && normText(pg.title).toLowerCase() === t);
		if (!cands.length) return null;
		const c = normText(content);
		const exact = cands.filter((pg) => normText(pg.content) === c);
		if (exact.length) return exact[0];
		const nearly = cands.filter((pg) => !normText(pg.content) || !c);
		return nearly.length === 1 ? nearly[0] : null;
	}

	async function listRemotePages(token, onPage) {
		let results = [];
		let cursor;
		for (let i = 0; i < 100; i++) {
			checkCancelled();
			const body = { filter: { property: "object", value: "page" }, page_size: 100 };
			if (cursor) body.start_cursor = cursor;
			const data = await req(token, "/search", { method: "POST", body });
			results = results.concat(data.results || []);
			if (onPage) onPage(results.length);
			if (!data.has_more) break;
			cursor = data.next_cursor;
		}
		return results.filter((r) => !r.archived && !r.in_trash);
	}

	const dbParentCache = {};
	async function remoteParentId(token, pgData) {
		const par = pgData.parent || {};
		if (par.type === "page_id") return normId(par.page_id);
		if (par.type === "database_id") {
			const dbid = normId(par.database_id);
			if (!(dbid in dbParentCache)) {
				try {
					const db = await req(token, "/databases/" + par.database_id);
					dbParentCache[dbid] = (db.parent && db.parent.type === "page_id") ? normId(db.parent.page_id) : null;
				} catch { dbParentCache[dbid] = null; }
			}
			return dbParentCache[dbid];
		}
		return null;
	}

	function titleAndIconOf(pgData) {
		let title = "Importierte Seite";
		let icon = null;
		if (pgData.properties) {
			const tProp = Object.values(pgData.properties).find((p) => p.type === "title");
			if (tProp && tProp.title && tProp.title.length) title = parseRichText(tProp.title);
		}
		if (pgData.icon && pgData.icon.type === "emoji") icon = pgData.icon.emoji;
		return { title, icon };
	}

	function propToText(p) {
		if (!p) return "";
		const t = p.type;
		if (t === "title") return parseRichText(p.title);
		if (t === "rich_text") return parseRichText(p.rich_text);
		if (t === "select") return p.select ? p.select.name : "";
		if (t === "multi_select") return (p.multi_select || []).map((o) => o.name).join(", ");
		if (t === "status") return p.status ? p.status.name : "";
		if (t === "date") return p.date ? p.date.start + (p.date.end ? " → " + p.date.end : "") : "";
		if (t === "number") return p.number == null ? "" : String(p.number);
		if (t === "checkbox") return p.checkbox ? "✅" : "◻";
		if (t === "url") return p.url || "";
		if (t === "email") return p.email || "";
		if (t === "phone_number") return p.phone_number || "";
		if (t === "people") return (p.people || []).map((u) => u.name || "?").join(", ");
		if (t === "formula") {
			const f = p.formula || {};
			return f.type === "string" ? (f.string || "") : f.type === "number" ? (f.number == null ? "" : String(f.number)) : f.type === "boolean" ? (f.boolean ? "✅" : "◻") : (f.date ? f.date.start : "");
		}
		if (t === "created_time") return U.fmtDate(p.created_time);
		if (t === "last_edited_time") return U.fmtDate(p.last_edited_time);
		return "";
	}

	function dbToMdTable(title, rows) {
		const head = title ? "**🗃 " + title + "**\n\n" : "";
		if (!rows.length) return head;
		const cols = [];
		rows.forEach((r) => Object.keys(r.properties || {}).forEach((k) => { if (!cols.includes(k)) cols.push(k); }));
		cols.sort((a, b) => ((((rows[0].properties || {})[a] || {}).type === "title") ? -1 : 0) - ((((rows[0].properties || {})[b] || {}).type === "title") ? -1 : 0));
		const esc = (s) => String(s || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
		let md = head + "| " + cols.map(esc).join(" | ") + " |\n| " + cols.map(() => "---").join(" | ") + " |\n";
		rows.forEach((r) => { md += "| " + cols.map((c) => esc(propToText((r.properties || {})[c]))).join(" | ") + " |\n"; });
		return md + "\n";
	}

	async function blocksToMd(token, children, ctx) {
		ctx = ctx || {};
		const depth = ctx.depth || 0;
		if (depth > 12) return "";
		const ind = ctx.indent || 0;
		const pad = "  ".repeat(ind);
		const inner = async (b, addIndent) => {
			if (!b.has_children) return "";
			const kids = await loadAllChildren(token, b.id);
			return blocksToMd(token, kids, { ...ctx, depth: depth + 1, indent: ind + (addIndent ? 1 : 0) });
		};
		let md = "";
		for (const b of children) {
			checkCancelled();
			const type = b.type;
			const d = b[type] || {};
			if (type === "paragraph") {
				md += pad + parseRichText(d.rich_text) + "\n\n";
				if (b.has_children) md += await inner(b, true);
			} else if (type === "heading_1" || type === "heading_2" || type === "heading_3") {
				md += pad + "#".repeat(Number(type.slice(-1))) + " " + parseRichText(d.rich_text) + "\n\n";
				if (b.has_children) md += await inner(b, false);
			} else if (type === "bulleted_list_item") {
				md += pad + "- " + parseRichText(d.rich_text) + "\n" + (await inner(b, true));
			} else if (type === "numbered_list_item") {
				md += pad + "1. " + parseRichText(d.rich_text) + "\n" + (await inner(b, true));
			} else if (type === "to_do") {
				md += pad + "- [" + (d.checked ? "x" : " ") + "] " + parseRichText(d.rich_text) + "\n" + (await inner(b, true));
			} else if (type === "code") {
				md += pad + "```" + (d.language === "plain text" ? "" : d.language || "") + "\n" + plainText(d.rich_text) + "\n```\n\n";
			} else if (type === "equation") {
				md += pad + "$$" + (d.expression || "") + "$$\n\n";
			} else if (type === "quote") {
				let q = parseRichText(d.rich_text);
				if (b.has_children) {
					const body = (await blocksToMd(token, await loadAllChildren(token, b.id), { ...ctx, depth: depth + 1, indent: 0 })).trim();
					if (body) q += "\n" + body;
				}
				md += q.split("\n").map((l) => pad + "> " + l).join("\n") + "\n\n";
			} else if (type === "divider") {
				md += pad + "---\n\n";
			} else if (type === "callout") {
				const col = NOTION_COLOR_MAP[(d.color || "default").replace("_background", "")] || "blue";
				const icon = d.icon && d.icon.type === "emoji" ? d.icon.emoji + " " : "";
				let body = icon + parseRichText(d.rich_text);
				if (b.has_children) {
					const kids = (await blocksToMd(token, await loadAllChildren(token, b.id), { ...ctx, depth: depth + 1, indent: 0 })).trim();
					if (kids) body += "\n" + kids;
				}
				const cl = body.split("\n");
				md += pad + "> [!" + col + "] " + cl[0] + "\n" + cl.slice(1).map((l) => pad + "> " + l).join("\n") + (cl.length > 1 ? "\n" : "") + "\n";
			} else if (type === "toggle") {
				const body = b.has_children ? (await inner(b, false)).trim() : "";
				md += pad + "<details><summary>" + parseRichText(d.rich_text) + "</summary>\n" + (body ? body + "\n" : "") + "</details>\n\n";
			} else if (type === "column_list") {
				const cols = (await loadAllChildren(token, b.id)).filter((c) => c.type === "column");
				const parts = [];
				for (const col of cols) {
					parts.push(col.has_children ? (await blocksToMd(token, await loadAllChildren(token, col.id), { ...ctx, depth: depth + 1, indent: 0 })).trim() : "");
				}
				md += ":::columns\n" + parts.join("\n:::split\n") + "\n:::end\n\n";
			} else if (type === "table") {
				const rows = (await loadAllChildren(token, b.id)).filter((r) => r.type === "table_row");
				if (rows.length) {
					const cells = rows.map((r) => (r.table_row.cells || []).map((c) => parseRichText(c).replace(/\|/g, "\\|").replace(/\n/g, " ")));
					const width = Math.max(...cells.map((r) => r.length), 1);
					const line = (r) => "| " + Array.from({ length: width }, (_, i) => r[i] || "").join(" | ") + " |";
					md += line(cells[0]) + "\n| " + Array.from({ length: width }, () => "---").join(" | ") + " |\n" + (cells.length > 1 ? cells.slice(1).map(line).join("\n") + "\n" : "") + "\n";
				}
			} else if (type === "image") {
				const src = d.type === "external" ? (d.external || {}).url : (d.file || {}).url;
				if (src) md += pad + "![" + (plainText(d.caption) || "Bild").replace(/[\[\]]/g, "") + "](" + src + ")\n\n";
			} else if (type === "bookmark" || type === "embed" || type === "video" || type === "file" || type === "pdf" || type === "link_preview") {
				const url = d.url || (d.external || {}).url || (d.file || {}).url || "";
				if (url) md += pad + "[" + (plainText(d.caption) || d.name || url) + "](" + url + ")\n\n";
			} else if (type === "child_page") {
				if (ctx.onChildPage) await ctx.onChildPage(b.id);
			} else if (type === "child_database") {
				if (ctx.onChildDb) {
					const tbl = await ctx.onChildDb(b.id, d.title || "");
					if (tbl) md += tbl;
				}
			} else if (type === "synced_block" || type === "template") {
				if (b.has_children) md += await inner(b, false);
			} else if (type === "table_of_contents" || type === "breadcrumb") {
				// rein visuelle Blöcke — bewusst überspringen
			} else if (b.has_children) {
				md += await inner(b, false);
			}
		}
		return depth === 0 ? md.trim() : md;
	}

	// Importiert/aktualisiert GENAU EINE Notion-Seite lokal: Titel, Icon, Inhalt und den
	// exakt richtigen Ort (Elternseite wie in Notion). Existiert lokal bereits eine exakt
	// gleiche, noch nicht zugeordnete Seite, wird sie zusammengeführt statt dupliziert —
	// und dabei an den richtigen Ort verschoben. ctx.parentLocal === undefined bedeutet:
	// Ablageort aus den Notion-Daten der Seite selbst auflösen.
	async function pullRemotePage(token, pgData, ctx) {
		checkCancelled();
		ctx = ctx || {};
		const rev = ctx.rev || reverseMap();
		const nid = normId(pgData.id);
		const { title, icon } = titleAndIconOf(pgData);

		let parentLocal = ctx.parentLocal;
		if (parentLocal === undefined) {
			const pnid = await remoteParentId(token, pgData);
			parentLocal = pnid ? localIdForRemote(pnid, rev) : null;
		}
		if (parentLocal && (!S.pages[parentLocal] || S.pages[parentLocal].trashed)) parentLocal = null;

		const children = await loadAllChildren(token, nid);
		const childPageIds = [];
		const childDbIds = [];
		const md = await blocksToMd(token, children, {
			onChildPage: async (childId) => { childPageIds.push(normId(childId)); },
			onChildDb: async (dbId, dbTitle) => {
				try {
					const dbn = normId(dbId);
					const db = await req(token, "/databases/" + dbId);
					const schema = Object.entries(db.properties || {}).map(([name, p]) => ({ name, type: p.type }));
					schema.sort((a, b) => (a.type === "title" ? -1 : 0) - (b.type === "title" ? -1 : 0));
					const dTitle = dbTitle || plainText(db.title) || "Datenbank";
					const dIcon = db.icon && db.icon.type === "emoji" ? db.icon.emoji : "🗃";
					dbParentCache[dbn] = dbn;
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

		let wsId;
		if (parentLocal && S.pages[parentLocal]) wsId = S.pages[parentLocal].workspaceId || "default";
		else if (id && S.pages[id]) wsId = S.pages[id].workspaceId || "default";
		else wsId = S.currentWorkspaceId || "default";

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
			if ((S.pages[id].parentId || null) !== (parentLocal || null)) await STATE.dispatch("pageMove", { id, parentId: parentLocal });
		}
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
				else blocks.push({ type: "paragraph", paragraph: { rich_text: mdRichText("🖼 *" + (img[1] || "Bild") + "* (lokales Bild — Notions API erlaubt keinen Datei-Upload)") } });
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
				let icon = "💡";
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