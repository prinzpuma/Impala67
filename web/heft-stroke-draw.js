"use strict";

// Zeichnet einen Heft-Strich (Stift, Marker, Form) auf einen 2D-Kontext. Ohne DOM-Bezug,
// damit der Hauptthread (heft.js) und der Strich-Worker (heft-ink-worker.js) dieselbe
// Darstellung nutzen.

export const segW = (b, p) => Math.max(0.5, b * (0.4 + (p == null ? 0.5 : p) * 1.2));
export function drawStroke(x, s) {
	const pts = s.pts;
	if (!pts || !pts.length) return;
	x.save();
	x.lineCap = "round"; x.lineJoin = "round"; x.strokeStyle = s.color;
	if (s.tool === "shape" && s.shape) {
		x.lineWidth = s.size || 3;
		const a = s.shape;
		if (a.type === "line") { x.beginPath(); x.moveTo(a.x1, a.y1); x.lineTo(a.x2, a.y2); x.stroke(); }
		else if (a.type === "ellipse") { x.beginPath(); x.ellipse(a.cx, a.cy, Math.abs(a.rx), Math.abs(a.ry), 0, 0, Math.PI * 2); x.stroke(); }
		else if (a.type === "triangle") { x.beginPath(); x.moveTo(a.x1, a.y1); x.lineTo(a.x2, a.y2); x.lineTo(a.x3, a.y3); x.lineTo(a.x1, a.y1); x.stroke(); }
		else if (a.type === "arrow") { x.beginPath(); x.moveTo(a.x1, a.y1); x.lineTo(a.x2, a.y2); x.lineTo(a.h1x, a.h1y); x.moveTo(a.x2, a.y2); x.lineTo(a.h2x, a.h2y); x.stroke(); }
		else if (a.type === "rect") { x.strokeRect(Math.min(a.x1, a.x2), Math.min(a.y1, a.y2), Math.abs(a.x2 - a.x1), Math.abs(a.y2 - a.y1)); }
	} else if (s.tool === "marker") {
		x.globalAlpha = 0.32; x.lineWidth = s.size * 3;
		x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
		for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
		x.stroke();
	} else if (pts.length === 1) {
		x.beginPath(); x.fillStyle = s.color;
		x.arc(pts[0][0], pts[0][1], segW(s.size, pts[0][2]) / 2, 0, Math.PI * 2); x.fill();
	} else {
		let from = pts[0];
		for (let i = 1; i < pts.length; i++) {
			const cur = pts[i];
			const to = i < pts.length - 1 ? [(cur[0] + pts[i + 1][0]) / 2, (cur[1] + pts[i + 1][1]) / 2] : cur;
			x.beginPath(); x.lineWidth = segW(s.size, ((pts[i - 1][2] || 0.5) + (cur[2] || 0.5)) / 2);
			x.moveTo(from[0], from[1]);
			x.quadraticCurveTo(cur[0], cur[1], to[0], to[1]);
			x.stroke();
			from = to;
		}
	}
	x.restore();
}

