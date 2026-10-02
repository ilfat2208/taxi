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

## 6. Такси: геопозиции и диспетчерская — `dispatch-service`

Водительское приложение шлёт позицию, диспетчерская смотрит парк.

| Метод | Путь | Роль | Что делает |
|---|---|---|---|
| `POST` | `/api/v1/locations` | `DRIVER` | одна позиция от вызывающего водителя |
| `POST` | `/api/v1/locations/batch` | `DRIVER` | пачка точек, накопленных без сети (у каждой своё время) |
| `GET` | `/api/v1/dispatch/drivers?includeStale=true` | `DISPATCHER`, `SUPPORT`, `ADMIN` | все на линии с последней позицией |
| `GET` | `/api/v1/dispatch/nearest?lat&lon&radiusM&limit` | то же | кто может взять поездку у точки, ближайшие первыми |

Ответ карты:

```json
{
  "generatedAt": "2026-10-02T09:44:12Z",
  "staleAfterSeconds": 20,
  "onDuty": 7,
  "withPosition": 7,
  "drivers": [
    {
      "driverId": "01M3XZ5DXRHACB56BANH5SX5", "displayName": "Водитель 1",
      "phone": "+77015677675", "status": "ONLINE",
      "lat": 43.24543, "lon": 76.90724,
      "headingDeg": 153, "speedKph": 22, "ageSeconds": 3, "stale": false
    }
  ]
}
```

Правила:

* позиция принимается только от водителя **на линии**: у неизвестного пользователя — `404`
  `DRIVER_NOT_FOUND`, у неработающего — `409 DRIVER_NOT_ON_DUTY`. Привязка идёт по проекции
  `userId -> driverId`, собранной из `driver.events`, — сервис не спрашивает соседа синхронно;
* из батча в живой индекс попадает **только самая свежая точка**: карте и поиску нужно «где он
  сейчас», а трек поездки — отдельная сущность с отдельным владельцем (Ф2);
* невозможные координаты, негодная точность и скорость выше 250 км/ч отклоняются с
  `400 INVALID_POSITION`; слишком большой батч — `400 TOO_MANY_POINTS`; радиус больше
  разрешённого — `400 INVALID_RADIUS`;
* `radiusM` и `limit` можно не передавать: `0` (или отсутствие параметра) означает «значение
  по умолчанию»;
* карта показывает и тех, кто перестал присылать позиции (`stale: true`), а поиск кандидатов
  их исключает: «показать диспетчеру» и «обещать пассажиру» — разные вопросы.

## 7. Такси: поездки — `trip-service`

Полный цикл заказа поездки: котировка → заявка → водитель → поездка → деньги → чек.

| Метод | Путь | Роль | Что делает |
|---|---|---|---|
| `POST` | `/api/v1/trips/quote` | `CUSTOMER` | считает маршрут и цену, возвращает `quoteId` — снимок цены с ограниченным сроком |
| `POST` | `/api/v1/trips` | `CUSTOMER` | создаёт поездку (`Idempotency-Key` обязателен) и сразу ищет водителя |
| `GET` | `/api/v1/trips/{tripId}` | владелец, `SUPPORT`, `ADMIN` | статус, водитель, машина, цена, таймлайн переходов; у завершённой поездки — ещё и `receipt` |
| `GET` | `/api/v1/trips/{tripId}/receipt` | владелец, `SUPPORT`, `ADMIN` | чек завершённой поездки: разбивка цены, комиссия платформы, доход водителя |
| `GET` | `/api/v1/trips?status=&page=&size=` | `CUSTOMER` — свои, `DISPATCHER` — активные, `SUPPORT`/`ADMIN` — все | история и живые заявки |
| `POST` | `/api/v1/trips/{tripId}/cancel` | владелец, `DISPATCHER`, `SUPPORT`, `ADMIN` | отмена с причиной; резерв денег освобождается. Диспетчер и оператор отменяют только живую поездку (до `IN_PROGRESS`) и обязаны указать причину — в истории должно остаться, почему |
| `POST` | `/api/v1/trips/{tripId}/rate` | владелец | оценка водителя 1–5, только по завершённой поездке |
| `POST` | `/api/v1/trips/{tripId}/assign` | `DISPATCHER`, `ADMIN` | ручное назначение водителя: `{"driverId": "..."}`. Та же логика, что у внутреннего `assign`, просто вторая дверь |
| `POST` | `/api/v1/trips/internal/{tripId}/assign` | внутренний | назначает водителя и резервирует деньги |
| `POST` | `/api/v1/trips/internal/{tripId}/arrive`, `/start`, `/complete` | внутренний | подача, начало поездки и завершение (завершение списывает деньги) |

