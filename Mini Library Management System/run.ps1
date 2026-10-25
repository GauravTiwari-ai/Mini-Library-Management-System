param(
    [switch]$Configure
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$defaultDsn = "localhost:1521/FREEPDB1"
$defaultUser = "LIBRARY_APP"
$credentialDirectory = Join-Path $env:LOCALAPPDATA "MiniLibrary"
$credentialPath = Join-Path $credentialDirectory "oracle-credentials.json"
$securePassword = $null
$password = $null

try {
    if (-not $Configure -and (Test-Path -LiteralPath $credentialPath)) {
        try {
            $savedConfig = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
            $dsn = [string]$savedConfig.dsn
            $username = [string]$savedConfig.username
            $securePassword = ConvertTo-SecureString ([string]$savedConfig.password)
            if ([string]::IsNullOrWhiteSpace($dsn) -or
                [string]::IsNullOrWhiteSpace($username) -or
                $securePassword.Length -eq 0) {
                throw "The saved Oracle connection is incomplete."
            }
        } catch {
            throw "Could not read the saved Oracle login. Run .\run.ps1 -Configure to enter it again. $($_.Exception.Message)"
        }
    } else {
        $savedConfig = $null
        if (Test-Path -LiteralPath $credentialPath) {
            try {
                $savedConfig = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
            } catch {
                Write-Warning "The saved Oracle login could not be read. Enter the connection details again."
            }
        }

        $dsnDefault = if ($savedConfig.dsn) { [string]$savedConfig.dsn } else { $defaultDsn }
        $usernameDefault = if ($savedConfig.username) { [string]$savedConfig.username } else { $defaultUser }
        $dsnInput = Read-Host "Oracle DSN [$dsnDefault]"
        $usernameInput = Read-Host "Oracle schema username [$usernameDefault]"
        $securePassword = Read-Host "Oracle password (saved encrypted for this Windows account)" -AsSecureString

        $dsn = if ([string]::IsNullOrWhiteSpace($dsnInput)) { $dsnDefault } else { $dsnInput.Trim() }
        $username = if ([string]::IsNullOrWhiteSpace($usernameInput)) { $usernameDefault } else { $usernameInput.Trim() }
        if ($securePassword.Length -eq 0) {
            throw "The Oracle password cannot be empty."
        }

        New-Item -ItemType Directory -Path $credentialDirectory -Force | Out-Null
        [ordered]@{
            dsn = $dsn
            username = $username
            password = ConvertFrom-SecureString -SecureString $securePassword
        } | ConvertTo-Json | Set-Content -LiteralPath $credentialPath -Encoding UTF8
        Write-Host "Oracle login saved encrypted for this Windows account."
    }

    $password = [System.Net.NetworkCredential]::new("", $securePassword).Password
    $env:ORACLE_DSN = $dsn
    $env:ORACLE_USER = $username
    $env:ORACLE_PASSWORD = $password
    $env:PORT = "8080"

    $projectPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $projectPython) {
        $python = $projectPython
    } else {
        $python = (Get-Command python -ErrorAction Stop).Source
    }

    Push-Location $projectRoot
    try {
        & $python backend\server.py
        if ($LASTEXITCODE -ne 0) {
            throw "The Python server exited with code $LASTEXITCODE."
        }
    } finally {
        Pop-Location
    }
} finally {
    Remove-Item Env:ORACLE_DSN, Env:ORACLE_USER, Env:ORACLE_PASSWORD, Env:PORT -ErrorAction SilentlyContinue
    $password = $null
    if ($securePassword) {
        $securePassword.Dispose()
    }
}
