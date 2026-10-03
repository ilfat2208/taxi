# Совместная работа: репозиторий, CI и выкладка

Документ отвечает на вопрос «можно ли развернуть проект на Bitbucket, чтобы над ним работали
другие разработчики». Короткий ответ: **репозиторий и проверки — да, само приложение — нет**.
Bitbucket — это хостинг Git и CI, он не запускает наши 12 контейнеров. Ниже — что делать в
каждом из двух направлений, с командами.

## 1. Что Bitbucket делает, а что нет

| Задача | Bitbucket Cloud | Что нужно вместо/вместе |
| --- | --- | --- |
| Хранить код, история, ветки | да, приватные репозитории | — |
| Совместная работа: pull request, ревью, комментарии | да | Branch permissions + «требуется N одобрений» |
| Автоматические проверки на каждый PR | да, Bitbucket Pipelines | файл `bitbucket-pipelines.yml` (уже в репозитории) |
| Хранить и подставлять секреты сборки | да, Repository variables (можно помечать secured) | JWT-секреты и пароли только там, не в репозитории |
| Уведомления в Jira/Slack, статус сборки на коммите | да | Pipes/Slack-интеграция |
| **Запускать приложение** | **нет** | сервер (VPS) или managed-платформа, см. §5 |
| Хостить Docker-образы | нет реестра образов | Docker Hub, GitHub Container Registry или свой registry |
| Домен и TLS | нет | сервер + reverse proxy и сертификат |

Тарифные лимиты (Free: участники, минуты Pipelines, размер репозитория) меняются — смотрите
Billing в настройках workspace: <https://www.atlassian.com/software/bitbucket/pricing>.
Практический вывод по минутам: наш полный набор проверок (Java-реактор, Testcontainers,
Playwright, сборка 9 образов) — это десятки минут на прогон, поэтому в Pipelines вынесен
короткий набор, а тяжёлые задачи запускаются вручную (см. §4).

## 2. Создать репозиторий и позвать разработчиков

1. Войдите в workspace `asiaservice` → **Create** → **Repository**. Имя, например `orta`.
   Снимите галочку с «Public»: продукт закрытый.
2. **Участники.** Workspace settings → **Users/Groups** → пригласить по email.
   Роли в репозитории (Repository settings → **User and group access**):
   * `Read` — посмотреть код и собрать локально;
   * `Write` — пушить ветки и открывать pull request (обычная роль разработчика);
   * `Admin` — настройки, переменные, доступы (давать одному-двум).
3. **Защита ветки `main`.** Repository settings → **Branch permissions** →
   «Prevent changes without a pull request» + «Prevent deletion». Затем **Merge checks**:
   минимальное число одобрений (1–2) и «все проверки Pipelines зелёные».
4. **Уведомления и статусы.** В Pull Request включите проверку сборки по умолчанию
   (Repository settings → **Pipelines** → «Show build statuses on pull requests»).

## 3. Отдать наш код в Bitbucket

Сейчас `origin` — это GitHub (`https://github.com/ilfat2208/taxi.git`), и в `main` уже лежит вся
работа. Bitbucket добавляется **вторым remote**, GitHub при этом никуда не девается: у части
команд принято держать зеркало, чтобы не терять историю и Issues.

```powershell
cd C:\taxi

# 1) добавить второй remote (slug подставьте свой)
git remote add bitbucket https://bitbucket.org/asiaservice/orta.git

# 2) отправить ветку и теги. Пароль — это App password, обычный пароль Atlassian
#    для git по HTTPS не подходит.
git push bitbucket main
git push bitbucket --tags

# 3) проверить, что оба remote на месте
git remote -v
```

Отдельный ключ доступа создаётся в Bitbucket: **Personal settings → App passwords → Create**
(права: `Repositories: Read/Write`). Логин — email, привязанный к аккаунту. Для SSH:
Personal settings → **SSH keys**, затем remote вида `git@bitbucket.org:asiaservice/orta.git`.

Дальше при обычной работе достаточно пушить в один remote и синхронизировать второй:

```powershell
git push origin main        # GitHub
git push bitbucket main     # Bitbucket
```

Секреты в репозиторий не попадают: `.env` в `.gitignore`, в репозитории лежит только
`.env.example`. Перед первым пушем стоит убедиться, что никто не закоммитил рабочий `.env`:

```powershell
git log --all -- .env
```

## 4. Проверки в Pipelines

В репозитории лежит `bitbucket-pipelines.yml` — он собран под реальные ограничения минут:

