const SESSION_TTL_SECONDS = 12 * 60 * 60;
const SESSION_COOKIE = "tc_session";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

const ALLOWED_ROLES = new Set([
  "driver",
  "conductor",
  "operator_admin",
  "superadmin"
]);

const ACTIVE_TRIP_STATUSES = [
  "LOADING",
  "COLLECTING",
  "FULL",
  "DEPARTED"
];

const TERMINAL_TRIP_STATUSES = [
  "ARRIVED",
  "CANCELLED",
  "OFFLINE"
];

const TRIP_STATUS_TRANSITIONS = {
  LOADING: new Set([
    "LOADING",
    "FULL",
    "DEPARTED",
    "CANCELLED",
    "OFFLINE"
  ]),
  COLLECTING: new Set([
    "COLLECTING",
    "FULL",
    "DEPARTED",
    "CANCELLED",
    "OFFLINE"
  ]),
  FULL: new Set([
    "FULL",
    "LOADING",
    "COLLECTING",
    "DEPARTED",
    "CANCELLED",
    "OFFLINE"
  ]),
  DEPARTED: new Set([
    "DEPARTED",
    "ARRIVED"
  ]),
  ARRIVED: new Set(["ARRIVED"]),
  CANCELLED: new Set(["CANCELLED"]),
  OFFLINE: new Set(["OFFLINE"])
};

function assertTripStatusTransition(currentStatus, requestedStatus) {
  const allowed = TRIP_STATUS_TRANSITIONS[currentStatus];

  if (!allowed || !allowed.has(requestedStatus)) {
    throw new HttpError(
      `Invalid trip status transition: ${currentStatus} → ${requestedStatus}.`,
      409
    );
  }
}

const OPERATOR_ROLES = new Set([
  "driver",
  "conductor",
  "operator_admin"
]);

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders
    }
  });
}

function ok(data = {}) {
  return json({ ok: true, ...data });
}

function fail(message, status = 400, extra = {}) {
  return json(
    {
      ok: false,
      error: message,
      ...extra
    },
    status
  );
}

function now() {
  return Date.now();
}

function taxiStatusFromTripStatus(status) {
  switch (status) {
    case "LOADING":
    case "COLLECTING":
      return "loading";

    case "FULL":
      return "full";

    case "DEPARTED":
    case "ARRIVED":
      return "departed";

    case "CANCELLED":
    case "OFFLINE":
      return "OFFLINE";

    default:
      return "OFFLINE";
  }
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizePhone(value) {
  if (value == null) return null;
  const phone = String(value).trim();
  return phone || null;
}

function normalizeRegistration(value) {
  const value2 = String(value || "").trim().toUpperCase();
  return value2 || null;
}

class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function requireString(value, field) {
  const result = String(value ?? "").trim();

  if (!result) {
    throw new HttpError(`${field} is required.`, 400);
  }

  return result;
}

function integer(value, field, min = null, max = null) {
  const n = Number(value);

  if (!Number.isInteger(n)) {
    throw new Error(`${field} must be an integer.`);
  }

  if (min !== null && n < min) {
    throw new Error(`${field} must be at least ${min}.`);
  }

  if (max !== null && n > max) {
    throw new Error(`${field} must be at most ${max}.`);
  }

  return n;
}

function base64urlEncode(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64urlDecode(value) {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");

  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function utf8(value) {
  return new TextEncoder().encode(value);
}

async function hmac(secret, value) {
  // Compute RFC 2104 HMAC-SHA-256 using the Workers-supported digest API.
  // This avoids the HMAC importKey/sign path that has been observed to stall
  // on the production login request while retaining a standards-compliant
  // keyed MAC for session authentication.
  const blockSize = 64;
  let key = utf8(String(secret ?? ""));

  if (key.length > blockSize) {
    key = new Uint8Array(
      await crypto.subtle.digest("SHA-256", key)
    );
  }

  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(key);

  const inner = new Uint8Array(blockSize);
  const outer = new Uint8Array(blockSize);

  for (let i = 0; i < blockSize; i++) {
    inner[i] = paddedKey[i] ^ 0x36;
    outer[i] = paddedKey[i] ^ 0x5c;
  }

  const message = utf8(value);
  const innerInput = new Uint8Array(
    inner.length + message.length
  );
  innerInput.set(inner);
  innerInput.set(message, inner.length);

  const innerHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", innerInput)
  );

  const outerInput = new Uint8Array(
    outer.length + innerHash.length
  );
  outerInput.set(outer);
  outerInput.set(innerHash, outer.length);

  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", outerInput)
  );
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }

  return result === 0;
}

async function createSession(env, user) {
  const header = base64urlEncode(
    utf8(JSON.stringify({
      alg: "HS256",
      typ: "TC_SESSION"
    }))
  );

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + SESSION_TTL_SECONDS;

  const payload = base64urlEncode(
    utf8(JSON.stringify({
      sub: user.id,
      role: user.role,
      name: user.name,
      iat,
      exp
    }))
  );

  const unsigned = `${header}.${payload}`;
  const signature = base64urlEncode(
    await hmac(env.SESSION_SECRET, unsigned)
  );

  return `${unsigned}.${signature}`;
}

