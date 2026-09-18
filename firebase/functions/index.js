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

/* =========================================================
   AUTH
   ========================================================= */

exports.loginWithPin = functions.https.onCall(async (data, context) => {
  const pin = String(data?.pin || "").trim();
  const role = String(data?.role || "").trim().toLowerCase();
  const name = String(data?.name || "").trim();

  if (!["driver", "conductor"].includes(role)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid role."
    );
  }

  if (!name) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Name is required."
    );
  }

  const expectedPin =
    role === "driver"
      ? process.env.DRIVER_PIN
      : process.env.CONDUCTOR_PIN;

  if (!expectedPin || pin !== expectedPin) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Invalid PIN."
    );
  }

  const uid = `${role}_${_slug(name)}`;

  let user;

  try {
    user = await auth.getUser(uid);
  } catch (err) {
    if (err.code !== "auth/user-not-found") {
      throw err;
    }

    user = await auth.createUser({
      uid,
      displayName: name,
    });
  }

  const claims = {
    isDriver: role === "driver",
    isConductor: role === "conductor",
  };

  await auth.setCustomUserClaims(uid, claims);

  await db.ref(`users/${uid}`).update({
    displayName: name,
    role,
    lastLogin: Date.now(),
  });

  const token = await auth.createCustomToken(uid, claims);

  return {
    token,
    uid,
    role,
    displayName: name,
  };
});

/* =========================================================
   DRIVER
   ========================================================= */

exports.goLive = functions.https.onCall(async (data, context) => {
  const uid = _requireDriver(context);

  const route = _validateRoute(data?.route);
  const capacity = _validateNumber(data?.capacity, 1, 22);
  const onboard = _validateNumber(
    data?.onboard ?? 0,
    0,
    capacity
  );

  const profileSnap = await db.ref(`users/${uid}`).once("value");
  const profile = profileSnap.val() || {};

  const taxisSnap = await db.ref("taxis").once("value");
  const taxis = taxisSnap.val() || {};

  const updates = {};

  for (const [taxiId, taxi] of Object.entries(taxis)) {
    if (taxi?.driverId === uid) {
      updates[`taxis/${taxiId}`] = null;
    }
  }

  const taxiRef = db.ref("taxis").push();
  const taxiId = taxiRef.key;

  updates[`taxis/${taxiId}`] = {
    driverId: uid,
    driverName: profile.displayName || uid,
    route,
    capacity,
    passengersOnboard: onboard,
    status: onboard >= capacity ? "full" : "loading",
    lastUpdated: Date.now(),
  };

  updates[`drivers/${uid}`] = {
    displayName: profile.displayName || uid,
    lastSeen: Date.now(),
  };

  await db.ref().update(updates);

  await _notifyTopic(
    `passengers_${route}`,
    `Taxi available — ${ROUTES[route]}`,
    `${profile.displayName || "A driver"} is now live.`
  );

  return {
    success: true,
    taxiId,
  };
});

exports.updatePassengers = functions.https.onCall(
  async (data, context) => {
    const uid = _requireDriver(context);

    const taxiId = String(data?.taxiId || "");
    const onboard = Number(data?.onboard);

    if (!taxiId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Taxi ID is required."
      );
    }

    if (!Number.isInteger(onboard) || onboard < 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Invalid passenger count."
      );
    }

    const ref = db.ref(`taxis/${taxiId}`);
    const snap = await ref.once("value");
    const taxi = snap.val();

    if (!taxi) {
      throw new functions.https.HttpsError(
        "not-found",
        "Taxi not found."
      );
    }

    if (taxi.driverId !== uid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "You do not own this taxi."
      );
    }

    if (onboard > taxi.capacity) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Passenger count exceeds capacity."
      );
    }

    const status =
      onboard >= taxi.capacity
        ? "full"
        : "loading";

    await ref.update({
      passengersOnboard: onboard,
      status,
      lastUpdated: Date.now(),
    });

    return {
      success: true,
      status,
      passengersOnboard: onboard,
    };
  }
);

