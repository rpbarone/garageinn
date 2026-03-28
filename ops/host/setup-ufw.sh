#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--apply" ]]; then
  cat <<'EOF'
This script resets UFW and locks inbound access to the Tailscale interface only.
Review it first, then run:

  ./ops/host/setup-ufw.sh --apply
EOF
  exit 0
fi

sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0 comment 'Garageinn admin over Tailscale'
sudo ufw allow out on tailscale0 comment 'Garageinn admin over Tailscale'
sudo ufw --force enable
sudo ufw status verbose
