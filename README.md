# Taxi — fintech super-app platform

Платформа супер-аппа в духе Kaspi.kz: **счета и переводы, платежи, маркетплейс с
корзиной и оформлением заказа**. Монорепозиторий с микросервисами на Java 17 /
Spring Boot, React-фронтендом и локальной инфраструктурой в docker-compose.

Цель проекта — не «ещё один CRUD», а честная демонстрация того, как устроены
денежные системы: двойная запись в леджере, идемпотентность на уровне БД,
транзакционный outbox вместо dual-write, саги с компенсациями и consumer dedup.

```
                        ┌──────────────────────────────┐
   React/TS (5173) ───► │  api-gateway (8080)          │  JWT, rate limit, корреляция
                        └───────┬──────────────────────┘
        ┌───────────────┬───────┴────────┬────────────────┐
        ▼               ▼                ▼                ▼
  account-service  payment-service  catalog-service  order-service
      (8081)           (8082)           (8083)          (8084)
   счета+леджер     платежи+сага    товары+сток      корзина+заказ
        │               │                │                │
        └───────────────┴──── Kafka (outbox) ─────────────┴────► account/ledger/...
        Postgres         Postgres         Postgres         Postgres      Redis
```

---

## Быстрый старт

### 1. Всё одной командой

```powershell
.\scripts\dev-up.ps1          # инфраструктура в Docker + все 5 сервисов на хосте
.\scripts\smoke-test.ps1      # платформа: счёт, леджер, Kafka, RFC 7807
.\scripts\e2e-marketplace.ps1 # покупка: витрина -> корзина -> checkout -> PAID
.\scripts\e2e-settlement.ps1  # продавец -> продажа -> выплата мерчанту
.\scripts\dev-down.ps1        # остановить сервисы (-WithInfra — ещё и контейнеры)
```

`dev-up.ps1` поднимает Postgres, Kafka и Redis, ждёт их готовности, запускает сервисы
в фоне (логи — `.tools\logs\*.log`) и дожидается их health-проверок.
`smoke-test.ps1` проверяет не «отвечает 200», а инварианты: идемпотентность открытия
счёта, корректность баланса, формат ошибок RFC 7807 с `correlationId`, доставку
событий через outbox и сбалансированность леджера.

### 2. Вручную (если хочется видеть каждый шаг)

```powershell
docker compose up -d postgres kafka redis
# опционально: UI для Kafka на http://localhost:8090
docker compose --profile tools up -d

.\mvnw.cmd clean install                                        # сборка + тесты

.\mvnw.cmd -pl services/api-gateway     spring-boot:run         # http://localhost:8080
.\mvnw.cmd -pl services/account-service spring-boot:run         # http://localhost:8081
.\mvnw.cmd -pl services/payment-service spring-boot:run         # http://localhost:8082
.\mvnw.cmd -pl services/catalog-service spring-boot:run         # http://localhost:8083
.\mvnw.cmd -pl services/order-service   spring-boot:run         # http://localhost:8084

# либо всё в контейнерах
docker compose --profile app up -d --build
```

### 3. Web

```powershell
cd web
pnpm install
pnpm dev      # http://localhost:5173
```

### 4. Android

```powershell
cd mobile\android
.\gradlew.bat assembleDebug        # app\build\outputs\apk\debug\app-debug.apk

# эмулятор: 10.0.2.2 — это loopback машины-разработчика изнутри эмулятора
& "$env:ANDROID_HOME\emulator\emulator.exe" -avd taxi
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r app\build\outputs\apk\debug\app-debug.apk
```

Нативный клиент на Kotlin + Jetpack Compose ходит в тот же шлюз с теми же контрактами
(RFC 7807, обязательный `Idempotency-Key`, роли, деньги в минорных единицах).
Для физического устройства: `adb reverse tcp:8080 tcp:8080`.
Подробности и таблица адресов — в `docs/mobile.md`.

### 5. Первый сценарий за 60 секунд

```powershell
# 1) токен (dev-identity: любой телефон + код 0000)
$token = (Invoke-RestMethod -Method Post http://localhost:8080/api/v1/auth/token `
  -ContentType 'application/json' `
  -Body '{"phone":"+77001234567","code":"0000","displayName":"Aisha","roles":["CUSTOMER","ADMIN"]}').accessToken

$h = @{ Authorization = "Bearer $token" }

# 2) счёт
$acc = Invoke-RestMethod -Method Post http://localhost:8080/api/v1/accounts -Headers $h `
  -ContentType 'application/json' -Body '{"currency":"KZT","type":"CUSTOMER"}'

