# Prenota: tasting bookings on Cloudflare

A booking system for Tenuta Roveglia's tastings, built only from Cloudflare's own products:
Workers for the pages and the API, D1 for the database, and Cloudflare Access for the staff login.
It replaces the booking form on `/visite/`, which only sends an email, with real availability.
**This is a trial:** it's deployed as `prenota-test` with test data, and guests get no emails yet.

## How it's put together

```
Public Worker  prenota-test        booking pages (public/) + guests' API (src/public.ts)
Admin Worker   prenota-admin-test  staff pages (admin-public/) + staff API (src/admin.ts), behind Cloudflare Access
                     │  both bound to the same database
D1 database    prenota-test        tastings, settings, closures, bookings (migrations/)
```

| Part | Where |
|---|---|
| Booking rules: opening days, holidays, party sizes, prices | `src/rules.ts` (tested by `test/rules.test.ts`) |
| Database queries | `src/db.ts` |
| Checking a booking sent by a guest or by staff | `src/booking-input.ts` |
| Database tables, and the four tastings | `migrations/` |
| Staff login check | `src/access.ts` |

**The rules**, as on the website's `/visite/` form:
- Tastings start at 10:30 and 15:00, Monday to Saturday.
- It's closed on Sundays, on public holidays including Easter Monday, and on extra days staff close in the admin.
- Each tasting has its own party size: 1–10 adults, or 4–8 adults for the Sfumature tastings.
- 13–17 year olds pay half price and under-13s are free. The Sfumature tastings are adults only, because the website gives no young people's price for them (**to confirm**).
- Payment is at the winery.
- Capacity is shared by all tastings at the same start time, counting everyone, children included. It's set to **20 people per start time as a placeholder**; change it in the admin.

**No double bookings.** A booking is saved by one SQL statement that inserts it only if the time still has
room. D1 runs a database's statements one at a time, so two guests can't both take the last places. The
test `simultaneous bookings never exceed a time slot's capacity` checks this.

**Guests' link.** After booking, the guest lands on `/prenotazione?t=…`, a private link to see or cancel
their booking. With no emails yet, the page asks them to keep the link. Cancelling is possible until the
visit starts.

**Staff admin.** Staff can:
- see bookings by day and time, search them, and open one to see all its details, including the guest's link,
- change a booking (tasting, day, time, party, contact details, notes): the same rules apply, the price is
  worked out again, and the change is saved only if the new time has room (one SQL statement, as for new bookings),
- add bookings taken by phone or in person, with just an email or just a phone number,
- cancel bookings,
- close extra days, with a warning if the day already has bookings,
- change the start times, the capacity and how far ahead guests can book.

It's a separate Worker so that Cloudflare Access can protect all of it, on its `workers.dev` address,
while the booking pages stay public. The admin Worker also checks Access's signed token itself.
Without Access set up, it refuses every request.

## Running it locally

Everything runs in Docker (nothing to install). With rootless Docker, prefix with `HOST_UID=0 HOST_GID=0`.

```sh
docker compose up -d dev          # booking pages http://localhost:8787, admin http://localhost:8788
docker compose run --rm tests     # the browser and API tests (below)
docker compose down
```

- **Local database:** kept in `.state/`. Delete that folder to start again empty.
- **Local admin:** signs you in as `staff@localhost` without Access, and only on `localhost`.
- **Third Worker on port 8789:** an admin set up as deployed, which the tests check refuses everything.

Typecheck and unit tests:

```sh
docker run --rm -v "$PWD":/app -w /app -e HOME=/tmp node:22-bookworm sh -c 'npm ci && npm run check && npm run test:unit'
```

## Tests

`tests/` follows `tenutaroveglia-testing`:
- the same Playwright image (1.64.1) running in Docker,
- severity tags (`@critical`, `@high`, `@medium`),
- the same issues reporter and nightly rule (`tests/tools/severity-gate.cjs`): only `@critical`/`@high` failures fail a run,
- desktop and mobile runs, plus API tests.

The use cases come from OpenResto's own test suite, adapted to tastings:

| Area | Checks |
|---|---|
| Booking (`ui/booking.spec.ts`) | Book from start to finish and get a confirmation with the link; cancel from the link; full times can't be chosen; places taken while the guest fills in the form; Sfumature party rules; Sundays greyed out; required details; unknown links; accessibility scan |
| Booking API (`api/bookings.spec.ts`) | No overbooking, including simultaneous bookings; Sundays and Easter Monday closed; past dates and unknown times refused; party sizes per tasting; required fields; JSON only; the server works out the price; cancelling frees the places |
| Admin (`admin/admin.spec.ts`) | Refuses everything without an Access login, even with a made-up token; the public Worker has no admin functions; staff see a booking's details and link; change a booking, with price and places updated; changes that don't fit refused; phone bookings; cancel bookings; close and reopen days; change capacity; invalid settings refused; accessibility scan |

Tests that create bookings or use the local admin are skipped when `BASE_URL` points elsewhere. Against
the deployed trial, only the read-only checks run:

```sh
BASE_URL=https://prenota-test.<subdomain>.workers.dev docker compose run --rm tests
```

## Deploying the trial

Needs a Cloudflare API token allowed to edit Workers and D1, as `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in a git-ignored `.env`.

1. Create the database once, then put its id in both `wrangler.toml` and `wrangler.admin.toml`:
   `npx wrangler d1 create prenota-test`
2. Apply the migrations and deploy both Workers: `npm run deploy`

**Staff login (Cloudflare Access).**
1. In the Cloudflare dashboard, open Workers & Pages → `prenota-admin-test` → Settings → Domains & Routes, and enable Cloudflare Access for its `workers.dev` address.
2. Choose who may sign in: the staff's email addresses.
3. Copy the team domain (`<team>.cloudflareaccess.com`) and the application's AUD tag into `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.admin.toml`, and the booking Worker's address into `PUBLIC_URL` (so the admin shows guests' links).
4. Deploy again.

**Bot check (Turnstile), optional for the trial.**
1. Create a Turnstile widget for the booking Worker's address.
2. Set its site key as `TURNSTILE_SITE_KEY` in `wrangler.toml`.
3. Set the secret with `npx wrangler secret put TURNSTILE_SECRET_KEY`.

Without the bot check, anyone could fill the trial's times with fake bookings.

**Backups:** D1 Time Travel can restore the database to any minute in the last 30 days on the paid
plan, or 7 days on the free plan: `npx wrangler d1 time-travel restore prenota-test --timestamp=…`.

## Not done yet

- Emails to guests (confirmation, reminder) and to staff on new bookings.
- Payment (the shop's checkout Worker could take deposits), and vouchers.
- Private or custom-time visits (the €20 supplement), and the "tailor-made visit" request.
- Its own address (`prenota.tenutaroveglia.com`), which needs the domain's DNS on Cloudflare.
- English and German pages.
