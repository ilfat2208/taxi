# Разработка: окружение, конвенции, тесты

Документ обязателен к прочтению перед изменением любого сервиса: здесь зафиксированы
контракты платформы и правила, которые делают поведение всех сервисов одинаковым.

---

## 1. Окружение и команды

```powershell
# инфраструктура
docker compose up -d postgres kafka redis          # + tools: Kafka UI на :8090
docker compose --profile app up -d --build         # все сервисы в контейнерах

# сборка
.\mvnw.cmd clean install              # весь реактор + unit-тесты (без Docker)
.\mvnw.cmd -pl services/account-service test        # один сервис
.\mvnw.cmd verify -Pintegration        # + интеграционные тесты (*IT, Testcontainers)

# запуск сервиса локально
.\mvnw.cmd -pl services/account-service spring-boot:run
```

Maven устанавливать не нужно: в репозитории есть wrapper (`mvnw`, `mvnw.cmd`).
Требуется JDK 17 и запущенный Docker Desktop (для инфраструктуры и `*IT`).

---

## 2. Структура модуля

```
services/<name>-service/
  pom.xml                     зависимости (платформенные модули + spring-boot-starter-*)
  src/main/java/kz/taxi/<name>/
    <Name>ServiceApplication.java
    api/                      контроллеры, DTO (records), мапперы запросов
    application/              use-case сервисы (@Transactional), оркестрация
    domain/                   сущности, value objects, доменные сервисы, ErrorCode
    infrastructure/           Spring Data репозитории, клиенты других сервисов,
                              Kafka-листенеры, конфигурация
  src/main/resources/
    application.yml
    db/migration/V*__*.sql    Flyway
  src/test/java/...           *Test — быстрые unit-тесты, *IT — Testcontainers
```

Правила слоёв:

* контроллер не содержит бизнес-логики и не открывает транзакцию;
* `@Transactional` — только на методах application-слоя;
* доменный слой не знает про Spring (кроме `jakarta.persistence` в сущностях);
* сущности не покидают сервис: наружу отдаются DTO-records.

---

## 3. API платформы (что уже готово и протестировано)

### `common-core` — без Spring

| Класс | Назначение |
|---|---|
| `Money` | `Money.of(major, Currency)`, `ofMinor(minor, Currency)`, `plus/minus/multiply/percentage(bp)`, `isPositive()`, `toBigDecimal()`, `compareTo`. Бросает `CurrencyMismatchException` при смешивании валют |
| `Currency` | `KZT, USD, EUR, RUB`, `scale()`, `minorFactor()`, `Currency.of("kzt")` |
| `ErrorCode` | интерфейс: `code()`, `httpStatus()`, `defaultMessage()` |
| `CommonErrorCode` | `VALIDATION_FAILED, BAD_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, IDEMPOTENCY_CONFLICT, PRECONDITION_FAILED, RATE_LIMITED, SERVICE_UNAVAILABLE, INTERNAL_ERROR` |
| `DomainException` | `of(code, "msg {}", arg)`, `notFound/conflict/validation/forbidden/unauthorized/unavailable`, `.withDetail(k, v)`. Без stack trace |
| `Preconditions` | `check`, `requireNotNull`, `requireText`, `requirePositive`, `requireNotNegative` |
| `Ulid` | `Ulid.nextId()` → 26 символов, сортируемый по времени |
| `EventEnvelope<T>` | `EventEnvelope.of(eventType, aggregateType, aggregateId, version, payload)`, `.causedBy(id)`, `partitionKey()` |
| `CorrelationContext` | `get()`, `getOrCreate()`, `runWith(id, runnable)`, `HEADER = "X-Correlation-Id"` |
| `PageResponse<T>` | `PageResponse.of(items, page, size, totalElements)` |
| `OutboxStatus` | `PENDING, PUBLISHED, FAILED` |

### `common-web` — REST-слой (подключается автоматически)

* `GlobalExceptionHandler` — превращает `DomainException` в RFC 7807 (`ApiProblem`) с полями
  `type, title, status, detail, code, instance, correlationId, timestamp, details, errors`.
  Незарегистрированные исключения → 500 без утечки текста ошибки.
* `CorrelationIdFilter` — берёт/генерирует `X-Correlation-Id`, кладёт в MDC, возвращает в ответе.
* `IdempotencyGuard`:
  ```java
  IdempotencyOutcome<T> execute(String key, Object requestBody, Class<T> type, Supplier<T> action)
  IdempotencyOutcome<T> execute(String key, Object requestBody, JavaType type, Supplier<T> action)
  static String IdempotencyGuard.requireKey()   // читает заголовок Idempotency-Key
  ```
  Повтор с тем же телом → отдаётся сохранённый ответ (`outcome.replayed() == true`),
  то же тело+ключ в полёте → 409, другое тело → `IDEMPOTENCY_CONFLICT`, ошибка действия → ключ освобождается.
