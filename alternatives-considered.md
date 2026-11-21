# Alternatives: open-source booking systems

Research into open-source projects a reservations system for Tenuta Roveglia could build on or learn
from. Written 2026-11-21. Licences and features change, so check the sources before deciding.

## What we need

- **Tastings, not one-to-one appointments:** time slots with a group size and a capacity per slot,
  rules such as 4–8 adults for "Sfumature", and closed days (Sundays, Christmas, Easter Monday).
- **Gift vouchers** bought in the shop and redeemed for a tasting.
- **Google Calendar integration** with the company's business calendar.
- **Less back-and-forth with customers:** confirmation, reminders and changes handled by the system
  rather than by email exchanges.
- **Italian, English and German.**

Today's booking form only sends an email with the requested details (see the website repo); staff then
arrange everything by hand.

## Summary

No open-source project covers winery tastings with Google Calendar and customer messaging out of the
box. **pretix**, used for time-slot booking, is the closest fit: it covers capacity, vouchers,
payments, languages and emails. We'd build the Google Calendar bridge and the website integration
around it.

| Project | Fit for tastings | Google Calendar | Licence and hosting | Verdict |
|---|---|---|---|---|
| **pretix** (Python/Django) | Time slots with a capacity limit per slot, gift vouchers, Stripe payments, several languages, confirmation emails, REST API | **None built in**: a sync would need building on its API and webhooks | AGPL, self-hostable; also sold as hosted pretix.eu | **Best fit** |
| **Easy!Appointments** (PHP) | One appointment per provider per slot; nothing found on group sizes or a cap per slot | Two-way sync, but only with one calendar per provider | GPL, simple to host | Useful to study for calendar sync; probably too thin for tastings |
| **Cal.com / Cal.diy** | Built for one-to-one meetings | Strong | Since April 2026 the free version is Cal.diy (MIT), with Workflows (reminders), Teams and Insights removed; the full product is enterprise-only | Avoid: the free edition lacks the messaging we need, and the licensing has been unstable |
| **OpenResto** | Restaurant table booking | Not checked | MIT, self-hosted | Would need adapting |
| Winery platforms (Tock, VineSeat, Commerce7, Now Book It) | Built for exactly this | Varies | Commercial, not open source | A benchmark for what staff may expect |

## pretix

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
  ([Cloudron forum](https://forum.cloudron.io/post/24791))
- **Still in active development:** [2026.5 release](https://pretix.eu/about/en/blog/20260527-release-2026-5/).
- **Gap:** nothing found on Google Calendar integration; its calendar is the week or month view in its
  own shop. We'd build the sync on the REST API, or check its plug-in list (not checked).
- **Cost:** hosting a real server application (Django, Postgres, Redis), a step beyond the website's
  static pages and checkout Worker.

## Easy!Appointments

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

## Cal.com and Cal.diy

- **Licence change, April 2026:** the free, open-source code was relaunched as Cal.diy under MIT, for
  self-hosting at your own risk; commercial self-hosting of the full product is an Enterprise offering
  with a private repository.
  ([Cal.com announcement](https://cal.com/blog/cal-diy-open-source-to-closed-source),
  [AlternativeTo news](https://alternativeto.net/news/2026/4/cal-com-is-going-closed-source-with-a-major-shift-in-its-license-strategy/))
- **Removed from the free edition:** Teams, Organizations, Insights, Workflows and SSO/SAML.
- **Before that** it was AGPLv3 with enterprise features under a commercial licence, which older
  descriptions still say.
  ([Earlier licence post](https://cal.com/blog/changing-to-agplv3-and-introducing-enterprise-edition),
  [2026 review](https://dev.to/pickuma/calcom-review-self-hosted-open-source-scheduling-in-2026-opd))

## Others

- **OpenResto:** MIT-licensed, self-hosted restaurant booking with real-time table holds and several
  locations per instance; could be adapted, with custom work.
  ([AlternativeTo](https://alternativeto.net/software/openresto/about/))
- **Commercial winery platforms**, for comparison:
  [Tock for wineries](https://www.exploretock.com/join/wineries/),
  [Commerce7 reservations](https://www.commerce7.com/solution/reservations),
  [VineSeat for Commerce7](https://salessite-v3.commerce7.com/partners/apps/vineseat/),
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
