/**
 * Рендер кадров истории ORTA.
 *
 * Кадры не записываются «в реальном времени», а вычисляются: браузеру на каждом
 * шаге отдаётся номер кадра, страница сама расставляет элементы. Поэтому рендер
 * повторяем, не зависит от нагрузки на машину и не «плывёт» по времени, а любой
 * отрезок можно перерисовать, не прогоняя всё заново.
 *
 * Запуск: из каталога web (там установлен Playwright)
 *   cd C:\taxi\web
 *   node ..\docs\design\story\render.mjs
 *
 * Переменные окружения:
 *   FROM=0 END=1140   отрезок кадров (для проверки одной сцены)
 *   OUT=...           каталог для кадров (по умолчанию ./frames)
 *   FORMAT=png|jpeg   формат кадра (png по умолчанию: без потерь для UI)
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FPS, WIDTH, HEIGHT, TOTAL_FRAMES } from './timing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(HERE, '../../../web/package.json'));
const { chromium } = require('@playwright/test');

const FROM = Number(process.env.FROM ?? 0);
const END = Number(process.env.END ?? TOTAL_FRAMES);
const FORMAT = process.env.FORMAT ?? 'png';
/** CHECKPOINTS=48,144,... — снять только эти кадры (быстрая вычитка сцен). */
const CHECKPOINTS = (process.env.CHECKPOINTS ?? '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean)
  .map(Number);
const OUT = resolve(process.env.OUT ?? join(HERE, 'frames'));
const EXT = FORMAT === 'jpeg' ? 'jpg' : 'png';

/**
 * story.html подключает ES-модули, а Chrome запрещает их с file:// (CORS,
 * origin null). Поэтому на время рендера каталог отдаётся крошечным локальным
 * сервером на 127.0.0.1 — страница никуда не публикуется.
 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  try {
    const rel = normalize(decodeURIComponent(new URL(req.url, 'http://localhost').pathname)).replace(/^[\\/]+/, '');
    const file = resolve(HERE, rel === '' ? 'story.html' : rel);
    if (!file.startsWith(HERE)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500).end(String(err.message));
  }
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none'] });
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
});

const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(m.text());
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(`${origin}/story.html`, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => window.__STORY_READY__ === true, null, { timeout: 20000 });

// Кадр должен быть ровно тем, что вычислила страница: переходы выключаются,
// иначе браузер интерполирует состояние между кадрами.
await page.evaluate(() => window.__storySetAnimated(false));

const missing = await page.evaluate(() => document.querySelectorAll('#story [data-missing]').length);
if (missing > 0) problems.push(`экранов не найдено: ${missing} (см. assets/phones.mjs)`);

// Скриншот через CDP: быстрее обычного page.screenshot и не трогает анимации.
const cdp = await page.context().newCDPSession(page);
const digits = String(TOTAL_FRAMES - 1).length;
const started = Date.now();
const queue = CHECKPOINTS.length > 0
  ? CHECKPOINTS
  : Array.from({ length: Math.max(0, END - FROM) }, (_, i) => FROM + i);
const total = queue.length;

for (const f of queue) {
  await page.evaluate((frame) => window.__storyRender(frame), f);
  // Двойной rAF гарантирует, что новый кадр отрисован, прежде чем его снимать.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

  const { data } = await cdp.send('Page.captureScreenshot', {
    format: FORMAT,
    ...(FORMAT === 'jpeg' ? { quality: 95 } : {}),
    captureBeyondViewport: false,
    optimizeForSpeed: true,
  });
  await writeFile(join(OUT, `f${String(f).padStart(digits, '0')}.${EXT}`), Buffer.from(data, 'base64'));

  const done = queue.indexOf(f) + 1;
  const rate = done / ((Date.now() - started) / 1000);
  process.stdout.write(`\r[story] кадр ${f + 1}  (${done}/${total}, ${rate.toFixed(1)} кадр/с)   `);
}

await browser.close();
server.close();

const seconds = (Date.now() - started) / 1000;
console.log(`\r[story] кадров: ${total} за ${seconds.toFixed(1)} с (${FPS} к/с, ${WIDTH}x${HEIGHT}, ${FORMAT})`);

if (problems.length > 0) {
  console.log(`[story] ошибки страницы (${problems.length}):`);
  for (const p of [...new Set(problems)].slice(0, 10)) console.log(`[story]   ${p}`);
  process.exitCode = 1;
} else {
  console.log('[story] ошибок страницы нет');
}

await writeFile(
  join(HERE, 'render-info.json'),
  `${JSON.stringify({ from: FROM, end: END, fps: FPS, width: WIDTH, height: HEIGHT, format: FORMAT, seconds }, null, 2)}\n`,
  'utf8',
);
