const crypto = require("crypto");

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const DB_KEY = process.env.LICENSE_DB_KEY || "license-system-db";

const initial = createInitialDb();
global.__licenseSystemDb = global.__licenseSystemDb || initial;

function getDb() {
  return global.__licenseSystemDb;
}

function hasPersistentStore() {
  return hasSupabaseStore() || hasKvStore();
}

async function loadDb() {
  if (!hasPersistentStore()) return getDb();

  try {
    if (hasSupabaseStore()) {
      const db = await supabaseLoadDb();
      if (db) {
        global.__licenseSystemDb = db;
        ensureDbShape(global.__licenseSystemDb);
        return global.__licenseSystemDb;
      }

      await saveDb();
      return getDb();
    }

    const response = await kvCommand(["GET", DB_KEY]);
    if (response && response.result) {
      global.__licenseSystemDb = JSON.parse(response.result);
      ensureDbShape(global.__licenseSystemDb);
      return global.__licenseSystemDb;
    }

    await saveDb();
    return getDb();
  } catch (error) {
    console.error("Failed to load persistent DB", error);
    return getDb();
  }
}

async function saveDb() {
  if (!hasPersistentStore()) return false;

  try {
    if (hasSupabaseStore()) {
      await supabaseSaveDb(getDb());
      return true;
    }

    await kvCommand(["SET", DB_KEY, JSON.stringify(getDb())]);
    return true;
  } catch (error) {
    console.error("Failed to save persistent DB", error);
    return false;
  }
}

function storageStatus() {
  if (hasSupabaseStore()) return "supabase";
  if (hasKvStore()) return "kv";
  return "memory";
}

