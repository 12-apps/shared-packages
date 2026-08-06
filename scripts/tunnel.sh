#!/usr/bin/env bash
# ===========================================================================
# tunnel.sh — put the local Storybook on a public HTTPS URL
#
# A slim sibling of future-pay's scripts/ephemeral/tunnel.sh, carrying over
# only the part that applies here: this repo has no app and no database, just a
# dev server someone needs to LOOK at from outside the container.
#
#   ./scripts/tunnel.sh up                  # start Storybook, publish it
#   ./scripts/tunnel.sh up --port 6008      # publish something else instead
#   ./scripts/tunnel.sh up --id review-42   # pick the subdomain
#   ./scripts/tunnel.sh up --no-start       # publish a server already running
#   ./scripts/tunnel.sh status
#   ./scripts/tunnel.sh url
#   ./scripts/tunnel.sh down
#
# WHY frp AND NOT ngrok/cloudflared. Behind a Claude Code cloud session's egress
# proxy the choice is forced: the proxy forwards a CONNECT opaquely only to a
# DNS *hostname* on :443 whose first bytes are a real TLS ClientHello.
# cloudflared dials raw TCP :7844, ngrok's agent-behind-proxy is a paid feature,
# and plaintext SSH banners hang the CONNECT. frp over wss:443 to a box we own
# goes through untouched, and needs no third-party account.
#
# WHICH SUBDOMAIN YOU GET. With no --id, the host derives from this agent's
# session id — fp-<hash>.local.<domain> — stable across a down/up so a shared
# link keeps working, and distinct per agent so parallel sessions do not race
# for a name. A name the relay says is taken is retried with a -2, -3 suffix,
# and the host actually taken is printed.
#
# ALLOWED HOSTS. Vite answers 403 to a Host it was not told about, so `up`
# exports STORYBOOK_ALLOWED_HOSTS before starting Storybook (see
# packages/ui/.storybook/main.ts). --no-start cannot do that for a server that
# is already up: start that one with the variable set, or let this script
# start it.
#
# ANYTHING PUBLISHED HERE IS WORLD-READABLE. The URL is unguessable, not
# private, and there is no auth in front of it.
#
# REQUIREMENTS
#   RELAY_FRP_TOKEN — shared secret with the relay's frps. Already in the
#                     environment of a Claude Code session; on a laptop, take it
#                     from the relay box's Doppler config.
# ===========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PORT="${TUNNEL_PORT:-6006}"
TUNNEL_ID="${TUNNEL_ID:-}"
START=1

WORK_DIR="$REPO_ROOT/.tunnel"
STATE="$WORK_DIR/state.json"
FRP_VERSION="${FRP_VERSION:-0.69.1}"
FRPC_BIN="$WORK_DIR/frpc"
RELAY_DOMAIN="${RELAY_DOMAIN:-paladira.com}"
RELAY_SUBDOMAIN="${RELAY_SUBDOMAIN:-local}"
# Fixed name the relay's TLS gate blesses unconditionally, so frpc can reach it
# before the tunnel that would authorize it exists.
RELAY_CONTROL_HOST="${RELAY_CONTROL_HOST:-control}"
RELAY_MAX_ATTEMPTS="${RELAY_MAX_ATTEMPTS:-5}"

