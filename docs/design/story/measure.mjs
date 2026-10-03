/**
 * Измеряет реальные размеры внутренностей каждого экрана, отобранного для истории:
 * высоту прокручиваемого содержимого, высоту статус-бара и низ (home-индикатор).
 * Нужно, чтобы движение «прокрутки» внутри рамки в видео было точным, а не на глаз.
 *
 * Запуск: из каталога web
 *   cd C:\taxi\web
 *   node ..\docs\design\story\measure.mjs
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { phones } from './assets/phones.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(HERE, '../../../web/package.json'));
const { chromium } = require('@playwright/test');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const rows = [];
for (const [title, html] of Object.entries(phones)) {
  await page.setContent(
    `<style>html,body{margin:0;background:#fff}.host{width:390px;padding:0}</style><div class="host">${html}</div>`,
  );
  await page.addStyleTag({ path: resolve(HERE, 'assets/board.css') });
  await page.waitForTimeout(40);

  const m = await page.evaluate(() => {
    const scr = document.querySelector('.phone > .ph');
    if (!scr) return null;
    const kids = [...scr.children].map((c) => ({ h: Math.round(c.getBoundingClientRect().height), cls: c.className }));
    const cs = getComputedStyle(scr);
    return {
      contentH: Math.round(scr.scrollHeight),
      boxH: Math.round(scr.getBoundingClientRect().height),
      overflowY: cs.overflowY,
      padTop: cs.paddingTop,
      padBottom: cs.paddingBottom,
      kids,
      sbH: Math.round(document.querySelector('.phone > .sb')?.getBoundingClientRect().height ?? 0),
      indH: Math.round(document.querySelector('.phone > .home-ind')?.getBoundingClientRect().height ?? 0),
    };
  });

  if (!m) {
    rows.push({ title, error: 'нет .phone > .ph' });
    continue;
  }
  const maxScroll = Math.max(0, m.contentH - m.boxH);
  rows.push({ title, boxH: m.boxH, contentH: m.contentH, maxScroll, indH: m.indH, kids: m.kids.length });
}

await browser.close();

console.log('экран'.padEnd(40), 'рамка', 'контент', 'запас');
for (const r of rows) {
  if (r.error) {
    console.log(String(r.title).padEnd(40), r.error);
    continue;
  }
  console.log(
    String(r.title).padEnd(40),
    String(r.boxH).padStart(5),
    String(r.contentH).padStart(7),
    String(r.maxScroll).padStart(5),
  );
}