async function verifySession(env, token) {
  if (!token) return null;

  const parts = token.split(".");

  if (parts.length !== 3) return null;

  const unsigned = `${parts[0]}.${parts[1]}`;

  const expected = await hmac(
    env.SESSION_SECRET,
    unsigned
  );

  let actual;

  try {
    actual = base64urlDecode(parts[2]);
  } catch {
    return null;
  }

  if (!timingSafeEqual(expected, actual)) {
    return null;
  }

  let payload;

  try {
    payload = JSON.parse(
      new TextDecoder().decode(
        base64urlDecode(parts[1])
      )
    );
  } catch {
    return null;
  }

  if (!payload.sub || !payload.role || !payload.exp) {
    return null;
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}

function getBearer(request) {
  const value = request.headers.get("Authorization") || "";

  if (!value.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return value.slice(7).trim() || null;
}

async function authenticate(request, env) {
  const token = getBearer(request);

  if (!token) {
    return null;
  }

  const session = await verifySession(env, token);

  if (!session) {
    return null;
  }

  const user = await env.DB.prepare(`
    SELECT
      id,
      name,
      role,
      system_role,
      active,
      phone,
      created_at,
      last_login_at,
      last_seen_at
    FROM users
    WHERE id = ?
      AND active = 1
    LIMIT 1
  `)
    .bind(session.sub)
    .first();

  if (!user) {
    return null;
  }

  const effectiveRole =
    user.system_role || user.role;

  return {
    ...session,
    user: {
      ...user,
      role: effectiveRole
    }
  };
}

async function requireAuth(request, env) {
  const auth = await authenticate(request, env);

  if (!auth) {
    throw new HttpError("Authentication required.", 401);
  }

  return auth;
}

async function requireRole(request, env, roles) {
  const auth = await requireAuth(request, env);

  if (!roles.includes(auth.user.role)) {
    throw new HttpError("Insufficient permissions.", 403);
  }

  return auth;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError("Request body must contain valid JSON.", 400);
  }
}

async function ensurePassenger(env, passengerId) {
  const existing = await env.DB.prepare(`
    SELECT id, name, role, active
    FROM users
    WHERE id = ?
    LIMIT 1
  `)
    .bind(passengerId)
    .first();

  if (existing) {
    if (!existing.active) {
      throw new HttpError("Passenger account is inactive.", 403);
    }

    if (existing.role !== "passenger") {
      throw new HttpError("Invalid passenger identity.", 403);
    }

    return existing;
  }

  const timestamp = now();

  await env.DB.prepare(`
    INSERT INTO users
      (id, name, role, active, created_at, last_seen_at)
    VALUES (?, ?, 'passenger', 1, ?, ?)
  `)
    .bind(
      passengerId,
      `Passenger ${passengerId.slice(-8)}`,
      timestamp,
      timestamp
    )
    .run();

  return {
    id: passengerId,
    name: `Passenger ${passengerId.slice(-8)}`,
    role: "passenger",
    active: 1
  };
}

function getPassengerId(request) {
  const supplied = request.headers.get("X-Passenger-Id");

  if (supplied && supplied.trim()) {
    return supplied.trim().slice(0, 120);
  }

  return `passenger_${crypto.randomUUID()}`;
}

async function getOperatorMemberships(env, userId) {
  return env.DB.prepare(`
    SELECT
      om.id,
      om.operator_id,
      om.membership_role,
      om.active,
      o.name AS operator_name,
      o.registration_number,
      o.phone AS operator_phone,
      o.email AS operator_email
    FROM operator_memberships om
    JOIN operators o
      ON o.id = om.operator_id
    WHERE om.user_id = ?
      AND om.active = 1
      AND o.active = 1
    ORDER BY o.name
  `)
    .bind(userId)
    .all();
}

async function requireOperatorMembership(env, userId, allowedRoles = []) {
  const result = await getOperatorMemberships(env, userId);

  const rows = result.results || [];

  const membership = rows.find(row =>
    allowedRoles.length === 0 ||
    allowedRoles.includes(row.membership_role)
  );

  if (!membership) {    throw new HttpError(
      "No active operator membership for this account.",
      403
    );
  }

  return membership;
}

async function requireSpecificOperatorMembership(
  env,
  userId,
  operatorId,
  allowedRoles = []
) {
  const row = await env.DB.prepare(`
    SELECT
      om.id,
      om.operator_id,
      om.membership_role,
      o.name AS operator_name,
      o.registration_number,
      o.phone AS operator_phone,
      o.email AS operator_email
    FROM operator_memberships om
    JOIN operators o
      ON o.id = om.operator_id
    WHERE om.user_id = ?
      AND om.operator_id = ?
      AND om.active = 1
      AND o.active = 1
    LIMIT 1
  `)
    .bind(userId, operatorId)
    .first();

  if (!row) {
    throw new HttpError("Operator access denied.", 403);
  }

  if (
    allowedRoles.length > 0 &&
    !allowedRoles.includes(row.membership_role)
  ) {
    throw new HttpError("Insufficient operator permissions.", 403);
  }

  return row;
}

async function getRoute(env, routeId) {
  const route = await env.DB.prepare(`
    SELECT
      id,
      origin,
      destination,
      name,
      service_mode,
      active,
      created_at,
      updated_at
    FROM routes
    WHERE id = ?
      AND active = 1
    LIMIT 1
  `)
    .bind(routeId)
    .first();

  if (!route) {
    throw new HttpError("Route not found.", 404);
  }

  const points = await env.DB.prepare(`
    SELECT
      id,
      route_id,
      name,
      point_type,
      sequence,
      latitude,
      longitude,
      address,
      active,
      created_at,
      updated_at
    FROM route_pickup_points
    WHERE route_id = ?
      AND active = 1
    ORDER BY sequence ASC, name ASC
  `)
    .bind(routeId)
    .all();

  return {
    ...route,
    pickupPoints: points.results || []
  };
}

async function getAuthorizedOperatorRoute(env, operatorId, routeId) {
  const row = await env.DB.prepare(`
    SELECT
      r.id,
      r.origin,
      r.destination,
      r.name,
      r.service_mode,
      r.active,
      o.id AS operator_id,
      o.name AS operator_name
    FROM operator_routes orr
    JOIN routes r
      ON r.id = orr.route_id
    JOIN operators o
      ON o.id = orr.operator_id
    WHERE orr.operator_id = ?
      AND orr.route_id = ?
      AND orr.active = 1
      AND r.active = 1
      AND o.active = 1
    LIMIT 1
  `)
    .bind(operatorId, routeId)
    .first();

  if (!row) {
    throw new HttpError(
      "Operator is not authorized for this route.",
      403
    );
  }

  return row;
}

async function getTaxiForOperator(env, operatorId, taxiId) {
  const taxi = await env.DB.prepare(`
    SELECT
      t.id,
      t.operator_id,
      t.vehicle_registration_number,
      t.capacity,
      t.active,
      t.driver_id,
      t.driver_name,
      t.status,
      t.created_at,
      t.last_updated,
      o.name AS operator_name
    FROM taxis t
    JOIN operators o
      ON o.id = t.operator_id
    WHERE t.id = ?
      AND t.operator_id = ?
      AND t.active = 1
      AND o.active = 1
    LIMIT 1
  `)
    .bind(taxiId, operatorId)
    .first();

  if (!taxi) {
    throw new HttpError("Taxi not found or access denied.", 404);
  }

  return taxi;
}

async function getTaxiRouteAuthorization(env, taxiId, routeId) {
  const row = await env.DB.prepare(`
    SELECT
      tr.id,
      tr.taxi_id,
      tr.route_id,
      tr.active,
      r.name AS route_name,
      r.service_mode
    FROM taxi_routes tr
    JOIN routes r
      ON r.id = tr.route_id
    WHERE tr.taxi_id = ?
      AND tr.route_id = ?
      AND tr.active = 1
      AND r.active = 1
    LIMIT 1
  `)
    .bind(taxiId, routeId)
    .first();

  if (!row) {
    throw new HttpError(
      "Taxi is not authorized for this route.",
      403
    );
  }

  return row;
}

async function getDriverTaxi(env, driverId, taxiId) {
  const taxi = await env.DB.prepare(`
    SELECT
      t.id,
      t.operator_id,
      t.vehicle_registration_number,
      t.capacity,
      t.active,
      t.driver_id,
      t.driver_name,
      t.status,
      o.name AS operator_name
    FROM taxi_driver_assignments a
    JOIN taxis t
      ON t.id = a.taxi_id
    JOIN operators o
      ON o.id = t.operator_id
    WHERE a.driver_id = ?
      AND a.taxi_id = ?
      AND a.active = 1
      AND t.active = 1
      AND o.active = 1
    LIMIT 1
  `)
    .bind(driverId, taxiId)
    .first();

  if (!taxi) {
    throw new HttpError(
      "Taxi is not assigned to this driver.",
      403
    );
  }

  return taxi;
}

async function getDriverAssignment(env, driverId) {
  const result = await env.DB.prepare(`
    SELECT
      a.id AS assignment_id,
      a.taxi_id,
      t.operator_id,
      t.vehicle_registration_number,
      t.capacity,
      t.active AS taxi_active,
      o.name AS operator_name
    FROM taxi_driver_assignments a
    JOIN taxis t
      ON t.id = a.taxi_id
    JOIN operators o
      ON o.id = t.operator_id
    WHERE a.driver_id = ?
      AND a.active = 1
      AND t.active = 1
      AND o.active = 1
    ORDER BY a.assigned_at DESC
  `)
    .bind(driverId)
    .all();

  return result.results || [];
}

async function getOpenLineForRoute(env, operatorId, routeId) {
  const serviceDate = new Date().toISOString().slice(0, 10);

  return env.DB.prepare(`
    SELECT
      ls.id,
      ls.operator_id,
      ls.route_id,
      ls.service_date,
      ls.status,
      ls.opened_by,
      ls.opened_at,
      ls.closed_at
    FROM line_sessions ls
    WHERE ls.operator_id = ?
      AND ls.route_id = ?
      AND ls.service_date = ?
      AND ls.status IN ('OPEN', 'ACTIVE')
    ORDER BY ls.opened_at DESC
    LIMIT 1
  `)
    .bind(operatorId, routeId, serviceDate)
    .first();
}

async function getLine(env, lineSessionId) {
  const line = await env.DB.prepare(`
    SELECT
      ls.id,
      ls.operator_id,
      ls.route_id,
      ls.service_date,
      ls.status,
      ls.opened_by,
      ls.opened_at,
      ls.closed_at,
      o.name AS operator_name,
      r.name AS route_name,
      r.origin,
      r.destination,
      r.service_mode
    FROM line_sessions ls
    JOIN operators o
      ON o.id = ls.operator_id
    JOIN routes r
      ON r.id = ls.route_id
    WHERE ls.id = ?
    LIMIT 1
  `)
    .bind(lineSessionId)
    .first();

  if (!line) {
    throw new HttpError("Loading line not found.", 404);
  }

  const entries = await env.DB.prepare(`
    SELECT
      le.id,
      le.line_session_id,
      le.taxi_id,
      le.position,
      le.status,
      le.joined_at,
      le.loading_started_at,
      le.removed_at,
      t.vehicle_registration_number,
      t.capacity,
      t.driver_id,
      t.driver_name
    FROM line_entries le
    JOIN taxis t
      ON t.id = le.taxi_id
    WHERE le.line_session_id = ?
    ORDER BY le.position ASC, le.joined_at ASC
  `)
    .bind(lineSessionId)
    .all();

  return {
    ...line,
    entries: entries.results || []
  };
}

async function writeAudit(
  env,
  {
    actorUserId = null,
    operatorId = null,
    action,
    entityType,
    entityId = null,
    details = {}
  }
) {
  await env.DB.prepare(`
    INSERT INTO audit_logs
      (
        id,
        actor_user_id,
        operator_id,
        action,
        entity_type,
        entity_id,
        details_json,
        timestamp
      )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      id("audit"),
      actorUserId,
      operatorId,
      action,
      entityType,
      entityId,
      JSON.stringify(details),
      now()
    )
    .run();
}

async function broadcast(env, type, payload = {}) {
  try {
    const stub = env.DISPATCH.get(
      env.DISPATCH.idFromName("global")
    );

    await stub.fetch("https://dispatch/broadcast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type,
        ...payload
      })
    });
  } catch {
    // Realtime failure must not break the primary transaction.
  }
}

async function publicAvailability(env, routeId) {
  const route = await getRoute(env, routeId);

  const result = await env.DB.prepare(`
    SELECT
      tr.id AS trip_id,
      tr.taxi_id,
      tr.route_id,
      tr.status,
      tr.capacity,
      tr.passengers_onboard,
      tr.seats_remaining,
      tr.started_at,
      tr.last_updated,
      tr.departed_at,
      t.vehicle_registration_number,
      o.id AS operator_id,
      o.name AS operator_name
    FROM trips tr
    JOIN taxis t
      ON t.id = tr.taxi_id
    JOIN operators o
      ON o.id = t.operator_id
    WHERE tr.route_id = ?
      AND tr.status IN ('LOADING', 'COLLECTING', 'FULL', 'DEPARTED')
      AND t.active = 1
      AND o.active = 1
    ORDER BY
      CASE tr.status
        WHEN 'LOADING' THEN 1
        WHEN 'COLLECTING' THEN 2
        WHEN 'FULL' THEN 3
        WHEN 'DEPARTED' THEN 4
        ELSE 5
      END,
      tr.started_at ASC
  `)
    .bind(routeId)
    .all();

  const pickups = await env.DB.prepare(`
    SELECT
      id,
      name,
      point_type,
      sequence,
      latitude,
      longitude,
      address,
      active
    FROM route_pickup_points
    WHERE route_id = ?
      AND active = 1
    ORDER BY sequence ASC, name ASC
  `)
    .bind(routeId)
    .all();

  return {
    route,
    trips: result.results || [],
    pickupPoints: pickups.results || []
  };
}

async function routeList(env) {
  const result = await env.DB.prepare(`
    SELECT
      r.id,
      r.origin,
      r.destination,
      r.name,
      r.service_mode,
      r.active,
      COUNT(DISTINCT orr.operator_id) AS operator_count
    FROM routes r
    LEFT JOIN operator_routes orr
      ON orr.route_id = r.id
      AND orr.active = 1
    WHERE r.active = 1
    GROUP BY
      r.id,
      r.origin,
      r.destination,
      r.name,
      r.service_mode,
      r.active
    ORDER BY r.origin, r.destination, r.name
  `)
    .all();

  return result.results || [];}

async function driverRoutes(env, driverId) {
  const result = await env.DB.prepare(`
    SELECT DISTINCT
      r.id,
      r.origin,
      r.destination,
      r.name,
      r.service_mode,
      t.id AS taxi_id,
      t.vehicle_registration_number,
      t.capacity,
      o.id AS operator_id,
      o.name AS operator_name
    FROM taxi_driver_assignments a
    JOIN taxis t
      ON t.id = a.taxi_id
    JOIN taxi_routes tr
      ON tr.taxi_id = t.id
      AND tr.active = 1
    JOIN routes r
      ON r.id = tr.route_id
      AND r.active = 1
    JOIN operator_routes orr
      ON orr.operator_id = t.operator_id
      AND orr.route_id = r.id
      AND orr.active = 1
    JOIN operators o
      ON o.id = t.operator_id
      AND o.active = 1
    WHERE a.driver_id = ?
      AND a.active = 1
      AND t.active = 1
    ORDER BY
      t.vehicle_registration_number,
      r.origin,
      r.destination
  `)
    .bind(driverId)
    .all();

  return result.results || [];
}

async function startDriverTrip(env, auth, body) {
  const taxiId = requireString(body.taxiId, "taxiId");
  const routeId = requireString(body.routeId, "routeId");
  const originPointId = requireString(
    body.originPointId,
    "originPointId"
  );
  const destinationPointId = requireString(
    body.destinationPointId,
    "destinationPointId"
  );

  const taxi = await getDriverTaxi(
    env,
    auth.user.id,
    taxiId
  );

  const membership = await requireSpecificOperatorMembership(
    env,
    auth.user.id,
    taxi.operator_id,
    ["driver"]
  );

  const route = await getAuthorizedOperatorRoute(
    env,
    taxi.operator_id,
    routeId
  );

  const journey = await getRouteJourneyPoints(
    env,
    routeId,
    originPointId,
    destinationPointId
  );

  await getTaxiRouteAuthorization(
    env,
    taxiId,
    routeId
  );

  const line = await getOpenLineForRoute(
    env,
    taxi.operator_id,
    routeId
  );

  if (!line) {
    throw new HttpError(
      "No open loading line exists for this route today.",
      409
    );
  }

  const existingTrip = await env.DB.prepare(`
    SELECT id, status
    FROM trips
    WHERE taxi_id = ?
      AND status IN ('LOADING', 'COLLECTING', 'FULL', 'DEPARTED')
    ORDER BY started_at DESC
    LIMIT 1
  `)
    .bind(taxiId)
    .first();

  if (existingTrip) {
    throw new HttpError(
      "Taxi already has an active trip.",
      409
    );
  }

  const lineEntry = await env.DB.prepare(`
    SELECT
      le.id,
      le.position,
      le.status
    FROM line_entries le
    WHERE le.line_session_id = ?
      AND le.taxi_id = ?
      AND le.status IN ('WAITING', 'LOADING')
    ORDER BY le.position ASC
    LIMIT 1
  `)
    .bind(line.id, taxiId)
    .first();

  if (!lineEntry) {
    throw new HttpError(
      "Taxi is not currently in this route's loading line.",
      409
    );
  }

  if (lineEntry.status === "WAITING") {
    const earlier = await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM line_entries
      WHERE line_session_id = ?
        AND position < ?
        AND status IN ('WAITING', 'LOADING')
    `)
      .bind(line.id, lineEntry.position)
      .first();

    if (Number(earlier?.count || 0) > 0) {
      throw new HttpError(
        "This taxi is not yet next in the loading line.",
        409
      );
    }
  }

  const requestedPassengers =
    body.passengersOnboard == null
      ? 0
      : integer(
          body.passengersOnboard,
          "passengersOnboard",
          0,
          taxi.capacity
        );

  const initialStatus =
    requestedPassengers >= taxi.capacity
      ? "FULL"
      : route.service_mode === "COLLECTION"
        ? "COLLECTING"
        : "LOADING";

  const timestamp = now();
  const tripId = id("trip");

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE line_entries
      SET
        status = 'LOADING',
        loading_started_at = ?
      WHERE id = ?
    `)
      .bind(timestamp, lineEntry.id),

    env.DB.prepare(`
      UPDATE line_sessions
      SET status = 'ACTIVE'
      WHERE id = ?
        AND status = 'OPEN'
    `)
      .bind(line.id),

    env.DB.prepare(`
      INSERT INTO trips
        (
          id,
          taxi_id,
          line_entry_id,
          route_id,
          origin_point_id,
          destination_point_id,
          driver_id,
          status,
          capacity,
          passengers_onboard,
          seats_remaining,
          started_at,
          last_updated
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        tripId,
        taxiId,
        lineEntry.id,
        routeId,
        originPointId,
        destinationPointId,
        auth.user.id,
        initialStatus,
        taxi.capacity,
        requestedPassengers,
        taxi.capacity - requestedPassengers,
        timestamp,
        timestamp
      ),

    env.DB.prepare(`
      UPDATE taxis
      SET
        driver_id = ?,
        driver_name = ?,
        status = ?,
        passengers_onboard = ?,
        last_updated = ?
      WHERE id = ?
    `)
      .bind(
        auth.user.id,
        auth.user.name,
        requestedPassengers >= taxi.capacity ? "full" : "loading",
        requestedPassengers,
        timestamp,
        taxiId
      )
  ]);

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId: membership.operator_id,
    action: "TRIP_STARTED",
    entityType: "trip",
    entityId: tripId,
    details: {
      taxiId,
      routeId,
      originPointId,
      destinationPointId,
      originPointName: journey.origin.name,
      destinationPointName: journey.destination.name,
      lineSessionId: line.id,
      lineEntryId: lineEntry.id,
      status: initialStatus
    }
  });

  await broadcast(env, "trip_updated", {
    tripId,
    taxiId,
    routeId,
    originPointId,
    destinationPointId,
    originPointName: journey.origin.name,
    destinationPointName: journey.destination.name,
    status: initialStatus
  });

  return ok({
    trip: {
      id: tripId,
      taxiId,
      routeId,
      originPointId,
      destinationPointId,
      originPointName: journey.origin.name,
      destinationPointName: journey.destination.name,
      lineEntryId: lineEntry.id,
      status: initialStatus,
      capacity: taxi.capacity,
      passengersOnboard: requestedPassengers,
      seatsRemaining: taxi.capacity - requestedPassengers,
      serviceMode: route.service_mode
    }
  });
}

async function updateDriverPassengers(env, auth, body) {
  const tripId = requireString(body.tripId, "tripId");

  const trip = await env.DB.prepare(`
    SELECT
      tr.*,
      t.operator_id,
      t.vehicle_registration_number,
      r.service_mode
    FROM trips tr
    JOIN taxis t
      ON t.id = tr.taxi_id
    JOIN routes r
      ON r.id = tr.route_id
    WHERE tr.id = ?
      AND tr.driver_id = ?
    LIMIT 1
  `)
    .bind(tripId, auth.user.id)
    .first();

  if (!trip) {
    throw new HttpError(
      "Trip not found or not owned by this driver.",
      404
    );
  }

  if (
    TERMINAL_TRIP_STATUSES.includes(trip.status) ||
    trip.status === "DEPARTED"
  ) {
    throw new HttpError(
      "Passenger count can only be changed while the taxi is loading or collecting.",
      409
    );
  }

  const passengers = integer(
    body.passengersOnboard,
    "passengersOnboard",
    0,
    trip.capacity
  );

  const status =
    passengers >= trip.capacity
      ? "FULL"
      : trip.status === "FULL"
        ? (
            trip.service_mode === "COLLECTION"
              ? "COLLECTING"
              : "LOADING"
          )
        : trip.status;

  const timestamp = now();

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE trips
      SET
        passengers_onboard = ?,
        seats_remaining = ?,
        status = ?,
        last_updated = ?
      WHERE id = ?
        AND driver_id = ?
    `)
      .bind(
        passengers,
        trip.capacity - passengers,
        status,
        timestamp,
        tripId,
        auth.user.id
      ),

    env.DB.prepare(`
      UPDATE taxis
      SET
        passengers_onboard = ?,
        status = ?,
        last_updated = ?
      WHERE id = ?
    `)
      .bind(
        passengers,
        taxiStatusFromTripStatus(status),
        timestamp,
        trip.taxi_id
      )
  ]);

  await broadcast(env, "trip_updated", {
    tripId,
    taxiId: trip.taxi_id,
    routeId: trip.route_id,
    status,
    passengersOnboard: passengers,
    seatsRemaining: trip.capacity - passengers
  });

  return ok({
    tripId,
    status,
    passengersOnboard: passengers,
    seatsRemaining: trip.capacity - passengers
  });
}

async function updateDriverTripStatus(env, auth, body) {
  const tripId = requireString(body.tripId, "tripId");
  const requestedStatus = requireString(body.status, "status");

  const allowed = new Set([
    "LOADING",
    "COLLECTING",
    "FULL",
    "DEPARTED",
    "ARRIVED",
    "CANCELLED",
    "OFFLINE"
  ]);

  if (!allowed.has(requestedStatus)) {
    throw new HttpError("Invalid trip status.", 400);
  }

  const trip = await env.DB.prepare(`
    SELECT
      tr.*,
      t.operator_id,
      t.vehicle_registration_number
    FROM trips tr
    JOIN taxis t
      ON t.id = tr.taxi_id
    WHERE tr.id = ?
      AND tr.driver_id = ?
    LIMIT 1
  `)
    .bind(tripId, auth.user.id)
    .first();

  if (!trip) {
    throw new HttpError("Trip not found.", 404);
  }

  if (TERMINAL_TRIP_STATUSES.includes(trip.status)) {
    throw new HttpError(
      "Trip is already in a terminal state.",
      409
    );
  }

  assertTripStatusTransition(
    trip.status,
    requestedStatus
  );

  const timestamp = now();

  let departedAt = trip.departed_at;
  let completedAt = trip.completed_at;

  if (
    requestedStatus === "DEPARTED" &&
    !departedAt
  ) {
    departedAt = timestamp;
  }

  if (
    ["ARRIVED", "CANCELLED", "OFFLINE"].includes(requestedStatus)
  ) {
    completedAt = timestamp;
  }

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE trips
      SET
        status = ?,
        departed_at = ?,
        completed_at = ?,
        last_updated = ?
      WHERE id = ?
        AND driver_id = ?
    `)
      .bind(
        requestedStatus,
        departedAt,
        completedAt,
        timestamp,
        tripId,
        auth.user.id
      ),
    env.DB.prepare(`
      UPDATE taxis
      SET
        status = ?,
        last_updated = ?
      WHERE id = ?
    `)
      .bind(
        taxiStatusFromTripStatus(requestedStatus),
        timestamp,
        trip.taxi_id
      ),

    ...(requestedStatus === "DEPARTED"
      ? [
          env.DB.prepare(`
            UPDATE line_entries
            SET status = 'DISPATCHED'
            WHERE id = ?
          `)
            .bind(trip.line_entry_id)
        ]
      : []),

    ...(requestedStatus === "ARRIVED"
      ? [
          env.DB.prepare(`
            UPDATE line_entries
            SET status = 'COMPLETED'
            WHERE id = ?
          `)
            .bind(trip.line_entry_id)
        ]
      : [])
  ]);

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId: trip.operator_id,
    action: "TRIP_STATUS_CHANGED",
    entityType: "trip",
    entityId: tripId,
    details: {
      from: trip.status,
      to: requestedStatus
    }
  });

  await broadcast(env, "trip_updated", {
    tripId,
    taxiId: trip.taxi_id,
    routeId: trip.route_id,
    status: requestedStatus
  });

  return ok({
    tripId,
    status: requestedStatus,
    departedAt,
    completedAt
  });
}


