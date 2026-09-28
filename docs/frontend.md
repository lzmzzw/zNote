# 前端维护入口

zNote 使用 Vue 3 组织窗口界面，CodeMirror 6 保存正文、选区和撤销历史。整理界面时优先保持这一状态边界，避免把全文复制到组件状态。

## 模块归属

| 位置                                                                      | 职责                                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `src/App.vue`                                                             | 文档操作、标签状态、原生文件与会话生命周期，以及各区域事件协调 |
| `src/document.ts`                                                         | 运行时文档类型、格式识别、默认模式、文件大小阈值与编码选项     |
| `src/components/DocumentTabs.vue`、`DocumentOutline.vue`                  | 标签栏、大纲的显示与事件；不拥有正文或保存逻辑                 |
| `src/components/AppDialog.vue`、`SettingsDialog.vue`                      | 弹窗焦点循环与返回、设置界面；设置变化通过事件回到文档所有者   |
| `src/components/OptionSelect.vue`、`ThemeCheckbox.vue`、`ContextMenu.vue` | 共享控件及键盘、弹层交互                                       |
| `src/editor/config.ts`                                                    | CodeMirror 语言扩展、中文词条和引用主题变量的语法样式          |
| `src/editor/search-panel.ts`                                              | CodeMirror 搜索面板装饰与拖动；搜索本身仍由 CodeMirror 提供    |
| `src/editor/preview-sync.ts`                                              | 当前编辑视图与预览 DOM 的滚动映射、块高亮；不存储正文          |
| `src/preview.ts`、`live-markdown.ts`、`diagram.ts`                        | Markdown 安全渲染、原位扩展和图表渲染                          |
| `src/session.ts`                                                          | 会话结构验证与版本兼容，以及含撤销历史的 EditorState 序列化    |

CSV、JSON、文件命名和格式化等小模块继续按各自业务职责独立。原生命令与权限仍由 Tauri 层拥有。

## 样式归属

`src/style.css` 仅作为导入入口；`src/styles/` 按以下顺序组织：

- `tokens.css`：Light / Dark 色彩、字体、字号和语法颜色，是应用主题的唯一来源。CodeMirror、Markdown 代码块、JSON 预览与图表引用这些值。
- `base.css`：基础元素、字体继承及滚动条。
- `chrome.css`：窗口、标题栏、标签栏、大纲与状态栏。
- `content.css`：Markdown、JSON、CSV、公式与图表内容。
- `editor.css`：CodeMirror 与原位编辑布局；保留覆盖其注入样式所需的优先级。
- `controls.css`：菜单、设置、下拉、复选框、弹窗与搜索面板。

新增规则应修改所属文件中的现有定义，避免在入口末尾追加覆盖。布局通过桌面窗口验证；不加入与产品范围无关的移动端样式。组件私有定位可保留 scoped CSS，共享外观由上述样式文件负责。

## 状态与验证要点

标签数组使用 `shallowRef`，每个标签保存非深层响应式的 EditorState。元数据修改后刷新数组；依赖格式或正文长度的计算属性须直接订阅数组刷新，不能只依赖身份未改变的当前标签对象。

异步剪贴板、格式化、保存都要核对原文档和版本。弹层卸载后不再访问 DOM；移除的图表跳过渲染队列。退出期间使用响应式关闭状态禁用界面，并等待会话落盘。

TypeScript 已启用未使用变量和参数检查。修改文件使用根目录 Prettier 配置，运行 `pnpm test` 和 `pnpm build`；主题或全局样式变化增加桌面 Light / Dark、菜单、弹窗、搜索及三种文档预览的浏览器核对。提交后的打包、安装要求见 `AGENTS.md`。
