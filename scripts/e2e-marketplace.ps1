<#
.SYNOPSIS
    Сквозной сценарий маркетплейса: каталог -> корзина -> checkout -> оплата -> леджер.

.DESCRIPTION
    Проверяет сагу целиком, через публичный API шлюза:

      1. вход по телефону (dev-identity, код 0000);
      2. счёт + демо-пополнение (роль ADMIN);
      3. каталог читается анонимно (витрина доступна без входа);
      4. товар добавляется в корзину (order-service проверяет товар у catalog-service);
      5. checkout создаёт заказ, резервирует сток и проводит платёж мерчанту
         (payment-service: hold -> capture в account-service);
      6. повтор checkout с тем же Idempotency-Key НЕ создаёт второй заказ;
      7. заказ становится PAID, комиссия посчитана, со счёта списано ровно
         amount + fee, корзина очищена;
      8. инварианты БД: баланс каждого счёта равен сумме его проводок, каждая
         транзакция леджера сбалансирована, outbox пуст по PENDING.

    Требуется запущенный стек (см. scripts/dev-up.ps1).

.EXAMPLE
    .\scripts\e2e-marketplace.ps1
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://localhost:8080',
    [string]$Phone = '+77001112233',
    [string]$Code = '0000',
    [long]$TopUpMinor = 2000000,
    [int]$Quantity = 2
)

$ErrorActionPreference = 'Stop'
# Кириллица из API: консоль Windows по умолчанию не в UTF-8.
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
        $params['Body'] = ($Body | ConvertTo-Json -Compress -Depth 6)
        $params['ContentType'] = 'application/json'
    }
    try {
        $response = Invoke-WebRequest @params
        # Читаем байты и декодируем как UTF-8: Windows PowerShell 5.1 без charset в
        # Content-Type декодирует тело как Latin-1, и кириллица превращается в мусор.
        $raw = [System.Text.Encoding]::UTF8.GetString($response.RawContentStream.ToArray())
        return [pscustomobject]@{ Status = [int]$response.StatusCode; Json = ($raw | ConvertFrom-Json); Raw = $raw }
    } catch {
        $response = $_.Exception.Response
        if (-not $response) { throw }
        $memory = New-Object System.IO.MemoryStream
        $response.GetResponseStream().CopyTo($memory)
        $raw = [System.Text.Encoding]::UTF8.GetString($memory.ToArray())
        return [pscustomobject]@{ Status = [int]$response.StatusCode; Json = $null; Raw = $raw }
    }
}

function Psql([string]$database, [string]$sql) {
    (docker exec taxi-postgres psql -U taxi -d $database -tAc $sql 2>$null | Out-String).Trim()
}

Write-Step '1. Вход (dev-identity)'
$token = Invoke-Api -Method Post -Path '/api/v1/auth/token' -Body @{
    phone = $Phone; code = $Code; displayName = 'E2E Tester'; roles = @('CUSTOMER', 'ADMIN', 'MERCHANT')
}
Assert-True ($token.Status -eq 200) "POST /api/v1/auth/token -> 200 (получено $($token.Status))"
if ($token.Status -ne 200) { Write-Host $token.Raw -ForegroundColor Red; exit 1 }
$userId = $token.Json.userId
$auth = @{ Authorization = "Bearer $($token.Json.accessToken)" }
Write-Host "  [i] userId=$userId"

Write-Step '2. Счёт и демо-пополнение'
$created = Invoke-Api -Method Post -Path '/api/v1/accounts' -Headers $auth -Body @{ currency = 'KZT'; type = 'CUSTOMER'; displayName = 'E2E Tester' }
if ($created.Status -eq 409) {
    $accounts = Invoke-Api -Method Get -Path '/api/v1/accounts' -Headers $auth
    $account = ($accounts.Json | Where-Object { $_.currency -eq 'KZT' })[0]
} else {
    Assert-True ($created.Status -eq 201) "POST /api/v1/accounts -> 201 (получено $($created.Status))"
    $account = $created.Json
}
Assert-True ($null -ne $account.id) "счёт: $($account.id)"
$balanceBefore = [long]$account.balanceMinor
Write-Host "  [i] баланс до покупки: $balanceBefore"

