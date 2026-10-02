import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  DEMO_PHONE,
  DEMO_USER,
  TRANSFER_PATH,
  TRANSFER_RECIPIENT,
  apiUrl,
  ensureBalance,
  ensureKztAccount,
  listAccounts,
  loginAsDemoUser,
  readAvailableMinor,
  requestToken,
  type Session,
} from './helpers';

/**
 * The money path: phone-to-phone transfer.
 *
 * Three things are asserted, in the order they matter:
 *
 *  1. the happy path reports a payment number the user can quote, and the
 *     backend agrees with the receipt;
 *  2. a second submit while the first request is still in flight does **not**
 *     put a second `POST /api/v1/payments/transfers` on the wire (counted at the
 *     network layer, not inferred from the UI);
 *  3. the form refuses invalid input — including a transfer to the caller's own
 *     number — before anything is sent.
 *
 * The suite owns both sides of the transfer: the demo account is the source and
 * is topped up when the earlier runs of these specs have drained it, while the
 * recipient account is provisioned for {@link TRANSFER_RECIPIENT}. Without an
 * active KZT account on the recipient the gateway refuses the payment with
 * `TARGET_ACCOUNT_NOT_FOUND`, which is a backend precondition, not a UI bug.
 */

const TRANSFER = {
  amountMajor: 1_000,
  amountMinor: 100_000,
  description: 'e2e playwright: обед',
} as const;

/** The suite keeps the demo account funded, so the happy path is re-runnable. */
const MINIMUM_BALANCE_MINOR = 5_000_000;

/** Records every request the browser sends to the money endpoint. */
interface TransferRequest {
  idempotencyKey: string | undefined;
  body: unknown;
}

function trackTransferRequests(page: Page): TransferRequest[] {
  const requests: TransferRequest[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes(TRANSFER_PATH)) {
      requests.push({
        idempotencyKey: request.headers()['idempotency-key'],
        body: request.postDataJSON(),
      });
    }
  });
  return requests;
}

async function openTransferForm(page: Page): Promise<void> {
  await page.goto('/transfer');
  await expect(page.getByRole('heading', { name: 'Перевод по номеру телефона' })).toBeVisible();
  await expect(page.locator('input[name="sourceAccountId"]').first()).toBeVisible();
  await expect(page.getByText('Шаг 1 из 2')).toBeVisible();
}

/** Fills step 1 and moves to the review step. */
async function fillAndReview(
  page: Page,
  recipientPhone: string,
  amountMajor: number,
  description: string,
): Promise<void> {
  await page.getByLabel('Телефон получателя').fill(recipientPhone);
  await page.getByLabel('Сумма перевода').fill(String(amountMajor));
  await page.getByLabel('Комментарий').fill(description);
  await page.getByRole('button', { name: 'Перейти к подтверждению' }).click();
  await expect(page.getByRole('heading', { name: 'Проверьте перевод' })).toBeVisible();
}

/** Confirms the transfer; returns the confirm button so callers can assert on it. */
async function confirmTransfer(page: Page): Promise<Locator> {
  const confirm = page.getByRole('button', { name: 'Подтвердить перевод' });
  await confirm.click();
  return confirm;
}

/** Available balance of the dashboard's first account card (needs `/`). */
async function readDashboardBalance(page: Page): Promise<number> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Здравствуйте/ })).toBeVisible();
  return readAvailableMinor(page);
}