* `IdempotencyProperties` — `taxi.idempotency.*` (`store: redis|memory`, `ttl`, `header-name`).
* OpenAPI настраивается сам (`springdoc`), bearer-схема объявлена.

### `common-security-core` / `common-security`

* `SecurityProperties` (`taxi.security.*`): `jwt-secret`, `jwt-ttl`, `issuer`, `roles-claim`, `cors-allowed-origins`, `public-paths`.
* `Roles`: `CUSTOMER, MERCHANT, SUPPORT, ADMIN`.
* `AuthenticatedUser`: `userId()`, `phone()`, `roles()`, `hasRole()`, `isAdmin()`, `canAccess(ownerUserId)`.
* `CurrentUser` (bean): `require()`, `optional()`, `requireUserId()`, `requireAccessTo(ownerUserId)`.
* `ServletSecurityAutoConfiguration`: stateless JWT, `@EnableMethodSecurity`, CORS, 401/403 в problem+json.
  Публичные пути по умолчанию: actuator, swagger, `/v3/api-docs/**`.
* `InternalApiTokenFilter`: защищает пути, содержащие `/internal/`, заголовком `X-Internal-Token`
  (`taxi.internal.token`). Публичный шлюз такие пути не маршрутизирует.
* `OutboundAuthForwardingInterceptor` (регистрируется через `RestClientCustomizer`): на каждый
  исходящий вызов добавляет `Authorization` (токен пользователя), `X-Correlation-Id` и `X-Internal-Token`.
* `SecurityExceptionHandler`: `AccessDeniedException` → 403 (иначе catch-all превратил бы его в 500).

### `common-kafka`

* `KafkaTopics`: `account.events`, `payment.events`, `catalog.events`, `order.events`, суффикс `.DLT`;
  константы типов событий в `KafkaTopics.Events`.
* `OutboxWriter` (bean):
  ```java
  void append(String topic, EventEnvelope<?> envelope);
  <T> void append(String topic, String eventType, String aggregateType, String aggregateId, long version, T payload);
  ```
  Вызывается **внутри** транзакции, меняющей агрегат.
* `OutboxRelay` (bean) — публикует `PENDING/FAILED` строки, `SKIP LOCKED`, at-least-once.
* `EventEnvelopeCodec` (bean) — `encode/decode/headers/decodeHeaders`; терпим к неизвестным полям payload.
* `IdempotentEventHandler` (bean):
  ```java
  <P> void handleOnce(String consumerName, ConsumerRecord<String,String> record, Class<P> type, Consumer<EventEnvelope<P>> handler);
  <P> void handleOnce(String consumerName, String rawEvent, Class<P> type, Consumer<EventEnvelope<P>> handler);
  ```
  Дедуп по `eventId` (Redis), восстановление correlation id, освобождение claim при ошибке.
* Топики и DLT создаются автоматически (`KafkaAdmin.NewTopics`).
* Consumer factory настроен на DLT: 3 ретрая с backoff 1s → `<topic>.DLT`, offset коммитится только после успеха/DLT.

### Подключение платформы в сервисе

```java
@SpringBootApplication
@EntityScan(basePackages = {"kz.taxi.<name>", "kz.taxi.common.kafka.outbox"})
@EnableJpaRepositories(basePackages = {"kz.taxi.<name>", "kz.taxi.common.kafka.outbox"})
public class XServiceApplication { ... }
```
Обе аннотации обязательны: outbox-сущность и репозиторий живут в `common-kafka`.

---

## 4. Конвенции

### Деньги
Только `long` в минорных единицах (тиын/центы) + колонка `currency VARCHAR(3)`.
В сущностях — примитив `long`, в доменной логике — `Money`. `double` запрещён, `BigDecimal`
допустим только на границе парсинга (`Money.ofDecimal`).

### Идентификаторы
`Ulid.nextId()` (26 символов), колонки `VARCHAR(26)`. Наружу отдаются как строки.

### Ошибки
Каждый сервис объявляет собственный `enum XErrorCode implements ErrorCode` и бросает
`DomainException.of(XErrorCode.FOO, "текст {}", arg)`. Никогда не возвращаем `null` вместо
тела ошибки и не выбираем HTTP-статус в контроллере — статус берётся из `ErrorCode`.

### Идемпотентность
Все мутирующие эндпоинты, двигающие деньги или создающие заказ, **требуют** заголовок
`Idempotency-Key` и оборачивают use case в `IdempotencyGuard.execute(...)`.
Дополнительно уникальный индекс в БД — последняя линия обороны.