function createToken() {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${ADMIN_USER}:${expiresAt}`;
  const signature = sign(payload);
  return Buffer.from(`${payload}:${signature}`).toString("base64url");
}

function isAuthenticated(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return false;

  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split(":");
    const user = parts[0];
    const expiresAt = Number(parts[1]);
    const signature = parts[2];
    const payload = `${user}:${expiresAt}`;
    return user === ADMIN_USER && expiresAt > Date.now() && signature === sign(payload);
  } catch {
    return false;
  }
}

function requireAuth(req, res) {
  if (isAuthenticated(req)) return true;
  sendJson(res, 401, { ok: false, error: "UNAUTHORIZED" });
  return false;
}

function login(body) {
  if (body.username === ADMIN_USER && body.password === ADMIN_PASSWORD) {
    return { ok: true, token: createToken(), user: { name: ADMIN_USER } };
  }
  return null;
}

function buildState() {
  const db = getDb();
  const now = new Date();
  const activeLicenses = db.licenses.filter((item) => item.status === "active" && new Date(item.expiresAt) > now);
  const month = now.toISOString().slice(0, 7);
  const monthRevenue = db.licenses
    .filter((item) => item.paidAt && item.paidAt.slice(0, 7) === month)
    .reduce((sum, item) => sum + Number(item.price || 0), 0);

  return {
    summary: {
      activeAccounts: new Set(activeLicenses.map((item) => item.userId)).size,
      totalUsers: db.users.length,
      activeLicenses: activeLicenses.length,
      robots: db.robots.length,
      monthRevenue,
      checksToday: db.checkIns.filter((item) => item.at.slice(0, 10) === now.toISOString().slice(0, 10)).length,
      pendingRequests: (db.pendingRequests || []).filter((request) => !request.resolvedAt).length
    },
    pendingRequests: (db.pendingRequests || []).filter((request) => !request.resolvedAt).slice(0, 80),
    users: db.users,
    robots: db.robots.map((robot) => ({
      ...robot,
      clients: activeLicenses.filter((license) => license.robotId === robot.id).length
    })),
    licenses: db.licenses,
    checkIns: db.checkIns.slice(0, 80)
  };
}

function checkLicense(input, req) {
  const db = getDb();
  const account = String(input.account || "").trim();
  const robotName = String(input.robot || "").trim();
  const key = String(input.key || "").trim();
  const brokerRaw = String(input.broker || "").trim();
  const broker = brokerRaw.toLowerCase();
  const accountName = String(input.name || input.accountName || "").trim();
  const accountServer = String(input.server || input.accountServer || "").trim();
  const now = new Date();
  const base = {
    ok: false,
    authorized: false,
    reason: "MISSING_FIELDS",
    serverTime: now.toISOString(),
    expiresAt: null,
    robot: robotName,
    account,
    accountName,
    broker: brokerRaw,
    accountServer,
    key
  };

  if (!account || !robotName || !key) return saveCheckIn(db, base, req);

  const user = db.users.find((item) => String(item.account) === account);
  if (!user) return savePendingRequest(db, saveCheckIn(db, { ...base, reason: "ACCOUNT_NOT_FOUND" }, req));
  if (broker && !String(user.broker || "").toLowerCase().includes(broker)) {
    return savePendingRequest(db, saveCheckIn(db, { ...base, reason: "BROKER_MISMATCH", userId: user.id }, req));
  }

  const robot = db.robots.find((item) => item.name.toLowerCase() === robotName.toLowerCase());
  if (!robot) return savePendingRequest(db, saveCheckIn(db, { ...base, reason: "ROBOT_NOT_FOUND", userId: user.id }, req));

  const license = db.licenses.find((item) => item.userId === user.id && item.robotId === robot.id && item.key === key);
  if (!license) return savePendingRequest(db, saveCheckIn(db, { ...base, reason: "LICENSE_NOT_FOUND", userId: user.id, robotId: robot.id }, req));
  if (license.status !== "active") {
    return saveCheckIn(db, { ...base, reason: "LICENSE_INACTIVE", userId: user.id, robotId: robot.id, licenseId: license.id }, req);
  }
  if (new Date(license.expiresAt) <= now) {
    return saveCheckIn(db, { ...base, reason: "LICENSE_EXPIRED", expiresAt: license.expiresAt, userId: user.id, robotId: robot.id, licenseId: license.id }, req);
  }

  return saveCheckIn(db, {
    ok: true,
    authorized: true,
    reason: "AUTHORIZED",
    serverTime: now.toISOString(),
    expiresAt: license.expiresAt,
    account,
    robot: robot.name,
    userId: user.id,
    robotId: robot.id,
    licenseId: license.id,
    message: robot.message || ""
  }, req);
}

function saveCheckIn(db, result, req) {
  db.checkIns.unshift({
    id: createId("chk"),
    at: new Date().toISOString(),
    ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
    account: result.account,
    accountName: result.accountName || "",
    broker: result.broker || "",
    accountServer: result.accountServer || "",
    key: result.key || "",
    robot: result.robot,
    authorized: result.authorized,
    reason: result.reason,
    userId: result.userId || null,
    robotId: result.robotId || null,
    licenseId: result.licenseId || null
  });
  db.checkIns = db.checkIns.slice(0, 500);
  return result;
}

function savePendingRequest(db, result) {
  if (!result.account || !result.robot) return result;
  db.pendingRequests = db.pendingRequests || [];

  const existing = db.pendingRequests.find((request) =>
    !request.resolvedAt &&
    request.account === result.account &&
    request.robot === result.robot
  );

  if (existing) {
    existing.accountName = result.accountName || existing.accountName || "";
    existing.broker = result.broker || existing.broker || "";
    existing.accountServer = result.accountServer || existing.accountServer || "";
    existing.key = result.key || existing.key || "";
    existing.reason = result.reason;
    existing.lastSeenAt = new Date().toISOString();
    existing.attempts = Number(existing.attempts || 1) + 1;
    return result;
  }

  db.pendingRequests.unshift({
    id: createId("req"),
    account: result.account,
    accountName: result.accountName || "",
    broker: result.broker || "",
    accountServer: result.accountServer || "",
    key: result.key || "",
    robot: result.robot,
    reason: result.reason,
    attempts: 1,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    resolvedAt: null
  });
  db.pendingRequests = db.pendingRequests.slice(0, 200);
  return result;
}

function createUser(body) {
  const now = new Date().toISOString();
  return {
    id: createId("usr"),
    account: String(body.account || "").trim(),
    name: String(body.name || "").trim(),
    broker: String(body.broker || "").trim(),
    type: body.type || "Real",
    notes: body.notes || "",
    createdAt: now,
    updatedAt: now
  };
}

function resolvePendingRequestsForAccount(account) {
  const db = getDb();
  db.pendingRequests = db.pendingRequests || [];
  db.pendingRequests.forEach((request) => {
    if (request.account === String(account)) request.resolvedAt = new Date().toISOString();
  });
}

function createRobot(body) {
  const now = new Date().toISOString();
  return {
    id: createId("bot"),
    name: String(body.name || "").trim(),
    version: body.version || "v1.00",
    status: body.status || "updated",
    message: body.message || "",
    createdAt: now,
    updatedAt: now
  };
}

function createLicense(body) {
  const db = getDb();
  const now = new Date().toISOString();
  const user = db.users.find((item) => item.id === body.userId);
  const robot = db.robots.find((item) => item.id === body.robotId);
  const key = body.key || `LIC-${user ? user.account : "CONTA"}-${robot ? robot.name.replace(/[^a-z0-9]/gi, "").toUpperCase() : crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  return {
    id: createId("lic"),
    userId: body.userId,
    robotId: body.robotId,
    key,
    status: body.status || "active",
    type: body.type || "REAL",
    price: Number(body.price || 0),
    paidAt: body.paidAt || "",
    expiresAt: body.expiresAt || addDays(365),
    createdAt: now,
    updatedAt: now
  };
}

function updateById(collection, id, fields) {
  const db = getDb();
  const item = db[collection].find((entry) => entry.id === id);
  if (!item) return null;
  Object.assign(item, fields, { updatedAt: new Date().toISOString() });
  return item;
}

function removeById(collection, id) {
  const db = getDb();
  db[collection] = db[collection].filter((entry) => entry.id !== id);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    if (typeof req.body === "string") {
      if (!req.body.trim()) return resolve({});
      try {
        return resolve(JSON.parse(req.body));
      } catch (error) {
        return reject(error);
      }
    }
    if (typeof req.on !== "function") return resolve({});

    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(text);
}

function methodNotAllowed(res) {
  sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
}

function pick(source, fields) {
  return fields.reduce((result, field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) result[field] = source[field];
    return result;
  }, {});
}

