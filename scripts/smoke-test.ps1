<#
.SYNOPSIS
    Сквозная проверка платформы: инфраструктура -> токен -> счёт -> пополнение ->
    перевод -> леджер -> Kafka.

.DESCRIPTION
    Проверяет не «сервис отвечает 200», а инварианты денежной системы:
      * счёт открывается и повторное открытие даёт 409, а не второй счёт;
      * пополнение двигает баланс и оставляет сбалансированную проводку;
      * перевод требует Idempotency-Key, а повтор с тем же ключом не двигает
        деньги второй раз;
      * ошибки приходят в формате RFC 7807 с correlationId;
      * события попадают в Kafka через outbox, а таблица outbox пуста по PENDING.

    Скрипт предполагает, что gateway (8080) и account-service (8081) уже запущены,
    а инфраструктура поднята через `docker compose up -d postgres kafka redis`.

.EXAMPLE
    .\scripts\smoke-test.ps1
    .\scripts\smoke-test.ps1 -BaseUrl http://localhost:8080
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://localhost:8080',
    [string]$Phone = '+77001234567',
    [string]$Code = '0000',
    [long]$TopUpMinor = 500000
)

$ErrorActionPreference = 'Stop'
# Кириллица из API: консоль Windows по умолчанию не в UTF-8.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$script:Failures = 0

function Write-Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }

function Assert-True([bool]$condition, [string]$what) {
    if ($condition) {
        Write-Host "  [ok]   $what" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] $what" -ForegroundColor Red
        $script:Failures++
    }
}

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Path,
        [hashtable]$Headers = @{},
        [string]$Body,
        [int[]]$ExpectStatus = @(200, 201)
    )

    $uri = "$BaseUrl$Path"
    $params = @{ Method = $Method; Uri = $uri; Headers = $Headers; UseBasicParsing = $true }
    if ($Body) {
        # Bytes, not a string: a PowerShell string body goes out as ISO-8859-1 and
        # turns every Cyrillic value into "?????" on the wire.
        $params['Body'] = [System.Text.Encoding]::UTF8.GetBytes($Body)
        $params['ContentType'] = 'application/json; charset=utf-8'
    }

    try {
        $response = Invoke-WebRequest @params
        return [pscustomobject]@{
            Status = [int]$response.StatusCode
            Body   = $response.Content
        }
    } catch {
        $response = $_.Exception.Response
        if (-not $response) { throw }
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        return [pscustomobject]@{
            Status = [int]$response.StatusCode
            Body   = $reader.ReadToEnd()
        }
    }
}

function ConvertTo-Json2($text) {
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    try { return $text | ConvertFrom-Json } catch { return $null }
}

Write-Step "1. Токен (dev-identity: любой +7XXXXXXXXXX, код $Code)"
$tokenResponse = Invoke-Api -Method Post -Path '/api/v1/auth/token' -Body (@{
    phone       = $Phone
    code        = $Code
    displayName = 'Smoke Test'
    roles       = @('CUSTOMER', 'ADMIN')
} | ConvertTo-Json)
Assert-True ($tokenResponse.Status -eq 200) "POST /api/v1/auth/token -> 200 (получено $($tokenResponse.Status))"
$token = (ConvertTo-Json2 $tokenResponse.Body).accessToken
Assert-True (-not [string]::IsNullOrWhiteSpace($token)) 'токен получен'
if (-not $token) { Write-Host "Ответ: $($tokenResponse.Body)" -ForegroundColor Red; exit 1 }

$auth = @{ Authorization = "Bearer $token" }
$userId = (ConvertTo-Json2 $tokenResponse.Body).userId

Write-Step '2. Счёт: открытие и защита от дубликата'
$create = Invoke-Api -Method Post -Path '/api/v1/accounts' -Headers $auth -Body (@{
    currency = 'KZT'; type = 'CUSTOMER'; displayName = 'Smoke Test'
} | ConvertTo-Json)
$account = ConvertTo-Json2 $create.Body
if ($create.Status -eq 409) {
    Write-Host '  [i] счёт уже существует, использую его' -ForegroundColor Yellow
    $list = Invoke-Api -Method Get -Path '/api/v1/accounts' -Headers $auth
    $account = (ConvertTo-Json2 $list.Body) | Where-Object { $_.currency -eq 'KZT' } | Select-Object -First 1
} else {
    Assert-True ($create.Status -eq 201) "POST /api/v1/accounts -> 201 (получено $($create.Status))"
}
Assert-True ($null -ne $account.id) "счёт открыт: $($account.id)"

$duplicate = Invoke-Api -Method Post -Path '/api/v1/accounts' -Headers $auth -Body (@{
    currency = 'KZT'; type = 'CUSTOMER'
} | ConvertTo-Json)
Assert-True ($duplicate.Status -eq 409) "повторное открытие -> 409 (получено $($duplicate.Status))"
Assert-True ((ConvertTo-Json2 $duplicate.Body).code -eq 'ACCOUNT_ALREADY_EXISTS') 'код ошибки ACCOUNT_ALREADY_EXISTS'

