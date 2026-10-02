<#
.SYNOPSIS
    Сквозной сценарий диспетчерской: позиция водителя доходит до карты и до поиска.

.DESCRIPTION
    Проверяет весь путь Ф1: водитель выходит на линию -> driver-service публикует
    событие -> dispatch-service строит проекцию -> позиция попадает в Redis GEO ->
    диспетчер видит машину на карте и находит её поиском «кто ближе».

      1. три токена: водитель, диспетчер, обычный клиент;
      2. водитель регистрируется, загружает документы, выходит на линию;
      3. ЗАМЕР: сколько времени проходит от выхода на линию до того, как
         dispatch-service примет его позицию (то есть до того, как событие
         driver.online доехало через Kafka и попало в проекцию) — цель < 1 с;
      4. позиция появляется на карте (/dispatch/drivers) и в поиске
         (/dispatch/nearest), а также в самом Redis GEO;
      5. отказы: не-водитель, водитель не на линии, невозможные координаты,
         радиус вне диапазона, лимит батча;
      6. устаревшая позиция: на карте помечена stale, кандидатом не становится;
      7. уход с линии убирает водителя из кандидатов и его позицию из Redis;
      8. доступ: обычному клиенту и анониму карта недоступна;
      9. инварианты Redis: индекс и проекция согласованы, TTL у позиции есть.

.EXAMPLE
    .\scripts\e2e-dispatch.ps1
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://localhost:8080',
    [string]$Code = '0000',
    # Точка в стороне от центра Шымкента, где обычно крутится симулятор парка.
    [double]$Lat = 42.3600,
    [double]$Lon = 69.6500
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$script:Failures = 0

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
        $params['Body'] = [System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress -Depth 6))  # UTF-8 bytes: a string body goes out as ISO-8859-1 and mangles Cyrillic
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

function Redis([string]$command) {
    (docker exec taxi-redis redis-cli --raw $command.Split(' ') 2>$null | Out-String).Trim()
}

function Token([string]$phone, [string]$name, [string[]]$roles) {
    $login = Invoke-Api -Method Post -Path '/api/v1/auth/token' -Body @{
        phone = $phone; code = $Code; displayName = $name; roles = $roles
    }
    if ($login.Status -ne 200) { throw "логин $phone не удался (HTTP $($login.Status)): $($login.Raw)" }
    return $login.Json.accessToken
}

$suffix = Get-Random -Minimum 1000000 -Maximum 9999999
$driverPhone = '+7702' + $suffix
$otherPhone = '+7703' + $suffix
$future = (Get-Date).ToUniversalTime().AddYears(1).ToString('yyyy-MM-ddTHH:mm:ssZ')

# ---------------------------------------------------------------- 1. tokens
Write-Step '1. Токены: водитель, диспетчер, клиент'
$driverToken = Token $driverPhone 'Водитель Диспетчер E2E' @('DRIVER')
$dispatcherToken = Token ('+7704' + $suffix) 'Диспетчер E2E' @('DISPATCHER')
$customerToken = Token ('+7705' + $suffix) 'Клиент E2E' @('CUSTOMER')
$driverAuth = @{ Authorization = "Bearer $driverToken" }
$dispatcherAuth = @{ Authorization = "Bearer $dispatcherToken" }
$customerAuth = @{ Authorization = "Bearer $customerToken" }
Assert-True ($driverToken.Length -gt 20) 'токен водителя получен'
Assert-True ($dispatcherToken.Length -gt 20) 'токен диспетчера получен'

