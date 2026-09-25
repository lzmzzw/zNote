mod document;
use document::Document;
use std::{collections::HashSet, path::PathBuf, sync::Mutex};
use tauri::{Manager, State};
#[derive(Default)]
struct Access(Mutex<HashSet<PathBuf>>);
#[tauri::command]
async fn native_open(access: State<'_, Access>) -> Result<Option<Document>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter(
            "文本 / Markdown",
            &[
                "md", "markdown", "txt", "json", "yaml", "yml", "toml", "csv", "log", "rs", "ts",
                "js", "html", "css",
            ],
        )
        .add_filter("所有文件", &["*"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    let doc = document::read(&path)?;
    access.0.lock().map_err(|_| "路径状态不可用")?.insert(path);
    Ok(Some(doc))
}
#[tauri::command]
async fn native_save(
    access: State<'_, Access>,
    path: Option<String>,
    text: String,
    encoding: String,
    bom: bool,
    line_ending: String,
    revision: Option<String>,
    save_as: bool,
) -> Result<Option<Document>, String> {
    let bytes = document::encode(&text, &encoding, bom, &line_ending)?;
    let old = path.map(PathBuf::from);
    let selected = save_as || old.is_none();
    let dest = if selected {
        let mut dialog = rfd::AsyncFileDialog::new()
            .add_filter("Markdown", &["md"])
            .add_filter("文本", &["txt"]);
        if let Some(p) = &old {
            if let Some(n) = p.file_name() {
                dialog = dialog.set_file_name(n.to_string_lossy());
            }
        } else {
            dialog = dialog.set_file_name("未命名.md");
        }
        let Some(file) = dialog.save_file().await else {
            return Ok(None);
        };
        file.path().to_path_buf()
    } else {
        old.clone().unwrap()
    };
    if !selected
        && !access
            .0
            .lock()
            .map_err(|_| "路径状态不可用")?
            .contains(&dest)
    {
        return Err("请通过打开或另存为对话框选择文件".into());
    }
    let current = document::disk_revision(&dest)?;
    if !selected || old.as_ref() == Some(&dest) {
        if current.is_none() || revision != current {
            return Err("文件已被外部修改或删除。请重新打开或另存为，避免覆盖外部修改。".into());
        }
    }
    document::guarded_write(&dest, &bytes, current.as_deref())?;
    access
        .0
        .lock()
        .map_err(|_| "路径状态不可用")?
        .insert(dest.clone());
    Ok(Some(Document {
        path: dest.to_string_lossy().into_owned(),
        text,
        encoding,
        bom,
        line_ending,
        revision: document::revision(&bytes),
    }))
}
#[tauri::command]
async fn native_export(name: String, format: String, bytes: Vec<u8>) -> Result<bool, String> {
    let (extension, label) = match format.as_str() {
        "docx" => ("docx", "Word 文档"),
        "pdf" => ("pdf", "PDF 文档"),
        _ => return Err("不支持的导出格式".into()),
    };
    if bytes.is_empty() || bytes.len() > 40 * 1024 * 1024 {
        return Err("导出文件为空或超过 40 MB 限制".into());
    }
    let stem = std::path::Path::new(&name)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("未命名");
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter(label, &[extension])
        .set_file_name(format!("{stem}.{extension}"))
        .save_file()
        .await
    else {
        return Ok(false);
    };
    let path = file.path();
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case(extension))
        != Some(true)
    {
        return Err("导出文件扩展名与所选格式不一致".into());
    }
    document::atomic_write(path, &bytes)?;
    Ok(true)
}
fn recovery_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("recovery.json"))
}
#[tauri::command]
fn recovery_load(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let p = recovery_path(&app)?;
    if !p.exists() {
        return Ok(None);
    }
    let bytes = document::read_bytes(&p)?;
    if bytes.len() as u64 > document::MAX_BYTES {
        return Err("恢复数据过大".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn recovery_save(app: tauri::AppHandle, data: serde_json::Value) -> Result<(), String> {
    let p = recovery_path(&app)?;
    if data.is_null() {
        if p.exists() {
            std::fs::remove_file(p).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let bytes = serde_json::to_vec(&data).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > document::MAX_BYTES {
        return Err("恢复数据超过 20 MB 限制".into());
    }
    document::atomic_write(&p, &bytes)
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(Access::default())
        .invoke_handler(tauri::generate_handler![
            native_open,
            native_save,
            native_export,
            recovery_load,
            recovery_save
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 zNote");
}
