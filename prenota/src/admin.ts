// The staff admin Worker: booking list, cancellations, extra closure days and capacity. It shares the D1
// database with the public Worker. Every request, pages included, needs a valid Cloudflare Access login
// (src/access.ts). Without Access configured it refuses everything, except on localhost when
// DEV_ADMIN_EMAIL is set (local development only).
import { accessEmail } from './access.ts';
import { checkBooking, newToken } from './booking-input.ts';
import {
  bookingById, bookingsBetween, cancelBooking, getClosures, getSettings, getTastings, insertBookingIfRoom, updateBookingIfRoom,
} from './db.ts';
import { addDays, isValidDate, nowInItaly } from './rules.ts';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** e.g. "roveglia.cloudflareaccess.com" */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's "AUD" tag. */
  ACCESS_AUD?: string;
  DEV_ADMIN_EMAIL?: string;
  /** The public booking site, e.g. "https://prenota-test.<subdomain>.workers.dev", to show guests' links. */
  PUBLIC_URL?: string;
}

const FULL = 'Non ci sono abbastanza posti a quell\'orario per questo gruppo.';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const problem = (message: string, status = 400) => json({ error: message }, status);

async function staffEmail(request: Request, env: Env, url: URL): Promise<string | null> {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    return accessEmail(request.headers.get('cf-access-jwt-assertion'), env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return local && env.DEV_ADMIN_EMAIL ? env.DEV_ADMIN_EMAIL : null;
}

async function api(request: Request, env: Env, url: URL, staff: string): Promise<Response> {
  const path = url.pathname;
  const method = request.method;
  if (method !== 'GET' && !request.headers.get('content-type')?.startsWith('application/json')) {
    return problem('Richiesta non valida.', 415);
  }

  if (path === '/api/me' && method === 'GET') {
    const settings = await getSettings(env.DB);
    return json({
      email: staff, today: nowInItaly().date, publicUrl: env.PUBLIC_URL?.replace(/\/$/, '') ?? null,
      tastings: await getTastings(env.DB, false), slotTimes: settings.slotTimes,
    });
  }

  if (path === '/api/bookings' && method === 'POST') {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return problem('Richiesta non valida.');
    const checked = await checkBooking(env.DB, body, { staff: true });
    if (!checked.ok) return problem(checked.error);
    const booking = { token: newToken(), ...checked.booking };
    if (!(await insertBookingIfRoom(env.DB, booking, staff))) return problem(FULL, 409);
    const { results } = await env.DB.prepare('SELECT id FROM bookings WHERE token = ?1').bind(booking.token).all<{ id: number }>();
    return json(await bookingById(env.DB, results[0].id), 201);
  }

  const one = path.match(/^\/api\/bookings\/(\d+)$/);
  if (one) {
    const existing = await bookingById(env.DB, Number(one[1]));
    if (!existing) return problem('Prenotazione non trovata.', 404);
    if (method === 'GET') return json(existing);
    if (method === 'PUT') {
      if (existing.status !== 'confirmed') return problem('Una prenotazione annullata non si può modificare.', 409);
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) return problem('Richiesta non valida.');
      const checked = await checkBooking(env.DB, body, { staff: true, existing });
      if (!checked.ok) return problem(checked.error);
      if (!(await updateBookingIfRoom(env.DB, existing.id, checked.booking, staff))) return problem(FULL, 409);
      return json(await bookingById(env.DB, existing.id));
    }
  }

  if (path === '/api/bookings' && method === 'GET') {
    const from = url.searchParams.get('from') ?? nowInItaly().date;
    const to = url.searchParams.get('to') ?? addDays(from, 30);
    if (!isValidDate(from) || !isValidDate(to) || to < from) return problem('Intervallo di date non valido.');
    return json({ bookings: await bookingsBetween(env.DB, from, to) });
  }

  const cancel = path.match(/^\/api\/bookings\/(\d+)\/cancel$/);
  if (cancel && method === 'POST') {
    const ok = await cancelBooking(env.DB, { id: Number(cancel[1]) }, staff);
    return ok ? json({ ok: true }) : problem('Prenotazione non trovata o già annullata.', 404);
  }

  if (path === '/api/closures' && method === 'GET') {
    const from = url.searchParams.get('from') ?? nowInItaly().date;
    const closures = await getClosures(env.DB, from, addDays(from, 730));
    return json({ closures: [...closures].map(([date, reason]) => ({ date, reason })) });
  }

  const closure = path.match(/^\/api\/closures\/(\d{4}-\d{2}-\d{2})$/);
  if (closure && isValidDate(closure[1])) {
    if (method === 'PUT') {
      const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 120) : '';
      await env.DB.prepare('INSERT INTO closures (date, reason) VALUES (?1, ?2) ON CONFLICT(date) DO UPDATE SET reason = ?2')
        .bind(closure[1], reason).run();
      const { results } = await env.DB
        .prepare(`SELECT COUNT(*) AS n FROM bookings WHERE date = ?1 AND status = 'confirmed'`).bind(closure[1]).all<{ n: number }>();
      return json({ ok: true, bookingsOnThatDay: results[0]?.n ?? 0 });
    }
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM closures WHERE date = ?1').bind(closure[1]).run();
      return json({ ok: true });
    }
  }

  if (path === '/api/settings' && method === 'GET') return json(await getSettings(env.DB));

  if (path === '/api/settings' && method === 'PUT') {
    const body = (await request.json().catch(() => ({}))) as { slotTimes?: unknown; slotCapacity?: unknown; horizonDays?: unknown };
    const times = Array.isArray(body.slotTimes) ? body.slotTimes.map(String).map(t => t.trim()) : [];
    const capacity = Number(body.slotCapacity), horizon = Number(body.horizonDays);
    if (!times.length || times.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return problem('Orari non validi (es. 10:30).');
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) return problem('Capienza non valida.');
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > 730) return problem('Giorni di anticipo non validi.');
    const set = env.DB.prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2');
    await env.DB.batch([
      set.bind('slot_times', [...new Set(times)].sort().join(',')),
      set.bind('slot_capacity', String(capacity)),
      set.bind('horizon_days', String(horizon)),
    ]);
    return json(await getSettings(env.DB));
  }

  return problem('Non trovato.', 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const staff = await staffEmail(request, env, url);
    if (!staff) {
      return new Response('Accesso riservato al personale di Tenuta Roveglia.', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, env, url, staff);
      } catch (err) {
        console.error(err);
        return problem('Errore del server.', 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