async function getRouteJourneyPoints(
  env,
  routeId,
  originPointId,
  destinationPointId
) {
  const origin = await env.DB.prepare(`
    SELECT
      id,
      route_id,
      name,
      point_type,
      sequence,
      latitude,
      longitude,
      address,
      active
    FROM route_pickup_points
    WHERE id = ?
      AND route_id = ?
      AND active = 1
    LIMIT 1
  `)
    .bind(originPointId, routeId)
    .first();

  if (!origin) {
    throw new HttpError(
      "Origin point does not belong to this route.",
      400
    );
  }

  const destination = await env.DB.prepare(`
    SELECT
      id,
      route_id,
      name,
      point_type,
      sequence,
      latitude,
      longitude,
      address,
      active
    FROM route_pickup_points
    WHERE id = ?
      AND route_id = ?
      AND active = 1
    LIMIT 1
  `)
    .bind(destinationPointId, routeId)
    .first();

  if (!destination) {
    throw new HttpError(
      "Destination point does not belong to this route.",
      400
    );
  }

  if (origin.id === destination.id) {
    throw new HttpError(
      "Origin and destination must be different route points.",
      400
    );
  }

  return {
    origin,
    destination
  };
}

async function passengerWaiting(env, request, body) {
  const passengerId = getPassengerId(request);

  await ensurePassenger(env, passengerId);

  const routeId = requireString(body.routeId, "routeId");
  const route = await getRoute(env, routeId);

  const originPointId = requireString(
    body.originPointId,
    "originPointId"
  );

  const destinationPointId = requireString(
    body.destinationPointId,
    "destinationPointId"
  );

  const { origin, destination } = await getRouteJourneyPoints(
    env,
    routeId,
    originPointId,
    destinationPointId
  );

  const requestMode = String(
    body.requestMode ?? "ALONG_ROUTE"
  ).trim().toUpperCase();

  if (!["RANK", "ALONG_ROUTE", "COLLECTION"].includes(requestMode)) {
    throw new HttpError(
      "Invalid requestMode. Use RANK, ALONG_ROUTE, or COLLECTION.",
      400
    );
  }

  if (
    requestMode === "COLLECTION" &&
    route.service_mode === "RANK_DEPARTURE"
  ) {
    throw new HttpError(
      "This route does not offer organised collection.",
      409
    );
  }

  if (
    requestMode === "RANK" &&
    route.service_mode === "COLLECTION"
  ) {
    throw new HttpError(
      "This route does not use rank boarding as its primary service mode.",
      409
    );
  }

  const pickupPointId =
    body.pickupPointId
      ? String(body.pickupPointId).trim()
      : null;

  const pickupDescription =
    body.pickupDescription
      ? String(body.pickupDescription).trim().slice(0, 500)
      : null;

  const hasLatitude =
    body.latitude !== undefined &&
    body.latitude !== null &&
    String(body.latitude).trim() !== "";

  const hasLongitude =
    body.longitude !== undefined &&
    body.longitude !== null &&
    String(body.longitude).trim() !== "";

  if (hasLatitude !== hasLongitude) {
    throw new HttpError(
      "latitude and longitude must be provided together.",
      400
    );
  }

  let latitude = null;
  let longitude = null;

  if (hasLatitude && hasLongitude) {
    latitude = Number(body.latitude);
    longitude = Number(body.longitude);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new HttpError(
        "Invalid latitude or longitude.",
        400
      );
    }
  }

  let pickup = null;

  if (pickupPointId) {
    pickup = await env.DB.prepare(`
      SELECT
        id,
        route_id,
        name,
        point_type,
        active
      FROM route_pickup_points
      WHERE id = ?
        AND route_id = ?
        AND active = 1
      LIMIT 1
    `)
      .bind(pickupPointId, routeId)
      .first();

    if (!pickup) {
      throw new HttpError(
        "Pickup point does not belong to this route.",
        400
      );
    }

    if (
      requestMode === "RANK" &&
      pickup.point_type !== "RANK"
    ) {
      throw new HttpError(
        "RANK requests must use a route rank.",
        400
      );
    }

    if (
      requestMode === "COLLECTION" &&
      pickup.point_type === "RANK"
    ) {
      throw new HttpError(
        "Collection requests cannot use a rank as their pickup point.",
        400
      );
    }
  }

  if (requestMode === "RANK" && !pickupPointId) {
    throw new HttpError(
      "RANK requests require a rank pickupPointId.",
      400
    );
  }

  if (
    requestMode === "COLLECTION" &&
    !pickupPointId &&
    latitude === null &&
    !pickupDescription
  ) {
    throw new HttpError(
      "COLLECTION requests require a pickup point, location, or pickup description.",
      400
    );
  }

  if (
    requestMode === "ALONG_ROUTE" &&
    !pickupPointId &&
    latitude === null &&
    !pickupDescription
  ) {
    throw new HttpError(
      "ALONG_ROUTE requests require a pickup point, location, or pickup description.",
      400
    );
  }

  const groupSize = integer(
    body.groupSize ?? 1,
    "groupSize",
    1,
    10
  );

  const timestamp = now();

  const waitingInsertId = id("waiting");

  await env.DB.prepare(`
    INSERT OR IGNORE INTO route_waiting_passengers
      (
        id,
        passenger_id,
        route_id,
        pickup_point_id,
        group_size,
        status,
        created_at,
        updated_at,
        request_mode,
        latitude,
        longitude,
        pickup_description,
        origin_point_id,
        destination_point_id
      )
    VALUES (?, ?, ?, ?, ?, 'WAITING', ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      waitingInsertId,
      passengerId,
      routeId,
      pickupPointId,
      groupSize,
      timestamp,
      timestamp,
      requestMode,
      latitude,
      longitude,
      pickupDescription,
      originPointId,
      destinationPointId
    )
    .run();

  const waiting = await env.DB.prepare(`
    SELECT id
    FROM route_waiting_passengers
    WHERE passenger_id = ?
      AND route_id = ?
      AND origin_point_id = ?
      AND destination_point_id = ?
      AND status = 'WAITING'
    LIMIT 1
  `)
    .bind(
      passengerId,
      routeId,
      originPointId,
      destinationPointId
    )
    .first();

  if (!waiting) {
    throw new HttpError(
      "Unable to create or update the waiting request.",
      500
    );
  }

  const waitingId = waiting.id;

  await env.DB.prepare(`
    UPDATE route_waiting_passengers
    SET
      pickup_point_id = ?,
      group_size = ?,
      request_mode = ?,
      latitude = ?,
      longitude = ?,
      pickup_description = ?,
      origin_point_id = ?,
      destination_point_id = ?,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(
      pickupPointId,
      groupSize,
      requestMode,
      latitude,
      longitude,
      pickupDescription,
      originPointId,
      destinationPointId,
      timestamp,
      waitingId
    )
    .run();

  const signalInsertId = id("demand");

  await env.DB.prepare(`
    INSERT OR IGNORE INTO demand_signals
      (
        id,
        route_id,
        pickup_point_id,
        passenger_id,
        group_size,
        signal_type,
        status,
        created_at,
        updated_at,
        request_mode,
        latitude,
        longitude,
        pickup_description,
        origin_point_id,
        destination_point_id
      )
    VALUES (?, ?, ?, ?, ?, 'WAITING', 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      signalInsertId,
      routeId,
      pickupPointId,
      passengerId,
      groupSize,
      timestamp,
      timestamp,
      requestMode,
      latitude,
      longitude,
      pickupDescription,
      originPointId,
      destinationPointId
    )
    .run();

  const signal = await env.DB.prepare(`
    SELECT id
    FROM demand_signals
    WHERE passenger_id = ?
      AND route_id = ?
      AND origin_point_id = ?
      AND destination_point_id = ?
      AND signal_type = 'WAITING'
      AND status = 'ACTIVE'
    LIMIT 1
  `)
    .bind(
      passengerId,
      routeId,
      originPointId,
      destinationPointId
    )
    .first();

  if (!signal) {
    throw new HttpError(
      "Unable to create or update the waiting demand signal.",
      500
    );
  }

  const signalId = signal.id;

  await env.DB.prepare(`
    UPDATE demand_signals
    SET
      pickup_point_id = ?,
      group_size = ?,
      updated_at = ?,
      request_mode = ?,
      latitude = ?,      longitude = ?,
      pickup_description = ?,
      origin_point_id = ?,
      destination_point_id = ?
    WHERE id = ?
  `)
    .bind(
      pickupPointId,
      groupSize,
      timestamp,
      requestMode,
      latitude,
      longitude,
      pickupDescription,
      originPointId,
      destinationPointId,
      signalId
    )
    .run();

  await broadcast(env, "passenger_waiting", {
    routeId,
    originPointId,
    destinationPointId,
    originPointName: origin.name,
    destinationPointName: destination.name,
    groupSize,
    requestMode,
    pickupPointId,
    latitude,
    longitude,
    pickupDescription,
    serviceMode: route.service_mode
  });

  return ok({
    waiting: {
      id: waitingId,
      routeId,
      originPointId,
      destinationPointId,
      originPointName: origin.name,
      destinationPointName: destination.name,
      pickupPointId,
      groupSize,
      requestMode,
      latitude,
      longitude,
      pickupDescription,
      status: "WAITING"
    }
  });
}

async function passengerDemand(env, request, body) {
  const passengerId = getPassengerId(request);

  await ensurePassenger(env, passengerId);

  const routeId = requireString(body.routeId, "routeId");

  const route = await getRoute(env, routeId);

  const originPointId = requireString(
    body.originPointId,
    "originPointId"
  );

  const destinationPointId = requireString(
    body.destinationPointId,
    "destinationPointId"
  );

  const { origin, destination } = await getRouteJourneyPoints(
    env,
    routeId,
    originPointId,
    destinationPointId
  );

  const requestMode = String(
    body.requestMode ?? "ALONG_ROUTE"
  ).trim().toUpperCase();

  if (!["RANK", "ALONG_ROUTE", "COLLECTION"].includes(requestMode)) {
    throw new HttpError(
      "Invalid requestMode. Use RANK, ALONG_ROUTE, or COLLECTION.",
      400
    );
  }

  if (
    requestMode === "COLLECTION" &&
    route.service_mode === "RANK_DEPARTURE"
  ) {
    throw new HttpError(
      "This route does not offer organised collection.",
      409
    );
  }

  if (
    requestMode === "RANK" &&
    route.service_mode === "COLLECTION"
  ) {
    throw new HttpError(
      "This route does not use rank boarding as its primary service mode.",
      409
    );
  }

  const groupSize = integer(
    body.groupSize ?? 1,
    "groupSize",
    1,
    10
  );

  const pickupPointId =
    body.pickupPointId
      ? String(body.pickupPointId).trim()
      : null;

  const pickupDescription =
    body.pickupDescription
      ? String(body.pickupDescription).trim().slice(0, 500)
      : null;

  const hasLatitude =
    body.latitude !== undefined &&
    body.latitude !== null &&
    String(body.latitude).trim() !== "";

  const hasLongitude =
    body.longitude !== undefined &&
    body.longitude !== null &&
    String(body.longitude).trim() !== "";

  if (hasLatitude !== hasLongitude) {
    throw new HttpError(
      "latitude and longitude must be provided together.",
      400
    );
  }

  let latitude = null;
  let longitude = null;

  if (hasLatitude && hasLongitude) {
    latitude = Number(body.latitude);
    longitude = Number(body.longitude);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new HttpError(
        "Invalid latitude or longitude.",
        400
      );
    }
  }

  if (pickupPointId) {
    const pickup = await env.DB.prepare(`
      SELECT
        id,
        point_type
      FROM route_pickup_points
      WHERE id = ?
        AND route_id = ?
        AND active = 1
      LIMIT 1
    `)
      .bind(pickupPointId, routeId)
      .first();

    if (!pickup) {
      throw new HttpError(
        "Pickup point does not belong to this route.",
        400
      );
    }

    if (
      requestMode === "RANK" &&
      pickup.point_type !== "RANK"
    ) {
      throw new HttpError(
        "RANK requests must use a route rank.",
        400
      );
    }

    if (
      requestMode === "COLLECTION" &&
      pickup.point_type === "RANK"
    ) {
      throw new HttpError(
        "Collection requests cannot use a rank as their pickup point.",
        400
      );
    }
  }

  if (requestMode === "RANK" && !pickupPointId) {
    throw new HttpError(
      "RANK demand signals require a rank pickupPointId.",
      400
    );
  }

  if (
    requestMode === "COLLECTION" &&
    !pickupPointId &&
    latitude === null &&
    !pickupDescription
  ) {
    throw new HttpError(
      "COLLECTION demand signals require a pickup point, location, or pickup description.",
      400
    );
  }

  if (
    requestMode === "ALONG_ROUTE" &&
    !pickupPointId &&
    latitude === null &&
    !pickupDescription
  ) {
    throw new HttpError(
      "ALONG_ROUTE demand signals require a pickup point, location, or pickup description.",
      400
    );
  }

  const existingDemand = await env.DB.prepare(`
    SELECT
      id,
      route_id,
      pickup_point_id,
      passenger_id,
      group_size,
      signal_type,
      status,
      created_at,
      updated_at,
      request_mode,
      latitude,
      longitude,
      pickup_description,
      origin_point_id,
      destination_point_id
    FROM demand_signals
    WHERE passenger_id = ?
      AND route_id = ?
      AND origin_point_id = ?
      AND destination_point_id = ?
      AND signal_type = 'DEMAND'
      AND status = 'ACTIVE'
    ORDER BY created_at ASC
    LIMIT 1
  `)
    .bind(
      passengerId,
      routeId,
      originPointId,
      destinationPointId
    )
    .first();

  if (existingDemand) {
    return ok({
      signal: {
        id: existingDemand.id,
        routeId: existingDemand.route_id,
        originPointId: existingDemand.origin_point_id,
        destinationPointId: existingDemand.destination_point_id,
        originPointName: origin.name,
        destinationPointName: destination.name,
        groupSize: existingDemand.group_size,
        requestMode: existingDemand.request_mode,
        pickupPointId: existingDemand.pickup_point_id,
        latitude: existingDemand.latitude,
        longitude: existingDemand.longitude,
        pickupDescription: existingDemand.pickup_description,
        status: existingDemand.status,
        serviceMode: route.service_mode
      },
      duplicate: true
    });
  }

  const timestamp = now();
  const signalId = id("demand");

  try {
    await env.DB.prepare(`
      INSERT INTO demand_signals
        (
          id,
          route_id,
          pickup_point_id,
          passenger_id,
          group_size,
          signal_type,
          status,
          created_at,
          updated_at,
          request_mode,
          latitude,
          longitude,
          pickup_description,
          origin_point_id,
          destination_point_id
        )
      VALUES (?, ?, ?, ?, ?, 'DEMAND', 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        signalId,
        routeId,
        pickupPointId,
        passengerId,
        groupSize,
        timestamp,
        timestamp,
        requestMode,
        latitude,
        longitude,
        pickupDescription,
        originPointId,
        destinationPointId
      )
      .run();
  } catch (error) {
    const message = String(error?.message || error);

    if (
      !message.includes(
        "idx_demand_signals_active_demand_journey_unique"
      ) &&
      !message.includes("UNIQUE constraint failed")
    ) {
      throw error;
    }

    const racedDemand = await env.DB.prepare(`
      SELECT
        id,
        route_id,
        pickup_point_id,
        passenger_id,
        group_size,
        status,
        request_mode,
        latitude,
        longitude,
        pickup_description,
        origin_point_id,
        destination_point_id
      FROM demand_signals
      WHERE passenger_id = ?
        AND route_id = ?
        AND origin_point_id = ?
        AND destination_point_id = ?
        AND signal_type = 'DEMAND'
        AND status = 'ACTIVE'
      ORDER BY created_at ASC
      LIMIT 1
    `)
      .bind(
        passengerId,
        routeId,
        originPointId,
        destinationPointId
      )
      .first();

    if (!racedDemand) {
      throw error;
    }

    return ok({
      signal: {
        id: racedDemand.id,
        routeId: racedDemand.route_id,
        originPointId: racedDemand.origin_point_id,
        destinationPointId: racedDemand.destination_point_id,
        originPointName: origin.name,
        destinationPointName: destination.name,
        groupSize: racedDemand.group_size,
        requestMode: racedDemand.request_mode,
        pickupPointId: racedDemand.pickup_point_id,
        latitude: racedDemand.latitude,
        longitude: racedDemand.longitude,
        pickupDescription: racedDemand.pickup_description,
        status: racedDemand.status,
        serviceMode: route.service_mode
      },
      duplicate: true
    });
  }

  await broadcast(env, "route_demand", {
    routeId,
    originPointId,
    destinationPointId,
    originPointName: origin.name,
    destinationPointName: destination.name,
    groupSize,
    requestMode,
    pickupPointId,
    latitude,
    longitude,
    pickupDescription,
    serviceMode: route.service_mode
  });

  return ok({
    signal: {
      id: signalId,
      routeId,
      originPointId,
      destinationPointId,
      originPointName: origin.name,
      destinationPointName: destination.name,
      groupSize,
      requestMode,
      pickupPointId,
      latitude,
      longitude,
      pickupDescription,
      status: "ACTIVE",
      serviceMode: route.service_mode
    }
  });
}

