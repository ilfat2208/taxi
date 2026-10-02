import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { formatAmountTyping } from '../api/money';
import { TransferPage } from './TransferPage';
import {
  bodyOf,
  deferred,
  headerOf,
  jsonResponse,
  kztAccount,
  problemResponse,
  renderWithProviders,
  seedSession,
  stubFetch,
  type MockResponse,
} from '../test/utils';

const PAYMENT = {
  paymentId: 'pay-1',
  paymentNumber: 'P-2024-0001',
  type: 'TRANSFER',
  status: 'COMPLETED',
  amountMinor: 150_000,
  feeMinor: 0,
  totalMinor: 150_000,
  currency: 'KZT',
  sourceAccountId: kztAccount.id,
  targetAccountId: 'acc-2',
  merchantId: null,
  description: null,
  failureCode: null,
  failureReason: null,
  createdAt: '2024-09-01T10:15:30Z',
  completedAt: '2024-09-01T10:15:31Z',
};

/** Accounts are read on mount; anything else is a surprise the test should see. */
function accountsOnly(extra?: (url: string, init?: RequestInit) => MockResponse | undefined) {
  return stubFetch((url, init) => {
    const fromExtra = extra?.(url, init);
    if (fromExtra) {
      return fromExtra;
    }
    if (url.includes('/v1/accounts')) {
      return jsonResponse([kztAccount]);
    }
    return problemResponse({ code: 'NOT_FOUND', title: 'Not found', status: 404 }, 404);
  });
}

function transferPosts(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes('/v1/payments/transfers'));
}

/** Fills step 1 and moves to the review step. */
async function fillAndReview(
  user: ReturnType<typeof userEvent.setup>,
  phone = '7009998877',
  amount = '1500',
) {
  await screen.findByText('Текущий счёт');
  await user.type(screen.getByLabelText(/Телефон получателя/), phone);
  await user.type(screen.getByLabelText(/Сумма перевода/), amount);
  await user.click(screen.getByRole('button', { name: 'Перейти к подтверждению' }));
}

