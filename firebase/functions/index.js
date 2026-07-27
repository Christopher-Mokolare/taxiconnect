const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.database();
const messaging = admin.messaging();
const auth = admin.auth();

const ROUTES = {
  SUN_CITY: "Sun City (Sun Village)",
  RUSTENBURG: "Rustenburg (Town)",
};

// =============================================================================
// AUTH TRIGGER: Assign role claim on first sign-in
// Phone numbers are pre-registered in /appConfig/roles by the conductor
// =============================================================================

exports.onUserCreated = functions.auth.user().onCreate(async (user) => {
  const phone = user.phoneNumber;
  if (!phone) return;

  const roleSnap = await db.ref(`appConfig/roles/${_phoneKey(phone)}`).once("value");
  const role = roleSnap.val();

  const claims = {
    isDriver: role === "driver",
    isConductor: role === "conductor",
    isPassenger: !role || role === "passenger",
  };

  await auth.setCustomUserClaims(user.uid, claims);

  await db.ref(`users/${user.uid}`).set({
    phone,
    role: role || "passenger",
    displayName: user.displayName || phone,
    createdAt: Date.now(),
  });
});

// =============================================================================
// CALLABLE: Conductor registers a phone number with a role
// =============================================================================

exports.registerRole = functions.https.onCall(async (data, context) => {
  _requireConductor(context);

  const { phone, role } = data;
  if (!phone || !["driver", "conductor", "passenger"].includes(role)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid phone or role.");
  }

  await db.ref(`appConfig/roles/${_phoneKey(phone)}`).set(role);

  // If user already exists, update their claims immediately
  try {
    const user = await auth.getUserByPhoneNumber(phone);
    await auth.setCustomUserClaims(user.uid, {
      isDriver: role === "driver",
      isConductor: role === "conductor",
      isPassenger: role === "passenger",
    });
    await db.ref(`users/${user.uid}/role`).set(role);
  } catch (_) {
    // User hasn't signed up yet — claims will be set on first login
  }

  return { success: true };
});

// =============================================================================
// CALLABLE: Driver goes live
// =============================================================================

exports.goLive = functions.https.onCall(async (data, context) => {
  _requireDriver(context);

  const { route, capacity, passengersOnboard, fcmToken } = data;
  _validateRoute(route);
  _validateNumber(capacity, 1, 22, "capacity");
  _validateNumber(passengersOnboard, 0, capacity, "passengersOnboard");

  const uid = context.auth.uid;
  const userSnap = await db.ref(`users/${uid}`).once("value");
  const user = userSnap.val();
  if (!user) throw new functions.https.HttpsError("not-found", "User profile not found.");

  // Remove any existing live taxi for this driver
  const existingSnap = await db.ref("taxis").orderByChild("driverId").equalTo(uid).once("value");
  const removals = [];
  existingSnap.forEach((child) => removals.push(child.ref.remove()));
  await Promise.all(removals);

  const taxiRef = db.ref("taxis").push();
  await taxiRef.set({
    driverId: uid,
    driverName: user.displayName,
    route,
    capacity,
    passengersOnboard,
    status: passengersOnboard >= capacity ? "full" : "loading",
    lastUpdated: Date.now(),
  });

  // Store FCM token
  if (fcmToken) {
    await db.ref(`drivers/${uid}`).update({ fcmToken, displayName: user.displayName, lastSeen: Date.now() });
  }

  return { taxiId: taxiRef.key };
});

// =============================================================================
// CALLABLE: Driver updates passenger count
// =============================================================================

exports.updatePassengers = functions.https.onCall(async (data, context) => {
  _requireDriver(context);

  const { taxiId, passengersOnboard } = data;
  if (!taxiId) throw new functions.https.HttpsError("invalid-argument", "taxiId required.");

  const taxiSnap = await db.ref(`taxis/${taxiId}`).once("value");
  const taxi = taxiSnap.val();
  if (!taxi) throw new functions.https.HttpsError("not-found", "Taxi not found.");
  if (taxi.driverId !== context.auth.uid) throw new functions.https.HttpsError("permission-denied", "Not your taxi.");

  _validateNumber(passengersOnboard, 0, taxi.capacity, "passengersOnboard");

  const isFull = passengersOnboard >= taxi.capacity;
  await db.ref(`taxis/${taxiId}`).update({
    passengersOnboard,
    status: isFull ? "full" : "loading",
    lastUpdated: Date.now(),
  });

  if (isFull) {
    await _notifyConductor({
      title: "✅ Taxi Full — Ready to Depart",
      body: `${taxi.driverName}'s taxi to ${ROUTES[taxi.route]} is full (${taxi.capacity}/${taxi.capacity}).`,
      data: { type: "TAXI_FULL", taxiId, route: taxi.route },
    });
  }

  return { status: isFull ? "full" : "loading" };
});

// =============================================================================
// CALLABLE: Driver goes offline
// =============================================================================

