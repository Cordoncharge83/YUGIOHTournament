#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
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
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());

        match command.spawn() {
            Ok(child) => {
                println!(
                    "Started FastAPI backend dev process from {} on http://127.0.0.1:8000.",
                    backend_dir.display()
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
