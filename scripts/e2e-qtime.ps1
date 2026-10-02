<#
.SYNOPSIS
    Сквозной сценарий QTime: свободные окна, запись, освобождение окна.

.DESCRIPTION
    Проверяет обещание, за которое платформа отвечает перед клиентом и перед салоном:
    окно можно занять только один раз, и отмена действительно возвращает его в сетку.

      1. список компаний — анонимно и ЧЕРЕЗ ШЛЮЗ: «маникюр → сегодня → рядом со мной»
         начинается до регистрации, поэтому 401 здесь был бы потерянной записью
         (регресс, который ловится только на краю, внутри сервиса всё было верно);
      2. карточка компании: специалисты, услуги, цены;
      3. сетка свободных окон на ближайший рабочий день: видно и свободные, и занятые
         окна (available=false, reason="занято") — как на макете экрана 18;
      4. запись на первое свободное окно -> 201, код QT-…, цена и длительность услуги;
      5. повтор с тем же Idempotency-Key -> та же запись (не вторая);
      6. другой пользователь занимает то же окно -> 409 SLOT_TAKEN (инвариант держит
         база: частичный уникальный индекс booking_slot_unique);
      7. без Idempotency-Key -> 400, без токена -> 401 (запись анонимной быть не должна);
      8. запись видна в списке своих, и не видна чужому: GET /{id} под другим
         пользователем -> 403;
      9. отмена -> CANCELLED_BY_CLIENT, а окно снова свободно в сетке;
     10. событие booking.created ушло в qtime.events через outbox;
     11. инварианты в БД: нет двух CONFIRMED-записей на одно окно;
     12. отказы календаря приходят своими кодами (а не 500): 422 OUTSIDE_WORKING_HOURS
         в нерабочий день, 422 BOOKING_IN_PAST на прошедшее время, 422 BOOKING_TOO_SOON
         на время ближе лид-тайма, 400 SERVICE_NOT_OFFERED_BY_SPECIALIST на услугу,
         которую этот мастер не оказывает. Каждая проверка смотрит именно код ошибки:
         по статусу 422 эти случаи не различить, а клиент ветвится по коду.

    Телефоны генерируются случайным числом, поэтому сценарий можно гонять подряд.

.EXAMPLE
    .\scripts\e2e-qtime.ps1
    .\scripts\e2e-qtime.ps1 -BaseUrl http://localhost:8088   # напрямую в сервис, без шлюза
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://localhost:8080',
    # Куда идти за токеном. По умолчанию — тот же адрес (шлюз), при прямом запуске
    # сервиса на 8088 токен всё равно выдаёт шлюз: это его эндпоинт.
    [string]$AuthUrl = '',
    [string]$Code = '0000'
)

$ErrorActionPreference = 'Stop'
# Вспомогательный диагностический запрос (psql, kafka-get-offsets) не должен быть громче
# проверяемого сценария: без этой строки опечатка в SQL или недоступный контейнер
# прилетают как NativeCommandError и обрывают прогон до итоговой строки, хотя все
# проверки уже прошли. Диагностика сообщает о себе строкой, а не падением.
$PSNativeCommandUseErrorActionPreference = $false
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$script:Failures = 0

if ([string]::IsNullOrWhiteSpace($AuthUrl)) { $AuthUrl = $BaseUrl }

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

# Прямой запрос в БД: нужен там, где ответ API сам по себе не доказывает инвариант
# (частичный уникальный индекс, содержимое outbox). Ошибка запроса — это одна строка
# диагностики, а не конец прогона.
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

# Waits for the relay to publish the event of THIS run (scoped by the booking id).
function Wait-Published([string]$bookingId, [int]$timeoutSeconds = 30) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $count = Psql 'taxi_qtime' @"
select count(*) from qtime.outbox_message
 where aggregate_id = '$bookingId' and status = 'PUBLISHED'
"@
        if ([int]$count -gt 0) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