test.describe('перевод по номеру телефона', () => {
  let session: Session;
  let sourceAccountId: string;

  test.beforeEach(async ({ page, request }) => {
    session = await loginAsDemoUser(page, request);

    // Both sides of the payment must exist and be funded; both calls are safe to
    // repeat, so the specs are re-runnable against a long-lived demo stack.
    const sourceAccount = await ensureKztAccount(request, session.accessToken);
    sourceAccountId = sourceAccount.id;
    await ensureBalance(request, session.accessToken, sourceAccount, MINIMUM_BALANCE_MINOR);

    const recipientToken = await requestToken(request, TRANSFER_RECIPIENT, 'E2E Recipient', [
      'CUSTOMER',
    ]);
    const recipientAccount = await ensureKztAccount(request, recipientToken.accessToken);
    // Funded with the demo user's token, not the recipient's: topping up an account
    // is an operator action and the platform refuses a customer token with 403 —
    // correctly so. The new balance is read back with the recipient's token, because
    // an operator sees his own accounts only. Using the recipient's token for both
    // steps only worked while his balance happened to be non-zero already, and
    // failed on every fresh database (CI).
    await ensureBalance(
      request,
      session.accessToken,
      recipientAccount,
      100_000,
      recipientToken.accessToken,
    );
  });

  test('успешный перевод показывает состояние успеха с номером платежа', async ({
    page,
    request,
  }) => {
    const requests = trackTransferRequests(page);

    const availableBefore = await readDashboardBalance(page);
    expect(availableBefore).toBeGreaterThan(TRANSFER.amountMinor);

    await openTransferForm(page);
    await fillAndReview(page, TRANSFER_RECIPIENT, TRANSFER.amountMajor, TRANSFER.description);

    // The review step states exactly what will be sent, before anything moves.
    await expect(page.getByText('Шаг 2 из 2')).toBeVisible();
    await expect(page.getByText('(P2P по номеру)')).toBeVisible();
    await expect(page.getByText(TRANSFER.description)).toBeVisible();
    expect(requests).toHaveLength(0);

    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes(TRANSFER_PATH),
    );
    await confirmTransfer(page);
    const response = await responsePromise;
    expect([200, 201, 202]).toContain(response.status());
    const body = (await response.json()) as {
      paymentId: string;
      paymentNumber: string;
      amountMinor: number;
      status: string;
    };
    expect(body.paymentId).not.toBe('');
    expect(body.amountMinor).toBe(TRANSFER.amountMinor);

    // Success state: the receipt names the payment the user can quote to support.
    await expect(page.getByRole('heading', { name: 'Перевод отправлен' })).toBeVisible();
    await expect(page.getByRole('heading', { name: `Платёж № ${body.paymentNumber}` })).toBeVisible();
    await expect(page.locator('dt', { hasText: 'ID платежа' }).locator('+ dd')).toHaveText(
      body.paymentId,
    );
    await expect(page.getByRole('link', { name: 'Открыть платёж' })).toHaveAttribute(
      'href',
      `/payments/${body.paymentId}`,
    );

    // Exactly one money request went out.
    expect(requests).toHaveLength(1);

    // The backend recorded the same payment the receipt shows.
    const persisted = await request.get(apiUrl(`/v1/payments/${body.paymentId}`), {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    expect(persisted.status(), 'GET /v1/payments/{id}').toBe(200);
    const persistedBody = (await persisted.json()) as {
      payment?: { paymentId: string; paymentNumber: string };
      paymentId?: string;
    };
    expect(persistedBody.payment?.paymentId ?? persistedBody.paymentId).toBe(body.paymentId);

    // The receipt link opens the payment detail screen for that payment.
    await page.getByRole('link', { name: 'Открыть платёж' }).click();
    await expect(page).toHaveURL(new RegExp(`/payments/${body.paymentId}$`));

    // And the ledger reflects the debit on the dashboard.
    const availableAfter = await readDashboardBalance(page);
    expect(availableAfter).toBeLessThan(availableBefore);
  });

  test('повторный submit во время первого запроса не отправляет второй перевод', async ({
    page,
    request,
  }) => {
    const requests = trackTransferRequests(page);

    await openTransferForm(page);
    const description = `e2e playwright: двойной submit ${Date.now()}`;
    await fillAndReview(page, TRANSFER_RECIPIENT, TRANSFER.amountMajor, description);

    const confirm = page.getByRole('button', { name: 'Подтвердить перевод' });
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes(TRANSFER_PATH),
    );

    // Two submits back to back, with no awaits in between: this is what a double
    // click (or a fast keyboard auto-repeat) produces on a fast machine, where
    // the browser has not re-rendered the button yet. `dispatchEvent` bypasses
    // actionability checks on purpose, so a disabled button cannot silently
    // swallow the second submit and make the assertion vacuous.
    await confirm.dispatchEvent('click');
    await confirm.dispatchEvent('click');
    const response = await responsePromise;
    const created = (await response.json()) as { paymentId: string };

    await expect(page.getByRole('heading', { name: 'Перевод отправлен' })).toBeVisible();

    // The whole point: one user intent, one request on the wire.
    expect(
      requests.map((entry) => entry.body),
      'POST /api/v1/payments/transfers while the first one was in flight',
    ).toHaveLength(1);

    // And that request carried the key the API needs to deduplicate a retry.
    const [first] = requests;
    expect(first?.idempotencyKey, 'Idempotency-Key header').toMatch(/^[0-9a-fA-F-]{8,}$/);

    // The backend really did move the money once: exactly one payment carries
    // this run's unique comment, and it is the one the receipt shows. The marker
    // makes the assertion valid on every re-run against a long-lived demo stack.
    let matching: { paymentId: string }[] = [];
    await expect
      .poll(
        async () => {
          const listed = await request.get(apiUrl('/v1/payments'), {
            headers: { Authorization: `Bearer ${session.accessToken}` },
            params: { page: 0, size: 50 },
          });
          expect(listed.status(), 'GET /v1/payments').toBe(200);
          const body = (await listed.json()) as {
            items?: { paymentId: string; description?: string | null }[];
            content?: { paymentId: string; description?: string | null }[];
          };
          matching = (body.items ?? body.content ?? []).filter(
            (payment) => payment.description === description,
          );
          return matching.length;
        },
        { message: `payments recorded with comment «${description}»` },
      )
      .toBe(1);
    expect(matching[0]?.paymentId).toBe(created.paymentId);

    // A genuine second transfer is still possible: it is a new intent and mints
    // a new idempotency key.
    await page.getByRole('button', { name: 'Повторить перевод' }).click();
    await expect(page.getByText('Шаг 1 из 2')).toBeVisible();
    await fillAndReview(
      page,
      TRANSFER_RECIPIENT,
      TRANSFER.amountMajor,
      'e2e playwright: повтор намеренно',
    );
    await confirmTransfer(page);
    await expect(page.getByRole('heading', { name: 'Перевод отправлен' })).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]?.idempotencyKey).not.toBe(first?.idempotencyKey);
  });

  test('перевод на свой номер отклоняется формой и не уходит на сервер', async ({ page }) => {
    const requests = trackTransferRequests(page);

    await openTransferForm(page);

    // The source account belongs to the signed-in phone number.
    await page.getByLabel('Телефон получателя').fill(DEMO_PHONE);
    await page.getByLabel('Сумма перевода').fill(String(TRANSFER.amountMajor));
    await page.getByRole('button', { name: 'Перейти к подтверждению' }).click();

    const alert = page.getByRole('alert').filter({ hasText: 'Проверьте поля формы' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Нельзя перевести средства на свой же счёт');
    await expect(page.getByRole('heading', { name: 'Перевод по номеру телефона' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Проверьте перевод' })).toBeHidden();
    expect(requests).toHaveLength(0);
  });

  test('незаполненная форма не пропускается на шаг подтверждения', async ({ page }) => {
    const requests = trackTransferRequests(page);

    await openTransferForm(page);

    await page.getByLabel('Телефон получателя').fill('+7 700');
    await page.getByRole('button', { name: 'Перейти к подтверждению' }).click();

    const alert = page.getByRole('alert').filter({ hasText: 'Проверьте поля формы' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Укажите сумму');

    // The recipient field carries its own message too.
    await expect(
      page.locator('#transfer-phone-error').getByText('Введите номер получателя в формате', {
        exact: false,
      }),
    ).toBeVisible();

    // Still step 1, nothing sent.
    await expect(page.getByRole('heading', { name: 'Проверьте перевод' })).toBeHidden();
    expect(requests).toHaveLength(0);
  });

  test('сумма больше доступного остатка отклоняется на шаге проверки', async ({ page }) => {
    const requests = trackTransferRequests(page);

    const availableMinor = await readDashboardBalance(page);
    await openTransferForm(page);

    await page.getByLabel('Телефон получателя').fill(TRANSFER_RECIPIENT);
    await page.getByLabel('Сумма перевода').fill(String(Math.ceil(availableMinor / 100) + 1_000));
    await page.getByRole('button', { name: 'Перейти к подтверждению' }).click();

    await expect(
      page.locator('#transfer-amount-error').getByText('Недостаточно средств на выбранном счёте'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Проверьте перевод' })).toBeHidden();
    expect(requests).toHaveLength(0);
  });

  test('источником можно выбрать любой свой счёт, и перевод уходит с него', async ({
    page,
    request,
  }) => {
    // A second KZT account exists only if the demo user opened one, so this spec
    // asserts on the accounts the API actually reports instead of assuming two.
    const accounts = await listAccounts(request, session.accessToken);
    const alternatives = accounts.filter((account) => account.id !== sourceAccountId);

    await openTransferForm(page);
    const radios = page.locator('input[name="sourceAccountId"]');
    await expect(radios).toHaveCount(accounts.length);

    if (alternatives.length === 0) {
      // Single-account accounts: the picker still has to reflect the only option.
      await expect(radios.first()).toBeChecked();
      await expect(radios.first()).toHaveAttribute('value', sourceAccountId);
      return;
    }

    const alternative = alternatives[0]!;
    const radio = page.locator(`input[name="sourceAccountId"][value="${alternative.id}"]`);
    await radio.check();
    await expect(radio).toBeChecked();

    const requests = trackTransferRequests(page);
    await page.getByLabel('Телефон получателя').fill(TRANSFER_RECIPIENT);
    await page.getByLabel('Сумма перевода').fill('50');
    await page.getByRole('button', { name: 'Перейти к подтверждению' }).click();
    await expect(page.getByRole('heading', { name: 'Проверьте перевод' })).toBeVisible();
    await confirmTransfer(page);
    await expect(page.getByRole('heading', { name: 'Перевод отправлен' })).toBeVisible();
    expect(requests).toHaveLength(1);
  });

  test('номер источника по умолчанию — номер вошедшего пользователя', async ({ page }) => {
    await openTransferForm(page);
    // The first account belongs to the demo phone, which is what the self-transfer
    // validation compares against — so the default must be that account.
    const checked = page.locator('input[name="sourceAccountId"]:checked');
    await expect(checked).toHaveCount(1);
    await expect(checked).toHaveAttribute('value', sourceAccountId);
    expect(DEMO_USER.phone).toBe(DEMO_PHONE);
  });
});
