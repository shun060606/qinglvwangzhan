$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
try {
  $Host.UI.RawUI.WindowTitle = '安妤鱼 · 重置后台密码'
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
  $OutputEncoding = [Console]::OutputEncoding
} catch {
}

function Find-Node {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidates = @(
    (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'),
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  return $null
}

$node = Find-Node
if (-not $node) {
  Write-Host '没有找到 Node.js，请先安装 Node.js 24 或更高版本。' -ForegroundColor Red
  Read-Host '按回车键退出'
  exit 1
}

$nodeVersion = (& $node --version 2>$null)
try {
  $nodeMajor = [int](($nodeVersion -replace '^v', '').Split('.')[0])
} catch {
  $nodeMajor = 0
}
if ($nodeMajor -lt 24) {
  Write-Host "当前 Node.js 版本是 $nodeVersion，需要 24 或更高版本。" -ForegroundColor Red
  Read-Host '按回车键退出'
  exit 1
}

Write-Host ''
Write-Host '  重置后台密码前，请先关闭正在运行的网站窗口。'
Write-Host ''
$newPassword = Read-Host '  请输入新密码（至少 6 位，直接回车使用 anyu520）'
if ([string]::IsNullOrWhiteSpace($newPassword)) { $newPassword = 'anyu520' }

& $node 'scripts\reset-password.js' $newPassword

Write-Host ''
Read-Host '按回车键关闭窗口'
