import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { adminSectionById, densityOf } from '../sections';
import {
  bodyOf,
  jsonResponse,
  problemResponse,
  renderWithProviders,
  stubFetch,
} from '../../test/utils';
import AccountsSection from './accounts';

/**
 * Раздел «Счета, лимиты и холды».
 *
 * Проверяются не картинки, а правила раздела:
 *  - счёт открывается по идентификатору, и на пустое значение НИ ОДНОГО запроса не уходит;
 *  - плитки до выбора счёта показывают «—», а не ноль, и блоков с плитками не меньше,
 *    чем обещает реестр разделов (те же числа считает e2e/check-admin.mjs);
 *  - у SUPPORT форма лимитов не рисуется и `/limits` не запрашивается (в сервисе это
 *    гарантированный 403, и раздел не должен выглядеть сломанным);
 *  - суммы печатаются из минорных единиц, ошибка сервиса показывается словами, срез
 *    выписки фильтрует загруженную страницу, а таблицы лежат в `relative overflow-x-auto`.
 */

const SECTION = adminSectionById('accounts')!;

/** Сколько блоков и плиток обещает реестр: те же числа проверяет e2e/check-admin.mjs. */
const DENSITY = densityOf(SECTION);

const ACCOUNT = {
  id: 'acc-1',
  ownerUserId: 'U-1',
  ownerPhone: '+77001234567',
  displayName: 'Айдар Сериков',
  type: 'CUSTOMER',
  currency: 'KZT',
  status: 'ACTIVE',
  balanceMinor: 500_000,
  heldMinor: 150_000,
  availableMinor: 350_000,
  createdAt: '2024-09-01T10:00:00Z',
};

const LIMITS = {
  accountId: 'acc-1',
  currency: 'KZT',
  limits: [
    {
      window: 'DAILY',
      configured: true,
      outgoingLimitMinor: 5_000_000,
      usedMinor: 1_230_000,
      remainingMinor: 3_770_000,
      windowStart: '2024-09-01T00:00:00Z',
      windowEnd: '2024-09-02T00:00:00Z',
      updatedAt: '2024-09-01T09:10:00Z',
    },
  ],
  velocity: { enabled: true, maxOperations: 12, window: 'PT1H', operationsInWindow: 3 },
};

/**
 * Три движения: оплата, пополнение и холд. Срез выписки проверяется именно на них —
 * у холда направление DEBIT, и он честно попадает сразу в «Списания» и в «Холды».
 */
const TRANSACTIONS = {
  items: [
    {
      id: 'trx-1',
      direction: 'DEBIT',
      amountMinor: 184_800,
      currency: 'KZT',
      balanceAfterMinor: 315_200,
      operation: 'PAYMENT',
      referenceType: 'TRIP',
      referenceId: 'trip-1',
      description: 'Оплата поездки',
      createdAt: '2024-09-01T10:42:11Z',
    },
    {
      id: 'trx-2',
      direction: 'CREDIT',
      amountMinor: 200_000,
      currency: 'KZT',
      balanceAfterMinor: 515_200,
      operation: 'TOP_UP',
      referenceType: 'CARD',
      referenceId: 'topup-1',
      description: 'Пополнение с карты',
      createdAt: '2024-09-01T10:30:00Z',
    },
    {
      id: 'trx-3',
      direction: 'DEBIT',
      amountMinor: 50_000,
      currency: 'KZT',
      balanceAfterMinor: 465_200,
      operation: 'HOLD',
      referenceType: 'TRIP',
      referenceId: 'trip-2',
      description: 'Резерв под поездку',
      createdAt: '2024-09-01T10:20:00Z',
    },
  ],
  page: 0,
  size: 20,
  totalElements: 3,
  totalPages: 1,
  hasNext: false,
};

const HOLDS = {
  items: [
    {
      holdId: 'hold-1',
      accountId: 'acc-1',
      // Сумма резерва отличается от «зарезервировано» в снимке намеренно: так тест
      // ловит подмену одного блока другим, а не совпадение строк.
      amountMinor: 120_000,
      currency: 'KZT',
      status: 'ACTIVE',
      referenceType: 'TRIP',
      referenceId: 'trip-2',
      reason: 'Поездка в процессе',
      expiresAt: '2024-09-01T11:00:00Z',
      createdAt: '2024-09-01T10:50:00Z',
    },
  ],
  page: 0,
  size: 20,
  totalElements: 1,
  totalPages: 1,
  hasNext: false,
};

