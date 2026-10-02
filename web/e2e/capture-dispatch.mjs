/**
 * Captures the dispatcher live map into docs/img/dispatch-live-map.png.
 *
 * Not a test: a documentation tool. It logs in as a dispatcher through the real
 * gateway, puts the session where the app expects it, opens /dispatch and waits
 * for the fleet to appear on the map. Run it with the stack and the web dev
 * server up:
 *
 *   node e2e/capture-dispatch.mjs
 *
 * Everything it needs is real: a real token, the real endpoints, real drivers
 * reported by scripts/simulate-fleet.ps1. The only synthetic part is the account
 * itself, which the dev identity provider mints from a phone number.
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5173';
const API_URL = process.env.API_URL ?? 'http://localhost:8080';
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  process.env.OUT ?? '../../docs/img/dispatch-live-map.png',
);

const phone = process.env.DISPATCHER_PHONE ?? '+77001234567';

async function dispatcherSession() {
  const response = await fetch(`${API_URL}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ phone, code: '0000', displayName: 'Диспетчер', roles: ['DISPATCHER'] }),
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
    roles: token.roles ?? ['DISPATCHER'],
    displayName: 'Диспетчер',
    phone,
    issuedAt: now,
    expiresAt: now + (token.expiresIn ?? 3600) * 1000,
  };
}

const session = await dispatcherSession();
console.log(`[capture] dispatcher token for ${session.userId}, roles=${session.roles.join(',')}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 1 });

// The session must exist before the app boots, hence addInitScript and not evaluate.
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

await page.goto(`${WEB_URL}/dispatch`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.leaflet-container', { timeout: 20_000 });

// Wait for at least one driver marker, then let a couple of polls land so the
// screenshot shows cars that have actually moved.
await page.waitForSelector('.leaflet-marker-icon', { timeout: 30_000 });
const before = await page.locator('.leaflet-marker-icon').count();
await page.waitForTimeout(6000);
const after = await page.locator('.leaflet-marker-icon').count();

// Select a driver so the side panel is filled in: a screenshot of a map without
// the panel would hide half of what the page does.
await page.locator('.leaflet-marker-icon').first().click();
await page.waitForTimeout(1500);

await mkdir(dirname(OUT), { recursive: true });
await page.screenshot({ path: OUT });

const summary = await page.evaluate(() => {
  const text = document.body.innerText.split('\n').map((line) => line.trim()).filter(Boolean);
  return text.slice(0, 24);
});

console.log(`[capture] markers before=${before} after=${after}`);
console.log(`[capture] page text: ${JSON.stringify(summary, null, 0)}`);
if (errors.length > 0) {
  console.log(`[capture] console errors: ${JSON.stringify(errors.slice(0, 5))}`);
}
console.log(`[capture] saved ${OUT}`);

await browser.close();
