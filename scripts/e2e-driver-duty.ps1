<#
.SYNOPSIS
    Сквозной сценарий выхода водителя на линию.

.DESCRIPTION
    Проверяет правило, за которое платформа отвечает перед пассажиром: за руль
    выходит только водитель с действующими документами, и об этом узнаёт
    диспетчерская — через Kafka, а не через опрос базы.

      1. пользователь с ролью DRIVER регистрируется как водитель;
      2. выход на линию без документов -> 422 DRIVER_DOCUMENTS_INCOMPLETE
         (и статус в БД не меняется);
      3. загружаются три документа: права, техосмотр, медосмотр;
      4. выход на линию -> ONLINE, available=true;
      5. событие driver.online опубликовано через outbox и доехало до топика
         driver.events (проверяется и строка outbox со статусом PUBLISHED, и рост
         end-offset топика);
      6. повторный выход на линию -> 409 DRIVER_ALREADY_ON_DUTY;
      7. уход с линии -> OFFLINE и событие driver.offline;
      8. у чужого пользователя нет профиля водителя: GET /drivers/me -> 404
         (в API нет доступа к чужому профилю вообще);
      9. инварианты в БД: один водитель, три документа, статус OFFLINE,
         в outbox нет необработанных строк.

    Телефон генерируется случайным, поэтому сценарий можно гонять подряд.

.EXAMPLE
    .\scripts\e2e-driver-duty.ps1
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://localhost:8080',
    [string]$Phone = '',
    [string]$Code = '0000'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$script:Failures = 0

if ([string]::IsNullOrWhiteSpace($Phone)) {
    $Phone = '+7700' + (Get-Random -Minimum 1000000 -Maximum 9999999)
}

function Write-Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }

function Assert-True([bool]$condition, [string]$what) {
    if ($condition) { Write-Host "  [ok]   $what" -ForegroundColor Green }
    else { Write-Host "  [FAIL] $what" -ForegroundColor Red; $script:Failures++ }
}

