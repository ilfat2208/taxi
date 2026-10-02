# API

Все внешние вызовы идут через `api-gateway` (`http://localhost:8080`). Внутренние
эндпоинты сервисов (`/internal/`) наружу не маршрутизируются.

* Аутентификация — `Authorization: Bearer <jwt>`.
* Трассировка — заголовок `X-Correlation-Id`; если не передан, шлюз сгенерирует его
  и вернёт в ответе. Тот же id уходит в Kafka-события и в логи всех сервисов.
* Деньги — **всегда в минорных единицах** (`long`): `150000` = `1 500.00 KZT`.
* Ошибки — RFC 7807 (`application/problem+json`), см. раздел «Ошибки».
* Идемпотентность — заголовок `Idempotency-Key` обязателен для операций,
  двигающих деньги или создающих заказ.
* Пагинация — `?page=0&size=20` (максимум 100), ответ `PageResponse`.
* Swagger UI со всеми сервисами — <http://localhost:8080/swagger-ui.html>.

---

## 1. Аутентификация

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/v1/auth/token` | Выдать токен: `{phone, code, displayName?, roles?}` |
| GET | `/api/v1/auth/me` | Профиль по токену: `{userId, phone, displayName, roles}` |

```bash
curl -X POST http://localhost:8080/api/v1/auth/token \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+77001234567","code":"0000","displayName":"Aisha"}'
```

```json
{"accessToken":"eyJhbGciOiJIUzI1NiJ9...","tokenType":"Bearer","expiresIn":3600,
 "userId":"U-1A2B3C4D5E","roles":["CUSTOMER"]}
```

Это **учебный** провайдер идентичности (код `0000`, роли `CUSTOMER / MERCHANT /
SUPPORT / ADMIN`). В продакшене на его месте внешний OIDC; сервисы проверяют токен
локально и о смене провайдера не узнают.

---

## 2. Счета — `account-service`

| Метод | Путь | Роли | Описание |
|---|---|---|---|
| POST | `/api/v1/accounts` | CUSTOMER | Открыть счёт `{currency, type, displayName?}` (один на валюту и тип) |
| GET | `/api/v1/accounts` | CUSTOMER | Свои счета |
| GET | `/api/v1/accounts/{id}` | owner / ADMIN | Один счёт |
| GET | `/api/v1/accounts/{id}/transactions?page&size` | owner / ADMIN | Выписка по леджеру, новые сверху |
| GET | `/api/v1/accounts/{id}/holds?status=ACTIVE` | owner / ADMIN | Зарезервированные суммы |
| POST | `/api/v1/accounts/{id}/top-up` | ADMIN | Демо-пополнение `{amountMinor, reason}` |
| GET | `/api/v1/accounts/{id}/limits` | ADMIN | Лимиты и их использование по окнам |
| PUT | `/api/v1/accounts/{id}/limits` | ADMIN | `{window, outgoingLimitMinor}` — выставить или изменить лимит |

```json
{
  "accountId": "01J8...", "currency": "KZT",
  "limits": [
    {"window": "DAILY", "configured": true, "outgoingLimitMinor": 100000,
     "usedMinor": 60000, "remainingMinor": 40000,
     "windowStart": "2024-09-01T00:00:00Z", "windowEnd": "2024-09-02T00:00:00Z"},
    {"window": "MONTHLY", "configured": false, "outgoingLimitMinor": null,
     "usedMinor": 60000, "remainingMinor": null}
  ],
  "velocity": {"enabled": true, "maxOperations": 10, "window": "PT5M", "operationsInWindow": 3}
}
```

Лимиты проверяются **при резервировании** и до движения денег, поэтому отказ не
оставляет ни резерва, ни проводки. Отсутствие лимита означает «без ограничения».
Превышение возвращает `422 LIMIT_EXCEEDED` или `422 VELOCITY_EXCEEDED` с деталями
(`window`, `limitMinor`, `usedMinor`, `requestedMinor`, `remainingMinor`) — клиент
может показать пользователю понятное сообщение, а не «что-то пошло не так».

```json
{
  "id": "01J8ZCQ7Y4R3F0N5G8K2M9QW1T",
  "ownerUserId": "U-1A2B3C4D5E",
  "type": "CUSTOMER",
  "currency": "KZT",
  "status": "ACTIVE",
  "balanceMinor": 500000, "heldMinor": 150000, "availableMinor": 350000,
  "createdAt": "2024-09-01T10:15:30Z"
}
```

`availableMinor = balanceMinor - heldMinor`. Пополнение проводит контр-запись через
системный счёт-подвеску, поэтому леджер остаётся сбалансированным:
`СУММА(debit) = СУММА(credit)` для каждой транзакции.

---

## 3. Платежи — `payment-service`

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/v1/payments/transfers` | P2P-перевод по телефону. **Требует `Idempotency-Key`** |
| POST | `/api/v1/payments/merchant` | Платёж мерчанту (используется checkout). **Требует `Idempotency-Key`** |
| GET | `/api/v1/payments?page&size&status` | Свои платежи (ADMIN — все) |
| GET | `/api/v1/payments/{id}` | Платёж + история переходов |
| GET | `/api/v1/payments/by-order/{orderId}` | Платёж заказа (используется восстановлением саги) |
| POST | `/api/v1/payments/{id}/refund` | Возврат (полный или частичный). **Требует `Idempotency-Key`** |
| GET | `/api/v1/payments/{id}/refunds` | Возвраты платежа |

