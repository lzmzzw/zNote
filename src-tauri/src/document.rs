use encoding_rs::GBK;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};
pub const MAX_BYTES: u64 = 20 * 1024 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub path: String,
    pub text: String,
    pub encoding: String,
    pub bom: bool,
    pub line_ending: String,
    pub revision: String,
}
pub fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn decode(bytes: &[u8]) -> Result<(String, String, bool), String> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err("文件超过 20 MB 限制".into());
    }
    let (encoding, bom, data) = if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        ("UTF-8", true, &bytes[3..])
    } else if bytes.starts_with(&[0xff, 0xfe]) {
        ("UTF-16LE", true, &bytes[2..])
    } else if bytes.starts_with(&[0xfe, 0xff]) {
        ("UTF-16BE", true, &bytes[2..])
    } else {
        ("UTF-8", false, bytes)
    };
    let mut actual = encoding;
    let text = match encoding {
        "UTF-16LE" | "UTF-16BE" => {
            if data.len() % 2 != 0 {
                return Err("UTF-16 文件长度无效".into());
            }
            let units: Vec<u16> = data
                .chunks_exact(2)
                .map(|b| {
                    if encoding == "UTF-16LE" {
                        u16::from_le_bytes([b[0], b[1]])
                    } else {
                        u16::from_be_bytes([b[0], b[1]])
                    }
                })
                .collect();
            String::from_utf16(&units).map_err(|_| "UTF-16 包含无效字符")?
        }
        _ => match std::str::from_utf8(data) {
            Ok(s) => s.to_owned(),
            Err(_) if !bom => {
                actual = "GBK";
                let decoded = GBK
                    .decode_without_bom_handling_and_without_replacement(data)
                    .ok_or("文件不是有效的 UTF-8、GBK 或带 BOM 的 UTF-16 文本")?;
                let (encoded, _, errors) = GBK.encode(&decoded);
                if errors || encoded.as_ref() != data {
                    return Err("GBK 内容不能无损往返转换".into());
                }
                decoded.into_owned()
            }
            Err(_) => return Err("UTF-8 BOM 文件包含无效字符".into()),
        },
    };
    if text.contains('\0') {
        return Err("文件包含 NUL 字符，可能是二进制文件或无 BOM 的 UTF-16".into());
    }
    Ok((text, actual.into(), bom))
}
pub fn encode(text: &str, encoding: &str, bom: bool, eol: &str) -> Result<Vec<u8>, String> {
    if encoding.starts_with("UTF-16") && !bom {
        return Err("UTF-16 保存必须包含 BOM，以保证下次准确识别编码".into());
    }
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let output = match eol {
        "CRLF" => normalized.replace('\n', "\r\n"),
        "CR" => normalized.replace('\n', "\r"),
        "LF" => normalized,
        "Mixed" => text.to_owned(),
        _ => return Err("未知换行格式".into()),
    };
    let mut bytes = Vec::new();
    match encoding {
        "UTF-8" => {
            if bom {
                bytes.extend([0xef, 0xbb, 0xbf]);
            }
            bytes.extend(output.as_bytes());
        }
        "UTF-16LE" | "UTF-16BE" => {
            let le = encoding == "UTF-16LE";
            if bom {
                bytes.extend(if le { [0xff, 0xfe] } else { [0xfe, 0xff] });
            }
            for ch in output.encode_utf16() {
                bytes.extend(if le {
                    ch.to_le_bytes()
                } else {
                    ch.to_be_bytes()
                });
            }
        }
        "GBK" => {
            if bom {
                return Err("GBK 不支持 BOM".into());
            }
            let (data, _, errors) = GBK.encode(&output);
            if errors {
                return Err("当前文字无法用 GBK 无损保存，请选择 UTF-8".into());
            }
            bytes.extend(data.as_ref());
        }
        _ => return Err("不支持的编码".into()),
    }
    if bytes.len() as u64 > MAX_BYTES {
        return Err("保存内容超过 20 MB 限制".into());
    }
    Ok(bytes)
}
pub fn line_ending(text: &str) -> String {
    let crlf = text.matches("\r\n").count();
    let rest = text.replace("\r\n", "");
    let lf = rest.contains('\n');
    let cr = rest.contains('\r');
    if (crlf > 0) as u8 + lf as u8 + cr as u8 > 1 {
        "Mixed"
    } else if crlf > 0 {
        "CRLF"
    } else if cr {
        "CR"
    } else {
        "LF"
    }
    .into()
}
pub fn read_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("文件超过 20 MB 限制".into());
    }
    Ok(bytes)
}
pub fn read(path: &Path) -> Result<Document, String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_BYTES {
        return Err("文件超过 20 MB 限制".into());
    }
    let bytes = read_bytes(path)?;
    let (text, encoding, bom) = decode(&bytes)?;
    Ok(Document {
        path: path.to_string_lossy().into_owned(),
        line_ending: line_ending(&text),
        text,
        encoding,
        bom,
        revision: revision(&bytes),
    })
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    write_impl(path, bytes, None)
}
pub fn guarded_write(path: &Path, bytes: &[u8], expected: Option<&str>) -> Result<(), String> {
    write_impl(path, bytes, Some(expected))
}
pub fn disk_revision(path: &Path) -> Result<Option<String>, String> {
    match fs::metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
        Ok(meta) => {
            if meta.len() > MAX_BYTES {
                return Err("目标文件超过 20 MB 限制".into());
            }
            Ok(Some(revision(&read_bytes(path)?)))
        }
    }
}
fn write_impl(path: &Path, bytes: &[u8], expected: Option<Option<&str>>) -> Result<(), String> {
    let parent = path.parent().ok_or("无效保存路径")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    if let Some(expected) = expected {
        if disk_revision(path)?.as_deref() != expected {
            return Err("文件已被外部修改，请重新打开或另存为".into());
        }
    }
    let temp = temp.into_temp_path();
    #[cfg(windows)]
    if path.exists() {
        use std::os::windows::ffi::OsStrExt;
        let target: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let replacement: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let ok = unsafe {
            windows_sys::Win32::Storage::FileSystem::ReplaceFileW(
                target.as_ptr(),
                replacement.as_ptr(),
                std::ptr::null(),
                0,
                std::ptr::null(),
                std::ptr::null(),
            )
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        return Ok(());
    }
    temp.persist_noclobber(path).map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip() {
        for enc in ["UTF-8", "GBK", "UTF-16LE", "UTF-16BE"] {
            let bom = enc != "GBK";
            let b = encode("你好\r\n世界", enc, bom, "CRLF").unwrap();
            let (t, e, bm) = decode(&b).unwrap();
            assert_eq!(t, "你好\r\n世界");
            assert_eq!(e, enc);
            assert_eq!(bm, bom);
        }
    }
    #[test]
    fn reject_loss() {
        assert!(encode("😀", "GBK", false, "LF").is_err());
        assert!(encode("abc", "UTF-16LE", false, "LF").is_err());
        assert!(decode(&[0xff, 0xfe, 0x00, 0xd8]).is_err());
        assert!(decode(&[0xef, 0xbb, 0xbf, 0xff]).is_err());
    }
    #[test]
    fn mixed_preserved() {
        let t = "a\r\nb\nc\r";
        assert_eq!(line_ending(t), "Mixed");
        assert_eq!(encode(t, "UTF-8", false, "Mixed").unwrap(), t.as_bytes());
    }
    #[cfg(windows)]
    #[test]
    fn preserves_stream_and_rejects_readonly() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("private.txt");
        atomic_write(&path, b"old").unwrap();
        let stream = path.with_file_name("private.txt:note");
        fs::write(&stream, b"metadata").unwrap();
        atomic_write(&path, b"new").unwrap();
        assert_eq!(fs::read(&stream).unwrap(), b"metadata");
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions).unwrap();
        assert!(atomic_write(&path, b"bad").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"new");
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(false);
        fs::set_permissions(&path, permissions).unwrap();
    }
    #[test]
    fn rejects_stale_revision() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("conflict.md");
        atomic_write(&p, b"external").unwrap();
        assert!(guarded_write(&p, b"ours", Some(&revision(b"old"))).is_err());
        assert!(guarded_write(&p, b"ours", None).is_err());
        assert_eq!(fs::read(&p).unwrap(), b"external");
    }
    #[test]
    fn replace_existing() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("test.md");
        atomic_write(&p, b"old").unwrap();
        atomic_write(&p, b"new").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"new");
    }
}
