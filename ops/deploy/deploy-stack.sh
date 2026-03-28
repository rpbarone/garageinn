#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Env file not found: ${ENV_FILE}" >&2
  exit 1
fi

if [[ "$(docker info --format '{{.Swarm.LocalNodeState}}')" != "active" ]]; then
  docker swarm init >/dev/null
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

STACK_NAME="${STACK_NAME:-${COMPOSE_PROJECT_NAME:-garageinn-legacy}}"

docker compose \
  --env-file "${ENV_FILE}" \
  -f "${ROOT_DIR}/docker-compose.yml" \
  build web

docker stack deploy \
  --resolve-image never \
  --prune \
  -c "${ROOT_DIR}/docker-compose.yml" \
  -c "${ROOT_DIR}/docker-stack.prod.yml" \
  "${STACK_NAME}"

WEB_SERVICE="${STACK_NAME}_web"
if docker service inspect "${WEB_SERVICE}" >/dev/null 2>&1; then
  docker service update --force "${WEB_SERVICE}" >/dev/null
fi

docker service ls --format 'table {{.Name}}\t{{.Replicas}}\t{{.Image}}' | grep "^${STACK_NAME}_"
