# OpenResto trial, themed for Tenuta Roveglia

A local trial of [OpenResto](https://openres.to) ([code](https://github.com/karanshukla/openresto), MIT),
built from our fork, [babettliroveglia/openresto](https://github.com/babettliroveglia/openresto), and running in Podman with Tenuta Roveglia's name, colours, fonts and tastings. It's for
seeing how a restaurant booking system fits our tastings (see [../alternatives-considered.md](../alternatives-considered.md)),
not for real bookings.

## Running it

Needs Podman, git, curl, jq and openssl, and the fork cloned next to this repo, on its
`tenutaroveglia` branch:

```sh
git clone -b tenutaroveglia git@github.com:babettliroveglia/openresto.git ../../openresto
```

The `tenutaroveglia` branch starts at the latest community release (v2.7.1), not at the fork's `main`,
and is where our own changes to OpenResto go. To move to a newer release, merge its tag into the branch.

```sh
./run.sh build   # build the images from the fork's current checkout (up does this when needed)
./run.sh up      # start: http://localhost:8089 (admin at /admin)
./run.sh setup   # apply the Tenuta Roveglia branding and tasting location (once, after the first start)
./run.sh down    # stop; bookings and settings are kept
./run.sh reset   # stop and delete everything
./run.sh logs
```

The first `up` creates `.env` with a random admin password and signing key. The admin login is
`ADMIN_EMAIL` and `ADMIN_PASSWORD` in that file, which is not committed.

## How it's put together

One Podman pod, `openresto-roveglia`, published on 127.0.0.1:8089 only:

| Container | Image | Role |
|---|---|---|
| `-backend` | `localhost/openresto-roveglia-backend`, built from the fork | API and SQLite database (volume `openresto-roveglia-db`) |
| `-frontend` | `localhost/openresto-roveglia-frontend`, built from the fork | The booking site and admin |
| `-nginx` | `localhost/openresto-roveglia-nginx`, built from the fork | OpenResto's own proxy, on port 8000 inside the pod |
| `-theme` | `nginx:1.27-alpine` | Our proxy in front: adds `theme/theme.css` to every page |

The images are tagged with the fork's commit (`git describe`, for example `v2.7.1`), so a new commit
on the branch means a new build. The branch is the v2.7.1 release plus our own changes:

- **"How to find us":** the section with the Google Maps and Apple Maps buttons (on the location page and
  the booking confirmation) is called "How to find us" instead of "Directions", in English, German and
  French. Spanish already said "Cómo llegar".

The rest of the customisation is here:

- **`setup/setup.sh`** sets things through OpenResto's admin API:
  - **Brand:** the name, the website's colours (brown `#8c5c3b` from the /visite/ buttons, gold
    `#b5985a`), the contact details, and a tasting photo from the website as the header.
  - **Home page:** the demo restaurant's highlights are replaced with our four tastings.
  - **Location:** one "Tenuta Roveglia — Degustazioni" location (the demo's second restaurant is
    deleted). It's open Monday to Saturday, 10:30 to 17:00, on Rome time, with two-hour visits and the
    last booking at 15:00.
  - **Address:** "Tenuta Roveglia, Località Roveglia 1, 25010 Pozzolengo BS". The maps buttons search
    for this text, and with the name first both Google and Apple open the winery's own listing. The
    bare address puts Google's pin about 700 m north, next to another winery; "Località Roveglia
    Nuova 1" is a different place. The confirmation page's small map uses OpenStreetMap, which doesn't
    find the address, so it isn't shown.
  - **Capacity:** a "Sala degustazione" with two groups of up to 10. These sizes are placeholders.
  - **Booking widget:** allowed on the website's local dev server, `http://localhost:4321`.
- **`theme/theme.css`** gives the pages the website's fonts: Lora for headings and Open Sans for text,
  the same font files the website uses.

## Putting it on the website

OpenResto's booking widget is one script tag. It worked in a test page on port 4321:

```html
<script src="http://localhost:8089/embed.js" data-location="1"></script>
```

For a real deployment, the instance would need its own address with HTTPS (for example
`prenota.tenutaroveglia.com`), and that origin added under Settings → Website widget.

## What doesn't fit our tastings

Found while setting this up:

- **No Italian.** OpenResto's interface is in English, French, Spanish and German only. Our own texts
  (names, descriptions, highlights) can be Italian, but buttons and messages stay in English.
- **No fixed tasting times.** Slots must be 15, 30 or 60 minutes apart, so guests can pick any half
  hour from 10:30 to 15:00, not just 10:30 and 15:00 as on /visite/.
- **Tables, not tastings.** Capacity is tables with seats. There's nothing for tasting types,
  per-person prices, payment or vouchers, and nothing for age limits or group-size rules per tasting.
- **No message history.** "Email guest" in a booking sends one message but keeps no copy: the audit
  log records only that the guest was emailed. OpenResto doesn't receive mail, so guests' replies go
  to the sending mailbox and aren't linked to the booking. (This trial has no mail server set up, so
  sending shows an error.)
- **Restaurant wording.** For example "The restaurant is closed on this day".
- **Theme depends on internals.** The font rules use React Native Web's generated class names
  (`css-146c3p1`) and inline styles, so an OpenResto upgrade could undo them. The colours, texts and
  photo are proper settings and would survive.
