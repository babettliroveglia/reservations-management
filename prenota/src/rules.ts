// Booking rules shared by the public and admin Workers. Pure functions: no Cloudflare APIs, so they
// can be tested with plain Node (test/rules.test.ts).
//
// The rules match the booking form on tenutaroveglia.com/visite/: tastings at 10:30 and 15:00, closed
// on Sundays, Italian public holidays (including Easter Monday) and extra closure days set by staff.

export const TIME_ZONE = 'Europe/Rome';

/** Today's date and the current time in Italy, as "YYYY-MM-DD" and "HH:MM". */
export function nowInItaly(now: Date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Easter Sunday (Gregorian calendar), "YYYY-MM-DD". */
export function easter(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The days the winery is closed for holidays in a year, with their Italian names. */
export function holidays(year: number): Map<string, string> {
  const e = easter(year);
  return new Map([
    [`${year}-01-01`, 'Capodanno'],
    [`${year}-01-06`, 'Epifania'],
    [e, 'Pasqua'],
    [addDays(e, 1), "Lunedì dell'Angelo"],
    [`${year}-04-25`, 'Festa della Liberazione'],
    [`${year}-05-01`, 'Festa del Lavoro'],
    [`${year}-06-02`, 'Festa della Repubblica'],
    [`${year}-08-15`, 'Ferragosto'],
    [`${year}-11-01`, 'Ognissanti'],
    [`${year}-12-08`, 'Immacolata Concezione'],
    [`${year}-12-25`, 'Natale'],
    [`${year}-12-26`, 'Santo Stefano'],
    [`${year}-12-31`, 'San Silvestro'],
  ]);
}

/** Why the winery is closed on a date, or null if it's open. `closures` are the extra days set by staff. */
export function closedReason(date: string, closures: Map<string, string>): string | null {
  if (weekday(date) === 0) return 'Domenica';
  const holiday = holidays(Number(date.slice(0, 4))).get(date);
  if (holiday) return holiday;
  if (closures.has(date)) return closures.get(date) || 'Chiusura straordinaria';
  return null;
}

export interface Tasting {
  id: string;
  name: string;
  description: string;
  duration_min: number;
  price_adult_cents: number;
  /** Discount for 13–17 year olds, in percent; null if they can't join. */
  teen_discount_pct: number | null;
  min_adults: number;
  max_adults: number;
}

export interface Party { adults: number; teens: number; children: number }

export const MAX_TEENS = 10;
export const MAX_CHILDREN = 10;

/** Checks the party against the tasting's rules; returns an Italian message, or null if it's fine. */
export function partyProblem(t: Tasting, p: Party): string | null {
  for (const [n, max] of [[p.adults, t.max_adults], [p.teens, MAX_TEENS], [p.children, MAX_CHILDREN]] as const) {
    if (!Number.isInteger(n) || n < 0 || n > max) return 'Numero di persone non valido.';
  }
  if (p.adults < t.min_adults || p.adults > t.max_adults) {
    return `Per ${t.name} il numero di adulti deve essere tra ${t.min_adults} e ${t.max_adults}.`;
  }
  if ((p.teens > 0 || p.children > 0) && t.teen_discount_pct === null) return `${t.name} è riservata agli adulti.`;
  return null;
}

/** Total price in cents: adults pay full price, 13–17 year olds get the discount, under-13s are free. */
export function priceCents(t: Tasting, p: Party): number {
  const teen = t.teen_discount_pct === null ? 0 : Math.round(t.price_adult_cents * (100 - t.teen_discount_pct) / 100);
  return p.adults * t.price_adult_cents + p.teens * teen;
}

export function guests(p: Party): number {
  return p.adults + p.teens + p.children;
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 200;

/** A booking's date and time can still be booked (or cancelled) if the visit hasn't started yet. */
export function isInFuture(date: string, time: string, now = nowInItaly()): boolean {
  return date > now.date || (date === now.date && time > now.time);
}