# 3) пополнение (демо-эндпоинт оператора)
Invoke-RestMethod -Method Post "http://localhost:8080/api/v1/accounts/$($acc.id)/top-up" -Headers $h `
  -ContentType 'application/json' -Body '{"amountMinor":500000,"reason":"demo funds"}'

# 4) перевод: ключ идемпотентности обязателен
$transferHeaders = @{ Authorization = "Bearer $token"; 'Idempotency-Key' = [guid]::NewGuid().ToString() }
Invoke-RestMethod -Method Post http://localhost:8080/api/v1/payments/transfers -Headers $transferHeaders `
  -ContentType 'application/json' `
  -Body (@{ sourceAccountId = $acc.id; targetPhone = '+77009998877'; amountMinor = 150000;
             currency = 'KZT'; description = 'обед' } | ConvertTo-Json)
```

Swagger UI: <http://localhost:8080/swagger-ui.html> (агрегирует все сервисы).
Проверить, что всё живо: `.\scripts\smoke-test.ps1`.

---

## Структура репозитория

```
platform/                 общие библиотеки (не сервисы)
  common-core             деньги, ULID, ошибки, события — без Spring
  common-web              RFC 7807, correlation id, идемпотентность, OpenAPI
  common-security-core    JWT: выпуск, валидация, роли, principal
  common-security         servlet-конфигурация безопасности (stateless)
  common-kafka            outbox, consumer dedup, топики, DLT
services/
  api-gateway             WebFlux-шлюз: токены, роутинг, rate limit
  account-service         счета, двойная запись, holds
  payment-service         переводы и платежи, сага, рефанды
  catalog-service         мерчанты, товары, сток с резервированием
  order-service           корзина, заказ, checkout-сага
web/                      React 19 + TypeScript + Vite
mobile/android/           нативный клиент: Kotlin + Jetpack Compose
infra/                    init-скрипты Postgres
scripts/                  dev-up / dev-down / smoke-test / e2e-marketplace
docs/                     архитектура, API, ADR
```

---

## Проверено на живом стеке

```
mvnw clean install                     -> BUILD SUCCESS, 505 unit-тестов, 0 падений
                                          (platform 105, gateway 20, account 61, payment 116, catalog 109, order 178)
scripts/smoke-test.ps1                 -> платформа: счёт, леджер, Kafka, RFC 7807
scripts/e2e-marketplace.ps1            -> покупка: витрина -> корзина -> checkout -> PAID
scripts/e2e-settlement.ps1             -> продавец -> продажа -> выплата мерчанту
web: pnpm build && pnpm test           -> сборка без ошибок TS, 16 тестов
web: pnpm e2e                          -> 14 браузерных сценариев (Playwright, chromium)
mobile/android: gradlew testDebugUnitTest "-Dtaxi.liveTest=true"
                                       -> 42 теста, 0 падений, из них 4 — против живого шлюза
                                          (Money 12, PhoneNumbers 5, ApiErrorMapper 15,
                                           IdempotencyKeyHolder 6, live 4)
эмулятор Android 14 (x86_64)           -> вход, перевод 250 ₸ из UI (P01M3W5ECJ2V9D6W04MR80JJJ5J),
                                          покупка из UI -> заказ ORD-261001-00036 (PAID)

docker compose --profile app up -d --build
  -> 5 образов собраны, все контейнеры healthy
  -> все сценарии прогнаны повторно уже против контейнерного стека
```

Сквозной сценарий (`scripts/e2e-marketplace.ps1`) проходит через публичный API шлюза:
вход по телефону → счёт → демо-пополнение → анонимная витрина → корзина → checkout →
резерв стока у catalog-service → платёж мерчанту в payment-service (hold → capture в
account-service) → заказ `PAID`. Проверяется в том числе:

* **деньги**: списано ровно `amount + fee` (комиссия 1.5% считается в базисных пунктах);
* **идемпотентность**: повтор checkout с тем же `Idempotency-Key` возвращает тот же
  заказ, а не создаёт второй;
* **анонимность витрины**: `GET /api/v1/catalog/products` без токена → 200,
  при этом `GET /api/v1/orders` без токена → 401;
* **инварианты БД**: баланс каждого счёта равен сумме его проводок, каждая транзакция
  леджера сбалансирована (Σ = 0), outbox пуст по `PENDING`, резерв стока `COMMITTED`;
