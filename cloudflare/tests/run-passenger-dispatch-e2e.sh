#!/bin/zsh

setopt NO_BANG_HIST

BASE="${BASE:-http://localhost:8787}"
ROUTE_ID="route_mabeskraal_rustenburg"
COLLECTION_ROUTE_ID="route_mabeskraal_sun_village"

ORIGIN_ID="pickup_mabeskraal_rank_rust"
DESTINATION_ID="pickup_rustenburg_rank_rust"

COLLECTION_ORIGIN_ID="pickup_mabeskraal_rank_sun"
COLLECTION_PICKUP_ID="pickup_mabeskraal_clinic"
COLLECTION_DESTINATION_ID="pickup_sun_village"

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0

PASSENGER_ID="passenger_dispatch_e2e_$(date +%s)"
PASSENGER_ID_2="${PASSENGER_ID}_2"
PASSENGER_ID_3="${PASSENGER_ID}_3"

echo ""
echo "=============================================="
echo "TaxiConnect Passenger / Dispatch E2E"
echo "=============================================="
echo "BASE: $BASE"
echo ""

if ! curl -sS --fail "$BASE/api/health" >/dev/null 2>&1; then
  echo "FAIL  Local Worker is not reachable at $BASE"
  exit 1
fi

echo "Local Worker: reachable"
echo ""

assert_ok() {
  local name="$1"
  local response_body="$2"

  TOTAL_COUNT=$((TOTAL_COUNT + 1))

  if python3 -c '
import sys
import json

try:
    data = json.loads(sys.argv[1])
    raise SystemExit(0 if data.get("ok") is True else 1)
except Exception:
    raise SystemExit(1)
' "$response_body"; then
    echo "PASS  $name"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "FAIL  $name"
    echo "$response_body" | python3 -m json.tool 2>/dev/null || echo "$response_body"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

assert_http_status() {
  local name="$1"
  local expected="$2"
  local response="$3"

  TOTAL_COUNT=$((TOTAL_COUNT + 1))

  local http_status
  http_status="$(echo "$response" | tail -n 1)"

  local response_body
  response_body="$(echo "$response" | sed '$d')"

  if [ "$http_status" = "$expected" ]; then
    echo "PASS  $name"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "FAIL  $name"
    echo "Expected HTTP $expected, got HTTP $http_status"
    echo "$response_body" | python3 -m json.tool 2>/dev/null || echo "$response_body"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

json_value() {
  local key="$1"
  python3 -c "
import sys,json
data=json.load(sys.stdin)
value=data
for part in '$key'.split('.'):
    if isinstance(value,dict):
        value=value.get(part)
    else:
        value=None
        break
print('' if value is None else value)
"
}

echo "===== ROUTE DISCOVERY ====="

ROUTES="$(curl -sS "$BASE/api/routes")"

if echo "$ROUTES" | python3 -c '
import sys,json
d=json.load(sys.stdin)
routes=d.get("routes", d if isinstance(d,list) else [])
sys.exit(0 if any(r.get("id")=="route_mabeskraal_rustenburg" for r in routes) else 1)
'; then
  echo "PASS  Route discovery"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "FAIL  Route discovery"
  echo "$ROUTES" | python3 -m json.tool 2>/dev/null || echo "$ROUTES"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
TOTAL_COUNT=$((TOTAL_COUNT + 1))

echo ""
echo "===== PASSENGER RANK WAITING ====="

WAITING_RANK="$(
  curl -sS \
    -X POST \
    "$BASE/api/passenger/waiting" \
    -H "Content-Type: application/json" \
    -H "X-Passenger-Id: $PASSENGER_ID" \
    -d "{
      \"routeId\":\"$ROUTE_ID\",
      \"originPointId\":\"$ORIGIN_ID\",
      \"destinationPointId\":\"$DESTINATION_ID\",
      \"pickupPointId\":\"$ORIGIN_ID\",
      \"requestMode\":\"RANK\",
      \"passengerCount\":1
    }"
)"

assert_ok "Passenger RANK waiting" "$WAITING_RANK"

WAITING_ID="$(
  echo "$WAITING_RANK" |
  python3 -c 'import sys,json; print(json.load(sys.stdin).get("waiting",{}).get("id",""))'
)"