describe('transfer form', () => {
  beforeEach(() => {
    seedSession();
  });

  it('validates the recipient and the amount, tying errors to the inputs', async () => {
    const fetchMock = accountsOnly();
    const user = userEvent.setup();
    renderWithProviders(<TransferPage />);

    await screen.findByText('Текущий счёт');

    // Empty form: both fields are flagged, nothing is sent.
    await user.click(screen.getByRole('button', { name: 'Перейти к подтверждению' }));

    const phoneInput = screen.getByLabelText(/Телефон получателя/);
    const amountInput = screen.getByLabelText(/Сумма перевода/);
    expect(phoneInput).toHaveAttribute('aria-invalid', 'true');
    expect(amountInput).toHaveAttribute('aria-invalid', 'true');
    // The messages are attached to their inputs, not floating in the page.
    expect(document.getElementById('transfer-phone-error')).toHaveTextContent(
      'Введите номер получателя в формате +7 700 000 00 00',
    );
    expect(document.getElementById('transfer-amount-error')).toHaveTextContent('Укажите сумму');

    // The error text is wired to the input through aria-describedby.
    const describedBy = amountInput.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain('transfer-amount-error');
    expect(transferPosts(fetchMock)).toHaveLength(0);

    // An amount above the available balance is refused client-side.
    await user.type(phoneInput, '7009998877');
    await user.type(amountInput, '9000');
    await user.click(screen.getByRole('button', { name: 'Перейти к подтверждению' }));
    expect(document.getElementById('transfer-amount-error')).toHaveTextContent(
      'Недостаточно средств на выбранном счёте',
    );
    // The amount is reformatted as it is typed (grouping separators appear).
    expect(amountInput).toHaveValue(formatAmountTyping('9000'));
    expect(transferPosts(fetchMock)).toHaveLength(0);
    expect(screen.queryByText('Подтвердить перевод')).not.toBeInTheDocument();
  });

  it('reviews the transfer, then sends it once with an Idempotency-Key', async () => {
    const fetchMock = accountsOnly((url) =>
      url.includes('/v1/payments/transfers') ? jsonResponse(PAYMENT, 201) : undefined,
    );
    const user = userEvent.setup();
    renderWithProviders(<TransferPage />);

    await fillAndReview(user);

    // Step 2 shows the masked recipient and the amount about to be sent.
    expect(screen.getByText(/\+7 700 \*\*\* 88 77/)).toBeInTheDocument();
    expect(screen.getByText(/^1\s500,00\s*₸$/u)).toBeInTheDocument();
    expect(transferPosts(fetchMock)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Подтвердить перевод' }));

    await screen.findByText('Платёж № P-2024-0001');

    const posts = transferPosts(fetchMock);
    expect(posts).toHaveLength(1);
    expect(headerOf(posts[0]?.[1], 'Idempotency-Key')).toBeTruthy();
    expect(bodyOf(posts[0]?.[1])).toMatchObject({
      sourceAccountId: kztAccount.id,
      targetPhone: '+77009998877',
      amountMinor: 150_000,
      currency: 'KZT',
    });
  });

  it('cannot send two transfers from a double click', async () => {
    // The request stays in flight for the whole test, so the button is clickable
    // again only if the double-submit guard is broken.
    const pending = deferred<MockResponse>();
    const fetchMock = stubFetch((url) =>
      url.includes('/v1/payments/transfers') ? pending.promise : jsonResponse([kztAccount]),
    );

    const user = userEvent.setup();
    renderWithProviders(<TransferPage />);
    await fillAndReview(user);

    const confirm = screen.getByRole('button', { name: 'Подтвердить перевод' });
    await user.click(confirm);

    // The button is disabled and busy while the mutation is in flight.
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(confirm).toHaveAttribute('aria-busy', 'true');

    await user.click(confirm);
    await user.click(confirm);

    expect(transferPosts(fetchMock)).toHaveLength(1);

    // Let the request finish so the component unmounts cleanly.
    await act(async () => {
      pending.resolve(jsonResponse(PAYMENT, 201));
    });
    await screen.findByText('Платёж № P-2024-0001');
    expect(transferPosts(fetchMock)).toHaveLength(1);
  });

  it('reuses the key when retrying a failed submit and mints a new one for a repeat', async () => {
    let attempt = 0;
    const fetchMock = accountsOnly((url) => {
      if (!url.includes('/v1/payments/transfers')) {
        return undefined;
      }
      attempt += 1;
      if (attempt === 1) {
        // First attempt fails at the edge, so nothing was moved.
        return problemResponse(
          { code: 'SERVICE_UNAVAILABLE', title: 'Service Unavailable', status: 503, detail: 'downstream is down' },
          503,
          'corr-transfer-1',
        );
      }
      return jsonResponse(PAYMENT, 201);
    });

    const user = userEvent.setup();
    renderWithProviders(<TransferPage />);
    await fillAndReview(user);

    await user.click(screen.getByRole('button', { name: 'Подтвердить перевод' }));
    expect(await screen.findByText('Перевод не выполнен')).toBeInTheDocument();

    // Retrying the *same* submit keeps the key: the API replays, it does not duplicate.
    await user.click(screen.getByRole('button', { name: 'Повторить отправку' }));
    await screen.findByText('Платёж № P-2024-0001');

    const posts = transferPosts(fetchMock);
    expect(posts).toHaveLength(2);
    const firstKey = headerOf(posts[0]?.[1], 'Idempotency-Key');
    const secondKey = headerOf(posts[1]?.[1], 'Idempotency-Key');
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);

    // "Повторить" starts a genuinely new transfer: a new key, a new payment.
    await user.click(screen.getByRole('button', { name: 'Повторить перевод' }));
    await user.click(screen.getByRole('button', { name: 'Перейти к подтверждению' }));
    await user.click(screen.getByRole('button', { name: 'Подтвердить перевод' }));
    await waitFor(() => expect(transferPosts(fetchMock)).toHaveLength(3));

    const thirdKey = headerOf(transferPosts(fetchMock)[2]?.[1], 'Idempotency-Key');
    expect(thirdKey).toBeTruthy();
    expect(thirdKey).not.toBe(firstKey);
  });
});
