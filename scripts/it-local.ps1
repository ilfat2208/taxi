<#
.SYNOPSIS
    Локальный прогон интеграционных тестов (*IT) на инфраструктуре из docker compose.

.DESCRIPTION
    Интеграционные тесты платформы написаны под Testcontainers, но на машине, где
    docker-java не может договориться с демоном (CLI работает, а DockerClientProviderStrategy
    получает пустой DockerInfo со всех именованных каналов), они молча уходят в Skipped —
    то есть «зелено» без единой проверки. Поэтому тесты умеют брать инфраструктуру снаружи:
    если задан IT_DATABASE_URL, контейнер не поднимается, а Flyway накатывает миграции на
    указанную базу. В CI переменная не задана, и там по-прежнему работает Testcontainers.

    Скрипт делает ровно это:
      1. проверяет, что контейнер taxi-postgres запущен;
      2. подбирает адрес, по которому JDBC действительно доходит до ЭТОГО Postgres.
         На машине с собственным (не docker) PostgreSQL порт 5432 по IPv4 занят им, и
         `localhost` приводит к чужому серверу с ошибкой «роль "taxi" не существует»;
         проверка делается настоящим подключением через JDBC-драйвер из ~/.m2;
      3. пересоздаёт тестовые базы it_payment / it_order / it_catalog (схемы внутри создаст
         Flyway) — так прогон всегда начинается с чистой базы, а демо-данные не трогаются;
      4. выставляет IT_DATABASE_URL, POSTGRES_USER, POSTGRES_PASSWORD;
      5. запускает `mvnw verify -Pintegration` и печатает сводку по модулям.

    Скрипт ничего не меняет в docker-compose и в pom.xml: он только читает инфраструктуру.

.PARAMETER Modules
    Модули, которые прогонять: payment, order, catalog. По умолчанию — все три.

.PARAMETER DatabaseHost
    Адрес Postgres. По умолчанию подбирается автоматически (127.0.0.1, затем [::1],
    затем localhost). Можно задать вручную, если автоподбор не угадал.

.PARAMETER KeepDatabases
    Не пересоздавать тестовые базы (быстрее, но база остаётся с прошлого прогона).

.PARAMETER KafkaBootstrap
    Адрес Kafka, если он нужен: например 127.0.0.1:9092. По умолчанию не передаётся —
    ни один *IT его не требует (слушатели выключены, relay выключен, строки outbox
    проверяются напрямую), и в CI брокера тоже нет.

.EXAMPLE
    .\scripts\it-local.ps1
    .\scripts\it-local.ps1 -Modules payment
    .\scripts\it-local.ps1 -DatabaseHost '[::1]' -KeepDatabases
#>
[CmdletBinding()]
param(
    [string[]]$Modules = @('payment', 'order', 'catalog'),
    [string]$DatabaseHost = '',
    [string]$PostgresContainer = 'taxi-postgres',
    [string]$PostgresUser = $(if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'taxi' }),
    [string]$PostgresPassword = $(if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { 'taxi' }),
    [int]$PostgresPort = 5432,
    [string]$KafkaBootstrap = '',
    [switch]$KeepDatabases
)

$ErrorActionPreference = 'Stop'
# Кириллица в выводе maven и в сообщениях: консоль Windows по умолчанию не в UTF-8.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$script:Failures = 0

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DatabaseByModule = @{
    payment = 'it_payment'
    order   = 'it_order'
    catalog = 'it_catalog'
}

function Write-Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }

function Assert-True([bool]$condition, [string]$what) {
    if ($condition) {
        Write-Host "  [ok]   $what" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] $what" -ForegroundColor Red
        $script:Failures++
    }
}

function Invoke-Psql([string]$database, [string]$sql) {
    $output = docker exec $PostgresContainer psql -U $PostgresUser -d $database -tAc $sql 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "psql -d $database не выполнился: $output"
    }
    return ($output | Out-String).Trim()
}

