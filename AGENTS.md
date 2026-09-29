# zNote 工程约定

## 产品与范围

本工程是个人本地文本编辑器和 Markdown 工具，不是工作台、AI Agent 或云笔记服务。产品行为以 `README.md` 为入口，设计边界在 `docs/design.md`。

界面仅面向桌面应用窗口。设计、实现和验收以桌面尺寸及桌面交互为准，不要求手机、平板或窄屏布局适配；除非用户另行明确提出，不为窄屏新增布局或专项验证。

## 实现不变量

- Markdown 原文由 CodeMirror EditorState 唯一拥有；Vue 不逐键存储全文，不引入第二套富文本文档模型。
- 各标签独立维护历史和选区。异步保存、格式化与恢复必须校验文档身份和版本，不能覆盖等待期间的新输入。
- Rust 只允许原生对话框已选择路径的保存；拒绝有损编码，保留 BOM 和选择的换行格式。Windows 替换文件保留原文件属性，不静默覆盖外部修改。
- Markdown 预览不执行原始 HTML、不加载远程资源，不新增通用 shell 或任意文件系统桥接。
- 大文件与恢复上限必须在界面和 README 同步说明。没有实测不能宣称性能最好或完整兼容 Typora。

## 工具与验证

- 使用 pnpm，只有 `pnpm-lock.yaml` 一种前端锁文件；Rust 保留 Cargo.lock。
- 前端改动运行 `pnpm test`、`pnpm build`；文件层改动运行 `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked`。
- Windows 构建复用 `scripts/msvc-environment.ps1` 载入 MSVC；正式发布使用 `scripts/build.ps1`。依赖变化后运行 `scripts/collect-licenses.ps1`。
- 用户要求本地构建并安装时，保持正式发布的 `tauri.conf.json` updater 配置不变；使用仅供本机构建的临时 Tauri `--config` 覆盖 `bundle.createUpdaterArtifacts=false` 生成 NSIS 安装包，不检查或要求 `TAURI_SIGNING_PRIVATE_KEY`。正式发布仍按原配置生成签名更新产物。
- 每次调整并提交本仓库代码后，以该提交按本地安装或正式发布路径生成 NSIS 安装包，完成当前用户安装并启动安装版核对；构建或安装失败时明确报告，不能把浏览器预览当作安装结果。
- 桌面能力与安装包变化需实际启动安装版验证，浏览器结果不能代替原生对话框、文件保存与恢复。
- 测试文件放 `output/smoke/`；该目录、构建目录和 node_modules 不提交。不得用用户真实文档做破坏性测试。