```bash
curl -X POST http://localhost:8080/api/v1/payments/transfers \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"sourceAccountId":"01J8...","targetPhone":"+77009998877",
       "amountMinor":150000,"currency":"KZT","description":"обед"}'
```

Состояния платежа: `INITIATED → PENDING → COMPLETED | FAILED`, `COMPLETED → REVERSED`.

Повтор того же запроса с тем же `Idempotency-Key` и тем же телом вернёт **исходный
ответ** (в теле будет `"replayed": true` в логах сервиса, HTTP 201 с тем же
`paymentId`). Тот же ключ с другим телом → `409 IDEMPOTENCY_CONFLICT`.

---

## 4. Каталог — `catalog-service`

| Метод | Путь | Роли | Описание |
|---|---|---|---|
| GET | `/api/v1/catalog/products` | публично | Поиск: `query, category, merchantId, minPriceMinor, maxPriceMinor, page, size, sort` |
| GET | `/api/v1/catalog/products/{id}` | публично | Товар + остаток |
| GET | `/api/v1/catalog/categories` | публично | Категории активных товаров |
| GET | `/api/v1/merchants/{id}` | публично | Публичный профиль мерчанта |
| POST | `/api/v1/merchants` | MERCHANT | Стать мерчантом `{name, displayName, phone, email, city}` |
| GET | `/api/v1/merchants/me` | MERCHANT | Свой профиль |
| POST | `/api/v1/catalog/products` | MERCHANT | Создать товар `{sku, title, description, category, brand, priceMinor, currency, imageUrl, initialStock}` |
| PATCH | `/api/v1/catalog/products/{id}` | MERCHANT | Изменить товар / остаток |

`sort`: `price_asc`, `price_desc`, `newest`, `relevance` (полнотекстовый поиск
Postgres по `search_vector`).

---

## 5. Такси: водители — `driver-service`

Публичный API водителя. Все ручки — про себя: `/api/v1/drivers/{id}` не существует
намеренно, чтобы «посмотреть чужой профиль» нельзя было даже попробовать. Роль `DRIVER`
даёт доступ к этим ручкам; чтение чужих профилей для поддержки появится отдельными,
явно авторизованными ручками вместе с диспетчерской.

| Метод | Путь | Что делает |
|---|---|---|
| `POST` | `/api/v1/drivers` | регистрирует вызывающего как водителя (201; повтор → 409) |
| `GET` | `/api/v1/drivers/me` | профиль с документами и состоянием смены |
| `POST` | `/api/v1/drivers/me/documents` | добавляет или продлевает документ (`DRIVING_LICENCE`, `VEHICLE_INSPECTION`, `MEDICAL_CHECK`) |
| `POST` | `/api/v1/drivers/me/status` | выход на линию (`ONLINE`) и уход с линии (`OFFLINE`) |