* **трассировка**: один `correlationId` объединяет события `order.created`, `order.paid`,
  `payment.initiated`, `payment.completed` и записи в логах всех трёх сервисов.

Проверка платформы отдельно: `scripts/smoke-test.ps1` (счёт, леджер, RFC 7807,
доставка событий через outbox, инварианты).

> Интеграционные тесты (`*IT`, Testcontainers) написаны и компилируются, но в этом
> окружении не запускались: Java-клиент Testcontainers не может достучаться до
> Docker-демона (CLI работает, `docker-java` получает непригодный endpoint).
> На машине с обычным Docker-сокетом — `.\mvnw.cmd verify -Pintegration`.

---

## Что здесь сделано «по-взрослому»

| Тема | Решение | Где смотреть |
|---|---|---|
| Деньги | `BIGINT` в минорных единицах + `Money` с проверкой валюты | `platform/common-core/.../Money.java` |
| Идемпотентность | `Idempotency-Key` + Redis SETNX + уникальный индекс в БД | `platform/common-web/.../IdempotencyGuard.java` |
| Согласованность | Транзакционный outbox + relay с `SKIP LOCKED` | `platform/common-kafka/.../OutboxRelay.java` |
| Дубли в Kafka | Consumer dedup по `eventId` в Redis | `platform/common-kafka/.../IdempotentEventHandler.java` |
| Ошибки | Единый RFC 7807 с машинным `code` и `correlationId` | `platform/common-web/.../GlobalExceptionHandler.java` |
| Трассировка | Один id: HTTP → MDC → Kafka header → логи сервиса | `CorrelationContext` |
| Деньги в БД | Append-only леджер, баланс — проекция; CHECK-инварианты | `account-service/.../V1__init_accounts.sql` |
| Сток | Резервирование (ACTIVE → COMMITTED/RELEASED) вместо декремента | `catalog-service/.../V1__init_catalog.sql` |
| Сага checkout | Оркестратор в order-service + асинхронное доразбирательство по Kafka | `order-service/.../CheckoutSagaService.java` |
| Раздельные платежи | Корзина с товарами нескольких мерчантов оплачивается по платежу на каждого; частичный успех компенсируется возвратами | `order-service/.../MerchantAllocation.java` |
| Расчёты с мерчантами | Долг (`PENDING`) и выплата (`PAID`) как разные факты; сумма выплаты = стоимость товаров, комиссия остаётся платформе | `payment-service/.../SettlementStateService.java` |
| Лимиты и антифрод | Дневной/месячный лимит на счёт + проверка скорости операций; отказ происходит **до** резервирования денег | `account-service/.../AccountLimitGuard.java` |
| Поддержка и аудит | Роль `SUPPORT` читает чужие данные, и **каждое** чтение оставляет строку в `support_audit_record` в той же транзакции | `catalog-service/.../SupportAuditService.java` |
| Наблюдаемость продукта | Бизнес-метрики `taxi.<домен>.<факт>`: долг перед мерчантами, неопубликованные события, причины отказов платежей | `payment-service/.../PaymentMetrics.java` |
| Сверка данных | Фоновый job проверяет инварианты леджера и расчётов; находки — в лог и метрику, но не «чинятся» автоматически | `payment-service/.../PaymentReconciliationService.java` |
| Безопасность | Stateless JWT, роли, 401/403 в том же problem-формате | `platform/common-security` |
| Service-to-service | `X-Internal-Token` + фильтр на путях `/internal/` | `platform/common-security/.../InternalApiTokenFilter.java` |
| Наблюдаемость | Actuator + Prometheus, health-пробы, структурные логи | `*/application.yml` |

---

## Документация

* [`docs/architecture.md`](docs/architecture.md) — границы сервисов, потоки данных, саги
* [`docs/api.md`](docs/api.md) — эндпоинты, коды ошибок, примеры
* [`docs/adr/`](docs/adr/) — принятые решения и их альтернативы
* [`docs/development.md`](docs/development.md) — окружение, тесты, отладка
* [`docs/mobile.md`](docs/mobile.md) — нативный Android-клиент: сборка, эмулятор, живые тесты
* [`docs/taxi-roadmap.md`](docs/taxi-roadmap.md) — план превращения платформы в сервис такси

## Требования

JDK 17+ (проверено на Temurin 17), Docker Desktop, Node 20+ и pnpm 9+ для web.
Maven устанавливать не нужно — в репозитории есть wrapper (`mvnw`).
