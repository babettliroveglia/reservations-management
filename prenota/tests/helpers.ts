// Shared helpers for the booking system tests.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { addDays, easter, nowInItaly } from '../src/rules.ts';

/** The public booking Worker. Locally: docker compose up -d dev. */
export const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8787';
/** The admin Worker, signed in as staff@localhost: only on a local copy (no Cloudflare Access). */
export const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:8788';
/** An admin Worker set up as deployed (Access required), which must refuse everything. */
export const LOCKED_ADMIN_URL = process.env.LOCKED_ADMIN_URL ?? 'http://localhost:8789';
export const IS_LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE_URL);

export const today = () => nowInItaly().date;
export { addDays };

export interface BookingInput {
  tasting?: string; date: string; time?: string; adults?: number; teens?: number; children?: number;
  name?: string; email?: string; phone?: string; notes?: string; privacy?: boolean;
}

export function bookingBody(b: BookingInput) {
  return {
    tasting: 'benvenuto', time: '10:30', adults: 2, teens: 0, children: 0,
    name: 'Ospite di Prova', email: 'ospite.prova@example.it', phone: '+39 030 1234567', notes: '', privacy: true,
    ...b,
  };
}

export async function book(request: APIRequestContext, b: BookingInput) {
  const res = await request.post(`${BASE_URL}/api/bookings`, { data: bookingBody(b) });
  return { status: res.status(), body: (await res.json()) as { token?: string; error?: string } };
}

export async function availability(request: APIRequestContext, date: string) {
  const res = await request.get(`${BASE_URL}/api/availability?from=${date}&days=1`);
  expect(res.ok()).toBeTruthy();
  const { days } = (await res.json()) as { days: { date: string; closed: string | null; slots: { time: string; available: number }[] }[] };
  return days[0];
}

export async function slotCapacity(request: APIRequestContext): Promise<number> {
  const res = await request.get(`${ADMIN_URL}/api/settings`);
  expect(res.ok(), 'admin settings (local copy only)').toBeTruthy();
  return ((await res.json()) as { slotCapacity: number }).slotCapacity;
}

/**
 * An open day, at least `minDaysAhead` days from today, with nobody booked yet, so a test can rely on
 * its numbers. Earlier test runs leave bookings behind, so this looks for the first untouched day.
 */
export async function emptyDay(request: APIRequestContext, minDaysAhead = 3): Promise<string> {
  const capacity = await slotCapacity(request);
  let from = addDays(today(), minDaysAhead);
  for (let page = 0; page < 6; page++) {
    const res = await request.get(`${BASE_URL}/api/availability?from=${from}&days=31`);
    const { days } = (await res.json()) as { days: { date: string; closed: string | null; slots: { available: number }[] }[] };
    const day = days.find(d => !d.closed && d.slots.length && d.slots.every(s => s.available === capacity));
    if (day) return day.date;
    from = addDays(from, 31);
  }
  throw new Error('No empty day found in the next six months');
}

/** The next date (from tomorrow) on the given weekday, 0 = Sunday. */
export function nextWeekday(dow: number): string {
  let d = addDays(today(), 1);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== dow) d = addDays(d, 1);
  return d;
}

/** The next Easter Monday from today. */
export function nextEasterMonday(): string {
  const year = Number(today().slice(0, 4));
  for (const y of [year, year + 1]) {
    const monday = addDays(easter(y), 1);
    if (monday > today()) return monday;
  }
  throw new Error('unreachable');
}

/** On the booking page: opens the calendar month of `date` and picks that day. */
export async function pickDay(page: Page, date: string) {
  const months = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const label = `${months[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
  for (let i = 0; i < 8 && (await page.locator('#month-label').textContent()) !== label; i++) {
    await page.locator('#next-month').click();
  }
  await expect(page.locator('#month-label')).toHaveText(label);
  const day = page.locator('#calendar .day:not(.blank)').nth(Number(date.slice(8, 10)) - 1);
  await expect(day).toBeEnabled();
  await day.click();
}
