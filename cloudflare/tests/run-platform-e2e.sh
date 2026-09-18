#!/bin/zsh
set -euo pipefail
BASE="${BASE:-http://127.0.0.1:8787}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
TOTAL=0
SERVER_PID=""

ok(){
  TOTAL=$((TOTAL+1)); PASS=$((PASS+1)); echo "PASS | $1"
}
bad(){
  TOTAL=$((TOTAL+1)); FAIL=$((FAIL+1)); echo "FAIL | $1"; echo "$2"
}
expect_http(){
  local name="$1" expected="$2" body="$3"
  local status="$(printf '%s' "$body" | tail -n1)"
  local json="$(printf '%s' "$body" | sed '$d')"
  if [[ "$status" == "$expected" ]]; then ok "$name"; else bad "$name" "expected HTTP $expected got $status: $json"; fi
}
json(){
  python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps(d,separators=(",",":")))'
}
value(){
  local key="$1"
  python3 - "$key" <<'PY'
import json,sys
key=sys.argv[1]
try:
    d=json.load(sys.stdin)
    for p in key.split('.'):
        d=d.get(p) if isinstance(d,dict) else None
    print("" if d is None else d)
except Exception:
    print("")
PY
}

cleanup(){
  if [[ -n "$SERVER_PID" ]]; then kill "$SERVER_PID" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

rm -rf .wrangler/state

cat > .dev.vars <<'VARS'
DRIVER_PIN=1111
CONDUCTOR_PIN=2222
OPERATOR_ADMIN_PIN=3333
SUPERADMIN_PIN=4444
SESSION_SECRET=e2e-session-secret-change-me
VARS
chmod 600 .dev.vars

npx wrangler d1 migrations apply taxiconnect --local >/tmp/taxiconnect-migrate.log 2>&1 || {
  cat /tmp/taxiconnect-migrate.log
  exit 1
}

npx wrangler d1 execute taxiconnect --local --command "
INSERT INTO users (id,name,role,system_role,active,phone,created_at,last_seen_at)
VALUES
('e2e-superadmin','E2E Super Admin','passenger','superadmin',1,'+27000000001',1,1),
('e2e-operator-admin','E2E Operator Admin','passenger','operator_admin',1,'+27000000002',1,1),
('e2e-driver','E2E Driver','driver',NULL,1,'+27000000003',1,1),
('e2e-conductor','E2E Conductor','conductor',NULL,1,'+27000000004',1,1);

INSERT INTO operators (id,name,registration_number,active,created_at,updated_at)
VALUES ('e2e-operator','E2E Taxi Association','E2E-OP-001',1,1,1);

INSERT INTO routes (id,origin,destination,name,service_mode,active,created_at,updated_at)
VALUES ('e2e-route','Mabeskraal','Rustenburg','Mabeskraal → Rustenburg','RANK_DEPARTURE',1,1,1);

INSERT INTO route_pickup_points
(id,route_id,name,point_type,sequence,active,created_at,updated_at)
VALUES
('e2e-origin','e2e-route','Mabeskraal Rank','RANK',0,1,1,1),
('e2e-destination','e2e-route','Rustenburg Rank','RANK',1,1,1,1);

INSERT INTO operator_routes
(id,operator_id,route_id,active,authorized_at)
VALUES ('e2e-op-route','e2e-operator','e2e-route',1,1);

INSERT INTO operator_memberships
(id,operator_id,user_id,membership_role,active,created_at,updated_at)
VALUES
('e2e-membership-admin','e2e-operator','e2e-operator-admin','operator_admin',1,1,1),
('e2e-membership-driver','e2e-operator','e2e-driver','driver',1,1,1),
('e2e-membership-conductor','e2e-operator','e2e-conductor','conductor',1,1,1);

INSERT INTO taxis
(id,driver_id,driver_name,capacity,passengers_onboard,status,created_at,last_updated,operator_id,vehicle_registration_number,active)
VALUES ('e2e-taxi','e2e-driver','E2E Driver',15,0,'OFFLINE',1,1,'e2e-operator','E2E-001',1);

INSERT INTO taxi_routes
(id,taxi_id,route_id,active,authorized_at)
VALUES ('e2e-taxi-route','e2e-taxi','e2e-route',1,1);

INSERT INTO taxi_driver_assignments
(id,taxi_id,driver_id,active,assigned_at)
VALUES ('e2e-assignment','e2e-taxi','e2e-driver',1,1);
" >/tmp/taxiconnect-seed.log 2>&1 || {
  cat /tmp/taxiconnect-seed.log
  exit 1
}

