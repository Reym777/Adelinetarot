# AdelineTarot — lanzar el backend en local (PowerShell)
# Uso :  .\run.ps1
$ErrorActionPreference = "Stop"

$venvPython = Join-Path $PSScriptRoot "..\..\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "No se encontró el venv en $venvPython — usando 'python' del PATH." -ForegroundColor Yellow
    $venvPython = "python"
}

Push-Location $PSScriptRoot
try {
    & $venvPython -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
}
finally {
    Pop-Location
}
