mod commands;
mod document;
#[cfg(any(target_os = "macos", test))]
mod macos;
mod recovery;
use commands::{native_export, native_make_writable, native_open, native_read_only, native_save};
use document::Document;
use recovery::{recovery_load, recovery_save};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, State};
#[derive(Default)]
struct Access(Arc<Mutex<HashSet<PathBuf>>>);

#[derive(Default)]
struct Writes(Arc<Mutex<()>>);

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("后台文件任务失败: {error}"))?
}
#[derive(Default)]
struct OpenRequests(Mutex<Vec<PathBuf>>);

fn queue_open_paths(
    requests: &OpenRequests,
    args: impl IntoIterator<Item = PathBuf>,
    cwd: &Path,
) -> bool {
    let Ok(mut pending) = requests.0.lock() else {
        return false;
    };
    let initial_len = pending.len();
    for arg in args {
        if pending.len() >= 16 {
            break;
        }
        let path = if arg.is_absolute() {
            arg
        } else {
            cwd.join(arg)
        };
        // 文件名不决定能否作为文本打开；实际读取仍执行大小和无损解码校验。
        if path.is_file() && !pending.contains(&path) {
            pending.push(path);
        }
    }
    pending.len() > initial_len
}

#[derive(serde::Serialize)]
struct OpenedDocuments {
    documents: Vec<Document>,
    errors: Vec<String>,
}

#[tauri::command]
async fn native_take_open_requests(
    requests: State<'_, OpenRequests>,
    access: State<'_, Access>,
) -> Result<OpenedDocuments, String> {
    let paths = std::mem::take(&mut *requests.0.lock().map_err(|_| "待打开文件状态不可用")?);
    let access = Access(access.0.clone());
    blocking(move || read_open_requests(paths, &access)).await
}

fn read_open_requests(paths: Vec<PathBuf>, access: &Access) -> Result<OpenedDocuments, String> {
    let mut result = OpenedDocuments {
        documents: Vec::new(),
        errors: Vec::new(),
    };
    for path in paths {
        match document::read(&path) {
            Ok(doc) => {
                access.0.lock().map_err(|_| "路径状态不可用")?.insert(path);
                result.documents.push(doc);
            }
            Err(error) => result.errors.push(format!(
                "{}: {error}",
                path.file_name().unwrap_or_default().to_string_lossy()
            )),
        }
    }
    Ok(result)
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if queue_open_paths(
                &app.state::<OpenRequests>(),
                args.into_iter().skip(1).map(PathBuf::from),
                Path::new(&cwd),
            ) {
                let _ = app.emit("associated-file-open", ());
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(Access::default())
        .manage(Writes::default())
        .manage(OpenRequests::default())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            macos::setup(app.handle())?;
            let cwd = std::env::current_dir()?;
            queue_open_paths(
                &app.state::<OpenRequests>(),
                std::env::args_os().skip(1).map(PathBuf::from),
                &cwd,
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            native_open,
            native_take_open_requests,
            native_save,
            native_read_only,
            native_make_writable,
            native_export,
            recovery_load,
            recovery_save
        ])
        .build(tauri::generate_context!())
        .expect("无法启动 zNote")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            macos::on_run_event(_app, &_event);
        });
}

#[cfg(test)]
mod association_tests {
    use super::*;

    #[test]
    fn associated_open_authorizes_only_successfully_read_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.txt");
        let binary = dir.path().join("binary.txt");
        std::fs::write(&path, "original").unwrap();
        std::fs::write(&binary, [0, 1, 2]).unwrap();
        let access = Access::default();
        let result = read_open_requests(vec![path.clone(), binary.clone()], &access).unwrap();
        assert_eq!(result.documents.len(), 1);
        assert_eq!(result.errors.len(), 1);
        let approved = access.0.lock().unwrap();
        assert!(approved.contains(&path));
        assert!(!approved.contains(&binary));
    }

    #[test]
    fn queues_existing_files_regardless_of_extension() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("note.MD"), "# Note").unwrap();
        std::fs::write(dir.path().join("map.geojson"), "{}").unwrap();
        std::fs::write(dir.path().join("query.sql"), "select 1;").unwrap();
        std::fs::write(dir.path().join("image.png"), "not an image").unwrap();
        let requests = OpenRequests::default();
        assert!(queue_open_paths(
            &requests,
            [
                PathBuf::from("note.MD"),
                PathBuf::from("map.geojson"),
                PathBuf::from("query.sql"),
                PathBuf::from("image.png"),
                PathBuf::from("missing.txt")
            ],
            dir.path()
        ));
        assert_eq!(
            requests.0.lock().unwrap().as_slice(),
            &[
                dir.path().join("note.MD"),
                dir.path().join("map.geojson"),
                dir.path().join("query.sql"),
                dir.path().join("image.png")
            ]
        );
    }

    #[test]
    fn opens_arbitrary_text_names_and_rejects_binary_content_at_read_time() {
        let dir = tempfile::tempdir().unwrap();
        let names = [
            "main.py",
            "app.yml",
            "app.yaml",
            "Dockerfile",
            "Main.java",
            ".env",
            "Makefile",
            "unknown.custom-text",
        ];
        for name in names {
            std::fs::write(dir.path().join(name), "文本内容\n").unwrap();
        }
        std::fs::write(dir.path().join("binary.py"), [0, 1, 2]).unwrap();
        let requests = OpenRequests::default();
        let mut paths: Vec<PathBuf> = names.iter().map(PathBuf::from).collect();
        paths.push(PathBuf::from("binary.py"));
        paths.push(PathBuf::from("Dockerfile"));
        paths.push(PathBuf::from("missing.py"));
        paths.push(dir.path().to_path_buf());
        assert!(queue_open_paths(&requests, paths, dir.path()));
        let queued = requests.0.lock().unwrap();
        assert_eq!(queued.len(), names.len() + 1);
        for path in &queued[..names.len()] {
            assert_eq!(document::read(path).unwrap().text, "文本内容\n");
        }
        assert!(document::read(queued.last().unwrap()).is_err());
    }

    #[test]
    fn windows_installer_does_not_declare_default_file_associations() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert!(config["bundle"].get("fileAssociations").is_none());
        assert_eq!(
            config["bundle"]["windows"]["nsis"]["installerHooks"],
            "windows/open-with.nsh"
        );
    }
}