async function passengerCancelWaiting(env, request, body) {
  const passengerId = getPassengerId(request);
  const waitingId = requireString(
    body.waitingId,
    "waitingId"
  );

  await ensurePassenger(env, passengerId);

  const waiting = await env.DB.prepare(`
    SELECT id, route_id, status
    FROM route_waiting_passengers
    WHERE id = ?
      AND passenger_id = ?
    LIMIT 1
  `)
    .bind(waitingId, passengerId)
    .first();

  if (!waiting) {
    throw new HttpError("Waiting request not found.", 404);
  }

  const timestamp = now();

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE route_waiting_passengers
      SET
        status = 'CANCELLED',
        updated_at = ?
      WHERE id = ?
        AND passenger_id = ?
    `)
      .bind(
        timestamp,
        waitingId,
        passengerId
      ),

    env.DB.prepare(`
      UPDATE demand_signals
      SET
        status = 'CANCELLED',
        updated_at = ?
      WHERE passenger_id = ?
        AND route_id = ?
        AND status = 'ACTIVE'
    `)
      .bind(
        timestamp,
        passengerId,
        waiting.route_id
      )
  ]);

  await broadcast(env, "passenger_waiting_cancelled", {
    waitingId,    routeId: waiting.route_id
  });

  return ok({
    waitingId,
    status: "CANCELLED"
  });
}

async function conductorOpenLine(env, auth, body) {
  const operatorId = requireString(
    body.operatorId,
    "operatorId"
  );

  const routeId = requireString(
    body.routeId,
    "routeId"
  );

  const membership =
    await requireSpecificOperatorMembership(
      env,
      auth.user.id,
      operatorId,
      ["conductor", "operator_admin"]
    );

  await getAuthorizedOperatorRoute(
    env,
    operatorId,
    routeId
  );

  const serviceDate =
    body.serviceDate
      ? String(body.serviceDate)
      : new Date().toISOString().slice(0, 10);

  const existing = await env.DB.prepare(`
    SELECT id, status
    FROM line_sessions
    WHERE operator_id = ?
      AND route_id = ?
      AND service_date = ?
      AND status IN ('OPEN', 'ACTIVE')
    LIMIT 1
  `)
    .bind(
      operatorId,
      routeId,
      serviceDate
    )
    .first();

  if (existing) {
    return ok({
      line: await getLine(env, existing.id),
      existing: true
    });
  }

  const timestamp = now();
  const lineId = id("line");

  await env.DB.prepare(`
    INSERT INTO line_sessions
      (
        id,
        operator_id,
        route_id,
        service_date,
        status,
        opened_by,
        opened_at
      )
    VALUES (?, ?, ?, ?, 'OPEN', ?, ?)
  `)
    .bind(
      lineId,
      operatorId,
      routeId,
      serviceDate,
      auth.user.id,
      timestamp
    )
    .run();

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId: membership.operator_id,
    action: "LINE_OPENED",
    entityType: "line_session",
    entityId: lineId,
    details: {
      routeId,
      serviceDate
    }
  });

  await broadcast(env, "line_updated", {
    lineSessionId: lineId,
    routeId,
    operatorId
  });

  return ok({
    line: await getLine(env, lineId),
    existing: false
  });
}

async function conductorAddLineTaxi(env, auth, body) {
  const lineSessionId = requireString(
    body.lineSessionId,
    "lineSessionId"
  );

  const taxiId = requireString(
    body.taxiId,
    "taxiId"
  );

  const line = await getLine(
    env,
    lineSessionId
  );

  await requireSpecificOperatorMembership(
    env,
    auth.user.id,
    line.operator_id,
    ["conductor", "operator_admin"]
  );

  if (!["OPEN", "ACTIVE"].includes(line.status)) {
    throw new HttpError(
      "Loading line is not open.",
      409
    );
  }

  const taxi = await getTaxiForOperator(
    env,
    line.operator_id,
    taxiId
  );

  await getAuthorizedOperatorRoute(
    env,
    line.operator_id,
    line.route_id
  );

  await getTaxiRouteAuthorization(
    env,
    taxiId,
    line.route_id
  );

  const existing = await env.DB.prepare(`
    SELECT id, status, position
    FROM line_entries
    WHERE line_session_id = ?
      AND taxi_id = ?
      AND status NOT IN ('REMOVED', 'REPLACED')
    LIMIT 1
  `)
    .bind(
      lineSessionId,
      taxiId
    )
    .first();

  if (existing) {
    return ok({
      entry: existing,
      existing: true
    });
  }

  const maxPosition = await env.DB.prepare(`
    SELECT COALESCE(MAX(position), 0) AS max_position
    FROM line_entries
    WHERE line_session_id = ?
  `)
    .bind(lineSessionId)
    .first();

  const position =
    body.position == null
      ? Number(maxPosition?.max_position || 0) + 1
      : integer(
          body.position,
          "position",
          1
        );

  const timestamp = now();
  const entryId = id("lineentry");

  if (position <= Number(maxPosition?.max_position || 0)) {
    await env.DB.prepare(`
      UPDATE line_entries
      SET position = position + 1
      WHERE line_session_id = ?
        AND position >= ?
        AND status NOT IN ('REMOVED', 'REPLACED')
    `)
      .bind(
        lineSessionId,
        position
      )
      .run();
  }

  await env.DB.prepare(`
    INSERT INTO line_entries
      (
        id,
        line_session_id,
        taxi_id,
        position,
        status,
        joined_at
      )
    VALUES (?, ?, ?, ?, 'WAITING', ?)
  `)
    .bind(
      entryId,
      lineSessionId,
      taxiId,
      position,
      timestamp
    )
    .run();

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId: line.operator_id,
    action: "LINE_TAXI_ADDED",
    entityType: "line_entry",
    entityId: entryId,
    details: {
      lineSessionId,
      taxiId,
      position,
      registration: taxi.vehicle_registration_number
    }
  });

  await broadcast(env, "line_updated", {
    lineSessionId,
    routeId: line.route_id,
    operatorId: line.operator_id
  });

  return ok({
    entry: (
      await getLine(env, lineSessionId)
    ).entries.find(e => e.id === entryId),
    existing: false
  });
}

async function conductorRemoveLineTaxi(env, auth, body) {
  const lineEntryId = requireString(
    body.lineEntryId,
    "lineEntryId"
  );

  const entry = await env.DB.prepare(`
    SELECT
      le.*,
      ls.operator_id,
      ls.route_id,
      ls.status AS line_status
    FROM line_entries le
    JOIN line_sessions ls
      ON ls.id = le.line_session_id
    WHERE le.id = ?
    LIMIT 1
  `)
    .bind(lineEntryId)
    .first();

  if (!entry) {
    throw new HttpError("Line entry not found.", 404);
  }

  await requireSpecificOperatorMembership(
    env,
    auth.user.id,
    entry.operator_id,
    ["conductor", "operator_admin"]
  );

  if (
    ["DISPATCHED", "COMPLETED"].includes(entry.status)
  ) {
    throw new HttpError(
      "A dispatched/completed taxi cannot be removed from the line.",
      409
    );
  }

  const timestamp = now();

  await env.DB.prepare(`
    UPDATE line_entries
    SET
      status = 'REMOVED',
      removed_at = ?
    WHERE id = ?
  `)
    .bind(
      timestamp,
      lineEntryId
    )
    .run();

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId: entry.operator_id,
    action: "LINE_TAXI_REMOVED",
    entityType: "line_entry",
    entityId: lineEntryId,
    details: {
      taxiId: entry.taxi_id,
      routeId: entry.route_id
    }
  });

  await broadcast(env, "line_updated", {
    lineSessionId: entry.line_session_id,
    routeId: entry.route_id,
    operatorId: entry.operator_id
  });

  return ok({
    lineEntryId,
    status: "REMOVED"
  });
}

async function conductorReorderLine(env, auth, body) {
  const lineSessionId = requireString(
    body.lineSessionId,
    "lineSessionId"
  );

  const orderedTaxiIds = body.taxiIds;

  if (!Array.isArray(orderedTaxiIds) || orderedTaxiIds.length === 0) {
    throw new HttpError(
      "taxiIds must be a non-empty array.",
      400
    );
  }

  const line = await getLine(
    env,
    lineSessionId
  );

  await requireSpecificOperatorMembership(
    env,
    auth.user.id,
    line.operator_id,
    ["conductor", "operator_admin"]
  );

  const activeEntries = line.entries.filter(
    entry =>
      !["REMOVED", "REPLACED", "COMPLETED"].includes(
        entry.status
      )
  );

  const activeIds = new Set(
    activeEntries.map(entry => entry.taxi_id)
  );

  if (
    orderedTaxiIds.length !== activeIds.size ||
    orderedTaxiIds.some(taxiId => !activeIds.has(taxiId))
  ) {
    throw new HttpError(
      "Reorder list must contain every active taxi exactly once.",
      400
    );
  }

  const statements = [];

  let temporaryPosition = 1000000;

  for (const taxiId of orderedTaxiIds) {
    const entry = activeEntries.find(
      e => e.taxi_id === taxiId
    );

    statements.push(
      env.DB.prepare(`
        UPDATE line_entries
        SET position = ?
        WHERE id = ?
      `)
        .bind(
          temporaryPosition,
          entry.id
        )
    );

    temporaryPosition++;
  }

  let position = 1;

  for (const taxiId of orderedTaxiIds) {
    const entry = activeEntries.find(
      e => e.taxi_id === taxiId
    );

    statements.push(
      env.DB.prepare(`
        UPDATE line_entries
        SET position = ?
        WHERE id = ?
      `)
        .bind(
          position,
          entry.id
        )
    );

    position++;
  }

  await env.DB.batch(statements);

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId: line.operator_id,
    action: "LINE_REORDERED",
    entityType: "line_session",
    entityId: lineSessionId,
    details: {
      taxiIds: orderedTaxiIds
    }
  });

  await broadcast(env, "line_updated", {
    lineSessionId,
    routeId: line.route_id,
    operatorId: line.operator_id
  });

  return ok({
    line: await getLine(env, lineSessionId)
  });
}

async function conductorReplaceTaxi(env, auth, body) {
  const lineEntryId = requireString(
    body.lineEntryId,
    "lineEntryId"
  );

  const replacementTaxiId = requireString(
    body.replacementTaxiId,
    "replacementTaxiId"
  );

  const entry = await env.DB.prepare(`
    SELECT
      le.*,
      ls.operator_id,
      ls.route_id,
      ls.status AS line_status
    FROM line_entries le
    JOIN line_sessions ls
      ON ls.id = le.line_session_id
    WHERE le.id = ?
    LIMIT 1
  `)
    .bind(lineEntryId)
    .first();

  if (!entry) {
    throw new HttpError("Line entry not found.", 404);
  }

  await requireSpecificOperatorMembership(
    env,
    auth.user.id,
    entry.operator_id,
    ["conductor", "operator_admin"]
  );
  await getTaxiForOperator(
    env,
    entry.operator_id,
    replacementTaxiId
  );

  await getAuthorizedOperatorRoute(
    env,
    entry.operator_id,
    entry.route_id
  );

  await getTaxiRouteAuthorization(
    env,
    replacementTaxiId,
    entry.route_id
  );

  const timestamp = now();

  /*
   * line_entries has a UNIQUE constraint on
   * (line_session_id, position), and position must be >= 1.
   *
   * Move the existing entry to a temporary position above the
   * current maximum before inserting the replacement at the
   * original queue position.
   */
  const temporaryPositionRow = await env.DB.prepare(`
    SELECT COALESCE(MAX(position), 0) + 1 AS temporary_position
    FROM line_entries
    WHERE line_session_id = ?
  `)
    .bind(entry.line_session_id)
    .first();

  const temporaryPosition =
    Number(temporaryPositionRow?.temporary_position || 1);

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE line_entries
      SET position = ?
      WHERE id = ?
    `)
      .bind(
        temporaryPosition,
        lineEntryId
      ),

    env.DB.prepare(`
      UPDATE line_entries
      SET
        status = 'REPLACED',
        removed_at = ?
      WHERE id = ?
    `)
      .bind(
        timestamp,
        lineEntryId
      ),

    env.DB.prepare(`
      INSERT INTO line_entries
        (
          id,
          line_session_id,
          taxi_id,
          position,
          status,
          joined_at
        )
      VALUES (?, ?, ?, ?, 'WAITING', ?)
    `)
      .bind(
        id("lineentry"),
        entry.line_session_id,
        replacementTaxiId,
        entry.position,
        timestamp
      )
  ]);

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId: entry.operator_id,
    action: "LINE_TAXI_REPLACED",
    entityType: "line_entry",
    entityId: lineEntryId,
    details: {
      oldTaxiId: entry.taxi_id,
      replacementTaxiId,
      routeId: entry.route_id
    }
  });

  await broadcast(env, "line_updated", {
    lineSessionId: entry.line_session_id,
    routeId: entry.route_id,
    operatorId: entry.operator_id
  });

  return ok({
    line: await getLine(
      env,
      entry.line_session_id
    )
  });
}