Котировка:

```json
// запрос
{ "pickup":  {"lat": 42.3155, "lon": 69.5867, "address": "пр. Тауке хана, 60"},
  "dropoff": {"lat": 42.3000, "lon": 69.6000, "address": "пр. Республики, 12"},
  "tariff": "COMFORT" }

// ответ
{ "quoteId": "01M3...", "tariff": "COMFORT", "distanceM": 6400, "durationS": 1080,
  "priceMinor": 184800, "currency": "KZT",
  "commissionMinor": 22176, "driverNetMinor": 162624, "surgeBp": 0,
  "breakdown": {"baseMinor": 40000, "distanceMinor": 96000, "timeMinor": 48800},
  "expiresAt": "2026-10-02T10:05:00Z" }
```

Статусы поездки: `SEARCHING → ASSIGNED → ARRIVED → IN_PROGRESS → COMPLETED`, плюс
`CANCELLED_BY_RIDER`, `CANCELLED_BY_DRIVER` и честный `NO_DRIVERS_FOUND` — это не
ошибка запроса, а состояние поездки.

**Деньги.** При назначении водителя на счёте пассажира создаётся резерв (`hold`), при
завершении поездки — списание (`capture`). Если доступных денег не хватает, поездка не
начинается: `422 INSUFFICIENT_FUNDS`, резерв не создаётся. Комиссия платформы считается
в базисных пунктах, и `driverNetMinor + commissionMinor = priceMinor` — инвариант,
который проверяет e2e-скрипт. Выплата водителю в этой фазе не выполняется: это
следующий шаг, и он делается той же механикой расчётов, что у мерчантов (ADR 0007).

Расстояние и время сейчас приближённые: расстояние по большому кругу с коэффициентом
дороги, время — по средней скорости. Это осознанное упрощение до подключения OSRM
(см. ADR 0009): маршрутизатор за интерфейсом, а не в бизнес-логике.

Чек. Появляется только у завершённой поездки: до `COMPLETED` чека нет, и запрос
возвращает `409 TRIP_NOT_COMPLETED` — чек это факт состоявшейся поездки, а не
обещание. Номер поездки (`T` + ULID) — то, что человек называет поддержке.

```json
{ "tripId": "01M3Y1AYYJGHVVY7NCZQ690MJF", "tripNumber": "T01M3Y1AYYJGHVVY7NCZQ690MJF",
  "status": "COMPLETED", "completedAt": "2026-10-02T10:42:11Z", "tariff": "COMFORT",
  "pickup":  {"lat": 42.3155, "lon": 69.5867, "address": "пр. Тауке хана, 60"},
  "dropoff": {"lat": 42.3000, "lon": 69.6000, "address": "пр. Республики, 12"},
  "distanceM": 6400, "durationS": 1080,
  "breakdown": {"baseMinor": 40000, "distanceMinor": 96000, "timeMinor": 48800},
  "priceMinor": 184800, "currency": "KZT", "surgeBp": 0,
  "commissionBp": 1200, "commissionMinor": 22176, "driverNetMinor": 162624,
  "driverId": "01M3Y3W17Y3Y45KD9X9S8G6RSM", "driverDisplayName": "Айдар Сериков" }
```

Две суммы в чеке обязаны сходиться, и обе проверяет сквозной сценарий:
`baseMinor + distanceMinor + timeMinor = priceMinor` и
`driverNetMinor + commissionMinor = priceMinor`. Второе верно по построению: доход
водителя считается вычитанием комиссии из цены, а не вторым независимым округлением.
Обе суммы проверяются ещё и при сборке чека, поэтому сломанная арифметика — это
громкий отказ, а не документ с дырой, которую должен заметить человек.

Поле `paymentId` присутствует в форме и в этой фазе всегда `null`: поездка на кошельке
оплачивается через `account-service` (резерв → списание), и платёжного поручения за ней
нет. Настоящая ссылка на движение денег сегодня — `transactionId`: проводка списания в
`account.ledger_entry`. Когда появятся карточные и корпоративные оплаты, здесь будет
идентификатор платежа.