npx wrangler dev --local --port 8787 >/tmp/taxiconnect-worker.log 2>&1 &
SERVER_PID=$!

for i in {1..30}; do
  if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done

if ! curl -fsS "$BASE/api/health" >/dev/null 2>&1; then
  cat /tmp/taxiconnect-worker.log
  exit 1
fi

login(){
  local role="$1" name="$2" pin="$3"
  curl -sS -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json'     -d "{\"role\":\"$role\",\"name\":\"$name\",\"pin\":\"$pin\"}"
}

echo "=== AUTHENTICATION ==="
SA="$(login superadmin 'E2E Super Admin' 4444)"
SA_TOKEN="$(printf '%s' "$SA" | value token)"
[[ -n "$SA_TOKEN" ]] && ok "Super Admin login" || bad "Super Admin login" "$SA"
OA="$(login operator_admin 'E2E Operator Admin' 3333)"
OA_TOKEN="$(printf '%s' "$OA" | value token)"
[[ -n "$OA_TOKEN" ]] && ok "Operator Admin login" || bad "Operator Admin login" "$OA"
DR="$(login driver 'E2E Driver' 1111)"
DR_TOKEN="$(printf '%s' "$DR" | value token)"
[[ -n "$DR_TOKEN" ]] && ok "Driver login" || bad "Driver login" "$DR"
CO="$(login conductor 'E2E Conductor' 2222)"
CO_TOKEN="$(printf '%s' "$CO" | value token)"
[[ -n "$CO_TOKEN" ]] && ok "Conductor login" || bad "Conductor login" "$CO"

echo "=== PUBLIC / PASSENGER ==="
R="$(curl -sS "$BASE/api/routes")"
printf '%s' "$R" | grep -q 'e2e-route' && ok "Public route discovery" || bad "Public route discovery" "$R"
PWAIT="$(curl -sS -X POST "$BASE/api/passenger/waiting" -H 'Content-Type: application/json' -H 'X-Passenger-Id: e2e-passenger' -d '{"routeId":"e2e-route","originPointId":"e2e-origin","destinationPointId":"e2e-destination","pickupPointId":"e2e-origin","requestMode":"RANK","passengerCount":2}')"
printf '%s' "$PWAIT" | grep -q '"ok":true' && ok "Passenger RANK waiting" || bad "Passenger RANK waiting" "$PWAIT"
PDUP="$(curl -sS -X POST "$BASE/api/passenger/waiting" -H 'Content-Type: application/json' -H 'X-Passenger-Id: e2e-passenger' -d '{"routeId":"e2e-route","originPointId":"e2e-origin","destinationPointId":"e2e-destination","pickupPointId":"e2e-origin","requestMode":"RANK","passengerCount":2}')"
printf '%s' "$PDUP" | grep -q '"duplicate":true' && ok "Passenger duplicate waiting idempotency" || bad "Passenger duplicate waiting idempotency" "$PDUP"
BAD="$(curl -sS -w '\n%{http_code}' -X POST "$BASE/api/passenger/waiting" -H 'Content-Type: application/json' -H 'X-Passenger-Id: e2e-bad' -d '{"routeId":"e2e-route","originPointId":"e2e-origin","destinationPointId":"e2e-origin","pickupPointId":"e2e-origin","requestMode":"RANK","passengerCount":1}')"
expect_http "Reject same journey endpoints" 400 "$BAD"
DEMAND="$(curl -sS -X POST "$BASE/api/passenger/demand" -H 'Content-Type: application/json' -H 'X-Passenger-Id: e2e-demand' -d '{"routeId":"e2e-route","originPointId":"e2e-origin","destinationPointId":"e2e-destination","pickupPointId":"e2e-origin","requestMode":"ALONG_ROUTE","groupSize":3}')"
printf '%s' "$DEMAND" | grep -q '"ok":true' && ok "Passenger route demand" || bad "Passenger route demand" "$DEMAND"

