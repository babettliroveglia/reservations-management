#!/bin/sh
# Runs a trial OpenResto instance in a Podman pod, themed for Tenuta Roveglia, built from our fork
# (github.com/babettliroveglia/openresto, cloned next to this repo as ../openresto; set OPENRESTO_SRC
# to use another checkout). Build from the fork's `tenutaroveglia` branch: it starts at the latest
# community release (v2.7.1), and our own changes to OpenResto go there.
#   ./run.sh build   build the images from the fork's current checkout
#   ./run.sh up      start, building first if needed (first time: creates .env with a random admin password and key)
#   ./run.sh setup   apply the Tenuta Roveglia name, colours, photo and tasting location
#   ./run.sh down    stop and remove the pod (bookings are kept in the volumes)
#   ./run.sh reset   down, and delete the volumes too (all bookings and settings)
#   ./run.sh logs    follow the logs
set -eu
cd "$(dirname "$0")"

SRC="${OPENRESTO_SRC:-../../openresto}"
PORT="${OPENRESTO_PORT:-8089}"
POD=openresto-roveglia
IMG=localhost/openresto-roveglia

[ -d "$SRC/OpenRestoApi" ] || { echo "OpenResto source not found at $SRC: clone git@github.com:babettliroveglia/openresto.git there or set OPENRESTO_SRC"; exit 1; }
# Images are tagged with the fork's commit, so a new commit means a new build.
VERSION="$(git -C "$SRC" describe --tags --always --dirty)"

build() {
  branch="$(git -C "$SRC" branch --show-current)"
  [ "$branch" = tenutaroveglia ] || echo "Note: $SRC is on '${branch:-a detached commit}', not the tenutaroveglia branch."
  echo "Building OpenResto $VERSION from $SRC"
  # Podman doesn't guess a registry for short base-image names (e.g. "nginx:1.31.9-alpine"), so
  # fetch those from Docker Hub first, as Docker would.
  for f in "$SRC/OpenRestoApi/Dockerfile" "$SRC/openresto-frontend/Dockerfile" "$SRC/nginx/Dockerfile"; do
    sed -n 's/^FROM \(--platform=[^ ]* \)\{0,1\}\([^ ]*\).*/\2/p' "$f"
  done | sort -u | while read -r base; do
    case "$base" in *:*|*@*) ;; *) continue ;; esac            # untagged: a build stage, e.g. "FROM build"
    case "$base" in */*) case "${base%%/*}" in *.*|*:*|localhost) continue ;; esac ;; esac  # registry already given
    case "$base" in */*) full="docker.io/$base" ;; *) full="docker.io/library/$base" ;; esac
    podman image exists "$base" || { podman pull "$full" && podman tag "$full" "$base"; }
  done
  podman build -t "$IMG-backend:$VERSION" -f "$SRC/OpenRestoApi/Dockerfile" "$SRC"
  # The API address is baked into the frontend bundle at build time.
  podman build -t "$IMG-frontend:$VERSION" --build-arg EXPO_PUBLIC_API_URL=/api "$SRC/openresto-frontend"
  podman build -t "$IMG-nginx:$VERSION" "$SRC/nginx"
}

make_env() {
  [ -f .env ] && return
  umask 077
  {
    echo "# Local trial only. Created by run.sh; not committed."
    echo "JWT_KEY=$(openssl rand -base64 48 | tr -d '\n')"
    echo "ADMIN_EMAIL=admin@roveglia.test"
    echo "ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=\n')"
  } > .env
  echo "Created .env with an admin login for this trial (see ADMIN_EMAIL and ADMIN_PASSWORD in it)."
}

up() {
  make_env
  if podman pod exists "$POD"; then
    if [ "$(podman pod inspect "$POD" --format '{{.State}}')" = Running ]; then echo "Already running: http://localhost:$PORT"; return; fi
    podman pod rm -f "$POD" >/dev/null   # a stopped pod; bookings are in the volumes, not the pod
  fi
  for part in backend frontend nginx; do
    podman image exists "$IMG-$part:$VERSION" || { build; break; }
  done
  podman pod create --name "$POD" -p "127.0.0.1:$PORT:80"

  podman run -d --pod "$POD" --name "$POD-backend" --env-file .env \
    -e ASPNETCORE_ENVIRONMENT=Production -e PORT=8080 \
    -e CORS_ORIGINS="http://localhost:$PORT" -e WEBSITE_URL="http://localhost:$PORT" \
    -e CONNECTION_STRING="Data Source=/data/openresto.db" -e DATA_PROTECTION_KEYS_PATH=/data/dp-keys \
    -e OPENRESTO_DEFAULT_LOCALE=en \
    -v openresto-roveglia-db:/data -v openresto-roveglia-media:/app/wwwroot/media \
    "$IMG-backend:$VERSION"

  podman run -d --pod "$POD" --name "$POD-frontend" -e EXPO_PUBLIC_API_URL=/api "$IMG-frontend:$VERSION"

  # OpenResto's own proxy, moved to port 8000 inside the pod.
  podman run -d --pod "$POD" --name "$POD-nginx" \
    -e PORT=8000 -e BACKEND_HOST=127.0.0.1 -e BACKEND_PORT=8080 -e FRONTEND_HOST=127.0.0.1 -e FRONTEND_PORT=8081 \
    -v openresto-roveglia-media:/usr/share/nginx/html/media:ro \
    "$IMG-nginx:$VERSION"

  # Our proxy in front: adds the theme.
  podman run -d --pod "$POD" --name "$POD-theme" \
    -v "$PWD/proxy/nginx.conf:/etc/nginx/conf.d/default.conf:ro,Z" \
    -v "$PWD/theme:/srv/roveglia:ro,Z" \
    docker.io/library/nginx:1.27-alpine

  printf 'Waiting for OpenResto'
  i=0
  until curl -fs "http://localhost:$PORT/api/health" >/dev/null 2>&1; do
    i=$((i + 1)); [ $i -gt 90 ] && { echo; echo "Not up after 3 minutes; see ./run.sh logs"; exit 1; }
    printf .; sleep 2
  done
  echo; echo "Running: http://localhost:$PORT  (admin: http://localhost:$PORT/admin)"
}

case "${1:-up}" in
  build) build ;;
  up) up ;;
  setup) PORT="$PORT" ./setup/setup.sh ;;
  down) podman pod rm -f "$POD" 2>/dev/null || true ;;
  reset) podman pod rm -f "$POD" 2>/dev/null || true
         podman volume rm -f openresto-roveglia-db openresto-roveglia-media ;;
  logs) podman pod logs -f "$POD" ;;
  *) echo "Usage: $0 build|up|setup|down|reset|logs"; exit 2 ;;
esac
