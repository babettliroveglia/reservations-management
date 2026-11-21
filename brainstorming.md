# Brainstorming

Ideas to consider for the reservations system. Nothing here is decided.

## A heat-map calendar of bookings (like GitHub's contribution graph)

GitHub's profile page shows a year of activity as a grid of small squares: one column per week, one
row per weekday, and a darker shade of green for a busier day. It's compact, easy to scan, and shows
patterns at a glance.

The same layout could show tasting bookings:

- **For staff:** how full each day is over the season. Busy weekends, quiet weekdays, the run-up to
  Easter or the harvest, and gaps worth promoting would all stand out.
- **For customers:** availability over the coming weeks. Lighter squares mean more places left,
  closed days (Sundays, holidays) are greyed out, and full days are marked. Clicking a day would open
  that day's time slots.
- **Shade by:** bookings, places taken as a share of capacity, guests, or revenue.

Things to think about:

- Colour alone doesn't work for colour-blind visitors or screen readers. Each square needs a label
  (for example "Saturday 14 June: 6 of 16 places left") and keyboard navigation, plus a non-colour
  marker for full and closed days.
- On a phone, a full year is too wide. A few months, or a vertical layout, would fit better.
- For customers, "almost full" can encourage booking, but showing exact numbers may not be wanted.
- Most booking systems offer an ordinary month view. A heat map would probably be our own addition,
  built on the booking system's API.
