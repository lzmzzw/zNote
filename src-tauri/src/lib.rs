mod commands;
mod document;
mod recovery;
use commands::{native_export, native_open, native_save};
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
const ASSOCIATED_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "json", "jsonc", "geojson", "csv", "log", "yaml", "yml", "toml",
    "xml", "html", "css", "js", "ts", "rs", "sql",
];

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
        let supported = path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| {
                ASSOCIATED_EXTENSIONS
                    .iter()
                    .any(|item| ext.eq_ignore_ascii_case(item))
            });
        if supported && path.is_file() && !pending.contains(&path) {
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
) -> Result<OpenedDocuments, String> {
    let paths = std::mem::take(&mut *requests.0.lock().map_err(|_| "待打开文件状态不可用")?);
    blocking(move || {
        let mut result = OpenedDocuments {
            documents: Vec::new(),
            errors: Vec::new(),
        };
        for path in paths {
            match document::read(&path) {
                Ok(doc) => result.documents.push(doc),
                Err(error) => result.errors.push(format!(
                    "{}: {error}",
                    path.file_name().unwrap_or_default().to_string_lossy()
                )),
            }
        }
        Ok(result)
    })
    .await
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
                let _ = window.set_focus();
            }
        }))
        .manage(Access::default())
        .manage(Writes::default())
        .manage(OpenRequests::default())
        .setup(|app| {
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
            native_export,
            recovery_load,
            recovery_save
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 zNote");
}

#[cfg(test)]
mod association_tests {
    use super::*;

    #[test]
    fn queues_only_existing_supported_text_files() {
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
                dir.path().join("query.sql")
            ]
        );
    }

    #[test]
    fn installer_associations_match_openable_extensions() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let extensions = config["bundle"]["fileAssociations"][0]["ext"]
            .as_array()
            .unwrap();
        let configured: Vec<&str> = extensions
            .iter()
            .map(|value| value.as_str().unwrap())
            .collect();
        assert_eq!(configured, ASSOCIATED_EXTENSIONS);
    }
}
