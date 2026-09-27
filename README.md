# zNote

个人文本编辑器与 Markdown 写作工具。Tauri 2 + Rust 提供本地文件能力，Vue 3 + CodeMirror 6 提供单编辑内核与写作界面。当前版本 **0.1.0**，面向 Windows x64。

## 首版功能

- 多标签、独立撤销历史、行号、自动换行、搜索替换。顶部菜单提供文件、编辑、格式和帮助操作；帮助中的设置可调整主题及当前文档的保存编码、换行格式。
- 新建标签默认为 `.txt`；打开本地文档按 `.md` / `.markdown`、`.json` / `.jsonc`、`.csv` 后缀识别格式。格式菜单可切换 Markdown、JSON、CSV；未保存标签会同步更改建议文件名。CSV 切换后显示表格分屏，JSON 切换后对非空内容执行可撤销的格式化。
- Markdown 源码、基础原位、分屏预览；原位隐藏非当前行的标题/粗体/斜体标记，预览支持表格与代码块。
- 打开 `.csv` 后自动以分屏显示表格预览；首行显示为表头，支持引号字段、字段内逗号和换行。左侧源码仍可编辑并保存原 CSV。
- JSON/JSONC Worker 格式化，保留大整数和重复键字面值；`.json` 使用严格校验，`.jsonc` 允许注释与尾逗号。
- 原生打开、保存、另存为；UTF-8、GBK、带 BOM 的 UTF-16LE/BE。底栏选择保存编码，帮助菜单“设置”中选择换行格式。
- 当前 Markdown 标签可通过文件菜单“导出”生成 Word `.docx` 或 PDF `.pdf`，由原生对话框选择保存位置；导出使用当前未保存的编辑内容，不改变原文件与未保存状态。
- 外部修改冲突检测、Windows 原子替换保存、只读文件保护。
- 未保存关闭提示、延迟草稿恢复、浅色/深色、文档大纲。

| 快捷键 | 操作 |
| --- | --- |
| Ctrl+N / Ctrl+O | 新建 / 打开 |
| Ctrl+S / Ctrl+Shift+S | 保存 / 另存为 |
| Ctrl+W | 关闭当前标签，未保存时提示 |
| Ctrl+F | 查找与替换 |
| Ctrl+Z / Ctrl+Y | 撤销 / 重做 |

JSON 格式化使用格式菜单。编辑菜单的复制、剪切、粘贴和纯文本粘贴针对当前编辑器选区；查找与替换使用 CodeMirror 搜索面板。帮助菜单的检查更新查询 GitHub 最新发布版本，只报告结果，不自动下载安装。操作结果以短暂提示显示。浏览器开发预览只验证编辑界面，本地打开、保存与恢复需要桌面版。

## 首版边界

- 基础原位排版不是完整 Typora；暂不提供可视化表格编辑、公式、Mermaid、图片展示、目录树、插件或云同步。图片显示占位文字，不请求远程资源。
- 导出仅支持 100 万 UTF-16 字符以内的 `.md` / `.markdown` 文档。保留常用标题、段落、强调、列表、引用、代码块和表格；图片以占位文字输出，不嵌入图片。PDF 内置 Noto Sans SC 字体以支持中文。
- 普通非 JSON 文本目前沿用 Markdown 语法扩展，不提供 IDE 级语言服务。
- 单文件读取和保存上限为 20 MiB；超过 100 万 UTF-16 字符停用语法、大纲、预览与 JSON 格式化。大文件仍可编辑、查找和保存。
- 自动草稿约在停止编辑 1.5 秒后写入，只覆盖不超过 200 万字符的未保存文档，合计 JSON 字节预算 19 MB。超限有提示并保留上次快照；这不是完整备份，仍应及时保存。
- 恢复文件位于 `%APPDATA%/com.personal.znote/recovery.json`，只含本地草稿；恢复后按未保存副本处理，保存需原生另存对话框再次选择路径。
- 混合换行文件必须在帮助菜单“设置”中明确选择 LF/CRLF/CR 后保存。无 BOM UTF-16 不自动猜测。GBK 无法表示的字符会拒绝保存，可切换 UTF-8。
- 保存前两次检查 revision，可检测通常的外部修改；检查与替换之间极短的跨进程竞争窗口不具备完整 CAS 保证。另存为覆盖以原生对话框确认为准。
- 使用系统 WebView2。未配置发布签名证书和自动安装更新，不自动更改默认文件关联。

## 开发与构建

需要 Node.js ≥22.13、pnpm（锁文件由 8.10.0 生成）、Rust MSVC stable、Visual Studio C++ Build Tools 和 Windows SDK，以及 WebView2。

```powershell
pnpm install --frozen-lockfile
pnpm dev                         # 浏览器界面开发
pnpm tauri dev                   # 已配置 MSVC 的终端中启动桌面开发
pnpm test
pnpm build                       # 包含 Vue/TypeScript 检查
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
pwsh -NoProfile -File scripts/collect-licenses.ps1
pwsh -NoProfile -File scripts/build.ps1
```

`scripts/build.ps1` 自动载入本机 MSVC 环境，输出 `src-tauri/target/release/bundle/nsis/zNote_0.1.0_x64-setup.exe`。NSIS 安装范围为当前用户。依赖升级后重新收集许可再打包。

## 设计与验证入口

- [首版设计](docs/design.md)
- [开源技术参考](docs/open-source.md)
- [验证记录](docs/verification.md)
- `scripts/create-smoke-fixtures.ps1` 生成中文 Markdown、JSON 大整数、GBK/UTF-16 和长文验收文件，仅写入忽略的 `output/smoke/`。
- 第三方许可声明位于 `THIRD_PARTY_NOTICES.txt` 与 `resources/licenses/`，随安装包附带。