exports.goOffline = functions.https.onCall(
  async (data, context) => {
    const uid = _requireDriver(context);

    const taxiId = String(data?.taxiId || "");

    if (!taxiId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Taxi ID is required."
      );
    }

    const taxiSnap = await db.ref(`taxis/${taxiId}`).once("value");
    const taxi = taxiSnap.val();

    if (!taxi) {
      return { success: true };
    }

    if (taxi.driverId !== uid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "You do not own this taxi."
      );
    }

    const waitingSnap = await db.ref("waitingPassengers").once("value");
    const waiting = waitingSnap.val() || {};

    const updates = {
      [`taxis/${taxiId}`]: null,
      [`drivers/${uid}/lastSeen`]: Date.now(),
    };

    for (const [id, passenger] of Object.entries(waiting)) {
      if (passenger?.assignedTaxiId === taxiId) {
        updates[`waitingPassengers/${id}`] = null;
      }
    }

    await db.ref().update(updates);

    return {
      success: true,
    };
  }
);

/* =========================================================
   PASSENGERS
   ========================================================= */

exports.signalWaiting = functions.https.onCall(
  async (data, context) => {
    const uid = _requireAuth(context);

    const route = _validateRoute(data?.route);
    const groupSize = _validateNumber(
      data?.groupSize,
      1,
      10
    );

    const waitingRef = db.ref("waitingPassengers");
    const existingSnap = await waitingRef.once("value");
    const existing = existingSnap.val() || {};

    const updates = {};

    for (const [id, item] of Object.entries(existing)) {
      if (item?.passengerId === uid) {
        updates[`waitingPassengers/${id}`] = null;
      }
    }

    const waitRef = waitingRef.push();

    updates[`waitingPassengers/${waitRef.key}`] = {
      route,
      groupSize,
      passengerId: uid,
      timestamp: Date.now(),
      status: "waiting",
    };

    await db.ref().update(updates);

    const heatRef = db.ref(`demandHeatmap/${route}`);

    await heatRef.transaction(current => ({
      count: ((current && current.count) || 0) + groupSize,
      lastUpdated: Date.now(),
    }));

    await _notifyConductor(
      "Passenger demand",
      `${groupSize} passenger(s) are waiting for ${ROUTES[route]}.`
    );

    return {
      success: true,
      waitId: waitRef.key,
    };
  }
);

/* =========================================================
   CONDUCTOR
   ========================================================= */

exports.summonDrivers = functions.https.onCall(
  async (data, context) => {
    const uid = _requireConductor(context);

    const route = _validateRoute(data?.route);
    const passengerCount = _validateNumber(
      data?.passengerCount,
      1,
      200
    );

    const ref = db.ref("summonRequests").push();

    await ref.set({
      conductorId: uid,
      route,
      passengerCount,
      timestamp: Date.now(),
      status: "pending",
      respondedDrivers: {},
    });

    await db.ref(`summons/${route}`).set({
      count: passengerCount,
      timestamp: Date.now(),
      conductorId: uid,
    });

    await _notifyTopic(
      `drivers_${route}`,
      "TaxiConnect driver request",
      `${passengerCount} passenger(s) are waiting for ${ROUTES[route]}.`
    );

    return {
      success: true,
      summonId: ref.key,
    };
  }
);

exports.clearAllData = functions.https.onCall(
  async (data, context) => {
    _requireConductor(context);

    if (data?.confirmation !== "CONFIRM_DELETE_123") {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "Confirmation required."
      );
    }

    await db.ref().update({
      taxis: null,
      waitingPassengers: null,
      summons: null,
      summonRequests: null,
      demandHeatmap: null,
      history: null,
    });

    return {
      success: true,
    };
  }
);

/* =========================================================
   TAXI STATUS TRIGGER
   ========================================================= */



/* =========================================================
   SECURE OPERATIONAL CALLABLES
   ========================================================= */