Поле `vehiclePlate` заполняется только при ручном назначении диспетчером и остаётся
пустым при автоматическом подборе — потому что **автомобиль пока не смоделирован**:
`driver-service` владеет профилем водителя, документами со сроком и состоянием смены, но
не машиной, и ни `driver.registered`, ни ответы внутреннего API номера не несут. Это
честно указано и в интерфейсе («данные машины и водителя появятся, когда их начнёт
отдавать сервис»). Ближайший шаг: завести автомобиль у водителя (марка, модель, цвет,
номер), добавить его в событие регистрации и в кандидата поиска — тогда номер поедет по
цепочке «диспетчерская → назначение → карточка поездки → чек» без отдельного запроса.

Коды: `TRIP_NOT_FOUND` (404), `QUOTE_EXPIRED` (422), `QUOTE_ALREADY_USED` (409),
`TRIP_NOT_CANCELLABLE` (409), `TRIP_NOT_ASSIGNABLE` (409), `DRIVER_NOT_AVAILABLE` (409),
`TRIP_NOT_COMPLETED` (409), `TRIP_ALREADY_RATED` (409), `CANCEL_REASON_REQUIRED` (400),
`INSUFFICIENT_FUNDS` (422), `INVALID_COORDINATES` (400).

## 8. Услуги: запись и расписание — `qtime-service`

QTime — ядро записи, расписания и работы с клиентами для сервисных вертикалей: сегодня
ORTA Services и Beauty, дальше Health и Auto. Вертикали не пишут свой календарь, а
подключаются сюда (ADR 0010).

| Метод | Путь | Роль | Что делает |
|---|---|---|---|
| `GET` | `/api/v1/qtime/companies?query=&category=&city=&page=&size=` | анонимно | список компаний с рейтингом и ценой «от» |
| `GET` | `/api/v1/qtime/companies/{companyId}` | анонимно | компания со специалистами и услугами |
| `GET` | `/api/v1/qtime/specialists/{specialistId}/slots?serviceId=&date=YYYY-MM-DD` | анонимно | сетка свободных и занятых окон на дату |
| `POST` | `/api/v1/qtime/bookings` | `CUSTOMER` | запись на услугу (`Idempotency-Key` обязателен) |
| `GET` | `/api/v1/qtime/bookings?status=&page=&size=` | владелец, `SUPPORT`, `ADMIN` | мои записи |
| `GET` | `/api/v1/qtime/bookings/{bookingId}` | владелец, `SUPPORT`, `ADMIN` | одна запись: что и когда, где, у кого, сколько стоит |
| `POST` | `/api/v1/qtime/bookings/{bookingId}/cancel` | владелец, `MERCHANT`, `ADMIN` | отмена, окно освобождается |
| `POST` | `/api/v1/qtime/bookings/{bookingId}/complete` | внутренний | завершение визита (для кабинета ORTA Business) |

Ответ по окнам:

```json
{ "date": "2026-10-03", "specialistId": "01M3...", "serviceId": "01M3...",
  "durationMinutes": 60, "timezone": "Asia/Almaty",
  "slots": [
    {"startsAt": "2026-10-03T04:00:00Z", "endsAt": "2026-10-03T05:00:00Z", "available": true,  "reason": null},
    {"startsAt": "2026-10-03T05:00:00Z", "endsAt": "2026-10-03T06:00:00Z", "available": false, "reason": "занято"}
  ] }
```

Занятые окна тоже возвращаются — с `available: false` и причиной: интерфейсу нужно
показать сетку целиком, как на макете, а не только дырки.

Правила:

* окно — это рабочее время специалиста минус перерыв, минус подтверждённые записи
  (пересечение считается по интервалам, а не только по началу: услуга на 90 минут не
  влезает в окно за полчаса до обеда), минус прошедшее время и минимальный запас;
* **одно окно — одна запись**, и это держит частичный уникальный индекс в БД, а не
  проверка в коде: повторное занятие окна возвращает `409 SLOT_TAKEN`, а не создаёт
  вторую запись — та же дисциплина, что у «одного активного заказа на водителя»;
