#!/bin/sh
# Applies Tenuta Roveglia's branding and a tasting "location" to a fresh trial instance, through
# OpenResto's admin API. Safe to run again. Needs curl and jq.
# Usually run as: ./run.sh setup
set -eu
cd "$(dirname "$0")/.."
PORT="${PORT:-8089}"
API="http://localhost:$PORT/api"

set -a; . ./.env; set +a
JAR=$(mktemp); trap 'rm -f "$JAR"' EXIT

call() { # method path [json]; prints the response, or the error message and stops
  if [ $# -ge 3 ]; then
    out=$(curl -sS --fail-with-body -b "$JAR" -X "$1" -H 'Content-Type: application/json' -d "$3" "$API$2") \
      || { echo "$1 $2 failed: $out" >&2; exit 1; }
  else
    out=$(curl -sS --fail-with-body -b "$JAR" -X "$1" "$API$2") || { echo "$1 $2 failed: $out" >&2; exit 1; }
  fi
  printf '%s' "$out"
}

jq -n --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email: $e, password: $p}' |
  curl -fsS -c "$JAR" -H 'Content-Type: application/json' -d @- "$API/admin/auth/login" >/dev/null
echo "Logged in."

# Brand: name, the website's colours (buttons #8c5c3b as on /visite/, accents #b5985a), contacts.
call PATCH /brand "$(jq -n '{
  appName: "Tenuta Roveglia",
  primaryColor: "#8c5c3b",
  accentColor: "#b5985a",
  faviconIcon: "wine",
  websiteUrl: "https://tenutaroveglia.com",
  phoneNumber: "+39 030 918663",
  emailAddress: "info@tenutaroveglia.it",
  subtitle: "Degustazioni e visite in cantina · Wine tastings and cellar tours",
  copyrightText: "© Tenuta Roveglia · P.IVA IT 01509370985",
  highlightsHeading: "Le nostre degustazioni",
  highlightsSubheading: "Our tastings",
  headerImageFit: "cover"
}')" >/dev/null
echo "Brand applied."

# Highlights on the home page: the tastings from /visite/, replacing the demo restaurant's.
for id in $(call GET /highlights | jq -r '.[].id'); do call DELETE "/highlights/$id" >/dev/null; done
n=0
jq -c '.[]' <<'EOF' | while read -r h; do
[
  {"iconKey": "wine-outline", "title": "Percorso di Benvenuto",
   "body": "Tre vini: Lugana Limne, San Martino della Battaglia Vitis Alba, Merlot Garda DOC. Con grissini e taralli."},
  {"iconKey": "restaurant-outline", "title": "Percorso di Conoscenza",
   "body": "Quattro vini, tra cui Lugana Vigne di Catullo e Filo di Arianna. Con un tagliere di salumi e formaggi."},
  {"iconKey": "sparkles-outline", "title": "Sfumature",
   "body": "Sfumature di Limne e Sfumature di Catullo: degustazioni per piccoli gruppi di adulti."},
  {"iconKey": "calendar-outline", "title": "Dal lunedì al sabato",
   "body": "Visite alle 10:30 e alle 15:00. Chiuso la domenica e nei giorni festivi."}
]
EOF
  call POST /highlights "$(echo "$h" | jq --argjson n "$n" '. + {sortOrder: $n}')" >/dev/null
  n=$((n + 1))
done
echo "Highlights set."

# Header photo: a tasting on the terrace, from the website.
curl -fsS -b "$JAR" -F "file=@setup/hero.jpg;type=image/jpeg" "$API/media/hero" >/dev/null
echo "Header photo uploaded."

# The demo data has two restaurants. Keep one as the tasting location, remove the other.
LIST=$(call GET /admin/restaurants)
for id in $(echo "$LIST" | jq -r '.[] | select(.name == "Sushi Spot") | .id'); do
  call PATCH "/admin/restaurants/$id" '{"isArchived": true}' >/dev/null # required before deleting
  call DELETE "/admin/restaurants/$id" >/dev/null && echo "Removed demo location $id."
done
RID=$(echo "$LIST" | jq -r '[.[] | select(.name != "Sushi Spot")][0].id')

# Tastings Monday to Saturday, two hours each, closed Sundays. /visite/ offers only 10:30 and 15:00,
# but OpenResto slots must be 15, 30 or 60 minutes apart, so every half hour from 10:30 to 15:00 is offered.
HOURS=$(jq -n '[range(1;7) | {day: ., open: "10:30", close: "17:00", lastBooking: "15:00"}]')
call PUT "/restaurants/$RID" "$(jq -n --argjson h "$HOURS" '{
  name: "Tenuta Roveglia — Degustazioni",
  address: "Località Roveglia 1, 25010 Pozzolengo (BS)",
  description: "Visite e degustazioni in cantina, dal lunedì al sabato. Chiuso la domenica e nei giorni festivi.\n\nCellar tours and tastings, Monday to Saturday. Closed on Sundays and public holidays.",
  phoneNumber: "+39 030 918663",
  emailAddress: "info@tenutaroveglia.it",
  openDays: "1,2,3,4,5,6",
  openTime: "10:30",
  closeTime: "17:00",
  openHours: $h,
  lastBookingTime: "15:00",
  timezone: "Europe/Rome",
  defaultBookingDurationMinutes: 120,
  bookingSlotIntervalMinutes: 30
}')" >/dev/null
echo "Tasting location $RID set up."

# Places: one tasting room with two groups. Placeholder sizes, to be agreed with the staff.
SECTIONS=$(call GET "/restaurants/$RID" | jq -c '.sections')
FIRST=$(echo "$SECTIONS" | jq -r '.[0].id')
for sid in $(echo "$SECTIONS" | jq -r '.[1:][].id'); do call DELETE "/restaurants/$RID/sections/$sid" >/dev/null; done
call PUT "/restaurants/$RID/sections/$FIRST" '{"name": "Sala degustazione"}' >/dev/null
TABLES=$(echo "$SECTIONS" | jq -r '.[0].tables[].id')
n=0
for tid in $TABLES; do
  n=$((n + 1))
  name=$([ $n -eq 1 ] && echo "Gruppo A" || echo "Gruppo B")
  call PUT "/restaurants/$RID/sections/$FIRST/tables/$tid" "{\"name\": \"$name\", \"seats\": 10}" >/dev/null
done
echo "Tasting room: $n groups of up to 10."
# Booking widget: allow the website's local dev server (astro dev) to embed the booking form.
call PUT /admin/embed-settings '{"allowedOrigins": ["http://localhost:4321"]}' >/dev/null
echo "Booking widget allowed on http://localhost:4321 (Settings → Website widget)."
echo "Done: http://localhost:$PORT"
