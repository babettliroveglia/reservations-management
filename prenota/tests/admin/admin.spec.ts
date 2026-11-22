// Staff admin. Use cases from OpenResto's tests (auth-security, admin-dashboard, admin-pause,
// cancel-past-booking), for tastings. Runs on desktop only.
import { expect, test } from '@playwright/test';
import { ADMIN_URL, IS_LOCAL, LOCKED_ADMIN_URL, availability, book, emptyDay, slotCapacity } from '../helpers';

test.describe('Admin access', { annotation: { type: 'area', description: 'Admin' } }, () => {
  test('without a Cloudflare Access login the admin refuses pages and data', {
    tag: ['@critical'],
    annotation: { type: 'fix', description: 'The admin Worker must check the Access token on every request (src/admin.ts, src/access.ts).' },
  }, async ({ request }) => {
    test.skip(!IS_LOCAL, 'Uses the local locked admin');
    for (const path of ['/', '/admin.js', '/api/me', '/api/bookings', '/api/settings']) {
      expect((await request.get(`${LOCKED_ADMIN_URL}${path}`)).status(), path).toBe(403);
    }
    // A made-up login token doesn't get in either.
    const fake = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.eyJhdWQiOiJ0ZXN0LWF1ZGllbmNlIiwiZW1haWwiOiJ4QHgueCJ9.c2ln';
    expect((await request.get(`${LOCKED_ADMIN_URL}/api/bookings`, { headers: { 'cf-access-jwt-assertion': fake } })).status()).toBe(403);
    expect((await request.post(`${LOCKED_ADMIN_URL}/api/closures/2030-01-02`, { data: {} })).status()).toBe(403);
  });

  test('the public booking site has no admin functions', { tag: ['@critical'] }, async ({ request }) => {
    for (const path of ['/api/settings', '/api/closures', '/api/me']) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
  });
});

test.describe('Staff tasks', { annotation: { type: 'area', description: 'Admin' } }, () => {
  test.skip(!IS_LOCAL, 'Signs in as staff@localhost: local copy only');
  test.skip(({ isMobile }) => isMobile, 'Admin is tested on desktop');

  test('staff see a booking in the list and can cancel it, which frees the places', { tag: ['@high'] }, async ({ page, request }) => {
    const date = await emptyDay(request);
    const name = `Cliente ${Date.now()}`;
    await book(request, { date, time: '15:00', adults: 5, name, notes: 'Compleanno' });
    await page.goto(`${ADMIN_URL}/`);
    await expect(page.locator('#me')).toHaveText('staff@localhost');
    await page.locator('#from').fill(date);
    await page.locator('#to').fill(date);
    await page.getByRole('button', { name: 'Aggiorna' }).click();
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toContainText('5 ad.');
    await expect(row).toContainText('Compleanno');
    await row.getByRole('button', { name: 'Annulla' }).click();
    await row.getByRole('button', { name: 'Conferma annullamento' }).click();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0);
    await page.locator('#show-cancelled').check();
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('annullata da staff@localhost');
    expect((await availability(request, date)).slots.find(s => s.time === '15:00')!.available).toBe(await slotCapacity(request));
  });

  test('closing a day stops bookings for it; reopening allows them again', { tag: ['@high'] }, async ({ page, request }) => {
    const date = await emptyDay(request, 20);
    await page.goto(`${ADMIN_URL}/`);
    await page.getByRole('tab', { name: 'Chiusure' }).click();
    await page.locator('#closure-date').fill(date);
    await page.locator('#closure-reason').fill('Vendemmia');
    await page.getByRole('button', { name: 'Chiudi il giorno' }).click();
    await expect(page.locator('#closure-message')).toContainText('Giorno chiuso');
    expect((await availability(request, date)).closed).toBe('Vendemmia');
    const refused = await book(request, { date });
    expect(refused.body.error).toMatch(/Siamo chiusi.*Vendemmia/);

    await page.getByRole('listitem').filter({ hasText: 'Vendemmia' }).getByRole('button', { name: 'Riapri' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Vendemmia' })).toHaveCount(0);
    expect((await availability(request, date)).closed).toBeNull();
  });

  test('closing a day that already has bookings warns staff', { tag: ['@medium'] }, async ({ request }) => {
    const date = await emptyDay(request, 25);
    await book(request, { date, adults: 2 });
    const res = await request.put(`${ADMIN_URL}/api/closures/${date}`, { data: { reason: 'Prova' } });
    expect((await res.json()).bookingsOnThatDay).toBe(1);
    await request.delete(`${ADMIN_URL}/api/closures/${date}`, { headers: { 'content-type': 'application/json' } });
  });

  test('changing the capacity changes the places offered', { tag: ['@medium'] }, async ({ page, request }) => {
    const before = await slotCapacity(request);
    const date = await emptyDay(request);
    try {
      await page.goto(`${ADMIN_URL}/`);
      await page.getByRole('tab', { name: 'Impostazioni' }).click();
      await expect(page.locator('#slot-capacity')).toHaveValue(String(before));
      await page.locator('#slot-capacity').fill(String(before + 4));
      await page.getByRole('button', { name: 'Salva' }).click();
      await expect(page.locator('#settings-message')).toContainText('salvate');
      expect((await availability(request, date)).slots[0].available).toBe(before + 4);
    } finally {
      await request.put(`${ADMIN_URL}/api/settings`, {
        data: { slotTimes: ['10:30', '15:00'], slotCapacity: before, horizonDays: 180 },
      });
    }
  });

  test('settings refuse impossible values', { tag: ['@medium'] }, async ({ request }) => {
    for (const data of [{ slotTimes: ['25:00'], slotCapacity: 20, horizonDays: 180 }, { slotTimes: ['10:30'], slotCapacity: 0, horizonDays: 180 }]) {
      expect((await request.put(`${ADMIN_URL}/api/settings`, { data })).status()).toBe(400);
    }
  });
});
