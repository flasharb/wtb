#!/usr/bin/env bash
# One-time server provisioning for the Whale Buy Tracker droplet (Ubuntu 24.04).
# Idempotent: safe to re-run. Installs swap, Docker, and a minimal firewall.
set -euo pipefail

echo "==> 1/4 Swap (2G) for the 1GB droplet"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null
fi
free -m | head -2

echo "==> 2/4 Base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git ufw

echo "==> 3/4 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> 4/4 Firewall (keep SSH open!)"
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 22/tcp  >/dev/null 2>&1 || true
ufw allow 3000/tcp >/dev/null 2>&1 || true
ufw --force enable

docker --version
docker compose version
echo "PROVISION_DONE"
