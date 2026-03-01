use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

mod terminal;

pub struct ServerState {
    port: Mutex<Option<u16>>,
    token: Mutex<Option<String>>,
    child: Mutex<Option<CommandChild>>,
}

impl ServerState {
    fn new() -> Self {
        Self {
            port: Mutex::new(None),
            token: Mutex::new(None),
            child: Mutex::new(None),
        }
    }

    fn set_port(&self, port: u16) {
        if let Ok(mut guard) = self.port.lock() {
            *guard = Some(port);
        }
    }

    fn set_token(&self, token: String) {
        if let Ok(mut guard) = self.token.lock() {
            *guard = Some(token);
        }
    }

    fn clear_port(&self) {
        if let Ok(mut guard) = self.port.lock() {
            *guard = None;
        }
    }

    fn clear_token(&self) {
        if let Ok(mut guard) = self.token.lock() {
            *guard = None;
        }
    }

    fn port(&self) -> Option<u16> {
        self.port.lock().ok().and_then(|guard| *guard)
    }

    fn token(&self) -> Option<String> {
        self.token.lock().ok().and_then(|guard| guard.clone())
    }

    fn set_child(&self, child: CommandChild) {
        if let Ok(mut guard) = self.child.lock() {
            *guard = Some(child);
        }
    }

    fn take_child(&self) -> Option<CommandChild> {
        self.child.lock().ok().and_then(|mut guard| guard.take())
    }
}

#[derive(Clone, serde::Serialize)]
struct ServerInfo {
    port: u16,
    token: String,
}

#[tauri::command]
fn get_server_info(state: State<'_, ServerState>) -> Result<ServerInfo, String> {
    match (state.port(), state.token()) {
        (Some(port), Some(token)) => Ok(ServerInfo { port, token }),
        _ => Err("Server not ready".to_string()),
    }
}

#[tauri::command]
fn toggle_devtools(window: tauri::WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

#[tauri::command]
fn get_cwd() -> Result<String, String> {
    if let Ok(pwd) = std::env::var("PWD") {
        return Ok(pwd);
    }

    std::env::current_dir()
        .map_err(|_| "Failed to get current working directory".to_string())
        .map(|path| path.to_string_lossy().to_string())
}

#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_X: f64 = 20.0;
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_Y_SEQUOIA: f64 = 26.0;
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_Y_TAHOE: f64 = 28.0;
#[cfg(target_os = "macos")]
const TAHOE_MAJOR_VERSION: isize = 26;

#[cfg(target_os = "macos")]
fn is_tahoe_or_newer() -> bool {
    use objc2_foundation::NSProcessInfo;

    NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        >= TAHOE_MAJOR_VERSION
}

#[cfg(target_os = "macos")]
fn macos_traffic_light_y() -> f64 {
    if is_tahoe_or_newer() {
        TRAFFIC_LIGHT_Y_TAHOE
    } else {
        TRAFFIC_LIGHT_Y_SEQUOIA
    }
}

#[cfg(target_os = "macos")]
unsafe fn apply_traffic_light_inset(window: &objc2_app_kit::NSWindow, x: f64, y: f64) {
    use objc2_app_kit::{NSView, NSWindowButton};

    let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) else {
        return;
    };
    let Some(miniaturize) = window.standardWindowButton(NSWindowButton::MiniaturizeButton) else {
        return;
    };
    let Some(zoom) = window.standardWindowButton(NSWindowButton::ZoomButton) else {
        return;
    };

    let Some(title_bar_container_view) = unsafe { close.superview() }
        .and_then(|title_bar_view| unsafe { title_bar_view.superview() })
    else {
        return;
    };

    let close_rect = NSView::frame(&close);
    let title_bar_frame_height = close_rect.size.height + y;

    let mut title_bar_rect = NSView::frame(&title_bar_container_view);
    title_bar_rect.size.height = title_bar_frame_height;
    title_bar_rect.origin.y = window.frame().size.height - title_bar_frame_height;
    title_bar_container_view.setFrame(title_bar_rect);

    static BASE_TRAFFIC_LIGHT_CLOSE_Y: std::sync::OnceLock<f64> = std::sync::OnceLock::new();
    let base_close_y = *BASE_TRAFFIC_LIGHT_CLOSE_Y.get_or_init(|| close_rect.origin.y);

    let space_between = NSView::frame(&miniaturize).origin.x - close_rect.origin.x;
    for (index, button) in [close, miniaturize, zoom].into_iter().enumerate() {
        let mut rect = NSView::frame(&button);
        rect.origin.x = x + (index as f64 * space_between);

        if is_tahoe_or_newer() {
            rect.origin.y = base_close_y - (y - TRAFFIC_LIGHT_Y_SEQUOIA);
        }

        button.setFrameOrigin(rect.origin);
    }
}

