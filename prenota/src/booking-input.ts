// Checks a booking sent by a guest (public Worker) or by staff (admin Worker) against the rules, and
// works out its price. Staff may leave out the email or the phone (bookings taken by phone), book beyond
// the online horizon, and keep a booking's own date and time when they change other details, even if
// that time has passed, the day was closed later, or the start times changed.
import { getClosures, getSettings, getTastings, type Booking, type NewBooking } from './db.ts';
import { addDays, closedReason, guests, isEmail, isInFuture, isValidDate, nowInItaly, partyProblem, priceCents } from './rules.ts';

export type BookingFields = Omit<NewBooking, 'token'>;
export type Checked = { ok: true; booking: BookingFields } | { ok: false; error: string };

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : 0);
const fail = (error: string): Checked => ({ ok: false, error });

export async function checkBooking(
  db: D1Database, body: Record<string, unknown>, opts: { staff?: boolean; existing?: Booking } = {},
): Promise<Checked> {
  const { staff = false, existing } = opts;
  const name = text(body.name, 120), email = text(body.email, 200), phone = text(body.phone, 40), notes = text(body.notes, 1000);
  if (!name) return fail('Inserisci nome e cognome.');
  const phoneOk = phone.replace(/\D/g, '').length >= 6;
  if (staff) {
    if (email && !isEmail(email)) return fail('Indirizzo email non valido.');
    if (phone && !phoneOk) return fail('Numero di telefono non valido.');
    if (!email && !phone) return fail('Inserisci almeno un contatto: email o telefono.');
  } else {
    if (!isEmail(email)) return fail('Inserisci un indirizzo email valido.');
    if (!phoneOk) return fail('Inserisci un numero di telefono valido.');
  }

  const date = body.date, time = body.time;
  const sameSlot = existing !== undefined && existing.date === date && existing.time === time;
  const settings = await getSettings(db);
  if (!isValidDate(date) || typeof time !== 'string' || !(settings.slotTimes.includes(time) || sameSlot)) {
    return fail('Data o orario non validi.');
  }
  if (!sameSlot) {
    if (!isInFuture(date, time)) return fail("L'orario scelto è già passato.");
    if (!staff && date > addDays(nowInItaly().date, settings.horizonDays)) {
      return fail(`Si può prenotare fino a ${settings.horizonDays} giorni in anticipo.`);
    }
    const closed = closedReason(date, await getClosures(db, date, date));
    if (closed) return fail(`Siamo chiusi in questa data (${closed}). Scegli un altro giorno.`);
  }

  const tasting = (await getTastings(db, !staff)).find(t => t.id === body.tasting);
  if (!tasting) return fail('Scegli una degustazione.');
  const party = { adults: int(body.adults), teens: int(body.teens), children: int(body.children) };
  const partyError = partyProblem(tasting, party);
  if (partyError) return fail(partyError);

  return {
    ok: true,
    booking: {
      date, time, tasting_id: tasting.id, ...party, guests: guests(party),
      name, email, phone, notes, price_cents: priceCents(tasting, party),
    },
  };
}

/** The secret in a guest's booking link. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
