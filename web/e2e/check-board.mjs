/**
 * Проверка дизайн-борда ORTA (docs/design/orta-screens.html).
 *
 * Не тест, а инструмент: борд — один самодостаточный HTML на полтора мегабайта,
 * и после каждой правки нужно убедиться, что он (а) открывается без ошибок в
 * консоли, (б) не поехал по горизонтали, (в) не потерял разделы и подписи.
 *
 * Запуск (из каталога web, там установлен Playwright):
 *   cd C:\taxi\web
 *   node e2e/check-board.mjs
 *
 * Переменные окружения: BOARD (file:// или путь к другому файлу борда),
 * OUT (каталог для скриншотов новых разделов; по умолчанию — временный).
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BOARD = process.env.BOARD ?? 'file:///C:/taxi/docs/design/orta-screens.html';
const OUT = resolve(process.env.OUT ?? join(tmpdir(), 'orta-board-check'));
const VIEWPORT = { width: 1600, height: 1000 };

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 0.5 });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(BOARD, { waitUntil: 'load' });
await page.waitForTimeout(1500);

const counts = await page.evaluate(() => {
  const sections = [...document.querySelectorAll('section.sec')];
  const top = sections.filter((s) => {
    const num = s.querySelector('.sec-num')?.textContent?.trim() ?? '';
    return /^\d+$/.test(num);
  });
  const perSection = top.map((s) => ({
    num: s.querySelector('.sec-num')?.textContent?.trim() ?? '?',
    title: (s.querySelector('h2')?.textContent ?? '').replace(/^\d+/, '').trim(),
    screens: s.querySelectorAll('.swrap').length,
    consoles: s.querySelectorAll('.phone.tablet').length,
    caps: s.querySelectorAll('.cap-num').length,
  }));
  const titles = [...document.querySelectorAll('.cap-title')].map((t) => t.textContent.trim());
  const dupes = titles.filter((t, i) => titles.indexOf(t) !== i);
  // Номера подписей должны быть сквозными: карта покрытия ссылается именно на них.
  const nums = [...document.querySelectorAll('.cap-num')].map((n) => n.textContent.trim());
  const dupNums = nums.filter((n, i) => nums.indexOf(n) !== i);
  return {
    topSections: top.length,
    screens: document.querySelectorAll('.swrap').length,
    consoles: document.querySelectorAll('.phone.tablet').length,
    captions: document.querySelectorAll('.cap-num').length,
    coverageRows: (() => {
      // Считаем строки именно таблицы покрытия — последней .cov в документе.
      // Во фрагментах есть свои таблицы с тем же классом, и они искажали число.
      const tables = [...document.querySelectorAll('table.cov')];
      const last = tables[tables.length - 1];
      return last ? last.querySelectorAll('tbody tr').length : 0;
    })(),
    docHeight: document.body.scrollHeight,
    docWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    duplicateTitles: [...new Set(dupes)],
    duplicateNumbers: [...new Set(dupNums)],
    perSection,
  };
});

console.log(`[борд] разделов: ${counts.topSections}, экранов: ${counts.screens}, консолей: ${counts.consoles}, подписей: ${counts.captions}`);
console.log(`[борд] строк карты покрытия: ${counts.coverageRows}`);
console.log(`[борд] размер документа: ${counts.docWidth}×${counts.docHeight}px (окно ${counts.viewportWidth}px)`);
if (counts.docWidth > counts.viewportWidth + 8) {
  console.log(`[борд] ВНИМАНИЕ: горизонтальное переполнение на ${counts.docWidth - counts.viewportWidth}px`);
}
for (const s of counts.perSection) {
  console.log(`[борд]   ${s.num}. ${s.title} — экранов ${s.screens}, консолей ${s.consoles}, подписей ${s.caps}`);
}
if (counts.duplicateTitles.length > 0) {
  console.log(`[борд] одинаковые названия подписей: ${JSON.stringify(counts.duplicateTitles.slice(0, 8))}`);
}
if (counts.duplicateNumbers.length > 0) {
  console.log(`[борд] ВНИМАНИЕ: номера подписей повторяются (${counts.duplicateNumbers.length}): ${JSON.stringify(counts.duplicateNumbers.slice(0, 10))}`);
} else {
  console.log('[борд] номера подписей сквозные, повторов нет');
}

// Обрезка контента внутри рамок: рамка — фиксированный размер с overflow:hidden,
// поэтому слишком высокое содержимое молча исчезает. Ловим числом, а не глазами.
// Проверяются ОБА вида рамок: консоль (.phone.tablet, 1024x768) и телефон
// (.phone, 390x844). Проверять только консоли недостаточно — так был пропущен
// целый фрагмент из 20 мобильных экранов, обрезанных на 57–624 px.
const clipped = await page.evaluate(() => {
  const bad = [];
  for (const frame of document.querySelectorAll('.phone')) {
    const section = frame.closest('section.sec');
    const num = section?.querySelector('.sec-num')?.textContent?.trim() ?? '?';
    // Подпись экрана: сначала своя у .swrap (мобильный экран), и только потом у .stage.
    // Иначе у фрагментов, чьи экраны завёрнуты в один общий .stage, все кадры
    // подписываются первой попавшейся подписью.
    const title = frame.closest('.swrap')?.querySelector('.cap-title')?.textContent?.trim()
      ?? frame.closest('.stage')?.querySelector('.cap-title')?.textContent?.trim() ?? '?';
    const isConsole = frame.classList.contains('tablet');
    const panes = isConsole
      ? frame.querySelectorAll('.tab-main, .panel, .cover-wrap')
      : frame.querySelectorAll('.ph');
    for (const pane of panes) {
      const over = pane.scrollHeight - pane.clientHeight;
      const overX = pane.scrollWidth - pane.clientWidth;
      if (over > 4 || overX > 4) {
        bad.push({ section: num, screen: title, kind: isConsole ? 'консоль' : 'телефон', pane: pane.className.split(' ')[0], over, overX });
      }
    }
  }
  return bad;
});
if (clipped.length > 0) {
  const byScreen = new Map();
  for (const c of clipped) {
    const key = `${c.section}|${c.kind}|${c.screen}`;
    const prev = byScreen.get(key) ?? { over: 0, overX: 0 };
    byScreen.set(key, { over: Math.max(prev.over, c.over), overX: Math.max(prev.overX, c.overX) });
  }
  console.log(`[борд] ВНИМАНИЕ: контент обрезан в ${clipped.length} панелях на ${byScreen.size} экранах`);
  let shown = 0;
  for (const [key, v] of byScreen) {
    if (shown++ >= 12) { console.log(`[борд]   …и ещё ${byScreen.size - 12} экранов`); break; }
    const [section, kind, screen] = key.split('|');
    console.log(`[борд]   раздел ${section}, ${kind}: ${screen} — по высоте ${v.over}px, по ширине ${v.overX}px`);
  }
} else {
  console.log('[борд] обрезки контента нет ни в телефонах, ни в консолях');
}

// Геометрическая проверка: любой потомок рамки, чей прямоугольник выходит за её
// границы, уже обрезан overflow:hidden — даже если он не .panel и нигде не
// скроллится (так был пропущен длинный немаркируемый токен в флекс-строке).
const spilled = await page.evaluate(() => {
  const bad = [];
  for (const frame of document.querySelectorAll('.phone')) {
    const fr = frame.getBoundingClientRect();
    const section = frame.closest('section.sec')?.querySelector('.sec-num')?.textContent?.trim() ?? '?';
    // Подпись экрана: сначала своя у .swrap (мобильный экран), и только потом у .stage.
    // Иначе у фрагментов, чьи экраны завёрнуты в один общий .stage, все кадры
    // подписываются первой попавшейся подписью.
    const title = frame.closest('.swrap')?.querySelector('.cap-title')?.textContent?.trim()
      ?? frame.closest('.stage')?.querySelector('.cap-title')?.textContent?.trim() ?? '?';
    let worst = null;
    for (const el of frame.querySelectorAll('*')) {
      // Внутренние узлы SVG (rect/path/use) дают прямоугольники в своих координатах
      // и дают ложные «выходы за рамку» — проверяем только HTML-элементы.
      if (!(el instanceof HTMLElement)) continue;
      const r = el.getBoundingClientRect();
      const overRight = Math.round(r.right - fr.right);
      const overBottom = Math.round(r.bottom - fr.bottom);
      const over = Math.max(overRight, overBottom);
      if (over > 4 && (!worst || over > worst.over)) {
        worst = { over, overRight, overBottom, cls: String(el.className || el.tagName).split(' ')[0] };
      }
    }
    if (worst) bad.push({ section, screen: title, ...worst });
  }
  return bad;
});
if (spilled.length > 0) {
  console.log(`[борд] ВНИМАНИЕ: за границы рамки выходят элементы на ${spilled.length} экранах`);
  for (const s of spilled.slice(0, 8)) {
    console.log(`[борд]   раздел ${s.section}: ${s.screen} — .${s.cls} выходит на ${s.over}px (вправо ${s.overRight}, вниз ${s.overBottom})`);
  }
} else {
  console.log('[борд] за границы рамок ничего не выходит');
}

// Сжатие флексом. Третий вид дефекта, который не видят ни scrollHeight, ни
// геометрия: блок сжимается как flex-элемент (например .banner до 18px вместо 73),
// его содержимое гаснет под собственным overflow:hidden, а рамку он не покидает —
// потомки внутри сжатого блока. Меряем естественную высоту: временно снимаем
// flex/height у каждого прямого ребёнка .ph и сравниваем с фактической.
const squeezed = await page.evaluate(() => {
  const bad = [];
  for (const frame of document.querySelectorAll('.phone')) {
    const ph = frame.querySelector('.ph');
    if (!ph) continue;
    const section = frame.closest('section.sec')?.querySelector('.sec-num')?.textContent?.trim() ?? '?';
    const title = frame.closest('.swrap')?.querySelector('.cap-title')?.textContent?.trim()
      ?? frame.closest('.stage')?.querySelector('.cap-title')?.textContent?.trim() ?? '?';
    let worst = null;
    for (const child of [...ph.children]) {
      // Карты — иллюстрация, она масштабируется: сжатие .mapbox/.mapcard не дефект.
      // Пустые по тексту блоки тоже пропускаем — терять в них нечего.
      const cls = String(child.className || child.tagName);
      if (/mapbox|mapcard/.test(cls)) continue;
      if (child.textContent.trim().length === 0) continue;
      const actual = child.getBoundingClientRect().height;
      const saved = { flex: child.style.flex, height: child.style.height, minHeight: child.style.minHeight };
      child.style.flex = 'none';
      child.style.height = 'auto';
      child.style.minHeight = '0';
      const natural = child.getBoundingClientRect().height;
      child.style.flex = saved.flex;
      child.style.height = saved.height;
      child.style.minHeight = saved.minHeight;
      const diff = Math.round(natural - actual);
      if (diff > 4 && (!worst || diff > worst.diff)) {
        worst = { diff, cls: String(child.className || child.tagName).split(' ')[0], actual: Math.round(actual), natural: Math.round(natural) };
      }
    }
    if (worst) bad.push({ section, screen: title, ...worst });
  }
  return bad;
});
if (squeezed.length > 0) {
  console.log(`[борд] ВНИМАНИЕ: блоки сжаты флексом на ${squeezed.length} экранах`);
  for (const s of squeezed.slice(0, 8)) {
    console.log(`[борд]   раздел ${s.section}: ${s.screen} — .${s.cls} сжат до ${s.actual}px при естественных ${s.natural}px`);
  }
} else {
  console.log('[борд] сжатых флексом блоков нет');
}

// Скриншоты новых разделов — по одному на контур, чтобы видеть, что вёрстка цела.
const wanted = [
  'ORTA Business — кабинет бизнеса',
  'QTime CRM — расписание и клиенты',
  'Поддержка, операционный пульт и админка',
  'Приложения: водитель, курьер, мерчант',
  'Платформенные сервисы',
];

for (const title of wanted) {
  // Ищем именно раздел верхнего уровня: у подразделов (1.1, 1.4) номер с точкой,
  // и «Платформенные сервисы» есть и там — по одному тексту легко снять не тот блок.
  const idx = await page.evaluate((want) => {
    const tops = [...document.querySelectorAll('section.sec')].filter(
      (s) => /^\d+$/.test(s.querySelector('.sec-num')?.textContent?.trim() ?? ''),
    );
    tops.forEach((s) => s.removeAttribute('data-check-target'));
    const found = tops.find((s) => (s.querySelector('h2')?.textContent ?? '').includes(want));
    if (!found) return -1;
    found.setAttribute('data-check-target', '1');
    return tops.indexOf(found);
  }, title);

  if (idx < 0) {
    console.log(`[борд] раздел для скриншота не найден: ${title}`);
    continue;
  }
  const section = page.locator('section[data-check-target="1"]').first();
  const name = title.replace(/[^A-Za-zА-Яа-я0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const box = await section.boundingBox();
  console.log(`[борд] ${title}: высота ${Math.round(box?.height ?? 0)}px -> ${name}.png`);
  await section.screenshot({ path: resolve(OUT, `${name}.png`) });
}

// Проверка на ноутбучной ширине: консольные рамки 1024px легко переполняют страницу,
// и тогда борд начинает скроллиться по горизонтали — этого быть не должно.
for (const width of [1920, 1440, 1280, 1024]) {
  const probe = await browser.newPage({ viewport: { width, height: 900 } });
  await probe.goto(BOARD, { waitUntil: 'load' });
  await probe.waitForTimeout(400);
  const m = await probe.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
    wide: [...document.querySelectorAll('.stage')].filter((s) => s.getBoundingClientRect().width > window.innerWidth).length,
    // кто именно вылезает за окно: класс и правый край
    offenders: [...document.querySelectorAll('body *')]
      .map((e) => ({ cls: String(e.className || e.tagName).split(' ')[0], right: Math.round(e.getBoundingClientRect().right) }))
      .filter((e) => e.right > window.innerWidth + 8)
      .sort((a, b) => b.right - a.right)
      .slice(0, 4),
  }));
  const mark = m.doc > m.win + 8 ? `ПЕРЕПОЛНЕНИЕ на ${m.doc - m.win}px` : 'ок';
  console.log(`[борд] ширина ${width}px: документ ${m.doc}px — ${mark}; блоков шире окна: ${m.wide}`);
  if (m.offenders.length > 0) {
    console.log(`[борд]   вылезают: ${JSON.stringify(m.offenders)}`);
  }
  await probe.close();
}

console.log(errors.length > 0
  ? `[борд] ошибки консоли (${errors.length}): ${JSON.stringify(errors.slice(0, 5))}`
  : '[борд] ошибок консоли нет');
console.log(`[борд] скриншоты: ${OUT}`);

await browser.close();