function Invoke-Api {
    param([string]$Method, [string]$Path, [hashtable]$Headers = @{}, $Body = $null)
    $params = @{ Method = $Method; Uri = "$BaseUrl$Path"; UseBasicParsing = $true }
    if ($Headers.Count -gt 0) { $params['Headers'] = $Headers }
    if ($null -ne $Body) {
        $params['Body'] = ($Body | ConvertTo-Json -Compress -Depth 6)
        $params['ContentType'] = 'application/json'
    }
    try {
        $r = Invoke-WebRequest @params
        $raw = [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
        return [pscustomobject]@{ Status = [int]$r.StatusCode; Json = ($raw | ConvertFrom-Json); Raw = $raw }
    } catch {
        $resp = $_.Exception.Response
        if (-not $resp) { throw }
        $memory = New-Object System.IO.MemoryStream
        $resp.GetResponseStream().CopyTo($memory)
        $raw = [System.Text.Encoding]::UTF8.GetString($memory.ToArray())
        $json = $null
        try { $json = $raw | ConvertFrom-Json } catch { }
        return [pscustomobject]@{ Status = [int]$resp.StatusCode; Json = $json; Raw = $raw }
    }
}

function Psql([string]$database, [string]$sql) {
    (docker exec taxi-postgres psql -U taxi -d $database -tAc $sql 2>$null | Out-String).Trim()
}

# Latest offset of a topic, summed over partitions. 0 when the topic is empty.
function Topic-Offset([string]$topic) {
    $out = docker exec taxi-kafka /opt/kafka/bin/kafka-get-offsets.sh `
        --bootstrap-server localhost:9092 --topic $topic 2>$null
    $sum = 0
    foreach ($line in $out) {
        $parts = $line.ToString().Trim().Split(':')
        if ($parts.Count -ge 3) { $sum += [int]$parts[2] }
    }
    return $sum
}

# Waits for the relay to publish the event of THIS run (scoped by driver phone).
function Wait-Published([string]$eventType, [int]$timeoutSeconds = 25) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $count = Psql 'taxi_driver' @"
select count(*) from driver.outbox_message o
  join driver.driver d on d.id = o.aggregate_id
 where o.event_type = '$eventType' and o.status = 'PUBLISHED' and d.phone = '$Phone'
"@
        if ([int]$count -gt 0) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

$future = (Get-Date).ToUniversalTime().AddYears(1).ToString('yyyy-MM-ddTHH:mm:ssZ')

# ---------------------------------------------------------------- 1. token
Write-Step "1. Вход с ролью DRIVER ($Phone)"
$login = Invoke-Api -Method Post -Path '/api/v1/auth/token' -Body @{
    phone = $Phone; code = $Code; displayName = 'Драйвер E2E'; roles = @('DRIVER')
}
Assert-True ($login.Status -eq 200) "POST /api/v1/auth/token -> 200 (получено $($login.Status))"
if ($login.Status -ne 200) { Write-Host $login.Raw -ForegroundColor Red; exit 1 }
Assert-True ($login.Json.roles -contains 'DRIVER') "в токене есть роль DRIVER"
$auth = @{ Authorization = "Bearer $($login.Json.accessToken)" }

# ---------------------------------------------------------------- 2. registration
Write-Step '2. Регистрация водителя'
$registered = Invoke-Api -Method Post -Path '/api/v1/drivers' -Headers $auth -Body @{ displayName = 'Айдар E2E' }
Assert-True ($registered.Status -eq 201) "POST /api/v1/drivers -> 201 (получено $($registered.Status))"
Assert-True ($registered.Json.status -eq 'OFFLINE') "новый водитель не на линии (status=$($registered.Json.status))"
Assert-True ($registered.Json.available -eq $false) 'новый водитель недоступен для заказов'
$driverId = $registered.Json.driverId
Assert-True ($driverId.Length -eq 26) "id водителя — ULID ($driverId)"

# ---------------------------------------------------------------- 3. duty without papers
Write-Step '3. Выход на линию без документов'
$refused = Invoke-Api -Method Post -Path '/api/v1/drivers/me/status' -Headers $auth -Body @{ status = 'ONLINE' }
Assert-True ($refused.Status -eq 422) "POST /api/v1/drivers/me/status -> 422 (получено $($refused.Status))"
Assert-True ($refused.Json.code -eq 'DRIVER_DOCUMENTS_INCOMPLETE') "код ошибки DRIVER_DOCUMENTS_INCOMPLETE (получен $($refused.Json.code))"
Assert-True ($refused.Json.correlationId -ne $null) 'в ответе есть correlationId'
$stillOffline = Psql 'taxi_driver' "select status from driver.driver where id = '$driverId'"
Assert-True ($stillOffline -eq 'OFFLINE') "статус в БД не изменился ($stillOffline)"

# ---------------------------------------------------------------- 4. documents
Write-Step '4. Документы: права, техосмотр, медосмотр'
foreach ($kind in @('DRIVING_LICENCE', 'VEHICLE_INSPECTION', 'MEDICAL_CHECK')) {
    $document = Invoke-Api -Method Post -Path '/api/v1/drivers/me/documents' -Headers $auth `
        -Body @{ kind = $kind; expiresAt = $future }
    Assert-True ($document.Status -eq 200) "$kind принят (HTTP $($document.Status))"
    Assert-True ($document.Json.valid -eq $true) "$kind действителен"
}
$documentCount = Psql 'taxi_driver' "select count(*) from driver.driver_document where driver_id = '$driverId'"
Assert-True ([int]$documentCount -eq 3) "в БД три документа (получено $documentCount)"

# ---------------------------------------------------------------- 5. going on duty
Write-Step '5. Выход на линию'
$offsetBefore = Topic-Offset 'driver.events'
$online = Invoke-Api -Method Post -Path '/api/v1/drivers/me/status' -Headers $auth -Body @{ status = 'ONLINE' }
Assert-True ($online.Status -eq 200) "POST status=ONLINE -> 200 (получено $($online.Status))"
Assert-True ($online.Json.status -eq 'ONLINE') "статус ONLINE (получен $($online.Json.status))"
Assert-True ($online.Json.available -eq $true) 'водитель доступен для заказов'

Write-Step '6. Событие driver.online дошло до Kafka'
Assert-True (Wait-Published 'driver.online') 'строка outbox опубликована (status=PUBLISHED)'
$offsetAfter = Topic-Offset 'driver.events'
Assert-True ($offsetAfter -gt $offsetBefore) "end-offset топика вырос ($offsetBefore -> $offsetAfter)"

# ---------------------------------------------------------------- 7. double duty
Write-Step '7. Повторный выход на линию'
$twice = Invoke-Api -Method Post -Path '/api/v1/drivers/me/status' -Headers $auth -Body @{ status = 'ONLINE' }
Assert-True ($twice.Status -eq 409) "повторный ONLINE -> 409 (получено $($twice.Status))"
Assert-True ($twice.Json.code -eq 'DRIVER_ALREADY_ON_DUTY') "код DRIVER_ALREADY_ON_DUTY (получен $($twice.Json.code))"

Write-Step '8. Клиент не может объявить себя занятым'
$busy = Invoke-Api -Method Post -Path '/api/v1/drivers/me/status' -Headers $auth -Body @{ status = 'BUSY' }
Assert-True ($busy.Status -eq 400) "status=BUSY -> 400 (получено $($busy.Status))"
Assert-True ($busy.Json.code -eq 'INVALID_DRIVER') "код INVALID_DRIVER (получен $($busy.Json.code))"

# ---------------------------------------------------------------- 9. going offline
Write-Step '9. Уход с линии'
$offline = Invoke-Api -Method Post -Path '/api/v1/drivers/me/status' -Headers $auth -Body @{ status = 'OFFLINE' }
Assert-True ($offline.Status -eq 200) "POST status=OFFLINE -> 200 (получено $($offline.Status))"
Assert-True ($offline.Json.status -eq 'OFFLINE') "статус OFFLINE (получен $($offline.Json.status))"
Assert-True (Wait-Published 'driver.offline') 'событие driver.offline опубликовано'

# ---------------------------------------------------------------- 10. no foreign profiles
Write-Step '10. Чужой профиль недоступен'
$strangerPhone = '+7700' + (Get-Random -Minimum 1000000 -Maximum 9999999)
$strangerToken = (Invoke-Api -Method Post -Path '/api/v1/auth/token' -Body @{
    phone = $strangerPhone; code = $Code; displayName = 'Прохожий'; roles = @('DRIVER')
}).Json.accessToken
$stranger = Invoke-Api -Method Get -Path '/api/v1/drivers/me' -Headers @{ Authorization = "Bearer $strangerToken" }
Assert-True ($stranger.Status -eq 404) "у незарегистрированного водителя нет профиля -> 404 (получено $($stranger.Status))"
Assert-True ($stranger.Json.code -eq 'DRIVER_NOT_FOUND') "код DRIVER_NOT_FOUND (получен $($stranger.Json.code))"
$anonymous = Invoke-Api -Method Get -Path '/api/v1/drivers/me'
Assert-True ($anonymous.Status -eq 401) "без токена -> 401 (получено $($anonymous.Status))"

# ---------------------------------------------------------------- 11. invariants
Write-Step '11. Инварианты в БД'
$drivers = Psql 'taxi_driver' "select count(*) from driver.driver where phone = '$Phone'"
Assert-True ([int]$drivers -eq 1) "ровно один профиль на телефон (получено $drivers)"
$duplicates = Psql 'taxi_driver' "select count(*) from (select user_id from driver.driver group by user_id having count(*) > 1) d"
Assert-True ([int]$duplicates -eq 0) 'нет пользователей с двумя профилями'
$status = Psql 'taxi_driver' "select status from driver.driver where id = '$driverId'"
Assert-True ($status -eq 'OFFLINE') "итоговый статус OFFLINE ($status)"
$stuck = Psql 'taxi_driver' "select count(*) from driver.outbox_message where status <> 'PUBLISHED'"
Assert-True ([int]$stuck -eq 0) "в outbox нет необработанных событий (получено $stuck)"
$topicCounts = docker exec taxi-kafka /opt/kafka/bin/kafka-get-offsets.sh --bootstrap-server localhost:9092 --topic driver.events 2>$null
Assert-True ($null -ne $topicCounts) 'топик driver.events существует'

Write-Host ''
if ($script:Failures -gt 0) {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $($script:Failures)" -ForegroundColor Red
    exit 1
}
Write-Host "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ (водитель $driverId, тел. $Phone)" -ForegroundColor Green
exit 0