/** Обычный набор ответов account-service для одного счёта. */
function accountService() {
  return stubFetch((url) => {
    if (url.startsWith('/api/v1/accounts/acc-1/transactions')) {
      return jsonResponse(TRANSACTIONS);
    }
    if (url.startsWith('/api/v1/accounts/acc-1/holds')) {
      return jsonResponse(HOLDS);
    }
    if (url.startsWith('/api/v1/accounts/acc-1/limits')) {
      return jsonResponse(LIMITS);
    }
    if (url === '/api/v1/accounts/acc-1') {
      return jsonResponse(ACCOUNT);
    }
    return problemResponse({ code: 'ACCOUNT_NOT_FOUND', detail: 'account not found' }, 404);
  });
}

function openAccount(id = 'acc-1') {
  fireEvent.change(screen.getByLabelText('Идентификатор счёта'), { target: { value: id } });
  fireEvent.click(screen.getByRole('button', { name: 'Показать счёт' }));
}

/**
 * Плитка по подписи: у плиток общего набора есть только метка `data-admin-kpi`, без
 * имени, — поэтому идём от подписи вверх, как это сделал бы человек глазами.
 */
function tile(label: string): HTMLElement {
  const node = screen
    .getAllByText(label)
    .map((element) => element.closest('[data-admin-kpi]'))
    .find((element): element is HTMLElement => element !== null);
  if (!node) {
    throw new Error(`в разделе нет плитки «${label}»`);
  }
  return node;
}

/** Панель по её заголовку: `data-admin-panel` тоже без имени. */
async function panelByHeading(name: string | RegExp): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { level: 2, name });
  const node = heading.closest('[data-admin-panel]');
  if (node === null) {
    throw new Error(`заголовок «${String(name)}» найден вне панели`);
  }
  return node as HTMLElement;
}

/**
 * Текст узла без неразрывных пробелов: `formatMoney` ставит между числом и знаком
 * валюты именно неразрывный пробел (`\u00a0`), и сравнение строк «как на экране»
 * иначе провалилось бы на ровном месте.
 */
function plain(node: HTMLElement | null): string {
  return (node?.textContent ?? '').replace(/\u00a0/g, ' ');
}

/** Таблицу выписки ищем по подписи (`caption`): в диаграмме те же названия операций. */
function ledgerTable(): HTMLElement {
  return screen.getByRole('table', { name: 'Выписка леджера по счёту' });
}

function rail(): HTMLElement {
  return screen.getByRole('list', { name: 'Срез выписки' });
}