#[cfg(target_os = "macos")]
fn apply_traffic_light_position(window: &tauri::WebviewWindow, y: f64) {
    if let Ok(ns_window_ptr) = window.ns_window() {
        unsafe {
            let ns_window_ref = &*(ns_window_ptr as *const objc2_app_kit::NSWindow);
            apply_traffic_light_inset(ns_window_ref, TRAFFIC_LIGHT_X, y);
        }
    }
}

pub fn run() {
    let pty_manager: terminal::SharedManager = Arc::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ServerState::new())
        .manage(pty_manager)
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use objc2_app_kit::{
                    NSAppearance, NSAppearanceCustomization, NSAppearanceNameDarkAqua, NSWindow,
                };
                use objc2_foundation::MainThreadMarker;
                use window_vibrancy::{
                    apply_liquid_glass, apply_vibrancy, NSGlassEffectViewStyle,
                    NSVisualEffectMaterial, NSVisualEffectState,
                };

                if let Some(window) = app.get_webview_window("main") {
                    let _mtm = MainThreadMarker::new().expect("must be on main thread");
                    let traffic_light_y = macos_traffic_light_y();
                    apply_traffic_light_position(&window, traffic_light_y);

                    let window_for_resize = window.clone();
                    window.on_window_event(move |event| {
                        if matches!(
                            event,
                            tauri::WindowEvent::Resized(_)
                                | tauri::WindowEvent::ThemeChanged(_)
                                | tauri::WindowEvent::Focused(_)
                        ) {
                            apply_traffic_light_position(&window_for_resize, traffic_light_y);
                        }
                    });

                    // Force dark appearance
                    if let Ok(ns_window_ptr) = window.ns_window() {
                        unsafe {
                            // We cast to *const NSWindow and rely on objc2 references
                            let ns_window_ref = &*(ns_window_ptr as *const NSWindow);

                            let appearance =
                                NSAppearance::appearanceNamed(NSAppearanceNameDarkAqua)
                                    .expect("failed to get dark appearance");
                            ns_window_ref.setAppearance(Some(&appearance));
                            // Apply liquid glass effect (macOS 26+) or fall back to vibrancy
                            ns_window_ref.setOpaque(false);
                            if let Err(e) = apply_liquid_glass(
                                &window,
                                NSGlassEffectViewStyle::Sidebar,
                                None,
                                None,
                            ) {
                                eprintln!("Liquid glass not available: {e}");
                                // Fall back to NSVisualEffectView vibrancy (macOS 10.14+)
                                if let Err(e2) = apply_vibrancy(
                                    &window,
                                    NSVisualEffectMaterial::UnderWindowBackground,
                                    Some(NSVisualEffectState::Active),
                                    None,
                                ) {
                                    eprintln!(
                                        "Vibrancy fallback also failed: {e2}, making window opaque"
                                    );
                                    ns_window_ref.setOpaque(true);
                                    ns_window_ref.setBackgroundColor(Some(
                                        &objc2_app_kit::NSColor::colorWithSRGBRed_green_blue_alpha(
                                            0.09, 0.09, 0.09, 1.0,
                                        ),
                                    ));
                                }
                            }
                        }
                    }

                    apply_traffic_light_position(&window, traffic_light_y);
                }
            }

            if cfg!(debug_assertions) {
                spawn_dev_server(app.handle());
            } else {
                let handle = app.handle().clone();

                let resource_dir = app
                    .path()
                    .resource_dir()
                    .expect("Failed to resolve resource dir");

                // Resolve bundled paths for the compiled server sidecar.
                let pi_package_dir = resource_dir.join("pi-agent");
                let rg_path = resource_dir.join("binaries").join("rg");

                tauri::async_runtime::spawn(async move {
                    let (mut rx, _child) = handle
                        .shell()
                        .sidecar("server")
                        .expect("Failed to create server sidecar command")
                        .env("PI_PACKAGE_DIR", pi_package_dir.to_string_lossy().as_ref())
                        .env("RG_PATH", rg_path.to_string_lossy().as_ref())
                        .spawn()
                        .expect("Failed to spawn server sidecar");

                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(bytes) => {
                                let line = String::from_utf8_lossy(&bytes);
                                let line = line.trim();

                                if line.is_empty() {
                                    continue;
                                }

                                if let Some(info) = extract_server_info(line) {
                                    if let Some(state) = handle.try_state::<ServerState>() {
                                        state.set_port(info.port);
                                        state.set_token(info.token.clone());
                                    }

                                    if let Err(err) = handle.emit("server-info-changed", &info) {
                                        eprintln!("Failed to emit server info event: {err}");
                                    }

                                    println!("Server listening on port {}", info.port);
                                    continue;
                                }

                                println!("Server: {line}");
                            }
                            CommandEvent::Stderr(bytes) => {
                                let line = String::from_utf8_lossy(&bytes);
                                eprintln!("Server stderr: {}", line.trim());
                            }
                            CommandEvent::Error(err) => {
                                eprintln!("Server error: {err}");
                            }
                            CommandEvent::Terminated(payload) => {
                                eprintln!("Server terminated with code: {:?}", payload.code);
                                break;
                            }
                            _ => {}
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_cwd,
            get_server_info,
            toggle_devtools,
            terminal::spawn_pty,
            terminal::write_to_pty,
            terminal::resize_pty,
            terminal::close_pty
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn spawn_dev_server(handle: &tauri::AppHandle) {
    // Kill previous server if still running
    if let Some(state) = handle.try_state::<ServerState>() {
        if let Some(old_child) = state.take_child() {
            let _ = old_child.kill();
        }
        state.clear_port();
        state.clear_token();
    }

    println!("Starting dev server...");

    let (mut rx, child) = handle
        .shell()
        .command("bun")
        .args(["run", "dev"])
        .current_dir("../packages/server")
        .spawn()
        .expect("Failed to spawn dev server");

    if let Some(state) = handle.try_state::<ServerState>() {
        state.set_child(child);
    }

    let handle = handle.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    let line = line.trim();

                    if line.is_empty() {
                        continue;
                    }

                    if let Some(info) = extract_server_info(line) {
                        if let Some(state) = handle.try_state::<ServerState>() {
                            state.set_port(info.port);
                            state.set_token(info.token.clone());
                        }

                        if let Err(err) = handle.emit("server-info-changed", &info) {
                            eprintln!("Failed to emit server info event: {err}");
                        }

                        println!("Server listening on port {}", info.port);
                        continue;
                    }

                    println!("Server: {line}");
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    eprintln!("Server stderr: {}", line.trim());
                }
                CommandEvent::Error(err) => {
                    eprintln!("Server error: {err}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!(
                        "Dev server terminated with code: {:?}. Restarting...",
                        payload.code
                    );
                    spawn_dev_server(&handle);
                    break;
                }
                _ => {}
            }
        }
    });
}

fn extract_server_info(line: &str) -> Option<ServerInfo> {
    let maybe_json = line.strip_prefix("Server: ").unwrap_or(line);
    let json: Value = serde_json::from_str(maybe_json).ok()?;
    let port = json
        .get("port")
        .and_then(|p| p.as_u64())
        .and_then(|p| u16::try_from(p).ok())?;
    let token = json
        .get("token")
        .and_then(|t| t.as_str())
        .map(String::from)?;
    Some(ServerInfo { port, token })
}
