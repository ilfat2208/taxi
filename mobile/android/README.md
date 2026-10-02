# Taxi Mobile — native Android client

A Kotlin + Jetpack Compose (Material 3) client for the Taxi fintech backend that is
already running on this machine. Everything lives under `mobile/android/`; nothing else in
the repository is touched.

* Kotlin 2.0.21, Jetpack Compose (Material 3), MVVM + `StateFlow`
* Gradle **Kotlin DSL** with a version catalog (`gradle/libs.versions.toml`)
* `minSdk 26`, `targetSdk 34`, `compileSdk 34`
* Retrofit + OkHttp + **kotlinx.serialization**
* Navigation Compose, DataStore Preferences

> JSON uses kotlinx.serialization rather than Moshi on purpose: it is compile-time (no
> reflection, no KSP/codegen, nothing extra to keep alive in R8), it is the natural fit for a
> Kotlin 2.x codebase, and the same `@Serializable` DTOs work unchanged on the JVM — which is
> what lets the live-backend test exercise the real production stack.

## Toolchain

The Android SDK was not installed, so it was installed headlessly into the conventional
location and is **not** part of this repository:

| Component | Version | Location |
|---|---|---|
| JDK | Temurin 17.0.16 | `C:\Java\jdk-17` |
| Android command-line tools | `commandlinetools-win-11076708_latest` | `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest` |
| `platform-tools` (adb) | latest | `%LOCALAPPDATA%\Android\Sdk\platform-tools` |
| `platforms;android-34` | 34 | `%LOCALAPPDATA%\Android\Sdk\platforms\android-34` |
| `build-tools;34.0.0` | 34.0.0 | `%LOCALAPPDATA%\Android\Sdk\build-tools\34.0.0` |
| Gradle | 8.9 (wrapper, Kotlin DSL) | `gradle/wrapper` + `~/.gradle/wrapper/dists` |
| AGP | 8.7.3 | resolved from `google()` |

`licenses/` was accepted with `yes | sdkmanager --licenses`, and `local.properties` pins
`sdk.dir` (it is machine-specific and must not be committed).

### Memory note

This host is simultaneously running the whole backend stack and Docker, and a per-process
address-space limit rejects any JVM heap above roughly 1.5 GB
(`Could not reserve enough space for ... object heap`). `gradle.properties` therefore keeps
the Gradle daemon at 1 GB and compiles Kotlin in its own 1 GB daemon. If a build reports an
out-of-memory error, stop stale daemons first:

```powershell
.\gradlew.bat --stop
Remove-Item "$env:USERPROFILE\.gradle\daemon" -Recurse -Force -ErrorAction SilentlyContinue
```

## Build

```powershell
cd C:\taxi\mobile\android
$env:JAVA_HOME = 'C:\Java\jdk-17'
.\gradlew.bat assembleDebug
```

Output: `app\build\outputs\apk\debug\app-debug.apk`

## Backend origin

One place only — `app/build.gradle.kts` injects `BuildConfig.API_BASE_URL` and
`core/ApiConfig.kt` exposes it:

```powershell
# default: the emulator alias for the host loopback
.\gradlew.bat assembleDebug
# a physical device on the same LAN
.\gradlew.bat assembleDebug -Ptaxi.api.baseUrl=http://192.168.1.20:8080
```

`ApiConfig` also honours the `taxi.api.baseUrl` system property, which is how the JVM
live-backend test points the very same Retrofit stack at `http://localhost:8080` (the
`10.0.2.2` alias exists **only** inside the Android emulator).

## Tests

```powershell
# pure unit tests: money formatting, idempotency-key holder, error mapping, phone numbers
.\gradlew.bat testDebugUnitTest

# the live end-to-end test against the running gateway (opt-in, self-skipping)
.\gradlew.bat testDebugUnitTest -Dtaxi.liveTest=true
```

`LiveBackendTest` is skipped unless `-Dtaxi.liveTest=true` (or `TAXI_LIVE_TEST=1`), so the
normal build never depends on the backend being up. It uses the real `NetworkModule`, the
real interceptors and the real DTOs: it logs in, lists accounts, provisions a recipient by
logging in as their phone, moves real money, asserts the payment is `COMPLETED`, and asserts
that a retry with the **same** `Idempotency-Key` returns the **same** `paymentId` while a new
key creates a new payment. It also writes its trace to
`app/build/live-backend-test.log`.

## Architecture

