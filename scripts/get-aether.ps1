# Install or update Aether on this computer and start it (Windows PowerShell).
#
#   irm https://raw.githubusercontent.com/StarAtNyte/aether/main/scripts/get-aether.ps1 | iex
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/StarAtNyte/aether/main/scripts/get-aether.ps1))) --origin https://aether-studio-lyart.vercel.app
#
# It clones (or updates) the repository into $env:AETHER_DIR (default ~\aether), runs `npm ci`, then
# `npm run aether -- start`, passing any arguments through (default: --open). The studio then uses
# your own signed-in Claude Code (`claude`) or Codex (`codex`) CLI: your subscription, no API key.
$ErrorActionPreference = 'Stop'
$StartArgs = @($args)

$Repo = if ($env:AETHER_REPO) { $env:AETHER_REPO } else { 'https://github.com/StarAtNyte/aether' }
$Dir = if ($env:AETHER_DIR) { $env:AETHER_DIR } else { Join-Path $HOME 'aether' }

function Say($m) { Write-Host "==> $m" }
function Die($m) { Write-Host "Error: $m" -ForegroundColor Red; throw $m }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die 'git is not installed (https://git-scm.com/downloads).' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die 'Node.js 24 is not installed (https://nodejs.org).' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Die 'npm is not installed (it ships with Node.js).' }
$major = [int](node -p 'process.versions.node.split(".")[0]')
if ($major -lt 24) { Die "Aether needs Node.js 24 or newer; this is $(node -v)." }

if (Test-Path (Join-Path $Dir '.git')) {
  Say "Updating $Dir"
  git -C $Dir pull --ff-only
  if ($LASTEXITCODE -ne 0) { Say "Could not fast-forward $Dir; using it as it is." }
} elseif (Test-Path $Dir) {
  Die "$Dir exists and is not an Aether checkout. Set AETHER_DIR to another folder."
} else {
  Say "Downloading Aether into $Dir"
  git clone --depth 1 $Repo $Dir
  if ($LASTEXITCODE -ne 0) { Die 'git clone failed.' }
}

Push-Location $Dir
try {
  Say 'Installing dependencies (first time takes a few minutes)'
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Die 'npm ci failed.' }

  $found = @()
  if (Get-Command claude -ErrorAction SilentlyContinue) { $found += 'Claude Code' }
  if (Get-Command codex -ErrorAction SilentlyContinue) { $found += 'Codex' }
  if ($found.Count -gt 0) { Say "Found $($found -join ' and '): Aether will use your own login." }
  else { Say 'No claude or codex CLI found. Install one and sign in to build with your subscription, or continue offline.' }

  if ($StartArgs.Count -eq 0) { $StartArgs = @('--open') }
  Say 'Starting Aether'
  npm run --silent aether -- start @StartArgs
  Write-Host ''
  Say "Next time: cd $Dir; npm run aether -- start --open   (stop: npm run aether -- stop)"
} finally { Pop-Location }