# Подбор адреса: TCP-порт может отвечать и у чужого сервера, поэтому проверяем
# настоящее подключение драйвером — тем же, которым ходят тесты.
#
# Возвращает 'OK' или 'FAIL <причина>'. Отдельная функция, потому что тот же
# вопрос задаётся и к адресу, указанному вручную: без проверки `-DatabaseHost
# localhost` на машине с системным PostgreSQL уводит тесты в чужой сервер, и
# вместо понятной причины получается пять ошибок «роль не существует».
function Test-DatabaseCandidate {
    param(
        [Parameter(Mandatory)][string]$HostName,
        [Parameter(Mandatory)][int]$Port,
        [Parameter(Mandatory)][string]$User,
        [Parameter(Mandatory)][string]$Password
    )

    $driver = Get-ChildItem (Join-Path $env:USERPROFILE '.m2\repository\org\postgresql\postgresql') `
        -Recurse -Filter 'postgresql-*.jar' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch 'sources|javadoc' } |
        Sort-Object Name -Descending | Select-Object -First 1
    if (-not $driver -or -not (Get-Command java -ErrorAction SilentlyContinue)) {
        # Проверить нечем — считаем, что адрес подходит: тесты всё равно скажут точнее.
        return 'OK'
    }

    $probe = Join-Path $env:TEMP 'ItDbProbe.java'
    @'
import java.sql.Connection;
import java.sql.DriverManager;

public class ItDbProbe {
    public static void main(String[] args) {
        String url = "jdbc:postgresql://" + args[0] + ":" + args[1] + "/" + args[2];
        try (Connection ignored = DriverManager.getConnection(url, args[3], args[4])) {
            System.out.println("OK");
        } catch (Exception failure) {
            System.out.println("FAIL " + failure.getMessage());
        }
    }
}
'@ | Set-Content -Path $probe -Encoding ASCII

    $answer = & java -cp $driver.FullName $probe $HostName $Port 'postgres' $User $Password 2>&1
    return (($answer | Out-String).Trim() -split "`r?`n" | Select-Object -First 1)
}

function Get-JdbcHost {
    foreach ($candidate in @('127.0.0.1', '[::1]', 'localhost')) {
        $answer = Test-DatabaseCandidate -HostName $candidate -Port $PostgresPort `
            -User $PostgresUser -Password $PostgresPassword
        if ($answer -eq 'OK') {
            Write-Host "  [ok]   Postgres для тестов доступен по $candidate`:$PostgresPort"
            return $candidate
        }
        Write-Host "  [i]    $candidate`:$PostgresPort не подходит ($answer)" -ForegroundColor Yellow
    }
    return 'localhost'
}

# ------------------------------------------------------------------ 1. инфраструктура
Write-Step '1. Инфраструктура: контейнер Postgres'
$running = docker inspect -f '{{.State.Running}}' $PostgresContainer 2>$null
Assert-True ($running -eq 'true') "контейнер $PostgresContainer запущен"
if ($running -ne 'true') {
    Write-Host "Поднимите стек: docker compose up -d postgres kafka" -ForegroundColor Red
    exit 1
}

# ------------------------------------------------------------------ 2. адрес БД
Write-Step '2. Адрес Postgres, по которому ходят тесты'
if ($DatabaseHost) {
    Write-Host "  [i]    адрес задан вручную: $DatabaseHost"
    # Заданный вручную адрес всё равно проверяем: на машине с собственным (не docker)
    # PostgreSQL порт 5432 по IPv4 держит он, и `-DatabaseHost localhost` тихо уводит
    # тесты в чужой сервер. Симптом — пять ошибок «роль "taxi" не существует» вместо
    # понятного сообщения, поэтому проверяем здесь и говорим, что делать.
    $manualProbe = Test-DatabaseCandidate -HostName $DatabaseHost -Port $PostgresPort `
        -User $PostgresUser -Password $PostgresPassword
    if ($manualProbe -ne 'OK') {
        Write-Host "  [!]    $DatabaseHost`:$PostgresPort не принял учётные данные $PostgresUser" -ForegroundColor Red
        Write-Host '         Похоже, на этом порту отвечает другой Postgres (например, установленный в систему).' -ForegroundColor Yellow
        Write-Host '         Уберите -DatabaseHost: скрипт сам найдёт адрес контейнера (обычно это [::1]) по учётным данным.' -ForegroundColor Yellow
        exit 1
    }
    Write-Host "  [ok]   Postgres для тестов доступен по $DatabaseHost`:$PostgresPort"
} else {
    $DatabaseHost = Get-JdbcHost
}
Assert-True (-not [string]::IsNullOrWhiteSpace($DatabaseHost)) "адрес выбран: $DatabaseHost"

