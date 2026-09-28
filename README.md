# zNote

个人文本编辑器与 Markdown 写作工具。Tauri 2 + Rust 提供本地文件能力，Vue 3 + CodeMirror 6 提供单编辑内核与写作界面。当前版本 **0.1.0**，面向 Windows x64。

## 首版功能

- 多标签、独立撤销历史、行号、自动换行、搜索替换。标签按文本、Markdown、JSON（含 GeoJSON）和 CSV 显示对应图标；未保存文档的图标为红色。鼠标中键可关闭标签，未保存时先提示。顶部菜单提供文件、编辑、格式和帮助操作；帮助中的设置可调整主题及当前文档的保存编码、换行格式。
- 无可恢复文档时打开空白 `.txt`，不生成欢迎文档。临时标签依次命名为 `未命名1.txt`、`未命名2.txt` 等，避开已有编号；重启保留名称，旧版同名临时标签会补编号。打开本地文档按 `.md` / `.markdown`、`.json` / `.jsonc` / `.geojson`、`.csv` 后缀识别格式。Markdown、CSV 默认原位显示，JSON（含 JSONC、GeoJSON）默认分屏，其他类型默认源码显示。格式菜单中的“显示为 Markdown / CSV / JSON”仅调整当前标签的解析和预览，不改文件名与保存路径；编辑后仍保存到原文件。新建文档、TXT 和其他普通文本文件可用，已保存的 Markdown、JSON/GeoJSON、CSV 文件置灰。“转为 Markdown / CSV / JSON”仅对新建文档和本地 `.txt` 文件可用；已保存的 Markdown、JSON/GeoJSON、CSV 文件置灰，其他后缀不显示。转换本地 `.txt` 时保留原文件，后续保存以新后缀另存为。转为 JSON 后对非空内容执行可撤销的格式化。手动选择的显示模式在当前标签内保留，切换标签不会沿用其他文档的模式。
- Windows 安装版注册 `.txt`、`.md`、`.markdown`、`.json`、`.jsonc`、`.geojson`、`.csv`、`.log`、`.yaml`、`.yml`、`.toml`、`.xml`、`.html`、`.css`、`.js`、`.ts`、`.rs`、`.sql` 为可用 zNote 打开的文本格式；`.geojson` 按 JSON 显示，`.sql` 按普通文本显示。是否设为默认应用由 Windows 和用户决定。资源管理器打开文件会交给现有 zNote 窗口，或启动新窗口；关联打开的文件首次保存需通过原生保存对话框确认路径。
- Markdown 源码、原位、分屏预览；原位与分屏共用 CommonMark/GFM 解析，排版标题、强调、列表与任务框、链接、引用、表格、代码块、分隔线、脚注及行内/块级公式。原位点击排版块会显示该块的 Markdown 原文供编辑，离开后重新排版。`mermaid` 与 Mermaid 风格的 `flowchart` 围栏显示 Mermaid 图；`flow` 与 flowchart.js 风格的 `flowchart` 围栏显示 flowchart.js 图。分屏预览按语言高亮普通代码块。编辑器自动补全括号与引号。
- Markdown、JSON 和 CSV 分屏时，两侧按内容锚点同步纵向滚动；点击源码或右侧预览会高亮并定位对应内容。JSON 右侧为只读结构视图，按解析节点对应源码字符位置，不要求两侧显示行号相同。
- 打开 `.csv` 后默认原位显示表格；默认将首行作为表头，自动识别分隔符，并同时解析普通字段和双引号字段，支持字段内分隔符与换行。格式菜单的“CSV设置”可为当前标签选择分隔符（含自定义字符）、引号转义方式、是否以首行为表头及是否跳过空行；这些设置只影响预览，不改动文件内容。点击表格记录切到对应源码位置，也可手动切换源码或分屏编辑并保存原 CSV。
- 转为 JSON 时通过 Worker 格式化，保留大整数和重复键字面值；`.json` 使用严格校验，`.jsonc` 允许注释与尾逗号。格式菜单不再提供单独的 JSON 或代码块格式化命令。
- 原生打开、保存、另存为；UTF-8、GBK、带 BOM 的 UTF-16LE/BE。底栏选择保存编码，帮助菜单“设置”中选择换行格式。
- 当前 Markdown 标签可通过文件菜单“导出”生成 Word `.docx` 或 PDF `.pdf`，由原生对话框选择保存位置；导出使用当前未保存的编辑内容，不改变原文件与未保存状态。
- 外部修改冲突检测、Windows 原子替换保存、只读文件保护。
- 退出时自动保存整个会话，不询问是否保存文档，也不将未保存修改写入原文件。重启恢复临时文档、已保存和已修改文件、标签顺序与当前标签、各标签撤销/重做历史、选区、滚动位置、显示格式/模式、CSV 设置与大纲折叠状态。仅关闭临时或未保存标签时提示保存、取消或不保存；选择不保存后该标签不再恢复。Newsprint 浅色与 Night 深色主题。Markdown 文档大纲按标题层级显示，含子标题的节点可独立折叠；底栏按钮可收起或展开整个大纲栏，其他格式不显示该按钮。

