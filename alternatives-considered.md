# Alternatives: open-source booking systems

Research into open-source projects a reservations system for Tenuta Roveglia could build on or learn
from. Written 2026-11-21. Licences and features change, so check the sources before deciding.

Each project lists its own site and code first, then where we found the details ("Found via").

## What we need

- **Tastings, not one-to-one appointments:** time slots with a group size and a capacity per slot,
  rules such as 4–8 adults for "Sfumature", and closed days (Sundays, Christmas, Easter Monday).
- **Gift vouchers** bought in the shop and redeemed for a tasting.
- **Google Calendar integration** with the company's business calendar.
- **Less back-and-forth with customers:** confirmation, reminders and changes handled by the system
  rather than by email exchanges.
- **A message history for each booking:** every email between staff and the guest, including the
  guest's replies, kept with the booking, so anyone on the staff can see what was agreed.
- **Italian, English and German.**

Today's booking form only sends an email with the requested details (see the website repo); staff then
arrange everything by hand.

## Which kind of booking is a tasting?

Little of this is specific to wineries; only the alcohol age check and the link to the shop and its
vouchers are. But a tasting isn't a restaurant booking either. It's closest to a **tour or ticketed
experience**:

| | Restaurant booking | Winery tasting | Tour or experience booking |
|---|---|---|---|
| **What's sold** | A table for a party at a time | A place in a session with a set start and length | The same as a tasting |
| **Capacity** | Table layout, table combinations, turn times | Places per session, with minimum and maximum group sizes | Places per session |
| **Price and payment** | Usually free; a no-show deposit at most | Priced per person, prepaid or by voucher | Prepaid, with ticket types |
| **Variations** | Walk-ins, a waitlist, seating areas | Several tasting types, guide language, adults versus non-drinkers or children | Experience types, languages, ticket types |
| **Staff** | Hosts manage the floor | A guide per session | A guide per session |

So the most relevant open-source projects are ticketing and time-slot systems, not restaurant ones.

## Summary

No open-source project covers winery tastings with Google Calendar and customer messaging out of the
box. **pretix**, used for time-slot booking, is the closest fit: it covers capacity, vouchers,
payments, languages and emails. **Hi.Events** is a reasonable second to try. We'd build the Google
Calendar bridge and the website integration around whichever we choose.