function sign(payload) {
  return crypto.createHmac("sha256", ADMIN_PASSWORD).update(payload).digest("hex");
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function createInitialDb() {
  const userOne = {
    id: "usr_seed_loreni",
    account: "19485815",
    name: "LORENI LUCIA BENINI TOSIN",
    broker: "XP Investimentos CCTVM SA",
    type: "Real",
    notes: "",
    createdAt: "2026-06-16T14:31:00.000Z",
    updatedAt: "2026-06-16T14:31:00.000Z"
  };
  const userTwo = {
    id: "usr_seed_evelize",
    account: "13115936",
    name: "EVELIZE MASIERO",
    broker: "Banco",
    type: "Real",
    notes: "",
    createdAt: "2026-06-17T14:31:00.000Z",
    updatedAt: "2026-06-17T14:31:00.000Z"
  };
  const robotOne = {
    id: "bot_seed_flowwin",
    name: "Rompedor Flow",
    version: "v1.00",
    status: "active",
    message: "Robo liberado.",
    createdAt: "2026-06-16T14:31:00.000Z",
    updatedAt: "2026-06-16T14:31:00.000Z"
  };
  const robotTwo = {
    id: "bot_seed_grid",
    name: "Grid Flow",
    version: "v5.00",
    status: "updated",
    message: "Versao atualizada disponivel.",
    createdAt: "2026-06-16T14:31:00.000Z",
    updatedAt: "2026-06-16T14:31:00.000Z"
  };

  return {
    users: [userOne, userTwo],
    robots: [robotOne, robotTwo],
    licenses: [
      {
        id: "lic_seed_flowwin",
        userId: userOne.id,
        robotId: robotOne.id,
        key: "LIC-19485815-ROMPEDOR-FLOW",
        status: "active",
        type: "REAL",
        price: 497,
        paidAt: "2026-06-16",
        expiresAt: "2027-06-16T14:31:00.000Z",
        createdAt: "2026-06-16T14:31:00.000Z",
        updatedAt: "2026-06-16T14:31:00.000Z"
      }
    ],
    checkIns: [],
    pendingRequests: []
  };
}

function ensureDbShape(db) {
  db.users = Array.isArray(db.users) ? db.users : [];
  db.robots = Array.isArray(db.robots) ? db.robots : [];
  db.licenses = Array.isArray(db.licenses) ? db.licenses : [];
  db.checkIns = Array.isArray(db.checkIns) ? db.checkIns : [];
  db.pendingRequests = Array.isArray(db.pendingRequests) ? db.pendingRequests : [];
}

async function kvCommand(command) {
  const response = await fetch(getKvUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getKvToken()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  if (!response.ok) {
    throw new Error(`KV request failed: ${response.status}`);
  }

  return response.json();
}

async function supabaseLoadDb() {
  const url = `${getSupabaseUrl()}/rest/v1/license_state?key=eq.${encodeURIComponent(DB_KEY)}&select=value`;
  const response = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders()
  });

  if (!response.ok) {
    throw new Error(`Supabase load failed: ${response.status}`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || !rows[0] || !rows[0].value) return null;
  return rows[0].value;
}

async function supabaseSaveDb(db) {
  const url = `${getSupabaseUrl()}/rest/v1/license_state`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify({
      key: DB_KEY,
      value: db,
      updated_at: new Date().toISOString()
    })
  });

  if (!response.ok) {
    throw new Error(`Supabase save failed: ${response.status}`);
  }
}

function supabaseHeaders() {
  const key = getSupabaseServiceKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
}

function hasSupabaseStore() {
  return Boolean(getSupabaseUrl() && getSupabaseServiceKey());
}

function hasKvStore() {
  return Boolean(getKvUrl() && getKvToken());
}

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
}

function getSupabaseServiceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
}

function getKvUrl() {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
}

function getKvToken() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
}

module.exports = {
  getDb,
  loadDb,
  saveDb,
  storageStatus,
  login,
  requireAuth,
  buildState,
  checkLicense,
  createUser,
  resolvePendingRequestsForAccount,
  createRobot,
  createLicense,
  updateById,
  removeById,
  readBody,
  sendJson,
  sendText,
  methodNotAllowed,
  pick
};
