/**
 * Извлекает из борда `docs/design/orta-screens.html` всё, что нужно вертикальной
 * истории: таблицу стилей (дизайн-токены и компоненты), библиотеку inline-SVG
 * (иконки, карта, логотип) и разметку конкретных экранов телефона.
 *
 * Запуск: из каталога web (там установлен Playwright)
 *   cd C:\taxi\web
 *   node ..\docs\design\story\extract.mjs
 *
 * Результат: `assets/board.css`, `assets/defs.html`, `assets/phones.mjs`.
 * Борд не изменяется: скрипт только читает.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Playwright установлен в web/ — этот каталог лежит вне области его разрешения,
// поэтому тянем пакет оттуда явно, а не полагаемся на поиск node_modules вверх.
const require = createRequire(resolve(HERE, '../../../web/package.json'));
const { chromium } = require('@playwright/test');
const ASSETS = resolve(HERE, 'assets');
const BOARD = process.env.BOARD ?? 'file:///C:/taxi/docs/design/orta-screens.html';

// Заголовки экранов, которые попадают в историю.
const WANTED = [
  'Вход',
  'Главная ORTA',
  'ORTA Taxi — заказ',
  'ORTA Taxi — поиск водителя',
  'ORTA Taxi — водитель в пути',
  'ORTA Taxi — в пути и завершение',
  'Чек поездки и оценка',
  'ORTA Market — витрина',
  'Карточка товара',
  'ORTA Services — запись создана',
  'ORTA Beauty — подборки салонов',
  'ORTA Health — клиники и подбор врача',
  'ORTA Food — подборки и заведения рядом',
  'ORTA AI — план дня',
  'ORTA Pay — счёт и баланс',
  'Кабинет водителя',
  'Заработок за смену',
];

await mkdir(ASSETS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(BOARD, { waitUntil: 'load' });
await page.waitForTimeout(1200);

const extracted = await page.evaluate((wanted) => {
  const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  const defs = document.querySelector('body > svg defs')?.innerHTML ?? '';

  const wrappers = [...document.querySelectorAll('.swrap')];
  const byTitle = new Map();
  for (const w of wrappers) {
    const title = w.querySelector('.cap-title')?.textContent?.trim() ?? '';
    if (!title) continue;
    if (byTitle.has(title)) continue;
    const phone = w.querySelector('.phone');
    if (!phone) continue;
    byTitle.set(title, phone.outerHTML);
  }

  const phones = {};
  const missing = [];
  for (const title of wanted) {
    const html = byTitle.get(title);
    if (html) phones[title] = html;
    else missing.push(title);
  }
  return { css, defs, phones, missing, available: [...byTitle.keys()] };
}, WANTED);

await browser.close();

await writeFile(resolve(ASSETS, 'board.css'), extracted.css, 'utf8');
await writeFile(resolve(ASSETS, 'defs.html'), extracted.defs, 'utf8');

// Те же определения отдельным модулем: страница истории подключает их импортом
// и не делает ни одного fetch — file:// остаётся самодостаточным.
await writeFile(
  resolve(ASSETS, 'defs-inline.js'),
  `/**
 * Сгенерировано extract.mjs из docs/design/orta-screens.html — не редактировать вручную.
 * Библиотека inline-SVG борда (иконки статус-бара, карта, маршруты, логотип).
 */
const defs = ${JSON.stringify(extracted.defs)};

const host = document.getElementById('board-defs');
if (host) host.innerHTML = defs;
export default defs;
`,
  'utf8',
);

const banner = `/**
 * Сгенерировано extract.mjs из docs/design/orta-screens.html — не редактировать вручную.
 * Разметка реальных экранов борда: рамка 390x844 (iPhone 14 / Pixel 7 в dp).
 */\n`;

const names = Object.keys(extracted.phones);
await writeFile(
  resolve(ASSETS, 'phones.mjs'),
  banner + `export const phones = ${JSON.stringify(extracted.phones, null, 2)};\n`,
  'utf8',
);

console.log(`[story] стилей: ${extracted.css.length} символов, defs: ${extracted.defs.length} символов`);
console.log(`[story] экранов извлечено: ${names.length}`);
for (const n of names) console.log(`[story]   ok  ${n} (${extracted.phones[n].length} симв.)`);
if (extracted.missing.length > 0) {
  console.log(`[story] НЕ найдены: ${JSON.stringify(extracted.missing)}`);
  process.exitCode = 1;
}
