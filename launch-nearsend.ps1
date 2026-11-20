param([switch]$CreateShortcut, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$appFolder = $PSScriptRoot

if ($CreateShortcut) {
    $desktopFolder = [Environment]::GetFolderPath('Desktop')
    $shortcutShell = New-Object -ComObject WScript.Shell
    $shortcut = $shortcutShell.CreateShortcut((Join-Path $desktopFolder 'Nearsend.lnk'))
    $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
    $shortcut.Arguments = '"' + (Join-Path $appFolder 'Nearsend.vbs') + '"'
    $shortcut.WorkingDirectory = $appFolder
    $shortcut.Description = 'Scan the QR code to transfer files between your iPhone and laptop'
    $shortcut.IconLocation = (Join-Path $env:WINDIR 'System32\shell32.dll') + ',18'
    $shortcut.Save()
    Write-Host 'Nearsend shortcut created on your desktop. Double-click it to open the app.'
    exit 0
}

$dataFolder = if ($env:NEARSEND_DATA) { $env:NEARSEND_DATA } else { Join-Path $appFolder 'data' }
$useHttps = (Test-Path (Join-Path $dataFolder 'cert.pem')) -and (Test-Path (Join-Path $dataFolder 'key.pem'))
$proto = if ($useHttps) { 'https' } else { 'http' }
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$checkScript = Join-Path $appFolder 'scripts\check-ready.js'

function Stop-OldNearsend {
    try {
        $conns = Get-NetTCPConnection -LocalPort 3210 -State Listen -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -eq 'node') {
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            }
        }
        Start-Sleep -Milliseconds 300
    } catch { }
}

function Test-Nearsend {
    & $nodeExe $checkScript $proto 2>$null
    return ($LASTEXITCODE -eq 0)
}

try {
    if (-not (Test-Nearsend)) {
        Stop-OldNearsend
        $nodeCommand = Get-Command node.exe -ErrorAction Stop
        $logFolder = Join-Path $appFolder 'output'
        New-Item -ItemType Directory -Path $logFolder -Force | Out-Null
        Start-Process -FilePath $nodeCommand.Source -ArgumentList ('"' + (Join-Path $appFolder 'server.js') + '"') -WorkingDirectory $appFolder -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logFolder 'server.log') -RedirectStandardError (Join-Path $logFolder 'server-error.log') | Out-Null
        $ready = $false
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            if (Test-Nearsend) { $ready = $true; break }
            Start-Sleep -Milliseconds 500
        }
        if (-not $ready) { throw 'Nearsend could not start. Check output\server-error.log. Port 3210 may already be in use.' }
    }
    if ($CheckOnly) { Write-Host "Nearsend is ready at ${proto}://localhost:3210"; exit 0 }
    $appUrl = "${proto}://127.0.0.1:3210/?connect=1"
    $browserPaths = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    $browser = $browserPaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($browser) {
        Start-Process -FilePath $browser -ArgumentList @("--app=$appUrl", '--window-size=1280,900') | Out-Null
    } else { Start-Process $appUrl | Out-Null }
} catch {
    if ($CheckOnly) { throw }
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(('Could not open Nearsend. ' + $_.Exception.Message), 'Nearsend') | Out-Null
    exit 1
}