async function conductorSummon(env, auth, body) {
  const operatorId = requireString(
    body.operatorId,
    "operatorId"
  );

  const routeId = requireString(
    body.routeId,
    "routeId"
  );

  const requestType = requireString(
    body.requestType || "ROUTE_DEMAND",
    "requestType"
  );

  if (!["ROUTE_DEMAND", "SPECIFIC_TAXI"].includes(requestType)) {
    throw new HttpError(
      "Invalid requestType.",
      400
    );
  }

  const passengerCount = integer(
    body.passengerCount ?? 1,
    "passengerCount",
    1,
    100
  );

  await requireSpecificOperatorMembership(
    env,
    auth.user.id,
    operatorId,
    ["conductor", "operator_admin"]
  );

  await getAuthorizedOperatorRoute(
    env,
    operatorId,
    routeId
  );

  let taxiId = null;

  if (requestType === "SPECIFIC_TAXI") {
    taxiId = requireString(
      body.taxiId,
      "taxiId"
    );

    await getTaxiForOperator(
      env,
      operatorId,
      taxiId
    );

    await getTaxiRouteAuthorization(
      env,
      taxiId,
      routeId
    );
  }

  const timestamp = now();
  const requestId = id("summon");

  await env.DB.prepare(`
    INSERT INTO route_summon_requests
      (
        id,
        route_id,
        taxi_id,
        conductor_id,
        passenger_count,
        request_type,
        status,
        created_at,
        updated_at
      )
    VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
  `)
    .bind(
      requestId,
      routeId,
      taxiId,
      auth.user.id,
      passengerCount,
      requestType,
      timestamp,
      timestamp
    )
    .run();

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId,
    action: "ROUTE_SUMMON_CREATED",
    entityType: "route_summon_request",
    entityId: requestId,
    details: {
      routeId,
      taxiId,
      passengerCount,
      requestType
    }
  });

  await broadcast(env, "route_summon", {
    requestId,
    routeId,
    taxiId,
    passengerCount,
    requestType
  });

  return ok({
    summon: {
      id: requestId,
      routeId,
      taxiId,
      passengerCount,
      requestType,
      status: "PENDING"
    }
  });
}

async function conductorDemand(env, auth, url) {
  const operatorId = url.searchParams.get("operatorId");
  const routeId = url.searchParams.get("routeId");

  if (!operatorId || !routeId) {
    throw new HttpError(
      "operatorId and routeId are required.",
      400
    );
  }

  await requireSpecificOperatorMembership(
    env,
    auth.user.id,
    operatorId,
    ["conductor", "operator_admin"]
  );

  await getAuthorizedOperatorRoute(
    env,
    operatorId,
    routeId
  );

  const waiting = await env.DB.prepare(`
    SELECT
      rw.id,
      rw.route_id,
      rw.pickup_point_id,
      rw.group_size,
      rw.status,
      rw.created_at,
      rw.updated_at,
      rw.assigned_trip_id,
      pp.name AS pickup_point_name,
      u.name AS passenger_name
    FROM route_waiting_passengers rw
    LEFT JOIN route_pickup_points pp
      ON pp.id = rw.pickup_point_id
    JOIN users u
      ON u.id = rw.passenger_id
    WHERE rw.route_id = ?
      AND rw.status IN ('WAITING', 'ASSIGNED')
    ORDER BY rw.created_at ASC
  `)
    .bind(routeId)
    .all();

  const signals = await env.DB.prepare(`
    SELECT
      ds.id,
      ds.group_size,
      ds.signal_type,
      ds.status,
      ds.created_at,
      ds.pickup_point_id,
      pp.name AS pickup_point_name
    FROM demand_signals ds
    LEFT JOIN route_pickup_points pp
      ON pp.id = ds.pickup_point_id
    WHERE ds.route_id = ?
      AND ds.status = 'ACTIVE'
    ORDER BY ds.created_at ASC
  `)
    .bind(routeId)
    .all();

  return ok({
    routeId,
    waiting: waiting.results || [],
    demandSignals: signals.results || []
  });
}

async function conductorStats(env, auth, url) {
  const operatorId = url.searchParams.get("operatorId");

  if (!operatorId) {
    throw new HttpError(
      "operatorId is required.",
      400
    );
  }

  await requireSpecificOperatorMembership(
    env,
    auth.user.id,
    operatorId,
    ["conductor", "operator_admin"]
  );

  const [taxis, trips, waiting, demand] =
    await Promise.all([
      env.DB.prepare(`
        SELECT COUNT(*) AS count
        FROM taxis
        WHERE operator_id = ?
          AND active = 1
      `)
        .bind(operatorId)
        .first(),

      env.DB.prepare(`
        SELECT COUNT(*) AS count
        FROM trips
        WHERE taxi_id IN (
          SELECT id
          FROM taxis
          WHERE operator_id = ?
        )
        AND status IN ('LOADING', 'COLLECTING', 'FULL', 'DEPARTED')
      `)
        .bind(operatorId)
        .first(),

      env.DB.prepare(`
        SELECT COALESCE(SUM(rw.group_size), 0) AS count
        FROM route_waiting_passengers rw
        JOIN routes r
          ON r.id = rw.route_id
        JOIN operator_routes orr
          ON orr.route_id = r.id
        WHERE orr.operator_id = ?
          AND orr.active = 1
          AND rw.status IN ('WAITING', 'ASSIGNED')
      `)
        .bind(operatorId)
        .first(),

      env.DB.prepare(`
        SELECT COALESCE(SUM(ds.group_size), 0) AS count
        FROM demand_signals ds
        JOIN operator_routes orr
          ON orr.route_id = ds.route_id
        WHERE orr.operator_id = ?
          AND orr.active = 1
          AND ds.status = 'ACTIVE'
      `)
        .bind(operatorId)
        .first()
    ]);

  return ok({
    operatorId,
    activeTaxis: Number(taxis?.count || 0),
    activeTrips: Number(trips?.count || 0),
    waitingPassengers: Number(waiting?.count || 0),
    activeDemand: Number(demand?.count || 0)
  });
}

async function conductorTaxiList(env, auth, url) {
  const operatorId = url.searchParams.get("operatorId");
  const routeId = url.searchParams.get("routeId");

  if (!operatorId) {
    throw new HttpError(
      "operatorId is required.",
      400
    );
  }

  await requireSpecificOperatorMembership(
    env,
    auth.user.id,
    operatorId,
    ["conductor", "operator_admin"]
  );

  if (routeId) {
    await getAuthorizedOperatorRoute(
      env,
      operatorId,
      routeId
    );
  }

  const result = await env.DB.prepare(`
    SELECT
      t.id,
      t.vehicle_registration_number,
      t.capacity,
      t.active,
      t.driver_id,
      t.driver_name,
      t.status,
      t.passengers_onboard,
      t.last_updated,
      EXISTS (
        SELECT 1
        FROM taxi_routes tr
        WHERE tr.taxi_id = t.id
          AND tr.route_id = ?
          AND tr.active = 1
      ) AS route_authorized
    FROM taxis t
    WHERE t.operator_id = ?
      AND t.active = 1
      AND (
        ? IS NULL
        OR EXISTS (
          SELECT 1
          FROM taxi_routes tr2
          WHERE tr2.taxi_id = t.id
            AND tr2.route_id = ?
            AND tr2.active = 1
        )
      )
    ORDER BY t.vehicle_registration_number
  `)
    .bind(
      routeId,
      operatorId,
      routeId,
      routeId
    )
    .all();

  return ok({
    operatorId,
    routeId,
    taxis: result.results || []
  });
}

async function operatorCreateTaxi(env, auth, body) {
  const operatorId = requireString(
    body.operatorId,
    "operatorId"
  );

  await requireSpecificOperatorMembership(
    env,
    auth.user.id,
    operatorId,
    ["operator_admin"]
  );

  const registration = normalizeRegistration(
    body.vehicleRegistrationNumber
  );

  if (!registration) {
    throw new HttpError(
      "vehicleRegistrationNumber is required.",
      400
    );
  }

  const capacity = integer(
    body.capacity,
    "capacity",
    1,
    100
  );

  const operator = await env.DB.prepare(`
    SELECT id, name
    FROM operators
    WHERE id = ?
      AND active = 1
    LIMIT 1  `)
    .bind(operatorId)
    .first();

  if (!operator) {
    throw new HttpError("Operator not found.", 404);
  }

  const existing = await env.DB.prepare(`
    SELECT id
    FROM taxis
    WHERE operator_id = ?
      AND vehicle_registration_number = ?
      AND active = 1
    LIMIT 1
  `)
    .bind(
      operatorId,
      registration
    )
    .first();

  if (existing) {
    throw new HttpError(
      "A taxi with this registration already exists for the operator.",
      409
    );
  }

  const timestamp = now();
  const taxiId = id("taxi");

  await env.DB.prepare(`
    INSERT INTO taxis
      (
        id,
        driver_id,
        driver_name,
        capacity,
        passengers_onboard,
        status,
        created_at,
        last_updated,
        operator_id,
        vehicle_registration_number,
        active
      )
    VALUES (?, NULL, NULL, ?, 0, 'OFFLINE', ?, ?, ?, ?, 1)
  `)
    .bind(
      taxiId,
      capacity,
      timestamp,
      timestamp,
      operatorId,
      registration
    )
    .run();

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId,
    action: "TAXI_CREATED",
    entityType: "taxi",
    entityId: taxiId,
    details: {
      vehicleRegistrationNumber: registration,
      capacity
    }
  });

  return ok({
    taxi: {
      id: taxiId,
      operatorId,
      vehicleRegistrationNumber: registration,
      capacity,
      active: 1
    }
  });
}

async function operatorAssignDriver(env, auth, body) {
  const operatorId = requireString(
    body.operatorId,
    "operatorId"
  );

  const taxiId = requireString(
    body.taxiId,
    "taxiId"
  );

  const driverId = requireString(
    body.driverId,
    "driverId"
  );

  await requireSpecificOperatorMembership(
    env,
    auth.user.id,
    operatorId,
    ["operator_admin"]
  );

  const taxi = await getTaxiForOperator(
    env,
    operatorId,
    taxiId
  );

  const driverMembership = await env.DB.prepare(`
    SELECT id
    FROM operator_memberships
    WHERE operator_id = ?
      AND user_id = ?
      AND membership_role = 'driver'
      AND active = 1
    LIMIT 1
  `)
    .bind(
      operatorId,
      driverId
    )
    .first();

  if (!driverMembership) {
    throw new HttpError(
      "Driver is not an active member of this operator.",
      403
    );
  }

  const driver = await env.DB.prepare(`
    SELECT id, name, role, active
    FROM users
    WHERE id = ?
      AND role = 'driver'
      AND active = 1
    LIMIT 1
  `)
    .bind(driverId)
    .first();

  if (!driver) {
    throw new HttpError("Driver not found.", 404);
  }

  const timestamp = now();

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE taxi_driver_assignments
      SET
        active = 0,
        ended_at = ?
      WHERE taxi_id = ?
        AND active = 1
    `)
      .bind(
        timestamp,
        taxiId
      ),

    env.DB.prepare(`
      INSERT INTO taxi_driver_assignments
        (
          id,
          taxi_id,
          driver_id,
          active,
          assigned_at
        )
      VALUES (?, ?, ?, 1, ?)
    `)
      .bind(
        id("assignment"),
        taxiId,
        driverId,
        timestamp
      ),

    env.DB.prepare(`
      UPDATE taxis
      SET
        driver_id = ?,
        driver_name = ?,
        last_updated = ?
      WHERE id = ?
    `)
      .bind(
        driverId,
        driver.name,
        timestamp,
        taxiId
      )
  ]);

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId,
    action: "DRIVER_ASSIGNED",
    entityType: "taxi",
    entityId: taxiId,
    details: {
      driverId,
      registration: taxi.vehicle_registration_number
    }
  });

  return ok({
    taxiId,
    driverId,
    driverName: driver.name
  });
}

async function operatorAuthorizeTaxiRoute(env, auth, body) {
  const operatorId = requireString(
    body.operatorId,
    "operatorId"
  );

  const taxiId = requireString(
    body.taxiId,
    "taxiId"
  );

  const routeId = requireString(
    body.routeId,
    "routeId"
  );

  await requireSpecificOperatorMembership(
    env,
    auth.user.id,
    operatorId,
    ["operator_admin"]
  );

  await getTaxiForOperator(
    env,
    operatorId,
    taxiId
  );

  await getAuthorizedOperatorRoute(
    env,
    operatorId,
    routeId
  );

  const timestamp = now();

  const existing = await env.DB.prepare(`
    SELECT id
    FROM taxi_routes
    WHERE taxi_id = ?
      AND route_id = ?
      AND active = 1
    LIMIT 1
  `)
    .bind(
      taxiId,
      routeId
    )
    .first();

  if (existing) {
    return ok({
      taxiRouteId: existing.id,
      existing: true
    });
  }

  const taxiRouteId = id("taxiroute");

  await env.DB.prepare(`
    INSERT INTO taxi_routes
      (
        id,
        taxi_id,
        route_id,
        active,
        authorized_at
      )
    VALUES (?, ?, ?, 1, ?)
  `)
    .bind(
      taxiRouteId,
      taxiId,
      routeId,
      timestamp
    )
    .run();

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId,
    action: "TAXI_ROUTE_AUTHORIZED",
    entityType: "taxi_route",
    entityId: taxiRouteId,
    details: {
      taxiId,
      routeId
    }
  });

  return ok({
    taxiRouteId,
    taxiId,
    routeId,
    active: 1
  });
}


async function superadminAssignOperatorAdmin(env, auth, body) {
  const operatorId = requireString(
    body.operatorId,
    "operatorId"
  );

  const userId = requireString(
    body.userId,
    "userId"
  );

  const operator = await env.DB.prepare(`
    SELECT id, name
    FROM operators
    WHERE id = ?
      AND active = 1
    LIMIT 1
  `)
    .bind(operatorId)
    .first();

  if (!operator) {
    throw new HttpError(
      "Operator not found.",
      404
    );
  }

  const user = await env.DB.prepare(`
    SELECT
      id,
      name,
      role,
      system_role,
      active
    FROM users
    WHERE id = ?
      AND active = 1
    LIMIT 1
  `)
    .bind(userId)
    .first();

  if (!user) {
    throw new HttpError(
      "User not found.",
      404
    );
  }

  if (user.system_role !== "operator_admin") {
    throw new HttpError(
      "User is not provisioned as an operator admin.",
      400
    );
  }

  const existing = await env.DB.prepare(`
    SELECT id
    FROM operator_memberships
    WHERE operator_id = ?
      AND user_id = ?
      AND membership_role = 'operator_admin'
      AND active = 1
    LIMIT 1
  `)
    .bind(
      operatorId,
      userId
    )
    .first();

  if (existing) {
    return ok({
      membershipId: existing.id,
      operatorId,
      userId,
      membershipRole: "operator_admin",
      existing: true
    });
  }

  const timestamp = now();
  const membershipId = id("membership");

  await env.DB.prepare(`
    INSERT INTO operator_memberships
      (
        id,
        operator_id,
        user_id,
        membership_role,
        active,
        created_at,
        updated_at
      )
    VALUES (?, ?, ?, 'operator_admin', 1, ?, ?)
  `)
    .bind(
      membershipId,
      operatorId,
      userId,
      timestamp,
      timestamp
    )
    .run();

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId,
    action: "OPERATOR_ADMIN_ASSIGNED",
    entityType: "operator_membership",
    entityId: membershipId,
    details: {
      userId,
      userName: user.name,
      membershipRole: "operator_admin"
    }
  });

  return ok({
    membershipId,
    operatorId,
    userId,
    membershipRole: "operator_admin",
    existing: false
  });
}

async function superadminCreateOperator(env, auth, body) {
  await requireRole(
    new Request(
      "https://internal/",
      {
        headers: {
          Authorization:
            auth.user
              ? `Bearer ${await createSession(env, auth.user)}`
              : ""
        }
      }
    ),
    env,
    ["superadmin"]
  );

  const name = requireString(
    body.name,
    "name"
  );

  const registrationNumber =
    body.registrationNumber
      ? String(body.registrationNumber).trim()
      : null;

  const phone = normalizePhone(body.phone);
  const email =
    body.email
      ? String(body.email).trim()
      : null;

  const address =
    body.address
      ? String(body.address).trim()
      : null;

  const timestamp = now();
  const operatorId = id("operator");

  await env.DB.prepare(`
    INSERT INTO operators
      (
        id,
        name,
        registration_number,
        phone,
        email,
        address,
        active,
        created_at,
        updated_at
      )    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `)
    .bind(
      operatorId,
      name,
      registrationNumber,
      phone,
      email,
      address,
      timestamp,
      timestamp
    )
    .run();

  await writeAudit(env, {
    actorUserId: auth.user.id,
    action: "OPERATOR_CREATED",
    entityType: "operator",
    entityId: operatorId,
    details: {
      name,
      registrationNumber
    }
  });

  return ok({
    operator: {
      id: operatorId,
      name,
      registrationNumber,
      phone,
      email,
      address,
      active: 1
    }
  });
}

async function superadminCreateRoute(env, auth, body) {
  const origin = requireString(
    body.origin,
    "origin"
  );

  const destination = requireString(
    body.destination,
    "destination"
  );

  const name =
    body.name
      ? String(body.name).trim()
      : `${origin} → ${destination}`;

  const serviceMode = requireString(
    body.serviceMode,
    "serviceMode"
  );

  if (
    ![
      "RANK_DEPARTURE",
      "COLLECTION",
      "HYBRID"
    ].includes(serviceMode)
  ) {
    throw new HttpError(
      "Invalid serviceMode.",
      400
    );
  }

  const timestamp = now();
  const routeId = id("route");

  const endpointPointType =
    serviceMode === "RANK_DEPARTURE"
      ? "RANK"
      : "PICKUP";

  const originPointId = id("pickup");
  const destinationPointId = id("pickup");

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO routes
        (
          id,
          origin,
          destination,
          name,
          service_mode,
          active,
          created_at,
          updated_at
        )
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `)
      .bind(
        routeId,
        origin,
        destination,
        name,
        serviceMode,
        timestamp,
        timestamp
      ),

    env.DB.prepare(`
      INSERT INTO route_pickup_points
        (
          id,
          route_id,
          name,
          point_type,
          sequence,
          active,
          created_at,
          updated_at
        )
      VALUES (?, ?, ?, ?, 0, 1, ?, ?)
    `)
      .bind(
        originPointId,
        routeId,
        origin,
        endpointPointType,
        timestamp,
        timestamp
      ),

    env.DB.prepare(`
      INSERT INTO route_pickup_points
        (
          id,
          route_id,
          name,
          point_type,
          sequence,
          active,
          created_at,
          updated_at
        )
      VALUES (?, ?, ?, ?, 1, 1, ?, ?)
    `)
      .bind(
        destinationPointId,
        routeId,
        destination,
        endpointPointType,
        timestamp,
        timestamp
      )
  ]);

  await writeAudit(env, {
    actorUserId: auth.user.id,
    action: "ROUTE_CREATED",
    entityType: "route",
    entityId: routeId,
    details: {
      origin,
      destination,
      serviceMode
    }
  });

  return ok({
    route: {
      id: routeId,
      origin,
      destination,
      name,
      serviceMode,
      active: 1,
      originPointId,
      destinationPointId
    }
  });
}