exports.goOffline = functions.https.onCall(async (data, context) => {
  _requireDriver(context);

  const { taxiId } = data;
  const taxiSnap = await db.ref(`taxis/${taxiId}`).once("value");
  const taxi = taxiSnap.val();
  if (!taxi) return { success: true };
  if (taxi.driverId !== context.auth.uid) throw new functions.https.HttpsError("permission-denied", "Not your taxi.");

  await db.ref(`taxis/${taxiId}`).remove();
  await db.ref(`drivers/${context.auth.uid}/lastSeen`).set(Date.now());

  return { success: true };
});

// =============================================================================
// CALLABLE: Passenger signals waiting
// =============================================================================

exports.signalWaiting = functions.https.onCall(async (data, context) => {
  _requireAuth(context);

  const { route, groupSize } = data;
  _validateRoute(route);
  _validateNumber(groupSize, 1, 10, "groupSize");

  const uid = context.auth.uid;

  // Remove any existing signal from this passenger
  const existingSnap = await db.ref("waitingPassengers").orderByChild("passengerId").equalTo(uid).once("value");
  const removals = [];
  existingSnap.forEach((child) => removals.push(child.ref.remove()));
  await Promise.all(removals);

  const ref = db.ref("waitingPassengers").push();
  await ref.set({ route, groupSize, passengerId: uid, timestamp: Date.now() });

  // Count total waiting for this route
  const waitSnap = await db.ref("waitingPassengers").orderByChild("route").equalTo(route).once("value");
  let totalWaiting = 0;
  waitSnap.forEach((child) => { totalWaiting += child.val().groupSize || 1; });

  await _notifyConductor({
    title: `⚠️ ${totalWaiting} Waiting — ${ROUTES[route]}`,
    body: `${totalWaiting} passenger(s) waiting for a taxi to ${ROUTES[route]}.`,
    data: { type: "DEMAND_ALERT", route, count: String(totalWaiting) },
  });

  // Update demand heatmap
  await db.ref(`demandHeatmap/${route}`).transaction((current) => {
    const now = Date.now();
    if (!current) return { count: 1, lastUpdated: now };
    return { count: (current.count || 0) + 1, lastUpdated: now };
  });

  return { waitId: ref.key };
});

// =============================================================================
// CALLABLE: Conductor summons drivers for a route
// =============================================================================

exports.summonDrivers = functions.https.onCall(async (data, context) => {
  _requireConductor(context);

  const { route, passengerCount } = data;
  _validateRoute(route);
  _validateNumber(passengerCount, 1, 200, "passengerCount");

  const summonRef = await db.ref("summonRequests").push({
    conductorId: context.auth.uid,
    route,
    passengerCount,
    timestamp: Date.now(),
    status: "pending",
    respondedDrivers: {},
  });

  await messaging.send({
    topic: `drivers_${route}`,
    notification: {
      title: "🚨 PASSENGERS WAITING!",
      body: `${passengerCount} passenger(s) need a taxi to ${ROUTES[route]}. Respond now.`,
    },
    data: { type: "SUMMON_DRIVER", summonId: summonRef.key, route, passengerCount: String(passengerCount) },
    android: { priority: "high" },
    apns: { payload: { aps: { sound: "default", contentAvailable: true } } },
  });

  return { summonId: summonRef.key };
});

// =============================================================================
// CALLABLE: Driver responds to summon
// =============================================================================

exports.respondToSummon = functions.https.onCall(async (data, context) => {
  _requireDriver(context);

  const { summonId, accepted, eta } = data;
  if (!summonId) throw new functions.https.HttpsError("invalid-argument", "summonId required.");

  const summonSnap = await db.ref(`summonRequests/${summonId}`).once("value");
  const summon = summonSnap.val();
  if (!summon || summon.status !== "pending") {
    throw new functions.https.HttpsError("failed-precondition", "Summon no longer active.");
  }

  const uid = context.auth.uid;
  const userSnap = await db.ref(`users/${uid}`).once("value");
  const driverName = userSnap.val()?.displayName || "Driver";

  await db.ref(`summonRequests/${summonId}/respondedDrivers/${uid}`).set({
    accepted,
    eta: accepted ? eta : null,
    respondedAt: Date.now(),
  });

  if (accepted) {
    await db.ref(`summonRequests/${summonId}`).update({ status: "accepted", acceptedBy: uid, acceptedAt: Date.now() });
    await _notifyConductor({
      title: "✅ Driver Accepted Summon",
      body: `${driverName} is coming to ${ROUTES[summon.route]}. ETA: ${eta} mins.`,
      data: { type: "DRIVER_ACCEPTED", driverName, eta: String(eta), route: summon.route },
    });
  }

  return { status: accepted ? "accepted" : "declined" };
});

// =============================================================================
// TRIGGER: New taxi goes live → notify waiting passengers on that route
// =============================================================================