# Progress goes to stderr, never stdout: start_tunnel returns the URL by
# printing it, so a progress line on stdout would land in the caller's variable.
die()  { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[36m▸\033[0m %s\n' "$*" >&2; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }

# Bounded by the header's own closing banner — a hard-coded line range silently
# truncates the moment the header grows.
usage() { sed -n '3,/^# =\{20,\}$/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

ensure_frpc() {
  [ -x "$FRPC_BIN" ] && return
  info "downloading frpc $FRP_VERSION ..."
  mkdir -p "$WORK_DIR"
  local url="https://github.com/fatedier/frp/releases/download/v$FRP_VERSION/frp_${FRP_VERSION}_linux_amd64.tar.gz"
  curl -sSL -o "$WORK_DIR/frp.tgz" "$url" || die "frp download failed"
  tar xzf "$WORK_DIR/frp.tgz" -C "$WORK_DIR" || die "frp extract failed"
  install -m 0755 "$WORK_DIR/frp_${FRP_VERSION}_linux_amd64/frpc" "$FRPC_BIN" ||
    die "frpc not found in the release archive"
  rm -rf "$WORK_DIR/frp.tgz" "$WORK_DIR/frp_${FRP_VERSION}_linux_amd64"
}

relay_token() {
  [ -n "${RELAY_FRP_TOKEN:-}" ] || die "RELAY_FRP_TOKEN is not set.
       It must match RELAY_FRP_TOKEN on the relay box (the value
       docker-compose.relay.yml passes to frps)."
  printf '%s' "$RELAY_FRP_TOKEN"
}

# Derived, not random: the same agent re-running gets the same URL, while two
# agents essentially never collide. The fallbacks matter in that order — a
# machine id still separates containers, and the last resort separates nothing,
# which is what the collision suffix is for.
derive_id() {
  local seed="${RELAY_ID_SEED:-${CLAUDE_CODE_SESSION_ID:-}}"
  if [ -z "$seed" ] && [ -r /etc/machine-id ]; then seed="$(cat /etc/machine-id)"; fi
  if [ -z "$seed" ]; then seed="$(hostname)-$REPO_ROOT"; fi
  # Leading letter so the label is legal where a bare-digit start is not.
  printf 'sb-%s' "$(printf '%s' "$seed" | sha256sum | cut -c1-10)"
}

# frps accepts an illegal label and the failure surfaces later as an unroutable
# host — which reads as "the relay is down" rather than "that name can't exist".
normalize_id() {
  local id; id="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  printf '%s' "$id" | grep -qE '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' ||
    die "--id '$1' is not a valid DNS label — use lowercase letters, digits and
       hyphens (max 63 chars, must not start or end with a hyphen)"
  printf '%s' "$id"
}

# Precedence: an explicit --id, then whatever this checkout used last (so a
# stop/start returns the same URL), then this agent's derived name.
session_id() {
  local f="$WORK_DIR/session-id"
  if [ -n "$TUNNEL_ID" ]; then mkdir -p "$WORK_DIR"; printf '%s' "$TUNNEL_ID" > "$f"; fi
  if [ -s "$f" ]; then tr -d '\n' < "$f"; else derive_id; fi
  # Must end truthy: the caller assigns this in a command substitution under
  # `set -e`, so a failed [ -s ] test would abort the script silently.
  return 0
}

# 0 on success, 2 if the relay says the subdomain is taken, dies on anything else.
try_slot() {
  local port="$1" id="$2" control="$3"
  local proxy="${HTTPS_PROXY:-${https_proxy:-}}"

  cat > "$WORK_DIR/frpc.toml" <<TOML
serverAddr = "$control"
serverPort = 443
loginFailExit = true
auth.method = "token"
auth.token = "$(relay_token)"
transport.protocol = "wss"
$([ -n "$proxy" ] && printf 'transport.proxyURL = "%s"' "$proxy")
log.to = "$WORK_DIR/frpc.log"
log.level = "info"

[[proxies]]
name = "$id"
type = "http"
localIP = "127.0.0.1"
localPort = $port
subdomain = "$id"
TOML

  : > "$WORK_DIR/frpc.log"
  # setsid so the child leads its own process group and `down` can signal the
  # whole tree — a plain background job inherits ours, where a group kill would
  # take this script with it.
  setsid "$FRPC_BIN" -c "$WORK_DIR/frpc.toml" > "$WORK_DIR/frpc.out" 2>&1 &
  echo $! > "$WORK_DIR/frpc.pid"

  for _ in $(seq 1 30); do
    grep -q "start proxy success" "$WORK_DIR/frpc.log" 2>/dev/null && return 0
    # "Another client already serves this name" — frps says it two ways, and
    # which one you get depends on what collides: `already exists` is the proxy
    # NAME, `router config conflict` is the HTTP route. Both are retried by frpc
    # forever, so the first sighting is the verdict — nothing to wait for.
    if grep -qE "router config conflict|already exists" "$WORK_DIR/frpc.log" 2>/dev/null; then
      kill "$(cat "$WORK_DIR/frpc.pid")" 2>/dev/null || true
      rm -f "$WORK_DIR/frpc.pid"
      return 2
    fi
    if grep -qiE "login to server failed|authorization failed" "$WORK_DIR/frpc.log" 2>/dev/null; then
      tail -5 "$WORK_DIR/frpc.log" >&2
      die "the relay rejected this client — RELAY_FRP_TOKEN probably differs from the box's"
    fi
    sleep 2
  done
  tail -12 "$WORK_DIR/frpc.log" 2>/dev/null >&2 || tail -12 "$WORK_DIR/frpc.out" >&2
  die "frpc never connected to $control — check that frps is up on the relay box"
}

start_tunnel() {
  local port="$1" base="$2"
  ensure_frpc
  local control="$RELAY_CONTROL_HOST.$RELAY_SUBDOMAIN.$RELAY_DOMAIN"

  local id attempt
  for attempt in $(seq 1 "$RELAY_MAX_ATTEMPTS"); do
    if [ "$attempt" -eq 1 ]; then id="$base"; else id="$base-$attempt"; fi
    if try_slot "$port" "$id" "$control"; then
      printf '%s' "$id" > "$WORK_DIR/session-id"
      [ "$id" != "$base" ] &&
        warn "'$base' is already served by another session — took '$id' instead.
       That is a DIFFERENT host, so a link you already shared does not apply to it."
      printf 'https://%s.%s.%s' "$id" "$RELAY_SUBDOMAIN" "$RELAY_DOMAIN"
      return 0
    fi
    info "'$id' is in use — trying the next name"
  done
  die "'$base' and $((RELAY_MAX_ATTEMPTS - 1)) suffixed variants are all in use.
       That many collisions usually means stale clients are holding the names.
       Pick a name yourself with: tunnel.sh up --id <name>"
}

port_listening() { # port
  # -w0 so a port nothing answers on does not stall the caller for a minute.
  nc -z -w0 127.0.0.1 "$1" >/dev/null 2>&1
}

wait_http() { # url, label, attempts
  local url="$1" label="$2" attempts="${3:-60}"
  for _ in $(seq 1 "$attempts"); do
    curl -fsS --noproxy '*' -o /dev/null "$url" && return 0
    sleep 2
  done
  die "$label never came up at $url"
}

start_storybook() {
  local port="$1" id="$2"
  if port_listening "$port"; then
    warn "something is already listening on :$port — publishing that.
       If it is a Storybook started without STORYBOOK_ALLOWED_HOSTS, the tunnel
       will answer 403; stop it and re-run without --no-start."
    return 0
  fi
  info "starting Storybook on :$port ..."
  mkdir -p "$WORK_DIR"
  # The dev server has to accept the tunnel's Host header, and it can only be
  # told at startup — which is why publishing a server we did not start is the
  # one case this script cannot make work on its own.
  # Every suffixed name the relay might hand us, not just the first: the id is
  # settled after this, and a Storybook told only about `sb-abc` answers 403 on
  # `sb-abc-2`.
  local hosts="localhost,127.0.0.1,$id.$RELAY_SUBDOMAIN.$RELAY_DOMAIN"
  local n
  for n in $(seq 2 "$RELAY_MAX_ATTEMPTS"); do
    hosts="$hosts,$id-$n.$RELAY_SUBDOMAIN.$RELAY_DOMAIN"
  done
  # setsid: same reason as frpc, and more so — `storybook dev` is a node parent
  # with vite children, and killing only the parent leaves :$port held.
  STORYBOOK_ALLOWED_HOSTS="$hosts" \
    setsid pnpm --dir "$REPO_ROOT/packages/ui" exec storybook dev -p "$port" --no-open --ci \
    > "$WORK_DIR/storybook.log" 2>&1 &
  echo $! > "$WORK_DIR/storybook.pid"
  wait_http "http://127.0.0.1:$port/" "Storybook" 90
  ok "Storybook is up on :$port"
}

cmd_up() {
  mkdir -p "$WORK_DIR"
  local id; id="$(session_id)"
  [ "$START" -eq 1 ] && start_storybook "$PORT" "$id"

  info "opening relay tunnel to :$PORT ..."
  local url; url="$(start_tunnel "$PORT" "$id")"

  # The public URL, not the local one: this is the round trip the reader will
  # make, and it is what proves the relay routed the name we were given.
  wait_http "$url" "the tunnel" 30
  printf '%s' "$url" > "$WORK_DIR/url"
  printf '{"url":"%s","port":"%s","id":"%s"}\n' "$url" "$PORT" "$id" > "$STATE"

  ok "Storybook is public"
  printf '\n  \033[1m%s\033[0m\n\n  port %s   id %s\n  world-readable — the URL is unguessable, not private\n\n' \
    "$url" "$PORT" "$id"
}

cmd_status() {
  [ -f "$STATE" ] || { echo "no tunnel"; return 0; }
  local url port; url="$(sed -n 's/.*"url":"\([^"]*\)".*/\1/p' "$STATE")"
  port="$(sed -n 's/.*"port":"\([^"]*\)".*/\1/p' "$STATE")"
  printf 'url    %s\n' "$url"
  printf 'port   %s (%s)\n' "$port" "$(port_listening "$port" && echo listening || echo down)"
  printf 'frpc   %s\n' "$(kill -0 "$(cat "$WORK_DIR/frpc.pid" 2>/dev/null)" 2>/dev/null && echo running || echo down)"
  printf 'public %s\n' "$(curl -fsS --noproxy '*' -o /dev/null "$url" 2>/dev/null && echo reachable || echo unreachable)"
}

kill_pidfile() { # file
  local f="$1" pid
  [ -f "$f" ] || return 0
  pid="$(cat "$f")"
  # The process group: storybook dev is a node parent with vite children, and
  # killing only the parent leaves the port held.
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  rm -f "$f"
}

cmd_down() {
  kill_pidfile "$WORK_DIR/frpc.pid"
  kill_pidfile "$WORK_DIR/storybook.pid"
  rm -f "$STATE" "$WORK_DIR/url"
  ok "stopped"
}

CMD="${1:-up}"; shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port) PORT="$2"; shift 2 ;;
    # Assignment form on purpose: it propagates the exit status of a rejected
    # name, so `set -e` stops here instead of carrying an empty id forward.
    -i|--id) TUNNEL_ID="$(normalize_id "$2")"; shift 2 ;;
    --no-start) START=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

case "$CMD" in
  up)     cmd_up ;;
  status) cmd_status ;;
  url)    [ -f "$WORK_DIR/url" ] && cat "$WORK_DIR/url" && echo ;;
  down)   cmd_down ;;
  help|-h|--help) usage ;;
  *)      die "unknown command: $CMD (try: help)" ;;
esac