| Project | Fit for tastings | Google Calendar | Licence and hosting | Verdict |
|---|---|---|---|---|
| **[pretix](https://pretix.eu)** (Python/Django) | Time slots with a capacity limit per slot, gift vouchers, Stripe payments, several languages, confirmation emails, REST API | **None built in**: a sync would need building on its API and webhooks | AGPL, self-hostable; also sold as hosted pretix.eu | **Best fit** |
| **[Hi.Events](https://hi.events)** (Laravel, React) | Event ticketing: ticket types, attendee messaging, API and webhooks | Not checked | AGPL with extra terms (keep its "Powered by" link, publish changes); commercial licence removes them | **Second to try** |
| **[Easy!Appointments](https://easyappointments.org)** (PHP) | One appointment per provider per slot; nothing found on group sizes or a cap per slot | Two-way sync, but only with one calendar per provider | GPL, simple to host | Useful to study for calendar sync; probably too thin for tastings |
| **[Cal.diy](https://github.com/calcom/cal.diy)** (from [Cal.com](https://cal.com)) | Built for one-to-one meetings | Strong | Since April 2026 the free version is Cal.diy (MIT), with Workflows (reminders), Teams and Insights removed; the full product is enterprise-only | Avoid: the free edition lacks the messaging we need, and the licensing has been unstable |
| **[TastyIgniter](https://tastyigniter.com)** (Laravel) | Restaurant table booking with automatic table assignment | Not checked | MIT | Mature, but models tables, not sessions |
| **[Attendize](https://www.attendize.com)** (Laravel) | Event ticketing | Not checked | Attribution Assurance License | Dated codebase |
| **[OpenResto](https://github.com/karanshukla/openresto)**, **[KitchenAsty](https://kitchenasty.com)** | Restaurant table booking | Not checked | MIT | New and small; would need reworking |
| Tour-operator and winery platforms (FareHarbor, Bókun, Tock, VineSeat, Commerce7…) | Built for exactly this | Varies | Commercial, not open source | A benchmark for what staff may expect |

## Ticketing and time-slot systems

### pretix

Site: [pretix.eu](https://pretix.eu) · Code: [github.com/pretix/pretix](https://github.com/pretix/pretix)

- **Time slots:** an event series with the "event series or time slot booking" type; each slot has a
  quota that caps attendance. Slots are best created a few weeks at a time rather than a year ahead.
  ([Time-slot guide](https://docs.pretix.eu/en/latest/user/events/guides/timeslots.html))
- **Per-date settings:** each date can have its own quotas, products and seating plans.
  ([Features for culture venues](https://pretix.eu/about/en/for/culture))
- **Bulk editing:** creating and editing many slots at once has improved over several releases.
  ([3.9 release](https://pretix.eu/about/en/blog/20200602-release-390),
  [3.16 release](https://pretix.eu/about/en/blog/20210226-release-3160))
- **Vouchers:** can be tagged and commented to track redemptions.
  ([Marketing features](https://pretix.eu/about/en/features/marketing))
- **Self-hosting:** open source, with a REST API and plug-ins.
  (Found via [Cloudron forum](https://forum.cloudron.io/post/24791))
- **Still in active development:** [2026.5 release](https://pretix.eu/about/en/blog/20260527-release-2026-5/).
- **Gap:** nothing found on Google Calendar integration; its calendar is the week or month view in its
  own shop. We'd build the sync on the REST API, or check its plug-in list (not checked).
- **Cost:** hosting a real server application (Django, Postgres, Redis), a step beyond the website's
  static pages and checkout Worker.

### Hi.Events

Site: [hi.events](https://hi.events) · Code: [github.com/HiEventsDev/Hi.Events](https://github.com/HiEventsDev/Hi.Events)

- **Licence:** AGPL-3.0 with additional terms. Self-hosting is free, but the "Powered by Hi.Events"
  link must stay visible and changes must be published; a commercial licence, priced by annual ticket
  sales, removes both. ([Licensing page](https://hi.events/licensing))
- **Free core:** ticket types (free, paid, donation, tiered), attendee messaging, team roles, the API,
  webhooks and website widgets. A few features, such as reserved seating, need a licence key.
- **Hosted option:** Hi.Events Cloud runs the same software.
- Found via [AlternativeTo](https://alternativeto.net/software/hi-events/about) and
  [OpenAlternative](https://openalternative.co/hi-events).

### Attendize

Site: [attendize.com](https://www.attendize.com) · Code: [github.com/Attendize/Attendize](https://github.com/Attendize/Attendize)

- Ticket selling and attendee management without third-party fees, on Laravel.
- **Licence:** Attribution Assurance License, with white-label licences for sale.
- **Age:** its listed dependencies are old (Laravel 6), so check how active it is before relying on it.
- Found via [AlternativeTo](https://alternativeto.net/software/attendize-event-ticketing/about/) and
  [ecosyste.ms](https://awesome.ecosyste.ms/projects/github.com%2FAttendize%2FAttendize).

## Appointment schedulers

### Easy!Appointments

Site: [easyappointments.org](https://easyappointments.org) · Code: [github.com/alextselegidis/easyappointments](https://github.com/alextselegidis/easyappointments)

- **Current release:** 1.6.0 (May 2026), with improved Google Calendar sync, Google Meet and Jitsi, and
  providers managing their own sync settings.
  ([1.6.0 release](https://easyappointments.org/blog/easyappointments-v1-6-0-release/),
  [preview of 1.6](https://easyappointments.org/blog/early-preview-of-features-coming-in-1-6/),
  [release announcement](https://groups.google.com/g/easy-appointments/c/L0VLdgxADXs))
- **One calendar only:** sync always works between Easy!Appointments and a single calendar; a Google
  account's calendars can't be mixed.
  ([Forum thread](https://groups.google.com/g/easy-appointments/c/8EsHGKHOWJc))
- **Sync limits:** a user with a full calendar had to shorten the sync window to make it work.
  ([Forum thread](https://groups.google.com/g/easy-appointments/c/xpXdwxhIg2w))
- **Gap:** nothing found on group bookings or capacity per slot.

### Cal.com and Cal.diy

Site: [cal.com](https://cal.com) · Code: [github.com/calcom/cal.diy](https://github.com/calcom/cal.diy)

- **Licence change, April 2026:** the free, open-source code was relaunched as Cal.diy under MIT, for
  self-hosting at your own risk; its maintainers recommend it for personal, non-production use.
  Commercial self-hosting of the full product is an Enterprise offering with a private repository.
  ([Cal.com announcement](https://cal.com/blog/cal-diy-open-source-to-closed-source); found via
  [AlternativeTo news](https://alternativeto.net/news/2026/4/cal-com-is-going-closed-source-with-a-major-shift-in-its-license-strategy/))
- **Removed from the free edition:** Teams, Organizations, Insights, Workflows and SSO/SAML.
- **Before that** it was AGPLv3 with enterprise features under a commercial licence, which older
  descriptions still say.
  ([Earlier licence post](https://cal.com/blog/changing-to-agplv3-and-introducing-enterprise-edition),
  [2026 review](https://dev.to/pickuma/calcom-review-self-hosted-open-source-scheduling-in-2026-opd))

## Restaurant booking systems

All three book tables; none has sessions with per-person tickets, prepayment or vouchers.

### TastyIgniter

Site: [tastyigniter.com](https://tastyigniter.com) · Code: [github.com/tastyigniter/TastyIgniter](https://github.com/tastyigniter/TastyIgniter)

- The most established: online ordering and table reservations on Laravel, MIT since version 3.
- **Reservation extension:** a booking form with automatic table assignment; needs TastyIgniter 4.
  ([Extension docs](https://tastyigniter.com/docs/extensions/reservation),
  [Packagist](https://packagist.org/packages/tastyigniter/ti-ext-reservation))
- Found via [Laravel News](https://laravel-news.com/tastyigniter-open-source-restaurant-software).

### OpenResto

Code: [github.com/karanshukla/openresto](https://github.com/karanshukla/openresto)

- Self-hosted restaurant booking in TypeScript, MIT: real-time table holds, floor sections, several
  restaurants per instance, email from your own address, one Docker Compose command.
- Small and early (13 stars when listed).
- Found via [AlternativeTo](https://alternativeto.net/software/openresto/about/).

### KitchenAsty

Site: [kitchenasty.com](https://kitchenasty.com) · Code: [github.com/mighty840/kitchenasty](https://github.com/mighty840/kitchenasty)

- Ordering, reservations and management in a TypeScript monorepo (React, Node.js, PostgreSQL), MIT;
  launched February 2026.
- Found via [DEV Community](https://dev.to/mighty840/i-built-an-open-source-alternative-to-toast-and-square-for-restaurant-management-3mdf)
  and [Product Hunt](https://www.producthunt.com/p/kitchenasty).

## Commercial platforms, for comparison

- **Tour and activity booking**, built for exactly this model:
  [FareHarbor](https://fareharbor.com), [Bókun](https://www.bokun.io), TrekkSoft, Rezdy, Checkfront and
  Xola. No open-source equivalent was found; [one directory](https://us.fitgap.com/search/tour-operator-software/open-source)
  lists [Planyo](https://www.planyo.com) as self-hosted, unverified.
  Found via [AlternativeTo](https://alternativeto.net/software/fareharbor) and
  [Bókun's comparison](https://www.bokun.io/fareharbor-alternatives) (a competitor's view).
- **Winery platforms:**
  [Tock for wineries](https://www.exploretock.com/join/wineries/),
  [Commerce7 reservations](https://www.commerce7.com/solution/reservations),
  [VineSeat](https://vineseat.com) ([for Commerce7](https://salessite-v3.commerce7.com/partners/apps/vineseat/)),
  [Now Book It](https://www.nowbookit.com/wineries-breweries/),
  [anny](https://anny.co/en/solutions/winery-booking-system), and a
  [winery reservation system buyer's guide](https://www.getservicify.com/post/winery-reservation-system-buyers-guide).

## Building our own instead

A small custom service, for example on Cloudflare (where the checkout Worker already runs) with its
database, using Google Calendar as the staff's view and borrowing Easy!Appointments' approach to sync.
More control, but we'd rebuild capacity rules, vouchers, payments and emails ourselves.

## Questions for the staff

1. **Instant booking or request and confirm:** do customers book a slot directly, or request one that
   staff confirm?
2. **Payment:** do tastings take payment or a deposit when booking, or only redeem vouchers?
3. **Calendar as an input:** should staff availability in Google Calendar (a host off, a private event)
   close slots automatically, or does the calendar only need to show bookings?