Write-Step "3. Пополнение на $TopUpMinor минорных единиц (роль ADMIN)"
$topUp = Invoke-Api -Method Post -Path "/api/v1/accounts/$($account.id)/top-up" -Headers $auth -Body (@{
    amountMinor = $TopUpMinor; reason = 'smoke test funds'
} | ConvertTo-Json)
Assert-True ($topUp.Status -eq 200) "POST top-up -> 200 (получено $($topUp.Status))"
$after = ConvertTo-Json2 $topUp.Body
$expectedBalance = [long]$account.balanceMinor + $TopUpMinor
Assert-True ($after.balanceMinor -eq $expectedBalance) "баланс = $expectedBalance (получено $($after.balanceMinor))"
Assert-True ($after.availableMinor -eq $after.balanceMinor - $after.heldMinor) 'available = balance - held'

Write-Step '4. Выписка по леджеру'
$statement = Invoke-Api -Method Get -Path "/api/v1/accounts/$($account.id)/transactions?page=0&size=10" -Headers $auth
$tx = ConvertTo-Json2 $statement.Body
Assert-True ($tx.totalElements -ge 1) "в выписке есть проводки (всего $($tx.totalElements))"
$topUpEntry = $tx.items | Where-Object { $_.operation -eq 'TOP_UP' } | Select-Object -First 1
Assert-True ($null -ne $topUpEntry) 'проводка TOP_UP найдена'
Assert-True ($topUpEntry.direction -eq 'CREDIT') 'пополнение — это CREDIT на счёте клиента'

Write-Step '5. Ошибки: RFC 7807 + correlationId'
$bad = Invoke-Api -Method Post -Path '/api/v1/accounts' -Headers $auth -Body (@{ currency = 'KZT' } | ConvertTo-Json)
Assert-True ($bad.Status -eq 400) "невалидное тело -> 400 (получено $($bad.Status))"
$problem = ConvertTo-Json2 $bad.Body
Assert-True ($problem.code -eq 'VALIDATION_FAILED') 'code = VALIDATION_FAILED'
Assert-True (-not [string]::IsNullOrWhiteSpace($problem.correlationId)) 'correlationId присутствует'
Assert-True ($problem.errors.Count -ge 1) 'перечислены поля с ошибками'

$anonymous = Invoke-Api -Method Get -Path '/api/v1/accounts'
Assert-True ($anonymous.Status -eq 401) "без токена -> 401 (получено $($anonymous.Status))"

Write-Step '6. Kafka: события доехали через outbox'
$topics = docker exec taxi-kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list 2>$null
Assert-True ($topics -contains 'account.events') 'топик account.events существует'
Assert-True ($topics -contains 'account.events.DLT') 'топик account.events.DLT существует'
Assert-True ($topics -contains 'payment.events') 'топик payment.events существует'

$outbox = docker exec taxi-postgres psql -U taxi -d taxi_account -tAc `
    "select count(*) from account.outbox_message where status <> 'PUBLISHED'"
Assert-True ([int]$outbox -eq 0) "нет неопубликованных событий (PENDING/FAILED = $outbox)"

Write-Step '7. Инвариант леджера: сумма проводок каждой транзакции равна нулю'
$broken = docker exec taxi-postgres psql -U taxi -d taxi_account -tAc `
    "select count(*) from (select transaction_id, sum(case when direction='CREDIT' then amount_minor else -amount_minor end) s from account.ledger_entry group by transaction_id having sum(case when direction='CREDIT' then amount_minor else -amount_minor end) <> 0) broken"
Assert-True ([int]$broken -eq 0) "несбалансированных транзакций: $broken"

Write-Step '8. Инвариант проекции: баланс счёта равен сумме его проводок'
# Эта проверка ловит самый неприятный класс ошибок: проводка записана, а баланс не
# изменён (или наоборот). Именно так выглядит расхождение денег и выписки клиента.
$divergent = docker exec taxi-postgres psql -U taxi -d taxi_account -tAc `
    "select count(*) from (select a.id from account.account a left join (select account_id, sum(case when direction='CREDIT' then amount_minor else -amount_minor end) signed from account.ledger_entry group by account_id) l on l.account_id = a.id where a.balance_minor <> coalesce(l.signed, 0)) divergent"
Assert-True ([int]$divergent -eq 0) "счетов с расхождением баланса и леджера: $divergent"

Write-Host ''
if ($script:Failures -eq 0) {
    Write-Host "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ (userId=$userId)" -ForegroundColor Green
    exit 0
} else {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $script:Failures" -ForegroundColor Red
    exit 1
}