echo "Waiting ID: $WAITING_ID"

echo ""
echo "===== PASSENGER ALONG_ROUTE ====="

WAITING_ALONG="$(
  curl -sS \
    -X POST \
    "$BASE/api/passenger/waiting" \
    -H "Content-Type: application/json" \
    -H "X-Passenger-Id: $PASSENGER_ID_2" \
    -d "{
      \"routeId\":\"$ROUTE_ID\",
      \"originPointId\":\"$ORIGIN_ID\",
      \"destinationPointId\":\"$DESTINATION_ID\",
      \"pickupPointId\":\"pickup_mabeskraal_rank_rust\",
      \"requestMode\":\"ALONG_ROUTE\",
      \"passengerCount\":2
    }"
)"

assert_ok "Passenger ALONG_ROUTE waiting" "$WAITING_ALONG"

echo ""
echo "===== PASSENGER FREE-TEXT / GPS ====="

WAITING_FREE_TEXT="$(
  curl -sS \
    -X POST \
    "$BASE/api/passenger/waiting" \
    -H "Content-Type: application/json" \
    -H "X-Passenger-Id: $PASSENGER_ID_3" \
    -d "{
      \"routeId\":\"$COLLECTION_ROUTE_ID\",
      \"originPointId\":\"$COLLECTION_ORIGIN_ID\",
      \"destinationPointId\":\"$COLLECTION_DESTINATION_ID\",
      \"pickupPointId\":\"$COLLECTION_PICKUP_ID\",
      \"requestMode\":\"COLLECTION\",
      \"passengerCount\":1,
      \"latitude\":-25.7001,
      \"longitude\":27.9001,
      \"pickupDescription\":\"Near Mabeskraal Clinic\"
    }"
)"

assert_ok "Passenger COLLECTION GPS/free-text waiting" "$WAITING_FREE_TEXT"

echo ""
echo "===== DUPLICATE WAITING ====="

DUPLICATE_RANK="$(
  curl -sS \
    -X POST \
    "$BASE/api/passenger/waiting" \
    -H "Content-Type: application/json" \
    -H "X-Passenger-Id: $PASSENGER_ID" \
    -d "{
      \"routeId\":\"$ROUTE_ID\",
      \"originPointId\":\"$ORIGIN_ID\",
      \"destinationPointId\":\"$DESTINATION_ID\",
      \"pickupPointId\":\"$ORIGIN_ID\",
      \"requestMode\":\"RANK\",
      \"passengerCount\":1
    }"
)"

assert_ok "Duplicate waiting protection" "$DUPLICATE_RANK"

DUPLICATE_WAITING_ID="$(
  echo "$DUPLICATE_RANK" |
  python3 -c 'import sys,json; print(json.load(sys.stdin).get("waiting",{}).get("id",""))'
)"

TOTAL_COUNT=$((TOTAL_COUNT + 1))

if [ "$DUPLICATE_WAITING_ID" = "$WAITING_ID" ]; then
  echo "PASS  Duplicate returns existing waiting request"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "FAIL  Duplicate returns existing waiting request"
  echo "Expected: $WAITING_ID"
  echo "Actual:   $DUPLICATE_WAITING_ID"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo ""
echo "===== JOURNEY VALIDATION ====="

BAD_SAME="$(
  curl -sS \
    -w '\n%{http_code}' \
    -X POST \
    "$BASE/api/passenger/waiting" \
    -H "Content-Type: application/json" \
    -H "X-Passenger-Id: ${PASSENGER_ID}_bad_same" \
    -d "{
      \"routeId\":\"$ROUTE_ID\",
      \"originPointId\":\"$ORIGIN_ID\",
      \"destinationPointId\":\"$ORIGIN_ID\",
      \"pickupPointId\":\"$ORIGIN_ID\",
      \"requestMode\":\"RANK\",
      \"passengerCount\":1
    }"
)"

assert_http_status "Reject same origin/destination" "400" "$BAD_SAME"

