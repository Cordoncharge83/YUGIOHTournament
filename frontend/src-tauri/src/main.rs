#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    fs,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

#[cfg(not(debug_assertions))]
use std::collections::HashMap;

use tauri::Manager;

#[derive(serde::Deserialize, serde::Serialize, Default)]
struct LocalSettings {
    kts_executable_path: Option<String>,
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct BackendProcess {
    child: Mutex<Option<Child>>,
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_kts_executable_path,
            set_kts_executable_path,
            clear_kts_executable_path,
            launch_kts,
            read_tournament_backup_file,
            write_tournament_backup_file,
        ])
        .setup(|app| {
            let backend_child = start_backend(app);
            app.manage(BackendProcess {
                child: Mutex::new(backend_child),
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            stop_backend_if_started(&app_handle.state::<BackendProcess>());
        }
    });
}

#[tauri::command]
fn get_kts_executable_path() -> Result<Option<String>, String> {
    Ok(read_local_settings()?.kts_executable_path)
}

#[tauri::command]
fn set_kts_executable_path(path: String) -> Result<String, String> {
    let executable_path = validate_kts_executable_path(&path)?;
    let mut settings = read_local_settings()?;
    settings.kts_executable_path = Some(executable_path.clone());
    write_local_settings(&settings)?;
    Ok(executable_path)
}

#[tauri::command]
fn clear_kts_executable_path() -> Result<(), String> {
    let mut settings = read_local_settings()?;
    settings.kts_executable_path = None;
    write_local_settings(&settings)
}

#[tauri::command]
fn launch_kts(path: String) -> Result<(), String> {
    let executable_path = validate_kts_executable_path(&path)?;
    let mut command = Command::new(executable_path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command.spawn().map(|_| ()).map_err(|error| format!("Could not launch KTS: {error}"))
}

#[tauri::command]
fn read_tournament_backup_file(path: String) -> Result<String, String> {
    let backup_path = validate_backup_file_path(&path, false)?;
    fs::read_to_string(&backup_path).map_err(|error| format!("Could not read tournament backup: {error}"))
}

#[tauri::command]
fn write_tournament_backup_file(path: String, contents: String) -> Result<(), String> {
    let backup_path = validate_backup_file_path(&path, true)?;
    fs::write(&backup_path, contents).map_err(|error| format!("Could not write tournament backup: {error}"))
}

fn start_backend(app: &tauri::App) -> Option<Child> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        return start_backend_for_dev();
    }

    #[cfg(not(debug_assertions))]
    {
        start_backend_for_release(app)
    }
}

#[cfg(debug_assertions)]
fn start_backend_for_dev() -> Option<Child> {
    if backend_port_is_open() {
        println!("FastAPI backend already appears to be running on 127.0.0.1:8000; not starting another process.");
        return None;
    }

    let backend_dir = repo_root().join("backend");
    let venv_python = backend_dir.join(".venv").join("Scripts").join("python.exe");
    let app_data_dir = desktop_app_data_dir();
    if let Err(error) = ensure_desktop_app_data_dir(&app_data_dir) {
        eprintln!(
            "Could not prepare desktop app data directory {}: {error}",
            app_data_dir.display()
        );
        return None;
    }
    let database_url = sqlite_database_url(&app_data_dir.join("app.db"));

    let mut command = if venv_python.exists() {
        let mut command = Command::new(venv_python);
        command.arg("-m").arg("uvicorn");
        command
    } else {
        Command::new("uvicorn")
    };

    command
        .arg("app.main:app")
        .arg("--reload")
        .current_dir(&backend_dir)
        .env("APP_DATA_DIR", &app_data_dir)
        .env("DATABASE_URL", &database_url)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    match command.spawn() {
        Ok(child) => {
            println!(
                "Started FastAPI backend dev process from {} on http://127.0.0.1:8000.",
                backend_dir.display()
            );
            println!(
                "Desktop app data directory: {}. SQLite database: {}.",
                app_data_dir.display(),
                app_data_dir.join("app.db").display()
            );
            wait_for_backend_port();
            Some(child)
        }
        Err(error) => {
            eprintln!("Could not start FastAPI backend dev process: {error}");
            None
        }
    }
}

