# Taxi — платформа сервиса такси

Платформа райд-хейлинга: **заявки и поездки, водители с действующими документами,
диспетчерская с живой картой, деньги пассажира в честном леджжере**. Монорепозиторий:
микросервисы на Java 17 / Spring Boot, React-фронтенд, нативный Android-клиент и
локальная инфраструктура в docker-compose.

Проект не начинался с нуля: он вырос из проверенной платформы супер-аппа с двойной
записью в леджжере, идемпотентностью на уровне БД, транзакционным outbox и сагами.
Маркетплейс-вертикаль (витрина, корзина, заказ, расчёты с мерчантами) осталась в
репозитории **замороженной**: её e2e продолжают проходить и служат доказательством,
что денежный контур не привязан к одной предметной области.

**Состояние работ (Ф0 — каркас, Ф1 — геопозиции и живая карта):**

| Готово | Где |
|---|---|
| Решения по такси: сервисы, real-time, матчинг, гео, деньги поездки | `docs/adr/0009-taxi-vertical.md` |
| Роли `DRIVER` и `DISPATCHER` в текущей модели JWT | `platform/common-security-core/.../Roles.java` |
| Топики `trip.events`, `driver.events`, `dispatch.events` (+ DLT) | `platform/common-kafka/.../KafkaTopics.java` |
| Роуты шлюза под `/api/v1/trips`, `/api/v1/drivers`, `/api/v1/locations`, `/api/v1/dispatch` | `services/api-gateway/src/main/resources/application.yml` |
| PostGIS и базы `taxi_trip`, `taxi_driver`, `taxi_dispatch` | `infra/postgres/init/01-databases.sql` |
| `driver-service`: профиль водителя, документы со сроком, выход на линию | `services/driver-service` |
| `dispatch-service`: приём геопозиций, Redis GEO, поиск кандидатов, живая карта (`/dispatch`) | `services/dispatch-service` |
| Симулятор парка: 7 машин едут по Алматы и присылают позиции | `scripts/simulate-fleet.ps1` |
| Сквозные сценарии: выход на линию (33 проверки) и диспетчерская (40 проверок) | `scripts/e2e-driver-duty.ps1`, `scripts/e2e-dispatch.ps1` |

### Живая карта диспетчера

![Карта водителей на линии](docs/img/dispatch-live-map.png)

Скриншот сделан на живом стеке: позиции присылает `scripts/simulate-fleet.ps1`,
`dispatch-service` кладёт их в Redis GEO, страница `/dispatch` опрашивает
`/api/v1/dispatch/drivers` раз в 2 секунды. Посмотреть самому:

```powershell
docker compose --profile app up -d --build      # стек
.\scripts\simulate-fleet.ps1 -Drivers 7         # машины поехали (30 минут)

cd web; pnpm install; pnpm dev                  # http://localhost:5173/dispatch
```

На странице нужна роль диспетчера: если её нет, есть кнопка «Получить токен
диспетчера» (dev-стенд выдаёт токен с ролью `DISPATCHER`).

Дальше по плану: поездка и деньги (Ф2), автоматический матчинг (Ф3), клиенты
пассажира и водителя (Ф4). Полный план с оценками, рисками и критериями готовности —
[`docs/taxi-roadmap.md`](docs/taxi-roadmap.md).

```
                        ┌───────────────────────────────┐
   React/TS (5173) ───► │  api-gateway (8080)           │  JWT, rate limit, корреляция
   Android (10.0.2.2)   └───────┬───────────────────────┘
        ┌──────────────┬────────┴───────┬────────────────┬────────────────┬──────────────┐
        ▼              ▼                ▼                ▼                ▼              ▼
  account-service  payment-service  catalog-service  order-service  driver-service  dispatch-service
      (8081)          (8082)           (8083)          (8084)          (8085)          (8087)
   счета+леджер    платежи+сага     товары+сток     корзина+заказ    водители+смены  геопозиции+поиск
        │              │                │                │                │              │
        └──────────────┴──── Kafka (outbox) ─────────────┴────────────────┘              │
                                                                          driver.events ─┘
        Postgres + PostGIS          Redis          Prometheus/actuator

   План: trip-service (8086) — поездка и деньги.
```

