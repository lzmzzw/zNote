# 开源参考与复用

2026-09-23 核对以下上游项目。zNote 独立实现应用层，优先复用成熟编辑库，避免重复开发文本内核。不复制第三方应用品牌、产品声明或未经验证的性能数字。

| 项目 | 使用方式 | 来源 |
| --- | --- | --- |
| Inkwell | 参考 Tauri、CodeMirror、Markdown-it 与 DOMPurify 的分层及分屏交互；未复制应用源码 | https://github.com/Amoner/inkwell |
| atomic-editor | 调研 CodeMirror 原位 Markdown 的可行性；未复制应用源码 | https://github.com/kenforthewin/atomic-editor |
| CodeMirror 6 | 直接依赖，复用编辑、搜索、语法、历史和装饰机制 | https://codemirror.net/ 与 https://github.com/codemirror |
| node-jsonc-parser | 直接依赖微软 format/parseTree 文本 API；避免 JSON 对象往返造成精度损失 | https://github.com/microsoft/node-jsonc-parser |
| Tauri | 直接依赖桌面框架和打包工具 | https://github.com/tauri-apps/tauri |
| Vue | 直接依赖界面框架 | https://github.com/vuejs/core |
| markdown-it / DOMPurify | 直接依赖 Markdown 解析与 HTML 清理 | https://github.com/markdown-it/markdown-it / https://github.com/cure53/DOMPurify |

上游许可文件保留于依赖分发内容；项目发布时应随包附第三方声明。Inkwell 与 node-jsonc-parser 的上游页面声明 MIT，CodeMirror 为 MIT，Tauri 为 MIT/Apache-2.0 双许可，DOMPurify 为 Apache-2.0/MPL-2.0 双许可。完整直接与传递依赖以 pnpm-lock.yaml、Cargo.lock 及对应版本 LICENSE 为准。
