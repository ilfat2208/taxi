<#
.SYNOPSIS
    Сквозной сценарий расчётов с мерчантом: продавец -> продажа -> выплата.

.DESCRIPTION
    Проверяет главный продуктовый пробел маркетплейса — то, что деньги продавца
    действительно доходят до продавца:

      1. пользователь с ролью MERCHANT регистрирует магазин;
      2. открывает счёт типа MERCHANT и указывает его как счёт для выплат;
      3. публикует товар;
      4. покупатель (тот же пользователь, но в роли покупателя) покупает товар:
         корзина -> checkout -> платёж мерчанту;
      5. оператор запускает расчёты: POST /api/v1/settlements/run;
      6. проверяются суммы и деньги:
           gross        = стоимость товаров            -> уходит мерчанту
           commission   = комиссия платформы (1.5%)    -> остаётся платформе
           customerPaid = gross + commission           -> столько заплатил покупатель
           net          = gross
         и что на счёт мерчанта зачислен ровно net;
      7. повторный запуск расчётов не платит второй раз (идемпотентность).

    Требует запущенный стек и короткий hold-period (в docker-compose для демо
    выставлен SETTLEMENT_HOLD_PERIOD=0s, иначе продажа «созревает» через час).

.EXAMPLE
    .\scripts\e2e-settlement.ps1
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://localhost:8080',
    [string]$Phone = '+77005556677',
    [string]$Code = '0000',
    [long]$PriceMinor = 50000,
    [int]$Quantity = 2
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
        return [pscustomobject]@{ Status = [int]$resp.StatusCode; Json = $null; Raw = $raw }
    }
}

function Psql([string]$database, [string]$sql) {
    (docker exec taxi-postgres psql -U taxi -d $database -tAc $sql 2>$null | Out-String).Trim()
}

Write-Step '1. Вход с ролями MERCHANT и ADMIN'
$token = Invoke-Api -Method Post -Path '/api/v1/auth/token' -Body @{
    phone = $Phone; code = $Code; displayName = 'E2E Merchant'; roles = @('CUSTOMER', 'MERCHANT', 'ADMIN')
}
Assert-True ($token.Status -eq 200) "токен получен (HTTP $($token.Status))"
if ($token.Status -ne 200) { Write-Host $token.Raw -ForegroundColor Red; exit 1 }
$auth = @{ Authorization = "Bearer $($token.Json.accessToken)" }

Write-Step '2. Магазин'
$merchant = Invoke-Api -Method Post -Path '/api/v1/merchants' -Headers $auth -Body @{
    name = 'E2E Shop'; displayName = 'E2E Shop'; phone = $Phone; city = 'Алматы'
}
if ($merchant.Status -eq 409) {
    $merchant = Invoke-Api -Method Get -Path '/api/v1/merchants/me' -Headers $auth
}
Assert-True ($merchant.Status -eq 201 -or $merchant.Status -eq 200) "магазин зарегистрирован (HTTP $($merchant.Status))"
$merchantId = $merchant.Json.id
Write-Host "  [i] merchantId=$merchantId"

Write-Step '3. Счёт для выплат'
$account = Invoke-Api -Method Post -Path '/api/v1/accounts' -Headers $auth -Body @{
    currency = 'KZT'; type = 'MERCHANT'; displayName = 'E2E Shop payouts'
}
if ($account.Status -eq 409) {
    $accounts = Invoke-Api -Method Get -Path '/api/v1/accounts' -Headers $auth
    $account = [pscustomobject]@{ Status = 200; Json = ($accounts.Json | Where-Object { $_.type -eq 'MERCHANT' })[0]; Raw = '' }
}
Assert-True ($null -ne $account.Json.id) "счёт выплат: $($account.Json.id)"
$payoutAccountId = $account.Json.id
$payoutBalanceBefore = [long]$account.Json.balanceMinor

$linked = Invoke-Api -Method Patch -Path '/api/v1/merchants/me/payout-account' -Headers $auth -Body @{ accountId = $payoutAccountId }
Assert-True ($linked.Status -eq 200) "счёт привязан к магазину (HTTP $($linked.Status))"
Assert-True ($linked.Json.payoutAccountId -eq $payoutAccountId) "магазин помнит счёт выплат"

