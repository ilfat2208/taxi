<#
.SYNOPSIS
    Симулирует парк водителей: регистрация, выход на линию и движение по Алматы.

.DESCRIPTION
    Нужен, чтобы живую карту диспетчера было на что смотреть без настоящих машин.
    Для каждого водителя скрипт:

      1. логинится с ролью DRIVER (dev-identity: любой телефон, код 0000);
      2. регистрирует профиль водителя (повторная регистрация — не ошибка);
      3. загружает три документа (права, техосмотр, медосмотр) — без них на линию
         не пустят;
      4. выходит на линию (ONLINE);
      5. далее раз в IntervalSeconds секунд отправляет позицию, двигаясь по кругу
         вокруг центра с индивидуальным радиусом и направлением.

    Водители едут с разными радиусами, поэтому на карте видно не «облако точек»,
    а движение, и в /dispatch/nearest они меняются местами по мере сближения.

    Скрипт рассчитан на остановку по Ctrl+C: водители остаются на линии, но
    перестают присылать позиции и через position-ttl исчезают с карты сами.

.EXAMPLE
    .\scripts\simulate-fleet.ps1 -Drivers 6 -Minutes 10

.EXAMPLE
    .\scripts\simulate-fleet.ps1 -Drivers 12 -IntervalSeconds 3 -RadiusM 4000
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://localhost:8080',
    [int]$Drivers = 6,
    [int]$IntervalSeconds = 4,
    [int]$Minutes = 10,
    [double]$CenterLat = 43.2389,
    [double]$CenterLon = 76.8897,
    [int]$RadiusM = 2500,
    [string]$Code = '0000'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }

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

$future = (Get-Date).ToUniversalTime().AddYears(1).ToString('yyyy-MM-ddTHH:mm:ssZ')
$fleet = @()

Write-Step "1. Готовлю $Drivers водителей"

for ($i = 1; $i -le $Drivers; $i++) {
    $phone = '+7701' + (Get-Random -Minimum 1000000 -Maximum 9999999)
    $name = 'Водитель ' + $i

    $login = Invoke-Api -Method Post -Path '/api/v1/auth/token' -Body @{
        phone = $phone; code = $Code; displayName = $name; roles = @('DRIVER')
    }
    if ($login.Status -ne 200) { throw "водитель ${i}: логин не удался (HTTP $($login.Status)): $($login.Raw)" }
    $auth = @{ Authorization = "Bearer $($login.Json.accessToken)" }

    $registered = Invoke-Api -Method Post -Path '/api/v1/drivers' -Headers $auth -Body @{ displayName = $name }
    if ($registered.Status -eq 201) {
        $driverId = $registered.Json.driverId
    } elseif ($registered.Status -eq 409) {
        $driverId = (Invoke-Api -Method Get -Path '/api/v1/drivers/me' -Headers $auth).Json.driverId
    } else {
        throw "водитель ${i}: регистрация не удалась (HTTP $($registered.Status)): $($registered.Raw)"
    }

    foreach ($kind in @('DRIVING_LICENCE', 'VEHICLE_INSPECTION', 'MEDICAL_CHECK')) {
        $document = Invoke-Api -Method Post -Path '/api/v1/drivers/me/documents' -Headers $auth `
            -Body @{ kind = $kind; expiresAt = $future }
        if ($document.Status -ne 200) { throw "водитель ${i}: документ $kind не принят (HTTP $($document.Status))" }
    }

    $online = Invoke-Api -Method Post -Path '/api/v1/drivers/me/status' -Headers $auth -Body @{ status = 'ONLINE' }
    if ($online.Status -ne 200 -and $online.Status -ne 409) {
        throw "водитель ${i}: выход на линию не удался (HTTP $($online.Status)): $($online.Raw)"
    }

    # Каждому — свой радиус и своя фаза, иначе все машины поедут одной точкой.
    $angle = 360.0 / $Drivers * $i
    $radius = $RadiusM * (0.5 + 0.8 * ($i / [double]$Drivers))
    $speedKph = 20 + (Get-Random -Minimum 0 -Maximum 25)

    $fleet += [pscustomobject]@{
        Index = $i; Phone = $phone; DriverId = $driverId; Name = $name
        Auth = $auth; Angle = $angle; Radius = $radius; SpeedKph = $speedKph
    }
    Write-Host ("  [ok]   {0} — {1}, на линии, радиус {2:N0} м" -f $name, $driverId, $radius) -ForegroundColor Green
}

Write-Step "2. Движение (интервал $IntervalSeconds с, до $Minutes мин, Ctrl+C для остановки)"
$deadline = (Get-Date).AddMinutes($Minutes)
$tick = 0
$sent = 0
$errors = 0

while ((Get-Date) -lt $deadline) {
    $tick++
    foreach ($driver in $fleet) {
        # Угол растёт пропорционально скорости: 1 км/ч за такт ~ 0.28 м пути.
        $stepDeg = ($driver.SpeedKph * 0.28 * $IntervalSeconds) / ([Math]::Max($driver.Radius, 1)) * 57.2958
        $driver.Angle = ($driver.Angle + $stepDeg) % 360
        $rad = $driver.Angle * [Math]::PI / 180.0

        # Плоская аппроксимация вокруг центра: для города в пару километров
        # расхождение с геодезией — метры, а координаты нужны сервису, не картографу.
        $lat = $CenterLat + ($driver.Radius * [Math]::Cos($rad)) / 111320.0
        $lon = $CenterLon + ($driver.Radius * [Math]::Sin($rad)) / (111320.0 * [Math]::Cos($CenterLat * [Math]::PI / 180.0))

        $result = Invoke-Api -Method Post -Path '/api/v1/locations' -Headers $driver.Auth -Body @{
            lat = [Math]::Round($lat, 6)
            lon = [Math]::Round($lon, 6)
            headingDeg = [Math]::Round(($driver.Angle + 90) % 360, 1)
            speedKph = $driver.SpeedKph
            accuracyM = 6
        }
        if ($result.Status -eq 200) { $sent++ } else { $errors++; Write-Host "  [err]  $($driver.Name): HTTP $($result.Status) $($result.Json.code)" -ForegroundColor Red }
    }
    Write-Host ("  тик {0,3}: отправлено {1}, ошибок {2}" -f $tick, $sent, $errors)
    Start-Sleep -Seconds $IntervalSeconds
}

Write-Step "Итог"
Write-Host ("  водителей на линии: {0}, отправлено позиций: {1}, ошибок: {2}" -f $fleet.Count, $sent, $errors) -ForegroundColor Cyan
Write-Host "  Чтобы посмотреть карту: http://localhost:5173/dispatch (роль DISPATCHER)" -ForegroundColor Cyan
exit 0
