<#
.SYNOPSIS
    Сквозной сценарий такси: котировка -> заявка -> назначение -> поездка -> деньги -> чек.

.DESCRIPTION
    Проверяет обещание, за которое платформа отвечает перед пассажиром и перед водителем:
    цена, которую показали, — это ровно то, что списали, и списали один раз.

      1. водитель регистрируется, загружает документы и выходит на линию (driver-service);
      2. диспетчерская замечает его АСИНХРОННО — событие driver.online идёт через Kafka;
         сценарий измеряет этот разрыв, дожидаясь, пока водитель появится в проекции
         (иначе позиция отвергается 409 DRIVER_NOT_ON_DUTY, машины нет в GEO-индексе, и
         заявка честно уходит в NO_DRIVERS_FOUND);
      3. пассажир (роль CUSTOMER) с кошельком в KZT запрашивает котировку: проверяются оба
         инварианта цены — baseMinor + distanceMinor + timeMinor = priceMinor и
         driverNetMinor + commissionMinor = priceMinor;
      4. заявка с Idempotency-Key -> 202, статус ASSIGNED: машина подобрана АВТОМАТИЧЕСКИ
         через dispatch /internal/nearest; повтор с тем же ключом возвращает ту же поездку,
         а счётчик в БД доказывает, что второй не создалось;
      5. деньги зарезервированы, а не списаны: available = balance - price, held = price;
      6. диспетчерская дверь: обычному клиенту assign -> 403, диспетчеру на ту же поездку
         и того же водителя -> 200 и ТОТ ЖЕ холд (повтор не резервирует второй раз);
      7. чужую поездку не видно: GET чужой поездки и чек -> 403;
      8. чек до завершения -> 409 TRIP_NOT_COMPLETED (чек — факт состоявшейся поездки);
      9. диспетчерские вызовы ARRIVE -> START -> COMPLETE доводят поездку до конца;
     10. отмена во время поездки -> 409 TRIP_NOT_CANCELLABLE, и резерв ОСТАЁТСЯ активным
         (дефект, из-за которого выполненную поездку нельзя было бы списать);
     11. завершение: со счёта списано ровно priceMinor, резерв снят, холд захвачен,
         проводка в леджжере сбалансирована;
     12. чек после завершения -> 200, обе суммы сходятся, транзакция списания указана;
     13. отмена живой поездки (ASSIGNED) -> CANCELLED_BY_RIDER, деньги вернулись: held = 0,
         баланс не изменился, повторная отмена не падает;
     14. инварианты в БД: на один Idempotency-Key — одна поездка, статусы и холды совпадают
         с ответами API, события trip.* опубликованы через outbox, таймлайн поездки полный.

    Телефоны генерируются случайным числом, поэтому сценарий можно гонять подряд.

.EXAMPLE
    .\scripts\e2e-trip.ps1
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://localhost:8080',
    [string]$Code = '0000',
    # Демо-пополнение пассажирского счёта: двух поездок по ~900 KZT хватает с запасом.
    [long]$TopUpMinor = 5000000,
    # Тот же секрет, что у сервисов (docker-compose: INTERNAL_API_TOKEN). Им подписаны
    # служебные вызовы под /internal/: у них нет пользовательского токена по замыслу —
    # жизненный цикл поездки двигает нагрузка (диспетчерская, приложение водителя), а не человек.
    [string]$InternalToken = 'local-internal-token-change-me',
    # Служебные вызовы идут МИМО шлюза, как их делают сервисы (dispatch-service и
    # driver-service): шлюз аутентифицирует людей и без пользовательского токена отвечает 401,
    # а /internal/ для того и существует, чтобы рабочая нагрузка не притворялась человеком.
    [string]$InternalUrl = 'http://localhost:8086'
)

$ErrorActionPreference = 'Stop'
# Диагностика (psql, kafka-get-offsets) не должна обрывать прогон: недоступный контейнер
# или опечатка в SQL — это строка предупреждения, а не конец сценария.
$PSNativeCommandUseErrorActionPreference = $false
# Кириллица из API: консоль Windows по умолчанию не в UTF-8.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$script:Failures = 0

# Точка подачи — Алматы, Абая 150; высадка в трёх километрах, чтобы цена была осмысленной.
$pickupLat = 43.2389; $pickupLon = 76.8897; $pickupAddress = 'Алматы, пр. Абая 150'
$dropoffLat = 43.2489; $dropoffLon = 76.8897; $dropoffAddress = 'Алматы, ул. Достык 5'

$riderPhone = '+7701' + (Get-Random -Minimum 1000000 -Maximum 9999999)
$otherRiderPhone = '+7702' + (Get-Random -Minimum 1000000 -Maximum 9999999)
$driverPhone = '+7705' + (Get-Random -Minimum 1000000 -Maximum 9999999)
$dispatcherPhone = '+7707' + (Get-Random -Minimum 1000000 -Maximum 9999999)

