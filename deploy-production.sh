#!/usr/bin/env bash

set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run this deployment as root: sudo ./deploy-production.sh" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
canonical_name="crm-simulator"
legacy_name="crmsimulator"
domain="crmsim.coolfreakingames.dev"

cd "$repo_root"
git submodule update --init deploy

if systemctl cat "$legacy_name.service" >/dev/null 2>&1; then
  systemctl disable --now "$legacy_name.service"
fi
rm -f \
  "/etc/systemd/system/$legacy_name.service" \
  "/etc/nginx/conf.d/$legacy_name.conf"
systemctl daemon-reload

exec ./deploy/install.sh \
  --name "$canonical_name" \
  --domain "$domain" \
  --command "/usr/local/bin/deno run -A main.ts" \
  --env .env