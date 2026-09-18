#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
PIN="${E2E_PIN:-111111}"
PASS=0; FAIL=0; TOTAL=0
TMP="/tmp/taxiconnect-platform-e2e"; mkdir -p "$TMP"

check(){ local name="$1" expected="$2" method="$3" path="$4" token="${5:-}" body="${6:-}";
 TOTAL=$((TOTAL+1)); local f="$TMP/$TOTAL.json"; local code;
 if [[ "$method" == GET ]]; then code=$(curl -sS -o "$f" -w '%{http_code}' -H "Authorization: Bearer $token" "$BASE_URL$path");
 else code=$(curl -sS -o "$f" -w '%{http_code}' -X "$method" -H 'Content-Type: application/json' -H "Authorization: Bearer $token" -H 'X-Passenger-Id: e2e-passenger' -d "$body" "$BASE_URL$path"); fi
 if [[ "$code" == "$expected" ]]; then echo "PASS | $name | $code"; PASS=$((PASS+1)); else echo "FAIL | $name | got $code expected $expected"; cat "$f"; FAIL=$((FAIL+1)); fi
}

login(){ local role="$1" name="$2"; curl -sS -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' -d "{\"role\":\"$role\",\"name\":\"$name\",\"pin\":\"$PIN\"}" | node -e 'const fs=require("fs"); console.log(JSON.parse(fs.readFileSync(0,"utf8")).token)'; }

echo "=== TaxiConnect platform E2E ==="
check "health" 200 GET /api/health
SUPER=$(login superadmin "E2E Super Admin")
OP=$(login operator_admin "E2E Operator Admin")
DRV=$(login driver "E2E Driver")
COND=$(login conductor "E2E Conductor")

check "superadmin dashboard" 200 GET /api/superadmin/dashboard "$SUPER"
check "superadmin operators" 200 GET /api/superadmin/operators "$SUPER"
check "superadmin routes" 200 GET /api/superadmin/routes "$SUPER"
check "superadmin users" 200 GET /api/superadmin/users "$SUPER"
check "superadmin fleet" 200 GET /api/superadmin/taxis "$SUPER"
check "superadmin trips" 200 GET /api/superadmin/trips "$SUPER"
check "superadmin audit" 200 GET /api/superadmin/audit "$SUPER"
check "superadmin health" 200 GET /api/superadmin/health "$SUPER"
check "superadmin sees incidents" 200 GET /api/superadmin/incidents "$SUPER"
check "operator admin denied superadmin" 403 GET /api/superadmin/dashboard "$OP"
check "conductor denied operator admin" 403 GET /api/operator/overview "$COND"
check "driver denied conductor" 403 GET "/api/conductor/stats?operatorId=e2e-operator" "$DRV"
check "unauthenticated admin denied" 401 GET /api/superadmin/dashboard

check "operator overview" 200 GET /api/operator/overview "$OP"
check "operator creates taxi" 200 POST /api/operator/taxi/create "$OP" '{"operatorId":"e2e-operator","vehicleRegistrationNumber":"E2E-TAXI-002","capacity":15}'
check "operator creates driver" 200 POST /api/operator/members/create "$OP" '{"name":"E2E Driver 2","role":"driver","phone":"0110000002"}'
check "operator creates conductor" 200 POST /api/operator/members/create "$OP" '{"name":"E2E Conductor 2","role":"conductor","phone":"0110000003"}'
check "operator route points" 200 GET "/api/operator/route-points?routeId=e2e-route" "$OP"
check "operator adds pickup point" 200 POST /api/operator/route-points "$OP" '{"routeId":"e2e-route","name":"Village B","pointType":"PICKUP","sequence":2,"address":"Village B"}'

check "conductor session" 200 GET /api/conductor/session "$COND"
check "conductor opens line" 200 POST /api/conductor/line/open "$COND" '{"operatorId":"e2e-operator","routeId":"e2e-route"}'
LINE=$(curl -sS "$BASE_URL/api/conductor/line?operatorId=e2e-operator&routeId=e2e-route" -H "Authorization: Bearer $COND")
LINE_ID=$(printf '%s' "$LINE" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).line.id')
check "conductor lists taxis" 200 GET "/api/conductor/taxis?operatorId=e2e-operator&routeId=e2e-route" "$COND"
check "conductor adds taxi to line" 200 POST /api/conductor/line/add "$COND" "{\"lineSessionId\":\"$LINE_ID\",\"taxiId\":\"e2e-taxi\"}"
check "conductor demand" 200 GET "/api/conductor/demand?operatorId=e2e-operator&routeId=e2e-route" "$COND"

check "passenger waiting" 200 POST /api/passenger/waiting "" '{"routeId":"e2e-route","originPointId":"e2e-origin","destinationPointId":"e2e-destination","requestMode":"RANK","pickupPointId":"e2e-origin","groupSize":2}'
check "passenger duplicate idempotency" 200 POST /api/passenger/waiting "" '{"routeId":"e2e-route","originPointId":"e2e-origin","destinationPointId":"e2e-destination","requestMode":"RANK","pickupPointId":"e2e-origin","groupSize":2}'
check "passenger demand" 200 POST /api/passenger/demand "" '{"routeId":"e2e-route","originPointId":"e2e-origin","destinationPointId":"e2e-destination","requestMode":"RANK","pickupPointId":"e2e-origin","groupSize":2}'
check "passenger same point rejected" 400 POST /api/passenger/waiting "" '{"routeId":"e2e-route","originPointId":"e2e-origin","destinationPointId":"e2e-origin","requestMode":"RANK","pickupPointId":"e2e-origin","groupSize":1}'

check "driver session" 200 GET /api/driver/session "$DRV"
check "driver routes" 200 GET /api/driver/routes "$DRV"
check "driver go live" 200 POST /api/driver/go-live "$DRV" '{"taxiId":"e2e-taxi","routeId":"e2e-route","originPointId":"e2e-origin","destinationPointId":"e2e-destination","passengersOnboard":0}'
check "driver passenger update" 200 POST /api/driver/passengers "$DRV" '{"taxiId":"e2e-taxi","passengersOnboard":2}'
check "driver full" 200 POST /api/driver/passengers "$DRV" '{"taxiId":"e2e-taxi","passengersOnboard":15}'
check "driver departed" 200 POST /api/driver/status "$DRV" '{"taxiId":"e2e-taxi","status":"DEPARTED"}'
check "driver arrived" 200 POST /api/driver/status "$DRV" '{"taxiId":"e2e-taxi","status":"ARRIVED"}'
check "operator sees completed trip" 200 GET /api/operator/overview "$OP"
check "superadmin audit after operations" 200 GET /api/superadmin/audit "$SUPER"

echo
echo "TOTAL: $TOTAL"
echo "PASS:  $PASS"
echo "FAIL:  $FAIL"
if [[ "$FAIL" -ne 0 ]]; then exit 1; fi
echo "ALL PLATFORM E2E TESTS PASSED"
