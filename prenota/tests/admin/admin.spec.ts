// Staff admin. Use cases from OpenResto's tests (auth-security, admin-dashboard, admin-pause,
// cancel-past-booking), for tastings. Runs on desktop only.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  ADMIN_URL, BASE_URL, IS_LOCAL, LOCKED_ADMIN_URL, availability, book, bookingBody, emptyDay, slotCapacity,
} from '../helpers';

/** In the admin's booking list, shows just one day. */
async function showDay(page: Page, date: string) {
  await page.locator('#from').fill(date);
  await page.locator('#to').fill(date);
  await page.getByRole('button', { name: 'Aggiorna' }).click();
}

async function bookingId(request: APIRequestContext, date: string, token: string): Promise<number> {
  const { bookings } = await (await request.get(`${ADMIN_URL}/api/bookings?from=${date}&to=${date}`)).json();
  return bookings.find((b: { token: string }) => b.token === token).id;
}

test.describe('Admin access', { annotation: { type: 'area', description: 'Admin' } }, () => {
  test('without a Cloudflare Access login the admin refuses pages and data', {
    tag: ['@critical'],
    annotation: { type: 'fix', description: 'The admin Worker must check the Access token on every request (src/admin.ts, src/access.ts).' },
  }, async ({ request }) => {
    test.skip(!IS_LOCAL, 'Uses the local locked admin');
    for (const path of ['/', '/admin.js', '/api/me', '/api/bookings', '/api/bookings/1', '/api/settings']) {
      expect((await request.get(`${LOCKED_ADMIN_URL}${path}`)).status(), path).toBe(403);
    }
    // A made-up login token doesn't get in either.
    const fake = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.eyJhdWQiOiJ0ZXN0LWF1ZGllbmNlIiwiZW1haWwiOiJ4QHgueCJ9.c2ln';
    expect((await request.get(`${LOCKED_ADMIN_URL}/api/bookings`, { headers: { 'cf-access-jwt-assertion': fake } })).status()).toBe(403);
    expect((await request.post(`${LOCKED_ADMIN_URL}/api/closures/2030-01-02`, { data: {} })).status()).toBe(403);
    expect((await request.put(`${LOCKED_ADMIN_URL}/api/bookings/1`, { data: {} })).status()).toBe(403);
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
    await showDay(page, date);
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

  test('staff open a booking and see all the guest\'s details and their link', { tag: ['@high'] }, async ({ page, request }) => {
    const date = await emptyDay(request);
    const name = `Dettagli ${Date.now()}`;
    const { body } = await book(request, { date, time: '10:30', adults: 2, teens: 1, name, email: 'dettagli@example.it', phone: '+39 333 1112223', notes: 'Vegetariani' });
    await page.goto(`${ADMIN_URL}/`);
    await showDay(page, date);
    await page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name })).toBeVisible();
    await expect(dialog.getByLabel('Nome e cognome'), 'the edit form stays hidden until Modifica').toBeHidden();
    for (const text of ['Percorso di Benvenuto', '10:30', '2 adulti, 1 ragazzo (13–17)', '62,50', 'Vegetariani', 'online dal cliente']) {
      await expect(dialog).toContainText(text);
    }
    await expect(dialog.getByRole('link', { name: 'dettagli@example.it' })).toHaveAttribute('href', 'mailto:dettagli@example.it');
    await expect(dialog.getByRole('link', { name: '+39 333 1112223' })).toHaveAttribute('href', 'tel:+393331112223');
    await expect(dialog.getByRole('textbox', { name: 'Link del cliente' })).toHaveValue(new RegExp(`/prenotazione\\?t=${body.token}$`));
  });

  test('staff change a booking: the party, time and details, with the price and places updated', { tag: ['@high'] }, async ({ page, request }) => {
    const date = await emptyDay(request);
    const capacity = await slotCapacity(request);
    const name = `Cambio ${Date.now()}`;
    await book(request, { date, time: '10:30', adults: 2, name });
    await page.goto(`${ADMIN_URL}/`);
    await showDay(page, date);
    await page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: 'Modifica', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Degustazione').selectOption('conoscenza');
    await dialog.getByLabel('Orario').selectOption('15:00');
    await dialog.getByLabel('Adulti').fill('4');
    await dialog.getByLabel('Bambini 0–12').fill('1');
    await dialog.getByLabel('Note').fill('Arrivano in ritardo');
    await dialog.getByRole('button', { name: 'Salva le modifiche' }).click();
    await expect(dialog).toContainText('Percorso di Conoscenza');
    await expect(dialog).toContainText('ore 15:00');
    await expect(dialog).toContainText('4 adulti, 1 bambino (0–12)');
    await expect(dialog).toContainText('152'); // 4 × 38
    await expect(dialog).toContainText('Modificata');
    await expect(dialog).toContainText('staff@localhost');
    const day = await availability(request, date);
    expect(day.slots.find(s => s.time === '10:30')!.available).toBe(capacity);
    expect(day.slots.find(s => s.time === '15:00')!.available).toBe(capacity - 5);
  });

  test('a change that doesn\'t fit is refused and the booking stays as it was', { tag: ['@high'] }, async ({ request }) => {
    const date = await emptyDay(request);
    const capacity = await slotCapacity(request);
    let left = capacity;
    while (left > 0) { const n = Math.min(10, left); await book(request, { date, time: '15:00', adults: n }); left -= n; }
    const { body } = await book(request, { date, time: '10:30', adults: 2 });
    const id = await bookingId(request, date, body.token!);
    const move = await request.put(`${ADMIN_URL}/api/bookings/${id}`, { data: { ...bookingBody({ date, time: '15:00', adults: 2 }) } });
    expect(move.status()).toBe(409);
    expect((await move.json()).error).toMatch(/Non ci sono abbastanza posti/);
    // Same time, fewer people: always fine. Same time, more people: fine while there's room.
    expect((await request.put(`${ADMIN_URL}/api/bookings/${id}`, { data: bookingBody({ date, time: '10:30', adults: 1 }) })).status()).toBe(200);
    expect((await request.put(`${ADMIN_URL}/api/bookings/${id}`, { data: bookingBody({ date, time: '10:30', adults: 6 }) })).status()).toBe(200);
    const day = await availability(request, date);
    expect(day.slots.find(s => s.time === '10:30')!.available).toBe(capacity - 6);
    expect(day.slots.find(s => s.time === '15:00')!.available).toBe(0);
  });

  test('staff add a booking taken by phone, without an email', { tag: ['@high'] }, async ({ page, request }) => {
    const date = await emptyDay(request);
    const name = `Telefono ${Date.now()}`;
    await page.goto(`${ADMIN_URL}/`);
    await page.getByRole('button', { name: '+ Nuova prenotazione' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Degustazione').selectOption('sfumature-limne');
    await expect(dialog.getByLabel('Ragazzi 13–17')).toBeDisabled();
    await dialog.getByLabel('Giorno').fill(date);
    await dialog.getByLabel('Orario').selectOption('15:00');
    await dialog.getByLabel('Adulti').fill('3');
    await dialog.getByLabel('Nome e cognome').fill(name);
    await dialog.getByRole('button', { name: 'Crea la prenotazione' }).click();
    await expect(dialog.getByRole('alert')).toContainText('almeno un contatto');
    await dialog.getByLabel('Telefono').fill('+39 045 1234567');
    await dialog.getByRole('button', { name: 'Crea la prenotazione' }).click();
    await expect(dialog.getByRole('alert')).toContainText('tra 4 e 8');
    await dialog.getByLabel('Adulti').fill('4');
    await dialog.getByRole('button', { name: 'Crea la prenotazione' }).click();
    await expect(dialog.getByRole('heading', { name })).toBeVisible();
    await expect(dialog).toContainText('inserita da staff@localhost');
    await dialog.getByRole('button', { name: 'Chiudi' }).click();
    await showDay(page, date);
    await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('Sfumature di Limne');
    expect((await availability(request, date)).slots.find(s => s.time === '15:00')!.available).toBe((await slotCapacity(request)) - 4);
  });

  test('a cancelled booking can\'t be changed', { tag: ['@medium'] }, async ({ request }) => {
    const date = await emptyDay(request);
    const { body } = await book(request, { date });
    await request.post(`${BASE_URL}/api/bookings/${body.token}/cancel`);
    const id = await bookingId(request, date, body.token!);
    expect((await request.put(`${ADMIN_URL}/api/bookings/${id}`, { data: bookingBody({ date }) })).status()).toBe(409);
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

  test('admin pages and the booking dialog have no automatically detectable accessibility problems', {
    tag: ['@medium', '@a11y'],
  }, async ({ page }) => {
    await page.goto(`${ADMIN_URL}/`);
    for (const tab of ['Prenotazioni', 'Chiusure', 'Impostazioni']) await expect(page.getByRole('tab', { name: tab })).toBeVisible();
    const scan = async () => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(v => `${v.id}: ${v.nodes.length}`);
    expect(await scan()).toEqual([]);
    await page.getByRole('button', { name: '+ Nuova prenotazione' }).click();
    expect(await scan()).toEqual([]);
  });
});
