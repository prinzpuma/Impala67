use flate2::read::GzDecoder;
use impala_scan::{
    apply_scan_mode_pixels, detect_quad_pixels, detect_sizes, downscale_pixels, to_gray,
    warp_pixels, Quad, RgbaImage, ScanMode,
};
use std::io::Read;
use std::time::Instant;

fn load_gz_image(bytes: &[u8], width: u32, height: u32) -> RgbaImage {
    let mut decoder = GzDecoder::new(bytes);
    let mut data = Vec::with_capacity((width * height * 4) as usize);
    decoder
        .read_to_end(&mut data)
        .expect("Fehler beim Dekomprimieren");
    RgbaImage {
        width,
        height,
        data,
    }
}

fn median(mut times: Vec<f64>) -> f64 {
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    times[times.len() / 2]
}

fn main() {
    let med_bytes = include_bytes!("../tests/golden/doc_medium.bin.gz");
    let med_img = load_gz_image(med_bytes, 480, 640);
    let raw_cases = include_str!("../tests/golden/cases.json");
    let cases: serde_json::Value = serde_json::from_str(raw_cases).unwrap();
    let q = &cases["docMedium"]["quad"];
    let quad = Quad([
        impala_scan::Point(q[0][0].as_f64().unwrap(), q[0][1].as_f64().unwrap()),
        impala_scan::Point(q[1][0].as_f64().unwrap(), q[1][1].as_f64().unwrap()),
        impala_scan::Point(q[2][0].as_f64().unwrap(), q[2][1].as_f64().unwrap()),
        impala_scan::Point(q[3][0].as_f64().unwrap(), q[3][1].as_f64().unwrap()),
    ]);

    let runs = 20;

    // 1. Benchmark: Dokumenterkennung
    let mut detect_times = Vec::with_capacity(runs);
    for _ in 0..runs {
        let t0 = Instant::now();
        let sizes = detect_sizes(med_img.width, med_img.height);
        let analysis = downscale_pixels(&med_img, sizes.dw, sizes.dh);
        let refine_src = downscale_pixels(&med_img, sizes.gw, sizes.gh);
        let gray_refine = to_gray(&refine_src);
        let _ = detect_quad_pixels(
            &analysis,
            med_img.width,
            med_img.height,
            Some(&gray_refine),
        );
        detect_times.push(t0.elapsed().as_secs_f64() * 1000.0);
    }

    // 2. Benchmark: Perspektivische Entzerrung (Warp)
    let mut warp_times = Vec::with_capacity(runs);
    for _ in 0..runs {
        let t0 = Instant::now();
        let _ = warp_pixels(&med_img, &quad);
        warp_times.push(t0.elapsed().as_secs_f64() * 1000.0);
    }

    // 3. Benchmark: Filter / Enhance (Farbe & S/W)
    let warped = warp_pixels(&med_img, &quad);
    let mut color_times = Vec::with_capacity(runs);
    let mut bw_times = Vec::with_capacity(runs);

    for _ in 0..runs {
        let mut img = warped.clone();
        let t0 = Instant::now();
        apply_scan_mode_pixels(&mut img, ScanMode::Color);
        color_times.push(t0.elapsed().as_secs_f64() * 1000.0);

        let mut img2 = warped.clone();
        let t1 = Instant::now();
        apply_scan_mode_pixels(&mut img2, ScanMode::Bw);
        bw_times.push(t1.elapsed().as_secs_f64() * 1000.0);
    }

    println!("--- Impala Scan Rust Benchmark (Profil: native) ---");
    println!("Dokumenterkennung (Detect): {:.2} ms", median(detect_times));
    println!("Entzerrung (Warp):          {:.2} ms", median(warp_times));
    println!("Aufbereitung Farbe:         {:.2} ms", median(color_times));
    println!("Aufbereitung S/W:           {:.2} ms", median(bw_times));
}
