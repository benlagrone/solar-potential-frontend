#!/bin/sh
set -eu

cat >/usr/share/nginx/html/runtime-config.js <<EOF
window.__APP_CONFIG__ = {
  apiBaseUrl: "${APP_API_BASE_URL:-}",
  gaMeasurementId: "${APP_GA_MEASUREMENT_ID:-}",
  demoMode: "${APP_DEMO_MODE:-false}",
  secondaryFrontendUrl: "${APP_SECONDARY_FRONTEND_URL:-}"
};
EOF
