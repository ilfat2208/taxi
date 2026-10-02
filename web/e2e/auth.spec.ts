import { expect, test } from '@playwright/test';
import {
  DEMO_CODE,
  DEMO_PHONE,
  availableBalance,
  ensureBalance,
  ensureKztAccount,
  loginAsDemoUser,
  readAvailableMinor,
  readStoredSession,
  requestToken,
} from './helpers';

/**
 * Login: the phone + SMS-code form against the development identity provider.
 *
 * Two outcomes matter for the product: a wrong code must produce a *readable*
 * error that carries a correlation id support can act on, and the demo code must
 * actually land the user on the dashboard with their money visible.
 */

const PROBE_ACCOUNT = {
  phone: '+77005550101',
  displayName: 'E2E Auth Probe',
  /** Enough to be clearly non-zero and stable across runs. */
  topUpMinor: 500_000,
} as const;

test.describe('вход по номеру телефона', () => {
  test('неверный код показывает понятную ошибку с correlation id', async ({ page }) => {
    const consoleMessages: string[] = [];
    page.on('console', (message) => consoleMessages.push(message.text()));

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'taxi' })).toBeVisible();

    await page.getByLabel('Номер телефона').fill(DEMO_PHONE);
    await page.getByLabel('Код из SMS').fill('9999');
    await page.getByRole('button', { name: 'Войти' }).click();

    // The screen names the failure instead of blaming the network.
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Неверный код подтверждения');
    await expect(alert).toContainText('Correlation ID:');
    await expect(alert).toContainText('Код: UNAUTHORIZED');

    // The correlation id is a real value, not an empty label.
    const correlationId = await alert.locator('code').first().innerText();
    expect(correlationId).toMatch(/^[0-9a-zA-Z._-]{8,}$/);

    // The same id is what the API layer logged for this failed request.
    expect(consoleMessages.some((line) => line.includes(`correlationId=${correlationId}`))).toBe(true);

    // No session was written, and the guard still keeps the app behind /login.
    expect(await readStoredSession(page)).toBeNull();
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('демо-код 0000 логирует и открывает главную с балансом счёта', async ({
    page,
    request,
  }) => {
    // A dedicated account, so the assertion does not depend on the demo user's
    // balance being untouched by other tests or by manual poking.
    const probeToken = await requestToken(
      request,
      PROBE_ACCOUNT.phone,
      PROBE_ACCOUNT.displayName,
      ['CUSTOMER', 'ADMIN'],
    );
    const account = await ensureKztAccount(request, probeToken.accessToken);
    const expectedMinor = await ensureBalance(
      request,
      probeToken.accessToken,
      account,
      PROBE_ACCOUNT.topUpMinor,
    );

    await page.goto('/login');
    await page.getByLabel('Номер телефона').fill(PROBE_ACCOUNT.phone);
    await page.getByRole('button', { name: `Ввести ${DEMO_CODE}` }).click();
    await expect(page.getByLabel('Код из SMS')).toHaveValue(DEMO_CODE);

    // The token the form itself obtains is the one the session must end up with.
    const tokenResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/auth/token') &&
        response.request().method() === 'POST' &&
        response.status() === 200,
    );
    await page.getByRole('button', { name: 'Войти' }).click();
    const issued = (await (await tokenResponse).json()) as { accessToken: string; userId: string };

    // Lands on the dashboard (the form's default redirect target).
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: /Здравствуйте/ })).toBeVisible();
    await expect(page.getByText('Вход выполнен', { exact: false })).toBeVisible();

    // The account balance is rendered from the live ledger.
    await expect(availableBalance(page)).toBeVisible();
    expect(await readAvailableMinor(page)).toBe(expectedMinor);

    // The session is persisted exactly the way the app persists it.
    const stored = await readStoredSession(page);
    expect(stored?.accessToken).toBe(issued.accessToken);
    expect(stored?.userId).toBe(issued.userId);
    expect(stored?.phone).toBe(PROBE_ACCOUNT.phone);
    expect(stored?.roles).toContain('CUSTOMER');
    expect(stored?.expiresAt ?? 0).toBeGreaterThan(Date.now());
  });

  test('неавторизованный посетитель попадает на вход, а после входа возвращается на свой адрес', async ({
    page,
  }) => {
    await page.goto('/transfer');
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel('Номер телефона').fill(DEMO_PHONE);
    await page.getByRole('button', { name: `Ввести ${DEMO_CODE}` }).click();
    await page.getByRole('button', { name: 'Войти' }).click();

    // The guard remembered where the visitor was heading.
    await expect(page).toHaveURL(/\/transfer$/);
    await expect(page.getByRole('heading', { name: 'Перевод по номеру телефона' })).toBeVisible();
    await expect(page.locator('input[name="sourceAccountId"]').first()).toBeVisible();
  });

  test('сессия из localStorage открывает защищённый раздел без формы входа', async ({
    page,
    request,
  }) => {
    const session = await loginAsDemoUser(page, request);
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /Здравствуйте/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Выйти из аккаунта' })).toBeVisible();

    const stored = await readStoredSession(page);
    expect(stored?.accessToken).toBe(session.accessToken);
    expect(await readAvailableMinor(page)).toBeGreaterThanOrEqual(0);
  });
});
