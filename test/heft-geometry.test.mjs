import test from "node:test";
import assert from "node:assert/strict";

import { applyStrokeGeometry, fitStrokeShape, lassoBounds, nearPoint, pointInPolygon, scaleStrokeFrom, strokeBounds, strokeGeometry, strokeHitAt, translateStroke } from "../web/heft-geometry.js";

function tracedPath(vertices, samples = 5) {
	const points = [[vertices[0][0], vertices[0][1], .5]];
	vertices.slice(1).forEach((end, index) => {
		const start = vertices[index];
		for (let step = 1; step <= samples; step++) points.push([start[0] + (end[0] - start[0]) * step / samples, start[1] + (end[1] - start[1]) * step / samples, .5]);
	});
	return points;
}

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

test("Heft-Formerkennung rast einzügige Dreiecke und Pfeile ein", () => {
	const triangle = fitStrokeShape(tracedPath([[20, 120], [70, 20], [120, 120], [20, 120]]));
	assert.equal(triangle?.type, "triangle");
	assert.notEqual(triangle?.type, "rect");

	const arrow = fitStrokeShape(tracedPath([[20, 70], [130, 70], [102, 45], [130, 70], [102, 95]]));
	assert.equal(arrow?.type, "arrow");
	assert.deepEqual([arrow?.x1, arrow?.y1, arrow?.x2, arrow?.y2], [20, 70, 130, 70]);
});

test("Heft-Geometrie erhält Dreiecke und Pfeile beim Verschieben und Skalieren", () => {
	const stroke = { size: 3, pts: [[0, 0]], shape: { type: "triangle", x1: 10, y1: 20, x2: 30, y2: 40, x3: 50, y3: 60 } };
	translateStroke(stroke, 5, -5);
	assert.deepEqual(stroke.shape, { type: "triangle", x1: 15, y1: 15, x2: 35, y2: 35, x3: 55, y3: 55 });
	const original = strokeGeometry(stroke);
	scaleStrokeFrom(stroke, original, 15, 15, 2);
	assert.deepEqual(stroke.shape, { type: "triangle", x1: 15, y1: 15, x2: 55, y2: 55, x3: 95, y3: 95 });
	assert.ok(strokeBounds(stroke).maxX >= 105);
});