Write-Step '3. Витрина читается анонимно'
$catalog = Invoke-Api -Method Get -Path '/api/v1/catalog/products?page=0&size=5'
Assert-True ($catalog.Status -eq 200) "GET /api/v1/catalog/products без токена -> 200 (получено $($catalog.Status))"
Assert-True ($catalog.Json.items.Count -gt 0) "товаров на витрине: $($catalog.Json.totalElements)"
$product = $catalog.Json.items | Where-Object { $_.availableQuantity -ge $Quantity } | Select-Object -First 1
Assert-True ($null -ne $product) "выбран товар с достаточным остатком"
if (-not $product) { exit 1 }
Write-Host "  [i] $($product.title) — $($product.priceMinor) $($product.currency), доступно $($product.availableQuantity)"

# Пополняем ровно недостающее, а не фиксированную сумму: сценарий должен
# проходить на чистом окружении, где баланс нулевой, и не зависеть от того, какой
# товар оказался первым на витрине. Комиссия — 1.5%, берём с запасом.
Write-Step '4. Пополнение под конкретную покупку'
$expectedAmount = [long]$product.priceMinor * $Quantity
$required = [long][math]::Ceiling($expectedAmount * 1.05) + 1000
$shortfall = $required - $balanceBefore
if ($shortfall -gt 0) {
    $topped = Invoke-Api -Method Post -Path "/api/v1/accounts/$($account.id)/top-up" -Headers $auth -Body @{ amountMinor = $shortfall; reason = 'e2e funds' }
    Assert-True ($topped.Status -eq 200) "пополнение на $shortfall -> 200 (получено $($topped.Status))"
    $balanceBefore = [long]$topped.Json.balanceMinor
} else {
    Write-Host "  [i] пополнение не нужно: на счёте достаточно средств"
}
Assert-True ($balanceBefore -ge $required) "средств хватает на покупку с комиссией ($balanceBefore >= $required)"

Write-Step '5. Корзина'
# Начинаем с пустой корзины: отменённый на прошлом прогоне checkout оставляет
# товары в корзине (они не оплачены — и это правильно), а сценарий обязан
# проходить независимо от того, что было раньше.
$cleared = Invoke-Api -Method Delete -Path '/api/v1/cart' -Headers $auth
Assert-True ($cleared.Status -eq 200 -or $cleared.Status -eq 204) "корзина очищена (HTTP $($cleared.Status))"

$cart = Invoke-Api -Method Post -Path '/api/v1/cart/items' -Headers $auth -Body @{ productId = $product.id; quantity = $Quantity }
Assert-True ($cart.Status -eq 200 -or $cart.Status -eq 201) "добавление товара -> $($cart.Status)"
# itemCount — количество единиц товара, items — количество позиций: это разные
# вещи, и проверяем обе, чтобы «две штуки» не путались с «две позиции».
Assert-True ($cart.Json.items.Count -eq 1) "в корзине 1 позиция"
Assert-True ($cart.Json.itemCount -eq $Quantity) "в корзине $Quantity единиц товара"
Assert-True ($cart.Json.subtotalMinor -eq ($product.priceMinor * $Quantity)) "подытог = цена x количество ($($cart.Json.subtotalMinor))"

Write-Step '6. Checkout (сага: заказ -> резерв стока -> платёж)'
$idempotencyKey = [guid]::NewGuid().ToString()
$checkoutHeaders = @{ Authorization = "Bearer $($token.Json.accessToken)"; 'Idempotency-Key' = $idempotencyKey }
$checkoutBody = @{
    deliveryAddress = 'Алматы, пр. Абая 150'
    contactPhone    = $Phone
    comment         = 'e2e'
    sourceAccountId = $account.id
}
$order = Invoke-Api -Method Post -Path '/api/v1/orders' -Headers $checkoutHeaders -Body $checkoutBody
Assert-True ($order.Status -eq 201 -or $order.Status -eq 202) "POST /api/v1/orders -> $($order.Status)"
if (-not $order.Json -or -not $order.Json.orderId) { Write-Host $order.Raw -ForegroundColor Red; exit 1 }
Write-Host "  [i] заказ $($order.Json.orderNumber) status=$($order.Json.status) total=$($order.Json.totalMinor)"

