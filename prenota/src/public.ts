// The public booking Worker: serves the booking pages (public/) and the guests' API. No staff functions
// here: those are in the separate admin Worker (src/admin.ts), behind Cloudflare Access.
import {
  availability, bookingByToken, cancelBooking, getClosures, getSettings, getTastings, insertBookingIfRoom,
} from './db.ts';
import {
  addDays, closedReason, guests, isEmail, isInFuture, isValidDate, nowInItaly, partyProblem, priceCents,
} from './rules.ts';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Cloudflare Turnstile keys. Without them the booking form has no bot check (local development). */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const problem = (message: string, status = 400) => json({ error: message }, status);

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function turnstileOk(env: Env, token: unknown, ip: string | null): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (typeof token !== 'string' || !token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  return res.ok && ((await res.json()) as { success: boolean }).success === true;
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : 0);

async function createBooking(request: Request, env: Env): Promise<Response> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return problem('Richiesta non valida.', 415);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return problem('Richiesta non valida.'); }

  if (!(await turnstileOk(env, body.turnstileToken, request.headers.get('cf-connecting-ip')))) {
    return problem('Verifica anti-spam non riuscita. Ricarica la pagina e riprova.', 403);
  }
  if (body.privacy !== true) return problem('Per prenotare serve il consenso al trattamento dei dati.');

  const date = body.date, time = body.time;
  const name = text(body.name, 120), email = text(body.email, 200), phone = text(body.phone, 40), notes = text(body.notes, 1000);
  if (!name) return problem('Inserisci nome e cognome.');
  if (!isEmail(email)) return problem("Inserisci un indirizzo email valido.");
  if (phone.replace(/\D/g, '').length < 6) return problem('Inserisci un numero di telefono valido.');

  const settings = await getSettings(env.DB);
  const today = nowInItaly().date;
  if (!isValidDate(date) || typeof time !== 'string' || !settings.slotTimes.includes(time)) return problem('Data o orario non validi.');
  if (!isInFuture(date, time)) return problem("L'orario scelto è già passato.");
  if (date > addDays(today, settings.horizonDays)) return problem(`Si può prenotare fino a ${settings.horizonDays} giorni in anticipo.`);
  const closed = closedReason(date, await getClosures(env.DB, date, date));
  if (closed) return problem(`Siamo chiusi in questa data (${closed}). Scegli un altro giorno.`);

  const tasting = (await getTastings(env.DB)).find(t => t.id === body.tasting);
  if (!tasting) return problem('Scegli una degustazione.');
  const party = { adults: int(body.adults), teens: int(body.teens), children: int(body.children) };
  const partyError = partyProblem(tasting, party);
  if (partyError) return problem(partyError);

  const booking = {
    token: newToken(), date, time, tasting_id: tasting.id, ...party, guests: guests(party),
    name, email, phone, notes, price_cents: priceCents(tasting, party),
  };
  if (!(await insertBookingIfRoom(env.DB, booking))) {
    return problem('Non ci sono più posti sufficienti per questo orario. Scegli un altro orario o un altro giorno.', 409);
  }
  return json({ token: booking.token }, 201);
}

/** What the guest sees about their own booking (no internal ids). */
function guestView(b: NonNullable<Awaited<ReturnType<typeof bookingByToken>>>) {
  return {
    date: b.date, time: b.time, tasting: b.tasting_name, adults: b.adults, teens: b.teens, children: b.children,
    name: b.name, email: b.email, phone: b.phone, notes: b.notes, price_cents: b.price_cents, status: b.status,
    cancellable: b.status === 'confirmed' && isInFuture(b.date, b.time),
  };
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/tastings' && method === 'GET') {
    const settings = await getSettings(env.DB);
    return json({
      tastings: await getTastings(env.DB),
      slotTimes: settings.slotTimes,
      horizonDays: settings.horizonDays,
      today: nowInItaly().date,
      turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
    });
  }

  if (path === '/api/availability' && method === 'GET') {
    const today = nowInItaly().date;
    const settings = await getSettings(env.DB);
    const from = url.searchParams.get('from') ?? today;
    const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 42) || 42, 1), 62);
    if (!isValidDate(from)) return problem('Data non valida.');
    const start = from < today ? today : from;
    const lastDay = addDays(today, settings.horizonDays);
    if (start > lastDay) return json({ days: [] });
    const n = Math.min(days, Math.round((Date.parse(lastDay) - Date.parse(start)) / 86_400_000) + 1);
    return json({ days: await availability(env.DB, start, n) });
  }

  if (path === '/api/bookings' && method === 'POST') return createBooking(request, env);

  const m = path.match(/^\/api\/bookings\/([0-9a-f]{32})(\/cancel)?$/);
  if (m) {
    const [, token, cancel] = m;
    const booking = await bookingByToken(env.DB, token);
    if (!booking) return problem('Prenotazione non trovata.', 404);
    if (!cancel && method === 'GET') return json(guestView(booking));
    if (cancel && method === 'POST') {
      if (!isInFuture(booking.date, booking.time)) return problem('La visita è già iniziata o passata: non si può più annullare.', 409);
      await cancelBooking(env.DB, { token }, 'guest');
      return json(guestView((await bookingByToken(env.DB, token))!));
    }
  }
  return problem('Non trovato.', 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url);
      } catch (err) {
        console.error(err);
        return problem('Errore del server. Riprova tra poco.', 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
