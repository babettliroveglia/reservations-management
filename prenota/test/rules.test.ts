// Unit tests for src/rules.ts: `npm run test:unit` (plain Node, no Cloudflare needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, closedReason, easter, guests, isEmail, isInFuture, isValidDate, nowInItaly, partyProblem, priceCents,
  type Tasting,
} from '../src/rules.ts';

const benvenuto: Tasting = {
  id: 'benvenuto', name: 'Percorso di Benvenuto', description: '', duration_min: 90,
  price_adult_cents: 2500, teen_discount_pct: 50, min_adults: 1, max_adults: 10,
};
const limne: Tasting = { ...benvenuto, id: 'sfumature-limne', name: 'Sfumature di Limne', price_adult_cents: 6000, teen_discount_pct: null, min_adults: 4, max_adults: 8 };
const none = new Map<string, string>();

test('Easter dates', () => {
  assert.equal(easter(2026), '2026-04-05');
  assert.equal(easter(2027), '2027-03-28');
  assert.equal(easter(2028), '2028-04-16');
});

test('closed on Sundays, public holidays and Easter Monday', () => {
  assert.equal(closedReason('2026-11-22', none), 'Domenica');
  assert.equal(closedReason('2026-12-25', none), 'Natale');
  assert.equal(closedReason('2027-03-29', none), "Lunedì dell'Angelo");
  assert.equal(closedReason('2026-12-08', none), 'Immacolata Concezione');
  assert.equal(closedReason('2026-11-23', none), null); // an ordinary Monday
  assert.equal(closedReason('2026-11-28', none), null); // Saturday is open
});

test('extra closure days set by staff', () => {
  const closures = new Map([['2027-10-16', 'Festival del Lugana'], ['2027-10-18', '']]);
  assert.equal(closedReason('2027-10-16', closures), 'Festival del Lugana');
  assert.equal(closedReason('2027-10-18', closures), 'Chiusura straordinaria');
});

test('party size rules follow the tasting', () => {
  assert.equal(partyProblem(benvenuto, { adults: 2, teens: 1, children: 1 }), null);
  assert.match(partyProblem(benvenuto, { adults: 0, teens: 2, children: 0 }) ?? '', /tra 1 e 10/);
  assert.match(partyProblem(benvenuto, { adults: 11, teens: 0, children: 0 }) ?? '', /non valido|tra 1 e 10/);
  assert.match(partyProblem(limne, { adults: 3, teens: 0, children: 0 }) ?? '', /tra 4 e 8/);
  assert.equal(partyProblem(limne, { adults: 8, teens: 0, children: 0 }), null);
  assert.match(partyProblem(limne, { adults: 4, teens: 1, children: 0 }) ?? '', /riservata agli adulti/);
  assert.match(partyProblem(limne, { adults: 4, teens: 0, children: 1 }) ?? '', /riservata agli adulti/);
  assert.ok(partyProblem(benvenuto, { adults: 2.5, teens: 0, children: 0 }));
  assert.ok(partyProblem(benvenuto, { adults: 2, teens: -1, children: 0 }));
});

test('price: adults full, 13–17 half, under 13 free', () => {
  assert.equal(priceCents(benvenuto, { adults: 2, teens: 1, children: 2 }), 2 * 2500 + 1250);
  assert.equal(priceCents(limne, { adults: 4, teens: 0, children: 0 }), 24000);
  assert.equal(guests({ adults: 2, teens: 1, children: 2 }), 5);
});

test('dates and times', () => {
  assert.ok(isValidDate('2026-02-28'));
  assert.ok(!isValidDate('2026-02-30'));
  assert.ok(!isValidDate('28/02/2026'));
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  // 23:30 UTC on 22 November is already 23 November, 00:30, in Italy
  assert.deepEqual(nowInItaly(new Date('2026-11-22T23:30:00Z')), { date: '2026-11-23', time: '00:30' });
  // Summer time: UTC+2
  assert.deepEqual(nowInItaly(new Date('2026-07-01T08:45:00Z')), { date: '2026-07-01', time: '10:45' });
  const now = { date: '2026-11-23', time: '12:00' };
  assert.ok(isInFuture('2026-11-23', '15:00', now));
  assert.ok(!isInFuture('2026-11-23', '10:30', now));
  assert.ok(!isInFuture('2026-11-22', '15:00', now));
});

test('email check', () => {
  assert.ok(isEmail('ospite@example.it'));
  assert.ok(!isEmail('ospite@example'));
  assert.ok(!isEmail('ospite example.it'));
});