---

## Быстрый старт

### 1. Всё одной командой

```powershell
.\scripts\dev-up.ps1            # инфраструктура в Docker + сервисы на хосте
.\scripts\smoke-test.ps1        # платформа: счёт, леджер, Kafka, RFC 7807
.\scripts\e2e-driver-duty.ps1   # такси: водитель с документами выходит на линию
.\scripts\e2e-dispatch.ps1      # такси: позиция доходит до карты и до поиска кандидатов
.\scripts\simulate-fleet.ps1    # такси: парк машин едет по Алматы (для карты)
.\scripts\e2e-marketplace.ps1   # (заморожено) покупка: витрина -> корзина -> PAID
.\scripts\e2e-settlement.ps1    # (заморожено) продавец -> продажа -> выплата
.\scripts\dev-down.ps1          # остановить сервисы (-WithInfra — ещё и контейнеры)
```

`smoke-test.ps1` проверяет не «отвечает 200», а инварианты: идемпотентность открытия
счёта, корректность баланса, формат ошибок RFC 7807 с `correlationId`, доставку событий
через outbox и сбалансированность леджера.

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
.\mvnw.cmd -pl services/driver-service  spring-boot:run         # http://localhost:8085

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

### 5. Первый сценарий такси за минуту

```powershell
# 1) водитель получает токен с ролью DRIVER (dev-identity: любой телефон + код 0000)
$token = (Invoke-RestMethod -Method Post http://localhost:8080/api/v1/auth/token `
  -ContentType 'application/json' `
  -Body '{"phone":"+77001234567","code":"0000","displayName":"Айдар","roles":["DRIVER"]}').accessToken
$h = @{ Authorization = "Bearer $token" }

# 2) профиль водителя
Invoke-RestMethod -Method Post http://localhost:8080/api/v1/drivers -Headers $h `
  -ContentType 'application/json' -Body '{"displayName":"Айдар"}'

# 3) без документов на линию не пустят: 422 DRIVER_DOCUMENTS_INCOMPLETE
try {
  Invoke-RestMethod -Method Post http://localhost:8080/api/v1/drivers/me/status -Headers $h `
    -ContentType 'application/json' -Body '{"status":"ONLINE"}'
} catch { "отказано: $($_.ErrorDetails.Message)" }

# 4) документы (права, техосмотр, медосмотр) со сроком действия
$expires = (Get-Date).ToUniversalTime().AddYears(1).ToString('yyyy-MM-ddTHH:mm:ssZ')
foreach ($kind in 'DRIVING_LICENCE','VEHICLE_INSPECTION','MEDICAL_CHECK') {
  Invoke-RestMethod -Method Post http://localhost:8080/api/v1/drivers/me/documents -Headers $h `
    -ContentType 'application/json' -Body (@{ kind = $kind; expiresAt = $expires } | ConvertTo-Json)
}

# 5) выход на линию
Invoke-RestMethod -Method Post http://localhost:8080/api/v1/drivers/me/status -Headers $h `
  -ContentType 'application/json' -Body '{"status":"ONLINE"}'

# 6) событие ушло в Kafka через outbox — его и ждёт диспетчерская
docker exec taxi-kafka /opt/kafka/bin/kafka-console-consumer.sh `
  --bootstrap-server localhost:9092 --topic driver.events --from-beginning --max-messages 1
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
  driver-service          водители, авто, документы со сроком, выход на линию
  dispatch-service        приём геопозиций (Redis GEO), проекция парка, поиск кандидатов
  account-service         счета, двойная запись, holds          <- деньги пассажира
  payment-service         переводы и платежи, сага, выплаты      <- оплата и расчёты
  catalog-service         мерчанты, товары, сток (заморожено)
  order-service           корзина, заказ, checkout-сага (заморожено)
web/                      React 19 + TypeScript + Vite (в т.ч. живая карта /dispatch)
mobile/android/           нативный клиент: Kotlin + Jetpack Compose
infra/                    init-скрипты Postgres (включая PostGIS)
scripts/                  dev-up / dev-down / smoke-test / e2e-driver-duty / e2e-dispatch /
                          simulate-fleet / e2e-marketplace / e2e-settlement
docs/                     архитектура, API, ADR, план такси, мобильный клиент
```