/** Подменяет буфер обмена: в jsdom `navigator.clipboard` нет вовсе. */
function stubClipboard() {
  const writeText = vi.fn(async (_text: string) => undefined);
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

afterEach(() => {
  delete (window.navigator as { clipboard?: unknown }).clipboard;
});

describe('счета: поиск по идентификатору', () => {
  it('не отправляет ни одного запроса и не показывает ноль, пока идентификатор не введён', async () => {
    const fetchMock = stubFetch(() => jsonResponse({}));

    const { container } = renderWithProviders(
      <AccountsSection section={SECTION} role="ADMIN" canWrite />,
    );

    expect(await screen.findByText('Счёт не выбран')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    // До выбора счёта плитки на месте, но в них «—»: ноль читался бы как «на счёте пусто».
    expect(plain(tile('Баланс'))).toContain('—');
    expect(plain(tile('Баланс'))).not.toContain('0,00');
    expect(plain(tile('Доступно к списанию'))).toContain('—');

    // Те же числа, что обещает реестр разделов, — их же считает e2e/check-admin.mjs.
    expect(container.querySelectorAll('[data-admin-kpi]').length).toBeGreaterThanOrEqual(
      DENSITY.kpis,
    );
    expect(container.querySelectorAll('[data-admin-panel]').length).toBeGreaterThanOrEqual(
      DENSITY.panels,
    );
  });

  it('показывает карточку счёта, плитки, выписку и резервы по введённому идентификатору', async () => {
    const fetchMock = accountService();

    const { container } = renderWithProviders(
      <AccountsSection section={SECTION} role="ADMIN" canWrite />,
    );
    openAccount();

    // Карточка счёта: владелец, реквизиты и суммы из минорных единиц (500 000 тиын = 5 000,00 ₸).
    const card = await panelByHeading(/Айдар Сериков/);
    expect(await within(card).findByText('U-1')).toBeInTheDocument();
    expect(within(card).getByText('+77001234567')).toBeInTheDocument();
    expect(within(card).getByText('5 000,00 ₸')).toBeInTheDocument();
    expect(within(card).getByText('1 500,00 ₸')).toBeInTheDocument();
    expect(within(card).getByText('3 500,00 ₸')).toBeInTheDocument();
    expect(within(card).getByText('Текущий счёт')).toBeInTheDocument();
    // Состояние стоит и в заголовке панели, и полем в сетке.
    expect(within(card).getAllByText('Активен').length).toBeGreaterThanOrEqual(2);

    // Плитки: суммы счёта, число записей выписки, активные холды и состояние.
    expect(plain(tile('Баланс'))).toContain('5 000,00 ₸');
    expect(plain(tile('Зарезервировано (холды)'))).toContain('1 500,00 ₸');
    expect(plain(tile('Доступно к списанию'))).toContain('3 500,00 ₸');
    expect(plain(tile('Операций в выписке'))).toContain('3');
    expect(plain(tile('Активных холдов'))).toContain('1');
    expect(plain(tile('Состояние счёта'))).toContain('Активен');

    // Активные холды считаются отдельным запросом: только он отдаёт число по всему счёту.
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/holds?status=ACTIVE&page=0&size=1')),
    ).toBe(true);

    // Выписка леджера: списание со знаком минус и остаток после операции.
    const table = await screen.findByRole('table', { name: 'Выписка леджера по счёту' });
    expect(within(table).getByText('Оплата')).toBeInTheDocument();
    expect(within(table).getByText('−1 848,00 ₸')).toBeInTheDocument();
    expect(within(table).getByText('3 152,00 ₸')).toBeInTheDocument();
    expect(within(table).getByText('+2 000,00 ₸')).toBeInTheDocument();

    // Резервы: причина, состояние словами и сумма.
    const reasonCell = await screen.findByText('Поездка в процессе');
    const holdRow = reasonCell.closest('tr');
    expect(holdRow).not.toBeNull();
    expect(within(holdRow as HTMLElement).getByText('Активен')).toBeInTheDocument();
    expect(within(holdRow as HTMLElement).getByText('1 200,00 ₸')).toBeInTheDocument();

    // Каждая таблица лежит в `relative overflow-x-auto`: без этого раздел разъезжается
    // на телефоне, и это же правило проверяет браузерная проверка вёрстки.
    for (const node of container.querySelectorAll('table')) {
      expect(node.closest('div.relative.overflow-x-auto')).not.toBeNull();
    }
  });

  it('показывает ошибку сервиса в каждом блоке отдельно, а не одним «раздел упал»', async () => {
    stubFetch(() => problemResponse({ code: 'ACCOUNT_NOT_FOUND', detail: 'account not found' }, 404));

    renderWithProviders(<AccountsSection section={SECTION} role="ADMIN" canWrite />);
    openAccount('нет-такого');

    // Заголовок не переопределяется: показывается перевод кода сервиса от humanMessage.
    // Четыре блока (карточка, выписка, резервы, лимиты) запрашиваются независимо и каждый
    // сообщает о своей ошибке — то есть недоступность одного не гасит остальные.
    await waitFor(() => {
      expect(screen.getAllByText('Счёт не найден')).toHaveLength(4);
    });
    // Рядом видно и то, что ответил сервис, и correlationId для поддержки.
    expect(screen.getAllByText('account not found').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/corr-test-1/).length).toBeGreaterThan(0);
  });
});