BAD_ORIGIN="$(
  curl -sS \
    -w '\n%{http_code}' \
    -X POST \
    "$BASE/api/passenger/waiting" \
    -H "Content-Type: application/json" \
    -H "X-Passenger-Id: ${PASSENGER_ID}_bad_origin" \
    -d "{
      \"routeId\":\"$ROUTE_ID\",
      \"destinationPointId\":\"$DESTINATION_ID\",
      \"pickupPointId\":\"$ORIGIN_ID\",
      \"requestMode\":\"RANK\",
      \"passengerCount\":1
    }"
)"

assert_http_status "Reject missing origin" "400" "$BAD_ORIGIN"

BAD_DESTINATION="$(
  curl -sS \
    -w '\n%{http_code}' \
    -X POST \
    "$BASE/api/passenger/waiting" \
    -H "Content-Type: application/json" \
    -H "X-Passenger-Id: ${PASSENGER_ID}_bad_destination" \
    -d "{
      \"routeId\":\"$ROUTE_ID\",
      \"originPointId\":\"$ORIGIN_ID\",
      \"pickupPointId\":\"$ORIGIN_ID\",
      \"requestMode\":\"RANK\",
      \"passengerCount\":1
    }"
)"

assert_http_status "Reject missing destination" "400" "$BAD_DESTINATION"

echo ""
echo "===== DEMAND ====="

DEMAND="$(
  curl -sS \
    -X POST \
    "$BASE/api/passenger/demand" \
    -H "Content-Type: application/json" \
    -H "X-Passenger-Id: ${PASSENGER_ID}_demand" \
    -d "{
      \"routeId\":\"$ROUTE_ID\",
      \"originPointId\":\"$ORIGIN_ID\",
      \"destinationPointId\":\"$DESTINATION_ID\",
      \"pickupPointId\":\"$ORIGIN_ID\",
      \"requestMode\":\"ALONG_ROUTE\",
      \"pickupDescription\":\"Near Mabeskraal taxi rank\"
    }"
)"

assert_ok "Passenger demand" "$DEMAND"

DEMAND_ID="$(
  echo "$DEMAND" |
  python3 -c 'import sys,json; print(json.load(sys.stdin).get("demand",{}).get("id",""))'
)"

DUPLICATE_DEMAND="$(
  curl -sS \
    -X POST \
    "$BASE/api/passenger/demand" \
    -H "Content-Type: application/json" \
    -H "X-Passenger-Id: ${PASSENGER_ID}_demand" \
    -d "{
      \"routeId\":\"$ROUTE_ID\",
      \"originPointId\":\"$ORIGIN_ID\",
      \"destinationPointId\":\"$DESTINATION_ID\",
      \"pickupPointId\":\"$ORIGIN_ID\",
      \"requestMode\":\"ALONG_ROUTE\",
      \"pickupDescription\":\"Near Mabeskraal taxi rank\"
    }"
)"

assert_ok "Duplicate demand protection" "$DUPLICATE_DEMAND"

DUPLICATE_DEMAND_ID="$(
  echo "$DUPLICATE_DEMAND" |
  python3 -c 'import sys,json; print(json.load(sys.stdin).get("demand",{}).get("id",""))'
)"

TOTAL_COUNT=$((TOTAL_COUNT + 1))

if [ "$DEMAND_ID" = "$DUPLICATE_DEMAND_ID" ]; then
  echo "PASS  Duplicate demand returns existing signal"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "FAIL  Duplicate demand returns existing signal"
  echo "Expected: $DEMAND_ID"
  echo "Actual:   $DUPLICATE_DEMAND_ID"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo ""
echo "===== CONDUCTOR AUTHENTICATION ====="

CONDUCTOR_PIN="$(grep '^CONDUCTOR_PIN=' .dev.vars | cut -d= -f2-)"

CONDUCTOR_LOGIN="$(
  curl -sS \
    -X POST \
    "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{
      \"role\":\"conductor\",
      \"name\":\"E2E Conductor\",
      \"pin\":\"$CONDUCTOR_PIN\"
    }"
)"

unset CONDUCTOR_PIN

CONDUCTOR_TOKEN="$(
  echo "$CONDUCTOR_LOGIN" |
  python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))'
)"

TOTAL_COUNT=$((TOTAL_COUNT + 1))

