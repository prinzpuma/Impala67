"use strict";

export function hitBox(items, point) {
	for (let index = items.length - 1; index >= 0; index--) {
		const item = items[index];
		if (point[0] >= item.x && point[0] <= item.x + item.w && point[1] >= item.y && point[1] <= item.y + (item.h || 60)) return item;
	}
	return null;
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const shapePointKeys = (shape) => shape?.type === "triangle"
	? ["x1", "y1", "x2", "y2", "x3", "y3"]
	: shape?.type === "arrow"
		? ["x1", "y1", "x2", "y2", "h1x", "h1y", "h2x", "h2y"]
		: ["x1", "y1", "x2", "y2"];

function simplifyPath(points, tolerance) {
	if (points.length < 3) return points.map((point) => [point[0], point[1]]);
	const first = points[0], last = points[points.length - 1];
	let farthest = -1, maxDistance = 0;
	const base = Math.max(1, distance(first, last));
	for (let index = 1; index < points.length - 1; index++) {
		const point = points[index];
		const offset = Math.abs((last[1] - first[1]) * (point[0] - first[0]) - (last[0] - first[0]) * (point[1] - first[1])) / base;
		if (offset > maxDistance) { maxDistance = offset; farthest = index; }
	}
	if (maxDistance <= tolerance) return [[first[0], first[1]], [last[0], last[1]]];
	return [...simplifyPath(points.slice(0, farthest + 1), tolerance).slice(0, -1), ...simplifyPath(points.slice(farthest), tolerance)];
}

function arrowFromVertices(vertices, tolerance) {
	for (let tipIndex = 1; tipIndex < vertices.length - 3; tipIndex++) {
		const tip = vertices[tipIndex], start = vertices[0], shaft = distance(start, tip);
		if (shaft < 30) continue;
		for (let returnIndex = tipIndex + 2; returnIndex < vertices.length - 1; returnIndex++) {
			if (distance(tip, vertices[returnIndex]) > tolerance) continue;
			const headA = vertices[tipIndex + 1], headB = vertices[returnIndex + 1];
			const armA = distance(tip, headA), armB = distance(tip, headB);
			if (armA < 8 || armB < 8 || armA > shaft * .6 || armB > shaft * .6) continue;
			const backX = start[0] - tip[0], backY = start[1] - tip[1];
			const dotA = (headA[0] - tip[0]) * backX + (headA[1] - tip[1]) * backY;
			const dotB = (headB[0] - tip[0]) * backX + (headB[1] - tip[1]) * backY;
			if (dotA <= armA * shaft * .3 || dotB <= armB * shaft * .3) continue;
			return { type: "arrow", x1: start[0], y1: start[1], x2: tip[0], y2: tip[1], h1x: headA[0], h1y: headA[1], h2x: headB[0], h2y: headB[1] };
		}
	}
	return null;
}

// Form-Erkennung ist reine Geometrie, damit Eingabe und Tests dieselbe Regel nutzen.
export function fitStrokeShape(points) {
	if (!Array.isArray(points) || points.length < 3) return null;
	const pathLength = points.slice(1).reduce((sum, point, index) => sum + distance(point, points[index]), 0);
	if (pathLength < 30) return null;
	const tolerance = Math.max(6, pathLength * .04);
	const vertices = simplifyPath(points, tolerance);
	const arrow = arrowFromVertices(vertices, tolerance * 1.5);
	if (arrow) return arrow;
	const a = points[0], b = points[points.length - 1];
	const closed = points.length > 10 && distance(a, b) < Math.max(18, pathLength * .2);
	if (closed) {
		const polygon = simplifyPath(points.slice(0, -1), tolerance);
		if (polygon.length > 2 && distance(polygon[0], polygon[polygon.length - 1]) <= tolerance * 2.5) polygon.pop();
		if (polygon.length === 3) return { type: "triangle", x1: polygon[0][0], y1: polygon[0][1], x2: polygon[1][0], y2: polygon[1][1], x3: polygon[2][0], y3: polygon[2][1] };
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		points.forEach((point) => { minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]); maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]); });
		const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, rx = (maxX - minX) / 2, ry = (maxY - minY) / 2;
		if (rx < 10 || ry < 10) return null;
		let errRect = 0, errEllipse = 0;
		points.forEach((point) => {
			const dxRect = Math.min(Math.abs(point[0] - minX), Math.abs(point[0] - maxX));
			const dyRect = Math.min(Math.abs(point[1] - minY), Math.abs(point[1] - maxY));
			errRect += Math.min(dxRect, dyRect);
			const nx = (point[0] - cx) / rx, ny = (point[1] - cy) / ry;
			errEllipse += Math.abs(Math.hypot(nx, ny) - 1) * Math.max(rx, ry);
		});
		return errRect < errEllipse * .85 ? { type: "rect", x1: minX, y1: minY, x2: maxX, y2: maxY } : { type: "ellipse", cx, cy, rx, ry };
	}
	const width = b[0] - a[0], height = b[1] - a[1], length = Math.hypot(width, height);
	let maxDeviation = 0;
	for (const point of points) maxDeviation = Math.max(maxDeviation, Math.abs(height * (point[0] - a[0]) - width * (point[1] - a[1])) / Math.max(1, length));
	return maxDeviation < Math.max(10, length * .1) ? { type: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1] } : null;
}