describe('счета: срез выписки, диаграмма и экспорт', () => {
  it('считает срез по загруженной странице и фильтрует таблицу', async () => {
    accountService();

    renderWithProviders(<AccountsSection section={SECTION} role="ADMIN" canWrite />);
    openAccount();
    await screen.findByRole('table', { name: 'Выписка леджера по счёту' });

    // Рейл: сколько строк в каждом срезе загруженной страницы. Холд-строка идёт дебетом,
    // поэтому честно считается и в «Списаниях», и в «Холдах».
    expect(within(rail()).getByRole('button', { name: /^Все движения/ }).textContent).toContain('3');
    expect(plain(within(rail()).getByRole('button', { name: /^Поступления/ }))).toContain('1');
    expect(plain(within(rail()).getByRole('button', { name: /^Списания/ }))).toContain('2');
    expect(plain(within(rail()).getByRole('button', { name: /^Холды/ }))).toContain('1');

    // Фильтр среза — по уже загруженным строкам, и он виден в самой таблице.
    fireEvent.click(within(rail()).getByRole('button', { name: /^Списания/ }));
    const debitTable = ledgerTable();
    expect(within(debitTable).getByText('Оплата')).toBeInTheDocument();
    expect(within(debitTable).getByText('Блокировка средств')).toBeInTheDocument();
    expect(within(debitTable).queryByText('Пополнение')).toBeNull();

    fireEvent.click(within(rail()).getByRole('button', { name: /^Поступления/ }));
    const creditTable = ledgerTable();
    expect(within(creditTable).getByText('Пополнение')).toBeInTheDocument();
    expect(within(creditTable).queryByText('Оплата')).toBeNull();

    // Диаграмма считается по тем же загруженным строкам и честно об этом говорит.
    expect(screen.getByText('Оборот по операциям')).toBeInTheDocument();
    expect(screen.getByText(/По загруженной странице/)).toBeInTheDocument();
  });

  it('показывает диаграмму операций с суммой, а не сырыми минорными единицами', async () => {
    accountService();

    renderWithDefaults();
    openAccount();
    await screen.findByRole('table', { name: 'Выписка леджера по счёту' });

    // Оборот — 184 800 + 200 000 + 50 000 тиын, и он напечатан деньгами, а не «434800».
    expect(screen.getByText(/всего 4 348,00 ₸/)).toBeInTheDocument();
    expect(screen.getByText(/3 записи/)).toBeInTheDocument();
    expect(screen.queryByText('434800')).toBeNull();

    // Названия операций есть и в диаграмме, и в таблице — обе подписи настоящие.
    expect(screen.getAllByText('Оплата').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Блокировка средств').length).toBeGreaterThanOrEqual(2);
  });

  it('открывает панель фильтров по кнопке тулбара', async () => {
    accountService();

    renderWithDefaults();
    openAccount();
    await screen.findByText('Показать счёт');

    expect(screen.queryByRole('heading', { level: 2, name: 'Фильтры раздела' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Фильтр/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Фильтры раздела' })).toBeInTheDocument();
    expect(screen.getByLabelText('Направление в выписке')).toBeInTheDocument();
    expect(screen.getByLabelText('Состояние резервов')).toBeInTheDocument();
  });

  it('копирует CSV ровно тех строк, что видны, и не врёт про объём', async () => {
    accountService();
    const writeText = stubClipboard();

    renderWithDefaults();
    openAccount();
    await screen.findByRole('table', { name: 'Выписка леджера по счёту' });

    fireEvent.click(screen.getByRole('button', { name: /^Экспорт:/ }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    const csv = String(writeText.mock.calls[0]?.[0] ?? '');
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(4); // заголовок и три загруженные строки
    expect(lines[0]).toContain('операция;направление;сумма');
    expect(csv).toContain('Оплата;Списание;-1848.00');
    expect(csv).toContain('Пополнение;Зачисление;2000.00');
    expect(csv).not.toContain('undefined');

    // Подпись кнопки говорит, сколько строк ушло, — а не «готово» без числа.
    expect(await screen.findByText('Скопировано (3 записи)')).toBeInTheDocument();

    // С выбранным срезом копируется только он: экспорт не выдумывает строки, которых
    // нет на экране.
    fireEvent.click(within(rail()).getByRole('button', { name: /^Холды/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Экспорт:/ }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(2);
    });
    const filtered = String(writeText.mock.calls[1]?.[0] ?? '');
    expect(filtered.split('\r\n')).toHaveLength(2);
    expect(filtered).toContain('Блокировка средств;Списание;-500.00');
  });
});

describe('счета: лимиты и роль', () => {
  it('у ADMIN показывает таблицу лимитов с использованием и форму изменения', async () => {
    accountService();

    renderWithDefaults();
    openAccount();

    const limitsTable = await screen.findByRole('table', {
      name: 'Лимиты исходящих операций по окнам',
    });
    expect(within(limitsTable).getByText('Дневной')).toBeInTheDocument();
    expect(within(limitsTable).getByText('50 000,00 ₸')).toBeInTheDocument();
    expect(within(limitsTable).getByText('12 300,00 ₸')).toBeInTheDocument();
    expect(within(limitsTable).getByText('37 700,00 ₸')).toBeInTheDocument();
    // Полоса использования: 1 230 000 из 5 000 000 — это 25 %, и рядом виден остаток.
    expect(within(limitsTable).getByText('25 % · остаток 37 700,00 ₸')).toBeInTheDocument();

    // Скоростной контроль показывается, но формы для него нет — PUT его не меняет.
    expect(screen.getByText(/Скоростной контроль/)).toBeInTheDocument();
    expect(screen.getByText('включён')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Сохранить лимит' })).toBeInTheDocument();
    // Ярлык поля несёт звёздочку обязательности, поэтому ищем по части текста.
    expect(screen.getByLabelText(/Новый лимит, дневной/)).toBeInTheDocument();

    // Контракт админ-панели: изменяющее действие помечено data-admin-write, и метка
    // стоит на самой форме, которая отправляет PUT.
    const writeControl = screen.getByRole('button', { name: 'Сохранить лимит' }).closest('form');
    expect(writeControl?.getAttribute('data-admin-write')).toBe('изменение лимитов');

    // Формулировки «только для чтения» в разделе быть не должно: браузерная проверка
    // считает такую пометку баннером роли и валит ею прогон у ADMIN.
    expect(document.body.textContent ?? '').not.toMatch(/только для чтения/i);
  });

  it('сохраняет лимит через PUT и показывает применённые сервисом значения', async () => {
    const fetchMock = accountService();

    renderWithDefaults();
    openAccount();
    await screen.findByRole('table', { name: 'Лимиты исходящих операций по окнам' });

    fireEvent.change(screen.getByLabelText(/Новый лимит, дневной/), { target: { value: '7 500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить лимит' }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(put).toBeDefined();
      expect(String(put?.[0])).toBe('/api/v1/accounts/acc-1/limits');
      expect(bodyOf<{ window: string; outgoingLimitMinor: number }>(put?.[1])).toEqual({
        window: 'DAILY',
        outgoingLimitMinor: 750_000,
      });
    });

    // Показываются именно те значения, которые вернул сервис после сохранения.
    const applied = await screen.findByText('Лимит применён');
    expect(plain(applied.closest('div'))).toContain('50 000,00 ₸');

    // Инвалидация ключей: таблица лимитов перечитывается, а не остаётся старой.
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        ([url]) => String(url) === '/api/v1/accounts/acc-1/limits',
      );
      expect(calls.length).toBeGreaterThanOrEqual(3); // чтение, PUT, повторное чтение
    });
  });

  it('у SUPPORT не рисует форму и не запрашивает лимиты вовсе', async () => {
    const fetchMock = accountService();

    const { container } = renderWithProviders(
      <AccountsSection section={SECTION} role="SUPPORT" canWrite={false} />,
    );
    openAccount();

    // Карточка счёта и резервы доступны оператору поддержки — они загружаются.
    const card = await panelByHeading(/Айдар Сериков/);
    expect(within(card).getByText('Текущий счёт')).toBeInTheDocument();

    expect(await screen.findByText('Изменение лимитов доступно роли ADMIN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить лимит' })).toBeNull();
    expect(screen.queryByLabelText(/Новый лимит/)).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/limits'))).toBe(false);

    // Форма поиска счёта остаётся (это не изменяющее действие), а помеченных
    // изменяющих действий нет ни одного — именно это проверяет e2e/check-admin.mjs.
    expect(screen.getByLabelText('Идентификатор счёта')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-admin-write]')).toHaveLength(0);

    // Плотность не падает вместе с формой: у SUPPORT блоков столько же, плиток тоже.
    expect(container.querySelectorAll('[data-admin-panel]').length).toBeGreaterThanOrEqual(
      DENSITY.panels - 1,
    );
    expect(container.querySelectorAll('[data-admin-kpi]').length).toBeGreaterThanOrEqual(
      DENSITY.kpis,
    );
  });
});

/** Раздел под ролью ADMIN: так проверок не приходится повторять одно и то же. */
function renderWithDefaults() {
  return renderWithProviders(<AccountsSection section={SECTION} role="ADMIN" canWrite />);
}
