use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

mod terminal;

pub struct ServerState {
    port: Mutex<Option<u16>>,
    child: Mutex<Option<CommandChild>>,
}

impl ServerState {
    fn new() -> Self {
        Self {
            port: Mutex::new(None),
            child: Mutex::new(None),
        }
    }

    fn set_port(&self, port: u16) {
        if let Ok(mut guard) = self.port.lock() {
            *guard = Some(port);
        }
    }

    fn clear_port(&self) {
        if let Ok(mut guard) = self.port.lock() {
            *guard = None;
        }
    }

    fn port(&self) -> Option<u16> {
        self.port.lock().ok().and_then(|guard| *guard)
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

#[tauri::command]
fn get_server_port(state: State<'_, ServerState>) -> Result<u16, String> {
    state
        .port()
        .ok_or_else(|| "Server not ready".to_string())
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

pub fn run() {
    let pty_manager: terminal::SharedManager = Arc::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ServerState::new())
        .manage(pty_manager)
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use objc2_app_kit::{NSAppearance, NSAppearanceCustomization, NSAppearanceNameDarkAqua, NSWindow};
                use objc2_foundation::MainThreadMarker;
                use window_vibrancy::{apply_liquid_glass, NSGlassEffectViewStyle};

                if let Some(window) = app.get_webview_window("main") {
                    let _mtm = MainThreadMarker::new().expect("must be on main thread");

                    // Force dark appearance
                    if let Ok(ns_window_ptr) = window.ns_window() {
                        unsafe {
                            // We cast to *const NSWindow and rely on objc2 references
                            let ns_window_ref = &*(ns_window_ptr as *const NSWindow);
                            let appearance = NSAppearance::appearanceNamed(NSAppearanceNameDarkAqua)
                                .expect("failed to get dark appearance");
                            ns_window_ref.setAppearance(Some(&appearance));
                            // Apply liquid glass effect (macOS 26+) or fall back gracefully
                            ns_window_ref.setOpaque(false);
                            if let Err(e) = apply_liquid_glass(&window, NSGlassEffectViewStyle::Sidebar, None, None) {
                                eprintln!("Liquid glass not available: {e}");
                            }
                        }
                    }
                }
            }

            if cfg!(debug_assertions) {
                spawn_dev_server(app.handle());
            } else {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let (mut rx, _child) = handle
                        .shell()
                        .sidecar("server")
                        .expect("Failed to create server sidecar command")
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

                                if let Some(port) = extract_port(line) {
                                    if let Some(state) = handle.try_state::<ServerState>() {
                                        state.set_port(port);
                                    }

                                    if let Err(err) = handle.emit("server-port-changed", &port) {
                                        eprintln!("Failed to emit port change event: {err}");
                                    }

                                    println!("Server listening on port {port}");
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
            get_server_port,
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

                    if let Some(port) = extract_port(line) {
                        if let Some(state) = handle.try_state::<ServerState>() {
                            state.set_port(port);
                        }

                        if let Err(err) = handle.emit("server-port-changed", &port) {
                            eprintln!("Failed to emit port change event: {err}");
                        }

                        println!("Server listening on port {port}");
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
                    eprintln!("Dev server terminated with code: {:?}. Restarting...", payload.code);
                    spawn_dev_server(&handle);
                    break;
                }
                _ => {}
            }
        }
    });
}

fn extract_port(line: &str) -> Option<u16> {
    let maybe_json = line.strip_prefix("Server: ").unwrap_or(line);
    serde_json::from_str::<Value>(maybe_json)
        .ok()
        .and_then(|json| json.get("port").and_then(|p| p.as_u64()))
        .and_then(|port| u16::try_from(port).ok())
}