echo "=== CONDUCTOR / LINE ==="
CSESSION="$(curl -sS "$BASE/api/conductor/session" -H "Authorization: Bearer $CO_TOKEN")"
printf '%s' "$CSESSION" | grep -q '"authenticated":true' && ok "Conductor session" || bad "Conductor session" "$CSESSION"
OPEN="$(curl -sS -X POST "$BASE/api/conductor/line/open" -H "Authorization: Bearer $CO_TOKEN" -H 'Content-Type: application/json' -d '{"operatorId":"e2e-operator","routeId":"e2e-route"}')"
printf '%s' "$OPEN" | grep -q '"ok":true' && ok "Conductor opens daily line" || bad "Conductor opens daily line" "$OPEN"
LINE_ID="$(printf '%s' "$OPEN" | value line.id)"
ADD="$(curl -sS -X POST "$BASE/api/conductor/line/add" -H "Authorization: Bearer $CO_TOKEN" -H 'Content-Type: application/json' -d "{\"lineSessionId\":\"$LINE_ID\",\"taxiId\":\"e2e-taxi\"}")"
printf '%s' "$ADD" | grep -q '"ok":true' && ok "Conductor adds arriving taxi" || bad "Conductor adds arriving taxi" "$ADD"
SUMMON="$(curl -sS -X POST "$BASE/api/conductor/summon" -H "Authorization: Bearer $CO_TOKEN" -H 'Content-Type: application/json' -d '{"operatorId":"e2e-operator","routeId":"e2e-route","requestType":"ROUTE_DEMAND","passengerCount":3}')"
printf '%s' "$SUMMON" | grep -q '"ok":true' && ok "Conductor route summon" || bad "Conductor route summon" "$SUMMON"

echo "=== DRIVER ==="
LIVE="$(curl -sS -X POST "$BASE/api/driver/go-live" -H "Authorization: Bearer $DR_TOKEN" -H 'Content-Type: application/json' -d '{"taxiId":"e2e-taxi","routeId":"e2e-route","originPointId":"e2e-origin","destinationPointId":"e2e-destination","passengersOnboard":0}')"
printf '%s' "$LIVE" | grep -q '"ok":true' && ok "Driver goes live" || bad "Driver goes live" "$LIVE"
TRIP_ID="$(printf '%s' "$LIVE" | value trip.id)"
PAX="$(curl -sS -X POST "$BASE/api/driver/passengers" -H "Authorization: Bearer $DR_TOKEN" -H 'Content-Type: application/json' -d '{"taxiId":"e2e-taxi","passengersOnboard":15}')"
printf '%s' "$PAX" | grep -q '"ok":true' && ok "Driver reaches full capacity" || bad "Driver reaches full capacity" "$PAX"
DEP="$(curl -sS -X POST "$BASE/api/driver/status" -H "Authorization: Bearer $DR_TOKEN" -H 'Content-Type: application/json' -d '{"tripId":"'"$TRIP_ID"'","status":"DEPARTED"}')"
printf '%s' "$DEP" | grep -q '"ok":true' && ok "Driver departs" || bad "Driver departs" "$DEP"
ARR="$(curl -sS -X POST "$BASE/api/driver/status" -H "Authorization: Bearer $DR_TOKEN" -H 'Content-Type: application/json' -d '{"tripId":"'"$TRIP_ID"'","status":"ARRIVED"}')"
printf '%s' "$ARR" | grep -q '"ok":true' && ok "Driver arrives" || bad "Driver arrives" "$ARR"
INVALID="$(curl -sS -w '\n%{http_code}' -X POST "$BASE/api/driver/status" -H "Authorization: Bearer $DR_TOKEN" -H 'Content-Type: application/json' -d '{"tripId":"'"$TRIP_ID"'","status":"DEPARTED"}')"
expect_http "Reject terminal trip regression" 409 "$INVALID"