export function strokeOutline(stroke) {
	const shape = stroke.shape;
	const points = [];
	if (shape && shape.type === "line") {
		for (let index = 0; index <= 16; index++) points.push([shape.x1 + (shape.x2 - shape.x1) * index / 16, shape.y1 + (shape.y2 - shape.y1) * index / 16]);
		return points;
	}
	if (shape && shape.type === "rect") {
		const corners = [[shape.x1, shape.y1], [shape.x2, shape.y1], [shape.x2, shape.y2], [shape.x1, shape.y2], [shape.x1, shape.y1]];
		for (let side = 0; side < 4; side++) for (let index = 0; index < 8; index++) {
			const ratio = index / 8;
			points.push([corners[side][0] + (corners[side + 1][0] - corners[side][0]) * ratio, corners[side][1] + (corners[side + 1][1] - corners[side][1]) * ratio]);
		}
		points.push([shape.x1, shape.y1]);
		return points;
	}
	if (shape && shape.type === "triangle") return [[shape.x1, shape.y1], [shape.x2, shape.y2], [shape.x3, shape.y3], [shape.x1, shape.y1]];
	if (shape && shape.type === "arrow") return [[shape.x1, shape.y1], [shape.x2, shape.y2], [shape.h1x, shape.h1y], [shape.x2, shape.y2], [shape.h2x, shape.h2y]];
	if (shape && (shape.type === "ellipse" || shape.type === "circle")) {
		const radiusX = shape.rx != null ? shape.rx : shape.r;
		const radiusY = shape.ry != null ? shape.ry : shape.r;
		for (let index = 0; index <= 24; index++) {
			const angle = index / 24 * Math.PI * 2;
			points.push([shape.cx + Math.cos(angle) * radiusX, shape.cy + Math.sin(angle) * radiusY]);
		}
		return points;
	}
	return stroke.pts || [];
}