| 快捷键 | 操作 |
| --- | --- |
| Ctrl+N / Ctrl+O | 新建 / 打开 |
| Ctrl+S / Ctrl+Shift+S | 保存 / 另存为 |
| Ctrl+W | 关闭当前标签，未保存时提示 |
| Ctrl+F | 查找与替换 |
| Ctrl+Z / Ctrl+Y | 撤销 / 重做 |

编辑菜单的复制、剪切、粘贴和纯文本粘贴针对当前编辑器选区；“查找与替换”打开右上悬浮面板，拖动标题可临时移位，关闭后重新打开回到右上角。帮助菜单的检查更新查询 GitHub 最新发布版本，只报告结果，不自动下载安装。操作结果以短暂提示显示。浏览器开发预览只验证编辑界面，本地打开、保存与恢复需要桌面版。

主题核心色参考 Typora 官方 [Newsprint](https://github.com/typora/typora-default-themes/blob/master/themes/newsprint.css) 与 [Night](https://github.com/typora/typora-default-themes/blob/master/themes/night.css) CSS：浅色使用 `#f3f2ee` 背景、`#1f0909` 正文；深色使用 `#363B40` 背景、`#2E3033` 侧栏、`#b8bfc6` 正文。其余控件颜色按 zNote 的结构和可读性适配。

## 首版边界

- 原位模式按块切换排版与源码，不提供单元格级可视化表格编辑。图片显示占位文字，不读取本地图片路径或请求远程资源；原始 HTML 仍按文本处理。图表源码超过 2 万字符或语法错误时保留源码显示。暂不提供目录树、插件或云同步。
- 导出仅支持 100 万 UTF-16 字符以内的 `.md` / `.markdown` 文档。保留常用标题、段落、强调、列表、引用、代码块和表格；图片以占位文字输出，不嵌入图片。PDF 内置 Noto Sans SC 字体以支持中文。
- 普通非 JSON 文本目前沿用 Markdown 语法扩展，不提供 IDE 级语言服务。
- 单文件读取和保存上限为 20 MiB；超过 100 万 UTF-16 字符停用语法、大纲、预览和转为 JSON 时的格式化。大文件仍可编辑、查找和保存。
- 会话约在最后一次编辑或标签状态变化 1.5 秒后原子写入；正常退出会立即写入并等待成功。会话文件上限 256 MiB，包含正文、保存基线和编辑历史；超限或写入失败时保留旧快照并阻止退出，需保存、关闭部分标签或解决存储故障。异常中止只能恢复最近一次成功快照。
- 恢复文件位于 `%APPDATA%/com.personal.znote/recovery.json`。重启采用会话正文而非重新读取源文件；再次保存仍校验磁盘版本，外部修改或删除不会静默覆盖。原生对话框已选过的路径由 Rust 记录并恢复保存授权；关联打开文件仍需首次保存确认路径。旧版草稿迁移为未保存副本，需另存为。恢复数据损坏时保留原文件并提示，不覆盖为新会话。
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