function Write-Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }

function Assert-True([bool]$condition, [string]$what) {
    if ($condition) { Write-Host "  [ok]   $what" -ForegroundColor Green }
    else { Write-Host "  [FAIL] $what" -ForegroundColor Red; $script:Failures++ }
}

function Invoke-Api {
    param([string]$Method, [string]$Path, [hashtable]$Headers = @{}, $Body = $null, [string]$Url = '')
    if ([string]::IsNullOrWhiteSpace($Url)) { $Url = $BaseUrl }
    $params = @{ Method = $Method; Uri = "$Url$Path"; UseBasicParsing = $true }
    if ($Headers.Count -gt 0) { $params['Headers'] = $Headers }
    if ($null -ne $Body) {
        # UTF-8 байтами: строковое тело уходит как ISO-8859-1 и портит кириллицу.
        $params['Body'] = [System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress -Depth 6))
        $params['ContentType'] = 'application/json; charset=utf-8'
    }
    try {
        $r = Invoke-WebRequest @params
        $raw = [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
        $json = $null
        try { $json = $raw | ConvertFrom-Json } catch { }
        return [pscustomobject]@{ Status = [int]$r.StatusCode; Json = $json; Raw = $raw }
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

# Прямой запрос в БД: нужен там, где ответ API сам по себе не доказывает инвариант
# (счётчик поездок на один Idempotency-Key, статус холда, содержимое outbox).
function Psql([string]$database, [string]$sql) {
    try {
        return (docker exec taxi-postgres psql -U taxi -d $database -tAc $sql 2>$null | Out-String).Trim()
    } catch {
        Write-Host "  [!]    запрос к БД не выполнен: $($_.Exception.Message)" -ForegroundColor Yellow
        return ''
    }
}

# Latest offset of a topic, summed over partitions. 0 when the topic is empty.
function Topic-Offset([string]$topic) {
    try {
        $out = docker exec taxi-kafka /opt/kafka/bin/kafka-get-offsets.sh `
            --bootstrap-server localhost:9092 --topic $topic 2>$null
    } catch {
        Write-Host "  [!]    топик $topic недоступен: $($_.Exception.Message)" -ForegroundColor Yellow
        return 0
    }
    $sum = 0
    foreach ($line in $out) {
        $parts = $line.ToString().Trim().Split(':')
        if ($parts.Count -ge 3) { $sum += [int]$parts[2] }
    }
    return $sum
}

# Waits for the relay to publish the events of THIS run (scoped by the trip id).
function Wait-Published([string]$tripId, [int]$timeoutSeconds = 30) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $count = Psql 'taxi_trip' "select count(*) from trip.outbox_message where aggregate_id = '$tripId' and status = 'PUBLISHED'"
        if ([int]$count -gt 0) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function New-Token([string]$phone, [string]$name, [string[]]$roles) {
    $token = Invoke-Api -Method Post -Path '/api/v1/auth/token' -Body @{
        phone = $phone; code = $Code; displayName = $name; roles = $roles
    }
    if ($token.Status -ne 200) {
        Write-Host $token.Raw -ForegroundColor Red
        exit 1
    }
    return $token.Json
}

# Водитель должен стоять там, откуда пассажир заказывает: позиции живут в Redis с TTL,
# и «протухшая» машина в подбор не попадает.
function Send-Position($auth, [double]$lat, [double]$lon) {
    return Invoke-Api -Method Post -Path '/api/v1/locations' -Headers $auth -Body @{
        lat = $lat; lon = $lon; headingDeg = 0; speedKph = 0; accuracyM = 5
    }
}

function New-Quote($auth, [string]$tariff = 'ECONOMY') {
    return Invoke-Api -Method Post -Path '/api/v1/trips/quote' -Headers $auth -Body @{
        pickup = @{ lat = $pickupLat; lon = $pickupLon; address = $pickupAddress }
        dropoff = @{ lat = $dropoffLat; lon = $dropoffLon; address = $dropoffAddress }
        tariff = $tariff
    }
}

# Служебный вызов: X-Internal-Token обязателен, пользовательского токена здесь нет по замыслу
# (InternalApiTokenFilter отвергает запрос без него). Идём прямо в сервис: шлюз — дверь для
# людей, а это дверь для рабочей нагрузки, и так её и открывают dispatch-service и driver-service.
function Invoke-Internal([string]$Action, [string]$tripId) {
    return Invoke-Api -Method Post -Path "/api/v1/trips/internal/$tripId/$Action" -Url $InternalUrl `
        -Headers @{ 'X-Internal-Token' = $InternalToken }
}

# ---------------------------------------------------------------- 1. водитель
Write-Step "1. Водитель регистрируется и выходит на линию ($driverPhone)"
$driverToken = New-Token $driverPhone 'Айдар E2E' @('DRIVER')
$driverAuth = @{ Authorization = "Bearer $($driverToken.accessToken)" }

$registered = Invoke-Api -Method Post -Path '/api/v1/drivers' -Headers $driverAuth -Body @{ displayName = 'Айдар E2E' }
Assert-True ($registered.Status -eq 201) "POST /api/v1/drivers -> 201 (получено $($registered.Status))"
if ($registered.Status -ne 201) { Write-Host $registered.Raw -ForegroundColor Red; exit 1 }
$driverId = $registered.Json.driverId
Assert-True ($driverId.Length -eq 26) "id водителя — ULID ($driverId)"

$future = (Get-Date).ToUniversalTime().AddYears(1).ToString('yyyy-MM-ddTHH:mm:ssZ')
foreach ($kind in @('DRIVING_LICENCE', 'VEHICLE_INSPECTION', 'MEDICAL_CHECK')) {
    $document = Invoke-Api -Method Post -Path '/api/v1/drivers/me/documents' -Headers $driverAuth `
        -Body @{ kind = $kind; expiresAt = $future }
    Assert-True ($document.Status -eq 200) "$kind принят (HTTP $($document.Status))"
}

$online = Invoke-Api -Method Post -Path '/api/v1/drivers/me/status' -Headers $driverAuth -Body @{ status = 'ONLINE' }
Assert-True ($online.Json.status -eq 'ONLINE' -and $online.Json.available -eq $true) 'водитель ONLINE и доступен для заказов'

$dispatcherToken = New-Token $dispatcherPhone 'Диспетчер E2E' @('DISPATCHER')
$dispatcherAuth = @{ Authorization = "Bearer $($dispatcherToken.accessToken)" }
# Базовая точка для проверки событий: смещение топика до первой нашей поездки.
$script:TripEventsOffsetBefore = Topic-Offset 'trip.events'

# ---------------------------------------------------------------- 2. проекция (замер)
Write-Step '2. Замер: как быстро проекция диспетчерской узнаёт о водителе'
# Проекция обновляется АСИНХРОННО: driver-service публикует driver.online в driver.events,
# dispatch-service съедает событие и только тогда считает водителя «на линии». Без этого
# ожидания позиция отвергается 409 DRIVER_NOT_ON_DUTY, машины нет в GEO-индексе, и заявка
# честно уходит в NO_DRIVERS_FOUND — сценарий проверял бы не такси, а гонку с Kafka.
# Критерий готовности: и позиция принята (200), и водитель виден в GET /dispatch/drivers.
$watch = [System.Diagnostics.Stopwatch]::StartNew()
$position = $null
$onDuty = $null
while ($watch.Elapsed.TotalSeconds -lt 15) {
    $position = Send-Position $driverAuth $pickupLat $pickupLon
    if ($position.Status -eq 200) {
        $fleet = Invoke-Api -Method Get -Path '/api/v1/dispatch/drivers' -Headers $dispatcherAuth
        $onDuty = $fleet.Json.drivers | Where-Object { $_.driverId -eq $driverId } | Select-Object -First 1
        if ($onDuty) { break }
    }
    Start-Sleep -Milliseconds 100
}
$elapsedMs = [int]$watch.Elapsed.TotalMilliseconds
Assert-True ($position.Status -eq 200) "POST /api/v1/locations -> 200 (получено $($position.Status))"
Assert-True ($position.Json.driverId -eq $driverId) 'позиция привязана к тому же водителю'
Assert-True ($null -ne $onDuty) 'водитель виден в проекции диспетчерской (GET /api/v1/dispatch/drivers)'
Write-Host ("  [i]    событие driver.online дошло до диспетчерской за {0} мс" -f $elapsedMs) -ForegroundColor Yellow
Assert-True ($elapsedMs -lt 5000) "водитель стал доступен для позиций быстрее 5 с ($elapsedMs мс)"
if ($null -ne $onDuty) {
    Assert-True ($onDuty.stale -eq $false) "позиция водителя свежая (ageSeconds=$($onDuty.ageSeconds))"
    Assert-True ($onDuty.lat -eq $pickupLat -and $onDuty.lon -eq $pickupLon) `
        "координаты водителя — точка подачи ($($onDuty.lat), $($onDuty.lon))"
}

# ---------------------------------------------------------------- 3. пассажир
Write-Step "3. Пассажир и его счёт ($riderPhone)"
# Роли разделены намеренно: пассажир — РОВНО CUSTOMER (иначе проверка «клиенту assign нельзя»
# проверяла бы админа), а демо-пополнение делает отдельный оператор с ролью ADMIN.
$riderToken = New-Token $riderPhone 'Айша E2E' @('CUSTOMER')
$riderAuth = @{ Authorization = "Bearer $($riderToken.accessToken)" }
$operatorToken = New-Token ('+7703' + (Get-Random -Minimum 1000000 -Maximum 9999999)) 'Оператор E2E' @('ADMIN')
$operatorAuth = @{ Authorization = "Bearer $($operatorToken.accessToken)" }
Assert-True ($riderToken.roles -contains 'CUSTOMER' -and -not ($riderToken.roles -contains 'ADMIN')) `
    "у пассажира только роль CUSTOMER ($($riderToken.roles -join ','))"

# Счёт открывает САМ пассажир: котировка находит кошелёк по его телефону, поэтому владелец
# счёта обязан быть пассажиром. Пополняет уже оператор — демо-деньги выдаёт платформа.
$created = Invoke-Api -Method Post -Path '/api/v1/accounts' -Headers $riderAuth -Body @{
    currency = 'KZT'; type = 'CUSTOMER'; displayName = 'Айша E2E'
}
if ($created.Status -eq 201) {
    $account = $created.Json
} else {
    $accounts = Invoke-Api -Method Get -Path '/api/v1/accounts' -Headers $riderAuth
    $account = ($accounts.Json | Where-Object { $_.currency -eq 'KZT' })[0]
}
Assert-True ($null -ne $account.id) "счёт пассажира: $($account.id)"
Assert-True ($account.ownerUserId -eq $riderToken.userId) "счёт принадлежит пассажиру ($($account.ownerUserId))"
$topUp = Invoke-Api -Method Post -Path "/api/v1/accounts/$($account.id)/top-up" -Headers $operatorAuth `
    -Body @{ amountMinor = $TopUpMinor; reason = 'e2e trip funds' }
Assert-True ($topUp.Status -eq 200) "пополнение оператором на $TopUpMinor -> 200 (получено $($topUp.Status))"
$balanceBefore = [long]$topUp.Json.balanceMinor
Assert-True ($topUp.Json.heldMinor -eq 0) "перед заказом резервов нет (held=$($topUp.Json.heldMinor))"

$otherToken = New-Token $otherRiderPhone 'Прохожий E2E' @('CUSTOMER')
$otherAuth = @{ Authorization = "Bearer $($otherToken.accessToken)" }

# ---------------------------------------------------------------- 4. котировка
Write-Step '4. Котировка: цена и оба инварианта'
$quote = New-Quote $riderAuth 'ECONOMY'
Assert-True ($quote.Status -eq 200) "POST /api/v1/trips/quote -> 200 (получено $($quote.Status))"
if ($quote.Status -ne 200) { Write-Host $quote.Raw -ForegroundColor Red; exit 1 }
$q = $quote.Json
Write-Host "  [i] $($q.distanceM) м, $($q.durationS) с, цена $($q.priceMinor) тиын ($($q.currency))"

$partsSum = [long]$q.breakdown.baseMinor + [long]$q.breakdown.distanceMinor + [long]$q.breakdown.timeMinor
$splitSum = [long]$q.driverNetMinor + [long]$q.commissionMinor
Assert-True ($partsSum -eq [long]$q.priceMinor) "base + distance + time = price ($partsSum = $($q.priceMinor))"
Assert-True ($splitSum -eq [long]$q.priceMinor) "driverNet + commission = price ($splitSum = $($q.priceMinor))"
Assert-True ([int]$q.commissionBp -eq 1200) "ставка комиссии 12% (получено $($q.commissionBp) bp)"
Assert-True ([int]$q.surgeBp -eq 0) 'наценки нет (surgeBp = 0)'
Assert-True ($null -ne $q.expiresAt) "котировка живёт до $($q.expiresAt)"
Assert-True ([long]$q.priceMinor -gt 0) 'цена положительная (нулевой холд account-service отверг бы)'

# ---------------------------------------------------------------- 5. заявка
Write-Step '5. Заявка с Idempotency-Key и повтор тем же ключом'
$orderKey = [guid]::NewGuid().ToString()
$orderHeaders = @{ Authorization = "Bearer $($riderToken.accessToken)"; 'Idempotency-Key' = $orderKey }
$orderBody = @{ quoteId = $q.quoteId; comment = 'позвоните, когда будете у подъезда' }

$trip = Invoke-Api -Method Post -Path '/api/v1/trips' -Headers $orderHeaders -Body $orderBody
Assert-True ($trip.Status -eq 202) "POST /api/v1/trips -> 202 (получено $($trip.Status))"
if ($trip.Status -ne 202) { Write-Host $trip.Raw -ForegroundColor Red; exit 1 }
$tripId = $trip.Json.tripId
Write-Host "  [i] поездка $($trip.Json.tripNumber) status=$($trip.Json.status)"
Assert-True ($trip.Json.status -eq 'ASSIGNED') "машина подобрана автоматически (статус $($trip.Json.status))"
Assert-True ([long]$trip.Json.priceMinor -eq [long]$q.priceMinor) 'цена поездки равна цене котировки'

$repeat = Invoke-Api -Method Post -Path '/api/v1/trips' -Headers $orderHeaders -Body $orderBody
Assert-True ($repeat.Json.tripId -eq $tripId) 'повтор вернул ту же поездку, а не создал вторую'
$sameKeyTrips = Psql 'taxi_trip' "select count(*) from trip.trip where idempotency_key = '$orderKey'"
Assert-True ([int]$sameKeyTrips -eq 1) "на один Idempotency-Key — одна поездка в БД (получено $sameKeyTrips)"

Write-Step '6. Детали поездки: водитель, таймлайн, резерв'
$details = Invoke-Api -Method Get -Path "/api/v1/trips/$tripId" -Headers $riderAuth
Assert-True ($details.Status -eq 200) "GET /api/v1/trips/{id} -> 200 (получено $($details.Status))"
Assert-True ($details.Json.driverId -eq $driverId) "назначен наш водитель ($($details.Json.driverId))"
Assert-True (-not [string]::IsNullOrWhiteSpace($details.Json.driverName)) "имя водителя в деталях: $($details.Json.driverName)"
Assert-True ($details.Json.holdStatus -eq 'ACTIVE') "резерв активен (holdStatus=$($details.Json.holdStatus))"
Assert-True ($details.Json.timeline.Count -ge 2) "в таймлайне $($details.Json.timeline.Count) записи: $($details.Json.timeline.status -join ' -> ')"
Assert-True ($null -eq $details.Json.receipt) 'чек в деталях живой поездки пуст'
$holdId = $details.Json.holdId

$accountAfterOrder = Invoke-Api -Method Get -Path "/api/v1/accounts/$($account.id)" -Headers $riderAuth
Assert-True ([long]$accountAfterOrder.Json.heldMinor -eq [long]$q.priceMinor) `
    "зарезервировано ровно $($q.priceMinor) (held=$($accountAfterOrder.Json.heldMinor))"
Assert-True ([long]$accountAfterOrder.Json.balanceMinor -eq $balanceBefore) `
    'резерв — не списание: баланс не изменился'
Assert-True ([long]$accountAfterOrder.Json.availableMinor -eq ($balanceBefore - [long]$q.priceMinor)) `
    "доступно = баланс - резерв ($($accountAfterOrder.Json.availableMinor))"

# ---------------------------------------------------------------- 7. двери диспетчера
Write-Step '7. Диспетчерская дверь: роли и повторное назначение'
$customerAssign = Invoke-Api -Method Post -Path "/api/v1/trips/$tripId/assign" -Headers $riderAuth `
    -Body @{ driverId = $driverId }
Assert-True ($customerAssign.Status -eq 403) "клиенту assign -> 403 (получено $($customerAssign.Status))"
Assert-True ($customerAssign.Json.code -eq 'FORBIDDEN_TRIP_ASSIGNMENT') "код FORBIDDEN_TRIP_ASSIGNMENT (получен $($customerAssign.Json.code))"

$dispatcherAssign = Invoke-Api -Method Post -Path "/api/v1/trips/$tripId/assign" -Headers $dispatcherAuth `
    -Body @{ driverId = $driverId }
Assert-True ($dispatcherAssign.Status -eq 200) "диспетчеру assign -> 200 (получено $($dispatcherAssign.Status))"
Assert-True ($dispatcherAssign.Json.driverId -eq $driverId) 'на поездке тот же водитель'
Assert-True ($dispatcherAssign.Json.holdId -eq $holdId) "повтор не создал второй холд (holdId=$($dispatcherAssign.Json.holdId))"
$holdsForTrip = Psql 'taxi_account' "select count(*) from account.account_hold where reference_type = 'TRIP' and reference_id = '$tripId'"
Assert-True ([int]$holdsForTrip -eq 1) "на поездку ровно один холд в БД (получено $holdsForTrip)"

Write-Step '8. Чужая поездка недоступна'
$strangerRead = Invoke-Api -Method Get -Path "/api/v1/trips/$tripId" -Headers $otherAuth
Assert-True ($strangerRead.Status -eq 403) "чужому GET поездки -> 403 (получено $($strangerRead.Status))"
Assert-True ($strangerRead.Json.code -eq 'FORBIDDEN_TRIP_ACCESS') "код FORBIDDEN_TRIP_ACCESS (получен $($strangerRead.Json.code))"
$strangerReceipt = Invoke-Api -Method Get -Path "/api/v1/trips/$tripId/receipt" -Headers $otherAuth
Assert-True ($strangerReceipt.Status -eq 403) "чужому чек -> 403 (получено $($strangerReceipt.Status))"

Write-Step '9. Чек до завершения — отказано'
$earlyReceipt = Invoke-Api -Method Get -Path "/api/v1/trips/$tripId/receipt" -Headers $riderAuth
Assert-True ($earlyReceipt.Status -eq 409) "чек живой поездки -> 409 (получено $($earlyReceipt.Status))"
Assert-True ($earlyReceipt.Json.code -eq 'TRIP_NOT_COMPLETED') "код TRIP_NOT_COMPLETED (получен $($earlyReceipt.Json.code))"

# ---------------------------------------------------------------- 8. поездка
Write-Step '10. ARRIVE -> START (служебные вызовы с X-Internal-Token)'
$arrive = Invoke-Internal 'arrive' $tripId
Assert-True ($arrive.Status -eq 200 -and $arrive.Json.status -eq 'ARRIVED') "машина на месте (статус $($arrive.Json.status))"
$start = Invoke-Internal 'start' $tripId
Assert-True ($start.Status -eq 200 -and $start.Json.status -eq 'IN_PROGRESS') "поездка началась (статус $($start.Json.status))"

Write-Step '11. Отмена во время поездки невозможна, резерв остаётся'
$cancelInProgress = Invoke-Api -Method Post -Path "/api/v1/trips/$tripId/cancel" -Headers $riderAuth `
    -Body @{ reason = 'передумал на полпути' }
Assert-True ($cancelInProgress.Status -eq 409) "отмена IN_PROGRESS -> 409 (получено $($cancelInProgress.Status))"
Assert-True ($cancelInProgress.Json.code -eq 'TRIP_NOT_CANCELLABLE') "код TRIP_NOT_CANCELLABLE (получен $($cancelInProgress.Json.code))"
$holdAfterRefusal = Psql 'taxi_account' "select status from account.account_hold where id = '$holdId'"
Assert-True ($holdAfterRefusal -eq 'ACTIVE') "резерв ОСТАЛСЯ активным после отказа ($holdAfterRefusal)"
$tripAfterRefusal = Psql 'taxi_trip' "select status || '/' || hold_status from trip.trip where id = '$tripId'"
Assert-True ($tripAfterRefusal -eq 'IN_PROGRESS/ACTIVE') "поездка продолжается, холд жив ($tripAfterRefusal)"

$complete = Invoke-Internal 'complete' $tripId
Assert-True ($complete.Status -eq 200 -and $complete.Json.status -eq 'COMPLETED') "поездка завершена (статус $($complete.Json.status))"
Assert-True ($complete.Json.holdStatus -eq 'CAPTURED') "холд захвачен (holdStatus=$($complete.Json.holdStatus))"

# ---------------------------------------------------------------- 9. деньги
Write-Step '12. Деньги: списано ровно priceMinor, резерв снят'
Start-Sleep -Seconds 2
$accountAfterRide = Invoke-Api -Method Get -Path "/api/v1/accounts/$($account.id)" -Headers $riderAuth
$balanceAfter = [long]$accountAfterRide.Json.balanceMinor
Assert-True (($balanceBefore - $balanceAfter) -eq [long]$q.priceMinor) `
    "списано ровно $($q.priceMinor) (было $balanceBefore, стало $balanceAfter)"
Assert-True ([long]$accountAfterRide.Json.heldMinor -eq 0) "активных резервов не осталось (held=$($accountAfterRide.Json.heldMinor))"

# Проводки захвата ссылаются на ХОЛД (reference_type = 'HOLD', reference_id = holdId): это
# две записи одной транзакции — списание с кошелька пассажира и зачисление на счёт платформы.
$ledgerTrip = Psql 'taxi_account' "select count(*) from account.ledger_entry where reference_type = 'HOLD' and reference_id = '$holdId'"
Assert-True ([int]$ledgerTrip -ge 2) "в леджжере есть проводки поездки (записей: $ledgerTrip)"
$unbalanced = Psql 'taxi_account' "select count(*) from (select transaction_id from account.ledger_entry where reference_type = 'HOLD' and reference_id = '$holdId' group by transaction_id having sum(case when direction = 'CREDIT' then amount_minor else -amount_minor end) <> 0) x"
Assert-True ([int]$unbalanced -eq 0) "проводка поездки сбалансирована (нарушений: $unbalanced)"
$charged = Psql 'taxi_account' "select coalesce(sum(amount_minor), 0) from account.ledger_entry where reference_type = 'HOLD' and reference_id = '$holdId' and direction = 'DEBIT'"
Assert-True ([long]$charged -eq [long]$q.priceMinor) "дебетовая проводка равна цене ($charged = $($q.priceMinor))"
$holdAfterRide = Psql 'taxi_account' "select status from account.account_hold where id = '$holdId'"
Assert-True ($holdAfterRide -eq 'CAPTURED') "холд захвачен в БД ($holdAfterRide)"

# ---------------------------------------------------------------- 10. чек
Write-Step '13. Чек завершённой поездки'
$receipt = Invoke-Api -Method Get -Path "/api/v1/trips/$tripId/receipt" -Headers $riderAuth
Assert-True ($receipt.Status -eq 200) "чек -> 200 (получено $($receipt.Status))"
if ($receipt.Status -eq 200) {
    $r = $receipt.Json
    $receiptParts = [long]$r.breakdown.baseMinor + [long]$r.breakdown.distanceMinor + [long]$r.breakdown.timeMinor
    $receiptSplit = [long]$r.driverNetMinor + [long]$r.commissionMinor
    Assert-True ($r.status -eq 'COMPLETED') "чек — о завершённой поездке (status=$($r.status))"
    Assert-True ($r.tripNumber -eq $trip.Json.tripNumber) "номер поездки совпадает ($($r.tripNumber))"
    Assert-True ($receiptParts -eq [long]$r.priceMinor) "чек: base + distance + time = price ($receiptParts)"
    Assert-True ($receiptSplit -eq [long]$r.priceMinor) "чек: driverNet + commission = price ($receiptSplit)"
    Assert-True ([long]$r.commissionMinor -eq [long]$q.commissionMinor) 'комиссия та же, что в котировке'
    Assert-True ([long]$r.driverNetMinor -eq [long]$q.driverNetMinor) 'деньги водителя те же, что в котировке'
    Assert-True ([int]$r.surgeBp -eq 0) 'наценки нет (surgeBp = 0)'
    Assert-True ($r.driverId -eq $driverId) "в чеке наш водитель ($($r.driverId))"
    Assert-True (-not [string]::IsNullOrWhiteSpace($r.transactionId)) "проводка списания указана ($($r.transactionId))"
    Assert-True ($null -eq $r.paymentId) 'платёжной ссылки нет: поездка списана кошельком, а не через payment-service'
    Assert-True ($r.pickupAddress -eq $pickupAddress) "адрес подачи в чеке: $($r.pickupAddress)"

    $detailsAfter = Invoke-Api -Method Get -Path "/api/v1/trips/$tripId" -Headers $riderAuth
    Assert-True ($detailsAfter.Status -eq 200) "детали завершённой поездки -> 200 (получено $($detailsAfter.Status))"
    Assert-True ($detailsAfter.Json.receipt.priceMinor -eq $r.priceMinor) `
        "чек в деталях поездки — тот же объект, что на отдельном эндпоинте ($($detailsAfter.Json.receipt.priceMinor) = $($r.priceMinor))"
}

# ---------------------------------------------------------------- 11. отмена живой
Write-Step '14. Отмена живой поездки возвращает деньги'
# После завершения поездки водитель возвращается на линию сам (finishTrip -> ONLINE), поэтому
# повторный ONLINE — это не действие, а проверка: 409 DRIVER_ALREADY_ON_DUTY тоже означает,
# что он на линии. Состояние читаем из ответа, а не угадываем.
$onlineAgain = Invoke-Api -Method Post -Path '/api/v1/drivers/me/status' -Headers $driverAuth -Body @{ status = 'ONLINE' }
Assert-True ($onlineAgain.Status -eq 200 -or $onlineAgain.Status -eq 409) `
    "водитель уже на линии (HTTP $($onlineAgain.Status), status=$($onlineAgain.Json.status))"
$myProfile = Invoke-Api -Method Get -Path '/api/v1/drivers/me' -Headers $driverAuth
Assert-True ($myProfile.Json.onDuty -eq $true -and $myProfile.Json.available -eq $true) `
    "водитель на линии и доступен (status=$($myProfile.Json.status))"
# Проекция уже знает водителя, но позиция живёт секундами: обновляем её перед новым подбором.
$positionAgain = Send-Position $driverAuth $pickupLat $pickupLon
Assert-True ($positionAgain.Status -eq 200) "позиция обновлена (HTTP $($positionAgain.Status))"

$quote2 = New-Quote $riderAuth 'COMFORT'
Assert-True ($quote2.Status -eq 200) "вторая котировка (COMFORT) -> 200 (получено $($quote2.Status))"
$orderKey2 = [guid]::NewGuid().ToString()
$trip2 = Invoke-Api -Method Post -Path '/api/v1/trips' -Headers @{
    Authorization = "Bearer $($riderToken.accessToken)"; 'Idempotency-Key' = $orderKey2
} -Body @{ quoteId = $quote2.Json.quoteId }
Assert-True ($trip2.Status -eq 202 -and $trip2.Json.status -eq 'ASSIGNED') `
    "вторая поездка назначена (статус $($trip2.Json.status))"
$trip2Id = $trip2.Json.tripId
$balanceBeforeCancel = (Invoke-Api -Method Get -Path "/api/v1/accounts/$($account.id)" -Headers $riderAuth).Json.balanceMinor

$cancel = Invoke-Api -Method Post -Path "/api/v1/trips/$trip2Id/cancel" -Headers $riderAuth `
    -Body @{ reason = 'машина не нужна' }
Assert-True ($cancel.Status -eq 200) "отмена живой поездки -> 200 (получено $($cancel.Status))"
Assert-True ($cancel.Json.status -eq 'CANCELLED_BY_RIDER') "статус CANCELLED_BY_RIDER (получен $($cancel.Json.status))"
Assert-True ($cancel.Json.holdStatus -eq 'RELEASED') "холд отпущен (holdStatus=$($cancel.Json.holdStatus))"

$cancelAgain = Invoke-Api -Method Post -Path "/api/v1/trips/$trip2Id/cancel" -Headers $riderAuth `
    -Body @{ reason = 'машина не нужна' }
Assert-True ($cancelAgain.Status -eq 200 -and $cancelAgain.Json.status -eq 'CANCELLED_BY_RIDER') `
    'повторная отмена возвращает тот же результат и не падает'

$accountAfterCancel = Invoke-Api -Method Get -Path "/api/v1/accounts/$($account.id)" -Headers $riderAuth
Assert-True ([long]$accountAfterCancel.Json.balanceMinor -eq [long]$balanceBeforeCancel) `
    "баланс не изменился отменой ($($accountAfterCancel.Json.balanceMinor))"
Assert-True ([long]$accountAfterCancel.Json.heldMinor -eq 0) "резервов не осталось (held=$($accountAfterCancel.Json.heldMinor))"
$trip2Hold = Psql 'taxi_account' "select status from account.account_hold where reference_type = 'TRIP' and reference_id = '$trip2Id'"
Assert-True ($trip2Hold -eq 'RELEASED') "холд отменённой поездки отпущен в БД ($trip2Hold)"
$trip2Row = Psql 'taxi_trip' "select status || '/' || hold_status from trip.trip where id = '$trip2Id'"
Assert-True ($trip2Row -eq 'CANCELLED_BY_RIDER/RELEASED') "поездка и холд согласованы ($trip2Row)"

# ---------------------------------------------------------------- 12. события
Write-Step '15. События trip.* доехали до Kafka'
Assert-True (Wait-Published $tripId) 'события первой поездки опубликованы (outbox status=PUBLISHED)'
Assert-True (Wait-Published $trip2Id) 'события второй поездки опубликованы'
# Замер сделан в самом начале прогона (шаг 1), до первой поездки: сравнивать offset нужно с
# состоянием ДО наших событий, иначе рост равен нулю ровно тогда, когда всё уже опубликовано.
$offsetAfter = Topic-Offset 'trip.events'
Assert-True ($offsetAfter -gt $script:TripEventsOffsetBefore) `
    "end-offset топика trip.events вырос ($($script:TripEventsOffsetBefore) -> $offsetAfter)"
$eventTypes = Psql 'taxi_trip' "select string_agg(distinct event_type, ',' order by event_type) from trip.outbox_message where aggregate_id = '$tripId'"
Assert-True ($eventTypes -like '*trip.requested*') "в outbox есть trip.requested ($eventTypes)"
Assert-True ($eventTypes -like '*trip.driver.assigned*') 'в outbox есть trip.driver.assigned'
Assert-True ($eventTypes -like '*trip.started*') 'в outbox есть trip.started'
Assert-True ($eventTypes -like '*trip.completed*') 'в outbox есть trip.completed'
$stuckTrips = Psql 'taxi_trip' "select count(*) from trip.outbox_message where status <> 'PUBLISHED'"
Assert-True ([int]$stuckTrips -eq 0) "в outbox нет необработанных событий (получено $stuckTrips)"

Write-Step '16. Инварианты в БД'
$splitBroken = Psql 'taxi_trip' "select count(*) from trip.trip where driver_net_minor + commission_minor <> price_minor or base_minor + distance_minor + time_minor <> price_minor"
Assert-True ([int]$splitBroken -eq 0) "цены всех поездок складываются из частей и делятся на комиссию и водителя (нарушений: $splitBroken)"
$transitionsFirst = Psql 'taxi_trip' "select string_agg(to_status, ' -> ' order by occurred_at, id) from trip.trip_transition where trip_id = '$tripId'"
Assert-True ($transitionsFirst -eq 'SEARCHING -> ASSIGNED -> ARRIVED -> IN_PROGRESS -> COMPLETED') `
    "таймлайн первой поездки: $transitionsFirst"
$completedHolds = Psql 'taxi_trip' "select count(*) from trip.trip where status = 'COMPLETED' and hold_status <> 'CAPTURED'"
Assert-True ([int]$completedHolds -eq 0) 'нет завершённых поездок с незахваченным холдом'

Write-Host ''
if ($script:Failures -gt 0) {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $($script:Failures)" -ForegroundColor Red
    exit 1
}
Write-Host "СКВОЗНОЙ СЦЕНАРИЙ ПРОЙДЕН (поездка $($trip.Json.tripNumber), водитель $driverId, пассажир $riderPhone)" -ForegroundColor Green
exit 0
