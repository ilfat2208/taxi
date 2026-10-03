/**
 * Раскадровка вертикальной истории ORTA (1080x1920, 30 к/с, 38 секунд).
 *
 * Кадры не «играются» по времени, а вычисляются: для каждого кадра вызывается
 * render(frame), и все величины внутри — функции от номера кадра. Поэтому рендер
 * детерминирован: один и тот же прогон даёт одну и ту же историю.
 *
 * Экраны телефонов берутся из assets/phones.mjs — это разметка реальных экранов
 * борда docs/design/orta-screens.html, вместе с его дизайн-токенами
 * (assets/board.css) и библиотекой иконок (assets/defs.html). Ничего не рисуется
 * заново: история показывает сам борд.
 */
import { phones } from './assets/phones.mjs';
import { FPS, WIDTH, HEIGHT, TRANSITION_MS, SCENE_SPANS, CROSS, TOTAL_FRAMES } from './timing.mjs';

export { FPS, WIDTH, HEIGHT, TOTAL_FRAMES };

/* ------------------------------------------------------------------ утилиты */

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => {
  const c = 1.62;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

/** Кусочно-линейная кривая по кадрам: [[кадр, значение], ...]. */
function curve(frame, points) {
  if (frame <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (frame >= last[0]) return last[1];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [f0, v0] = points[i];
    const [f1, v1] = points[i + 1];
    if (frame >= f0 && frame <= f1) {
      const t = f1 === f0 ? 1 : (frame - f0) / (f1 - f0);
      return lerp(v0, v1, t);
    }
  }
  return last[1];
}

/* --------------------------------------------------------------- разметка */

const root = document.getElementById('story');
root.innerHTML = '<div id="scenes"></div>';

const scenes = [];

function scene(id, builder) {
  const [at, outAt] = SCENE_SPANS[id];
  const el = document.createElement('div');
  el.className = 'scene';
  el.dataset.scene = id;
  root.querySelector('#scenes').appendChild(el);
  scenes.push({ id, at, outAt, builder, el, plans: null });
}

/** Статичный слой (заголовок, подпись, чипы): позиция задаётся, размер — из класса. */
function box(sel, { y, x = 0, w = WIDTH, cls = 'scene-title' }) {
  return { sel, cls: cls.includes('box') ? cls : `box ${cls}`, style: { left: `${x}px`, top: `${y}px`, width: `${w}px` } };
}

/** Рамка экрана: масштаб считается от ширины, а не подбирается на глаз. */
function device(screen, { x, y, w, z = 1, fade = false }) {
  return {
    kind: 'device',
    screen,
    fade,
    // Класс frame обязателен: без него элемент остаётся в потоке и top игнорируется.
    cls: 'frame',
    style: { left: `${x}px`, top: `${y}px`, width: '390px', height: '844px', zIndex: String(z) },
    scale: w / 390,
  };
}

/** Мягкое «дыхание» рамки, чтобы статичный кадр не выглядел мёртвым. */
const breath = (f, phase = 0, amp = 0.013) => 1 + amp * Math.sin(((f / FPS) + phase) * Math.PI * 0.46);

/* ---------------------------------------------------------------- сценарий */

scene('brand', () => {
  const S = (sel, y, cls) => ({ ...box(sel, { y, cls }), anim: null });
  const kicker = S('#brand-kicker', 1086, 'kicker');
  kicker.anim = (f) => rise(f, [[38, 0], [62, 1]]);

  const title = S('#brand-title', 1146, 'title');
  title.anim = (f) => {
    const t = easeOut(curve(f, [[20, 0], [50, 1]]));
    return {
      opacity: String(clamp(t * 1.5)),
      transform: `translateY(${lerp(52, 0, t)}px)`,
      letterSpacing: `${lerp(0.3, 0.16, t)}em`,
    };
  };

  const tagline = S('#brand-tagline', 1340, 'tagline');
  tagline.anim = (f) => rise(f, [[46, 0], [70, 1]]);

  const mark = {
    sel: '#brand-mark',
    cls: 'box mark',
    style: { left: '390px', top: '460px' },
    anim: (f) => {
      const t = clamp(curve(f, [[6, 0], [36, 1]]));
      const pop = easeOutBack(easeOut(t));
      return {
        opacity: String(clamp(t * 1.7)),
        transform: `scale(${(0.6 + 0.4 * pop) * breath(f, 0, 0.022)}) rotate(${lerp(-8, 0, easeOut(t))}deg)`,
      };
    },
  };

  const rule = {
    sel: '#brand-rule',
    cls: 'box rule',
    style: { left: '440px', top: '1560px' },
    anim: (f) => {
      const t = easeOut(curve(f, [[30, 0], [58, 1]]));
      return { opacity: String(clamp(t)), transform: `scaleX(${t})` };
    },
  };

  return [mark, title, rule, tagline, kicker];
});

scene('home', () => {
  const phone = device('Главная ORTA', { x: 220, y: 210, w: 640, z: 2 });
  phone.anim = (f) => {
    const enter = easeOut(clamp(f / 26));
    return {
      opacity: String(clamp(enter * 1.3)),
      transform: `translateY(${lerp(170, 0, enter)}px) scale(${phone.scale * lerp(0.88, 1, enter) * breath(f)}) rotate(${lerp(2.6, 0, enter)}deg)`,
    };
  };

  const kicker = box('#home-kicker', { y: 54, cls: 'kicker' });
  kicker.anim = (f) => rise(f, [[14, 0], [36, 1]]);

  const title = box('#home-title', { y: 112 });
  title.anim = (f) => rise(f, [[20, 0], [46, 1]], 40);

  const stat = box('#home-stat', { y: 1712, cls: 'stat-row' });
  stat.anim = (f) => rise(f, [[52, 0], [80, 1]], 30);

  const sub = box('#home-sub', { y: 1796, cls: 'scene-sub scene-sub--sm' });
  sub.anim = (f) => rise(f, [[34, 0], [62, 1]], 30);

  return [phone, kicker, title, stat, sub];
});

scene('verticals', () => {
  const cards = [
    'ORTA Market — витрина',
    'ORTA Food — подборки и заведения рядом',
    'ORTA Services — запись создана',
    'ORTA Beauty — подборки салонов',
    'ORTA Health — клиники и подбор врача',
    'ORTA AI — план дня',
  ];
  const GAP = 48;
  const CW = 304;
  const STEP = CW + GAP;

  const kicker = box('#v-kicker', { y: 150, cls: 'kicker' });
  kicker.anim = (f) => rise(f, [[8, 0], [30, 1]]);

  const title = box('#v-title', { y: 208 });
  title.anim = (f) => rise(f, [[12, 0], [38, 1]], 36);

  const track = {
    sel: '#v-track',
    cls: 'track',
    // Лента — общий контейнер для рамок: двигается целиком, а рамки внутри неё.
    style: { left: '0px', top: '430px', width: `${cards.length * STEP}px`, height: '844px' },
    anim: (f) => {
      const t = easeInOut(clamp((f - 4) / 172));
      const endX = -(cards.length * STEP) + WIDTH - 120;
      return { transform: `translateX(${lerp(160, endX, t)}px)` };
    },
  };

  const shots = cards.map((screen, i) => {
    const d = device(screen, { x: i * STEP, y: 0, w: CW, z: 1 });
    d.parent = '#v-track';
    d.anim = () => ({});
    return d;
  });

  // Контейнер обязан идти в списке первым: рамки монтируются внутрь него.
  return [track, kicker, title, ...shots];
});

scene('taxi', () => {
  const flow = [
    { screen: 'ORTA Taxi — заказ', label: 'Заказ: откуда, куда, класс' },
    { screen: 'ORTA Taxi — поиск водителя', label: 'Поиск машины рядом' },
    { screen: 'ORTA Taxi — водитель в пути', label: 'Водитель в пути' },
    { screen: 'ORTA Taxi — в пути и завершение', label: 'Поездка и завершение' },
    { screen: 'Чек поездки и оценка', label: 'Чек и оценка' },
  ];
  // 204 кадра на сцену, 5 экранов по 34 кадра. Экраны не гаснут друг за другом в
  // одной точке: активный проявляется, а предыдущий вытесняется вниз и обрезается
  // рамкой. Так между ними нет пустого кадра.
  const SWAP = 34;
  const START = 26;
  const SLOTS = flow.length * SWAP;

  const kicker = box('#t-kicker', { y: 26, cls: 'kicker kicker--sm' });
  kicker.anim = (f) => rise(f, [[6, 0], [26, 1]]);

  const title = box('#t-title', { y: 70, cls: 'scene-title scene-title--sm' });
  title.anim = (f) => rise(f, [[10, 0], [36, 1]], 36);

  const bar = {
    sel: '#t-bar',
    cls: 'progress',
    style: { left: '240px', top: '176px', transformOrigin: 'left center' },
    anim: (f) => ({
      opacity: String(clamp(curve(f, [[20, 0], [38, 1]]))),
      transform: `scaleX(${clamp((f - START) / SLOTS)})`,
    }),
  };

  const caption = box('#t-caption', { y: 1700, cls: 'caption' });
  caption.anim = (f) => {
    const local = clamp(((f - START) % SWAP) / 9);
    const t = easeOut(local);
    return {
      opacity: String(clamp((f - START) / 8) * clamp(t * 1.6)),
      transform: `translateY(${lerp(22, 0, t)}px)`,
    };
  };
  caption.text = (f) => flow[clamp(Math.floor((f - START) / SWAP), 0, flow.length - 1)].label;

  const shots = flow.map((step, i) => {
    const from = START + i * SWAP;
    // Высота кадра подобрана так, чтобы кнопка внизу экрана осталась видимой,
    // а заголовок сцены не наезжал на рамку.
    const d = device(step.screen, { x: 230, y: 310, w: 620, z: 2, fade: true });
    d.anim = (f) => {
      const enter = easeOut(clamp((f - from) / 16));
      const exit = easeOut(clamp((f - (from + SWAP - 9)) / 9));
      return {
        opacity: String(clamp(enter * 1.5)),
        // Уходящий экран уезжает вниз, к подписи — рамка задаёт границу потока.
        transform: `translateY(${lerp(-70, 0, enter) + 64 * exit}px) scale(${d.scale})`,
      };
    };
    return d;
  });

  return [kicker, title, bar, ...shots, caption];
});

scene('qtime', () => {
  const kicker = box('#q-kicker', { y: 140, cls: 'kicker' });
  kicker.anim = (f) => rise(f, [[6, 0], [26, 1]]);

  const title = box('#q-title', { y: 198 });
  title.anim = (f) => rise(f, [[10, 0], [36, 1]], 36);

  const sub = box('#q-sub', { y: 330, cls: 'scene-sub' });
  sub.anim = (f) => rise(f, [[18, 0], [44, 1]], 26);

  const phone = device('ORTA Services — запись создана', { x: 220, y: 448, w: 620, z: 2 });
  phone.anim = (f) => {
    const enter = easeOut(clamp((f - 16) / 30));
    return {
      opacity: String(clamp(enter * 1.4)),
      transform: `translateY(${lerp(120, 0, enter)}px) scale(${phone.scale * lerp(0.92, 1, enter) * breath(f, 0.3)}) rotate(${lerp(-1.8, 0, enter)}deg)`,
    };
  };

  // Ровно под рамкой экрана: 448 + 620/390*844 = 1790.
  const chain = box('#q-chain', { y: 1836, cls: 'chain' });
  chain.anim = (f) => rise(f, [[54, 0], [86, 1]], 26);

  return [kicker, title, sub, phone, chain];
});

scene('business', () => {
  const kicker = box('#b-kicker', { y: 140, cls: 'kicker' });
  kicker.anim = (f) => rise(f, [[4, 0], [22, 1]]);

  const title = box('#b-title', { y: 198 });
  title.anim = (f) => rise(f, [[8, 0], [32, 1]], 34);

  const dash = device('Кабинет водителя', { x: 36, y: 420, w: 470, z: 2 });
  dash.anim = (f) => {
    const enter = easeOut(clamp((f - 12) / 30));
    return {
      opacity: String(clamp(enter * 1.4)),
      transform: `translateY(${lerp(96, 0, enter)}px) scale(${dash.scale * lerp(0.9, 1, enter) * breath(f, 0.2)}) rotate(${lerp(2.4, 0, enter)}deg)`,
    };
  };

  const earn = device('Заработок за смену', { x: 560, y: 530, w: 470, z: 3 });
  earn.anim = (f) => {
    const enter = easeOut(clamp((f - 26) / 30));
    return {
      opacity: String(clamp(enter * 1.4)),
      transform: `translateY(${lerp(120, 0, enter)}px) scale(${earn.scale * lerp(0.9, 1, enter) * breath(f, 1.1)}) rotate(${lerp(-2.6, 0, enter)}deg)`,
    };
  };

  const note = box('#b-note', { y: 1786, cls: 'scene-sub' });
  note.anim = (f) => rise(f, [[46, 0], [78, 1]], 26);

  return [kicker, title, dash, earn, note];
});

scene('platform', () => {
  const kicker = box('#p-kicker', { y: 140, cls: 'kicker' });
  kicker.anim = (f) => rise(f, [[4, 0], [22, 1]]);

  const title = box('#p-title', { y: 198, cls: 'scene-title scene-title--sm' });
  title.anim = (f) => rise(f, [[8, 0], [32, 1]], 34);

  const sub = box('#p-sub', { y: 368, cls: 'scene-sub scene-sub--sm' });
  sub.anim = (f) => rise(f, [[16, 0], [42, 1]], 26);

  const pay = device('ORTA Pay — счёт и баланс', { x: 325, y: 504, w: 430, z: 2 });
  pay.anim = (f) => {
    const enter = easeOut(clamp((f - 24) / 30));
    return {
      opacity: String(clamp(enter * 1.4)),
      transform: `translateY(${lerp(100, 0, enter)}px) scale(${pay.scale * lerp(0.9, 1, enter) * breath(f, 0.5)})`,
    };
  };

  const chips = box('#p-chips', { y: 1470, cls: 'chips' });
  chips.anim = (f) => rise(f, [[50, 0], [84, 1]], 28);

  return [kicker, title, sub, pay, chips];
});

scene('final', () => {
  const mark = {
    sel: '#f-mark',
    cls: 'box mark',
    style: { left: '390px', top: '400px' },
    anim: (f) => {
      const t = easeOut(curve(f, [[4, 0], [34, 1]]));
      return {
        opacity: String(clamp(t * 1.6)),
        transform: `scale(${lerp(0.64, 1, easeOutBack(t)) * breath(f, 0, 0.02)})`,
      };
    },
  };

  const title = box('#f-title', { y: 1120, cls: 'title' });
  title.anim = (f) => {
    const t = easeOut(curve(f, [[14, 0], [44, 1]]));
    return {
      opacity: String(clamp(t * 1.5)),
      transform: `translateY(${lerp(34, 0, t)}px)`,
      letterSpacing: `${lerp(0.28, 0.15, t)}em`,
    };
  };

  const tagline = box('#f-tagline', { y: 1310, cls: 'tagline' });
  tagline.anim = (f) => rise(f, [[28, 0], [54, 1]], 24);

  const chips = box('#f-chips', { y: 1430, cls: 'chips' });
  chips.anim = (f) => rise(f, [[44, 0], [76, 1]], 26);

  const note = box('#f-note', { y: 1660, cls: 'footnote' });
  note.anim = (f) => rise(f, [[62, 0], [90, 1]], 20);

  return [mark, title, tagline, chips, note];
});

/* ------------------------------------------------------------ подготовка DOM */

const LABELS = {
  '#brand-kicker': 'Казахстан · суперапп',
  '#brand-title': 'ORTA',
  '#brand-tagline': 'Всё рядом',
  '#home-kicker': 'Первый экран',
  '#home-title': 'Главный экран ORTA',
  '#home-stat': 'Один аккаунт &nbsp;·&nbsp; одни деньги &nbsp;·&nbsp; одна карта',
  '#home-sub': 'Пятнадцать направлений в одном приложении:<br>такси, товары, доставка, услуги, еда, работа.',
  '#v-kicker': 'Экосистема',
  '#v-title': '15 направлений',
  '#t-kicker': 'Первая вертикаль',
  '#t-title': 'ORTA Taxi',
  '#q-kicker': 'Ядро записи',
  '#q-title': 'QTime',
  '#q-sub': 'Компания → специалисты → услуги → расписание → онлайн-запись',
  '#q-chain': 'Beauty &nbsp;·&nbsp; Health &nbsp;·&nbsp; Auto &nbsp;·&nbsp; Services — на одном ядре',
  '#b-kicker': 'ORTA Business',
  '#b-title': 'Кабинет бизнеса',
  '#b-note': 'Выручка, загрузка, отчёты и выплаты — в одном кабинете',
  '#p-kicker': 'ORTA Platform',
  '#p-title': 'Пять платформенных сервисов',
  '#p-sub': 'Новая вертикаль подключается к платформе,<br>а не строит свою',
  '#f-title': 'ORTA',
  '#f-tagline': 'Всё рядом',
  '#f-note': 'Вход, поездка с чеком, маркетплейс с выплатами и запись через QTime<br>уже работают на живом стеке',
};

const CHIPS_PLATFORM = ['ORTA ID', 'ORTA Pay', 'ORTA Wallet', 'ORTA Map', 'ORTA AI'];
const CHIPS_FINAL = ['Такси', 'Маркет', 'Услуги', 'Доставка', 'Еда', 'Работа', 'Beauty', 'Health'];

const chips = (list) => list.map((c) => `<span class="chip">${c}</span>`).join('');

/** Подъём с прозрачностью — базовый вход для подписей. */
function rise(f, points, dist = 26) {
  const t = easeOut(curve(f, points));
  return { opacity: String(clamp(t * 1.5)), transform: `translateY(${lerp(dist, 0, t)}px)` };
}

function build() {
  // 1. Сначала рамки: только у них есть id, по которым ниже раскладывается содержимое.
  for (const s of scenes) {
    s.plans = s.builder();
    for (const p of s.plans) {
      const node = document.createElement('div');
      node.className = p.cls ?? '';
      Object.assign(node.style, p.style ?? {});
      if (p.kind === 'device') {
        const markup = phones[p.screen];
        node.innerHTML = markup ?? `<div data-missing style="padding:24px;font:600 20px sans-serif">нет экрана: ${p.screen}</div>`;
        node.style.transformOrigin = 'top left';
        if (p.fade) {
          // Мягкое затемнение снизу: рамка выглядит продолжением ленты экранов.
          const veil = document.createElement('div');
          veil.className = 'phone-veil';
          node.appendChild(veil);
        }
      }
      if (p.sel) node.id = p.sel.slice(1);
      // Элемент может жить внутри другого (рамки внутри ленты): тогда их двигает
      // общий контейнер, а не сцена.
      const host = p.parent ? s.plans.find((q) => q.sel === p.parent) : null;
      if (p.parent && !host) console.warn(`[story] нет контейнера ${p.parent} для ${p.sel ?? p.screen}`);
      (host?.node ?? s.el).appendChild(node);
      p.node = node;
    }
  }

  // 2. Потом содержимое: подписи и метки, привязанные к уже существующим рамкам.
  for (const [sel, html] of Object.entries(LABELS)) {
    const node = document.querySelector(sel);
    if (node) node.innerHTML = html;
    else console.warn(`[story] нет элемента под подпись: ${sel}`);
  }
  setHTML('#brand-mark', '<span>O</span>');
  setHTML('#f-mark', '<span>O</span>');
  setHTML('#p-chips', chips(CHIPS_PLATFORM));
  setHTML('#f-chips', chips(CHIPS_FINAL));
}

function setHTML(sel, html) {
  const node = document.querySelector(sel);
  if (node) node.innerHTML = html;
  else console.warn(`[story] нет элемента: ${sel}`);
}

/* --------------------------------------------------------------- движение */

function scenePose(s, f) {
  const inT = clamp((f - s.at) / CROSS);
  const outT = clamp((f - (s.outAt - CROSS)) / CROSS);
  if (inT < 1) {
    const t = easeOut(inT);
    return { opacity: clamp(t * 1.35), y: lerp(140, 0, t), scale: lerp(0.955, 1, t), blur: lerp(18, 0, t), z: 2 };
  }
  if (outT > 0) {
    const t = easeOut(outT);
    return { opacity: 1 - t, y: lerp(0, -120, t), scale: lerp(1, 0.955, t), blur: lerp(0, 20, t), z: 1 };
  }
  return { opacity: 1, y: 0, scale: 1, blur: 0, z: 2 };
}

export function render(frame) {
  const f = clamp(frame, 0, TOTAL_FRAMES);
  for (const s of scenes) {
    const pose = scenePose(s, f);
    const active = pose.opacity > 0.002;
    s.el.style.display = active ? 'block' : 'none';
    if (!active) continue;

    // Все кривые внутри сцены заданы в её собственном времени: 0 — начало сцены.
    // Иначе одна и та же запись «0..36» означала бы разное для каждой сцены.
    const t = f - s.at;

    s.el.style.opacity = pose.opacity.toFixed(4);
    s.el.style.zIndex = String(pose.z);
    s.el.style.transform = `translateY(${pose.y.toFixed(2)}px) scale(${pose.scale.toFixed(4)})`;
    s.el.style.filter = pose.blur > 0.05 ? `blur(${pose.blur.toFixed(2)}px)` : 'none';

    // Фон едет вместе со сценой — так движение читается даже на статичных экранах.
    const d = t / FPS;
    s.el.style.backgroundPosition = `${(d * -30).toFixed(1)}px ${(d * 18).toFixed(1)}px`;

    for (const p of s.plans) {
      const st = p.anim(t);
      const style = p.node.style;
      if (st.opacity !== undefined) style.opacity = st.opacity;
      if (st.transform !== undefined) style.transform = st.transform;
      if (st.filter !== undefined) style.filter = st.filter;
      if (st.letterSpacing !== undefined) style.letterSpacing = st.letterSpacing;
      if (p.text) {
        const label = p.text(t);
        if (p._label !== label) {
          p.node.textContent = label;
          p._label = label;
        }
      }
    }
  }
}

/* ------------------------------------------------------------------- стили */

const style = document.createElement('style');
// Переходы нужны только в живом просмотре: при рендере кадров они выключаются
// (--scene-ms: 0), иначе браузер интерполирует состояние между кадрами и кадр
// получается «недоехавшим».
style.textContent = `
  :root { --scene-ms: ${TRANSITION_MS}ms; }
  .scene {
    position: absolute; inset: 0; opacity: 0;
    will-change: transform, opacity, filter;
  }
  .scene.anim,
  .scene.anim > * {
    transition: opacity var(--scene-ms) cubic-bezier(.22,.7,.24,1),
                transform var(--scene-ms) cubic-bezier(.22,.7,.24,1),
                filter var(--scene-ms) linear,
                letter-spacing var(--scene-ms) cubic-bezier(.22,.7,.24,1),
                background-position var(--scene-ms) linear;
  }
  .scene .phone { box-shadow: 0 64px 120px rgba(3,12,28,.55), 0 10px 30px rgba(3,12,28,.35); }
  .scene > .box, .scene > .frame { position: absolute; }
  /* Нижняя кромка рамки: содержимое «продолжается» за кадром. Рисуется внутри
     .phone, поэтому обрезается его радиусом. */
  .phone-veil {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 132px;
    background: linear-gradient(to top, rgba(255,255,255,.92), rgba(255,255,255,0));
    pointer-events: none;
  }
`;
root.appendChild(style);

/** Включает плавные переходы сцен (живой просмотр). При рендере кадров — выключено. */
export function setAnimated(on) {
  for (const s of scenes) s.el.classList.toggle('anim', on);
  document.documentElement.style.setProperty('--scene-ms', on ? `${TRANSITION_MS}ms` : '0ms');
}

build();
setAnimated(true);
render(0);

// Точки входа для рендера кадров: renderer отдаёт номер кадра, страница строит кадр.
window.__storyRender = render;
window.__storySetAnimated = setAnimated;
window.__STORY_READY__ = true;
