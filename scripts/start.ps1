$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
try {
  $Host.UI.RawUI.WindowTitle = '安妤鱼 · 恋爱小屋'
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
  $OutputEncoding = [Console]::OutputEncoding
} catch {
  # 这些设置只是让中文显示更舒服，失败不影响网站运行
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
  Write-Host ''
  Write-Host '  没有找到 Node.js。' -ForegroundColor Yellow
  Write-Host '  请先安装 Node.js 24 或更高版本：https://nodejs.org/'
  Write-Host ''
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
  Write-Host ''
  Write-Host "  当前 Node.js 版本是 $nodeVersion，需要 24 或更高版本。" -ForegroundColor Red
  Write-Host '  请安装新版 Node.js：https://nodejs.org/'
  Write-Host ''
  Read-Host '按回车键退出'
  exit 1
}

if (-not (Test-Path -LiteralPath 'node_modules\express\package.json')) {
  Write-Host ''
  Write-Host '  第一次启动，正在安装运行依赖，请稍候……' -ForegroundColor Yellow
  $pnpm = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
  if (Test-Path -LiteralPath $pnpm) {
    & $node $pnpm install --node-linker=hoisted
  } else {
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
      Write-Host '  没有找到 npm，请重新安装 Node.js 后再试。' -ForegroundColor Red
      Read-Host '按回车键退出'
      exit 1
    }
    & $npm.Source install
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Host '  依赖安装失败，请检查网络后重试。' -ForegroundColor Red
    Read-Host '按回车键退出'
    exit 1
  }
}

$port = if ($env:PORT) { $env:PORT } else { '3210' }
$env:PORT = $port

Write-Host ''
Write-Host '  ♥  安妤鱼 · 我们的恋爱小屋' -ForegroundColor Magenta
Write-Host ''
Write-Host "  首页：http://localhost:$port"
Write-Host "  后台：http://localhost:$port/admin"
Write-Host '  初始密码：anyu520（登录后请尽快修改）'
Write-Host ''
Write-Host '  手机访问：让手机和电脑连接同一个 Wi-Fi，'
Write-Host '  然后打开下方显示的“手机访问”地址。'
Write-Host ''
Write-Host '  按 Ctrl+C 可以停止网站。关闭这个窗口也会停止。'
Write-Host ''

if (-not $env:NO_BROWSER) {
  try {
    Start-Process "http://localhost:$port"
  } catch {
    # 浏览器没有自动打开时，用户可以手动复制地址访问
  }
}

& $node server.js

Write-Host ''
Write-Host '  网站已经停止。'
Read-Host '按回车键关闭窗口'
