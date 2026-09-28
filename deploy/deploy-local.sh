#!/usr/bin/env bash
# Deploy RoadDash to the local Caddy server.
#
# Layout follows the /srv/muse convention already in use on this host:
#   /srv/roaddash/releases/<UTC timestamp>   immutable release
#   /srv/roaddash/current -> releases/<ts>   symlink Caddy serves from
#
# Publishing is a symlink swap, so the site never serves a half-written
# directory: the new release is fully in place before `current` moves.
#
# Usage:
#   deploy/deploy-local.sh              build, publish, reload Caddy
#   deploy/deploy-local.sh --no-build   publish the existing dist/ as-is
#   deploy/deploy-local.sh --no-reload  skip the Caddy reload (config unchanged)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_ROOT=/srv/roaddash
CADDY_SITE=/etc/caddy/roaddash.caddy
MAIN_CADDYFILE=/etc/caddy/Caddyfile
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE="$DEPLOY_ROOT/releases/$STAMP"

BUILD=1
RELOAD=1
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --no-reload) RELOAD=0 ;;
    -h | --help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//' | sed '/^set -euo/,$d'
      exit 0
      ;;
    *)
      echo "unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn:\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

# --- build -----------------------------------------------------------------
if [ "$BUILD" -eq 1 ]; then
  say 'building'
  (cd "$REPO" && npm run build)
else
  say 'skipping build (--no-build)'
fi
[ -f "$REPO/dist/index.html" ] || die "no dist/index.html — run a build first"

# --- publish ---------------------------------------------------------------
say "publishing $STAMP"
sudo install -d -m 755 "$RELEASE"
sudo cp -r "$REPO/dist/." "$RELEASE/"
# caddy.service runs as User=caddy/Group=caddy on this host (verified in
# /lib/systemd/system/caddy.service), not www-data — so own the release to
# caddy, or the site 403s for reasons that look nothing like a permissions bug.
sudo chown -R caddy:caddy "$RELEASE"
sudo chmod -R a+rX "$RELEASE"

# Retain the last few releases so a rollback is a symlink swap, not a rebuild.
sudo find "$DEPLOY_ROOT/releases" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +

sudo ln -sfn "$RELEASE" "$DEPLOY_ROOT/current.new"
sudo mv -Tf "$DEPLOY_ROOT/current.new" "$DEPLOY_ROOT/current" # atomic swap
say "current -> $(readlink "$DEPLOY_ROOT/current")"

# --- caddy -----------------------------------------------------------------
say 'installing site config'
sudo install -m 644 "$REPO/deploy/caddy-site.roaddash" "$CADDY_SITE"

if [ "$RELOAD" -eq 1 ]; then
  # Only touch the main Caddyfile if the import line is missing.
  if ! grep -qF "$CADDY_SITE" "$MAIN_CADDYFILE"; then
    warn "adding import line to $MAIN_CADDYFILE"
    printf '\nimport %s\n' "$CADDY_SITE" | sudo tee -a "$MAIN_CADDYFILE" >/dev/null
    sudo cp "$MAIN_CADDYFILE" "$MAIN_CADDYFILE.bak-$STAMP"
  fi

  say 'validating config'
  sudo caddy validate --config "$MAIN_CADDYFILE" --adapter caddyfile \
    || die "Caddyfile failed validation — not reloading. The previous config is still live."

  say 'reloading caddy'
  sudo systemctl reload caddy
  sleep 1
  systemctl is-active --quiet caddy || die 'caddy is not active after reload'
else
  warn 'skipping caddy reload (--no-reload)'
fi

say 'done'
printf '  public: https://road.20070809.xyz/\n'
printf '  verify: curl -sI https://road.20070809.xyz/\n'

cat <<EOF

  rollback:  sudo ln -sfn <release> $DEPLOY_ROOT/current.new \\
               && sudo mv -Tf $DEPLOY_ROOT/current.new $DEPLOY_ROOT/current
               && sudo systemctl reload caddy
  releases:  ls -1t $DEPLOY_ROOT/releases
EOF
