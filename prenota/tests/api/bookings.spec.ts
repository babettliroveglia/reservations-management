// The booking API's rules, checked directly. Use cases from OpenResto's tests (overbooking-conflict,
// booking-form-validation, lookup, customer-cancel, cancel-past-booking), adapted to tastings.
import { expect, test } from '@playwright/test';
import {
  BASE_URL, IS_LOCAL, addDays, availability, book, bookingBody, emptyDay, nextEasterMonday, nextWeekday, slotCapacity, today,
} from '../helpers';

test.describe('Overbooking is prevented', { annotation: { type: 'area', description: 'Bookings' } }, () => {
  test.skip(!IS_LOCAL, 'Needs the local admin to read the capacity');

  test('simultaneous bookings never exceed a time slot\'s capacity', {
    tag: ['@critical'],
    annotation: { type: 'fix', description: 'The capacity check and the insert must stay one SQL statement (insertBookingIfRoom in src/db.ts).' },
  }, async ({ request }) => {
    const date = await emptyDay(request);
    const capacity = await slotCapacity(request);
    const party = 4;
    const attempts = Math.floor(capacity / party) + 3;
    const results = await Promise.all(
      Array.from({ length: attempts }, (_, i) => book(request, { date, adults: party, name: `Gruppo ${i + 1}` })),
    );
    const accepted = results.filter(r => r.status === 201).length;
    const refused = results.filter(r => r.status === 409);
    expect(accepted, 'bookings accepted').toBe(Math.floor(capacity / party));
    expect(refused.length, 'bookings refused as full').toBe(attempts - accepted);
    expect(refused[0].body.error).toMatch(/Non ci sono più posti/);
    const slot = (await availability(request, date)).slots.find(s => s.time === '10:30')!;
    expect(slot.available).toBe(capacity - accepted * party);
  });

  test('a party bigger than the places left is refused, a smaller one fits', { tag: ['@critical'] }, async ({ request }) => {
    const date = await emptyDay(request);
    const capacity = await slotCapacity(request);
    // Fill all but 3 places with groups of up to 10 adults.
    let left = capacity;
    while (left - 3 > 0) {
      const n = Math.min(10, left - 3);
      expect((await book(request, { date, time: '15:00', adults: n })).status).toBe(201);
      left -= n;
    }
    expect((await book(request, { date, time: '15:00', adults: 4 })).status).toBe(409);
    expect((await book(request, { date, time: '15:00', adults: 2, children: 1 })).status).toBe(201);
    expect((await availability(request, date)).slots.find(s => s.time === '15:00')!.available).toBe(0);
    // The other time that day is untouched.
    expect((await availability(request, date)).slots.find(s => s.time === '10:30')!.available).toBe(capacity);
  });
});