# ---------------------------------------------------------------- 2. driver on duty
Write-Step '2. Водитель: регистрация, документы, выход на линию'
$registered = Invoke-Api -Method Post -Path '/api/v1/drivers' -Headers $driverAuth -Body @{ displayName = 'Айдар E2E' }
Assert-True ($registered.Status -eq 201) "POST /api/v1/drivers -> 201 (получено $($registered.Status))"
$driverId = $registered.Json.driverId
foreach ($kind in @('DRIVING_LICENCE', 'VEHICLE_INSPECTION', 'MEDICAL_CHECK')) {
    $document = Invoke-Api -Method Post -Path '/api/v1/drivers/me/documents' -Headers $driverAuth `
        -Body @{ kind = $kind; expiresAt = $future }
    Assert-True ($document.Status -eq 200) "$kind принят"
}
$online = Invoke-Api -Method Post -Path '/api/v1/drivers/me/status' -Headers $driverAuth -Body @{ status = 'ONLINE' }
Assert-True ($online.Status -eq 200 -and $online.Json.status -eq 'ONLINE') "водитель на линии (status=$($online.Json.status))"

# ---------------------------------------------------------------- 3. the DoD measurement
Write-Step '3. Замер: как быстро событие доезжает до диспетчерской'
$position = @{ lat = $Lat; lon = $Lon; headingDeg = 90; speedKph = 32; accuracyM = 6 }
$watch = [System.Diagnostics.Stopwatch]::StartNew()
$accepted = $null
while ($watch.Elapsed.TotalSeconds -lt 10) {
    $accepted = Invoke-Api -Method Post -Path '/api/v1/locations' -Headers $driverAuth -Body $position
    if ($accepted.Status -eq 200) { break }
    Start-Sleep -Milliseconds 50
}
$elapsedMs = [int]$watch.Elapsed.TotalMilliseconds
Assert-True ($accepted.Status -eq 200) "позиция принята (HTTP $($accepted.Status))"
Write-Host ("  [i]    событие driver.online дошло до dispatch-service за {0} мс" -f $elapsedMs) -ForegroundColor Yellow
Assert-True ($elapsedMs -lt 1000) "водитель стал доступен для позиций меньше чем за 1 с ($elapsedMs мс)"
Assert-True ($accepted.Json.driverId -eq $driverId) 'позиция привязана к тому же водителю'

# ---------------------------------------------------------------- 4. the map
Write-Step '4. Карта диспетчера видит машину'
$fleet = Invoke-Api -Method Get -Path '/api/v1/dispatch/drivers' -Headers $dispatcherAuth
Assert-True ($fleet.Status -eq 200) "GET /api/v1/dispatch/drivers -> 200 (получено $($fleet.Status))"
$mine = $fleet.Json.drivers | Where-Object { $_.driverId -eq $driverId }
Assert-True ($null -ne $mine) 'водитель есть на карте'
Assert-True ($mine.displayName -eq 'Айдар E2E') "имя приехало из события driver.registered ($($mine.displayName))"
Assert-True ([Math]::Abs($mine.lat - $Lat) -lt 0.0001 -and [Math]::Abs($mine.lon - $Lon) -lt 0.0001) 'координаты совпадают с отправленными'
Assert-True ($mine.stale -eq $false) 'позиция свежая'
Assert-True ($mine.ageSeconds -le 2) "возраст позиции $($mine.ageSeconds) с"
Assert-True ($fleet.Json.onDuty -ge 1) "на линии: $($fleet.Json.onDuty)"
Assert-True ($fleet.Json.withPosition -ge 1) "с позицией: $($fleet.Json.withPosition)"

# ---------------------------------------------------------------- 5. candidate search
Write-Step '5. Поиск «кто ближе» находит его'
$nearest = Invoke-Api -Method Get -Path "/api/v1/dispatch/nearest?lat=$Lat&lon=$Lon&radiusM=300&limit=5" -Headers $dispatcherAuth
Assert-True ($nearest.Status -eq 200) "GET /api/v1/dispatch/nearest -> 200 (получено $($nearest.Status))"
$first = $nearest.Json.candidates | Where-Object { $_.driverId -eq $driverId }
Assert-True ($null -ne $first) 'водитель в списке кандидатов'
Assert-True ($first.distanceM -lt 50) "расстояние от точки до него $([int]$first.distanceM) м"
Assert-True ($nearest.Json.radiusM -eq 300) "радиус в ответе $($nearest.Json.radiusM) м"

Write-Step '6. Индекс в Redis отвечает то же самое'
$geoCard = Redis 'ZCARD dispatch:geo:drivers'
Assert-True ([int]$geoCard -ge 1) "водителей в GEO-индексе: $geoCard"
$geoSearch = Redis ("GEOSEARCH dispatch:geo:drivers FROMLONLAT $Lon $Lat BYRADIUS 300 m ASC")
Assert-True ($geoSearch -match $driverId) 'GEOSEARCH возвращает нашего водителя'
$positionTtl = Redis "TTL dispatch:pos:$driverId"
Assert-True ([int]$positionTtl -gt 0) "у позиции есть TTL ($($positionTtl) с) — пропавший водитель исчезнет сам"
$inDuty = Redis "SISMEMBER dispatch:duty $driverId"
Assert-True ($inDuty -eq '1') 'водитель в множестве «на линии»'

# ---------------------------------------------------------------- 7. refusals
Write-Step '7. Отказы'
$notDriver = Invoke-Api -Method Post -Path '/api/v1/locations' -Headers $customerAuth -Body $position
Assert-True ($notDriver.Status -eq 403) "обычный клиент не может слать позиции -> 403 (получено $($notDriver.Status))"

$badCoords = Invoke-Api -Method Post -Path '/api/v1/locations' -Headers $driverAuth `
    -Body @{ lat = 91; lon = $Lon; accuracyM = 6 }
Assert-True ($badCoords.Status -eq 400) "широта 91 -> 400 (получено $($badCoords.Status))"
Assert-True ($badCoords.Json.code -eq 'INVALID_POSITION') "код INVALID_POSITION (получен $($badCoords.Json.code))"

$badRadius = Invoke-Api -Method Get -Path "/api/v1/dispatch/nearest?lat=$Lat&lon=$Lon&radiusM=99000" -Headers $dispatcherAuth
Assert-True ($badRadius.Status -eq 400) "радиус 99 км -> 400 (получено $($badRadius.Status))"
Assert-True ($badRadius.Json.code -eq 'INVALID_RADIUS') "код INVALID_RADIUS (получен $($badRadius.Json.code))"

$tooMany = Invoke-Api -Method Post -Path '/api/v1/locations/batch' -Headers $driverAuth `
    -Body @{ points = @(1..150 | ForEach-Object { @{ lat = $Lat; lon = $Lon } }) }
Assert-True ($tooMany.Status -eq 400) "батч из 150 точек -> 400 (получено $($tooMany.Status))"
Assert-True ($tooMany.Json.code -eq 'TOO_MANY_POINTS') "код TOO_MANY_POINTS (получен $($tooMany.Json.code))"

# ---------------------------------------------------------------- 8. staleness
Write-Step '8. Устаревшая позиция: видна на карте, но не кандидат'
$old = (Get-Date).ToUniversalTime().AddSeconds(-120).ToString('yyyy-MM-ddTHH:mm:ssZ')
$stale = Invoke-Api -Method Post -Path '/api/v1/locations' -Headers $driverAuth `
    -Body @{ lat = $Lat; lon = $Lon; headingDeg = 90; speedKph = 0; accuracyM = 6; at = $old }
Assert-True ($stale.Status -eq 200) "старая позиция принята как факт (HTTP $($stale.Status))"
$fleet2 = Invoke-Api -Method Get -Path '/api/v1/dispatch/drivers' -Headers $dispatcherAuth
$staleOnMap = $fleet2.Json.drivers | Where-Object { $_.driverId -eq $driverId }
Assert-True ($staleOnMap.stale -eq $true) 'на карте помечена как stale=true'
$nearest2 = Invoke-Api -Method Get -Path "/api/v1/dispatch/nearest?lat=$Lat&lon=$Lon&radiusM=300" -Headers $dispatcherAuth
$stillCandidate = $nearest2.Json.candidates | Where-Object { $_.driverId -eq $driverId }
Assert-True ($null -eq $stillCandidate) 'кандидатом на поездку не становится'

# ---------------------------------------------------------------- 9. off duty
Write-Step '9. Уход с линии убирает водителя с карты'
$offline = Invoke-Api -Method Post -Path '/api/v1/drivers/me/status' -Headers $driverAuth -Body @{ status = 'OFFLINE' }
Assert-True ($offline.Status -eq 200) "водитель ушёл с линии (HTTP $($offline.Status))"
$dutyGone = $false
for ($i = 0; $i -lt 40; $i++) {
    if ((Redis "SISMEMBER dispatch:duty $driverId") -eq '0') { $dutyGone = $true; break }
    Start-Sleep -Milliseconds 100
}
Assert-True $dutyGone 'проекция узнала об уходе с линии (событие driver.offline)'
Assert-True ((Redis "EXISTS dispatch:pos:$driverId") -eq '0') 'позиция удалена из Redis: координаты не хранятся после смены'
$notOnDuty = Invoke-Api -Method Post -Path '/api/v1/locations' -Headers $driverAuth -Body $position
Assert-True ($notOnDuty.Status -eq 409) "позиции от неработающего водителя -> 409 (получено $($notOnDuty.Status))"
Assert-True ($notOnDuty.Json.code -eq 'DRIVER_NOT_ON_DUTY') "код DRIVER_NOT_ON_DUTY (получен $($notOnDuty.Json.code))"

# ---------------------------------------------------------------- 10. access
Write-Step '10. Доступ к карте'
$asCustomer = Invoke-Api -Method Get -Path '/api/v1/dispatch/drivers' -Headers $customerAuth
Assert-True ($asCustomer.Status -eq 403) "обычный клиент не видит парк -> 403 (получено $($asCustomer.Status))"
Assert-True ($asCustomer.Json.code -eq 'FORBIDDEN_FLEET_ACCESS') "код FORBIDDEN_FLEET_ACCESS (получен $($asCustomer.Json.code))"
$anonymous = Invoke-Api -Method Get -Path '/api/v1/dispatch/drivers'
Assert-True ($anonymous.Status -eq 401) "без токена -> 401 (получено $($anonymous.Status))"

Write-Host ''
if ($script:Failures -gt 0) {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $($script:Failures)" -ForegroundColor Red
    exit 1
}
Write-Host "ДИСПЕТЧЕРСКАЯ РАБОТАЕТ (водитель $driverId, событие дошло за $elapsedMs мс)" -ForegroundColor Green
exit 0
