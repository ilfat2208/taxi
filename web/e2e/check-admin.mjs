/**
 * Проверка админ-панели в браузере: разделы открываются, роль соблюдается, ничего не вылезает.
 *
 * Зачем отдельно от `pnpm test`: unit-тесты не откроют девять разделов в браузере и не
 * заметят, что таблица вылезла за экран или что роль SUPPORT увидела кнопку возврата.
 * Проверка утверждает именно то, что обещано пользователю:
 *
 *   1. каждый раздел из реестра открывается по своему адресу и в нём есть содержимое;
 *   2. в консоли браузера нет ошибок;
 *   3. страница не расширяется по горизонтали (нет горизонтальной прокрутки документа);
 *   4. для роли SUPPORT панель действительно только для чтения: ни одного помеченного
 *      изменяющего действия (`data-admin-write`) и баннер «только чтение» на месте;
 *   5. для роли ADMIN такого баннера нет, а у разделов, объявленных изменяющими, помеченное
 *      действие есть.
 *
 * Запуск (нужен dev-сервер веба на 5173):
 *   cd C:\taxi\web
 *   node e2e/check-admin.mjs                 # все разделы, обе роли; режим выберется сам
 *   node e2e/check-admin.mjs overview trips  # только эти разделы
 *   node e2e/check-admin.mjs --stub          # без стека: заглушка вместо токена
 *
 * Режим выбирается по доступности шлюза: если `/actuator/health` отвечает, берётся настоящий
 * токен у `auth/token` и разделы обязаны показать данные; если шлюза нет — сессия-заглушка и
 * проверка только интерфейса, ролей и вёрстки. `--stub` заставляет второй режим принудительно.
 */
import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5173';
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:8080';
const OUT = resolve(process.env.OUT ?? join(tmpdir(), 'orta-admin-check'));
const SECTIONS_FILE = resolve(process.env.SECTIONS ?? 'src/admin/sections.ts');
const PHONE = process.env.PHONE ?? '+77009990001';

/**
 * Режим выбирается сам, потому что ошибиться здесь легко и дорого: с сессией-заглушкой
 * поднятый шлюз отвечает 401, приложение уводит на экран входа, и проверка «падает» на
 * ровном месте. Поэтому по умолчанию — живой режим, если шлюз отвечает; `--stub` включает
 * прогон без стека принудительно.
 */
async function apiReachable() {
  try {
    const response = await fetch(`${API_URL}/actuator/health`, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
}

const STUB = process.argv.includes('--stub');
const LIVE = !STUB && (process.argv.includes('--live') || (await apiReachable()));

/** Разделы берём из реестра: он источник правды, а не список в этом файле. */
async function readSections() {
  const text = await readFile(SECTIONS_FILE, 'utf8');
  const entries = [...text.matchAll(/id:\s*'([a-z-]+)',[\s\S]*?(?=\n  \},|\n\];)/g)];
  return entries.map((m) => {
    const block = m[0];
    const title = /title:\s*'([^']+)'/.exec(block);
    return {
      id: m[1],
      title: title ? title[1] : m[1],
      // Раздел, который меняет данные, обязан иметь хотя бы одно помеченное действие
      // (см. data-admin-write) — иначе правило «SUPPORT только читает» нечем проверить.
      writes: /write:\s*'/.test(block),
    };
  });
}

/**
 * Настоящая сессия: роли выдаёт тот же эндпоинт, что и экран входа. Без поднятого
 * стека он недоступен, поэтому есть запасной путь — сессия-заглушка ниже.
 */
