use tauri::{Emitter, Manager};

#[tauri::command]
async fn start_oauth_server(window: tauri::Window) -> Result<u16, String> {
	tauri_plugin_oauth::start(move |url| {
		let _ = window.emit("redirect_uri", url);
	})
	.map_err(|err| err.to_string())
}

#[tauri::command]
fn cancel_oauth_server(port: u16) -> Result<(), String> {
	tauri_plugin_oauth::cancel(port).map_err(|err| err.to_string())
}

// NotebookLM als eingebettetes Kind-Webview im Hauptfenster + Download-Abgriff.
#[tauri::command]
async fn nlm_webview(app: tauri::AppHandle, show: bool, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
	let win = app.get_window("main").ok_or("Hauptfenster fehlt")?;
	if let Some(wv) = win.get_webview("nlm") {
		if show {
			wv.set_position(tauri::LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
			wv.set_size(tauri::LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
		} else {
			wv.close().map_err(|e| e.to_string())?;
		}
		return Ok(());
	}
	if !show {
		return Ok(());
	}
	let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("nlm-downloads");
	let handle = app.clone();
	let builder = tauri::webview::WebviewBuilder::new(
		"nlm",
		tauri::WebviewUrl::External("https://notebooklm.google.com/".parse().unwrap()),
	)
	.on_download(move |_wv, ev| {
		match ev {
			tauri::webview::DownloadEvent::Requested { destination, .. } => {
				std::fs::create_dir_all(&dir).ok();
				let name = destination.file_name().map(|n| n.to_owned()).unwrap_or_default();
				*destination = dir.join(name);
			}
			tauri::webview::DownloadEvent::Finished { path, success, .. } => {
				if success {
					if let Some(p) = path {
						handle.emit("nlm-download", p.to_string_lossy().to_string()).ok();
					}
				}
			}
			_ => {}
		}
		true
	});
	win.add_child(builder, tauri::LogicalPosition::new(x, y), tauri::LogicalSize::new(w, h))
		.map_err(|e| e.to_string())?;
	Ok(())
}

// Abgefangene Datei als Rohdaten an die Web-Seite liefern
#[tauri::command]
fn nlm_read_file(path: String) -> Result<tauri::ipc::Response, String> {
	std::fs::read(&path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	#[cfg(target_os = "linux")]
	unsafe {
		std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
	}

	tauri::Builder::default()
		.plugin(tauri_plugin_shell::init())
		.plugin(tauri_plugin_process::init())
		.plugin(tauri_plugin_updater::Builder::new().build())
		.plugin(tauri_plugin_oauth::init())
		.setup(|app| {
			if cfg!(debug_assertions) {
				app.handle().plugin(
					tauri_plugin_log::Builder::default()
						.level(log::LevelFilter::Info)
						.build(),
				)?;
			}
			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			start_oauth_server,
			cancel_oauth_server,
			nlm_webview,
			nlm_read_file
		])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}