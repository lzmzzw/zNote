$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$destination = Join-Path $root 'resources/licenses'
[System.IO.Directory]::CreateDirectory($destination) | Out-Null
Push-Location $root
try {
  $npmJson = & pnpm licenses list --prod --json
  if ($LASTEXITCODE -ne 0) { throw 'pnpm licenses failed' }
  $npmData = ($npmJson -join "`n") | ConvertFrom-Json
  $cargoJson = & cargo metadata --locked --format-version 1 --manifest-path src-tauri/Cargo.toml
  if ($LASTEXITCODE -ne 0) { throw 'cargo metadata failed' }
  $cargoData = ($cargoJson -join "`n") | ConvertFrom-Json
  $notices = [System.Collections.Generic.List[string]]::new()
  $notices.Add("zNote 0.1.0 — 第三方依赖声明`n`n本文件由 scripts/collect-licenses.ps1 根据已安装的锁定依赖生成。许可原文在 licenses 目录。Rust 列表含构建和目标平台依赖；并非每项均进入当前 Windows 二进制。`n")
  $packages = [System.Collections.Generic.List[object]]::new()
  foreach ($license in $npmData.PSObject.Properties) {
    foreach ($p in $license.Value) {
      $packages.Add([pscustomobject]@{kind='npm';name=$p.name;version=$p.version;license=$license.Name;directory=$p.path;repository=$p.repository})
    }
  }
  foreach ($p in $cargoData.packages) {
    if ($p.name -eq 'znote') { continue }
    $packages.Add([pscustomobject]@{kind='cargo';name=$p.name;version=$p.version;license=$p.license;directory=(Split-Path $p.manifest_path);repository=$p.repository})
  }
  $copied = 0
  foreach ($p in ($packages | Sort-Object kind,name,version -Unique)) {
    $slug = "$($p.kind)-$($p.name)-$($p.version)" -replace '[^a-zA-Z0-9._-]', '_'
    $notices.Add("$($p.kind) $($p.name) $($p.version) | $($p.license) | $($p.repository)".TrimEnd())
    if (-not $p.directory -or -not (Test-Path -LiteralPath $p.directory)) { throw "Missing package directory: $slug" }
    $files = Get-ChildItem -LiteralPath $p.directory -File | Where-Object { $_.Name -match '^(LICENSE|LICENCE|COPYING|NOTICE|UNLICENSE)' }
    foreach ($file in $files) {
      Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $destination "$slug-$($file.Name)") -Force
      $copied++
    }
    if (-not $files) { $notices.Add('  该发布包根目录未包含单独许可文件，请参见上游仓库与包元数据。') }
  }
  Copy-Item -LiteralPath (Join-Path $root 'src/assets/NotoSansSC-OFL.txt') -Destination (Join-Path $destination 'font-NotoSansSC-OFL.txt') -Force
  $notices.Add('font Noto Sans SC | OFL-1.1 | https://github.com/google/fonts/tree/main/ofl/notosanssc')
  [System.IO.File]::WriteAllLines((Join-Path $root 'THIRD_PARTY_NOTICES.txt'), $notices, [System.Text.UTF8Encoding]::new($false))
  Write-Output "Collected $copied license files for $($packages.Count) dependency records."
} finally { Pop-Location }