export function lassoBounds(strokes) {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	strokes.forEach((stroke) => strokeOutline(stroke).forEach((point) => {
		minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
		maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
	}));
	return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

export function strokeBounds(stroke) {
	if (!stroke) return null;
	if (stroke.bbox) return stroke.bbox;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	if (Array.isArray(stroke.pts)) for (const point of stroke.pts) {
		if (point[0] < minX) minX = point[0];
		if (point[0] > maxX) maxX = point[0];
		if (point[1] < minY) minY = point[1];
		if (point[1] > maxY) maxY = point[1];
	}
	const shape = stroke.shape;
	if (shape?.x1 != null) {
		const keys = shapePointKeys(shape);
		for (let index = 0; index < keys.length; index += 2) {
			minX = Math.min(minX, shape[keys[index]]); maxX = Math.max(maxX, shape[keys[index]]);
			minY = Math.min(minY, shape[keys[index + 1]]); maxY = Math.max(maxY, shape[keys[index + 1]]);
		}
	} else if (shape?.cx != null) {
		minX = Math.min(minX, shape.cx - shape.rx); maxX = Math.max(maxX, shape.cx + shape.rx);
		minY = Math.min(minY, shape.cy - shape.ry); maxY = Math.max(maxY, shape.cy + shape.ry);
	}
	const margin = (stroke.size || 3) * 2 + 4;
	stroke.bbox = isFinite(minX) ? { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin } : null;
	return stroke.bbox;
}

export function translateStroke(stroke, deltaX, deltaY) {
	if (Array.isArray(stroke.pts)) stroke.pts.forEach((point) => { point[0] += deltaX; point[1] += deltaY; });
	const shape = stroke.shape;
	if (shape?.x1 != null) for (let index = 0, keys = shapePointKeys(shape); index < keys.length; index += 2) { shape[keys[index]] += deltaX; shape[keys[index + 1]] += deltaY; }
	if (shape?.cx != null) { shape.cx += deltaX; shape.cy += deltaY; }
	if (stroke.bbox) {
		stroke.bbox.minX += deltaX; stroke.bbox.maxX += deltaX;
		stroke.bbox.minY += deltaY; stroke.bbox.maxY += deltaY;
	}
}

export function strokeGeometry(stroke) {
	return { pts: (stroke.pts || []).map((point) => point.slice()), shape: stroke.shape ? { ...stroke.shape } : null, size: stroke.size || 3 };
}

export function applyStrokeGeometry(stroke, geometry) {
	stroke.pts = (geometry.pts || []).map((point) => point.slice());
	stroke.shape = geometry.shape ? { ...geometry.shape } : null;
	if (!stroke.shape) delete stroke.shape;
	stroke.size = geometry.size;
	stroke.bbox = null;
	strokeBounds(stroke);
}

export function scaleStrokeFrom(stroke, geometry, anchorX, anchorY, factor) {
	const scalePoint = (point) => [anchorX + (point[0] - anchorX) * factor, anchorY + (point[1] - anchorY) * factor, ...point.slice(2)];
	stroke.pts = (geometry.pts || []).map(scalePoint);
	const shape = geometry.shape ? { ...geometry.shape } : null;
	if (shape?.x1 != null) {
		for (let index = 0, keys = shapePointKeys(shape); index < keys.length; index += 2) {
			shape[keys[index]] = anchorX + (shape[keys[index]] - anchorX) * factor;
			shape[keys[index + 1]] = anchorY + (shape[keys[index + 1]] - anchorY) * factor;
		}
	} else if (shape?.cx != null) {
		shape.cx = anchorX + (shape.cx - anchorX) * factor; shape.cy = anchorY + (shape.cy - anchorY) * factor;
		shape.rx *= factor; shape.ry *= factor;
	}
	if (shape) stroke.shape = shape; else delete stroke.shape;
	stroke.size = Math.max(0.5, geometry.size * factor);
	stroke.bbox = null;
	strokeBounds(stroke);
}

export function nearPoint(point, x, y, radius) {
	const deltaX = point[0] - x;
	const deltaY = point[1] - y;
	return deltaX * deltaX + deltaY * deltaY <= radius * radius;
}

export function pointInPolygon(point, polygon) {
	let hit = false;
	for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
		const a = polygon[index], b = polygon[previous];
		if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / ((b[1] - a[1]) || .0001) + a[0]) hit = !hit;
	}
	return hit;
}

function segmentDistanceSquared(px, py, ax, ay, bx, by) {
	const deltaX = bx - ax, deltaY = by - ay;
	const ratio = Math.max(0, Math.min(1, ((px - ax) * deltaX + (py - ay) * deltaY) / ((deltaX * deltaX + deltaY * deltaY) || 1)));
	const closestX = ax + ratio * deltaX, closestY = ay + ratio * deltaY;
	return (px - closestX) * (px - closestX) + (py - closestY) * (py - closestY);
}

export function strokeHitAt(stroke, x, y, radius) {
	const bounds = stroke.bbox || strokeBounds(stroke);
	const hitRadius = radius + (stroke.size || 2) / 2;
	if (bounds && (x + hitRadius < bounds.minX || x - hitRadius > bounds.maxX || y + hitRadius < bounds.minY || y - hitRadius > bounds.maxY)) return false;
	const points = strokeOutline(stroke);
	if (!points.length) return false;
	const squaredRadius = hitRadius * hitRadius;
	if (points.length === 1) {
		const deltaX = points[0][0] - x, deltaY = points[0][1] - y;
		return deltaX * deltaX + deltaY * deltaY <= squaredRadius;
	}
	for (let index = 1; index < points.length; index++) {
		if (segmentDistanceSquared(x, y, points[index - 1][0], points[index - 1][1], points[index][0], points[index][1]) <= squaredRadius) return true;
	}
	return false;
}
