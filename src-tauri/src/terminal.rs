use portable_pty::{
    cmdbuilder::CommandBuilder, native_pty_system, Child, ExitStatus, MasterPty, PtySize,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

pub type SharedManager = Arc<PtyManager>;

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct SpawnOptions {
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
    shell: Option<String>,
    env: Option<HashMap<String, String>>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, Arc<PtyEntry>>>,
}

impl PtyManager {
    fn insert(&self, id: String, entry: Arc<PtyEntry>) {
        self.sessions.lock().unwrap().insert(id, entry);
    }

    fn get(&self, id: &str) -> Option<Arc<PtyEntry>> {
        self.sessions.lock().unwrap().get(id).cloned()
    }

    fn remove(&self, id: &str) -> Option<Arc<PtyEntry>> {
        self.sessions.lock().unwrap().remove(id)
    }
}

struct PtyEntry {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send>>,
}

impl PtyEntry {
    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        self.master
            .lock()
            .unwrap()
            .resize(size)
            .map_err(|err| err.to_string())
    }

    fn write(&self, data: &[u8]) -> std::io::Result<()> {
        let mut writer = self.writer.lock().unwrap();
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }

    fn kill(&self) -> std::io::Result<()> {
        self.child.lock().unwrap().kill()
    }

    fn try_wait(&self) -> std::io::Result<Option<ExitStatus>> {
        self.child.lock().unwrap().try_wait()
    }
}

#[derive(Clone, Serialize)]
pub struct PtyDataPayload {
    id: String,
    data: String,
}

#[derive(Clone, Serialize)]
pub struct PtyExitPayload {
    id: String,
    code: u32,
    message: Option<String>,
}

#[derive(Serialize)]
pub struct SpawnResponse {
    id: String,
}

#[tauri::command]
pub fn spawn_pty(
    app: AppHandle,
    state: State<'_, SharedManager>,
    options: Option<SpawnOptions>,
) -> Result<SpawnResponse, String> {
    let manager = Arc::clone(&state);
    let options = options.unwrap_or_default();
    let id = Uuid::new_v4().to_string();
    let initial_rows = options.rows.unwrap_or(24);
    let initial_cols = options.cols.unwrap_or(80);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: initial_rows,
            cols: initial_cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| err.to_string())?;

    let command = build_shell_command(&options);

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|err| err.to_string())?;

    let master = pair.master;
    let reader = master.try_clone_reader().map_err(|err| err.to_string())?;
    let writer = master.take_writer().map_err(|err| err.to_string())?;

    let entry = Arc::new(PtyEntry {
        master: Mutex::new(master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
    });

    manager.insert(id.clone(), Arc::clone(&entry));

    spawn_reader_thread(&app, id.clone(), reader);
    spawn_exit_observer(app, manager, id.clone(), entry);

    Ok(SpawnResponse { id })
}

#[tauri::command]
pub fn write_to_pty(
    state: State<'_, SharedManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    let manager = Arc::clone(&state);
    let entry = manager
        .get(&id)
        .ok_or_else(|| format!("Unknown PTY session: {id}"))?;

    entry.write(data.as_bytes()).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn resize_pty(
    state: State<'_, SharedManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let manager = Arc::clone(&state);
    let entry = manager
        .get(&id)
        .ok_or_else(|| format!("Unknown PTY session: {id}"))?;

    entry.resize(rows, cols)
}

#[tauri::command]
pub fn close_pty(state: State<'_, SharedManager>, id: String) -> Result<(), String> {
    let manager = Arc::clone(&state);
    if let Some(entry) = manager.remove(&id) {
        if let Err(err) = entry.kill() {
            match err.kind() {
                std::io::ErrorKind::InvalidInput
                | std::io::ErrorKind::NotFound
                | std::io::ErrorKind::BrokenPipe
                | std::io::ErrorKind::WouldBlock => {}
                _ => return Err(err.to_string()),
            }
        }
    }
    Ok(())
}

fn spawn_reader_thread(app: &AppHandle, id: String, mut reader: Box<dyn Read + Send>) {
    let app_handle = app.clone();
    thread::spawn(move || {
        let mut buffer = vec![0u8; 65536];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(len) => {
                    let data = String::from_utf8_lossy(&buffer[..len]).to_string();
                    let payload = PtyDataPayload {
                        id: id.clone(),
                        data,
                    };
                    let _ = app_handle.emit("pty://data", payload);
                }
                Err(err) => {
                    let payload = PtyDataPayload {
                        id: id.clone(),
                        data: format!("\u{1b}[31mPTY read error: {err}\u{1b}[0m\r\n"),
                    };
                    let _ = app_handle.emit("pty://data", payload);
                    break;
                }
            }
        }
    });
}

fn spawn_exit_observer(app: AppHandle, manager: SharedManager, id: String, entry: Arc<PtyEntry>) {
    thread::spawn(move || {
        let exit_status = loop {
            match entry.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => thread::sleep(Duration::from_millis(100)),
                Err(err) => break Err(err),
            }
        };

        let payload = match exit_status {
            Ok(status) => {
                let message = if status.success() {
                    None
                } else {
                    Some(status.to_string())
                };
                PtyExitPayload {
                    id: id.clone(),
                    code: status.exit_code(),
                    message,
                }
            }
            Err(err) => PtyExitPayload {
                id: id.clone(),
                code: 1,
                message: Some(format!("error: {err}")),
            },
        };

        manager.remove(&id);
        let _ = app.emit("pty://exit", payload);
    });
}

fn build_shell_command(options: &SpawnOptions) -> CommandBuilder {
    #[cfg(windows)]
    let (shell_path, add_default_args) = {
        let default_shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
        let shell = options
            .shell
            .clone()
            .unwrap_or_else(|| default_shell.clone());
        let add_args = options.shell.is_none();
        (shell, add_args)
    };

    #[cfg(not(windows))]
    let (shell_path, add_default_args) = {
        use std::path::Path;

        let shell = options
            .shell
            .clone()
            .or_else(|| std::env::var("SHELL").ok())
            .filter(|path| !path.is_empty())
            .or_else(|| {
                ["/bin/zsh", "/bin/bash", "/bin/sh"]
                    .iter()
                    .find(|path| Path::new(path).exists())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "/bin/sh".to_string());

        (shell, true)
    };

    let mut builder = CommandBuilder::new(shell_path.clone());

    #[cfg(windows)]
    if add_default_args {
        builder.args(["/Q", "/K"]);
    }

    #[cfg(not(windows))]
    if add_default_args {
        builder.arg("-l");
    }

    if let Some(cwd) = &options.cwd {
        builder.cwd(cwd);
    }

    builder.env("TERM", "xterm-256color");
    builder.env("COLORTERM", "truecolor");
    builder.env("TERM_PROGRAM", "diffs");
    builder.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    builder.env("SHELL", &shell_path);
    builder.env("FORCE_COLOR", "1");
    builder.env("CLICOLOR", "1");
    builder.env("CLICOLOR_FORCE", "1");

    if let Some(env_map) = &options.env {
        for (key, value) in env_map {
            builder.env(key, value);
        }
    }

    builder
}