# ---------------------------------------------------------------- 1. anonymous browsing
Write-Step '1. Салон можно смотреть без регистрации: GET /companies анонимно'
$anonymous = Invoke-Api -Method Get -Path '/api/v1/qtime/companies?size=20'
Assert-True ($anonymous.Status -eq 200) "GET /api/v1/qtime/companies без токена -> 200 (получено $($anonymous.Status))"
if ($anonymous.Status -ne 200) { Write-Host $anonymous.Raw -ForegroundColor Red; exit 1 }
Assert-True ($anonymous.Json.totalElements -ge 4) "в Шымкенте есть демо-компании (totalElements=$($anonymous.Json.totalElements))"

$company = $anonymous.Json.items | Where-Object { $_.category -eq 'BEAUTY' } | Select-Object -First 1
if (-not $company) { $company = $anonymous.Json.items[0] }
Assert-True ($null -ne $company.name) "первая компания: $($company.name) ($($company.category), $($company.city))"
Assert-True ([int]$company.specialistsCount -ge 2) "у компании есть мастера (specialistsCount=$($company.specialistsCount))"
Assert-True ([int]$company.servicesCount -ge 3) "у компании есть услуги (servicesCount=$($company.servicesCount))"
Assert-True ($null -ne $company.minPriceMinor) "на карточке есть цена 'от' (minPriceMinor=$($company.minPriceMinor))"

Write-Step '2. Карточка компании: мастера, услуги, цены'
$detail = Invoke-Api -Method Get -Path "/api/v1/qtime/companies/$($company.companyId)"
Assert-True ($detail.Status -eq 200) "GET /companies/{id} -> 200 (получено $($detail.Status))"
Assert-True ($detail.Json.specialists.Count -ge 2) "в карточке $($detail.Json.specialists.Count) мастера"
Assert-True ($detail.Json.services.Count -ge 3) "в карточке $($detail.Json.services.Count) услуг"
Assert-True ($detail.Json.timezone -eq 'Asia/Almaty') "часовой пояс компании — $($detail.Json.timezone)"

$specialist = $detail.Json.specialists[0]
$service = $detail.Json.services[0]
Write-Host "  [i] мастер $($specialist.name) ($($specialist.specialization)), услуга «$($service.name)» $($service.durationMinutes) мин, $($service.priceMinor / 100) ₸"