Write-Step '4. Покупательский счёт (отдельный от счёта выплат)'
$buyer = Invoke-Api -Method Post -Path '/api/v1/accounts' -Headers $auth -Body @{
    currency = 'KZT'; type = 'CUSTOMER'; displayName = 'E2E Buyer'
}
if ($buyer.Status -eq 409) {
    $accounts = Invoke-Api -Method Get -Path '/api/v1/accounts' -Headers $auth
    $buyer = [pscustomobject]@{ Status = 200; Json = ($accounts.Json | Where-Object { $_.type -eq 'CUSTOMER' })[0]; Raw = '' }
}
Assert-True ($null -ne $buyer.Json.id) "покупательский счёт: $($buyer.Json.id)"
$buyerAccountId = $buyer.Json.id

Write-Step '4b. Товар'
$sku = 'E2E-' + (Get-Random -Maximum 999999)
$product = Invoke-Api -Method Post -Path '/api/v1/catalog/products' -Headers $auth -Body @{
    sku = $sku; title = "Тестовый товар $sku"; description = 'Товар для проверки расчётов'
    category = 'Электроника'; brand = 'E2E'; priceMinor = $PriceMinor; currency = 'KZT'; initialStock = 10
}
Assert-True ($product.Status -eq 201) "товар опубликован (HTTP $($product.Status))"
if ($product.Status -ne 201) { Write-Host $product.Raw -ForegroundColor Red; exit 1 }
$productId = $product.Json.id
Write-Host "  [i] productId=$productId, price=$PriceMinor KZT"

Write-Step '5. Пополнение покупателя и покупка'
$topUp = Invoke-Api -Method Post -Path "/api/v1/accounts/$buyerAccountId/top-up" -Headers $auth -Body @{ amountMinor = 500000; reason = 'e2e buyer funds' }
Assert-True ($topUp.Status -eq 200) "покупательский счёт пополнен (HTTP $($topUp.Status))"
$buyerBalanceBefore = [long]$topUp.Json.balanceMinor

$cart = Invoke-Api -Method Post -Path '/api/v1/cart/items' -Headers $auth -Body @{ productId = $productId; quantity = $Quantity }
Assert-True ($cart.Status -eq 200 -or $cart.Status -eq 201) "товар в корзине (HTTP $($cart.Status))"

$checkoutBody = @{ deliveryAddress = 'Алматы, Абая 150'; contactPhone = $Phone; comment = 'e2e settlement'; sourceAccountId = $buyerAccountId }
$checkout = Invoke-Api -Method Post -Path '/api/v1/orders' -Headers @{ Authorization = $auth.Authorization; 'Idempotency-Key' = [guid]::NewGuid().ToString() } -Body $checkoutBody
Assert-True ($checkout.Status -eq 201) "заказ оформлен (HTTP $($checkout.Status))"
$order = $checkout.Json
Assert-True ($order.status -eq 'PAID') "заказ оплачен (статус $($order.status))"
$expectedGross = $PriceMinor * $Quantity
Write-Host "  [i] order=$($order.orderNumber) total=$($order.totalMinor)"

Write-Step '6. Расчёты с мерчантом'
$run = Invoke-Api -Method Post -Path '/api/v1/settlements/run' -Headers $auth
Assert-True ($run.Status -eq 200) "запуск расчётов (HTTP $($run.Status))"
Write-Host "  [i] computed=$($run.Json.computed) paid=$($run.Json.paid) failed=$($run.Json.failed) awaiting=$($run.Json.awaitingPayoutAccount)"
# Счётчик failed одного прогона — не приговор: выплата, упавшая на таймауте, помечается
# FAILED, долг остаётся на балансе и доплачивается следующим прогоном (в этом и смысл
# «долг ≠ выплата»). Поэтому ниже проверяется итоговое состояние расчётов, а не
# мгновенный счётчик: застрявших в FAILED быть не должно.

$list = Invoke-Api -Method Get -Path "/api/v1/settlements?merchantId=$merchantId&page=0&size=10" -Headers $auth
Assert-True ($list.Status -eq 200) "список расчётов (HTTP $($list.Status))"
$stuckFailed = (($list.Json.items | Where-Object { $_.status -eq 'FAILED' }) | Measure-Object).Count
Assert-True ($stuckFailed -eq 0) "нет расчётов, застрявших в FAILED (найдено: $stuckFailed)"
$settlement = $list.Json.items | Select-Object -First 1
Assert-True ($null -ne $settlement) 'расчёт создан'
if (-not $settlement) { Write-Host $list.Raw -ForegroundColor Red; exit 1 }
Write-Host "  [i] $($settlement.settlementNumber) status=$($settlement.status) net=$($settlement.netMinor) commission=$($settlement.commissionMinor)"