async function superadminAuthorizeOperatorRoute(
  env,
  auth,
  body
) {
  const operatorId = requireString(
    body.operatorId,
    "operatorId"
  );

  const routeId = requireString(
    body.routeId,
    "routeId"
  );

  const operator = await env.DB.prepare(`
    SELECT id, name
    FROM operators
    WHERE id = ?
      AND active = 1
    LIMIT 1
  `)
    .bind(operatorId)
    .first();

  if (!operator) {
    throw new HttpError(
      "Operator not found.",
      404
    );
  }

  await getRoute(
    env,
    routeId
  );

  const existing = await env.DB.prepare(`
    SELECT id
    FROM operator_routes
    WHERE operator_id = ?
      AND route_id = ?
      AND active = 1
    LIMIT 1
  `)
    .bind(
      operatorId,
      routeId
    )
    .first();

  if (existing) {
    return ok({
      operatorRouteId: existing.id,
      existing: true
    });
  }

  const timestamp = now();
  const operatorRouteId = id("oproute");

  await env.DB.prepare(`
    INSERT INTO operator_routes
      (
        id,
        operator_id,
        route_id,
        active,
        authorized_at
      )
    VALUES (?, ?, ?, 1, ?)
  `)
    .bind(
      operatorRouteId,
      operatorId,
      routeId,
      timestamp
    )
    .run();

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId,
    action: "OPERATOR_ROUTE_AUTHORIZED",
    entityType: "operator_route",
    entityId: operatorRouteId,
    details: {
      routeId
    }
  });

  return ok({
    operatorRouteId,
    operatorId,
    routeId,
    active: 1
  });
}

async function authLogin(env, body) {
  const role = requireString(
    body.role,
    "role"
  );

  const name = requireString(
    body.name,
    "name"
  );

  const pin = String(
    body.pin ?? ""
  ).trim();

  if (!pin) {
    throw new HttpError(
      "PIN is required.",
      400
    );
  }

  const pinMap = {
    driver: env.DRIVER_PIN,
    conductor: env.CONDUCTOR_PIN,
    operator_admin: env.OPERATOR_ADMIN_PIN,
    superadmin: env.SUPERADMIN_PIN
  };

  if (!pinMap[role]) {
    throw new HttpError(
      "Login role is not configured.",
      400
    );
  }

  if (pin !== pinMap[role]) {
    throw new HttpError(
      "Invalid PIN.",
      401
    );
  }

  let user;

  if (
    role === "operator_admin" ||
    role === "superadmin"
  ) {
    user = await env.DB.prepare(`
      SELECT
        id,
        name,
        role,
        system_role,
        active,
        phone,
        created_at,
        last_login_at,
        last_seen_at
      FROM users
      WHERE system_role = ?
        AND lower(name) = lower(?)
        AND active = 1
      LIMIT 1
    `)
      .bind(
        role,
        name
      )
      .first();
  } else {
    user = await env.DB.prepare(`
      SELECT
        id,
        name,
        role,
        system_role,
        active,
        phone,
        created_at,
        last_login_at,
        last_seen_at
      FROM users
      WHERE role = ?
        AND (system_role IS NULL OR system_role = '')
        AND lower(name) = lower(?)
        AND active = 1
      LIMIT 1
    `)
      .bind(
        role,
        name
      )
      .first();
  }

  if (!user) {
    throw new HttpError(
      "Account is not provisioned.",
      403
    );
  }

  const effectiveRole =
    user.system_role || user.role;

  if (effectiveRole !== role) {
    throw new HttpError(
      "Account role mismatch.",
      403
    );
  }

  user.role = effectiveRole;

  if (OPERATOR_ROLES.has(role)) {
    const memberships =
      await getOperatorMemberships(
        env,
        user.id
      );

    if (!memberships.results?.length) {
      throw new HttpError(
        "Account has no active operator membership.",
        403
      );
    }
  }

  // Authentication must not block on non-critical login telemetry.
  // The login token is authoritative; timestamp persistence is best-effort.
  // A transient D1 write must never make a valid login hang indefinitely.
  const token = await createSession(
    env,
    user
  );

  const memberships =
    role === "superadmin"
      ? []
      : (
          await getOperatorMemberships(
            env,
            user.id
          )
        ).results || [];

  // Persist login/seen timestamps with a hard timeout. If D1 is temporarily
  // slow, the successful authentication response is still returned.
  try {
    await Promise.race([
      env.DB.prepare(`
        UPDATE users
        SET
          last_login_at = ?,
          last_seen_at = ?
        WHERE id = ?
      `)
        .bind(
          now(),
          now(),
          user.id
        )
        .run(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Login timestamp update timed out.")),
          1500
        )
      )
    ]);
  } catch (error) {
    console.warn(
      "Login timestamp persistence skipped:",
      error?.message || error
    );
  }

  return ok({
    token,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      phone: user.phone
    },
    expiresIn: SESSION_TTL_SECONDS,
    memberships
  });
}



async function platformDashboard(env) {
  const queries = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM operators WHERE active = 1").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM routes WHERE active = 1").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE active = 1").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM taxis WHERE active = 1").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM trips WHERE status IN ('LOADING','COLLECTING','FULL','DEPARTED')").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM system_incidents WHERE status IN ('OPEN','ACKNOWLEDGED')").first()
  ]);
  return {
    operators: Number(queries[0]?.count || 0),
    routes: Number(queries[1]?.count || 0),
    users: Number(queries[2]?.count || 0),
    taxis: Number(queries[3]?.count || 0),
    activeTrips: Number(queries[4]?.count || 0),
    openIncidents: Number(queries[5]?.count || 0)
  };
}

async function platformOperators(env) {
  const result = await env.DB.prepare(`
    SELECT
      o.*,
      COUNT(DISTINCT om.user_id) FILTER (WHERE om.active = 1) AS member_count,
      COUNT(DISTINCT orr.route_id) FILTER (WHERE orr.active = 1) AS route_count,
      COUNT(DISTINCT t.id) FILTER (WHERE t.active = 1) AS taxi_count
    FROM operators o
    LEFT JOIN operator_memberships om ON om.operator_id = o.id
    LEFT JOIN operator_routes orr ON orr.operator_id = o.id
    LEFT JOIN taxis t ON t.operator_id = o.id
    GROUP BY o.id
    ORDER BY o.name
  `).all();
  return result.results || [];
}

async function platformRoutes(env) {
  const result = await env.DB.prepare(`
    SELECT
      r.*,
      COUNT(DISTINCT orr.operator_id) FILTER (WHERE orr.active = 1) AS operator_count,
      COUNT(DISTINCT tr.taxi_id) FILTER (WHERE tr.active = 1) AS authorized_taxi_count
    FROM routes r
    LEFT JOIN operator_routes orr ON orr.route_id = r.id
    LEFT JOIN taxi_routes tr ON tr.route_id = r.id    GROUP BY r.id
    ORDER BY r.name
  `).all();
  return result.results || [];
}

async function platformUsers(env) {
  const result = await env.DB.prepare(`
    SELECT
      u.id,
      u.name,
      u.role,
      u.system_role,
      u.phone,
      u.active,
      u.created_at,
      u.last_login_at,
      u.last_seen_at,
      GROUP_CONCAT(DISTINCT o.name) AS operators
    FROM users u
    LEFT JOIN operator_memberships om ON om.user_id = u.id AND om.active = 1
    LEFT JOIN operators o ON o.id = om.operator_id
    GROUP BY u.id
    ORDER BY u.name
  `).all();
  return result.results || [];
}

async function platformTaxis(env) {
  const result = await env.DB.prepare(`
    SELECT
      t.*,
      o.name AS operator_name,
      COUNT(DISTINCT tr.route_id) FILTER (WHERE tr.active = 1) AS authorized_route_count
    FROM taxis t
    LEFT JOIN operators o ON o.id = t.operator_id
    LEFT JOIN taxi_routes tr ON tr.taxi_id = t.id
    GROUP BY t.id
    ORDER BY o.name, t.vehicle_registration_number
  `).all();
  return result.results || [];
}

async function platformTrips(env) {
  const result = await env.DB.prepare(`
    SELECT
      tr.*,
      t.vehicle_registration_number,
      o.name AS operator_name,
      u.name AS driver_account_name
    FROM trips tr
    JOIN taxis t ON t.id = tr.taxi_id
    LEFT JOIN operators o ON o.id = t.operator_id
    LEFT JOIN users u ON u.id = t.driver_id
    ORDER BY tr.started_at DESC
    LIMIT 500
  `).all();
  return result.results || [];
}

async function platformAudit(env, url) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 200), 1), 500);
  const result = await env.DB.prepare(`
    SELECT
      a.*,
      u.name AS actor_name,
      o.name AS operator_name
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    LEFT JOIN operators o ON o.id = a.operator_id
    ORDER BY a.timestamp DESC
    LIMIT ?
  `).bind(limit).all();
  return result.results || [];
}

async function platformIncidents(env, url) {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 200), 1), 500);
  const result = await env.DB.prepare(`
    SELECT
      i.*,
      u.name AS resolved_by_name
    FROM system_incidents i
    LEFT JOIN users u ON u.id = i.resolved_by
    ORDER BY i.created_at DESC
    LIMIT ?
  `).bind(limit).all();
  return result.results || [];
}

async function recordIncident(env, {
  severity = "ERROR",
  source = "api",
  message,
  stack = null,
  requestPath = null,
  requestMethod = null,
  actorUserId = null,
  operatorId = null,
  metadata = {}
}) {
  try {
    await env.DB.prepare(`
      INSERT INTO system_incidents
        (id, severity, source, message, stack, request_path, request_method,
         actor_user_id, operator_id, metadata_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
    `).bind(
      id("incident"),
      severity,
      source,
      String(message || "Unknown error").slice(0, 4000),
      stack ? String(stack).slice(0, 12000) : null,
      requestPath,
      requestMethod,
      actorUserId,
      operatorId,
      JSON.stringify(metadata || {}),
      now()
    ).run();
  } catch {
    // Never mask the original failure with incident logging failure.
  }
}

async function setOperatorActive(env, auth, operatorId, active) {
  const operator = await env.DB.prepare("SELECT id, name FROM operators WHERE id = ? LIMIT 1").bind(operatorId).first();
  if (!operator) throw new HttpError("Operator not found.", 404);

  await env.DB.prepare("UPDATE operators SET active = ?, updated_at = ? WHERE id = ?")
    .bind(active ? 1 : 0, now(), operatorId).run();

  if (!active) {
    await env.DB.prepare("UPDATE operator_memberships SET active = 0, updated_at = ? WHERE operator_id = ?")
      .bind(now(), operatorId).run();
    await env.DB.prepare("UPDATE operator_routes SET active = 0, revoked_at = ? WHERE operator_id = ? AND active = 1")
      .bind(now(), operatorId).run();
    await env.DB.prepare("UPDATE taxis SET active = 0, last_updated = ? WHERE operator_id = ?")
      .bind(now(), operatorId).run();
  }

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId,
    action: active ? "OPERATOR_ACTIVATED" : "OPERATOR_DEACTIVATED",
    entityType: "operator",
    entityId: operatorId
  });

  return ok({ operatorId, active: active ? 1 : 0 });
}