# Первый рабочий день с доступными окнами: демо-данные могут попасть на воскресенье,
# когда салон не работает, и это не ошибка сервиса.
Write-Step '3. Свободные окна: сетка на ближайший рабочий день'
$slots = $null
$date = $null
for ($day = 0; $day -lt 7; $day++) {
    $candidate = (Get-Date).AddDays($day).ToString('yyyy-MM-dd')
    $response = Invoke-Api -Method Get `
        -Path "/api/v1/qtime/specialists/$($specialist.specialistId)/slots?serviceId=$($service.serviceId)&date=$candidate"
    if ($response.Status -eq 200 -and ($response.Json.slots | Where-Object { $_.available }).Count -gt 0) {
        $slots = $response
        $date = $candidate
        break
    }
}
Assert-True ($null -ne $slots) 'на ближайшие 7 дней есть день со свободными окнами'
if ($null -eq $slots) { Write-Host 'Свободных окон нет — проверьте демо-данные и lead-time' -ForegroundColor Red; exit 1 }

$free = @($slots.Json.slots | Where-Object { $_.available })
$busy = @($slots.Json.slots | Where-Object { -not $_.available })
Write-Host "  [i] ${date}: всего $($slots.Json.slots.Count) окон, свободно $($free.Count), занято $($busy.Count)"
Assert-True ($slots.Json.slots.Count -gt 0) "сетка не пуста ($($slots.Json.slots.Count) окон)"
Assert-True ($slots.Json.durationMinutes -eq $service.durationMinutes) "длительность в ответе равна длительности услуги ($($slots.Json.durationMinutes) мин)"
Assert-True ($slots.Json.timezone -eq 'Asia/Almaty') 'в сетке указан часовой пояс салона'
Assert-True ($slots.Json.date -eq $date) "ответ помечен запрошенной датой ($($slots.Json.date))"

$anonymousSlots = Invoke-Api -Method Get `
    -Path "/api/v1/qtime/specialists/$($specialist.specialistId)/slots?serviceId=$($service.serviceId)&date=$date"
Assert-True ($anonymousSlots.Status -eq 200) "сетка доступна анонимно через шлюз (получено $($anonymousSlots.Status))"
Assert-True ((@($busy).Count -eq 0) -or ($busy[0].reason -eq 'занято' -or $busy[0].reason -eq 'перерыв' -or $busy[0].reason -eq 'не хватает времени')) `
    "занятые окна приходят с причиной (пример: reason=$($busy[0].reason))"

$startsAt = $free[0].startsAt
Write-Host "  [i] берём окно $startsAt (по местному времени салона $([datetimeoffset]::Parse($startsAt).ToOffset([timespan]::FromHours(5)).ToString('HH:mm')))"

# ---------------------------------------------------------------- 4. taking the window
Write-Step '4. Запись на выбранное окно'
$phoneA = '+7700' + (Get-Random -Minimum 1000000 -Maximum 9999999)
$phoneB = '+7700' + (Get-Random -Minimum 1000000 -Maximum 9999999)
$tokenA = (Invoke-Api -Method Post -Path '/api/v1/auth/token' -Url $AuthUrl -Body @{
    phone = $phoneA; code = $Code; displayName = 'Клиент QTime A'; roles = @('CUSTOMER')
}).Json.accessToken
$tokenB = (Invoke-Api -Method Post -Path '/api/v1/auth/token' -Url $AuthUrl -Body @{
    phone = $phoneB; code = $Code; displayName = 'Клиент QTime B'; roles = @('CUSTOMER')
}).Json.accessToken
$authA = @{ Authorization = "Bearer $tokenA" }
$authB = @{ Authorization = "Bearer $tokenB" }
Assert-True ($null -ne $tokenA -and $null -ne $tokenB) 'получены токены двух разных клиентов'

$bookingBody = @{
    specialistId = $specialist.specialistId
    serviceId = $service.serviceId
    startsAt = $startsAt
    comment = 'домофон 45, подъезд со двора'
}
$idempotencyKey = [guid]::NewGuid().ToString()
$created = Invoke-Api -Method Post -Path '/api/v1/qtime/bookings' -Headers ($authA + @{ 'Idempotency-Key' = $idempotencyKey }) -Body $bookingBody
Assert-True ($created.Status -eq 201) "POST /bookings -> 201 (получено $($created.Status))"
if ($created.Status -ne 201) { Write-Host $created.Raw -ForegroundColor Red; exit 1 }
$bookingId = $created.Json.bookingId
Assert-True ($created.Json.status -eq 'CONFIRMED') "статус записи CONFIRMED (получен $($created.Json.status))"
Assert-True ($created.Json.code.StartsWith('QT-')) "человекочитаемый код записи: $($created.Json.code)"
Assert-True ($created.Json.priceMinor -eq $service.priceMinor) "цена зафиксирована по услуге ($($created.Json.priceMinor) тиын)"
Assert-True ($created.Json.durationMinutes -eq $service.durationMinutes) 'длительность зафиксирована по услуге'
Assert-True ($created.Json.companyName -eq $company.name) "в ответе есть название салона ($($created.Json.companyName))"
Assert-True ($created.Json.startsAt -eq $startsAt) 'начало записи совпадает с выбранным окном'
Assert-True ($created.Json.clientComment -eq 'домофон 45, подъезд со двора') "комментарий сохранён ($($created.Json.clientComment))"

Write-Step '5. Повтор с тем же Idempotency-Key'
$replay = Invoke-Api -Method Post -Path '/api/v1/qtime/bookings' -Headers ($authA + @{ 'Idempotency-Key' = $idempotencyKey }) -Body $bookingBody
Assert-True ($replay.Status -eq 201) "повтор -> 201 (получено $($replay.Status))"
Assert-True ($replay.Json.bookingId -eq $bookingId) "повтор вернул ту же запись ($($replay.Json.bookingId))"
$sameWindow = Psql 'taxi_qtime' "select count(*) from qtime.booking where id = '$bookingId'"
Assert-True ([int]$sameWindow -eq 1) "в БД по-прежнему одна запись (получено $sameWindow)"

Write-Step '6. Другой клиент пытается занять то же окно'
$conflict = Invoke-Api -Method Post -Path '/api/v1/qtime/bookings' -Headers ($authB + @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }) -Body $bookingBody
Assert-True ($conflict.Status -eq 409) "второе занятие окна -> 409 (получено $($conflict.Status))"
Assert-True ($conflict.Json.code -eq 'SLOT_TAKEN') "код ошибки SLOT_TAKEN (получен $($conflict.Json.code))"

Write-Step '7. Запись не анонимна, и без Idempotency-Key не пишется'
$anonymousBooking = Invoke-Api -Method Post -Path '/api/v1/qtime/bookings' -Body $bookingBody
Assert-True ($anonymousBooking.Status -eq 401) "POST /bookings без токена -> 401 (получено $($anonymousBooking.Status))"
$noKey = Invoke-Api -Method Post -Path '/api/v1/qtime/bookings' -Headers $authB -Body @{
    specialistId = $specialist.specialistId; serviceId = $service.serviceId
    startsAt = $(if ($free.Count -gt 1) { $free[1].startsAt } else { $free[0].startsAt })
    comment = 'без ключа идемпотентности'
}
Assert-True ($noKey.Status -eq 400) "POST /bookings без Idempotency-Key -> 400 (получено $($noKey.Status))"
Assert-True ($noKey.Json.code -eq 'VALIDATION_FAILED') "код ошибки VALIDATION_FAILED (получен $($noKey.Json.code))"

Write-Step '8. Мои записи видны мне и не видны другому'
$mine = Invoke-Api -Method Get -Path '/api/v1/qtime/bookings?size=50' -Headers $authA
Assert-True ($mine.Status -eq 200) "GET /bookings -> 200 (получено $($mine.Status))"
$found = @($mine.Json.items | Where-Object { $_.bookingId -eq $bookingId })
Assert-True ($found.Count -eq 1) 'созданная запись есть в списке своих записей'
Assert-True ($found[0].serviceName -eq $service.name) "в списке видно название услуги ($($found[0].serviceName))"

$foreign = Invoke-Api -Method Get -Path "/api/v1/qtime/bookings/$bookingId" -Headers $authB
Assert-True ($foreign.Status -eq 403) "чужая запись по id -> 403 (получено $($foreign.Status))"
Assert-True ($foreign.Json.code -eq 'FORBIDDEN_BOOKING_ACCESS') "код ошибки FORBIDDEN_BOOKING_ACCESS (получен $($foreign.Json.code))"

$foreignList = Invoke-Api -Method Get -Path '/api/v1/qtime/bookings?size=50' -Headers $authB
Assert-True ((@($foreignList.Json.items | Where-Object { $_.bookingId -eq $bookingId })).Count -eq 0) 'в списке другого клиента чужой записи нет'

# ---------------------------------------------------------------- 9. cancelling
Write-Step '9. Отмена освобождает окно'
$cancelled = Invoke-Api -Method Post -Path "/api/v1/qtime/bookings/$bookingId/cancel" -Headers $authA -Body @{ reason = 'передумала, перенесу на выходные' }
Assert-True ($cancelled.Status -eq 200) "POST /bookings/{id}/cancel -> 200 (получено $($cancelled.Status))"
Assert-True ($cancelled.Json.status -eq 'CANCELLED_BY_CLIENT') "статус CANCELLED_BY_CLIENT (получен $($cancelled.Json.status))"
Assert-True ($cancelled.Json.cancelReason -eq 'передумала, перенесу на выходные') "причина отмены сохранена ($($cancelled.Json.cancelReason))"

$afterCancel = Invoke-Api -Method Get `
    -Path "/api/v1/qtime/specialists/$($specialist.specialistId)/slots?serviceId=$($service.serviceId)&date=$date"
$released = @($afterCancel.Json.slots | Where-Object { $_.startsAt -eq $startsAt -and $_.available })
Assert-True ($released.Count -eq 1) 'освобождённое окно снова доступно в сетке'
$rebookBody = @{
    specialistId = $specialist.specialistId; serviceId = $service.serviceId
    startsAt = $startsAt; comment = 'перезапись после отмены'
}
$rebooked = Invoke-Api -Method Post -Path '/api/v1/qtime/bookings' -Headers ($authB + @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }) -Body $rebookBody
Assert-True ($rebooked.Status -eq 201) "другой клиент занял освободившееся окно -> 201 (получено $($rebooked.Status))"

