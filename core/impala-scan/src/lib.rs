pub mod detect;
pub mod enhance;
pub mod geom;
pub mod quality;
pub mod types;
pub mod warp;

pub use detect::{detect_quad_pixels, detect_sizes, full_quad_pixels, refine_quad_pixels, to_gray};
pub use enhance::apply_scan_mode_pixels;
pub use geom::{dist2d, is_convex, order_quad, quad_area};
pub use quality::{downscale_pixels, lum_stats_pixels, rotate_pixels, scan_quality_pixels};
pub use types::{
    DETECT_MAX, DetectSizes, GrayImage, LumStats, OUT_MAX_PIXELS, Point, Quad, REFINE_MAX, RgbaImage, Rotation,
    SCAN_JPEG_QUALITY, SCAN_OUT_MAX_EDGE, SCAN_SOURCE_MAX, ScanMode, ScanQuality,
};
pub use warp::{homography, warp_pixels};