---

## Проверено на живом стеке

```
mvnw clean install                     -> BUILD SUCCESS, 636 unit-тестов, 0 падений
                                          (platform 105, gateway 20, account 61, payment 116,
                                           catalog 109, order 178, driver 28, dispatch 19)
scripts/smoke-test.ps1                 -> платформа: счёт, леджер, Kafka, RFC 7807
scripts/e2e-driver-duty.ps1            -> такси: 33 проверки, водитель выходит на линию,
                                          событие driver.online в Kafka, инварианты в БД
scripts/e2e-dispatch.ps1               -> такси: 40 проверок, позиция -> проекция -> карта
                                          и поиск; событие driver.online дошло за 277 мс
                                          (критерий Ф1: меньше секунды)
scripts/e2e-marketplace.ps1            -> (заморожено) покупка: витрина -> корзина -> PAID
scripts/e2e-settlement.ps1             -> (заморожено) продавец -> продажа -> выплата
web: pnpm build && pnpm test           -> сборка без ошибок TS, 21 тест
web: pnpm e2e                          -> 14 браузерных сценариев (Playwright, chromium)
mobile/android: gradlew testDebugUnitTest "-Dtaxi.liveTest=true"
                                       -> 42 теста, 0 падений, из них 4 — против живого шлюза
эмулятор Android 14 (x86_64)           -> вход, перевод 250 ₸ из UI, покупка из UI -> заказ PAID

docker compose --profile app up -d --build
  -> 10 контейнеров healthy (включая taxi-driver-service и taxi-dispatch-service), PostGIS 3.4.3
  -> все сценарии прогнаны повторно уже против контейнерного стека
```

Что именно проверяет сценарий диспетчерской (`scripts/e2e-dispatch.ps1`):

* **путь события целиком**: выход на линию → `driver.events` → проекция в dispatch →
  приём позиции. Замеряется время (277 мс при цели «меньше секунды»), потому что это и
  есть критерий готовности Ф1;
* **карта и поиск отвечают согласованно**: водитель есть и в `/dispatch/drivers`, и в
  `/dispatch/nearest`, и в самом Redis GEO (`GEOSEARCH` возвращает его же);
* **устаревшая позиция**: видна на карте с `stale=true`, но кандидатом на поездку не
  становится — диспетчеру показываем, пассажиру не обещаем;
* **уход с линии**: проекция обновляется по `driver.offline`, позиция удаляется из Redis
  (координаты не хранятся после смены), а новые позиции от неработающего водителя
  отклоняются с `409 DRIVER_NOT_ON_DUTY`;
* **мусор не попадает в индекс**: невозможные координаты, радиус больше разрешённого и
  слишком большой батч отклоняются с `400` и своими кодами;
* **доступ**: обычный клиент не видит парк (`403 FORBIDDEN_FLEET_ACCESS`), аноним — `401`.

Что именно проверяет сценарий такси (`scripts/e2e-driver-duty.ps1`):

* **документы — это правило, а не поле**: выход на линию без прав, техосмотра или
  медосмотра → `422 DRIVER_DOCUMENTS_INCOMPLETE`, и статус в БД не меняется;
* **истёкший документ равен отсутствующему**: проверка идёт по дате, а не по факту загрузки;
* **одно состояние на водителя**: повторный выход на линию → `409 DRIVER_ALREADY_ON_DUTY`,
  а `status=BUSY` от клиента → `400` (занятость выставляет только диспетчер);
* **события доезжают**: `driver.online` публикуется через outbox (строка `PUBLISHED`)
  и увеличивает end-offset топика `driver.events`;
* **чужой профиль недоступен**: в API водителя нет `/drivers/{id}` вообще, а без токена → 401;
* **инварианты БД**: один профиль на пользователя, три документа, outbox без `PENDING`.