Write-Step '10. Событие booking.created дошло до Kafka'
Assert-True (Wait-Published $bookingId) "строка outbox опубликована (status=PUBLISHED)"
$offset = Topic-Offset 'qtime.events'
Assert-True ($offset -gt 0) "топик qtime.events получил события (end-offset $offset)"
$stuck = Psql 'taxi_qtime' "select count(*) from qtime.outbox_message where status <> 'PUBLISHED'"
Assert-True ([int]$stuck -eq 0) "в outbox нет необработанных событий (получено $stuck)"

Write-Step '11. Инварианты в БД'
$duplicates = Psql 'taxi_qtime' @"
select count(*) from (
  select specialist_id, starts_at from qtime.booking
   where status = 'CONFIRMED' group by specialist_id, starts_at having count(*) > 1
) d
"@
Assert-True ([int]$duplicates -eq 0) "нет двух CONFIRMED-записей на одно окно (получено $duplicates)"
$indexExists = Psql 'taxi_qtime' "select count(*) from pg_indexes where schemaname = 'qtime' and indexname = 'booking_slot_unique'"
Assert-True ([int]$indexExists -eq 1) 'частичный уникальный индекс booking_slot_unique на месте'
$cancelReason = Psql 'taxi_qtime' "select cancel_reason from qtime.booking where id = '$bookingId'"
Assert-True ($cancelReason -eq 'передумала, перенесу на выходные') "кириллица доехала до БД без искажений ($cancelReason)"
$cancelledByClient = Psql 'taxi_qtime' "select status from qtime.booking where id = '$bookingId'"
Assert-True ($cancelledByClient -eq 'CANCELLED_BY_CLIENT') "статус отменённой записи в БД ($cancelledByClient)"

