$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'msvc-environment.ps1')
Push-Location (Join-Path $PSScriptRoot '..')
try {
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw '依赖安装失败' }
    & pnpm tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw '安装包构建失败' }
} finally { Pop-Location }