Write-Step '7. Суммы'
Assert-True ($settlement.status -eq 'PAID') "расчёт выплачен (статус $($settlement.status))"
Assert-True ($settlement.grossMinor -eq $expectedGross) "стоимость товаров = $expectedGross (получено $($settlement.grossMinor))"
Assert-True ($settlement.netMinor -eq $settlement.grossMinor) 'мерчанту причитается ровно стоимость товаров'
Assert-True ($settlement.customerPaidMinor -eq ($settlement.grossMinor + $settlement.commissionMinor)) 'покупатель заплатил товары + комиссию'
Assert-True ($settlement.commissionMinor -gt 0) "комиссия платформы удержана: $($settlement.commissionMinor)"
Assert-True ($settlement.payoutAccountId -eq $payoutAccountId) 'выплата ушла на счёт, выбранный мерчантом'

Write-Step '8. Деньги на счёте мерчанта'
$payoutAccount = Invoke-Api -Method Get -Path "/api/v1/accounts/$payoutAccountId" -Headers $auth
# Повторный прогон сценария доплачивает и старый долг (прошлые прогоны оставили
# неоплаченные расчёты), поэтому сверяем не «одну выплату», а весь баланс счёта с
# суммой всех выплаченных расчётов этого мерчанта: это и есть настоящая проверка —
# на счёт пришло ровно то, что обещано в расчётах, ни больше ни меньше.
$allSettlements = (Invoke-Api -Method Get -Path "/api/v1/settlements?merchantId=$merchantId&page=0&size=100" -Headers $auth).Json.items
$paidBacklog = ($allSettlements | Where-Object { $_.status -eq 'PAID' } | Measure-Object -Property netMinor -Sum).Sum
if (-not $paidBacklog) { $paidBacklog = 0 }
Write-Host "  [i] выплаченных расчётов: $(($allSettlements | Where-Object { $_.status -eq 'PAID' }).Count), сумма net=$paidBacklog"
Assert-True ([long]$payoutAccount.Json.balanceMinor -eq [long]$paidBacklog) "баланс счёта равен сумме выплаченных расчётов ($($payoutAccount.Json.balanceMinor) = $paidBacklog)"
Assert-True (([long]$payoutAccount.Json.balanceMinor - $payoutBalanceBefore) -ge $settlement.netMinor) 'текущая покупка действительно оплачена мерчанту'

Write-Step '9. Повторный запуск расчётов не платит второй раз'
$again = Invoke-Api -Method Post -Path '/api/v1/settlements/run' -Headers $auth
$payoutAccountAfter = Invoke-Api -Method Get -Path "/api/v1/accounts/$payoutAccountId" -Headers $auth
Assert-True ([long]$payoutAccountAfter.Json.balanceMinor -eq [long]$payoutAccount.Json.balanceMinor) 'баланс мерчанта не изменился'
Assert-True ($again.Json.paid -eq 0) 'повторный прогон никого не оплатил'

Write-Step '10. Что покрывает выплата'
$detail = Invoke-Api -Method Get -Path "/api/v1/settlements/$($settlement.settlementId)" -Headers $auth
Assert-True ($detail.Status -eq 200) "детали расчёта (HTTP $($detail.Status))"
Assert-True ($detail.Json.paymentIds.Count -ge 1) "выплата покрывает платёж(и): $($detail.Json.paymentIds -join ', ')"

Write-Step '11. События и инварианты'
$events = Psql 'taxi_payment' "select count(*) from payment.outbox_message where event_type like 'settlement.%' and status = 'PUBLISHED'"
Assert-True ([int]$events -ge 2) "события расчётов опубликованы (settlement.* = $events)"
$divergent = Psql 'taxi_account' "select count(*) from (select a.id from account.account a left join (select account_id, sum(case when direction='CREDIT' then amount_minor else -amount_minor end) s from account.ledger_entry group by account_id) l on l.account_id=a.id where a.balance_minor <> coalesce(l.s,0)) x"
Assert-True ([int]$divergent -eq 0) "балансы сходятся с леджером (расхождений: $divergent)"
$paidSettlements = Psql 'taxi_payment' "select count(*) from payment.merchant_settlement where status = 'PAID' and net_minor <> gross_minor"
Assert-True ([int]$paidSettlements -eq 0) 'ни одной выплаты с net != gross'

Write-Host ''
if ($script:Failures -eq 0) {
    Write-Host "РАСЧЁТЫ С МЕРЧАНТОМ РАБОТАЮТ ($($settlement.settlementNumber): $($settlement.netMinor) минорных единиц выплачено)" -ForegroundColor Green
    exit 0
} else {
    Write-Host "ПРОВАЛЕНО ПРОВЕРОК: $script:Failures" -ForegroundColor Red
    exit 1
}