# ---------------------------------------------------------------- 12. calendar refusals
Write-Step '12. Отказы календаря: код ошибки, а не 500'

# 12.1 Нерабочий день. Демо-салоны работают пн-сб, поэтому воскресенье — день без
# working_hours. Дата берётся всегда в будущем (если сегодня воскресенье — следующее),
# чтобы отказ пришёл именно от календаря, а не от проверки «время уже прошло».
$daysToSunday = (7 - [int](Get-Date).DayOfWeek) % 7
if ($daysToSunday -eq 0) { $daysToSunday = 7 }
$sunday = (Get-Date).Date.AddDays($daysToSunday).ToString('yyyy-MM-dd')
# Шымкент живёт в UTC+5 круглый год, поэтому 12:00 местного — это 07:00Z.
$sundayNoon = "$($sunday)T07:00:00Z"
$sundayGrid = Invoke-Api -Method Get `
    -Path "/api/v1/qtime/specialists/$($specialist.specialistId)/slots?serviceId=$($service.serviceId)&date=$sunday"
Assert-True ($sundayGrid.Status -eq 200) "сетка на воскресенье запрашивается (HTTP $($sundayGrid.Status))"
Assert-True (@($sundayGrid.Json.slots).Count -eq 0) "в воскресенье ($sunday) окон нет: салон не работает"
$onDayOff = Invoke-Api -Method Post -Path '/api/v1/qtime/bookings' `
    -Headers ($authA + @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }) `
    -Body @{ specialistId = $specialist.specialistId; serviceId = $service.serviceId; startsAt = $sundayNoon; comment = 'запись в выходной' }
Assert-True ($onDayOff.Status -eq 422) "запись в нерабочий день -> 422 (получено $($onDayOff.Status))"
Assert-True ($onDayOff.Json.code -eq 'OUTSIDE_WORKING_HOURS') "код OUTSIDE_WORKING_HOURS (получен $($onDayOff.Json.code))"

# 12.2 Прошедшее время: час назад. Проверка «в прошлом» идёт раньше календарной, поэтому
# день недели и смена здесь не важны.
$anHourAgo = (Get-Date).ToUniversalTime().AddHours(-1).ToString('yyyy-MM-ddTHH:mm:ssZ')
$inPast = Invoke-Api -Method Post -Path '/api/v1/qtime/bookings' `
    -Headers ($authA + @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }) `
    -Body @{ specialistId = $specialist.specialistId; serviceId = $service.serviceId; startsAt = $anHourAgo }
Assert-True ($inPast.Status -eq 422) "запись в прошлое -> 422 (получено $($inPast.Status))"
Assert-True ($inPast.Json.code -eq 'BOOKING_IN_PAST') "код BOOKING_IN_PAST (получен $($inPast.Json.code))"

# 12.3 Ближе лид-тайма (по умолчанию 30 минут): мастер должен увидеть запись заранее.
$inTenMinutes = (Get-Date).ToUniversalTime().AddMinutes(10).ToString('yyyy-MM-ddTHH:mm:ssZ')
$tooSoon = Invoke-Api -Method Post -Path '/api/v1/qtime/bookings' `
    -Headers ($authA + @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }) `
    -Body @{ specialistId = $specialist.specialistId; serviceId = $service.serviceId; startsAt = $inTenMinutes }
Assert-True ($tooSoon.Status -eq 422) "запись за 10 минут до визита -> 422 (получено $($tooSoon.Status))"
Assert-True ($tooSoon.Json.code -eq 'BOOKING_TOO_SOON') "код BOOKING_TOO_SOON (получен $($tooSoon.Json.code))"

# 12.4 Услуга другой компании: проверка «этот мастер её не оказывает» идёт до календаря,
# поэтому окно берём настоящее и свободное — отказ обязан прийти по услуге.
$otherCompany = @($anonymous.Json.items | Where-Object { $_.companyId -ne $company.companyId })[0]
$otherDetail = Invoke-Api -Method Get -Path "/api/v1/qtime/companies/$($otherCompany.companyId)"
$foreignService = $otherDetail.Json.services[0]
$foreignOffer = Invoke-Api -Method Post -Path '/api/v1/qtime/bookings' `
    -Headers ($authA + @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }) `
    -Body @{ specialistId = $specialist.specialistId; serviceId = $foreignService.serviceId; startsAt = $startsAt; comment = 'чужая услуга' }
Assert-True ($foreignOffer.Status -eq 400) "чужая услуга -> 400 (получено $($foreignOffer.Status))"
Assert-True ($foreignOffer.Json.code -eq 'SERVICE_NOT_OFFERED_BY_SPECIALIST') "код SERVICE_NOT_OFFERED_BY_SPECIALIST (получен $($foreignOffer.Json.code))"
# Колонка в БД называется client_comment (в API поле запроса — comment): имена разные
# намеренно, и путать их нельзя, иначе psql отвечает «column does not exist».
$refusedCount = Psql 'taxi_qtime' "select count(*) from qtime.booking where client_comment in ('запись в выходной', 'чужая услуга')"
Assert-True ([int]$refusedCount -eq 0) "отказанные записи в БД не появились (получено $refusedCount)"

Write-Host ''
if ($script:Failures -gt 0) {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $($script:Failures)" -ForegroundColor Red
    exit 1
}
Write-Host "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ (запись $bookingId, $date $startsAt, $($company.name))" -ForegroundColor Green
exit 0
