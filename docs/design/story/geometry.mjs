/**
 * Отчёт по геометрии кадра: печатает рамки всех элементов каждой сцены.
 * Нужен, чтобы проверять раскладку числами, а не на глаз по картинке.
 *
 * Запуск: cd C:\taxi\web && node ..\docs\design\story\geometry.mjs 48,144,400
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(HERE, '../../../web/package.json'));
const { chromium } = require('@playwright/test');

const FRAMES = (process.argv[2] ?? '48,144,400').split(',').map(Number);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://l').pathname).replace(/^[/]+/, '');
  try {
    const file = resolve(HERE, rel === '' ? 'story.html' : rel);
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('nf');
  }
});
await new Promise((d) => server.listen(0, '127.0.0.1', d));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${port}/story.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__STORY_READY__ === true, null, { timeout: 20000 });
await page.evaluate(() => window.__storySetAnimated(false));

for (const f of FRAMES) {
  const rows = await page.evaluate((frame) => {
    window.__storyRender(frame);
    const out = [];
    for (const sc of document.querySelectorAll('.scene')) {
      const cs = getComputedStyle(sc);
      if (cs.display === 'none') continue;
      const kids = [...sc.children].map((c) => {
        const b = c.getBoundingClientRect();
        return {
          name: c.id || (c.querySelector('.phone') ? 'frame' : c.className),
          pos: getComputedStyle(c).position,
          l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), bo: Math.round(b.bottom),
          op: Number(c.style.opacity || 1).toFixed(2),
        };
      });
      out.push({ scene: sc.dataset.scene, op: cs.opacity, kids });
    }
    return out;
  }, f);

  console.log(`\n===== кадр ${f}`);
  for (const s of rows) {
    console.log(`  сцена ${s.scene} (op ${s.op})`);
    for (const k of s.kids) {
      const clip = k.t < 0 || k.bo > 1920;
      console.log(
        `    ${String(k.name).padEnd(12)} ${k.pos.padEnd(9)} x ${String(k.l).padStart(5)}..${String(k.r).padEnd(5)} y ${String(k.t).padStart(5)}..${String(k.bo).padEnd(5)} op=${k.op}${clip ? '  ВЫХОДИТ ЗА КАДР' : ''}`,
      );
    }
  }
}

await browser.close();
server.close();
