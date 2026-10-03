# Выкладка ORTA на сервер

Runbook для одного сервера: домен, TLS, стек из 12 контейнеров, обновление, откат и бэкапы.
Команды проверены там, где это возможно без сервера; помеченные **не проверено** требуют хоста.

## 1. Что нужно от сервера

| | Минимум | Рекомендуется |
| --- | --- | --- |
| Процессор | 2 vCPU | 4 vCPU |
| Память | 4 ГБ (с урезанным набором сервисов) | **8 ГБ** (весь стек) |
| Диск | 40 ГБ SSD | 60–80 ГБ SSD |
| ОС | Ubuntu 22.04/24.04 LTS | Ubuntu 24.04 LTS |

Почему так: девять Java-сервисов — это девять JVM. При `SERVICE_MEM_LIMIT=700m` и
`MaxRAMPercentage=55` стек укладывается примерно в 6,5 ГБ, включая Postgres, Kafka и Redis.
На 4 ГБ придётся либо снизить лимит до ~420m, либо не поднимать часть вертикалей
(`docker compose ... up -d api-gateway account-service payment-service catalog-service order-service postgres kafka redis caddy`
вместо всего стека) — это честный компромисс, а не «заведётся как-нибудь».

Ещё нужно: **домен**, A-запись которого смотрит на IP сервера, и открытые порты 80/443 (для
выпуска сертификата Let's Encrypt) и 22 (SSH).

## 2. Подготовка сервера

```bash
# от root
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy

# Docker и compose-плагин
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# файрвол: наружу только SSH, HTTP и HTTPS
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable

# автозапуск после перезагрузки — у compose-стека уже restart: unless-stopped,
# но демон должен подняться первым
systemctl enable docker
```

Проверка: `docker run --rm hello-world` под пользователем `deploy` (без sudo).

## 3. Код и секреты

```bash
sudo mkdir -p /opt/orta && sudo chown deploy:deploy /opt/orta
su - deploy
git clone https://bitbucket.org/asiaservice/orta.git /opt/orta
cd /opt/orta

cp deploy/.env.example deploy/.env
# сгенерировать секреты и вписать в deploy/.env:
openssl rand -base64 48    # JWT_SECRET
openssl rand -hex 24       # INTERNAL_API_TOKEN
openssl rand -base64 24    # POSTGRES_PASSWORD
# DOMAIN и ACME_EMAIL — ваши домен и почта
```

`deploy/.env` в `.gitignore`: секреты живут только на сервере. Права — `chmod 600 deploy/.env`.

## 4. Первая выкладка

```bash
cd /opt/orta

# Сборка и запуск. Первый раз собираются 9 образов Maven — это долго
# (10–25 минут) и тяжело по памяти, поэтому параллелизм ограничен.
export COMPOSE_PARALLEL_LIMIT=2
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build

# Сборка веб-клиента (SPA) в том, который читает Caddy. Пересобирается
# только когда менялся web/.
docker compose --env-file deploy/.env -f deploy/docker-compose.yml --profile build run --rm web-builder

# Состояние
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
```

Ожидаемое: все контейнеры `running`, у `orta-postgres`, `orta-kafka`, `orta-redis`,
`orta-api-gateway` — `healthy`. Caddy поднимается последним, потому что ждёт шлюз.

Дальше — **подготовить службу systemd** (чтобы стек поднимался после перезагрузки даже при
`restart: unless-stopped` для остановленных вручную контейнеров):

```bash
sudo tee /etc/systemd/system/orta.service >/dev/null <<'UNIT'
[Unit]
Description=ORTA stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/orta
User=deploy
ExecStart=/usr/bin/docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d
ExecStop=/usr/bin/docker compose --env-file deploy/.env -f deploy/docker-compose.yml down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload && sudo systemctl enable orta
```

## 5. Проверка после выкладки

```bash
# 1) шлюз отвечает
curl -sS https://$DOMAIN/actuator/health

# 2) конфигурация для клиентов отдаётся анонимно
curl -sS https://$DOMAIN/api/v1/config | head -c 200

# 3) сертификат выпущен
echo | openssl s_client -connect $DOMAIN:443 -servername $DOMAIN 2>/dev/null | openssl x509 -noout -issuer -dates

# 4) внутренние порты наружу закрыты — должны быть недоступны с ноутбука
nc -z -w 3 $SERVER_IP 8080 ; echo "8080 -> $?"   # ожидается отказ
nc -z -w 3 $SERVER_IP 5432 ; echo "5432 -> $?"   # ожидается отказ
```

Затем в браузере: `https://$DOMAIN` — веб-клиент, вход любым телефоном с кодом `0000`
(учебный провайдер), роль ADMIN — админка на `/admin`. **Для стенда, доступного из интернета,
это дыра**: см. §8.

## 6. Обновление и откат

```bash
cd /opt/orta
git fetch --all --tags
git checkout <тег или main>
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
docker compose --env-file deploy/.env -f deploy/docker-compose.yml --profile build run --rm web-builder
```

Откат — тем же способом: `git checkout <предыдущий тег>` и та же команда. Образы собираются
на сервере, поэтому «предыдущая версия» — это предыдущий коммит, а не тег в реестре; если
нужен мгновенный откат, переходите на схему с реестром (см. `docs/collaboration.md`, вариант C).

Логи и диагностика:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs -f api-gateway
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs --tail 100 payment-service
docker stats --no-stream          # память по контейнерам
df -h /var/lib/docker             # логи и тома
```

## 7. Бэкапы

```bash
chmod +x deploy/backup-db.sh
./deploy/backup-db.sh            # дампы всех баз в deploy/backups/
crontab -e                       # добавить строку
# 15 3 * * * cd /opt/orta && ./deploy/backup-db.sh >> /var/log/orta-backup.log 2>&1
```

Восстановление (проверьте его один раз на пустой базе — иначе бэкапа нет):

```bash
gunzip -c deploy/backups/taxi_account-20260101-031501.sql.gz | \
  docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
  exec -T postgres psql -U "$POSTGRES_USER" -d taxi_account
```

Дампы лежат на том же сервере, поэтому от потери сервера не спасают. Второй шаг — копировать
каталог `deploy/backups/` наружу: `rclone`/`s3`/`rsync` на другой хост, по расписанию.

## 8. Что обязательно сделать перед публичным доступом

Это не пожелания, а список известных дыр текущей конфигурации:

1. **Учебный провайдер идентичности** (`POST /api/v1/auth/token` принимает любой телефон с кодом
   `0000` и выдаёт любую роль, включая ADMIN) — в интернет его выпускать нельзя. Варианты:
   закрыть `/api/v1/auth/**` на уровне Caddy и выдавать токены вручную, либо подключить настоящий
   OIDC (`JWT_MODE=JWKS`, `JWK_SET_URI`) и удалить `AuthController` — он для этого и написан
   так, чтобы его удаление ничего больше не задело.
2. **Открытая регистрация демо-данных**: `QTIME_DEMO_SEED=false` (уже в примере `.env`).
3. **Prometheus-метрики** шлюза: Caddy отдаёт только `/actuator/health`, остальное — 404. Если
   понадобится мониторинг, снимайте метрики с localhost сервера или закрывайте basic-auth.
4. **Секреты**: `JWT_SECRET` и `INTERNAL_API_TOKEN` — только сгенерированные, не из примеров.
   Смена `JWT_SECRET` разлогинивает всех, это нормально и делается при подозрении на утечку.
5. **Один инстанс**: никакого горизонтального масштабирования (шлюз держит лимиты в Redis,
   но сервисы — stateful по своим БД). Резерв — вертикальный: больше памяти и ядер.
6. **Мониторинга и алертов нет**: Prometheus-сервера в проекте нет, метрики отдаются, но никто
   их не собирает. Это следующий шаг, а не текущее состояние.

## 9. Проверено, а что нет

| Что | Как проверено |
| --- | --- |
| `deploy/docker-compose.yml` | `docker compose -f deploy/docker-compose.yml config` — синтаксис, переменные, тома; опубликованы только 80 и 443 |
| `deploy/Caddyfile` | `caddy validate` → `Valid configuration`; затем запущен **боевой файл** (адрес подставлен как `DOMAIN=:8080`) в сети локального стека против живого шлюза, проверены маршруты: `/`, `/index.html`, `/admin/payments` → 200 `text/html` (SPA-фолбэк работает), `/api/v1/config` и `/api/v1/trips/tariffs` → 200 `application/json`, `/api/v1/payments` → 401 (закрытый эндпоинт доходит до шлюза), `/actuator/health` → 200, `/actuator/metrics` → **404** (наружу закрыт) |
| `deploy/backup-db.sh` | реальный прогон против локального Postgres: 7 дампов (28 КБ account, 19 КБ driver, 9–18 КБ остальные), ротация срабатывает; затем **дамп восстановлен** в отдельную базу — 1 схема, 7 таблиц, 18 счетов, данные на месте |
| Стек из 12 контейнеров по этому compose | **не поднимался**: локально работает та же конфигурация через корневой `docker-compose.yml` (профиль `app`), но с публикацией портов и без Caddy. Серверный файл отличается только этим |
| Выпуск сертификата, DNS, firewall, `systemd`, переживание перезагрузки | **не проверено** — требует домена и сервера |
| Шаг `deploy` в Bitbucket Pipelines | **не проверено** — требует SSH-доступа к серверу |
