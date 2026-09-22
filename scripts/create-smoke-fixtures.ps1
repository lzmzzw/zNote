$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '../output/smoke'
[System.IO.Directory]::CreateDirectory($root) | Out-Null
$utf8 = [System.Text.UTF8Encoding]::new($false)
$markdown = @'
# zNote 本地验收

中文写作，**粗体**、*斜体*、`行内代码`。

## 待办

- [x] 打开 Markdown
- [ ] 保存并重新打开

> 文本是文档的唯一事实来源。

| 项目 | 值 |
| --- | --- |
| 中文 | 正常 |
| 数字 | 123 |

```json
{"hello":"世界","large":9007199254740993}
```

<script>alert('must not run')</script>
![不应加载的远程图片](https://example.invalid/tracker.png)
'@
[System.IO.File]::WriteAllText((Join-Path $root '验收.md'), $markdown, $utf8)
[System.IO.File]::WriteAllText((Join-Path $root 'precision.json'), '{"中文":"世界","large":9007199254740993,"duplicate":1,"duplicate":2,"items":[true,null,3]}', $utf8)
[System.IO.File]::WriteAllText((Join-Path $root 'comments.jsonc'), "// 保留注释`n{`"large`":9007199254740993,`"中文`":`"测试`",}", $utf8)
[System.Text.Encoding]::RegisterProvider([System.Text.CodePagesEncodingProvider]::Instance)
[System.IO.File]::WriteAllBytes((Join-Path $root 'gbk.txt'), [System.Text.Encoding]::GetEncoding(936).GetBytes("中文 GBK 保真`r`n第二行`r`n"))
[System.IO.File]::WriteAllText((Join-Path $root 'utf16.txt'), "中文 UTF16 保真`r`n第二行`r`n", [System.Text.Encoding]::Unicode)
[System.IO.File]::WriteAllText((Join-Path $root 'large.md'), (($markdown + "`n") * 10000), $utf8)
Get-ChildItem -LiteralPath $root | Select-Object Name, Length
