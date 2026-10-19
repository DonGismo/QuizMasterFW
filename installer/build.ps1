# Baut das MSI-Paket für QuizMaster FW.
#
#   powershell -ExecutionPolicy Bypass -File installer\build.ps1            (Version aus package.json)
#   powershell -ExecutionPolicy Bypass -File installer\build.ps1 -Version 1.2.0
#
# Voraussetzungen auf dem Build-Rechner: Node.js (dessen node.exe wird mitgeliefert), npm, .NET SDK 6+.
# WiX Toolset 5 und die Erweiterungen (UI, Firewall, Util) holt "dotnet build" automatisch über NuGet.
# Ergebnis: installer\out\QuizMasterFW-<Version>.msi

param([string]$Version)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
if (-not $Version) { $Version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version }
$stage = Join-Path $PSScriptRoot 'stage'
$app = Join-Path $stage 'app'

Write-Host "QuizMaster FW $Version wird gebaut ..." -ForegroundColor Red

# 1) Stage-Ordner neu aufbauen
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force (Join-Path $stage 'node'), $app | Out-Null

foreach ($teil in 'server', 'public') { Copy-Item -Recurse (Join-Path $root $teil) $app }
foreach ($datei in 'config.json', 'package.json', 'package-lock.json') { Copy-Item (Join-Path $root $datei) $app }

# 2) Nur Laufzeit-Abhängigkeiten installieren (ohne Test-/Lasttest-Pakete)
Push-Location $app
try {
  & npm ci --omit=dev --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { throw "npm ci fehlgeschlagen" }
} finally { Pop-Location }

# 3) Node.js-Laufzeit mitliefern
$node = (Get-Command node).Source
Copy-Item $node (Join-Path $stage 'node\node.exe')
$nodeVersion = & node --version

# 4) Startskripte (CRLF, UTF-8 ohne BOM – cmd.exe mag kein BOM)
$utf8 = New-Object System.Text.UTF8Encoding($false)
Get-ChildItem (Join-Path $PSScriptRoot 'vorlagen') -Filter *.cmd | ForEach-Object {
  $text = [IO.File]::ReadAllText($_.FullName) -replace "`r?`n", "`r`n"
  [IO.File]::WriteAllText((Join-Path $stage $_.Name), $text, $utf8)
}

# 5) Hinweise zur mitgelieferten Software
$hinweis = @"
QuizMaster FW $Version

Enthaltene Software von Dritten:
- Node.js $nodeVersion (MIT-Lizenz) - https://nodejs.org/  Lizenz: https://github.com/nodejs/node/blob/main/LICENSE
- npm-Pakete in app\node_modules (u. a. express, socket.io, qrcode) - Lizenzen jeweils im Paketordner.

Daten und Einstellungen: %LOCALAPPDATA%\QuizMasterFW
  config.json  Admin-PIN, Port, Standard-Zeit
  quizzes.json, results\, medien\
"@
[IO.File]::WriteAllText((Join-Path $stage 'HINWEISE.txt'), ($hinweis -replace "`r?`n", "`r`n"), $utf8)

# 6) Grafiken (Icon, Installer-Bilder) erzeugen
& node (Join-Path $PSScriptRoot 'grafiken.js')
if ($LASTEXITCODE -ne 0) { throw "Grafiken konnten nicht erzeugt werden" }

# 7) Taskleisten-Starter "QuizMaster FW.exe" mit dem in Windows enthaltenen C#-Compiler übersetzen
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "C#-Compiler nicht gefunden: $csc (.NET Framework 4.x fehlt)" }
& $csc /nologo /target:winexe /codepage:65001 /optimize+ /platform:anycpu `
  "/win32icon:$(Join-Path $PSScriptRoot 'assets\quizmaster.ico')" `
  "/out:$(Join-Path $stage 'QuizMaster FW.exe')" `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll `
  (Join-Path $PSScriptRoot 'tray\QuizMasterTray.cs')
if ($LASTEXITCODE -ne 0) { throw "Taskleisten-Starter konnte nicht übersetzt werden" }

# 8) MSI bauen
& dotnet build (Join-Path $PSScriptRoot 'QuizMasterFW.wixproj') -c Release -nologo -v:minimal "-p:ProductVersion=$Version" "-p:StageDir=$stage"
if ($LASTEXITCODE -ne 0) { throw "MSI-Build fehlgeschlagen" }

$msi = Join-Path $PSScriptRoot "out\QuizMasterFW-$Version.msi"
if (-not (Test-Path $msi)) { $msi = Get-ChildItem (Join-Path $PSScriptRoot 'out') -Recurse -Filter "QuizMasterFW-$Version.msi" | Select-Object -First 1 -ExpandProperty FullName }
Write-Host ""
Write-Host ("Fertig: {0} ({1:N1} MB)" -f $msi, ((Get-Item $msi).Length / 1MB)) -ForegroundColor Green