#[cfg(not(debug_assertions))]
fn start_backend_for_release(app: &tauri::App) -> Option<Child> {
    if backend_port_is_open() {
        return None;
    }

    let app_data_dir = desktop_app_data_dir();
    if ensure_desktop_app_data_dir(&app_data_dir).is_err() {
        return None;
    }

    let resource_dir = match app.path().resource_dir() {
        Ok(path) => path,
        Err(_) => return None,
    };
    let backend_exe = release_backend_exe_path(&resource_dir);
    if !backend_exe.exists() {
        return None;
    }

    let database_url = sqlite_database_url(&app_data_dir.join("app.db"));
    let stdout = backend_log_stdio(&app_data_dir, "backend.out.log");
    let stderr = backend_log_stdio(&app_data_dir, "backend.err.log");
    let publishing_env = read_release_publishing_env(&app_data_dir);

    let mut command = Command::new(backend_exe);
    command
        .env("APP_DATA_DIR", &app_data_dir)
        .env("DATABASE_URL", &database_url)
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr);

    for key in [
        "PUBLIC_SERVICE_URL",
        "PUBLIC_SITE_URL",
        "PUBLIC_PUBLISH_KEY",
    ] {
        if let Some(value) = publishing_env.get(key) {
            command.env(key, value);
        }
    }

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    match command.spawn() {
        Ok(child) => {
            wait_for_backend_port();
            Some(child)
        }
        Err(_) => None,
    }
}

fn stop_backend_if_started(backend_process: &BackendProcess) {
    let Ok(mut child_slot) = backend_process.child.lock() else {
        return;
    };

    let Some(mut child) = child_slot.take() else {
        return;
    };

    println!("Stopping FastAPI backend process started by Tauri.");

    #[cfg(windows)]
    {
        let status = Command::new("taskkill")
            .arg("/PID")
            .arg(child.id().to_string())
            .arg("/T")
            .arg("/F")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        if status.is_err() {
            let _ = child.kill();
        }
    }

    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }

    let _ = child.wait();
}

fn backend_port_is_open() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], 8000));
    TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

fn wait_for_backend_port() {
    for _ in 0..20 {
        if backend_port_is_open() {
            return;
        }

        std::thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(debug_assertions)]
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|frontend_dir| frontend_dir.parent())
        .map(PathBuf::from)
        .expect("src-tauri must live inside the frontend directory")
}

fn desktop_app_data_dir() -> PathBuf {
    #[cfg(windows)]
    {
        return env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(env::temp_dir)
            .join("YuGiOhTournamentManager");
    }

    #[cfg(target_os = "macos")]
    {
        return env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(env::temp_dir)
            .join("Library")
            .join("Application Support")
            .join("YuGiOhTournamentManager");
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        return env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share")))
            .unwrap_or_else(env::temp_dir)
            .join("YuGiOhTournamentManager");
    }
}

fn ensure_desktop_app_data_dir(app_data_dir: &PathBuf) -> std::io::Result<()> {
    fs::create_dir_all(app_data_dir.join("logs"))?;

    let settings_path = app_data_dir.join("settings.json");
    if !settings_path.exists() {
        fs::write(settings_path, "{}\n")?;
    }

    let publishing_example_path = app_data_dir.join("publishing.env.example");
    if !publishing_example_path.exists() {
        fs::write(
            publishing_example_path,
            "PUBLIC_SERVICE_URL=https://your-worker.workers.dev\nPUBLIC_SITE_URL=https://your-public-site.pages.dev\nPUBLIC_PUBLISH_KEY=your-publish-key\n",
        )?;
    }

    Ok(())
}

fn local_settings_path() -> Result<PathBuf, String> {
    let app_data_dir = desktop_app_data_dir();
    ensure_desktop_app_data_dir(&app_data_dir)
        .map_err(|error| format!("Could not prepare app settings directory: {error}"))?;
    Ok(app_data_dir.join("settings.json"))
}

fn read_local_settings() -> Result<LocalSettings, String> {
    let settings_path = local_settings_path()?;
    let contents = fs::read_to_string(&settings_path).unwrap_or_else(|_| "{}".to_string());
    serde_json::from_str(&contents).map_err(|error| {
        format!(
            "Could not read local settings from {}: {error}",
            settings_path.display()
        )
    })
}

