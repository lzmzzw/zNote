use super::{queue_open_paths, OpenRequests};
use std::path::Path;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu, WINDOW_SUBMENU_ID},
    AppHandle, Emitter, Runtime, Url,
};
#[cfg(target_os = "macos")]
use tauri::{Manager, RunEvent};

// 同时在 Windows 单元测试中编译菜单构造，核对锁定的 Tauri API。
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let about = MenuItem::with_id(app, "about", "关于 zNote", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置…", true, Some("CmdOrCtrl+,"))?;
    // 预定义 Quit 会直接退出；自定义项交给前端先写入恢复快照。
    let quit = MenuItem::with_id(app, "quit", "退出 zNote", true, Some("CmdOrCtrl+Q"))?;
    let app_menu = Submenu::with_items(
        app,
        "zNote",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("服务"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("隐藏 zNote"))?,
            &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
            &PredefinedMenuItem::show_all(app, Some("显示全部"))?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    // 编辑器历史由 CodeMirror 拥有，剪贴板仍走 Cocoa 原生 responder。
    let undo = MenuItem::with_id(app, "undo", "撤销", true, Some("CmdOrCtrl+Z"))?;
    let redo = MenuItem::with_id(app, "redo", "重做", true, Some("CmdOrCtrl+Shift+Z"))?;
    let edit_menu = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &undo,
            &redo,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("拷贝"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
        ],
    )?;
    let window_menu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "窗口",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("最小化"))?,
            &PredefinedMenuItem::maximize(app, Some("缩放"))?,
            &PredefinedMenuItem::fullscreen(app, Some("切换全屏"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "close-tab", "关闭标签", true, Some("CmdOrCtrl+W"))?,
            &PredefinedMenuItem::bring_all_to_front(app, Some("前置全部窗口"))?,
        ],
    )?;
    app.set_menu(Menu::with_items(
        app,
        &[&app_menu, &edit_menu, &window_menu],
    )?)?;
    app.on_menu_event(|app, event| {
        let action = event.id().as_ref();
        if matches!(
            action,
            "about" | "settings" | "quit" | "undo" | "redo" | "close-tab"
        ) {
            let _ = app.emit("native-menu-action", action);
        }
    });
    Ok(())
}

fn queue_open_urls(requests: &OpenRequests, urls: &[Url]) -> bool {
    // to_file_path 只接受本地文件 URL，并正确解码空格与非 ASCII 文件名。
    // 继续使用相同扩展名、存在性、数量及去重校验，不授予 native_save 权限。
    queue_open_paths(
        requests,
        urls.iter().filter_map(|url| url.to_file_path().ok()),
        Path::new("/"),
    )
}

#[cfg(target_os = "macos")]
pub fn on_run_event<R: Runtime>(app: &AppHandle<R>, event: &RunEvent) {
    match event {
        RunEvent::Opened { urls } => {
            if queue_open_urls(&app.state::<OpenRequests>(), urls) {
                let _ = app.emit("associated-file-open", ());
            }
            focus_main(app);
        }
        RunEvent::Reopen { .. } => focus_main(app),
        // Dock 的“退出”也先持久化；程序退出和更新重启仍使用原有路径。
        RunEvent::ExitRequested {
            code: None, api, ..
        } => {
            api.prevent_exit();
            let _ = app.emit("native-menu-action", "quit");
        }
        _ => {}
    }
}

#[cfg(target_os = "macos")]
fn focus_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finder_urls_decode_local_names_and_only_accept_local_files() {
        let dir = tempfile::tempdir().unwrap();
        let note = dir.path().join("备忘 录.md");
        let image = dir.path().join("image.png");
        std::fs::write(&note, "# Note").unwrap();
        std::fs::write(&image, "image").unwrap();
        let note_url = Url::from_file_path(&note).unwrap();
        let requests = OpenRequests::default();
        assert!(queue_open_urls(
            &requests,
            &[
                note_url.clone(),
                Url::from_file_path(&image).unwrap(),
                Url::from_file_path(dir.path().join("missing.md")).unwrap(),
                Url::parse("https://example.com/note.md").unwrap(),
                note_url.clone(),
            ],
        ));
        assert_eq!(requests.0.lock().unwrap().as_slice(), &[note, image]);
        assert!(!queue_open_urls(&requests, &[note_url]));
    }
}