async function setRouteActive(env, auth, routeId, active) {
  const route = await env.DB.prepare("SELECT id, name, active FROM routes WHERE id = ? LIMIT 1").bind(routeId).first();
  if (!route) throw new HttpError("Route not found.", 404);

  await env.DB.prepare("UPDATE routes SET active = ?, updated_at = ? WHERE id = ?")
    .bind(active ? 1 : 0, now(), routeId).run();

  if (!active) {
    await env.DB.prepare("UPDATE operator_routes SET active = 0, revoked_at = ? WHERE route_id = ? AND active = 1")
      .bind(now(), routeId).run();
    await env.DB.prepare("UPDATE taxi_routes SET active = 0, revoked_at = ? WHERE route_id = ? AND active = 1")
      .bind(now(), routeId).run();
  }

  await writeAudit(env, {
    actorUserId: auth.user.id,
    action: active ? "ROUTE_ACTIVATED" : "ROUTE_DEACTIVATED",
    entityType: "route",
    entityId: routeId
  });

  return ok({ routeId, active: active ? 1 : 0 });
}

async function createOperationalMember(env, auth, body) {
  const membership = await requireOperatorMembership(env, auth.user.id, ["operator_admin"]);
  const name = requireString(body.name, "name");
  const role = requireString(body.role, "role");
  if (!["driver", "conductor"].includes(role)) {
    throw new HttpError("role must be driver or conductor.", 400);
  }

  const phone = normalizePhone(body.phone);
  const userId = id(role);
  const timestamp = now();

  await env.DB.prepare(`
    INSERT INTO users (id, name, role, active, created_at, last_seen_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).bind(userId, name, role, timestamp, timestamp).run();

  await env.DB.prepare(`
    INSERT INTO operator_memberships
      (id, operator_id, user_id, membership_role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `).bind(id("membership"), membership.operator_id, userId, role, timestamp, timestamp).run();

  if (phone) {
    await env.DB.prepare("UPDATE users SET phone = ? WHERE id = ?").bind(phone, userId).run();
  }

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId: membership.operator_id,
    action: "OPERATIONAL_MEMBER_CREATED",
    entityType: "user",
    entityId: userId,
    details: { role, phone }
  });

  return ok({ user: { id: userId, name, role, phone, active: 1 } });
}

async function setMemberActive(env, auth, userId, active) {
  const membership = await requireOperatorMembership(env, auth.user.id, ["operator_admin"]);
  const member = await env.DB.prepare(`
    SELECT id, membership_role FROM operator_memberships
    WHERE operator_id = ? AND user_id = ?
    LIMIT 1
  `).bind(membership.operator_id, userId).first();

  if (!member) throw new HttpError("Operator member not found.", 404);

  await env.DB.prepare("UPDATE users SET active = ? WHERE id = ?")
    .bind(active ? 1 : 0, userId).run();
  await env.DB.prepare("UPDATE operator_memberships SET active = ?, updated_at = ? WHERE operator_id = ? AND user_id = ?")
    .bind(active ? 1 : 0, now(), membership.operator_id, userId).run();

  if (!active && member.membership_role === "driver") {
    await env.DB.prepare("UPDATE taxi_driver_assignments SET active = 0, ended_at = ? WHERE driver_id = ? AND active = 1")
      .bind(now(), userId).run();
  }

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId: membership.operator_id,
    action: active ? "MEMBER_ACTIVATED" : "MEMBER_DEACTIVATED",
    entityType: "user",
    entityId: userId
  });

  return ok({ userId, active: active ? 1 : 0 });
}

async function operatorOverview(env, auth) {
  const membership = await requireOperatorMembership(env, auth.user.id, ["operator_admin"]);
  const operatorId = membership.operator_id;

  const [operator, members, taxis, routes, activeTrips] = await Promise.all([
    env.DB.prepare("SELECT * FROM operators WHERE id = ? LIMIT 1").bind(operatorId).first(),
    env.DB.prepare(`
      SELECT u.id,u.name,u.role,u.phone,u.active,om.membership_role
      FROM operator_memberships om JOIN users u ON u.id=om.user_id
      WHERE om.operator_id=? ORDER BY u.name
    `).bind(operatorId).all(),
    env.DB.prepare(`
      SELECT t.*, COUNT(DISTINCT tr.route_id) FILTER (WHERE tr.active=1) AS authorized_route_count
      FROM taxis t LEFT JOIN taxi_routes tr ON tr.taxi_id=t.id
      WHERE t.operator_id=? GROUP BY t.id ORDER BY t.vehicle_registration_number
    `).bind(operatorId).all(),
    env.DB.prepare(`
      SELECT r.*, orr.active AS authorized
      FROM operator_routes orr JOIN routes r ON r.id=orr.route_id
      WHERE orr.operator_id=? ORDER BY r.name
    `).bind(operatorId).all(),
    env.DB.prepare(`
      SELECT COUNT(*) AS count FROM trips tr JOIN taxis t ON t.id=tr.taxi_id
      WHERE t.operator_id=? AND tr.status IN ('LOADING','COLLECTING','FULL','DEPARTED')
    `).bind(operatorId).first()
  ]);

  return ok({
    operator,
    members: members.results || [],
    taxis: taxis.results || [],
    routes: routes.results || [],
    activeTrips: Number(activeTrips?.count || 0)
  });
}

async function operatorRoutePoints(env, auth, routeId) {
  const membership = await requireOperatorMembership(env, auth.user.id, ["operator_admin"]);
  await getAuthorizedOperatorRoute(env, membership.operator_id, routeId);
  const route = await getRoute(env, routeId);
  return ok({ route, pickupPoints: route.pickupPoints });
}

async function upsertOperatorRoutePoint(env, auth, body) {
  const membership = await requireOperatorMembership(env, auth.user.id, ["operator_admin"]);
  const routeId = requireString(body.routeId, "routeId");
  await getAuthorizedOperatorRoute(env, membership.operator_id, routeId);
  const pointType = requireString(body.pointType, "pointType");
  if (!["RANK","PICKUP","DROP_OFF"].includes(pointType)) throw new HttpError("Invalid pointType.", 400);
  const name = requireString(body.name, "name");
  const pointId = body.id ? String(body.id) : id("pickup");
  const timestamp = now();

  if (body.id) {
    const existing = await env.DB.prepare("SELECT id FROM route_pickup_points WHERE id=? AND route_id=? LIMIT 1")
      .bind(pointId, routeId).first();
    if (!existing) throw new HttpError("Route point not found.", 404);
    await env.DB.prepare(`
      UPDATE route_pickup_points
      SET name=?, point_type=?, sequence=?, latitude=?, longitude=?, address=?, active=?, updated_at=?
      WHERE id=? AND route_id=?
    `).bind(
      name, pointType, Number(body.sequence ?? 0),
      body.latitude == null ? null : Number(body.latitude),
      body.longitude == null ? null : Number(body.longitude),
      body.address ? String(body.address).trim() : null,
      body.active === false ? 0 : 1, timestamp, pointId, routeId
    ).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO route_pickup_points
        (id,route_id,name,point_type,sequence,latitude,longitude,address,active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,1,?,?)
    `).bind(
      pointId, routeId, name, pointType, Number(body.sequence ?? 0),
      body.latitude == null ? null : Number(body.latitude),
      body.longitude == null ? null : Number(body.longitude),
      body.address ? String(body.address).trim() : null, timestamp, timestamp
    ).run();
  }

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId: membership.operator_id,
    action: body.id ? "ROUTE_POINT_UPDATED" : "ROUTE_POINT_CREATED",
    entityType: "route_pickup_point",
    entityId: pointId,
    details: { routeId, pointType, name }
  });

  return ok({ point: await env.DB.prepare("SELECT * FROM route_pickup_points WHERE id=? LIMIT 1").bind(pointId).first() });
}

async function deactivateTaxi(env, auth, taxiId, active) {
  const membership = await requireOperatorMembership(env, auth.user.id, ["operator_admin"]);
  const taxi = await getTaxiForOperator(env, membership.operator_id, taxiId);

  await env.DB.prepare("UPDATE taxis SET active=?, last_updated=? WHERE id=?")
    .bind(active ? 1 : 0, now(), taxiId).run();

  if (!active) {
    await env.DB.prepare("UPDATE taxi_routes SET active=0, revoked_at=? WHERE taxi_id=? AND active=1")
      .bind(now(), taxiId).run();
    await env.DB.prepare("UPDATE taxi_driver_assignments SET active=0, ended_at=? WHERE taxi_id=? AND active=1")
      .bind(now(), taxiId).run();
  }

  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId: membership.operator_id,
    action: active ? "TAXI_ACTIVATED" : "TAXI_DEACTIVATED",
    entityType: "taxi",
    entityId: taxiId,
    details: { registration: taxi.vehicle_registration_number }
  });

  return ok({ taxiId, active: active ? 1 : 0 });
}

async function operatorRevokeRoute(env, auth, routeId) {
  const membership = await requireOperatorMembership(env, auth.user.id, ["operator_admin"]);
  await getAuthorizedOperatorRoute(env, membership.operator_id, routeId);
  await env.DB.prepare("UPDATE operator_routes SET active=0, revoked_at=? WHERE operator_id=? AND route_id=?")
    .bind(now(), membership.operator_id, routeId).run();
  await writeAudit(env, {
    actorUserId: auth.user.id,
    operatorId: membership.operator_id,
    action: "OPERATOR_ROUTE_REVOKED",
    entityType: "operator_route",
    entityId: routeId
  });
  return ok({ operatorId: membership.operator_id, routeId, active: 0 });
}

async function platformHealth(env) {
  const [incidents, activeTrips, waiting, demand] = await Promise.all([
    env.DB.prepare("SELECT severity, COUNT(*) AS count FROM system_incidents WHERE status='OPEN' GROUP BY severity").all(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM trips WHERE status IN ('LOADING','COLLECTING','FULL','DEPARTED')").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM route_waiting_passengers WHERE status='WAITING'").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM demand_signals WHERE signal_type='DEMAND' AND status='ACTIVE'").first()
  ]);
  return ok({
    status: "OK",
    activeTrips: Number(activeTrips?.count || 0),
    waitingPassengers: Number(waiting?.count || 0),
    activeDemandSignals: Number(demand?.count || 0),
    openIncidents: incidents.results || []
  });
}

async function superadminCreateOperatorAdmin(env, auth, body) {
  const operatorId = requireString(body.operatorId, "operatorId");
  const name = requireString(body.name, "name");
  const phone = normalizePhone(body.phone);
  const operator = await env.DB.prepare("SELECT id, name FROM operators WHERE id=? AND active=1 LIMIT 1").bind(operatorId).first();
  if (!operator) throw new HttpError("Operator not found.", 404);

  const userId = id("operator_admin");
  const timestamp = now();
  await env.DB.prepare(`
    INSERT INTO users (id,name,role,system_role,active,created_at,last_seen_at)
    VALUES (?,?,'passenger','operator_admin',1,?,?)
  `).bind(userId,name,timestamp,timestamp).run();
  if (phone) await env.DB.prepare("UPDATE users SET phone=? WHERE id=?").bind(phone,userId).run();

  const membershipId = id("membership");
  await env.DB.prepare(`
    INSERT INTO operator_memberships
      (id,operator_id,user_id,membership_role,active,created_at,updated_at)
    VALUES (?, ?, ?, 'operator_admin', 1, ?, ?)
  `).bind(membershipId,operatorId,userId,timestamp,timestamp).run();

  await writeAudit(env,{actorUserId:auth.user.id,operatorId,action:"OPERATOR_ADMIN_CREATED",entityType:"user",entityId:userId,details:{name,phone}});
  return ok({user:{id:userId,name,role:"operator_admin",phone,active:1},membershipId});
}

async function operatorAssignDriverToTaxi(env, auth, body) {
  const operatorId=requireString(body.operatorId,"operatorId");
  const taxiId=requireString(body.taxiId,"taxiId");
  const driverId=requireString(body.driverId,"driverId");
  await requireSpecificOperatorMembership(env,auth.user.id,operatorId,["operator_admin"]);
  await getTaxiForOperator(env,operatorId,taxiId);
  const driver=await env.DB.prepare(`
    SELECT u.id,u.name FROM users u
    JOIN operator_memberships om ON om.user_id=u.id
    WHERE u.id=? AND om.operator_id=? AND om.membership_role='driver'
      AND om.active=1 AND u.active=1 LIMIT 1
  `).bind(driverId,operatorId).first();
  if(!driver) throw new HttpError("Driver is not an active member of this operator.",403);

  await env.DB.prepare("UPDATE taxi_driver_assignments SET active=0, ended_at=? WHERE taxi_id=? AND active=1")
    .bind(now(),taxiId).run();
  await env.DB.prepare("UPDATE taxis SET driver_id=?,driver_name=?,last_updated=? WHERE id=?")
    .bind(driverId,driver.name,now(),taxiId).run();
  await env.DB.prepare(`
    INSERT INTO taxi_driver_assignments (id,taxi_id,driver_id,active,assigned_at)
    VALUES (?,?,?,1,?)
  `).bind(id("assignment"),taxiId,driverId,now()).run();

  await writeAudit(env,{actorUserId:auth.user.id,operatorId,action:"DRIVER_ASSIGNED_TO_TAXI",entityType:"taxi",entityId:taxiId,details:{driverId,driverName:driver.name}});
  return ok({taxiId,driverId,driverName:driver.name});
}

