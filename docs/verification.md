# zNote 0.1.0 验证记录

验证日期：2026-09-23，Windows x64。安装包已完成当前用户安装，安装版已在真实 WebView2 中运行。

## 自动化与构建

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | 5 项通过：大整数/重复键/注释保留、非法 JSON、严格 JSON、格式化撤销、预览清理 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过；主 JS 约 770 kB，存在 Vite 500 kB 提示 |
| `cargo test --locked` | 6 项通过：编码往返、拒绝有损编码、混合换行、Windows ADS 保留与只读拒写、旧 revision 拒绝、替换已有文件 |
| `cargo check --locked` | 通过 |
| `scripts/build.ps1` | NSIS release 构建成功，当前用户安装退出码 0 |

## 实际交互

浏览器检查了新建、多标签切换、Markdown 原位符号收起、分屏排版、深色主题、中文搜索替换和关闭提示。JSON 格式化保留 `9007199254740993` 与重复键，一次撤销返回原文。

安装版实际检查：

1. 启动显示本地 `tauri.localhost` 界面；原生打开对话框读取 `output/smoke/precision.json`。
2. WebView2 中点击 JSON 格式化，Worker 成功执行；Ctrl+S 写回文件，磁盘原文核对保留大整数和重复键。
3. 模拟外部程序修改该测试文件后再次 Ctrl+S，界面显示冲突提示；磁盘保留外部修改，未被覆盖。
4. 输入中文测试草稿，核对恢复快照写入；终止本任务启动的 zNote 进程并重新启动，成功恢复 1 份中文草稿。
5. 通过原生另存为保存恢复草稿至 `output/smoke/recovered.md`，磁盘内容正确；关闭已保存标签后回到欢迎页，恢复数组为空。

## 安装产物

- 安装包：`F:/Workspace/Deliverables/zNote/0.1.0/zNote_0.1.0_x64-setup.exe`
- 大小：2,340,631 字节（约 2.34 MB）。
- SHA256：`99E162BC70D0B147129C0AE4921194E404B0747AE44E101B6F8CF4771007D2B4`。
- 当前安装：`%LOCALAPPDATA%/Programs/zNote/znote.exe`，可执行文件 9,613,824 字节。
- 安装后二进制与 target/release 相差 3 字节，已核对仅为 Tauri bundle 类型标记 `UNK → NSS`。
- 第三方声明与许可原文在安装目录 `_up_/THIRD_PARTY_NOTICES.txt`、`_up_/resources/licenses/`。

## 性能与未覆盖项

2026-09-23 00:35:41 +08:00，完成恢复测试并回到欢迎页后，zNote 与其 WebView2 子进程共 7 个进程，Working Set 求和为 549.7 MiB。该数字包含进程间共享页的重复计数，是单次调试环境采样，不是独占物理内存、最低占用或稳定基准。安装包小不意味着运行内存接近原生 Notepad++。

尚未进行冷启动分位数、中文 IME 组合输入延迟、大文件持续滚动和长时间泄漏测试；大文件阈值是首版保守策略，不是性能保证。GBK/UTF-16 保真有 Rust 测试，本轮没有逐一通过原生对话框复测所有编码。

revision 检查与最终系统替换之间仍存在极短跨进程竞争窗口，不能宣称完整 CAS。首版其余功能限制见 README，不以本次成功安装代表用户正式验收。