# ------------------------------------------------------------------ 3. базы
Write-Step '3. Тестовые базы (демо-базы taxi_* не трогаем)'
if ($KeepDatabases) {
    Write-Host '  [i]    -KeepDatabases: базы не пересоздаются'
}
foreach ($module in $Modules) {
    if (-not $DatabaseByModule.ContainsKey($module)) {
        throw "неизвестный модуль '$module'; ожидались: $($DatabaseByModule.Keys -join ', ')"
    }
    $database = $DatabaseByModule[$module]
    if (-not $KeepDatabases) {
        Invoke-Psql 'postgres' "drop database if exists $database with (force)" | Out-Null
    }
    $exists = Invoke-Psql 'postgres' "select count(*) from pg_database where datname = '$database'"
    if ([int]$exists -eq 0) {
        Invoke-Psql 'postgres' "create database $database" | Out-Null
    }
    Assert-True ((Invoke-Psql 'postgres' "select count(*) from pg_database where datname = '$database'") -eq '1') `
        "база $database готова"
    # Схемы и таблицы создаст Flyway при первом подъёме контекста.
}

# ------------------------------------------------------------------ 4. окружение
Write-Step '4. Переменные окружения для тестов'
$env:POSTGRES_USER = $PostgresUser
$env:POSTGRES_PASSWORD = $PostgresPassword
if ($KafkaBootstrap) {
    $env:IT_KAFKA_BOOTSTRAP = $KafkaBootstrap
    Write-Host "  [i]    Kafka для тестов: $KafkaBootstrap"
} else {
    Remove-Item Env:\IT_KAFKA_BOOTSTRAP -ErrorAction SilentlyContinue
}
Write-Host "  [i]    POSTGRES_USER=$PostgresUser, IT_DATABASE_URL=<на каждый модуль свой>"

# ------------------------------------------------------------------ 5. прогон
Write-Step '5. mvnw verify -Pintegration'
# mvnw clean удаляет target целиком, поэтому каталог для логов создаём сами.
$logDirectory = Join-Path $RepoRoot 'target\it-local'
if (-not (Test-Path $logDirectory)) {
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
}
$summary = @()
foreach ($module in $Modules) {
    $database = $DatabaseByModule[$module]
    $env:IT_DATABASE_URL = "jdbc:postgresql://$DatabaseHost`:$PostgresPort/$database"
    $log = Join-Path $logDirectory "$module.log"
    Write-Host "`n--- $module-service: $env:IT_DATABASE_URL ---" -ForegroundColor Cyan

    Push-Location $RepoRoot
    try {
        & .\mvnw.cmd verify -Pintegration -pl "services/$module-service" *> $log
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    $totals = Select-String -Path $log -Pattern 'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)' |
        Select-Object -Last 1
    $row = [pscustomobject]@{
        Module   = $module
        Database = $database
        Tests    = if ($totals) { [int]$totals.Matches[0].Groups[1].Value } else { 0 }
        Failures = if ($totals) { [int]$totals.Matches[0].Groups[2].Value } else { 0 }
        Errors   = if ($totals) { [int]$totals.Matches[0].Groups[3].Value } else { 0 }
        Skipped  = if ($totals) { [int]$totals.Matches[0].Groups[4].Value } else { 0 }
        ExitCode = $exitCode
        Log      = $log
    }
    $summary += $row

    Assert-True ($exitCode -eq 0) "$module-service: mvnw verify -Pintegration -> 0 (получено $exitCode), лог: $log"
    Assert-True ($row.Tests -gt 0) "$module-service: тесты действительно выполнялись ($($row.Tests))"
    # Пропущенный интеграционный тест — это не «зелено»: именно так эта задача и начиналась.
    Assert-True ($row.Skipped -eq 0) "$module-service: пропущенных тестов нет (Skipped=$($row.Skipped))"
    Assert-True ($row.Failures -eq 0 -and $row.Errors -eq 0) `
        "$module-service: падений нет (Failures=$($row.Failures), Errors=$($row.Errors))"
}

# ------------------------------------------------------------------ 6. сводка
Write-Step '6. Сводка'
$summary | Format-Table Module, Database, Tests, Failures, Errors, Skipped, ExitCode -AutoSize | Out-String |
    Write-Host

Write-Host ''
if ($script:Failures -eq 0) {
    Write-Host "ИНТЕГРАЦИОННЫЕ ТЕСТЫ ЗЕЛЁНЫЕ (Postgres $DatabaseHost`:$PostgresPort)" -ForegroundColor Green
    exit 0
} else {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $script:Failures" -ForegroundColor Red
    exit 1
}
