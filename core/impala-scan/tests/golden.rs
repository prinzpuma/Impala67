use flate2::read::GzDecoder;
use impala_scan::{
    apply_scan_mode_pixels, detect_quad_pixels, detect_sizes, dist2d, downscale_pixels, is_convex,
    lum_stats_pixels, quad_area, rotate_pixels, scan_quality_pixels, to_gray, warp_pixels,
    LumStats, Point, Quad, RgbaImage, Rotation, ScanMode, ScanQuality,
};
use serde::Deserialize;
use std::io::Read;

fn load_gz_image(bytes: &[u8], width: u32, height: u32) -> RgbaImage {
    let mut decoder = GzDecoder::new(bytes);
    let mut data = Vec::with_capacity((width * height * 4) as usize);
    decoder
        .read_to_end(&mut data)
        .expect("Fehler beim Dekomprimieren des Testbilds");
    RgbaImage {
        width,
        height,
        data,
    }
}

#[derive(Deserialize)]
struct GeomCase {
    quad: [[f64; 2]; 4],
    area: f64,
    convex: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocSmallGolden {
    width: u32,
    height: u32,
    rot90_stats: LumStats,
    rot180_stats: LumStats,
    downscale_stats: LumStats,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WarpGolden {
    width: u32,
    height: u32,
    lum_stats: LumStats,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnhanceGolden {
    lum_stats: LumStats,
    quality: ScanQuality,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocMediumGolden {
    width: u32,
    height: u32,
    quad: [[f64; 2]; 4],
    detected_quad: [[f64; 2]; 4],
    warp_result: WarpGolden,
    enhance_results: std::collections::HashMap<String, EnhanceGolden>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenCases {
    geom_cases: Vec<GeomCase>,
    doc_small: DocSmallGolden,
    doc_medium: DocMediumGolden,
}

fn assert_stats_approx(actual: &LumStats, expected: &LumStats, eps: f64) {
    assert!(
        (actual.mean - expected.mean).abs() < eps,
        "mean mismatch: {} vs {}",
        actual.mean,
        expected.mean
    );
    assert!(
        (actual.contrast - expected.contrast).abs() < eps,
        "contrast mismatch: {} vs {}",
        actual.contrast,
        expected.contrast
    );
    assert!(
        (actual.sharp - expected.sharp).abs() < eps,
        "sharp mismatch: {} vs {}",
        actual.sharp,
        expected.sharp
    );
    assert!(
        (actual.dark_ratio - expected.dark_ratio).abs() < eps,
        "dark_ratio mismatch: {} vs {}",
        actual.dark_ratio,
        expected.dark_ratio
    );
    assert!(
        (actual.bright_ratio - expected.bright_ratio).abs() < eps,
        "bright_ratio mismatch: {} vs {}",
        actual.bright_ratio,
        expected.bright_ratio
    );
}

#[test]
fn test_golden_cases() {
    let raw_json = include_str!("golden/cases.json");
    let golden: GoldenCases = serde_json::from_str(raw_json).expect("cases.json parsing failed");

    let small_bytes = include_bytes!("golden/doc_small.bin.gz");
    let med_bytes = include_bytes!("golden/doc_medium.bin.gz");

    // 1. Geometrie
    for case in &golden.geom_cases {
        let q = Quad([
            Point(case.quad[0][0], case.quad[0][1]),
            Point(case.quad[1][0], case.quad[1][1]),
            Point(case.quad[2][0], case.quad[2][1]),
            Point(case.quad[3][0], case.quad[3][1]),
        ]);
        let area = quad_area(&q);
        assert!(
            (area - case.area).abs() < 1e-4,
            "quadArea mismatch: {} vs {}",
            area,
            case.area
        );
        assert_eq!(is_convex(&q), case.convex, "isConvex mismatch");
    }

    // 2. DocSmall: Prüft Rotation & Downscale
    let small_img = load_gz_image(small_bytes, golden.doc_small.width, golden.doc_small.height);

    let rot90 = rotate_pixels(&small_img, Rotation::Rotate90);
    assert_eq!(rot90.width, 320);
    assert_eq!(rot90.height, 240);
    let rot90_stats = lum_stats_pixels(&rot90, 1);
    assert_stats_approx(&rot90_stats, &golden.doc_small.rot90_stats, 0.01);

    let rot180 = rotate_pixels(&small_img, Rotation::Rotate180);
    assert_eq!(rot180.width, 240);
    assert_eq!(rot180.height, 320);
    let rot180_stats = lum_stats_pixels(&rot180, 1);
    assert_stats_approx(&rot180_stats, &golden.doc_small.rot180_stats, 0.01);

    let downscaled = downscale_pixels(&small_img, 120, 160);
    assert_eq!(downscaled.width, 120);
    assert_eq!(downscaled.height, 160);
    let down_stats = lum_stats_pixels(&downscaled, 1);
    assert_stats_approx(&down_stats, &golden.doc_small.downscale_stats, 0.2);

    // 3. DocMedium: Prüft Warp, Enhance und Dokumenterkennung
    let med_img = load_gz_image(med_bytes, golden.doc_medium.width, golden.doc_medium.height);
    let quad = Quad([
        Point(golden.doc_medium.quad[0][0], golden.doc_medium.quad[0][1]),
        Point(golden.doc_medium.quad[1][0], golden.doc_medium.quad[1][1]),
        Point(golden.doc_medium.quad[2][0], golden.doc_medium.quad[2][1]),
        Point(golden.doc_medium.quad[3][0], golden.doc_medium.quad[3][1]),
    ]);

    // Warp
    let warped = warp_pixels(&med_img, &quad);
    assert_eq!(warped.width, golden.doc_medium.warp_result.width);
    assert_eq!(warped.height, golden.doc_medium.warp_result.height);
    let warp_stats = lum_stats_pixels(&warped, 1);
    assert_stats_approx(&warp_stats, &golden.doc_medium.warp_result.lum_stats, 0.25);

    // Enhance (color, bw, gray, photo)
    for (mode_str, mode) in [
        ("color", ScanMode::Color),
        ("bw", ScanMode::Bw),
        ("gray", ScanMode::Gray),
        ("photo", ScanMode::Photo),
    ] {
        let expected = &golden.doc_medium.enhance_results[mode_str];
        let mut test_img = warped.clone();
        apply_scan_mode_pixels(&mut test_img, mode);

        let stats = lum_stats_pixels(&test_img, 1);
        assert_stats_approx(&stats, &expected.lum_stats, 0.5);

        let qual = scan_quality_pixels(&test_img);
        assert_eq!(
            qual.soft, expected.quality.soft,
            "mode {} quality.soft mismatch",
            mode_str
        );
        assert_eq!(
            qual.flat, expected.quality.flat,
            "mode {} quality.flat mismatch",
            mode_str
        );
        assert_eq!(
            qual.too_dark, expected.quality.too_dark,
            "mode {} quality.tooDark mismatch",
            mode_str
        );
        assert_eq!(
            qual.glare, expected.quality.glare,
            "mode {} quality.glare mismatch",
            mode_str
        );
    }

    // Dokumenterkennung (Detect)
    let sizes = detect_sizes(med_img.width, med_img.height);
    let analysis_img = downscale_pixels(&med_img, sizes.dw, sizes.dh);
    let refine_img = downscale_pixels(&med_img, sizes.gw, sizes.gh);
    let gray_refine = to_gray(&refine_img);

    let detected = detect_quad_pixels(
        &analysis_img,
        med_img.width,
        med_img.height,
        Some(&gray_refine),
    );
    let expected_det = Quad([
        Point(
            golden.doc_medium.detected_quad[0][0],
            golden.doc_medium.detected_quad[0][1],
        ),
        Point(
            golden.doc_medium.detected_quad[1][0],
            golden.doc_medium.detected_quad[1][1],
        ),
        Point(
            golden.doc_medium.detected_quad[2][0],
            golden.doc_medium.detected_quad[2][1],
        ),
        Point(
            golden.doc_medium.detected_quad[3][0],
            golden.doc_medium.detected_quad[3][1],
        ),
    ]);

    for i in 0..4 {
        let dist = dist2d(detected.0[i], expected_det.0[i]);
        assert!(
            dist < 3.0,
            "Corner {} diverged: actual ({:.1}, {:.1}) vs expected ({:.1}, {:.1}), dist = {:.2}",
            i,
            detected.0[i].0,
            detected.0[i].1,
            expected_det.0[i].0,
            expected_det.0[i].1,
            dist
        );
    }
}
