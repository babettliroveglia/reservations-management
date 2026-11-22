// The booking pages, in a browser (desktop and mobile). Use cases from OpenResto's tests (booking-flow,
// booking-confirmation, customer-cancel, booking-form-validation, overbooking-conflict), for tastings.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { IS_LOCAL, availability, book, emptyDay, pickDay, slotCapacity } from '../helpers';

test.describe('Booking a tasting', { annotation: { type: 'area', description: 'Booking pages' } }, () => {
  test.skip(!IS_LOCAL, 'Creates bookings: run against a local copy');

  test('a guest books a tasting and gets a confirmation with their link', {
    tag: ['@critical', '@smoke'],
  }, async ({ page, request }) => {
    const date = await emptyDay(request);
    await page.goto('/');
    await page.getByRole('button', { name: /Percorso di Conoscenza/ }).click();
    await page.locator('#adults').selectOption('2');
    await page.locator('#teens').selectOption('1');
    await expect(page.locator('#total')).toContainText('95'); // 2 × 38 + 19
    await pickDay(page, date);
    await page.getByRole('button', { name: /15:00/ }).click();
    await page.locator('#name').fill('Maria Rossi');
    await page.locator('#email').fill('maria.rossi@example.it');
    await page.locator('#phone').fill('+39 333 1234567');
    await page.locator('#notes').fill('Allergia alle noci');
    await page.locator('#privacy').check();
    await page.getByRole('button', { name: 'Conferma la prenotazione' }).click();

    await expect(page).toHaveURL(/\/prenotazione\?t=[0-9a-f]{32}$/);
    await expect(page.getByRole('heading', { name: 'Prenotazione confermata' })).toBeVisible();
    const summary = page.locator('.summary');
    await expect(summary).toContainText('Percorso di Conoscenza');
    await expect(summary).toContainText('15:00');
    await expect(summary).toContainText('2 adulti, 1 ragazzo (13–17)');
    await expect(summary).toContainText('Allergia alle noci');
    await expect(page.getByRole('textbox', { name: 'Link della prenotazione' })).toHaveValue(page.url());

    // The link still works later, without the "just booked" message.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'La tua prenotazione' })).toBeVisible();
    expect((await availability(request, date)).slots.find(s => s.time === '15:00')!.available).toBe((await slotCapacity(request)) - 3);
  });

  test('a guest cancels from their link and the page shows it cancelled', { tag: ['@high'] }, async ({ page, request }) => {
    const date = await emptyDay(request);
    const { body } = await book(request, { date, adults: 3 });
    await page.goto(`/prenotazione?t=${body.token}`);
    await page.getByRole('button', { name: 'Annulla la prenotazione' }).click();
    await page.getByRole('button', { name: 'Sì, annulla' }).click();
    await expect(page.getByRole('heading', { name: 'Prenotazione annullata' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Annulla la prenotazione/ })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Prenotazione annullata' })).toBeVisible();
    expect((await availability(request, date)).slots[0].available).toBe(await slotCapacity(request));
  });

  test('a full time shows as full and can\'t be chosen', { tag: ['@high'] }, async ({ page, request }) => {
    const date = await emptyDay(request);
    let left = await slotCapacity(request);
    while (left > 0) { const n = Math.min(10, left); await book(request, { date, time: '10:30', adults: n }); left -= n; }
    await page.goto('/');
    await page.getByRole('button', { name: /Percorso di Benvenuto/ }).click();
    await pickDay(page, date);
    await expect(page.getByRole('button', { name: /10:30/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: /10:30/ })).toContainText('completo');
    await expect(page.getByRole('button', { name: /15:00/ })).toBeEnabled();
  });

  test('if the last places go while the guest fills in the form, they are told and nothing is booked', {
    tag: ['@high'],
  }, async ({ page, request }) => {
    const date = await emptyDay(request);
    const capacity = await slotCapacity(request);
    await page.goto('/');
    await page.getByRole('button', { name: /Percorso di Benvenuto/ }).click();
    await page.locator('#adults').selectOption('4');
    await pickDay(page, date);
    await page.getByRole('button', { name: /10:30/ }).click();
    // Meanwhile someone else books almost everything.
    let left = capacity - 2;
    while (left > 0) { const n = Math.min(10, left); await book(request, { date, time: '10:30', adults: n }); left -= n; }
    await page.locator('#name').fill('Luca Bianchi');
    await page.locator('#email').fill('luca@example.it');
    await page.locator('#phone').fill('+39 333 7654321');
    await page.locator('#privacy').check();
    await page.getByRole('button', { name: 'Conferma la prenotazione' }).click();
    await expect(page.getByRole('alert')).toContainText('Non ci sono più posti');
    await expect(page).toHaveURL(/\/$/);
    expect((await availability(request, date)).slots[0].available).toBe(2);
  });
});

test.describe('Booking page', { annotation: { type: 'area', description: 'Booking pages' } }, () => {
  test('lists the four tastings with prices', { tag: ['@critical', '@smoke'] }, async ({ page }) => {
    await page.goto('/');
    for (const [name, price] of [['Percorso di Benvenuto', '25'], ['Percorso di Conoscenza', '38'], ['Sfumature di Limne', '60'], ['Sfumature di Catullo', '80']]) {
      await expect(page.getByRole('button', { name: new RegExp(name) })).toContainText(`${price} €`);
    }
  });

  test('Sfumature tastings take 4 to 8 adults and no young people', { tag: ['@high'] }, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Sfumature di Catullo/ }).click();
    await expect(page.locator('#adults option')).toHaveText(['4', '5', '6', '7', '8']);
    await expect(page.locator('#teens-field')).toBeHidden();
    await expect(page.locator('#children-field')).toBeHidden();
    await page.getByRole('button', { name: /Percorso di Benvenuto/ }).click();
    await expect(page.locator('#adults option')).toHaveCount(10);
    await expect(page.locator('#teens-field')).toBeVisible();
  });

  test('Sundays can\'t be picked in the calendar', { tag: ['@medium'] }, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Percorso di Benvenuto/ }).click();
    const sundays = page.locator('#calendar .day[aria-label*="domenica"]');
    expect(await sundays.count()).toBeGreaterThanOrEqual(4);
    for (const day of await sundays.all()) await expect(day).toBeDisabled();
  });

  test('details are required before booking', { tag: ['@high'] }, async ({ page, request }) => {
    test.skip(!IS_LOCAL, 'Needs the local admin to find an empty day');
    await page.goto('/');
    await page.getByRole('button', { name: /Percorso di Benvenuto/ }).click();
    await pickDay(page, await emptyDay(request));
    await page.getByRole('button', { name: /10:30/ }).click();
    await page.getByRole('button', { name: 'Conferma la prenotazione' }).click();
    await expect(page.getByRole('alert')).toContainText('Compila nome, email e telefono');
    await page.locator('#name').fill('Anna Verdi');
    await page.locator('#email').fill('anna@example.it');
    await page.locator('#phone').fill('+39 333 0000000');
    await page.getByRole('button', { name: 'Conferma la prenotazione' }).click();
    await expect(page.getByRole('alert')).toContainText('consenso');
  });

  test('an unknown booking link says so', { tag: ['@high'] }, async ({ page }) => {
    await page.goto(`/prenotazione?t=${'0'.repeat(32)}`);
    await expect(page.getByRole('heading', { name: 'Prenotazione non trovata' })).toBeVisible();
    await page.goto('/prenotazione?t=abc');
    await expect(page.getByRole('heading', { name: 'Prenotazione non trovata' })).toBeVisible();
  });

  test('booking page has no automatically detectable accessibility problems', { tag: ['@medium', '@a11y'] }, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Percorso di Benvenuto/ }).click();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.map(v => `${v.id}: ${v.nodes.length} element(s)`)).toEqual([]);
  });
});