```
app/src/main/java/kz/taxi/mobile/
  TaxiApp.kt              Application; owns the AppContainer
  AppContainer.kt          hand-rolled DI (no Hilt/Koin: no annotation processing)
  MainActivity.kt
  core/
    ApiConfig.kt           the single place the backend origin lives
    money/Money.kt         minor units <-> BigDecimal; ru-KZ rendering; no Double for money
    error/ApiError.kt      ApiError + RFC 7807 ProblemDetails + machine-readable Codes
    error/ApiErrorMapper.kt  code -> Russian message, correlationId recovery, transport errors
    idempotency/IdempotencyKeyHolder.kt
    net/                   NetworkModule, ApiHeadersInterceptor, ProblemLoggingInterceptor
    session/               Session, TokenStore (DataStore), SessionManager
    ui/                    theme + shared Compose components (ScreenScaffold, ErrorCard, …)
    util/PhoneNumbers.kt
  data/
    dto/                   @Serializable DTOs mirroring the fixed contract
    remote/                Retrofit interfaces (Auth, Accounts, Payments, Catalog, Cart, Orders)
    repo/                  one repository per feature, every call wrapped in apiCall { }
  feature/
    login/ accounts/ transfer/ payments/ catalog/ cart/ checkout/ orders/
  nav/AppNav.kt            Navigation Compose graph
  ui/AppViewModels.kt      one ViewModel factory per screen
```

### Cross-cutting behaviour

* **Auth header** — `ApiHeadersInterceptor` adds `Authorization: Bearer <token>` from the
  in-memory session (never from disk on the request path) and a **fresh
  `X-Correlation-Id` UUID per request**; it also reports a `401` on an authenticated request
  so the session is dropped and the navigation layer returns to login.
* **Error logging** — `ProblemLoggingInterceptor` logs every failing response with the RFC 7807
  `code` and the `correlationId`, using `peekBody` so the body is still available to Retrofit.
* **Errors in the UI** — `ErrorCard` always shows the Russian message plus the diagnostics line
  (`Код: … · Correlation-Id: … · HTTP …`), because support asks for the correlation id.
* **Money** — every amount is a `Long` of minor units and every conversion goes through
  `BigDecimal`. `Double` is never used for money anywhere.
* **Idempotency** — a fresh UUID per logical submit, reused only when retrying that same
  submit, and the submit button is disabled for the whole in-flight window
  (`SubmitButton(inFlight = …)`). The transfer and checkout screens display the exact key in
  use, and the success screen's "Повторить операцию" deliberately starts a **new** submit
  with a **new** key.

## Screens

| Screen | What it does |
|---|---|
| Login | phone + demo code `0000`, with an in-app explanation of the development IdP and an optional "operator mode" that also requests `ADMIN` (needed for demo top-up) |
| Dashboard | total available, per-account cards (balance/held/available), quick actions, recent transactions, open an account, operator-only demo top-up |
| Transfer | source account, recipient phone, amount, comment → **review step** (shows the `Idempotency-Key`) → submit (disabled while in flight) → success with the payment number, fee and "repeat" that uses a NEW key |
| Payments history | paged, status filter (Все / Выполнен / В обработке / Отклонён / Отменён) |
| Payment detail | full payment, ids, and the status-transition timeline |
| Marketplace | search (debounced), category filter, sort (relevance / price asc / price desc / newest), paging |
| Product detail | price, stock (onHand/reserved/available), merchant, description, add to cart |
| Cart | line items with ±, remove, clear, subtotal |
| Checkout | address, contact phone, comment, source account; idempotent submit; the created order with **per-merchant payments** |
| Orders | paged list, status filter |
| Order detail | items, totals, per-merchant payments, history timeline, cancel when cancellable |

## Deviations from the written contract (verified against the live gateway)

These were confirmed by exercising the running backend, and the client follows **reality**:

1. `GET /api/v1/payments/by-order/{orderId}/all` is **not routed** — the gateway answers
   `404 NOT_FOUND — no endpoint GET …/all`. The routed path is
   `GET /api/v1/payments/by-order/{orderId}`, and it returns a **single** payment document,
   not a list. All the order's per-merchant payments are available in `OrderDto.payments`.
2. `GET /api/v1/orders` returns an order **summary** (no `items`, `payments`, `subtotalMinor`),
   while `GET /api/v1/orders/{id}` returns the full document. `OrderDto` gives every field
   beyond `orderId` a default so one DTO covers both shapes.
3. `POST /api/v1/orders/{id}/cancel` must be sent **without** a request body; a JSON body is
   rejected with `400 BAD_REQUEST — Content-Type 'application/x-www-form-urlencoded' is not supported`.
4. `GET /api/v1/accounts` returns a bare JSON **array**, not a paged envelope.
5. Error responses are `application/problem+json`, but `401` bodies are only produced by the
   service that rejects the call; the mapper therefore also falls back to the
   `X-Correlation-Id` response header and then to the client-generated correlation id, and
   treats a body-less `401` as `UNAUTHORIZED` so the session is still cleared.
6. `INSUFFICIENT_FUNDS` is hard to trigger on the seeded account because the daily outgoing
   limit (1 000 000,00 KZT) is far below its balance, so an over-balance transfer surfaces as
   `LIMIT_EXCEEDED` first. Both codes are mapped.