Write-Step '7. Повтор checkout с тем же Idempotency-Key'
$replay = Invoke-Api -Method Post -Path '/api/v1/orders' -Headers $checkoutHeaders -Body $checkoutBody
Assert-True ($replay.Json.orderId -eq $order.Json.orderId) 'повтор вернул тот же заказ, а не создал второй'

Write-Step '8. Итог саги'
Start-Sleep -Seconds 3
$final = Invoke-Api -Method Get -Path "/api/v1/orders/$($order.Json.orderId)" -Headers $auth
$finalStatus = $final.Json.status
Assert-True ($finalStatus -eq 'PAID') "заказ PAID (получено $finalStatus)"
Assert-True ($final.Json.paymentStatus -eq 'COMPLETED') "платёж COMPLETED (получено $($final.Json.paymentStatus))"

$payment = Invoke-Api -Method Get -Path "/api/v1/payments/by-order/$($order.Json.orderId)" -Headers $auth
Assert-True ($payment.Status -eq 200) "платёж заказа найден (HTTP $($payment.Status))"
if ($payment.Status -eq 200) {
    $fee = $payment.Json.feeMinor
    $total = $payment.Json.totalMinor
    Assert-True ($payment.Json.status -eq 'COMPLETED') "платёж $($payment.Json.paymentId) COMPLETED"
    Assert-True ($total -eq ($payment.Json.amountMinor + $fee)) "total = amount + комиссия ($total = $($payment.Json.amountMinor) + $fee)"

    $afterBalance = (Invoke-Api -Method Get -Path "/api/v1/accounts/$($account.id)" -Headers $auth).Json.balanceMinor
    Assert-True (($balanceBefore - $afterBalance) -eq $total) "списано ровно $total (было $balanceBefore, стало $afterBalance)"
}

$cartAfter = Invoke-Api -Method Get -Path '/api/v1/cart' -Headers $auth
Assert-True ($cartAfter.Json.itemCount -eq 0) 'корзина очищена после оформления'

Write-Step '9. Инварианты данных'
$divergent = Psql 'taxi_account' "select count(*) from (select a.id from account.account a left join (select account_id, sum(case when direction='CREDIT' then amount_minor else -amount_minor end) s from account.ledger_entry group by account_id) l on l.account_id=a.id where a.balance_minor <> coalesce(l.s,0)) x"
Assert-True ([int]$divergent -eq 0) "балансы сходятся с леджером (расхождений: $divergent)"

$unbalanced = Psql 'taxi_account' "select count(*) from (select transaction_id from account.ledger_entry group by transaction_id having sum(case when direction='CREDIT' then amount_minor else -amount_minor end) <> 0) x"
Assert-True ([int]$unbalanced -eq 0) "все транзакции леджера сбалансированы (нарушений: $unbalanced)"

$pending = Psql 'taxi_order' "select count(*) from orders.outbox_message where status <> 'PUBLISHED'"
Assert-True ([int]$pending -eq 0) "события заказов опубликованы (в очереди: $pending)"

$reservations = Psql 'taxi_catalog' "select count(*) from catalog.stock_reservation where order_id='$($order.Json.orderId)' and status='COMMITTED'"
Assert-True ([int]$reservations -eq 1) 'резерв стока подтверждён (COMMITTED)'

Write-Host ''
if ($script:Failures -eq 0) {
    Write-Host "СКВОЗНОЙ СЦЕНАРИЙ ПРОЙДЕН (order=$($order.Json.orderId), payment=$($payment.Json.paymentId))" -ForegroundColor Green
    exit 0
} else {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $script:Failures" -ForegroundColor Red
    exit 1
}