| Когда | Что запускается | Зачем именно это |
| --- | --- | --- |
| Pull request | web: `pnpm install`, `pnpm run build` (tsc + vite), `pnpm test` | ловит 90% ошибок фронта за пару минут |
| Pull request | backend: `./mvnw -B -ntp verify -DskipITs` | unit-тесты всех модулей + проверка, что каждый сервис собирается в исполняемый jar |
| Push в `main` | те же два шага | то же на основной ветке |
| Вручную (`custom: full`) | `verify -Pintegration` — Testcontainers: Postgres, Kafka, Flyway, инварианты леджера | тяжело и долго, поэтому по требованию |
| Вручную (`custom: deploy`) | пока заглушка с текстом, что нужен сервер | включим после §5 |

Кэш обязателен и уже настроен: `~/.m2/repository` для Maven и pnpm-store для web. Без него
`verify` каждый раз качает зависимости заново и не укладывается в бюджет.

Переменные для сборки: Repository settings → **Pipelines → Repository variables**. Для текущих
шагов хватает `MAVEN_OPTS` при нехватке памяти; секреты (JWT_SECRET, INTERNAL_API_TOKEN,
пароли БД) нужны только этапу выкладки и хранятся там же с галочкой **Secured**.

Браузерные e2e-тесты (`pnpm e2e`, 14 сценариев) и сборка 9 Docker-образов в Pipelines **не
вынесены осознанно**: они поднимают весь стек и съедают больше минут, чем даёт тариф. Они
гоняются локально и в GitHub Actions, где минуты не ограничены так жёстко.

## 5. Как выложить приложение (Bitbucket его не хостит)

Три рабочих варианта, по возрастанию сложности.

### Вариант A: свой сервер (VPS) + выкладка из Pipelines

Нужен хост, который выдерживает наши 12 контейнеров: минимум **2 vCPU / 4 ГБ RAM / 40 ГБ диска**,
лучше 8 ГБ (Postgres + Kafka + 8 Java-сервисов). Порядок:

1. на сервере: Docker, Docker Compose, отдельный пользователь `deploy`, ключ для деплоя;
2. в репозитории Bitbucket: **Deployments → Environments → production**, там переменные
   `SSH_HOST`, `SSH_USER`, `DEPLOY_PATH` (и `SSH_KEY` как Secured);
3. в `bitbucket-pipelines.yml` шаг `deploy` заменяется на реальный:

```yaml
          script:
            - pipe: atlassian/ssh-run:0.4.1
              variables:
                SSH_USER: $SSH_USER
                SERVER: $SSH_HOST
                COMMAND: 'cd $DEPLOY_PATH && git pull && docker compose --profile app up -d --build'
```

4. на сервере — `.env` (создаётся один раз руками, из `.env.example`) с настоящими секретами:
   `JWT_SECRET` (32+ байт), `INTERNAL_API_TOKEN`, пароль Postgres;
5. TLS и домен: nginx или Caddy перед шлюзом, сертификат Let's Encrypt; наружу открывается только
   80/443, остальные порты закрыты.

Чего в проекте пока **нет** и что для прод-подобного стенда нужно добавить: домен, TLS,
резервное копирование Postgres, ограничение доступа к `/actuator` (сейчас он публичен внутри
платформы), вынос секретов из `.env` в секреты оркестратора.

### Вариант B: managed-платформа (проще всего для команды)

Render / Railway / Fly.io умеют собирать из репозитория и поднимать несколько сервисов. Но у нас
9 Java-сервисов, Kafka, Postgres+PostGIS и Redis — на бесплатных тарифах это не помещается, а на
платных выходит дороже VPS. Разумный компромисс: выложить туда не всё, а демо-контур (gateway +
два-три сервиса + Postgres), а полный стек держать на сервере.

### Вариант C: образы в registry, на сервере только `pull`

Сборка уезжает в CI, сервер ничего не собирает:

1. включить `custom: build-images`, который делает `docker compose --profile app build` и
   `docker push` в Docker Hub или GHCR (нужны `REGISTRY_USER`/`REGISTRY_TOKEN` как Secured);
2. на сервере `docker compose pull && docker compose up -d` — без Maven и Node, быстрее и
   предсказуемее;
3. откат — тег образа предыдущего релиза.

## 6. Что нужно от вас, чтобы это доделать

1. **Slug репозитория** в workspace `asiaservice` (например `orta`) — подставлю в remote и в
   документацию.
2. **Кто пушит первый раз.** Могу сделать это я, но для этого нужен App password (и его лучше
   создать одноразово и потом отозвать) — либо вы выполните две команды из §3 сами, это безопаснее.
3. **Список разработчиков** и роли, чтобы описать приглашение и branch permissions предметно.
4. **Есть ли сервер** для выкладки: если да — его доступы и я доведу §5 до рабочего состояния
   (SSH-деплой + TLS + бэкапы); если нет — подберу вариант A/B/C по бюджету.

Пока ответов нет, весь код уже готов к передаче: репозиторий 18,5 МБ, без LFS и больших файлов,
`.env` в игноре, CI-файл для Bitbucket лежит рядом с GitHub-версией.
