#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    fs,
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

use tauri::Manager;

struct BackendProcess {
    child: Mutex<Option<Child>>,
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Development proof of concept only:
            // In Tauri dev mode, start the existing FastAPI backend from the repo.
            // This is not final desktop packaging and intentionally does not bundle Python.
            let backend_child = start_backend_for_dev();
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

fn start_backend_for_dev() -> Option<Child> {
    #[cfg(not(debug_assertions))]
    {
        None
    }

    #[cfg(debug_assertions)]
    {
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
}

fn stop_backend_if_started(backend_process: &BackendProcess) {
    let Ok(mut child_slot) = backend_process.child.lock() else {
        return;
    };

    let Some(mut child) = child_slot.take() else {
        return;
    };

    println!("Stopping FastAPI backend dev process started by Tauri.");

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

    Ok(())
}

fn sqlite_database_url(database_path: &PathBuf) -> String {
    let normalized_path = database_path.to_string_lossy().replace('\\', "/");
    format!("sqlite:///{normalized_path}")
}