* запись вне рабочих часов или в перерыв → `422 OUTSIDE_WORKING_HOURS`; услуга не
  принадлежит специалисту → `400`; отмена завершённой записи → `409`;
* отмена освобождает окно сразу: статус записи меняется, а индекс частичный;
* **честная дыра, а не тихая:** связь «мерчант ↔ компания» в QTime не смоделирована —
  компании приходят из каталога вертикали, а привязка к аккаунту появится вместе с
  кабинетом ORTA Business. Пока её нет, роль `MERCHANT` может отменить **любую**
  запись, а не только свою. Это записано и в коде (`QtimeAccess`), чтобы дыра была
  известна, а не обнаруживалась на проде;
* предоплата и связь с ORTA Pay — следующий шаг: сейчас запись создаётся без движения
  денег, а цена услуги сохраняется в записи.

## 9. Корзина и заказы — `order-service`

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

## 10. Расчёты с мерчантами — `payment-service` и `catalog-service`

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

## 11. Поддержка — роль `SUPPORT`

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

## 12. Внутренние API (не для клиентов)

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

## 13. Ошибки

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
| `DRIVER_NOT_ON_DUTY` | 409 | Позиция от водителя, который не на линии |
| `INVALID_POSITION` | 400 | Координаты/точность/скорость не могут существовать |
| `TOO_MANY_POINTS` | 400 | Слишком большой батч позиций |
| `INVALID_RADIUS` | 400 | Радиус поиска больше разрешённого |
| `FORBIDDEN_FLEET_ACCESS` | 403 | Живой парк виден только диспетчеру и поддержке |
| `TRIP_NOT_FOUND`, `QUOTE_NOT_FOUND` | 404 | Поездка или снимок цены не найдены |
| `QUOTE_EXPIRED` | 422 | Снимок цены истёк — нужна новая котировка |
| `QUOTE_ALREADY_USED`, `TRIP_NOT_CANCELLABLE`, `TRIP_NOT_ASSIGNABLE`, `DRIVER_NOT_AVAILABLE`, `TRIP_NOT_COMPLETED`, `TRIP_ALREADY_RATED`, `HOLD_FAILED`, `CAPTURE_FAILED` | 409 | Конфликт состояния: цена уже потрачена на другую поездку, поездку нельзя отменить или назначить, водитель занят, чека или оценки ещё нет, деньги не зарезервировались |
| `CANCEL_REASON_REQUIRED`, `INVALID_COORDINATES`, `INVALID_TARIFF`, `INVALID_RATING`, `NO_PICKUP_POINT`, `NO_DROPOFF_POINT` | 400 | Причина отмены обязательна для диспетчера и оператора; координаты, тариф или оценка недопустимы; точка не указана |
| `FORBIDDEN_TRIP_ACCESS`, `FORBIDDEN_TRIP_ASSIGNMENT` | 403 | Чужая поездка; назначать водителя может только `DISPATCHER` или `ADMIN` |
| `RIDER_ACCOUNT_NOT_FOUND` | 422 | У пассажира нет активного счёта в KZT |
| `COMPANY_NOT_FOUND`, `SPECIALIST_NOT_FOUND`, `SERVICE_NOT_FOUND` | 404 | Компания, специалист или услуга не найдены |
| `BOOKING_NOT_FOUND` | 404 | Запись не найдена |
| `SLOT_TAKEN` | 409 | Окно у специалиста уже занято другой записью |
| `BOOKING_NOT_CANCELLABLE` | 409 | Запись уже завершена или отменена |
| `BOOKING_NOT_COMPLETABLE` | 409 | Завершить можно только подтверждённую запись |
| `SERVICE_NOT_OFFERED_BY_SPECIALIST` | 400 | Услугу оказывает другой специалист или другая компания |
| `COMPANY_NOT_AVAILABLE` | 422 | Компания приостановлена и записи не принимает |
| `OUTSIDE_WORKING_HOURS` | 422 | Время вне рабочего расписания специалиста или в перерыве |
| `BOOKING_IN_PAST`, `BOOKING_TOO_SOON`, `OUTSIDE_BOOKING_HORIZON` | 422 | Время в прошлом, ближе минимального запаса или дальше горизонта записи |
| `CUSTOMER_ROLE_REQUIRED`, `FORBIDDEN_BOOKING_ACCESS` | 403 | Записываться может только клиент; чужая запись недоступна |
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
