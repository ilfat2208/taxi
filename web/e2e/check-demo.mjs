/**
 * Проверка демо-режима: все экраны открываются, влезают в рамку и не ругаются в консоли.
 *
 * Зачем отдельная проверка, если есть `pnpm test`: unit-тесты не откроют 162 экрана
 * в браузере и не заметят, что содержимое макета вылезло за рамку телефона. На борде
 * мы ровно на этом обожглись дважды (обрезка консолей и мобильных экранов), а здесь
 * то же самое повторилось бы в коде: рамка фиксированная, `overflow:hidden`, и лишнее
 * молча исчезает.
 *
 * Что проверяется по каждому экрану:
 *   1. страница открылась и в ней есть рамка устройства;
 *   2. ни один HTML-потомок рамки не выходит за её границы больше чем на 4 px
 *      (SVG-узлы исключены: их прямоугольники в своей системе координат);
 *   3. в консоли браузера нет ошибок;
 *   4. содержимое не «схлопнулось»: у экрана есть хотя бы несколько элементов.
 *
 * Запуск (нужны поднятый стек и dev-сервер веба):
 *   cd C:\taxi\web
 *   node e2e/check-demo.mjs                 # все экраны
 *   node e2e/check-demo.mjs transport-01    # один или несколько по id
 */
import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5173';
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:8080';
const OUT = resolve(process.env.OUT ?? join(tmpdir(), 'orta-demo-check'));
const REGISTRY = resolve(process.env.REGISTRY ?? 'src/demo/registry.ts');
const PHONE = process.env.PHONE ?? '+77009990001';