test.describe('Booking rules', { annotation: { type: 'area', description: 'Bookings' } }, () => {
  let openDay = '';
  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/availability?from=${addDays(today(), 1)}&days=14`);
    openDay = ((await res.json()).days as { date: string; closed: string | null }[]).find(d => !d.closed)!.date;
  });
  const tomorrowOpen = () => openDay;

  test('closed on Sundays', { tag: ['@high'] }, async ({ request }) => {
    const sunday = nextWeekday(0);
    const r = await book(request, { date: sunday });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Siamo chiusi.*Domenica/);
    expect((await availability(request, sunday)).closed).toBe('Domenica');
  });

  test('closed on Easter Monday (Pasquetta)', { tag: ['@high'] }, async ({ request }) => {
    const pasquetta = nextEasterMonday();
    const day = await availability(request, pasquetta);
    test.skip(!day, `Easter Monday ${pasquetta} is beyond the booking horizon`);
    expect(day.closed).toBe("Lunedì dell'Angelo");
    expect((await book(request, { date: pasquetta })).body.error).toMatch(/Siamo chiusi/);
  });

  test('past dates and unknown times are refused', { tag: ['@high'] }, async ({ request }) => {
    expect((await book(request, { date: addDays(today(), -1) })).status).toBe(400);
    expect((await book(request, { date: tomorrowOpen(), time: '12:00' })).body.error).toMatch(/orario non validi/i);
    expect((await book(request, { date: '2026-02-30' })).body.error).toMatch(/non validi/);
  });

  test('party sizes follow each tasting', { tag: ['@high'] }, async ({ request }) => {
    const date = tomorrowOpen();
    expect((await book(request, { date, tasting: 'sfumature-limne', adults: 3 })).body.error).toMatch(/tra 4 e 8/);
    expect((await book(request, { date, tasting: 'sfumature-catullo', adults: 9 })).body.error).toMatch(/tra 4 e 8|non valido/);
    expect((await book(request, { date, tasting: 'sfumature-limne', adults: 4, teens: 1 })).body.error).toMatch(/riservata agli adulti/);
    expect((await book(request, { date, tasting: 'benvenuto', adults: 0, teens: 2 })).body.error).toMatch(/tra 1 e 10/);
    expect((await book(request, { date, tasting: 'non-esiste' })).body.error).toMatch(/Scegli una degustazione/);
  });

  test('name, email, phone and privacy consent are required', { tag: ['@high'] }, async ({ request }) => {
    const date = tomorrowOpen();
    expect((await book(request, { date, name: '  ' })).body.error).toMatch(/nome/i);
    expect((await book(request, { date, email: 'non-una-email' })).body.error).toMatch(/email/i);
    expect((await book(request, { date, phone: '12' })).body.error).toMatch(/telefono/i);
    expect((await book(request, { date, privacy: false })).body.error).toMatch(/consenso/);
  });

  test('only JSON requests are accepted (no cross-site form posts)', { tag: ['@high'] }, async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/bookings`, { form: { ...bookingBody({ date: tomorrowOpen() }), privacy: 'true' } as any });
    expect(res.status()).toBe(415);
  });

  test('the price is worked out by the server: adults full, 13–17 half, under 13 free', { tag: ['@high'] }, async ({ request }) => {
    test.skip(!IS_LOCAL, 'Creates a booking');
    const date = await emptyDay(request);
    const r = await book(request, { date, adults: 2, teens: 1, children: 2 });
    expect(r.status).toBe(201);
    const view = await (await request.get(`${BASE_URL}/api/bookings/${r.body.token}`)).json();
    expect(view.price_cents).toBe(2 * 2500 + 1250);
    expect((await availability(request, date)).slots.find(s => s.time === '10:30')!.available).toBe((await slotCapacity(request)) - 5);
  });
});

test.describe('Guest booking link', { annotation: { type: 'area', description: 'Bookings' } }, () => {
  test('an unknown or malformed link finds nothing', { tag: ['@high'] }, async ({ request }) => {
    expect((await request.get(`${BASE_URL}/api/bookings/${'0'.repeat(32)}`)).status()).toBe(404);
    expect((await request.get(`${BASE_URL}/api/bookings/not-a-token`)).status()).toBe(404);
    expect((await request.post(`${BASE_URL}/api/bookings/${'0'.repeat(32)}/cancel`)).status()).toBe(404);
  });

  test('cancelling frees the places, and a cancelled booking stays cancelled', { tag: ['@high'] }, async ({ request }) => {
    test.skip(!IS_LOCAL, 'Creates a booking');
    const date = await emptyDay(request);
    const capacity = await slotCapacity(request);
    const { body } = await book(request, { date, adults: 6 });
    expect((await availability(request, date)).slots[0].available).toBe(capacity - 6);
    const cancelled = await (await request.post(`${BASE_URL}/api/bookings/${body.token}/cancel`)).json();
    expect(cancelled).toMatchObject({ status: 'cancelled', cancellable: false });
    expect((await availability(request, date)).slots[0].available).toBe(capacity);
    const again = await (await request.post(`${BASE_URL}/api/bookings/${body.token}/cancel`)).json();
    expect(again.status).toBe('cancelled');
  });
});