exports.onTaxiCreated = functions.database.ref("/taxis/{taxiId}").onCreate(async (snapshot) => {
  const taxi = snapshot.val();
  const { route, driverName, capacity, passengersOnboard } = taxi;
  const available = capacity - passengersOnboard;
  if (available <= 0) return;

  await messaging.send({
    topic: `passengers_${route}`,
    notification: {
      title: "🚕 Taxi Available!",
      body: `${driverName}'s taxi to ${ROUTES[route]} is loading. ${available} seat(s) available.`,
    },
    data: { type: "TAXI_AVAILABLE", route, taxiId: snapshot.key },
  });
});

// =============================================================================
// TRIGGER: Taxi status changes → notify passengers on that route
// =============================================================================

exports.onTaxiStatusChange = functions.database.ref("/taxis/{taxiId}/status").onUpdate(async (change, context) => {
  const newStatus = change.after.val();
  if (newStatus === change.before.val()) return;

  const taxiSnap = await db.ref(`taxis/${context.params.taxiId}`).once("value");
  const taxi = taxiSnap.val();
  if (!taxi) return;

  const messages = {
    full: { title: "🔥 Taxi Almost Gone!", body: `${taxi.driverName}'s taxi to ${ROUTES[taxi.route]} is FULL. Signal waiting for the next one.` },
    departed: { title: "🚌 Taxi Departed", body: `${taxi.driverName}'s taxi to ${ROUTES[taxi.route]} has left.` },
    breakdown: { title: "⚠️ Taxi Breakdown", body: `${taxi.driverName}'s taxi to ${ROUTES[taxi.route]} has broken down. Another taxi is needed.` },
  };

  const msg = messages[newStatus];
  if (!msg) return;

  await messaging.send({
    topic: `passengers_${taxi.route}`,
    notification: msg,
    data: { type: `TAXI_${newStatus.toUpperCase()}`, route: taxi.route, taxiId: context.params.taxiId },
  });

  if (newStatus === "departed") {
    await db.ref(`history/${context.params.taxiId}`).set({ ...taxi, departedAt: Date.now() });
    await db.ref(`taxis/${context.params.taxiId}`).remove();
  }

  if (newStatus === "breakdown") {
    await _notifyConductor({
      title: "⚠️ Taxi Breakdown!",
      body: `${taxi.driverName}'s taxi to ${ROUTES[taxi.route]} has broken down.`,
      data: { type: "TAXI_BREAKDOWN", route: taxi.route, taxiId: context.params.taxiId },
    });
  }
});

// =============================================================================
// SCHEDULED: Clean up stale waiting signals older than 4 hours
// =============================================================================

exports.cleanupStaleSignals = functions.pubsub.schedule("every 4 hours").onRun(async () => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  const snap = await db.ref("waitingPassengers").orderByChild("timestamp").endAt(cutoff).once("value");
  const updates = {};
  snap.forEach((child) => { updates[child.key] = null; });
  if (Object.keys(updates).length > 0) {
    await db.ref("waitingPassengers").update(updates);
  }
});

// =============================================================================
// SCHEDULED: Remove taxis that haven't updated in 45 minutes (driver went offline without checking out)
// =============================================================================

exports.cleanupStaleTaxis = functions.pubsub.schedule("every 30 minutes").onRun(async () => {
  const cutoff = Date.now() - 45 * 60 * 1000;
  const snap = await db.ref("taxis").orderByChild("lastUpdated").endAt(cutoff).once("value");
  const removals = [];
  snap.forEach((child) => removals.push(child.ref.remove()));
  await Promise.all(removals);
});

// =============================================================================
// HELPERS
// =============================================================================

function _requireAuth(context) {
  if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
}

function _requireDriver(context) {
  _requireAuth(context);
  if (!context.auth.token.isDriver) throw new functions.https.HttpsError("permission-denied", "Drivers only.");
}

function _requireConductor(context) {
  _requireAuth(context);
  if (!context.auth.token.isConductor) throw new functions.https.HttpsError("permission-denied", "Conductors only.");
}

function _validateRoute(route) {
  if (!["SUN_CITY", "RUSTENBURG"].includes(route)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid route.");
  }
}

function _validateNumber(val, min, max, name) {
  if (typeof val !== "number" || val < min || val > max) {
    throw new functions.https.HttpsError("invalid-argument", `${name} must be between ${min} and ${max}.`);
  }
}

function _phoneKey(phone) {
  return phone.replace(/[^0-9]/g, "");
}

async function _notifyConductor({ title, body, data }) {
  const conductorsSnap = await db.ref("conductors").once("value");
  const tokens = [];
  conductorsSnap.forEach((child) => {
    const token = child.val()?.fcmToken;
    if (token) tokens.push(token);
  });
  if (!tokens.length) return;
  await messaging.sendEachForMulticast({ tokens, notification: { title, body }, data, android: { priority: "high" } });
}
