use crate::{
    blocking,
    document::{self, Document},
    Access, Writes,
};
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub(crate) async fn native_open(access: State<'_, Access>) -> Result<Option<Document>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("文本 / Markdown", crate::ASSOCIATED_EXTENSIONS)
        .add_filter("所有文件", &["*"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    let access = access.0.clone();
    blocking(move || {
        let doc = document::read(&path)?;
        access.lock().map_err(|_| "路径状态不可用")?.insert(path);
        Ok(Some(doc))
    })
    .await
}
// 保留现有前端具名参数契约；State 参数由 Tauri 注入。
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub(crate) async fn native_save(
    access: State<'_, Access>,
    writes: State<'_, Writes>,
    path: Option<String>,
    name: String,
    text: String,
    encoding: String,
    bom: bool,
    line_ending: String,
    revision: Option<String>,
    save_as: bool,
) -> Result<Option<Document>, String> {
    let old = path.map(PathBuf::from);
    let selected = save_as || old.is_none();
    let dest = if selected {
        let extension = std::path::Path::new(&name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("txt");
        let mut dialog = rfd::AsyncFileDialog::new();
        dialog = match extension.to_ascii_lowercase().as_str() {
            "md" | "markdown" => dialog.add_filter("Markdown", &["md", "markdown"]),
            "json" | "jsonc" | "geojson" => {
                dialog.add_filter("JSON", &["json", "jsonc", "geojson"])
            }
            "csv" => dialog.add_filter("CSV", &["csv"]),
            "txt" => dialog.add_filter("文本", &["txt"]),
            other
                if !other.is_empty()
                    && other.len() <= 12
                    && other
                        .chars()
                        .all(|character| character.is_ascii_alphanumeric()) =>
            {
                dialog.add_filter("当前格式", &[other])
            }
            _ => dialog.add_filter("文本", &["txt"]),
        };
        if let Some(p) = &old {
            if let Some(n) = p.file_name() {
                dialog = dialog.set_file_name(n.to_string_lossy());
            }
        } else {
            dialog = dialog.set_file_name(name);
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
    let access = access.0.clone();
    let writes = writes.0.clone();
    blocking(move || {
        let bytes = document::encode(&text, &encoding, bom, &line_ending)?;
        save_bytes(
            &writes,
            &dest,
            &bytes,
            (!selected || old.as_ref() == Some(&dest)).then_some(revision.as_deref()),
        )?;
        access
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
    })
    .await
}
#[tauri::command]
pub(crate) async fn native_export(
    writes: State<'_, Writes>,
    name: String,
    format: String,
    bytes: Vec<u8>,
) -> Result<bool, String> {
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
    let path = path.to_path_buf();
    let writes = writes.0.clone();
    blocking(move || {
        let _write = writes.lock().map_err(|_| "文件写入状态不可用")?;
        document::atomic_write(&path, &bytes)?;
        Ok(true)
    })
    .await
}

// 同一进程内校验与替换串行化，避免两个旧版本保存同时通过检查。
fn save_bytes(
    writes: &std::sync::Mutex<()>,
    dest: &std::path::Path,
    bytes: &[u8],
    expected: Option<Option<&str>>,
) -> Result<(), String> {
    let _write = writes.lock().map_err(|_| "文件写入状态不可用")?;
    let current = document::disk_revision(dest)?;
    if let Some(expected) = expected {
        if current.is_none() || expected != current.as_deref() {
            return Err("文件已被外部修改或删除。请重新打开或另存为，避免覆盖外部修改。".into());
        }
    }
    document::guarded_write(dest, bytes, current.as_deref())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_saves_of_same_revision_have_one_winner() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("concurrent.txt");
        std::fs::write(&path, b"old").unwrap();
        let revision = document::revision(b"old");
        let writes = std::sync::Mutex::new(());
        let barrier = std::sync::Barrier::new(2);
        let results = std::thread::scope(|scope| {
            let handles: Vec<_> = [b"one", b"two"]
                .into_iter()
                .map(|bytes| {
                    let (path, revision, writes, barrier) = (&path, &revision, &writes, &barrier);
                    scope.spawn(move || {
                        barrier.wait();
                        save_bytes(writes, path, bytes, Some(Some(revision)))
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect::<Vec<_>>()
        });
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        let bytes = std::fs::read(&path).unwrap();
        assert!(bytes == b"one" || bytes == b"two");
    }
    #[test]
    fn deleted_document_is_not_silently_recreated() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("deleted.txt");
        assert!(save_bytes(
            &std::sync::Mutex::new(()),
            &path,
            b"new",
            Some(Some(&document::revision(b"old")))
        )
        .is_err());
        assert!(!path.exists());
    }
}