async function liveSession(roles) {
  const response = await fetch(`${API_URL}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ phone: PHONE, code: '0000', displayName: 'Админ-проверка', roles }),
  });
  if (!response.ok) throw new Error(`токен не получен: HTTP ${response.status}`);
  const token = await response.json();
  const now = Date.now();
  return {
    accessToken: token.accessToken,
    tokenType: token.tokenType ?? 'Bearer',
    userId: token.userId,
    roles: token.roles ?? roles,
    displayName: 'Админ-проверка',
    phone: PHONE,
    issuedAt: now,
    expiresAt: now + (token.expiresIn ?? 3600) * 1000,
  };
}

/**
 * Сессия-заглушка для прогона без стека. Токен ненастоящий: сервер на него ответит 401,
 * и разделы покажут свои честные состояния ошибки — именно это и проверяется в вёрстке.
 */
function stubSession(roles) {
  const now = Date.now();
  return {
    accessToken: `stub.${roles.join('.')}.token`,
    tokenType: 'Bearer',
    userId: 'U-ADMIN-CHECK',
    roles,
    displayName: 'Админ-проверка',
    phone: PHONE,
    issuedAt: now,
    expiresAt: now + 3_600_000,
  };
}

/** Ошибки, которые без поднятого стека ожидаемы: прокси не может достучаться до шлюза. */
function isExpectedOfflineError(text) {
  return (
    /Failed to load resource/i.test(text) ||
    /net::ERR_/i.test(text) ||
    /ERR_CONNECTION/i.test(text) ||
    /\[api\][\s\S]*failed/i.test(text) ||
    /500 \(Internal Server Error\)/i.test(text) ||
    /502 \(Bad Gateway\)/i.test(text) ||
    /503 \(Service Unavailable\)/i.test(text) ||
    /404 \(Not Found\)/i.test(text)
  );
}

/**
 * У части разделов изменяющее действие появляется только после выбора сущности: в «Счетах»
 * форма лимитов рисуется после того, как счёт открыт по идентификатору. Проверка ведёт себя
 * как человек — берёт настоящий идентификатор у API и открывает счёт, — иначе правило «у
 * изменяющего раздела есть помеченное действие» проверяло бы пустую страницу.
 */
async function seedLookup(page, section, session) {
  if (section.id !== 'accounts') {
    return false;
  }
  const response = await fetch(`${API_URL}/api/v1/accounts`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  if (!response.ok) {
    return false;
  }
  const accounts = await response.json();
  const accountId = Array.isArray(accounts) && accounts.length > 0 ? accounts[0].id : null;
  if (!accountId) {
    return false;
  }
  const input = page.locator('[data-admin-section] input[type="text"], [data-admin-section] input:not([type])').first();
  if ((await input.count()) === 0) {
    return false;
  }
  await input.fill(accountId);
  await page.locator('[data-admin-section] button[type="submit"]').first().click();
  await page.waitForTimeout(1_200);
  return true;
}

const sections = await readSections();
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const selected = only.length > 0 ? sections.filter((s) => only.includes(s.id)) : sections;
const problems = [];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const roles = ['ADMIN', 'SUPPORT'];

for (const role of roles) {
  const session = LIVE ? await liveSession([role]) : stubSession([role]);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    ['taxi.session', JSON.stringify(session)],
  );
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  for (const section of selected) {
    consoleErrors.length = 0;
    await page.goto(`${WEB_URL}/admin/${section.id}`, { waitUntil: 'domcontentloaded' });

    const shell = page.locator('[data-admin-shell]');
    const shellCount = await shell.count();
    if (shellCount !== 1) {
      problems.push(`${role}/${section.id}: оболочка админки не найдена (найдено ${shellCount})`);
      continue;
    }

    // Раздел подгружается лениво: ждём именно его, а не «сеть успокоилась» — с
    // недоступным API сеть не успокаивается никогда.
    const main = page.locator('[data-admin-section]');
    await main.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(LIVE ? 1_500 : 800);

    const active = await page.locator('[data-admin-nav] a').count();
    if (active !== sections.length) {
      problems.push(`${role}/${section.id}: в меню ${active} разделов, ожидалось ${sections.length}`);
    }

    const text = ((await main.textContent()) ?? '').trim();
    if (text.length < 40) {
      problems.push(`${role}/${section.id}: содержимое раздела пустое (${text.length} символов)`);
    } else if (/ещё не сделан/.test(text)) {
      problems.push(`${role}/${section.id}: раздела нет — нет файла src/admin/sections/${section.id}.tsx`);
    }

    const heading = ((await page.locator('h1').first().textContent()) ?? '').trim();
    if (heading !== section.title) {
      problems.push(`${role}/${section.id}: заголовок «${heading}», ожидался «${section.title}»`);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 1) {
      problems.push(`${role}/${section.id}: горизонтальная прокрутка документа на ${overflow} px`);
    }

    // Панель десктопная, но открыть её могут и с телефона: проверяем, что на узком экране
    // страница не разъезжается по горизонтали. Меню при этом становится полосой, а таблицы
    // уезжают в собственный скролл — это и есть ожидаемое поведение, а не дефект.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const narrowOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (narrowOverflow > 1) {
      problems.push(`${role}/${section.id}: на ширине 390 px горизонтальная прокрутка на ${narrowOverflow} px`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(200);

    const banner = await page.locator('[data-admin-readonly-banner]').count();
    // Правило «SUPPORT только читает» проверяется по разметке, а не по догадкам о тексте
    // кнопок: изменяющее действие обязано быть помечено `data-admin-write`, и для SUPPORT
    // таких элементов не должно быть ни одного. Поисковая форма — не изменяющее действие,
    // поэтому форма сама по себе проблемой не считается.
    const readWriteControls = () =>
      main.locator('[data-admin-write]').evaluateAll((nodes) =>
        nodes.map((node) => {
          const label = (node.getAttribute('data-admin-write') ?? '').trim();
          const text = (node.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
          return label.length > 0 ? label : text || node.tagName.toLowerCase();
        }),
      );

    let writeControls = await readWriteControls();
    if (role === 'ADMIN' && section.writes && writeControls.length === 0 && LIVE) {
      if (await seedLookup(page, section, session)) {
        writeControls = await readWriteControls();
      }
    }

    if (role === 'SUPPORT') {
      if (banner === 0) {
        problems.push(`${role}/${section.id}: нет пометки «только чтение»`);
      }
      if (writeControls.length > 0) {
        problems.push(
          `${role}/${section.id}: SUPPORT видит изменяющие действия: ${writeControls.join(', ')}`,
        );
      }
    } else {
      if (banner > 0) {
        problems.push(`${role}/${section.id}: у ADMIN показана пометка «только чтение»`);
      }
      if (section.writes && writeControls.length === 0) {
        problems.push(
          `${role}/${section.id}: раздел объявлен изменяющим (write в реестре), но ни одно действие не помечено data-admin-write`,
        );
      }
    }

    const unexpected = LIVE ? consoleErrors : consoleErrors.filter((e) => !isExpectedOfflineError(e));
    if (unexpected.length > 0) {
      problems.push(`${role}/${section.id}: ошибки в консоли: ${unexpected.slice(0, 3).join(' | ')}`);
    }

    // С поднятым стеком раздел обязан показать данные, а не сообщение об ошибке: именно
    // это отличает «панель работает» от «панель красиво падает».
    if (LIVE) {
      const alerts = (await main.locator('[role="alert"]').allTextContents()).join(' ');
      if (/не удалось|ошибка сервиса|внутренняя ошибка/i.test(alerts)) {
        problems.push(`${role}/${section.id}: раздел показывает ошибку загрузки: ${alerts.trim().slice(0, 120)}`);
      }
    }

    await page.screenshot({ path: join(OUT, `${role.toLowerCase()}-${section.id}.png`), fullPage: false });
  }

  await context.close();
}

await browser.close();

const mode = LIVE
  ? 'живой стек: данные обязаны приходить'
  : 'без стека: проверены интерфейс, роли и вёрстка; данные НЕ проверялись';
console.log(`Разделов: ${selected.length}, ролей: ${roles.length}, режим: ${mode}`);
console.log(`Скриншоты: ${OUT}`);
if (problems.length === 0) {
  console.log('Проблем нет.');
  process.exit(0);
}
console.log(`Проблем: ${problems.length}`);
for (const problem of problems) {
  console.log(`  - ${problem}`);
}
process.exit(1);