exports.cancelWaiting = functions.https.onCall(
  async (data, context) => {
    const uid = _requireAuth(context);

    const waitId =
      typeof data?.waitId === "string"
        ? data.waitId.trim()
        : "";

    if (!waitId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "waitId is required."
      );
    }

    const ref = db.ref(`waitingPassengers/${waitId}`);
    const snap = await ref.once("value");

    if (!snap.exists()) {
      return {
        success: true,
        removed: false,
      };
    }

    const record = snap.val();

    if (record?.passengerId !== uid) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "You can only cancel your own waiting signal."
      );
    }

    await ref.remove();

    return {
      success: true,
      removed: true,
    };
  }
);

exports.setTaxiStatus = functions.https.onCall(
  async (data, context) => {
    const uid = _requireConductor(context);

    const taxiId =
      typeof data?.taxiId === "string"
        ? data.taxiId.trim()
        : "";

    const status =
      typeof data?.status === "string"
        ? data.status.trim()
        : "";

    if (!taxiId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "taxiId is required."
      );
    }

    if (!/^(loading|full|departed|breakdown)$/.test(status)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Invalid taxi status."
      );
    }

    const ref = db.ref(`taxis/${taxiId}`);
    const snap = await ref.once("value");

    if (!snap.exists()) {
      throw new functions.https.HttpsError(
        "not-found",
        "Taxi not found."
      );
    }

    await ref.update({
      status,
      lastUpdated: Date.now(),
      statusUpdatedBy: uid,
    });

    return {
      success: true,
    };
  }
);

exports.removeTaxi = functions.https.onCall(
  async (data, context) => {
    _requireConductor(context);

    const taxiId =
      typeof data?.taxiId === "string"
        ? data.taxiId.trim()
        : "";

    if (!taxiId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "taxiId is required."
      );
    }

    const ref = db.ref(`taxis/${taxiId}`);
    const snap = await ref.once("value");

    if (!snap.exists()) {
      return {
        success: true,
        removed: false,
      };
    }

    await ref.remove();

    return {
      success: true,
      removed: true,
    };
  }
);

exports.dismissWaitingPassenger = functions.https.onCall(
  async (data, context) => {
    _requireConductor(context);

    const waitId =
      typeof data?.waitId === "string"
        ? data.waitId.trim()
        : "";

    if (!waitId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "waitId is required."
      );
    }

    const ref = db.ref(`waitingPassengers/${waitId}`);

    await ref.remove();

    return {
      success: true,
    };
  }
);

exports.cleanupWaitingPassengers = functions.https.onCall(
  async (data, context) => {
    _requireConductor(context);

    const cutoff =
      Date.now() - 4 * 60 * 60 * 1000;

    const snap =
      await db.ref("waitingPassengers").once("value");

    const waiting = snap.val() || {};
    const updates = {};

    for (const [id, record] of Object.entries(waiting)) {
      if (
        record?.timestamp &&
        Number(record.timestamp) < cutoff
      ) {
        updates[`waitingPassengers/${id}`] = null;
      }
    }

    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
    }

    return {
      success: true,
      removed: Object.keys(updates).length,
    };
  }
);

exports.approvePhone = functions.https.onCall(
  async (data, context) => {
    _requireConductor(context);

    const phone =
      typeof data?.phone === "string"
        ? data.phone.trim()
        : "";

    const role =
      typeof data?.role === "string"
        ? data.role.trim()
        : "";

    if (!phone) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Phone number is required."
      );
    }

    if (!/^(driver|conductor)$/.test(role)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Role must be driver or conductor."
      );
    }

    const key = phone.replace(/[^0-9]/g, "");

    if (!key) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Invalid phone number."
      );
    }

    await db.ref(`approvedPhones/${key}`).set(role);

    return {
      success: true,
    };
  }
);