/** Реестр — источник правды: из него берём id, вид экрана и адрес настоящего раздела. */
async function readRegistry() {
  const text = await readFile(REGISTRY, 'utf8');
  const screens = [...text.matchAll(/\{\s*"id":\s*"([^"]+)",\s*"kind":\s*"([^"]+)",\s*"section":\s*(\d+)[\s\S]*?"title":\s*"([^"]+)"[\s\S]*?"status":\s*"([^"]+)"[\s\S]*?(?:"realRoute":\s*"([^"]+)")?/g)];
  return screens.map((m) => ({
    id: m[1],
    kind: m[2],
    section: Number(m[3]),
    title: m[4],
    status: m[5],
    realRoute: m[6] ?? null,
  }));
}

async function session() {
  const response = await fetch(`${API_URL}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ phone: PHONE, code: '0000', displayName: 'Демо-обход', roles: ['CUSTOMER'] }),
  });
  if (!response.ok) throw new Error(`токен не получен: HTTP ${response.status}`);
  const token = await response.json();
  const now = Date.now();
  return {
    accessToken: token.accessToken,
    tokenType: token.tokenType ?? 'Bearer',
    userId: token.userId,
    roles: token.roles ?? ['CUSTOMER'],
    displayName: 'Демо-обход',
    phone: PHONE,
    issuedAt: now,
    expiresAt: now + (token.expiresIn ?? 3600) * 1000,
  };
}

const all = await readRegistry();
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// Сессия нужна только для настоящих разделов приложения: демо-макеты открыты без
// входа. Если стек не поднят, обходим макеты и честно говорим, что пропустили.
let user = null;
try {
  user = await session();
} catch (failure) {
  console.log(`[демо] API недоступен (${failure.message}) — настоящие разделы пропускаем`);
}

let targets = all.filter((s) => only.length === 0 || only.includes(s.id));
if (!user) targets = targets.filter((s) => !s.realRoute);
if (targets.length === 0) {
  console.log('[демо] нечего проверять: реестр пуст или id не найдены');
  process.exit(1);
}

await mkdir(OUT, { recursive: true });
console.log(`[демо] экранов в реестре: ${all.length}, проверяем: ${targets.length}`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
if (user) {
  await context.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    'taxi.session',
    JSON.stringify(user),
  ]);
}
const page = await context.newPage();

const problems = [];
const missing = [];
for (const screen of targets) {
  const errors = [];
  const onConsole = (m) => {
    if (m.type() === 'error') errors.push(m.text());
  };
  const onPageError = (e) => errors.push(`pageerror: ${e.message}`);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  const url = screen.realRoute ? `${WEB_URL}${screen.realRoute.replace(/\{(\w+)\}/g, 'demo')}` : `${WEB_URL}/demo/${screen.id}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // Ждём рамку только для макетов: настоящие разделы грузят данные сами.
    if (!screen.realRoute) {
      // Экран может быть ещё не написан: страница честно показывает описание из
      // реестра. Это не сбой рендера — считаем отдельно, чтобы список проблем не
      // смешивал «не работает» и «ещё не сделано».
      const frame = await page.waitForSelector('[data-demo-frame]', { timeout: 15_000 }).catch(() => null);
      if (!frame) {
        const text = await page.evaluate(() => document.body.innerText);
        if (text.includes('ещё не перенесён')) {
          missing.push(screen.id);
        } else {
          problems.push({ id: screen.id, reason: 'рамка не появилась, и это не состояние «ещё не перенесён»' });
        }
        continue;
      }
    }
    await page.waitForTimeout(screen.realRoute ? 1500 : 350);

    if (!screen.realRoute) {
      const measure = await page.evaluate(() => {
        const frame = document.querySelector('[data-demo-frame]');
        const viewport = document.querySelector('[data-demo-viewport]');
        if (!frame || !viewport) return { error: 'нет рамки или области экрана' };
        const fr = frame.getBoundingClientRect();
        // Элемент, который обрезает промежуточный контейнер (overflow не visible),
        // наружу не виден — это не дефект макета, а обычный приём: так нарисованы,
        // например, «дороги» внутри карты-заглушки.
        const clippedByAncestor = (el) => {
          let node = el.parentElement;
          while (node && node !== frame) {
            const cs = getComputedStyle(node);
            if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return true;
            node = node.parentElement;
          }
          return false;
        };
        let worst = 0;
        let worstCls = '';
        for (const el of frame.querySelectorAll('*')) {
          if (!(el instanceof HTMLElement)) continue;
          if (clippedByAncestor(el)) continue;
          const r = el.getBoundingClientRect();
          const over = Math.max(Math.round(r.right - fr.right), Math.round(r.bottom - fr.bottom));
          if (over > worst) {
            worst = over;
            worstCls = String(el.className || el.tagName).split(' ')[0];
          }
        }
        return {
          over: worst,
          worstCls,
          nodes: frame.querySelectorAll('*').length,
          viewportHeight: Math.round(viewport.getBoundingClientRect().height),
        };
      });

      if (measure.error) {
        problems.push({ id: screen.id, reason: measure.error });
      } else {
        if (measure.over > 4) {
          problems.push({ id: screen.id, reason: `контент выходит за рамку на ${measure.over}px (.${measure.worstCls})` });
        }
        if (measure.nodes < 8) {
          problems.push({ id: screen.id, reason: `экран почти пустой: элементов ${measure.nodes}` });
        }
      }
    }

    if (errors.length > 0) {
      problems.push({ id: screen.id, reason: `ошибки консоли: ${errors.slice(0, 2).join(' | ')}` });
    }
  } catch (failure) {
    problems.push({ id: screen.id, reason: `не открылся: ${failure.message.split('\n')[0]}` });
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
}

// Ролевой вход: продукт, а не список макетов. Проверяем, что рабочая область роли
// открывается, что в ней есть меню экранов и что экран отрисовался без ошибок.
const roleIds = [...(await readFile('src/demo/roles.ts', 'utf8')).matchAll(/\n    id: '([a-z-]+)'/g)].map((m) => m[1]);
if (roleIds.length > 0 && only.length === 0) {
  const rolePage = await context.newPage();
  const roleProblems = [];
  for (const roleId of roleIds) {
    const roleErrors = [];
    const onConsole = (m) => {
      if (m.type() === 'error') roleErrors.push(m.text());
    };
    const onPageError = (e) => roleErrors.push(`pageerror: ${e.message}`);
    rolePage.on('console', onConsole);
    rolePage.on('pageerror', onPageError);
    try {
      await rolePage.goto(`${WEB_URL}/demo/${roleId}`, { waitUntil: 'domcontentloaded' });
      await rolePage.waitForTimeout(700);
      const state = await rolePage.evaluate(() => ({
        menuLinks: document.querySelectorAll('aside a[href^="/demo/"]').length,
        hasCaption: document.body.innerText.includes('Эндпоинты и события'),
        empty: document.body.innerText.trim().length < 200,
        text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 70),
      }));
      if (state.menuLinks === 0) roleProblems.push({ id: roleId, reason: 'в меню роли нет ни одного экрана' });
      if (!state.hasCaption) roleProblems.push({ id: roleId, reason: 'экран не отрисовался: нет справки под экраном' });
      if (state.empty) roleProblems.push({ id: roleId, reason: 'страница пустая' });
      if (roleErrors.length > 0) roleProblems.push({ id: roleId, reason: `ошибки консоли: ${roleErrors.slice(0, 2).join(' | ')}` });
      console.log(`[демо] роль ${roleId}: экранов в меню ${state.menuLinks} — ${state.text}`);
    } catch (failure) {
      roleProblems.push({ id: roleId, reason: `не открылась: ${failure.message.split('\n')[0]}` });
    } finally {
      rolePage.off('console', onConsole);
      rolePage.off('pageerror', onPageError);
    }
  }
  await rolePage.close();
  for (const p of roleProblems) console.log(`[демо]   роль ${p.id}: ${p.reason}`);
  problems.push(...roleProblems);
}

await browser.close();

console.log(`[демо] проверено экранов: ${targets.length}, проблем: ${problems.length}`);
for (const p of problems.slice(0, 40)) {
  console.log(`[демо]   ${p.id}: ${p.reason}`);
}
if (problems.length > 40) console.log(`[демо]   …и ещё ${problems.length - 40}`);
if (missing.length > 0) {
  console.log(`[демо] ещё не перенесены (${missing.length}): ${missing.slice(0, 15).join(', ')}${missing.length > 15 ? ' …' : ''}`);
}
const allowMissing = process.argv.includes('--allow-missing');
if (missing.length > 0 && !allowMissing) {
  console.log('[демо] незавершённые макеты считаются проблемой; для промежуточного прогона добавьте --allow-missing');
}
console.log(`[демо] окно проверки: ${OUT}`);
process.exit(problems.length === 0 && (missing.length === 0 || allowMissing) ? 0 : 1);
