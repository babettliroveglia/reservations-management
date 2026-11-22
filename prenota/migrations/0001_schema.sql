-- Tasting bookings. Applied with `wrangler d1 migrations apply` (see README.md).

-- The tastings offered, as on tenutaroveglia.com/visite/.
CREATE TABLE tastings (
  id                TEXT PRIMARY KEY,            -- e.g. 'benvenuto'
  name              TEXT NOT NULL,
  description       TEXT NOT NULL,
  duration_min      INTEGER NOT NULL,
  price_adult_cents INTEGER NOT NULL,
  teen_discount_pct INTEGER,                     -- 13–17 year olds; NULL = adults only
  min_adults        INTEGER NOT NULL,
  max_adults        INTEGER NOT NULL,
  sort              INTEGER NOT NULL DEFAULT 0,
  active            INTEGER NOT NULL DEFAULT 1
);

-- Settings staff can change in the admin.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Extra closed days (Sundays and public holidays are closed anyway; see src/rules.ts).
CREATE TABLE closures (
  date   TEXT PRIMARY KEY,                       -- 'YYYY-MM-DD'
  reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE bookings (
  id           INTEGER PRIMARY KEY,
  token        TEXT NOT NULL UNIQUE,             -- secret in the guest's link to view or cancel
  date         TEXT NOT NULL,                    -- 'YYYY-MM-DD', Italian time
  time         TEXT NOT NULL,                    -- 'HH:MM'
  tasting_id   TEXT NOT NULL REFERENCES tastings(id),
  adults       INTEGER NOT NULL,
  teens        INTEGER NOT NULL DEFAULT 0,       -- 13–17
  children     INTEGER NOT NULL DEFAULT 0,       -- 0–12, free
  guests       INTEGER NOT NULL,                 -- adults + teens + children: counts against capacity
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  price_cents  INTEGER NOT NULL,                 -- price when booked, paid at the winery
  status       TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  cancelled_by TEXT,                             -- 'guest' or the staff member's email
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  cancelled_at TEXT
);

CREATE INDEX bookings_slot ON bookings (date, time, status);