### События
Событие пишется в outbox в той же транзакции, что и изменение агрегата:
```java
@Transactional
public PaymentResponse complete(...) {
    payment.markCompleted();
    outbox.append(KafkaTopics.PAYMENT_EVENTS, EventEnvelope.of(
        KafkaTopics.Events.PAYMENT_COMPLETED, "Payment", payment.getId(), payment.getVersion(),
        new PaymentCompletedPayload(...)));
    return mapper.toResponse(payment);
}
```
Никогда не публикуем в Kafka напрямую из бизнес-кода: потерянное или «фантомное» событие
дороже, чем задержка в 500 мс.

### Транзакции и блокировки
Гонки на балансах и стоке решаются пессимистичной блокировкой строки
(`@Lock(LockModeType.PESSIMISTIC_WRITE)`) и/или CHECK-ограничениями в БД.
Оптимистичная блокировка (`@Version`) — на агрегатах, где конфликты редки (заказ, платёж).

### Стиль кода
* конструкторы явные (без field injection), `@Slf4j` для логов;
* DTO — records; сущности — `@Getter` + `@NoArgsConstructor(access = PROTECTED)` + фабрики и
  методы-поведения (`markCompleted()`), никаких `@Data`/сеттеров на сущностях;
* комментарии и Javadoc — по-английски, объясняют **почему**, а не «что»;
* Springdoc-аннотации (`@Tag`, `@Operation`) на контроллерах;
* файлы — UTF-8 **без BOM** (javac падает на BOM в .java).

---

## 5. Тесты

| Тип | Имя | Когда выполняется | Что проверяет |
|---|---|---|---|
| unit | `*Test` | `mvn test` (всегда, без Docker) | доменные инварианты, состояние машины состояний, идемпотентность, маппинг ошибок |
| integration | `*IT` | `mvn verify -Pintegration` | реальный Postgres/Kafka через Testcontainers, Flyway, сквозной сценарий |

JUnit 5 + AssertJ + Mockito. Проверяем инварианты, а не «покрытие»: считаем деньги, проверяем,
что повторный запрос не двигает баланс дважды, что сага компенсирует сбой.

---

## 6. Отладка

### Соглашение о метриках

Технические метрики (JVM, HTTP) приходят из Spring Boot сами. Бизнес-метрики
называются `taxi.<домен>.<факт>` и должны отвечать на вопрос, который задаёт
дежурный:

| Метрика | Что означает | Здоровое значение |
|---|---|---|
| `taxi.settlement.debt.minor` | сколько платформа должна мерчантам | не растёт бесконечно |
| `taxi.settlement.overdue.count` | долг старше суток | 0 |
| `taxi.settlement.outcome{status}` | расчёты по состояниям | доля FAILED ≈ 0 |
| `taxi.outbox.pending` | события, не доехавшие до Kafka | 0 |
| `taxi.payment.outcome{type,status,currency}` | воронка платежей | доля COMPLETED растёт |
| `taxi.payment.failed{reason}` | причины отказов | следить за всплесками |
| `taxi.reconciliation.findings{kind}` | расхождения в данных | строго 0 |

Смотреть локально: `curl http://localhost:8082/actuator/prometheus | findstr taxi_`.

### Сверка данных

`PaymentReconciliationJob` (payment-service) раз в 15 минут проверяет инварианты,
которые уже держат код и БД: расчёт подкреплён строками `settlement_payment`, суммы
расчёта сходятся, возвраты не превышают платёж, завершённый платёж знает время
завершения. Находки попадают в лог (ERROR) и в метрику, но **не исправляются
автоматически**: молчаливая правка денег превращает маленькое расхождение в
необъяснимое большое.

### Полезные запросы

```powershell
# трассировка одного запроса по всем сервисам
Select-String -Path logs\*.log -Pattern '<correlationId>'

# состояние outbox (неопубликованные события)
docker exec -it taxi-postgres psql -U taxi -d taxi_payment `
  -c "select status, count(*) from payment.outbox_message group by status"

# сколько платформа должна мерчантам и что уже выплачено
docker exec -it taxi-postgres psql -U taxi -d taxi_payment -c `
  "select status, count(*), sum(net_minor) from payment.merchant_settlement group by status"

# содержимое топиков
docker exec -it taxi-kafka /opt/kafka/bin/kafka-console-consumer.sh `
  --bootstrap-server localhost:9092 --topic payment.events --from-beginning --max-messages 5
```

Типовые симптомы:

| Симптом | Причина |
|---|---|
| 500 вместо 403 | исключение не унаследовано от `AccessDeniedException` либо перехвачено catch-all-обработчиком |
| 409 `CONFLICT` на повтор запроса | предыдущий запрос с тем же `Idempotency-Key` ещё в полёте |
| 409 `IDEMPOTENCY_CONFLICT` | тот же ключ, другое тело — ошибка клиента |
| событие не появилось в Kafka | outbox-строка не закоммичена (нет `@Transactional`) либо relay выключен (`taxi.outbox.enabled`) |
| `duplicate key value violates unique constraint` | сработала защита БД — проверьте, что вы не забыли idempotency-обёртку |
