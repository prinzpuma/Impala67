use crate::types::{Point, Quad};

#[inline]
pub fn dist2d(a: Point, b: Point) -> f64 {
    (a.0 - b.0).hypot(a.1 - b.1)
}

/// Berechnet den Flächeninhalt eines beliebigen 4-Ecks über die Gaußsche Trapezformel.
pub fn quad_area(q: &Quad) -> f64 {
    let mut a = 0.0;
    for i in 0..4 {
        let p = q.0[i];
        let r = q.0[(i + 1) % 4];
        a += p.0 * r.1 - r.0 * p.1;
    }
    (a.abs()) / 2.0
}

/// Prüft, ob ein 4-Eck strikt konvex ist (alle Kreuzprodukte haben dasselbe Vorzeichen).
pub fn is_convex(q: &Quad) -> bool {
    let mut sign = 0;
    for i in 0..4 {
        let a = q.0[i];
        let b = q.0[(i + 1) % 4];
        let c = q.0[(i + 2) % 4];
        let z = (b.0 - a.0) * (c.1 - b.1) - (b.1 - a.1) * (c.0 - b.0);
        if z == 0.0 {
            continue;
        }
        let s = if z > 0.0 { 1 } else { -1 };
        if sign == 0 {
            sign = s;
        } else if sign != s {
            return false;
        }
    }
    sign != 0
}

/// Bringt die Ecken in die Reihenfolge oben-links, oben-rechts, unten-rechts, unten-links
/// (Umlauf nach Polarwinkel um den Schwerpunkt, Startpunkt ist minimale Summe x + y).
pub fn order_quad(quad: [Point; 4]) -> Quad {
    let cqx = (quad[0].0 + quad[1].0 + quad[2].0 + quad[3].0) / 4.0;
    let cqy = (quad[0].1 + quad[1].1 + quad[2].1 + quad[3].1) / 4.0;

    let mut q = quad;
    q.sort_by(|a, b| {
        let ang_a = (a.1 - cqy).atan2(a.0 - cqx);
        let ang_b = (b.1 - cqy).atan2(b.0 - cqx);
        ang_a.partial_cmp(&ang_b).unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut st = 0;
    let mut min_sum = q[0].0 + q[0].1;
    for (i, p) in q.iter().enumerate().skip(1) {
        let s = p.0 + p.1;
        if s < min_sum {
            min_sum = s;
            st = i;
        }
    }

    let mut ordered = [Point(0.0, 0.0); 4];
    for i in 0..4 {
        ordered[i] = q[(st + i) % 4];
    }
    Quad(ordered)
}

/// Konvexe Hülle einer 2D-Punktwolke nach Andrew (Monotone Chain).
pub fn convex_hull(mut pts: Vec<Point>) -> Vec<Point> {
    pts.sort_by(|a, b| {
        a.0.partial_cmp(&b.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
    });

    if pts.len() < 3 {
        return pts;
    }

    let cross = |o: Point, a: Point, b: Point| -> f64 { (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0) };

    let mut lower = Vec::new();
    for &pt in &pts {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], pt) <= 0.0 {
            lower.pop();
        }
        lower.push(pt);
    }

    let mut upper = Vec::new();
    for &pt in pts.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], pt) <= 0.0 {
            upper.pop();
        }
        upper.push(pt);
    }

    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}