Пример целиком — в README, раздел «Первый сценарий такси за минуту».

Правила, за которые отвечает сервис:

* на линию не пустят без действующих прав, техосмотра и медосмотра →
  `422 DRIVER_DOCUMENTS_INCOMPLETE`, а если документ просрочен — `422 DRIVER_DOCUMENT_EXPIRED`
  (документ, истекающий сегодня, уже недействителен: проверка строгая);
* повторный выход на линию → `409 DRIVER_ALREADY_ON_DUTY`;
* `status=BUSY` от клиента → `400 INVALID_DRIVER`: занятость выставляет только диспетчер,
  иначе водитель мог бы «спрятаться» от заказов;
* уход с линии во время поездки запрещён (`409 DRIVER_ON_TRIP`) — правило уже в агрегате
  и начнёт срабатывать, когда поездки появятся (Ф2).

Смена состояния публикует `driver.online` / `driver.offline` в `driver.events` через
транзакционный outbox: диспетчерская узнаёт о водителе из Kafka, а не опросом базы.

## 6. Корзина и заказы — `order-service`

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/v1/cart` | Текущая корзина (создаётся при первом обращении) |
| POST | `/api/v1/cart/items` | Добавить `{productId, quantity}` |
| PATCH | `/api/v1/cart/items/{itemId}` | Изменить количество `{quantity}` |
| DELETE | `/api/v1/cart/items/{itemId}` | Удалить позицию |
| DELETE | `/api/v1/cart` | Очистить корзину |
| POST | `/api/v1/orders` | Checkout. **Требует `Idempotency-Key`** |
| GET | `/api/v1/orders?page&size&status` | Свои заказы |
| GET | `/api/v1/orders/{id}` | Заказ + позиции + история статусов |
| POST | `/api/v1/orders/{id}/cancel` | Отмена (пока заказ не оплачен) |

```bash
curl -X POST http://localhost:8080/api/v1/orders \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"deliveryAddress":"Алматы, Абая 150","contactPhone":"+77001234567",
       "sourceAccountId":"01J8..."}'
