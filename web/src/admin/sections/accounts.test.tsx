import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { adminSectionById } from '../sections';
import { jsonResponse, problemResponse, renderWithProviders, stubFetch } from '../../test/utils';
import AccountsSection from './accounts';

/**
 * Раздел «Счета, лимиты и холды».
 *
 * Проверяются не картинки, а правила раздела:
 *  - счёт открывается по идентификатору, и на пустое значение НИ ОДНОГО запроса не уходит;
 *  - у SUPPORT форма лимитов не рисуется и `/limits` не запрашивается (в сервисе это
 *    гарантированный 403, и раздел не должен выглядеть сломанным);
 *  - суммы печатаются из минорных единиц, а ошибка сервиса показывается словами.
 */

const SECTION = adminSectionById('accounts')!;

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
  ],
  page: 0,
  size: 20,
  totalElements: 1,
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

describe('счета: поиск по идентификатору', () => {
  it('не отправляет ни одного запроса, пока идентификатор не введён', async () => {
    const fetchMock = stubFetch(() => jsonResponse({}));

    renderWithProviders(<AccountsSection section={SECTION} role="ADMIN" canWrite />);

    expect(await screen.findByText('Счёт не выбран')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('показывает снимок счёта, выписку и резервы по введённому идентификатору', async () => {
    accountService();

    renderWithProviders(<AccountsSection section={SECTION} role="ADMIN" canWrite />);
    openAccount();

    // Снимок: владелец и суммы из минорных единиц (500 000 тиын = 5 000,00 ₸).
    expect(await screen.findByText('Айдар Сериков')).toBeInTheDocument();
    expect(screen.getByText('U-1')).toBeInTheDocument();
    expect(screen.getByText('+77001234567')).toBeInTheDocument();
    expect(screen.getByText('5 000,00 ₸')).toBeInTheDocument();
    expect(screen.getByText('1 500,00 ₸')).toBeInTheDocument();
    expect(screen.getByText('3 500,00 ₸')).toBeInTheDocument();

    // Выписка леджера: списание со знаком минус и остаток после операции.
    expect(await screen.findByText('Оплата')).toBeInTheDocument();
    expect(screen.getByText('−1 848,00 ₸')).toBeInTheDocument();
    expect(screen.getByText('3 152,00 ₸')).toBeInTheDocument();

    // Резервы: причина, состояние словами и сумма.
    const reasonCell = await screen.findByText('Поездка в процессе');
    const holdRow = reasonCell.closest('tr');
    expect(holdRow).not.toBeNull();
    expect(within(holdRow as HTMLElement).getByText('Активен')).toBeInTheDocument();
    expect(within(holdRow as HTMLElement).getByText('1 200,00 ₸')).toBeInTheDocument();
  });

  it('показывает ошибку сервиса в каждом блоке отдельно, а не одним «раздел упал»', async () => {
    stubFetch(() => problemResponse({ code: 'ACCOUNT_NOT_FOUND', detail: 'account not found' }, 404));

    renderWithProviders(<AccountsSection section={SECTION} role="ADMIN" canWrite />);
    openAccount('нет-такого');

    // Заголовок не переопределяется: показывается перевод кода сервиса от humanMessage.
    // Четыре блока (снимок, выписка, резервы, лимиты) запрашиваются независимо и каждый
    // сообщает о своей ошибке — то есть недоступность одного не гасит остальные.
    await waitFor(() => {
      expect(screen.getAllByText('Счёт не найден')).toHaveLength(4);
    });
    // Рядом видно и то, что ответил сервис, и correlationId для поддержки.
    expect(screen.getAllByText('account not found').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/corr-test-1/).length).toBeGreaterThan(0);
  });
});

describe('счета: лимиты и роль', () => {
  it('у ADMIN показывает таблицу лимитов и форму изменения', async () => {
    accountService();

    renderWithProviders(<AccountsSection section={SECTION} role="ADMIN" canWrite />);
    openAccount();

    const limitsTable = await screen.findByRole('table', {
      name: 'Лимиты исходящих операций по окнам',
    });
    expect(within(limitsTable).getByText('Дневной')).toBeInTheDocument();
    expect(within(limitsTable).getByText('50 000,00 ₸')).toBeInTheDocument();
    expect(within(limitsTable).getByText('12 300,00 ₸')).toBeInTheDocument();
    expect(within(limitsTable).getByText('37 700,00 ₸')).toBeInTheDocument();

    // Скоростной контроль показывается, но формы для него нет — PUT его не меняет.
    expect(screen.getByText('включён')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Сохранить лимит' })).toBeInTheDocument();
    // Ярлык поля несёт звёздочку обязательности, поэтому ищем по части текста.
    expect(screen.getByLabelText(/Новый лимит, дневной/)).toBeInTheDocument();

    // Контракт админ-панели: изменяющее действие помечено data-admin-write, и метка
    // стоит на самой форме, которая отправляет PUT.
    const writeControl = screen.getByRole('button', { name: 'Сохранить лимит' }).closest('form');
    expect(writeControl?.getAttribute('data-admin-write')).toBe('изменение лимитов');
  });

  it('у SUPPORT не рисует форму и не запрашивает лимиты вовсе', async () => {
    const fetchMock = accountService();

    const { container } = renderWithProviders(
      <AccountsSection section={SECTION} role="SUPPORT" canWrite={false} />,
    );
    openAccount();

    // Снимок доступен оператору поддержки — он загружается.
    expect(await screen.findByText('Айдар Сериков')).toBeInTheDocument();

    expect(await screen.findByText('Изменение лимитов доступно роли ADMIN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить лимит' })).toBeNull();
    expect(screen.queryByLabelText(/Новый лимит/)).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/limits'))).toBe(false);

    // Форма поиска счёта остаётся (это не изменяющее действие), а помеченных
    // изменяющих действий нет ни одного — именно это проверяет e2e/check-admin.mjs.
    expect(screen.getByLabelText('Идентификатор счёта')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-admin-write]')).toHaveLength(0);
  });
});
