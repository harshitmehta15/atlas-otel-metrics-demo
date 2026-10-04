#!/bin/sh
set -eu
/usr/local/bin/otelcol-contrib --config=/app/otel-collector.yaml &
COLLECTOR_PID=$!
node /app/server.mjs &
APP_PID=$!
cleanup() {
  kill "$APP_PID" "$COLLECTOR_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
wait "$APP_PID"
