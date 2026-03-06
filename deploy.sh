#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/app}"
REPO_URL="${REPO_URL:-}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "ERROR: $APP_DIR not found. Clone repo there first." >&2
  exit 1
fi

cd "$APP_DIR"

# First-time setup: initialize git repo if not already
if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "==> First-time git init"
  git init
  git remote add origin "${REPO_URL:-https://github.com/lakshayindia28-rgb/luckindia.git}"
fi

if [[ -n "$REPO_URL" ]]; then
  echo "==> Configuring git remote with credentials"
  git remote set-url origin "$REPO_URL"
fi

echo "==> Fetching latest code"
git fetch origin
git reset --hard origin/main

# Strip token from remote URL so it's not stored in .git/config
if [[ -n "$REPO_URL" ]]; then
  CLEAN_URL=$(echo "$REPO_URL" | sed 's|https://[^@]*@|https://|')
  git remote set-url origin "$CLEAN_URL"
fi

echo "==> Backend install + restart"
cd "$APP_DIR/backend"
npm ci --omit=dev

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart lakshayindia-backend || pm2 start server.js --name lakshayindia-backend
  pm2 save
else
  echo "PM2 not found. Install with: sudo npm i -g pm2" >&2
  exit 1
fi

echo "==> Frontend install + build"
cd "$APP_DIR/frontend"
npm ci
npm run build

echo "==> Publish frontend to /var/www (nginx)"
sudo mkdir -p /var/www/lakshayindia
sudo rsync -a --delete "$APP_DIR/frontend/dist/" /var/www/lakshayindia/
sudo chown -R www-data:www-data /var/www/lakshayindia
sudo chmod -R 755 /var/www/lakshayindia

echo "==> Reload nginx"
sudo systemctl reload nginx

echo "DEPLOY OK"