async function operatorAuthorizeTaxiRouteFromAdmin(env, auth, body) {
  const operatorId=requireString(body.operatorId,"operatorId");
  const taxiId=requireString(body.taxiId,"taxiId");
  const routeId=requireString(body.routeId,"routeId");
  await requireSpecificOperatorMembership(env,auth.user.id,operatorId,["operator_admin"]);
  await getTaxiForOperator(env,operatorId,taxiId);
  await getAuthorizedOperatorRoute(env,operatorId,routeId);
  return await operatorAuthorizeTaxiRoute(env,auth,body);
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/health" && method === "GET") {
    return ok({
      service: "taxiconnect-api",
      environment: env.APP_ENV || "development",
      model: "route-first",
      timestamp: now()
    });
  }

  if (path === "/api/routes" && method === "GET") {
    return ok({
      routes: await routeList(env)
    });
  }

  const routeMatch =
    path.match(/^\/api\/routes\/([^/]+)$/);

  if (routeMatch && method === "GET") {
    const routeId = routeMatch[1];

    return ok({
      availability:
        await publicAvailability(
          env,
          routeId
        )
    });
  }

  if (
    path === "/api/auth/login" &&
    method === "POST"
  ) {
    const body = await readJson(request);

    return await authLogin(
      env,      body
    );
  }

  if (
    path === "/api/auth/me" &&
    method === "GET"
  ) {
    const auth =
      await requireAuth(
        request,
        env
      );

    return ok({
      authenticated: true,
      user: auth.user,
      memberships:
        auth.user.role === "superadmin"
          ? []
          : (
              await getOperatorMemberships(
                env,
                auth.user.id
              )
            ).results || []
    });
  }

  if (
    path === "/api/auth/logout" &&
    method === "POST"
  ) {
    return ok({
      loggedOut: true,
      cookie: `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`
    });
  }

  if (path === "/api/superadmin/operator-admin/create" && method === "POST") {
    const auth = await requireRole(request, env, ["superadmin"]);
    return await superadminCreateOperatorAdmin(env, auth, await readJson(request));
  }

  if (path === "/api/operator/taxi/assign-driver" && method === "POST") {
    const auth = await requireRole(request, env, ["operator_admin"]);
    return await operatorAssignDriverToTaxi(env, auth, await readJson(request));
  }

  if (path === "/api/operator/taxi/authorize-route" && method === "POST") {
    const auth = await requireRole(request, env, ["operator_admin"]);
    return await operatorAuthorizeTaxiRouteFromAdmin(env, auth, await readJson(request));
  }

  if (path === "/api/superadmin/dashboard" && method === "GET") {
    await requireRole(request, env, ["superadmin"]);
    return ok({ dashboard: await platformDashboard(env) });
  }

  if (path === "/api/superadmin/operators" && method === "GET") {
    await requireRole(request, env, ["superadmin"]);
    return ok({ operators: await platformOperators(env) });
  }

  if (path === "/api/superadmin/routes" && method === "GET") {
    await requireRole(request, env, ["superadmin"]);
    return ok({ routes: await platformRoutes(env) });
  }

  if (path === "/api/superadmin/users" && method === "GET") {
    await requireRole(request, env, ["superadmin"]);
    return ok({ users: await platformUsers(env) });
  }

  if (path === "/api/superadmin/taxis" && method === "GET") {
    await requireRole(request, env, ["superadmin"]);
    return ok({ taxis: await platformTaxis(env) });
  }

  if (path === "/api/superadmin/trips" && method === "GET") {
    await requireRole(request, env, ["superadmin"]);
    return ok({ trips: await platformTrips(env) });
  }

  if (path === "/api/superadmin/audit" && method === "GET") {
    await requireRole(request, env, ["superadmin"]);
    return ok({ audit: await platformAudit(env, url) });
  }

  if (path === "/api/superadmin/incidents" && method === "GET") {
    await requireRole(request, env, ["superadmin"]);
    return ok({ incidents: await platformIncidents(env, url) });
  }

  if (path === "/api/superadmin/incident/status" && method === "POST") {
    const auth = await requireRole(request, env, ["superadmin"]);
    const body = await readJson(request);
    const incidentId = requireString(body.incidentId, "incidentId");
    const status = requireString(body.status, "status");
    if (!["OPEN","ACKNOWLEDGED","RESOLVED"].includes(status)) {
      throw new HttpError("Invalid incident status.", 400);
    }
    const timestamp = now();
    const fields = status === "ACKNOWLEDGED"
      ? "status = ?, acknowledged_at = ?"
      : status === "RESOLVED"
        ? "status = ?, resolved_at = ?, resolved_by = ?"
        : "status = ?";
    const values = status === "ACKNOWLEDGED"
      ? [status, timestamp, incidentId]
      : status === "RESOLVED"
        ? [status, timestamp, auth.user.id, incidentId]
        : [status, incidentId];
    await env.DB.prepare(
      `UPDATE system_incidents SET ${fields} WHERE id = ?`
    ).bind(...values).run();
    await writeAudit(env, {
      actorUserId: auth.user.id,
      action: "INCIDENT_STATUS_CHANGED",
      entityType: "system_incident",
      entityId: incidentId,
      details: { status }
    });
    return ok({ incidentId, status });
  }

  if (path === "/api/superadmin/health" && method === "GET") {
    await requireRole(request, env, ["superadmin"]);
    return await platformHealth(env);
  }

  if (path === "/api/superadmin/operator/status" && method === "POST") {
    const auth = await requireRole(request, env, ["superadmin"]);
    const body = await readJson(request);
    return await setOperatorActive(env, auth, requireString(body.operatorId, "operatorId"), body.active !== false);
  }

  if (path === "/api/superadmin/route/status" && method === "POST") {
    const auth = await requireRole(request, env, ["superadmin"]);
    const body = await readJson(request);
    return await setRouteActive(env, auth, requireString(body.routeId, "routeId"), body.active !== false);
  }

  if (path === "/api/operator/overview" && method === "GET") {
    const auth = await requireRole(request, env, ["operator_admin"]);
    return await operatorOverview(env, auth);
  }

  if (path === "/api/operator/members/create" && method === "POST") {
    const auth = await requireRole(request, env, ["operator_admin"]);
    return await createOperationalMember(env, auth, await readJson(request));
  }

  if (path === "/api/operator/member/status" && method === "POST") {
    const auth = await requireRole(request, env, ["operator_admin"]);
    const body = await readJson(request);
    return await setMemberActive(env, auth, requireString(body.userId, "userId"), body.active !== false);
  }

  if (path === "/api/operator/taxi/status" && method === "POST") {
    const auth = await requireRole(request, env, ["operator_admin"]);
    const body = await readJson(request);
    return await deactivateTaxi(env, auth, requireString(body.taxiId, "taxiId"), body.active !== false);
  }

  if (path === "/api/operator/route/revoke" && method === "POST") {
    const auth = await requireRole(request, env, ["operator_admin"]);
    const body = await readJson(request);
    return await operatorRevokeRoute(env, auth, requireString(body.routeId, "routeId"));
  }

  if (path === "/api/operator/route-points" && method === "GET") {
    const auth = await requireRole(request, env, ["operator_admin"]);
    return await operatorRoutePoints(env, auth, requireString(url.searchParams.get("routeId"), "routeId"));
  }

  if (path === "/api/operator/route-points" && method === "POST") {
    const auth = await requireRole(request, env, ["operator_admin"]);
    return await upsertOperatorRoutePoint(env, auth, await readJson(request));
  }

  if (
    path === "/api/driver/session" &&
    method === "GET"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["driver"]
      );

    return ok({
      authenticated: true,
      user: auth.user,
      assignments:
        await getDriverAssignment(
          env,
          auth.user.id
        ),
      routes:
        await driverRoutes(
          env,
          auth.user.id
        )
    });
  }

  if (
    path === "/api/driver/taxis" &&
    method === "GET"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["driver"]
      );

    return ok({
      taxis:
        await getDriverAssignment(
          env,
          auth.user.id
        )
    });
  }

  if (
    path === "/api/driver/routes" &&
    method === "GET"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["driver"]
      );

    return ok({
      routes:
        await driverRoutes(
          env,
          auth.user.id
        )
    });
  }

  if (
    path === "/api/driver/go-live" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["driver"]
      );

    return await startDriverTrip(
      env,
      auth,
      await readJson(request)
    );
  }

  if (
    path === "/api/driver/passengers" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["driver"]
      );

    return await updateDriverPassengers(
      env,
      auth,
      await readJson(request)
    );
  }

  if (
    path === "/api/driver/status" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["driver"]
      );

    return await updateDriverTripStatus(
      env,
      auth,
      await readJson(request)
    );
  }

  if (
    path === "/api/driver/offline" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["driver"]
      );

    const body =
      await readJson(request);

    return await updateDriverTripStatus(
      env,
      auth,
      {
        ...body,
        status: "OFFLINE"
      }
    );
  }

  if (
    path === "/api/passenger/waiting" &&
    method === "POST"
  ) {
    return await passengerWaiting(
      env,
      request,
      await readJson(request)
    );
  }

  if (
    path === "/api/passenger/demand" &&
    method === "POST"
  ) {
    return await passengerDemand(
      env,
      request,
      await readJson(request)
    );
  }

  if (
    path === "/api/passenger/cancel-waiting" &&
    method === "POST"
  ) {
    return await passengerCancelWaiting(
      env,
      request,
      await readJson(request)
    );
  }

  if (
    path === "/api/conductor/session" &&
    method === "GET"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["conductor", "operator_admin"]
      );

    return ok({
      authenticated: true,
      user: auth.user,
      memberships:
        (
          await getOperatorMemberships(
            env,
            auth.user.id
          )
        ).results || []
    });
  }

  if (
    path === "/api/conductor/line/open" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["conductor", "operator_admin"]
      );

    return await conductorOpenLine(
      env,
      auth,
      await readJson(request)
    );
  }

  if (
    path === "/api/conductor/line/add" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["conductor", "operator_admin"]
      );

    return await conductorAddLineTaxi(
      env,
      auth,
      await readJson(request)
    );
  }

  if (
    path === "/api/conductor/line/remove" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["conductor", "operator_admin"]
      );

    return await conductorRemoveLineTaxi(
      env,
      auth,
      await readJson(request)
    );
  }

  if (
    path === "/api/conductor/line/reorder" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["conductor", "operator_admin"]
      );

    return await conductorReorderLine(
      env,
      auth,
      await readJson(request)
    );
  }

  if (
    path === "/api/conductor/line/replace" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["conductor", "operator_admin"]
      );

    return await conductorReplaceTaxi(
      env,
      auth,
      await readJson(request)
    );
  }

  if (
    path === "/api/conductor/line" &&
    method === "GET"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["conductor", "operator_admin"]
      );

    const lineSessionId =
      url.searchParams.get(
        "lineSessionId"
      );

    const operatorId =
      url.searchParams.get(
        "operatorId"
      );

    const routeId =
      url.searchParams.get(
        "routeId"
      );

    if (lineSessionId) {      const line =
        await getLine(
          env,
          lineSessionId
        );

      await requireSpecificOperatorMembership(
        env,
        auth.user.id,
        line.operator_id,
        ["conductor", "operator_admin"]
      );

      return ok({ line });
    }

    if (!operatorId || !routeId) {
      throw new HttpError(
        "lineSessionId or operatorId + routeId is required.",
        400
      );
    }

    await requireSpecificOperatorMembership(
      env,
      auth.user.id,
      operatorId,
      ["conductor", "operator_admin"]
    );

    const line =
      await getOpenLineForRoute(
        env,
        operatorId,
        routeId
      );

    return ok({
      line: line
        ? await getLine(env, line.id)
        : null
    });
  }

  if (
    path === "/api/conductor/taxis" &&
    method === "GET"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["conductor", "operator_admin"]
      );

    return await conductorTaxiList(
      env,
      auth,
      url
    );
  }

  if (
    path === "/api/conductor/demand" &&
    method === "GET"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["conductor", "operator_admin"]
      );

    return await conductorDemand(
      env,
      auth,
      url
    );
  }

  if (
    path === "/api/conductor/stats" &&
    method === "GET"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["conductor", "operator_admin"]
      );

    return await conductorStats(
      env,
      auth,
      url
    );
  }

  if (
    path === "/api/conductor/summon" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["conductor", "operator_admin"]
      );

    return await conductorSummon(
      env,
      auth,
      await readJson(request)
    );
  }

  if (
    path === "/api/operator/taxi/create" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["operator_admin"]
      );

    return await operatorCreateTaxi(
      env,
      auth,
      await readJson(request)
    );
  }

  if (
    path === "/api/operator/driver/assign" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["operator_admin"]
      );

    return await operatorAssignDriver(
      env,
      auth,
      await readJson(request)
    );
  }

  if (
    path === "/api/operator/taxi/authorize-route" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["operator_admin"]
      );

    return await operatorAuthorizeTaxiRoute(
      env,
      auth,
      await readJson(request)
    );
  }

  if (
    path === "/api/superadmin/operator/create" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["superadmin"]
      );

    return await superadminCreateOperator(
      env,
      auth,
      await readJson(request)
    );
  }

  if (
    path === "/api/superadmin/route/create" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["superadmin"]
      );

    return await superadminCreateRoute(
      env,
      auth,
      await readJson(request)
    );
  }

  if (
    path === "/api/superadmin/operator/assign-admin" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["superadmin"]
      );

    return await superadminAssignOperatorAdmin(
      env,
      auth,
      await readJson(request)
    );
  }

  if (
    path === "/api/superadmin/operator/authorize-route" &&
    method === "POST"
  ) {
    const auth =
      await requireRole(
        request,
        env,
        ["superadmin"]
      );

    return await superadminAuthorizeOperatorRoute(
      env,
      auth,
      await readJson(request)
    );
  }

  if (
    path === "/ws" &&
    method === "GET"
  ) {
    const stub = env.DISPATCH.get(
      env.DISPATCH.idFromName("global")
    );

    return stub.fetch(request);
  }

  return null;
}

export class DispatchRoom {
  constructor(state) {
    this.state = state;
    this.sockets = new Set();

    this.state.getWebSockets().forEach(socket => {
      this.sockets.add(socket);
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (
      request.method === "POST" &&
      url.pathname === "/broadcast"
    ) {
      const payload = await request.json();

      const message = JSON.stringify({
        type: payload.type,
        timestamp: now(),
        ...payload
      });

      for (const socket of [...this.sockets]) {
        try {
          socket.send(message);
        } catch {
          this.sockets.delete(socket);
        }
      }

      return new Response("ok");
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket endpoint", {
        status: 426
      });
    }

    const pair = new WebSocketPair();

    const client = pair[0];
    const server = pair[1];

    this.state.acceptWebSocket(server);
    this.sockets.add(server);

    server.addEventListener(
      "close",
      () => {
        this.sockets.delete(server);
      }
    );

    server.addEventListener(
      "error",
      () => {
        this.sockets.delete(server);
      }
    );

    server.send(JSON.stringify({
      type: "connected",
      timestamp: now()
    }));

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  webSocketClose(ws) {
    this.sockets.delete(ws);
  }

  webSocketError(ws) {
    this.sockets.delete(ws);
  }
}

export default {
  async fetch(request, env) {
    try {
      if (
        request.method === "OPTIONS"
      ) {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers":
              "Content-Type, Authorization, X-Passenger-Id",
            "Access-Control-Allow-Methods":
              "GET, POST, PUT, DELETE, OPTIONS"
          }
        });
      }

      const url = new URL(request.url);

      // WebSocket upgrades must be returned directly.
      // Do not reconstruct the 101 response with new Response(),
      // because Cloudflare WebSocket handshakes use status 101.
      if (
        url.pathname === "/ws" &&
        request.method === "GET"
      ) {
        return await handleApi(
          request,
          env
        );
      }

      if (
        url.pathname.startsWith("/api/")
      ) {
        const response =
          await handleApi(
            request,
            env
          );

        if (response) {
          const headers =
            new Headers(
              response.headers
            );

          headers.set(
            "Access-Control-Allow-Origin",
            "*"
          );

          headers.set(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-Passenger-Id"
          );

          headers.set(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, DELETE, OPTIONS"
          );

          return new Response(
            response.body,
            {
              status: response.status,
              headers
            }
          );
        }
      }

      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response("Not Found", {
        status: 404
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return fail(
          error.message,
          error.status
        );
      }

      console.error(error);

      const requestUrl = new URL(request.url);

      // Incident persistence is observability, not request-critical work.
      // Never let a D1/incident write prevent the client from receiving 500.
      try {
        await Promise.race([
          recordIncident(env, {
            severity: "ERROR",
            source: "worker",
            message: error?.message || "Internal server error.",
            stack: error?.stack || null,
            requestPath: requestUrl.pathname,
            requestMethod: request.method
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Incident persistence timed out.")),
              1000
            )
          )
        ]);
      } catch (incidentError) {
        console.error(
          "Incident persistence skipped:",
          incidentError?.message || incidentError
        );
      }

      return fail(
        "Internal server error.",
        500
      );
    }
  }
};