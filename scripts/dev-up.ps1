<#
.SYNOPSIS
    Поднимает локальный стек: инфраструктуру в Docker и сервисы Spring Boot.

.DESCRIPTION
    Сервисы запускаются отдельными процессами (`spring-boot:run`), потому что при
    разработке так быстрее: правка кода не требует пересборки образа. Если нужны
    контейнеры — `docker compose --profile app up -d --build`.

.EXAMPLE
    .\scripts\dev-up.ps1                 # инфраструктура + все сервисы
    .\scripts\dev-up.ps1 -SkipServices   # только Postgres, Kafka, Redis
#>
[CmdletBinding()]
param(
    [switch]$SkipServices,
    [switch]$WithTools,
    [int]$StartupTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
# Кириллица из API: консоль Windows по умолчанию не в UTF-8.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Wait-ForUrl([string]$url, [int]$timeoutSeconds, [string]$name) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) {
                Write-Host "  [ok] $name -> $url" -ForegroundColor Green
                return $true
            }
        } catch { Start-Sleep -Seconds 3 }
    }
    Write-Host "  [FAIL] $name не поднялся за $timeoutSeconds с: $url" -ForegroundColor Red
    return $false
}

Write-Host '== Инфраструктура ==' -ForegroundColor Cyan
if ($WithTools) {
    docker compose --profile tools up -d postgres kafka redis kafka-ui
} else {
    docker compose up -d postgres kafka redis
}
if ($LASTEXITCODE -ne 0) { throw 'docker compose не смог поднять инфраструктуру' }

Write-Host '== Ожидание готовности Postgres / Kafka / Redis =='
$deadline = (Get-Date).AddSeconds(120)
do {
    Start-Sleep -Seconds 4
    $state = docker compose ps --format '{{.Service}} {{.State}} {{.Health}}' | Out-String
} while ((Get-Date) -lt $deadline -and $state -notmatch 'postgres\s+running\s+healthy')

docker compose ps --format '  {{.Service}} -> {{.State}} ({{.Health}})'
if ($WithTools) { Write-Host '  Kafka UI: http://localhost:8090' }

if ($SkipServices) {
    Write-Host 'Сервисы не запускались (-SkipServices).' -ForegroundColor Yellow
    exit 0
}

Write-Host '== Сервисы ==' -ForegroundColor Cyan
$services = @(
    @{ name = 'api-gateway';     port = 8080 },
    @{ name = 'account-service'; port = 8081 },
    @{ name = 'payment-service'; port = 8082 },
    @{ name = 'catalog-service'; port = 8083 },
    @{ name = 'order-service';   port = 8084 }
)

$logDir = Join-Path $root '.tools\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

foreach ($svc in $services) {
    $listening = Get-NetTCPConnection -LocalPort $svc.port -State Listen -ErrorAction SilentlyContinue
    if ($listening) {
        Write-Host "  [i] $($svc.name) уже слушает порт $($svc.port)"
        continue
    }
    $log = Join-Path $logDir "$($svc.name).log"
    $cmd = ".\mvnw.cmd -B -ntp -pl services/$($svc.name) spring-boot:run > `"$log`" 2>&1"
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd -WorkingDirectory $root -WindowStyle Hidden
    Write-Host "  [>] $($svc.name) запускается (лог: $log)"
}

Write-Host '== Ожидание health-проверок =='
$allHealthy = $true
foreach ($svc in $services) {
    if (-not (Wait-ForUrl "http://localhost:$($svc.port)/actuator/health" $StartupTimeoutSeconds $svc.name)) {
        $allHealthy = $false
    }
}

Write-Host ''
if ($allHealthy) {
    Write-Host 'Стек готов:' -ForegroundColor Green
    Write-Host '  API        http://localhost:8080'
    Write-Host '  Swagger UI http://localhost:8080/swagger-ui.html'
    Write-Host '  Web (dev)  http://localhost:5173  (cd web; pnpm dev)'
    Write-Host '  Проверка   .\scripts\smoke-test.ps1'
} else {
    Write-Host 'Часть сервисов не поднялась — смотрите логи в .tools\logs' -ForegroundColor Red
    exit 1
}
