"use strict";

export function hitBox(items, point) {
	for (let index = items.length - 1; index >= 0; index--) {
		const item = items[index];
		if (point[0] >= item.x && point[0] <= item.x + item.w && point[1] >= item.y && point[1] <= item.y + (item.h || 60)) return item;
	}
	return null;
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
		minX = Math.min(minX, shape.x1, shape.x2); maxX = Math.max(maxX, shape.x1, shape.x2);
		minY = Math.min(minY, shape.y1, shape.y2); maxY = Math.max(maxY, shape.y1, shape.y2);
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
	if (shape?.x1 != null) { shape.x1 += deltaX; shape.y1 += deltaY; shape.x2 += deltaX; shape.y2 += deltaY; }
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
		shape.x1 = anchorX + (shape.x1 - anchorX) * factor; shape.x2 = anchorX + (shape.x2 - anchorX) * factor;
		shape.y1 = anchorY + (shape.y1 - anchorY) * factor; shape.y2 = anchorY + (shape.y2 - anchorY) * factor;
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
