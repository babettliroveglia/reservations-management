// D1 queries shared by the public and admin Workers.
import { addDays, closedReason, isInFuture, nowInItaly, type Tasting } from './rules.ts';

export interface Settings { slotTimes: string[]; slotCapacity: number; horizonDays: number }

export interface Booking {
  id: number; token: string; date: string; time: string; tasting_id: string; tasting_name: string;
  adults: number; teens: number; children: number; guests: number;
  name: string; email: string; phone: string; notes: string; price_cents: number;
  status: 'confirmed' | 'cancelled'; cancelled_by: string | null; created_at: string; cancelled_at: string | null;
  created_by: string | null; updated_by: string | null; updated_at: string | null;
}

export async function getSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const s = new Map(results.map(r => [r.key, r.value]));
  return {
    slotTimes: (s.get('slot_times') ?? '10:30,15:00').split(',').map(t => t.trim()).filter(Boolean).sort(),
    slotCapacity: Number(s.get('slot_capacity') ?? 20),
    horizonDays: Number(s.get('horizon_days') ?? 180),
  };
}

export async function getTastings(db: D1Database, activeOnly = true): Promise<Tasting[]> {
  const { results } = await db
    .prepare(`SELECT id, name, description, duration_min, price_adult_cents, teen_discount_pct, min_adults, max_adults
              FROM tastings ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort`)
    .all<Tasting>();
  return results;
}

export async function getClosures(db: D1Database, from: string, to: string): Promise<Map<string, string>> {
  const { results } = await db
    .prepare('SELECT date, reason FROM closures WHERE date BETWEEN ?1 AND ?2 ORDER BY date')
    .bind(from, to)
    .all<{ date: string; reason: string }>();
  return new Map(results.map(r => [r.date, r.reason]));
}

/** Guests already booked per "date time" between two dates. */
async function bookedGuests(db: D1Database, from: string, to: string): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(`SELECT date, time, SUM(guests) AS n FROM bookings
              WHERE status = 'confirmed' AND date BETWEEN ?1 AND ?2 GROUP BY date, time`)
    .bind(from, to)
    .all<{ date: string; time: string; n: number }>();
  return new Map(results.map(r => [`${r.date} ${r.time}`, r.n]));
}

export interface DayAvailability {
  date: string;
  closed: string | null;
  slots: { time: string; available: number }[];
}

/** Places left at each start time for `days` days from `from` (Italian dates). Past times show 0. */
export async function availability(db: D1Database, from: string, days: number): Promise<DayAvailability[]> {
  const to = addDays(from, days - 1);
  const [settings, closures, booked] = await Promise.all([getSettings(db), getClosures(db, from, to), bookedGuests(db, from, to)]);
  const now = nowInItaly();
  const out: DayAvailability[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const closed = closedReason(date, closures);
    out.push({
      date,
      closed,
      slots: closed ? [] : settings.slotTimes.map(time => ({
        time,
        available: isInFuture(date, time, now) ? Math.max(0, settings.slotCapacity - (booked.get(`${date} ${time}`) ?? 0)) : 0,
      })),
    });
  }
  return out;
}

export interface NewBooking {
  token: string; date: string; time: string; tasting_id: string;
  adults: number; teens: number; children: number; guests: number;
  name: string; email: string; phone: string; notes: string; price_cents: number;
}

/**
 * Saves a booking only if the start time still has room. The capacity check and the insert are one
 * SQL statement, and D1 runs a database's statements one at a time, so two guests can't both take the
 * last places. Returns false if the time is full.
 */
export async function insertBookingIfRoom(db: D1Database, b: NewBooking, createdBy: string | null = null): Promise<boolean> {
  const res = await db
    .prepare(`INSERT INTO bookings (token, date, time, tasting_id, adults, teens, children, guests, name, email, phone, notes, price_cents, created_by)
              SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
              WHERE (SELECT COALESCE(SUM(guests), 0) FROM bookings WHERE date = ?2 AND time = ?3 AND status = 'confirmed') + ?8
                    <= (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'slot_capacity')`)
    .bind(b.token, b.date, b.time, b.tasting_id, b.adults, b.teens, b.children, b.guests,
          b.name, b.email, b.phone, b.notes, b.price_cents, createdBy)
    .run();
  return res.meta.changes === 1;
}

/**
 * Staff change a confirmed booking. Like insertBookingIfRoom, one statement checks the room and saves:
 * the booking's own places don't count against it, and keeping the same time with no more people always
 * fits (even if the capacity was lowered since). Returns false if the booking can't be changed that way.
 */
export async function updateBookingIfRoom(
  db: D1Database, id: number, b: Omit<NewBooking, 'token'>, by: string,
): Promise<boolean> {
  const res = await db
    .prepare(`UPDATE bookings SET date = ?2, time = ?3, tasting_id = ?4, adults = ?5, teens = ?6, children = ?7, guests = ?8,
                name = ?9, email = ?10, phone = ?11, notes = ?12, price_cents = ?13,
                updated_by = ?14, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
              WHERE id = ?1 AND status = 'confirmed' AND (
                (date = ?2 AND time = ?3 AND ?8 <= guests)
                OR (SELECT COALESCE(SUM(o.guests), 0) FROM bookings o
                    WHERE o.date = ?2 AND o.time = ?3 AND o.status = 'confirmed' AND o.id <> ?1) + ?8
                   <= (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'slot_capacity'))`)
    .bind(id, b.date, b.time, b.tasting_id, b.adults, b.teens, b.children, b.guests,
          b.name, b.email, b.phone, b.notes, b.price_cents, by)
    .run();
  return res.meta.changes === 1;
}

const BOOKING_COLUMNS = `b.id, b.token, b.date, b.time, b.tasting_id, t.name AS tasting_name, b.adults, b.teens, b.children,
  b.guests, b.name, b.email, b.phone, b.notes, b.price_cents, b.status, b.cancelled_by, b.created_at, b.cancelled_at,
  b.created_by, b.updated_by, b.updated_at`;

export async function bookingByToken(db: D1Database, token: string): Promise<Booking | null> {
  return db.prepare(`SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN tastings t ON t.id = b.tasting_id WHERE b.token = ?1`)
    .bind(token).first<Booking>();
}

export async function bookingById(db: D1Database, id: number): Promise<Booking | null> {
  return db.prepare(`SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN tastings t ON t.id = b.tasting_id WHERE b.id = ?1`)
    .bind(id).first<Booking>();
}

export async function bookingsBetween(db: D1Database, from: string, to: string): Promise<Booking[]> {
  const { results } = await db
    .prepare(`SELECT ${BOOKING_COLUMNS} FROM bookings b JOIN tastings t ON t.id = b.tasting_id
              WHERE b.date BETWEEN ?1 AND ?2 ORDER BY b.date, b.time, b.created_at`)
    .bind(from, to)
    .all<Booking>();
  return results;
}

/** Cancels a confirmed booking; returns false if there was nothing to cancel. */
export async function cancelBooking(db: D1Database, where: { token: string } | { id: number }, by: string): Promise<boolean> {
  const [col, val] = 'token' in where ? ['token', where.token] : ['id', where.id];
  const res = await db
    .prepare(`UPDATE bookings SET status = 'cancelled', cancelled_by = ?2, cancelled_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
              WHERE ${col} = ?1 AND status = 'confirmed'`)
    .bind(val, by)
    .run();
  return res.meta.changes === 1;
}
