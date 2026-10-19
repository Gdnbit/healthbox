#!/usr/bin/env bash
# Synthetic, disposable CI instance. No host data mounts or registry writes.
set -euo pipefail

image="${1:?Usage: healthbox-ci-docker-smoke.sh IMAGE}"
prefix="healthbox-ci-${RANDOM}-${RANDOM}"
network="${prefix}-net"
database="${prefix}-db"
application="${prefix}-app"
password="$(openssl rand -hex 32)"
secret="$(openssl rand -hex 32)"

cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    # Only the disposable synthetic instance appears in these logs.
    docker logs "$application" 2>&1 || :
    docker logs "$database" 2>&1 || :
  fi
  docker rm -f -v "$application" "$database" >/dev/null 2>&1 || :
  docker network rm "$network" >/dev/null 2>&1 || :
  exit "$result"
}
trap cleanup EXIT

docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" \
  -e POSTGRES_DB=healthbox_ci -e POSTGRES_USER=healthbox_ci \
  -e POSTGRES_PASSWORD="$password" postgres:15-bookworm >/dev/null
ready=false
for attempt in {1..60}; do
  if docker exec "$database" pg_isready -U healthbox_ci -d healthbox_ci >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
[ "$ready" = true ] || { echo 'PostgreSQL startup timed out' >&2; exit 1; }

docker run -d --name "$application" --network "$network" \
  -p 127.0.0.1::8000 \
  -e DATABASE_URL="postgresql://healthbox_ci:${password}@${database}:5432/healthbox_ci" \
  -e SECRET_KEY="$secret" -e ADMIN_DEFAULT_PASSWORD="$password" \
  -e ALLOW_USER_REGISTRATION=false -e HEALTH_AI_ENABLED=false \
  -e REMOTE_RELEASE_NOTES_ENABLED=false -e NOTIFICATIONS_ENABLED=false \
  -e SKIP_MIGRATIONS=false -e LOG_LEVEL=WARNING "$image" >/dev/null
port="$(docker port "$application" 8000/tcp | awk -F: '{print $NF}')"
ready=false
for attempt in {1..90}; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$application")" != true ]; then
    echo 'Application container stopped before readiness' >&2
    exit 1
  fi
  if curl --fail --silent --max-time 5 "http://127.0.0.1:${port}/health" >/dev/null; then
    ready=true
    break
  fi
  sleep 2
done
[ "$ready" = true ] || { echo 'Application health check timed out' >&2; exit 1; }
curl --fail --silent --max-time 10 "http://127.0.0.1:${port}/" >/dev/null
echo 'Fresh-instance migration, health and root HTTP checks passed.'
