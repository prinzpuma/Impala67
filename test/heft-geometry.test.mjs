import test from "node:test";
import assert from "node:assert/strict";

import { applyStrokeGeometry, lassoBounds, nearPoint, pointInPolygon, scaleStrokeFrom, strokeBounds, strokeGeometry, strokeHitAt, translateStroke } from "../web/heft-geometry.js";

test("Heft-Geometrie verschiebt und skaliert Striche reproduzierbar", () => {
	const stroke = { pts: [[10, 20, 0.5], [30, 40, 0.7]], size: 4 };
	const original = strokeGeometry(stroke);
	translateStroke(stroke, 5, -5);
	assert.deepEqual(stroke.pts, [[15, 15, 0.5], [35, 35, 0.7]]);
	applyStrokeGeometry(stroke, original);
	assert.deepEqual(stroke.pts, original.pts);
	scaleStrokeFrom(stroke, original, 10, 20, 2);
	assert.deepEqual(stroke.pts, [[10, 20, 0.5], [50, 60, 0.7]]);
	assert.equal(stroke.size, 8);
});

test("Heft-Geometrie berechnet Auswahl und Treffer unabhängig vom Canvas", () => {
	const stroke = { pts: [[100, 100], [200, 200]], size: 3 };
	assert.deepEqual(strokeBounds(stroke), { minX: 90, minY: 90, maxX: 210, maxY: 210 });
	assert.deepEqual(lassoBounds([stroke]), { minX: 100, minY: 100, maxX: 200, maxY: 200 });
	assert.equal(strokeHitAt(stroke, 150, 150, 4), true);
	assert.equal(strokeHitAt(stroke, 300, 300, 4), false);
	assert.equal(nearPoint([10, 10], 13, 14, 5), true);
	assert.equal(pointInPolygon([5, 5], [[0, 0], [10, 0], [10, 10], [0, 10]]), true);
});
