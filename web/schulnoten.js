"use strict";

import { U } from "./util.js";
import { S, STATE } from "./state.js";

// Schulnoten: persistiert jede Änderung im Event-Log (gradeAdd/gradeDelete),
// damit sie mit dem bestehenden Drive-Sync zwischen Geräten repliziert wird.
export const SCHULNOTEN = (() => {
	function localDate() {
		const d = new Date();
		return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
	}

	function allGrades() {
		return Object.values(S.grades || {}).filter((entry) => !entry.deleted);
	}

	function average(entries) {
		if (!entries.length) return null;
		let weightedSum = 0;
		let totalWeight = 0;
		for (const entry of entries) {
			const weight = Number(entry.weight) || 1;
			weightedSum += Number(entry.grade) * weight;
			totalWeight += weight;
		}
		return totalWeight ? (weightedSum / totalWeight).toFixed(2) : null;
	}

	function subjects() {
		const result = {};
		for (const entry of allGrades()) {
			(result[entry.subject] ||= []).push(entry);
		}
		return result;
	}

	async function addGrade({ subject, grade, weight, date, comment }) {
		const value = Number(grade);
		if (!subject || !Number.isFinite(value) || value < 1 || value > 6) {
			throw new Error("Bitte Fach und eine Note von 1 bis 6 angeben.");
		}
		await STATE.dispatch("gradeAdd", {
			id: U.uid(),
			subject: String(subject).trim(),
			grade: value,
			weight: Math.max(0.25, Number(weight) || 1),
			date: date || localDate(),
			comment: String(comment || "").trim(),
		});
	}

	async function deleteGrade(id) {
		await STATE.dispatch("gradeDelete", { id });
	}

	function exportMarkdown() {
		const lines = ["# Schulnoten", ""];
		for (const [subject, entries] of Object.entries(subjects()).sort(([a], [b]) => a.localeCompare(b, "de"))) {
			lines.push("## " + subject + " — Ø " + average(entries));
			for (const entry of entries.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))) {
				lines.push("- **" + entry.grade + "** · Gewichtung " + entry.weight + " · " + entry.date + (entry.comment ? " · " + entry.comment : ""));
			}
			lines.push("");
		}
		return lines.join("\n");
	}

	function gradeColor(value) {
		if (value <= 1.5) return "#72bc8f";
		if (value <= 2.5) return "#a3cf62";
		if (value <= 3.5) return "#eac26b";
		if (value <= 4.5) return "#de9255";
		return "#e97366";
	}

	function render(container) {
		if (!container) return;
		const groups = subjects();
		const total = average(allGrades());
		let html = '<section class="noten-wrap">' +
			'<header class="section-head"><h2>🎓 Schulnoten</h2>' +
			(total ? '<span class="hint">Gesamtschnitt: <b>' + total + '</b></span>' : '<span class="hint">Noch keine Noten</span>') +
			'<button type="button" class="mini" data-noten-export="1">↓ Markdown</button></header>' +
			'<form class="noten-form" id="notenForm">' +
			'<input name="subject" placeholder="Fach" autocomplete="off" required>' +
			'<input name="grade" type="number" min="1" max="6" step="0.1" placeholder="Note" required>' +
			'<input name="weight" type="number" min="0.25" max="20" step="0.25" value="1" aria-label="Gewichtung">' +
			'<input name="date" type="date" value="' + localDate() + '" aria-label="Datum">' +
			'<input name="comment" placeholder="Kommentar (optional)">' +
			'<button class="mini" type="submit">＋ Eintragen</button></form>';

		if (!Object.keys(groups).length) {
			html += '<p class="hint noten-empty">Trag die erste Note ein — der gewichtete Schnitt erscheint sofort.</p>';
		} else {
			for (const [subject, entries] of Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, "de"))) {
				const avg = average(entries);
				html += '<article class="noten-subject"><header><b>' + U.esc(subject) + '</b><span style="color:' + gradeColor(Number(avg)) + '">Ø ' + avg + '</span></header>' +
					'<table class="noten-table"><thead><tr><th>Note</th><th>Gew.</th><th>Datum</th><th>Kommentar</th><th></th></tr></thead><tbody>';
				for (const entry of entries.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))) {
					html += '<tr><td style="color:' + gradeColor(entry.grade) + '"><b>' + entry.grade + '</b></td><td>' + entry.weight + '</td><td>' + U.esc(entry.date) + '</td><td>' + U.esc(entry.comment || '') + '</td>' +
						'<td><button type="button" class="mini danger" data-noten-delete="' + entry.id + '" title="Note löschen">🗑</button></td></tr>';
				}
				html += '</tbody></table></article>';
			}
		}
		container.innerHTML = html + '</section>';

		const form = container.querySelector("#notenForm");
		form.addEventListener("submit", async (event) => {
			event.preventDefault();
			const data = new FormData(form);
			try {
				await addGrade({
					subject: data.get("subject"), grade: data.get("grade"), weight: data.get("weight"),
					date: data.get("date"), comment: data.get("comment"),
				});
				U.toast("Note eingetragen.", "success");
			} catch (error) {
				U.toast(error.message || "Note konnte nicht gespeichert werden.", "error");
			}
		});

		// `onclick` statt addEventListener: render() kann nach einem State-Update
		// mehrfach laufen, ohne zusätzliche Listener am Hauptbereich anzuhäufen.
		container.onclick = async (event) => {
			const remove = event.target.closest("[data-noten-delete]");
			if (remove) {
				await deleteGrade(remove.dataset.notenDelete);
				U.toast("Note gelöscht.", "success");
				return;
			}
			if (event.target.closest("[data-noten-export]")) {
				const url = URL.createObjectURL(new Blob([exportMarkdown()], { type: "text/markdown;charset=utf-8" }));
				const link = document.createElement("a");
				link.href = url;
				link.download = "schulnoten.md";
				link.click();
				setTimeout(() => URL.revokeObjectURL(url), 0);
			}
		};
	}

	const style = document.createElement("style");
	style.id = "schulnotenStyles";
	style.textContent = [
		".noten-wrap{width:min(980px,100%);margin:0 auto;padding:28px 24px;overflow:auto}",
		".noten-form{display:grid;grid-template-columns:1.25fr .7fr .7fr 1fr 1.5fr auto;gap:8px;margin:14px 0 20px}",
		".noten-subject{margin:14px 0;border:1px solid var(--edge-soft);border-radius:10px;overflow:hidden;background:var(--surface-subtle)}",
		".noten-subject header{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--surface)}",
		".noten-subject header span{font-weight:750}.noten-table{border-collapse:collapse;width:100%;font-size:13px}",
		".noten-table th,.noten-table td{padding:8px 12px;border-top:1px solid var(--edge-soft);text-align:left}",
		".noten-table th{color:var(--text2);font-weight:600}.noten-table td:last-child{width:48px;text-align:right}.noten-empty{padding:18px 0}",
		"@media(max-width:760px){.noten-wrap{padding:18px 16px}.noten-form{grid-template-columns:1fr 1fr}.noten-form input[name=comment]{grid-column:1/-1}.noten-form button{grid-column:1/-1;min-height:44px}.noten-table th:nth-child(3),.noten-table td:nth-child(3){display:none}}",
	].join("");
	if (!document.getElementById(style.id)) document.head.appendChild(style);

	document.addEventListener("click", (event) => {
		if (!event.target.closest || !event.target.closest("[data-noten-open]")) return;
		event.preventDefault();
		S.view = "noten";
		S.sidebarMode = "files";
		if (typeof window.render === "function") window.render();
	});

	return { addGrade, deleteGrade, allGrades, average, exportMarkdown, render };
})();