```

Состояния заказа: `DRAFT → PENDING_PAYMENT → PAID → CONFIRMED`,
`PENDING_PAYMENT → CANCELLED | FAILED`.

---

## 7. Расчёты с мерчантами — `payment-service` и `catalog-service`

Маркетплейс должен продавцу деньги за проданный товар. Комиссия платформы
удерживается сразу на checkout, поэтому:

```
customerPaidMinor = grossMinor + commissionMinor   -- столько заплатил покупатель
netMinor          = grossMinor                     -- столько получает мерчант
```

| Метод | Путь | Роли | Описание |
|---|---|---|---|
| PATCH | `/api/v1/merchants/me/payout-account` | MERCHANT | Указать счёт для выплат `{accountId}` |
| GET | `/api/v1/settlements?merchantId=&page=&size=` | MERCHANT / SUPPORT / ADMIN | Свои выплаты; оператор видит все или по мерчанту |
| GET | `/api/v1/settlements/{id}` | owner / оператор | Расчёт **и список платежей, которые он покрывает** |
| POST | `/api/v1/settlements/run` | ADMIN | Запустить расчёт сейчас (то же, что делает планировщик) |

```json
{
  "settlementId": "01M3...",
  "settlementNumber": "SET-240902-A1B2C",
  "merchantId": "01M3...",
  "status": "PAID",
  "currency": "KZT",
  "grossMinor": 100000, "commissionMinor": 1500, "customerPaidMinor": 101500,
  "netMinor": 100000, "paymentCount": 1,
  "payoutAccountId": "01M3...",
  "periodStart": "2024-09-01T10:00:00Z", "periodEnd": "2024-09-02T00:00:00Z",
  "createdAt": "2024-09-02T00:00:01Z", "paidAt": "2024-09-02T00:00:02Z",
  "failureReason": null
}
```

Состояния: `PENDING` (долг зафиксирован, платить пока некуда) → `PAID` | `FAILED`
(неудачная выплата повторяется, долг остаётся на балансе).

Продажа попадает в расчёт не сразу: есть `taxi.settlement.hold-period` (в
docker-compose для демо — `0s`, в реальности T+1 и больше), чтобы возврат успел
поглотиться до выплаты. События топика `settlement.events`: `settlement.created`,
`settlement.paid`, `settlement.failed`.

---

## 8. Поддержка — роль `SUPPORT`

Агент поддержки читает чужие данные, чтобы ответить на вопрос клиента. Это
единственный вид доступа, который **обязан** оставлять след, поэтому каждое
успешное чтение пишет строку в `support_audit_record` в той же транзакции: «данные
выданы» и «строка есть» — одно и то же событие. Неудачный поиск записи не оставляет.

| Метод | Путь | Роли | Описание |
|---|---|---|---|
| GET | `/api/v1/support/merchants/{merchantId}` | SUPPORT, ADMIN | Мерчант по id |
| GET | `/api/v1/support/merchants/by-owner/{userId}` | SUPPORT, ADMIN | Мерчант по владельцу |
| GET | `/api/v1/support/merchants/{id}/products` | SUPPORT, ADMIN | Товары мерчанта, включая черновики, с остатком и причиной недоступности |
| GET | `/api/v1/support/products/{id}` | SUPPORT, ADMIN | Товар |
| GET | `/api/v1/support/products/{id}/stock` | SUPPORT, ADMIN | Остаток и резервы, объясняющие `reserved` |
| GET | `/api/v1/support/reservations/{orderId}` | SUPPORT, ADMIN | Резерв стока по заказу |
| GET | `/api/v1/support/orders/{orderId}` | SUPPORT, ADMIN | Заказ с позициями и историей |
| GET | `/api/v1/support/orders/by-number/{number}` | SUPPORT, ADMIN | Заказ по номеру |
| GET | `/api/v1/support/orders?userId=&status=&page=&size=` | SUPPORT, ADMIN | Поиск заказов |
| GET | `/api/v1/support/orders/{orderId}/history` | SUPPORT, ADMIN | История статусов |
| GET | `/api/v1/support/audit/catalog?resourceType=&resourceId=` | ADMIN | Журнал доступа к данным каталога |
| GET | `/api/v1/support/audit/orders?resourceType=&resourceId=` | ADMIN | Журнал доступа к данным заказов |

Платежи поддержка смотрит обычными эндпоинтами `/api/v1/payments/**` — роль
`SUPPORT` там уже разрешена, отдельного API не нужно. Пути аудита сервис-специфичны
(`/audit/catalog`, `/audit/orders`), иначе один и тот же путь принадлежал бы двум
сервисам и шлюз не смог бы выбрать маршрут.

---

## 9. Внутренние API (не для клиентов)

Доступны только сервисам по заголовку `X-Internal-Token` (`taxi.internal.token`),
путь всегда содержит `/internal/`, шлюз их не маршрутизирует.

**account-service** — вызывается payment-service:

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/v1/accounts/internal/holds` | Зарезервировать деньги (идемпотентно по `idempotencyKey`) |
| POST | `/api/v1/accounts/internal/holds/{holdId}/capture` | Превратить резерв в движение |
| POST | `/api/v1/accounts/internal/holds/{holdId}/release` | Вернуть зарезервированное |
| GET | `/api/v1/accounts/internal/holds/{holdId}` | Состояние hold (для восстановления саги) |
| POST | `/api/v1/accounts/internal/credits` | Зачислить извне (возврат/выплата), идемпотентно по `(referenceType, referenceId)` |
| GET | `/api/v1/accounts/internal/resolve?phone&currency` | Найти счёт по телефону |
| GET | `/api/v1/accounts/internal/accounts/{id}` | Снимок счёта с резервами |

**catalog-service** — вызывается order-service (сток) и payment-service (выплаты):

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/v1/catalog/internal/stock/reservations` | Зарезервировать сток на заказ (идемпотентно по `orderId`) |
| POST | `/api/v1/catalog/internal/stock/reservations/{orderId}/commit` | Списать зарезервированное |
| POST | `/api/v1/catalog/internal/stock/reservations/{orderId}/release` | Снять резерв |
| GET | `/api/v1/catalog/internal/stock/reservations/{orderId}` | Состояние резерва |
| GET | `/api/v1/catalog/internal/products/{id}` | Снимок товара для проверки |
| GET | `/api/v1/catalog/internal/merchants/{merchantId}` | Владелец, название и счёт для выплат |

**payment-service** — вызывается order-service (восстановление саги):

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/v1/payments/internal/{paymentId}` | Платёж без пользовательского токена |
| GET | `/api/v1/payments/internal/by-order/{orderId}` | Платёж заказа без пользовательского токена |

---

## 10. Ошибки

Формат (RFC 7807 + расширения):

```json
{
  "type": "https://docs.taxi.local/errors/INSUFFICIENT_FUNDS",
  "title": "Unprocessable Entity",
  "status": 422,
  "detail": "account 01J8... has 500.00 KZT available but 1500.00 KZT is required",
  "code": "INSUFFICIENT_FUNDS",
  "instance": "/api/v1/payments/transfers",
  "correlationId": "01J8ZCQ7Y4R3F0N5G8K2M9QW1T",
  "timestamp": "2024-09-01T10:15:30Z",
  "details": {"accountId": "01J8...", "availableMinor": 50000, "requiredMinor": 150000},
  "errors": [{"field": "amountMinor", "message": "amountMinor must be positive", "rejectedValue": -1}]
}
```

Коды, которые встречаются чаще всего:

| Код | HTTP | Когда |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Тело/параметры не прошли валидацию |
| `UNAUTHORIZED` | 401 | Нет или протух токен (в т.ч. отсутствует `X-Internal-Token`) |
| `FORBIDDEN` | 403 | Роль не позволяет / ресурс принадлежит другому |
| `ACCOUNT_NOT_FOUND`, `PAYMENT_NOT_FOUND`, `ORDER_NOT_FOUND`, `PRODUCT_NOT_FOUND` | 404 | Объекта нет |
| `DRIVER_NOT_FOUND` | 404 | У пользователя нет профиля водителя |
| `DRIVER_DOCUMENTS_INCOMPLETE` | 422 | Выход на линию без обязательных документов |
| `DRIVER_DOCUMENT_EXPIRED` | 422 | Обязательный документ просрочен |
| `DRIVER_ALREADY_ON_DUTY` | 409 | Повторный выход на линию |
| `DRIVER_ALREADY_ON_TRIP`, `DRIVER_ON_TRIP` | 409 | У водителя уже есть активная поездка / он не может уйти с линии во время поездки |
| `INSUFFICIENT_FUNDS` | 422 | Не хватает доступных денег |
| `LIMIT_EXCEEDED` | 422 | Превышен дневной/месячный лимит счёта |
| `VELOCITY_EXCEEDED` | 422 | Слишком много операций за короткое время |
| `INSUFFICIENT_STOCK` | 409 | Товара не хватает |
| `HOLD_NOT_ACTIVE`, `HOLD_EXPIRED` | 409 | Резерв уже захвачен/снят/истёк |
| `ORDER_NOT_CANCELLABLE` | 409 | Заказ уже оплачен |
| `IDEMPOTENCY_CONFLICT` | 409 | Тот же `Idempotency-Key`, другое тело |
| `CONFLICT` | 409 | Запрос с этим ключом ещё выполняется |
| `RATE_LIMITED` | 429 | Превышен лимит шлюза |
| `SERVICE_UNAVAILABLE`, `DOWNSTREAM_UNAVAILABLE` | 503 | Соседний сервис недоступен; операция не выполнена |
| `INTERNAL_ERROR` | 500 | Непредвиденное; текст ошибки наружу не отдаётся, в ответе есть `correlationId` |

Клиент должен ориентироваться на `code`, а `detail` показывать человеку. При 5xx
всегда показывайте `correlationId` — по нему поддержка найдёт все логи запроса.
