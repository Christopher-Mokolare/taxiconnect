#!/bin/zsh

setopt NO_BANG_HIST

BASE_URL="http://localhost:8787"
CURL="/usr/bin/curl"
CAT="/bin/cat"

PASS=0
FAIL=0
TOTAL=0

PASSENGER_RANK="e2e-passenger-rank"
PASSENGER_DEMAND="e2e-passenger-rust-demand"

RUST_ROUTE="route_mabeskraal_rustenburg"
RUST_MAB="pickup_mabeskraal_rank_rust"
RUST_RUST="pickup_rustenburg_rank_rust"
SUN_POINT="pickup_sun_village"

TMP_DIR="/tmp/taxiconnect-e2e"
mkdir -p "$TMP_DIR"

print_header() {
  echo
  echo "============================================================"
  echo " $1"
  echo "============================================================"
}

assert_http() {
  local name="$1"
  local expected="$2"
  local method="$3"
  local path="$4"
  local passenger="$5"
  local body="$6"

  TOTAL=$((TOTAL + 1))

  local file="$TMP_DIR/test_$TOTAL.json"
  local http

  if [ "$method" = "GET" ]; then
    http=$("$CURL" -sS -o "$file" -w "%{http_code}" \
      "$BASE_URL$path")
  else
    http=$("$CURL" -sS -o "$file" -w "%{http_code}" \
      -X "$method" \
      "$BASE_URL$path" \
      -H 'Content-Type: application/json' \
      -H "X-Passenger-Id: $passenger" \
      -d "$body")
  fi

  local response=$("$CAT" "$file")

  if [ "$http" = "$expected" ]; then
    echo "PASS | $name | HTTP $http"
    PASS=$((PASS + 1))
  else
    echo "FAIL | $name | HTTP $http expected $expected"
    echo "     $response"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local name="$1"
  local file="$2"
  local expected="$3"

  TOTAL=$((TOTAL + 1))

  if /usr/bin/grep -Fq "$expected" "$file"; then
    echo "PASS | $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL | $name"
    echo "     Expected: $expected"
    echo "     Actual:"
    "$CAT" "$file"
    FAIL=$((FAIL + 1))
  fi
}

print_header "TAXICONNECT LOCAL E2E REGRESSION"

echo "API: $BASE_URL"
echo "Database: LOCAL D1"
echo

print_header "1. HEALTH"

assert_http \
  "API health" \
  "200" \
  "GET" \
  "/api/health" \
  "" \
  ""

print_header "2. ROUTE JOURNEY VALIDATION"

assert_http \
  "Missing origin" \
  "400" \
  "POST" \
  "/api/passenger/waiting" \
  "$PASSENGER_RANK" \
  '{
    "routeId": "route_mabeskraal_rustenburg",
    "destinationPointId": "pickup_rustenburg_rank_rust",
    "requestMode": "RANK",
    "pickupPointId": "pickup_mabeskraal_rank_rust",
    "groupSize": 1
  }'

assert_http \
  "Missing destination" \
  "400" \
  "POST" \
  "/api/passenger/waiting" \
  "$PASSENGER_RANK" \
  '{
    "routeId": "route_mabeskraal_rustenburg",
    "originPointId": "pickup_mabeskraal_rank_rust",
    "requestMode": "RANK",
    "pickupPointId": "pickup_mabeskraal_rank_rust",
    "groupSize": 1
  }'

assert_http \
  "Same origin and destination" \
  "400" \
  "POST" \
  "/api/passenger/waiting" \
  "$PASSENGER_RANK" \
  '{
    "routeId": "route_mabeskraal_rustenburg",
    "originPointId": "pickup_mabeskraal_rank_rust",
    "destinationPointId": "pickup_mabeskraal_rank_rust",
    "requestMode": "RANK",
    "pickupPointId": "pickup_mabeskraal_rank_rust",
    "groupSize": 1
  }'

assert_http \
  "Cross-route origin" \
  "400" \
  "POST" \
  "/api/passenger/waiting" \
  "$PASSENGER_RANK" \
  '{
    "routeId": "route_mabeskraal_rustenburg",
    "originPointId": "pickup_sun_village",
    "destinationPointId": "pickup_rustenburg_rank_rust",
    "requestMode": "RANK",
    "pickupPointId": "pickup_rustenburg_rank_rust",
    "groupSize": 1
  }'

assert_http \
  "Cross-route destination" \
  "400" \
  "POST" \
  "/api/passenger/waiting" \
  "$PASSENGER_RANK" \
  '{
    "routeId": "route_mabeskraal_rustenburg",
    "originPointId": "pickup_mabeskraal_rank_rust",
    "destinationPointId": "pickup_sun_village",
    "requestMode": "RANK",
    "pickupPointId": "pickup_mabeskraal_rank_rust",
    "groupSize": 1
  }'