if [ -n "$CONDUCTOR_TOKEN" ]; then
  echo "PASS  Conductor authentication"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "FAIL  Conductor authentication"
  echo "$CONDUCTOR_LOGIN" | python3 -m json.tool 2>/dev/null || echo "$CONDUCTOR_LOGIN"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo ""
echo "===== CONDUCTOR WAITING VISIBILITY ====="

CONDUCTOR_DEMAND="$(
  curl -sS \
    "$BASE/api/conductor/demand?operatorId=operator_mabeskraal&routeId=$ROUTE_ID" \
    -H "Authorization: Bearer $CONDUCTOR_TOKEN"
)"

TOTAL_COUNT=$((TOTAL_COUNT + 1))

if echo "$CONDUCTOR_DEMAND" | python3 -c '
import sys,json
d=json.load(sys.stdin)
if d.get("ok") is not True:
    sys.exit(1)
if "waiting" not in d and "passengers" not in d:
    sys.exit(1)
'; then
  echo "PASS  Conductor waiting visibility"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "FAIL  Conductor waiting visibility"
  echo "$CONDUCTOR_DEMAND" | python3 -m json.tool 2>/dev/null || echo "$CONDUCTOR_DEMAND"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo ""
echo "===== CONDUCTOR STATS ====="

CONDUCTOR_STATS="$(
  curl -sS \
    "$BASE/api/conductor/stats?operatorId=operator_mabeskraal&routeId=$ROUTE_ID" \
    -H "Authorization: Bearer $CONDUCTOR_TOKEN"
)"

assert_ok "Conductor stats" "$CONDUCTOR_STATS"

echo ""
echo "===== CANCEL WAITING ====="

if [ -n "$WAITING_ID" ]; then
  CANCEL="$(
    curl -sS \
      -X POST \
      "$BASE/api/passenger/cancel-waiting" \
      -H "Content-Type: application/json" \
      -H "X-Passenger-Id: $PASSENGER_ID" \
      -d "{
        \"waitingId\":\"$WAITING_ID\"
      }"
  )"

  assert_ok "Passenger cancellation" "$CANCEL"
else
  echo "SKIP  Passenger cancellation (waiting ID unavailable)"
fi

echo ""
echo "===== DATABASE INTEGRITY ====="

DB_RESULT="$(
  npx wrangler d1 execute taxiconnect --local --json --command "
SELECT
  (SELECT COUNT(*) FROM route_waiting_passengers
    WHERE passenger_id LIKE '${PASSENGER_ID}%') AS waiting_records,
  (SELECT COUNT(*) FROM demand_signals
    WHERE passenger_id LIKE '${PASSENGER_ID}_demand') AS demand_records,
  (SELECT COUNT(*) FROM route_waiting_passengers
    WHERE passenger_id = '${PASSENGER_ID}'
    AND status = 'CANCELLED') AS cancelled_records;
"
)"

echo "$DB_RESULT"

TOTAL_COUNT=$((TOTAL_COUNT + 1))

if echo "$DB_RESULT" | python3 -c '
import sys
import json

try:
    data = json.load(sys.stdin)

    rows = []

    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                results = item.get("results")
                if isinstance(results, list):
                    rows.extend(results)

    if not rows:
        raise SystemExit(1)

    row = rows[0]

    waiting = int(row.get("waiting_records", 0))
    demand = int(row.get("demand_records", 0))
    cancelled = int(row.get("cancelled_records", 0))

    if waiting >= 3 and demand >= 1 and cancelled >= 1:
        raise SystemExit(0)

    raise SystemExit(1)

except Exception:
    raise SystemExit(1)
'; then
  echo "PASS  Passenger/dispatch D1 persistence"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "FAIL  Passenger/dispatch D1 persistence"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

echo ""
echo "=============================================="
echo "Passenger / Dispatch E2E Results"
echo "=============================================="
echo "TOTAL: $TOTAL_COUNT"
echo "PASS:  $PASS_COUNT"
echo "FAIL:  $FAIL_COUNT"
echo "=============================================="

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "STATUS: ALL PASSENGER/DISPATCH E2E TESTS PASSED"
  exit 0
else
  echo "STATUS: PASSENGER/DISPATCH E2E TESTS HAVE FAILURES"
  exit 1
fi