echo "=== ADMIN CONTROL PLANE ==="
SAD="$(curl -sS "$BASE/api/admin/superadmin/dashboard" -H "Authorization: Bearer $SA_TOKEN")"
printf '%s' "$SAD" | grep -q '"ok":true' && ok "Super Admin dashboard" || bad "Super Admin dashboard" "$SAD"
OPS="$(curl -sS "$BASE/api/admin/superadmin/operators" -H "Authorization: Bearer $SA_TOKEN")"
printf '%s' "$OPS" | grep -q 'e2e-operator' && ok "Super Admin operator oversight" || bad "Super Admin operator oversight" "$OPS"
RTS="$(curl -sS "$BASE/api/admin/superadmin/routes" -H "Authorization: Bearer $SA_TOKEN")"
printf '%s' "$RTS" | grep -q 'e2e-route' && ok "Super Admin route oversight" || bad "Super Admin route oversight" "$RTS"
OUS="$(curl -sS "$BASE/api/admin/operator/users?operatorId=e2e-operator" -H "Authorization: Bearer $OA_TOKEN")"
printf '%s' "$OUS" | grep -q 'e2e-driver' && ok "Operator Admin people oversight" || bad "Operator Admin people oversight" "$OUS"
FLT="$(curl -sS "$BASE/api/admin/operator/fleet?operatorId=e2e-operator" -H "Authorization: Bearer $OA_TOKEN")"
printf '%s' "$FLT" | grep -q 'E2E-001' && ok "Operator Admin fleet oversight" || bad "Operator Admin fleet oversight" "$FLT"
OPS2="$(curl -sS "$BASE/api/admin/operator/operations?operatorId=e2e-operator" -H "Authorization: Bearer $OA_TOKEN")"
printf '%s' "$OPS2" | grep -q '"ok":true' && ok "Operator Admin operations oversight" || bad "Operator Admin operations oversight" "$OPS2"
AUD="$(curl -sS "$BASE/api/admin/audit?operatorId=e2e-operator" -H "Authorization: Bearer $OA_TOKEN")"
printf '%s' "$AUD" | grep -q 'TAXI' && ok "Operator audit visibility" || bad "Operator audit visibility" "$AUD"

echo "=== SECURITY / SCOPE ==="
DENY1="$(curl -sS -w '\n%{http_code}' "$BASE/api/admin/superadmin/dashboard" -H "Authorization: Bearer $OA_TOKEN")"
expect_http "Operator Admin denied Super Admin dashboard" 403 "$DENY1"
DENY2="$(curl -sS -w '\n%{http_code}' "$BASE/api/admin/operator/fleet?operatorId=e2e-operator" -H "Authorization: Bearer $DR_TOKEN")"
expect_http "Driver denied Operator Admin fleet" 403 "$DENY2"
DENY3="$(curl -sS -w '\n%{http_code}' "$BASE/api/conductor/stats?operatorId=e2e-operator&routeId=e2e-route")"
expect_http "Unauthenticated conductor endpoint denied" 401 "$DENY3"

echo "=== INCIDENT PIPELINE ==="
BAD_ROUTE="$(curl -sS -w '\n%{http_code}' "$BASE/api/does-not-exist")"
expect_http "Unknown API path returns 404" 404 "$BAD_ROUTE"
INC="$(curl -sS "$BASE/api/admin/incidents" -H "Authorization: Bearer $SA_TOKEN")"
printf '%s' "$INC" | grep -q '"ok":true' && ok "Super Admin incident visibility" || bad "Super Admin incident visibility" "$INC"

echo "=== DATABASE INTEGRITY ==="
FK="$(npx wrangler d1 execute taxiconnect --local --command 'PRAGMA foreign_key_check;')"
printf '%s' "$FK" | grep -q 'foreign_key_check' && ok "D1 foreign key integrity query" || bad "D1 foreign key integrity query" "$FK"

echo
echo "TOTAL: $TOTAL"
echo "PASS:  $PASS"
echo "FAIL:  $FAIL"
[[ "$FAIL" -eq 0 ]]