exports.onTaxiStatusChange = functions.database
  .ref("/taxis/{taxiId}/status")
  .onUpdate(async (change, context) => {
    const before = change.before.val();
    const after = change.after.val();

    if (before === after) {
      return null;
    }

    const taxiId = context.params.taxiId;
    const taxiSnap = await db.ref(`taxis/${taxiId}`).once("value");
    const taxi = taxiSnap.val();

    if (!taxi) {
      return null;
    }

    if (after === "departed") {
      const waitingSnap =
        await db.ref("waitingPassengers").once("value");

      const waiting = waitingSnap.val() || {};
      const updates = {};

      for (const [id, passenger] of Object.entries(waiting)) {
        if (passenger?.assignedTaxiId === taxiId) {
          updates[`waitingPassengers/${id}`] = null;
        }
      }

      updates[`history/${taxiId}`] = {
        ...taxi,
        departedAt: Date.now(),
      };

      updates[`taxis/${taxiId}`] = null;

      await db.ref().update(updates);

      await _notifyTopic(
        `passengers_${taxi.route}`,
        "Taxi departed",
        `${taxi.driverName || "Taxi"} has departed.`
      );

      return null;
    }

    if (after === "full") {
      await _notifyTopic(
        `passengers_${taxi.route}`,
        "Taxi full",
        `${taxi.driverName || "Taxi"} is now full.`
      );
    }

    if (after === "breakdown") {
      await _notifyConductor(
        "Taxi breakdown",
        `${taxi.driverName || "Taxi"} has reported a breakdown.`
      );

      await _notifyTopic(
        `passengers_${taxi.route}`,
        "Taxi breakdown",
        "A taxi has reported a breakdown."
      );
    }

    return null;
  });

/* =========================================================
   CLEANUP
   ========================================================= */

exports.cleanupStaleSignals = functions.pubsub
  .schedule("every 4 hours")
  .onRun(async () => {
    const cutoff = Date.now() - 4 * 60 * 60 * 1000;

    const snap = await db.ref("waitingPassengers").once("value");
    const waiting = snap.val() || {};
    const updates = {};

    for (const [id, item] of Object.entries(waiting)) {
      if (item?.timestamp && item.timestamp < cutoff) {
        updates[`waitingPassengers/${id}`] = null;
      }
    }

    if (Object.keys(updates).length) {
      await db.ref().update(updates);
    }

    return null;
  });

exports.cleanupStaleTaxis = functions.pubsub
  .schedule("every 30 minutes")
  .onRun(async () => {
    const cutoff = Date.now() - 45 * 60 * 1000;

    const snap = await db.ref("taxis").once("value");
    const taxis = snap.val() || {};
    const updates = {};

    for (const [id, taxi] of Object.entries(taxis)) {
      if (taxi?.lastUpdated && taxi.lastUpdated < cutoff) {
        updates[`taxis/${id}`] = null;
      }
    }

    if (Object.keys(updates).length) {
      await db.ref().update(updates);
    }

    return null;
  });

/* =========================================================
   HELPERS
   ========================================================= */

function _requireAuth(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required."
    );
  }

  return context.auth.uid;
}

function _requireDriver(context) {
  const uid = _requireAuth(context);

  if (context.auth.token.isDriver !== true) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Driver access required."
    );
  }

  return uid;
}

function _requireConductor(context) {
  const uid = _requireAuth(context);

  if (context.auth.token.isConductor !== true) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Conductor access required."
    );
  }

  return uid;
}

function _validateRoute(route) {
  if (!Object.prototype.hasOwnProperty.call(ROUTES, route)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid route."
    );
  }

  return route;
}

function _validateNumber(value, min, max) {
  const n = Number(value);

  if (!Number.isInteger(n) || n < min || n > max) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `Value must be between ${min} and ${max}.`
    );
  }

  return n;
}

function _slug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

async function _notifyTopic(topic, title, body) {
  try {
    await messaging.send({
      topic,
      notification: {
        title,
        body,
      },
    });
  } catch (err) {
    console.error("FCM topic notification failed:", err);
  }
}

async function _notifyConductor(title, body) {
  try {
    const snap = await db.ref("conductors").once("value");
    const conductors = snap.val() || {};

    const tokens = Object.values(conductors)
      .map(c => c?.fcmToken)
      .filter(Boolean);

    if (!tokens.length) {
      return;
    }

    await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title,
        body,
      },
    });
  } catch (err) {
    console.error("Conductor notification failed:", err);
  }
}