assert_http \
  "Cross-route pickup" \
  "400" \
  "POST" \
  "/api/passenger/waiting" \
  "$PASSENGER_RANK" \
  '{
    "routeId": "route_mabeskraal_rustenburg",
    "originPointId": "pickup_mabeskraal_rank_rust",
    "destinationPointId": "pickup_rustenburg_rank_rust",
    "requestMode": "RANK",
    "pickupPointId": "pickup_sun_village",
    "groupSize": 1
  }'

print_header "3. DEMAND JOURNEY VALIDATION"

assert_http \
  "Reverse demand" \
  "200" \
  "POST" \
  "/api/passenger/demand" \
  "$PASSENGER_DEMAND" \
  '{
    "routeId": "route_mabeskraal_rustenburg",
    "originPointId": "pickup_rustenburg_rank_rust",
    "destinationPointId": "pickup_mabeskraal_rank_rust",
    "requestMode": "RANK",
    "pickupPointId": "pickup_rustenburg_rank_rust",
    "groupSize": 1
  }'

assert_http \
  "Same-point demand rejected" \
  "400" \
  "POST" \
  "/api/passenger/demand" \
  "$PASSENGER_DEMAND" \
  '{
    "routeId": "route_mabeskraal_rustenburg",
    "originPointId": "pickup_rustenburg_rank_rust",
    "destinationPointId": "pickup_rustenburg_rank_rust",
    "requestMode": "RANK",
    "pickupPointId": "pickup_rustenburg_rank_rust",
    "groupSize": 1
  }'

assert_http \
  "Missing origin demand" \
  "400" \
  "POST" \
  "/api/passenger/demand" \
  "$PASSENGER_DEMAND" \
  '{
    "routeId": "route_mabeskraal_rustenburg",
    "destinationPointId": "pickup_mabeskraal_rank_rust",
    "requestMode": "RANK",
    "pickupPointId": "pickup_rustenburg_rank_rust",
    "groupSize": 1
  }'

assert_http \
  "Missing destination demand" \
  "400" \
  "POST" \
  "/api/passenger/demand" \
  "$PASSENGER_DEMAND" \
  '{
    "routeId": "route_mabeskraal_rustenburg",
    "originPointId": "pickup_rustenburg_rank_rust",
    "requestMode": "RANK",
    "pickupPointId": "pickup_rustenburg_rank_rust",
    "groupSize": 1
  }'

assert_http \
  "Cross-route origin demand" \
  "400" \
  "POST" \
  "/api/passenger/demand" \
  "$PASSENGER_DEMAND" \
  '{
    "routeId": "route_mabeskraal_rustenburg",
    "originPointId": "pickup_sun_village",
    "destinationPointId": "pickup_rustenburg_rank_rust",
    "requestMode": "RANK",
    "pickupPointId": "pickup_rustenburg_rank_rust",
    "groupSize": 1
  }'

assert_http \
  "Cross-route destination demand" \
  "400" \
  "POST" \
  "/api/passenger/demand" \
  "$PASSENGER_DEMAND" \
  '{
    "routeId": "route_mabeskraal_rustenburg",
    "originPointId": "pickup_rustenburg_rank_rust",
    "destinationPointId": "pickup_sun_village",
    "requestMode": "RANK",
    "pickupPointId": "pickup_rustenburg_rank_rust",
    "groupSize": 1
  }'

assert_http \
  "Cross-route pickup demand" \
  "400" \
  "POST" \
  "/api/passenger/demand" \
  "$PASSENGER_DEMAND" \
  '{
    "routeId": "route_mabeskraal_rustenburg",
    "originPointId": "pickup_rustenburg_rank_rust",
    "destinationPointId": "pickup_mabeskraal_rank_rust",
    "requestMode": "RANK",
    "pickupPointId": "pickup_sun_village",
    "groupSize": 1
  }'

print_header "4. DATABASE INTEGRITY"

DB_OUTPUT="$TMP_DIR/database.txt"

(
  cd "$(dirname "$0")/.."
  npx wrangler d1 execute taxiconnect --local --command \
  "SELECT id, route_id, origin_point_id, destination_point_id, pickup_point_id, group_size, request_mode, status FROM demand_signals WHERE passenger_id = 'e2e-passenger-rust-demand' ORDER BY created_at ASC;"
) > "$DB_OUTPUT" 2>&1

if [ $? -eq 0 ]; then
  echo "PASS | Local D1 query"
  PASS=$((PASS + 1))
else
  echo "FAIL | Local D1 query"
  "$CAT" "$DB_OUTPUT"
  FAIL=$((FAIL + 1))
fi

TOTAL=$((TOTAL + 1))

assert_contains \
  "Forward journey persisted" \
  "$DB_OUTPUT" \
  "pickup_mabeskraal_rank_rust"

assert_contains \
  "Reverse journey persisted" \
  "$DB_OUTPUT" \
  "pickup_rustenburg_rank_rust"


print_header "5. DEMAND IDEMPOTENCY"

IDEMPOTENCY_PAYLOAD='{
  "routeId": "route_mabeskraal_rustenburg",
  "originPointId": "pickup_rustenburg_rank_rust",
  "destinationPointId": "pickup_mabeskraal_rank_rust",
  "requestMode": "RANK",
  "pickupPointId": "pickup_rustenburg_rank_rust",
  "groupSize": 1
}'