> Интеграционные тесты (`*IT`, Testcontainers) в CI запускаются, но **пока падают** —
> это известный незакрытый пункт, а не «зелёная галочка». Локально их прогнать нельзя:
> `docker-java` (в отличие от CLI) получает от Docker Desktop пустой `DockerInfo` со всех
> именованных каналов (`docker_engine`, `dockerDesktopLinuxEngine`, `docker_cli` —
> `ServerVersion` пустой, `NCPU: 0`), и Testcontainers отказывается работать, оставляя
> тесты в статусе `Skipped`. Именно поэтому 16 сценариев `*IT` пока не проверены
> вообще нигде. Прогресс этой задачи виден по джобе `Integration tests` в Actions.

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
| Право выйти на линию | Документы со сроком действия + правило в агрегате, а не в контроллере | `driver-service/.../DriverDuty.java` |
| Стейт-машина водителя | `OFFLINE → ONLINE → BUSY → ONLINE`, невозможные переходы запрещены | `driver-service/.../Driver.java` |
| Геоиндекс | `GEOSEARCH` по Redis GEO вместо перебора машин в Java; позиция с TTL — пропавший водитель исчезает сам | `dispatch-service/.../DriverLocationStore.java` |
| Проекция из событий | Диспетчерская не спрашивает соседа «кто на линии»: строит ответ из `driver.events`, включая имя и телефон | `dispatch-service/.../FleetService.java` |
| Разные ответы на разные вопросы | Карта показывает и «замолчавших» (stale, флагом), а кандидатов на поездку — только свежих и свободных | `dispatch-service/.../FleetService.java` |
| Геоданные | PostGIS 3.4 для треков и геозон, Redis — для горячего поиска | `infra/postgres/init/01-databases.sql` |
| Сток | Резервирование (ACTIVE → COMMITTED/RELEASED) вместо декремента | `catalog-service/.../V1__init_catalog.sql` |
| Сага checkout | Оркестратор в order-service + асинхронное доразбирательство по Kafka | `order-service/.../CheckoutSagaService.java` |
| Расчёты с мерчантами | Долг (`PENDING`) и выплата (`PAID`) как разные факты; та же механика пойдёт на выплаты водителям | `payment-service/.../SettlementStateService.java` |
| Лимиты и антифрод | Дневной/месячный лимит на счёт + проверка скорости операций; отказ происходит **до** резервирования денег | `account-service/.../AccountLimitGuard.java` |
| Поддержка и аудит | Роль `SUPPORT` читает чужие данные, и **каждое** чтение оставляет строку в `support_audit_record` в той же транзакции | `catalog-service/.../SupportAuditService.java` |
| Наблюдаемость продукта | Бизнес-метрики `taxi.<домен>.<факт>`: долг перед мерчантами, неопубликованные события, отказы по документам | `payment-service/.../PaymentMetrics.java` |
| Сверка данных | Фоновый job проверяет инварианты леджера и расчётов; находки — в лог и метрику, но не «чинятся» автоматически | `payment-service/.../PaymentReconciliationService.java` |
| Безопасность | Stateless JWT, роли, 401/403 в том же problem-формате | `platform/common-security` |
| Service-to-service | `X-Internal-Token` + фильтр на путях `/internal/` | `platform/common-security/.../InternalApiTokenFilter.java` |
| Наблюдаемость | Actuator + Prometheus, health-пробы, структурные логи | `*/application.yml` |

---

## Документация

* [`docs/taxi-roadmap.md`](docs/taxi-roadmap.md) — план работ по такси: фазы, риски, оценки
* [`docs/adr/0009-taxi-vertical.md`](docs/adr/0009-taxi-vertical.md) — ключевые решения по такси
* [`docs/architecture.md`](docs/architecture.md) — границы сервисов, потоки данных, саги
* [`docs/api.md`](docs/api.md) — эндпоинты, коды ошибок, примеры
* [`docs/adr/`](docs/adr/) — остальные принятые решения и их альтернативы
* [`docs/development.md`](docs/development.md) — окружение, тесты, отладка
* [`docs/mobile.md`](docs/mobile.md) — нативный Android-клиент: сборка, эмулятор, живые тесты

## Требования

JDK 17+ (проверено на Temurin 17), Docker Desktop, Node 20+ и pnpm 9+ для web.
Maven устанавливать не нужно — в репозитории есть wrapper (`mvnw`).
