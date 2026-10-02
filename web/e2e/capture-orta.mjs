/**
 * Captures the two new verticals into docs/img/.
 *
 *   /taxi        -> docs/img/orta-taxi.png       (заказ поездки)
 *   /taxi/{id}   -> docs/img/orta-trip.png       (детали поездки и чек)
 *   /services    -> docs/img/orta-services.png   (ORTA Services: компании)
 *   /services/{companyId} -> docs/img/orta-company.png (окна и запись)
 *
 * Not a test: a documentation tool, like `capture-dispatch.mjs`. Everything it
 * shows is real — a token minted by the dev identity provider, trips and
 * companies read from the live stack. Ids are discovered through the API rather
 * than hard-coded, so the script does not rot when the demo database is
 * recreated.
 *
 * Run it with the stack and the web dev server up:
 *
 *   node e2e/capture-orta.mjs
 *
 * Optional environment: WEB_URL, API_URL, CUSTOMER_PHONE, OUT_DIR, TRIP_ID,
 * COMPANY_ID (skip discovery for one of them).
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5173';
const API_URL = process.env.API_URL ?? 'http://localhost:8080';
const OUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  process.env.OUT_DIR ?? '../../docs/img',
);

const phone = process.env.CUSTOMER_PHONE ?? '+77009990001';

async function customerSession() {
  const response = await fetch(`${API_URL}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ phone, code: '0000', displayName: 'Пассажир', roles: ['CUSTOMER'] }),
  });
  if (!response.ok) {
    throw new Error(`token request failed: HTTP ${response.status} ${await response.text()}`);
  }
  const token = await response.json();
  const now = Date.now();
  return {
    accessToken: token.accessToken,
    tokenType: token.tokenType ?? 'Bearer',
    userId: token.userId,
    roles: token.roles ?? ['CUSTOMER'],
    displayName: 'Пассажир',
    phone,
    issuedAt: now,
    expiresAt: now + (token.expiresIn ?? 3600) * 1000,
  };
}

/** The most interesting trip to photograph: a completed one, else the newest. */
async function findTripId(session) {
  if (process.env.TRIP_ID) {
    return process.env.TRIP_ID;
  }
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  for (const status of ['COMPLETED', '']) {
    const query = status ? `?status=${status}&page=0&size=1` : '?page=0&size=1';
    const response = await fetch(`${API_URL}/api/v1/trips${query}`, { headers });
    if (!response.ok) {
      continue;
    }
    const page = await response.json();
    const id = page.items?.[0]?.tripId ?? page.content?.[0]?.tripId;
    if (id) {
      return id;
    }
  }
  return null;
}

async function findCompanyId() {
  if (process.env.COMPANY_ID) {
    return process.env.COMPANY_ID;
  }
  const response = await fetch(`${API_URL}/api/v1/qtime/companies?page=0&size=1`);
  if (!response.ok) {
    return null;
  }
  const page = await response.json();
  return page.items?.[0]?.companyId ?? page.content?.[0]?.companyId ?? null;
}

const session = await customerSession();
console.log(`[capture] customer ${session.userId}, roles=${session.roles.join(',')}`);

const tripId = await findTripId(session);
const companyId = await findCompanyId();
console.log(`[capture] trip=${tripId ?? '—'} company=${companyId ?? '—'}`);

const targets = [
  { path: '/taxi', out: 'orta-taxi.png' },
  { path: tripId ? `/taxi/${tripId}` : null, out: 'orta-trip.png' },
  { path: '/services', out: 'orta-services.png' },
  { path: companyId ? `/services/${companyId}` : null, out: 'orta-company.png' },
].filter((target) => target.path !== null);

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });

// The session must exist before the app boots, hence addInitScript.
await page.addInitScript(
  ([key, value]) => window.localStorage.setItem(key, value),
  ['taxi.session', JSON.stringify(session)],
);

const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') {
    errors.push(message.text());
  }
});

for (const target of targets) {
  const out = resolve(OUT_DIR, target.out);
  await page.goto(`${WEB_URL}${target.path}`, { waitUntil: 'domcontentloaded' });
  // Network idle would hang on the polling pages (the trip status refreshes on a
  // timer), so wait for the shell to settle and give the first data render time.
  await page.waitForLoadState('load');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: out, fullPage: true });

  const summary = await page.evaluate(() =>
    document.body.innerText.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 18),
  );
  console.log(`[capture] ${target.path} -> ${out}`);
  console.log(`[capture]   text: ${JSON.stringify(summary, null, 0)}`);
}

if (errors.length > 0) {
  console.log(`[capture] console errors: ${JSON.stringify(errors.slice(0, 8))}`);
} else {
  console.log('[capture] no console errors');
}

await browser.close();
