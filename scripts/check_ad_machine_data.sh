#!/bin/zsh
set -euo pipefail

check_url() {
  local name="$1"
  local url="$2"
  local code
  code=$(curl -sS -m 8 -o "/tmp/${name}.json" -w '%{http_code}' "$url" || true)
  if [[ "$code" != "200" ]]; then
    printf 'FAIL %-28s %s %s\n' "$name" "$code" "$url"
    return 1
  fi
  printf 'OK   %-28s %s\n' "$name" "$url"
}

check_url web "http://127.0.0.1:5174/ad-machine/index.html"
check_url retail-zone "http://127.0.0.1:8000/api/inventory-quote/retail-zone"
check_url published-projection "http://127.0.0.1:8000/api/inventory-quote/published-product-projection"
check_url marketing-boost "http://127.0.0.1:8000/api/inventory-quote/marketing-boost"
check_url product-url-locks "http://127.0.0.1:8000/api/inventory-quote/product-url-locks"
check_url lottery-dashboard "http://127.0.0.1:8000/api/ad-machine/lottery/dashboard"