fn write_local_settings(settings: &LocalSettings) -> Result<(), String> {
    let settings_path = local_settings_path()?;
    let contents = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Could not serialize local settings: {error}"))?;
    fs::write(&settings_path, format!("{contents}\n")).map_err(|error| {
        format!(
            "Could not save local settings to {}: {error}",
            settings_path.display()
        )
    })
}

fn validate_kts_executable_path(path: &str) -> Result<String, String> {
    let executable_path = PathBuf::from(path.trim());
    if executable_path.as_os_str().is_empty() {
        return Err("Choose the KTS executable first.".to_string());
    }

    if !executable_path.exists() {
        return Err("The configured KTS executable does not exist.".to_string());
    }

    if !executable_path.is_file() {
        return Err("The configured KTS path must point to a file.".to_string());
    }

    if !has_exe_extension(&executable_path) {
        return Err("Choose a Windows .exe file for KTS.".to_string());
    }

    Ok(executable_path.to_string_lossy().to_string())
}

fn validate_backup_file_path(path: &str, allow_missing: bool) -> Result<PathBuf, String> {
    let backup_path = PathBuf::from(path.trim());
    if backup_path.as_os_str().is_empty() {
        return Err("Choose a tournament backup file first.".to_string());
    }

    if !allow_missing && !backup_path.exists() {
        return Err("The selected tournament backup does not exist.".to_string());
    }

    if backup_path.exists() && !backup_path.is_file() {
        return Err("The selected tournament backup path must point to a file.".to_string());
    }

    let file_name = backup_path
        .file_name()
        .and_then(|file_name| file_name.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !(file_name.ends_with(".json")
        || file_name.ends_with(".ygotournament.json")
        || file_name.ends_with(".tournament-backup.json"))
    {
        return Err("Use a .json tournament backup file.".to_string());
    }

    Ok(backup_path)
}

fn has_exe_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("exe"))
        .unwrap_or(false)
}

fn sqlite_database_url(database_path: &PathBuf) -> String {
    let normalized_path = database_path.to_string_lossy().replace('\\', "/");
    format!("sqlite:///{normalized_path}")
}

#[cfg(not(debug_assertions))]
fn release_backend_exe_path(resource_dir: &PathBuf) -> PathBuf {
    let onedir_exe = resource_dir
        .join("backend")
        .join("yugioh-backend")
        .join("yugioh-backend.exe");
    if onedir_exe.exists() {
        return onedir_exe;
    }

    resource_dir.join("backend").join("yugioh-backend.exe")
}

#[cfg(not(debug_assertions))]
fn backend_log_stdio(app_data_dir: &PathBuf, file_name: &str) -> Stdio {
    let log_path = app_data_dir.join("logs").join(file_name);
    match fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        Ok(file) => Stdio::from(file),
        Err(_) => Stdio::null(),
    }
}

#[cfg(not(debug_assertions))]
fn read_release_publishing_env(app_data_dir: &PathBuf) -> HashMap<String, String> {
    let publishing_env_path = app_data_dir.join("publishing.env");
    let Ok(contents) = fs::read_to_string(publishing_env_path) else {
        return HashMap::new();
    };

    contents
        .lines()
        .filter_map(parse_env_line)
        .filter(|(key, _)| {
            matches!(
                key.as_str(),
                "PUBLIC_SERVICE_URL" | "PUBLIC_SITE_URL" | "PUBLIC_PUBLISH_KEY"
            )
        })
        .collect()
}

#[cfg(not(debug_assertions))]
fn parse_env_line(line: &str) -> Option<(String, String)> {
    let trimmed_line = line.trim();
    if trimmed_line.is_empty() || trimmed_line.starts_with('#') {
        return None;
    }

    let (key, raw_value) = trimmed_line.split_once('=')?;
    let key = key.trim();
    if key.is_empty() {
        return None;
    }

    Some((key.to_string(), unquote_env_value(raw_value.trim())))
}

#[cfg(not(debug_assertions))]
fn unquote_env_value(value: &str) -> String {
    if value.len() >= 2 {
        let first = value.as_bytes()[0];
        let last = value.as_bytes()[value.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return value[1..value.len() - 1].to_string();
        }
    }

    value.to_string()
}
