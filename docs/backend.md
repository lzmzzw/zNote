# 后端维护

zNote 的 Rust 后端仅提供本地文件、会话恢复与单实例关联打开能力，没有数据库、网络服务或文件监听器。外部修改在保存时通过内容 revision 检测。

## 模块与执行

- `src-tauri/src/lib.rs`：应用启动、共享状态、关联打开队列及命令注册。
- `commands.rs`：原生打开/保存/导出对话框与路径授权；磁盘保存的校验和替换在进程内串行执行，避免并发旧版本互相覆盖。
- `document.rs`：有界读取、无损编码、换行处理、流式 SHA-256 与原子替换。
- `recovery.rs`：会话读取、原生授权路径附加与有界序列化。前端仍通过 Promise 链按顺序提交会话快照。

对话框保持异步；文件读写、内容哈希、编码和恢复 JSON 处理放入 Tauri blocking 工作线程，不在同步命令中执行长时间文件操作。工作线程错误传播到前端；不持有授权集合锁跨越文件 IO 或 await。保持既有 IPC 参数与返回字段，capability、CSP 和依赖不变。

## 文件与恢复边界

单文件最多 20 MiB，导出最多 40 MiB，会话最多 256 MiB。磁盘 revision 使用 64 KiB 缓冲，避免为校验额外读取整篇正文；换行检测不分配全文副本，换行转换无变化时借用正文。保存拒绝 NUL 和有损编码，避免生成无法再次打开的文档。

Windows 使用 ReplaceFileW 保留原文件属性和附加数据流，失败不退化为直接截断写入；同目录临时文件先 sync，再校验并替换。进程内保存互斥不等于跨进程 CAS：其他程序仍可能在最终校验与替换之间修改文件。非 Windows 替换分支保留，但本项目交付验证仅覆盖 Windows。

会话在序列化期间检查上限；失败不触及旧快照。恢复授权仅取自原生层已选择路径集合，前端提交的 approvedPaths 被覆盖。旧版数组草稿继续兼容。路径授权是本地编辑器边界，不抵御能篡改本机应用数据的同用户进程。

## 验证入口

在仓库根目录使用 PowerShell：

```powershell
. ./scripts/msvc-environment.ps1
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --release --lib --locked document::tests::benchmark_large_document -- --ignored --nocapture
```

测试覆盖编码、换行、流式校验边界、并发旧版本保存、外部删除/冲突、只读与 Windows 附加数据流、会话超限保留旧快照及关联类型配置。性能基准比较旧算法和当前算法，使用 11.5 MB 中英 CRLF 文本各循环 10 次；磁盘读取是热缓存，结果不代表冷启动、网络盘或 WebView 编辑延迟。安装版仍需核对原生保存及退出重启恢复。