IDEMPOTENCY_FIRST=$("$CURL" -sS \
  -X POST \
  "$BASE_URL/api/passenger/demand" \
  -H "Content-Type: application/json" \
  -H "X-Passenger-Id: e2e-passenger-rust-demand" \
  -d "$IDEMPOTENCY_PAYLOAD")

IDEMPOTENCY_SECOND=$("$CURL" -sS \
  -X POST \
  "$BASE_URL/api/passenger/demand" \
  -H "Content-Type: application/json" \
  -H "X-Passenger-Id: e2e-passenger-rust-demand" \
  -d "$IDEMPOTENCY_PAYLOAD")

FIRST_ID=$(
  printf '%s' "$IDEMPOTENCY_FIRST" |
  /opt/homebrew/bin/python3 -c '
import sys,json
try:
    print(json.load(sys.stdin)["signal"]["id"])
except Exception:
    print("")
'
)

SECOND_ID=$(
  printf '%s' "$IDEMPOTENCY_SECOND" |
  /opt/homebrew/bin/python3 -c '
import sys,json
try:
    print(json.load(sys.stdin)["signal"]["id"])
except Exception:
    print("")
'
)

SECOND_DUPLICATE=$(
  printf '%s' "$IDEMPOTENCY_SECOND" |
  /opt/homebrew/bin/python3 -c '
import sys,json
try:
    print(str(json.load(sys.stdin).get("duplicate", False)).lower())
except Exception:
    print("false")
'
)

if [ -n "$FIRST_ID" ] && [ "$FIRST_ID" = "$SECOND_ID" ]; then
  echo "PASS | Duplicate demand returns same ID"
  PASS=$((PASS + 1))
else
  echo "FAIL | Duplicate demand returns same ID"
  echo "  First ID:  $FIRST_ID"
  echo "  Second ID: $SECOND_ID"
  FAIL=$((FAIL + 1))
fi
TOTAL=$((TOTAL + 1))

if [ "$SECOND_DUPLICATE" = "true" ]; then
  echo "PASS | Duplicate demand flagged"
  PASS=$((PASS + 1))
else
  echo "FAIL | Duplicate demand flagged"
  echo "  Expected: true"
  echo "  Actual:   $SECOND_DUPLICATE"
  FAIL=$((FAIL + 1))
fi
TOTAL=$((TOTAL + 1))

DB_IDEMPOTENCY_OUTPUT="$TMP_DIR/demand-idempotency.txt"

(
  cd "$(dirname "$0")/.."
  npx wrangler d1 execute taxiconnect --local --command \
  "SELECT COUNT(*) AS active_count FROM demand_signals WHERE passenger_id = 'e2e-passenger-rust-demand' AND route_id = 'route_mabeskraal_rustenburg' AND origin_point_id = 'pickup_rustenburg_rank_rust' AND destination_point_id = 'pickup_mabeskraal_rank_rust' AND signal_type = 'DEMAND' AND status = 'ACTIVE';"
) > "$DB_IDEMPOTENCY_OUTPUT" 2>&1

if [ $? -eq 0 ]; then
  DB_ACTIVE_COUNT=$(
    /opt/homebrew/bin/python3 - "$DB_IDEMPOTENCY_OUTPUT" <<'PYTHON'
import json
import re
import sys

text = open(sys.argv[1], encoding="utf-8").read()

try:
    data = json.loads(text[text.find("["):])
    print(data[0]["results"][0]["active_count"])
except Exception:
    match = re.search(r'"active_count"\s*:\s*(\d+)', text)
    print(match.group(1) if match else "")
PYTHON
  )

  if [ "$DB_ACTIVE_COUNT" = "1" ]; then
    echo "PASS | Only one active duplicate demand exists"
    PASS=$((PASS + 1))
  else
    echo "FAIL | Only one active duplicate demand exists"
    echo "  Expected: 1"
    echo "  Actual:   $DB_ACTIVE_COUNT"
    "$CAT" "$DB_IDEMPOTENCY_OUTPUT"
    FAIL=$((FAIL + 1))
  fi
else
  echo "FAIL | Demand idempotency D1 query"
  "$CAT" "$DB_IDEMPOTENCY_OUTPUT"
  FAIL=$((FAIL + 1))
fi
TOTAL=$((TOTAL + 1))

print_header "FINAL RESULT"

echo
echo "TOTAL: $TOTAL"
echo "PASS:  $PASS"
echo "FAIL:  $FAIL"
echo

if [ "$FAIL" -eq 0 ]; then
  echo "STATUS: ALL CURRENT E2E TESTS PASSED"
else
  echo "STATUS: FAILURES DETECTED"
fi

echo
echo "Note: this runner currently tests the completed local journey/demand functionality."
echo "Additional suites will be added for passenger COLLECTION, driver, conductor,"
echo "operator, realtime, security, and full regression coverage."

exit "$FAIL"
