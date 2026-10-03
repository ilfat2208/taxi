#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Резервная копия всех баз ORTA.
#
# Зачем отдельный скрипт, а не «docker volume backup»: дампы понятны людям и
# переносимы между версиями Postgres, а том с PGDATA — нет. Восстановление
# проверяется командой из deploy/README.md, потому что бэкап, который никто не
# восстанавливал, бэкапом не является.
#
# Запуск на сервере (из корня репозитория):
#   ./deploy/backup-db.sh
#
# По расписанию — в crontab пользователя deploy:
#   15 3 * * * cd /opt/orta && ./deploy/backup-db.sh >> /var/log/orta-backup.log 2>&1
#
# Переменные берутся из deploy/.env (POSTGRES_USER, POSTGRES_PASSWORD).
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Переопределяется переменными окружения, чтобы скрипт можно было прогнать и против
# локального стека (он поднимается корневым docker-compose.yml с проектом taxi),
# а не только против серверного.
ENV_FILE="${ENV_FILE:-deploy/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-deploy/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

if [[ ! -f "$ENV_FILE" ]]; then
  echo "нет $ENV_FILE — скопируйте deploy/.env.example и заполните" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a && source "$ENV_FILE" && set +a

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

# Базы платформы и вертикалей. Список ведётся здесь, потому что он же список
# того, что должно восстанавливаться: забытая база — это потерянный счёт.
DATABASES=(
  taxi_account
  taxi_payment
  taxi_catalog
  taxi_order
  taxi_driver
  taxi_trip
  taxi_qtime
)

for db in "${DATABASES[@]}"; do
  file="$BACKUP_DIR/${db}-${STAMP}.sql.gz"
  echo "== $db -> $file"
  "${COMPOSE[@]}" exec -T postgres \
    pg_dump --clean --if-exists --no-owner -U "$POSTGRES_USER" "$db" \
    | gzip -9 > "$file"
done

# Ротация: старые дампы удаляются, иначе диск кончится раньше, чем они понадобятся.
find "$BACKUP_DIR" -name '*.sql.gz' -type f -mtime "+${KEEP_DAYS}" -delete

echo "готово: $(find "$BACKUP_DIR" -name '*.sql.gz' | wc -l) дамп(ов) в $BACKUP_DIR, хранятся ${KEEP_DAYS} дней"
