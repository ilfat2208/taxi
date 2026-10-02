<#
.SYNOPSIS
    Останавливает локальный стек: сервисы Spring Boot и (опционально) контейнеры.

.EXAMPLE
    .\scripts\dev-down.ps1              # только сервисы
    .\scripts\dev-down.ps1 -WithInfra   # ещё и контейнеры
#>
[CmdletBinding()]
param(
    [switch]$WithInfra
)

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$ports = @(8080, 8081, 8082, 8083, 8084, 5173)
foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) { continue }
    foreach ($connection in $connections) {
        $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
        if ($process -and $process.ProcessName -in @('java', 'node')) {
            Write-Host "  остановлен $($process.ProcessName) (pid $($process.Id)) на порту $port"
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

if ($WithInfra) {
    Write-Host '== Останавливаю контейнеры =='
    docker compose down
} else {
    Write-Host 'Контейнеры оставлены запущенными (используйте -WithInfra, чтобы остановить).'
}
