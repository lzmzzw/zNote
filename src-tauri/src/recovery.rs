use crate::{blocking, document, Access};
use std::{
    io::Read,
    path::{Path, PathBuf},
};
use tauri::{Manager, State};

fn recovery_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("recovery.json"))
}
const MAX_SESSION_BYTES: u64 = 256 * 1024 * 1024;
fn read_recovery(path: &Path) -> Result<serde_json::Value, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_SESSION_BYTES {
        return Err("会话超过 256 MiB 限制".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_SESSION_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_SESSION_BYTES {
        return Err("会话超过 256 MiB 限制".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}
fn attach_approved_paths(data: &mut serde_json::Value, access: &Access) -> Result<(), String> {
    if let Some(session) = data.as_object_mut() {
        // 授权路径由原生层写入，前端不能通过会话参数自行授权路径。
        let paths: Vec<String> = access
            .0
            .lock()
            .map_err(|_| "路径状态不可用")?
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        session.insert("approvedPaths".into(), serde_json::json!(paths));
    }
    Ok(())
}
#[tauri::command]
pub(crate) async fn recovery_load(
    app: tauri::AppHandle,
    access: State<'_, Access>,
) -> Result<Option<serde_json::Value>, String> {
    let access = Access(access.0.clone());
    blocking(move || {
        let p = recovery_path(&app)?;
        if !p.exists() {
            return Ok(None);
        }
        let mut data = read_recovery(&p)?;
        if let Some(session) = data.as_object_mut() {
            if let Some(paths) = session
                .remove("approvedPaths")
                .and_then(|value| value.as_array().cloned())
            {
                let mut approved = access.0.lock().map_err(|_| "路径状态不可用")?;
                for path in paths {
                    if let Some(path) = path.as_str() {
                        approved.insert(PathBuf::from(path));
                    }
                }
            }
        }
        Ok(Some(data))
    })
    .await
}
#[tauri::command]
pub(crate) async fn recovery_save(
    app: tauri::AppHandle,
    access: State<'_, Access>,
    data: serde_json::Value,
) -> Result<(), String> {
    let access = Access(access.0.clone());
    blocking(move || {
        let p = recovery_path(&app)?;
        save_recovery(&p, &access, data, MAX_SESSION_BYTES as usize)
    })
    .await
}
fn save_recovery(
    p: &Path,
    access: &Access,
    mut data: serde_json::Value,
    limit: usize,
) -> Result<(), String> {
    if data.is_null() {
        return match std::fs::remove_file(p) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    if !data.is_object() && !data.is_array() {
        return Err("会话必须是对象或旧版草稿数组".into());
    }
    attach_approved_paths(&mut data, access)?;
    let mut writer = LimitedBuffer {
        bytes: Vec::new(),
        limit,
    };
    serde_json::to_writer(&mut writer, &data).map_err(|e| e.to_string())?;
    document::atomic_write(p, &writer.bytes)
}
// 序列化时限制额外缓冲；超限不触及上一份快照。
struct LimitedBuffer {
    bytes: Vec<u8>,
    limit: usize,
}
impl std::io::Write for LimitedBuffer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.bytes.len()) {
            return Err(std::io::Error::other("会话超过 256 MiB 限制"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_snapshot_preserves_previous_session() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recovery.json");
        let access = Access::default();
        save_recovery(
            &path,
            &access,
            serde_json::json!({"version": 1, "notes": []}),
            1024,
        )
        .unwrap();
        let before = std::fs::read(&path).unwrap();
        assert!(save_recovery(
            &path,
            &access,
            serde_json::json!({"text": "x".repeat(2048)}),
            1024
        )
        .is_err());
        assert!(save_recovery(&path, &access, serde_json::json!(42), 1024).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
    #[test]
    fn recovery_paths_only_come_from_native_authorization() {
        let access = Access::default();
        access.0.lock().unwrap().insert(PathBuf::from("chosen.txt"));
        let mut session =
            serde_json::json!({ "version": 1, "notes": [], "approvedPaths": ["forged.txt"] });
        attach_approved_paths(&mut session, &access).unwrap();
        assert_eq!(session["approvedPaths"], serde_json::json!(["chosen.txt"]));
    }

    #[test]
    fn recovery_supports_large_session_and_atomic_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recovery.json");
        let data = serde_json::json!({ "version": 1, "text": "x".repeat(21 * 1024 * 1024) });
        document::atomic_write(&path, &serde_json::to_vec(&data).unwrap()).unwrap();
        assert_eq!(read_recovery(&path).unwrap(), data);
        document::atomic_write(&path, b"{\"version\":1,\"notes\":[]}").unwrap();
        assert_eq!(
            read_recovery(&path).unwrap()["notes"],
            serde_json::json!([])
        );
    }
}
