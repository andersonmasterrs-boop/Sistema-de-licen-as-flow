const crypto = require("crypto");

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

const initial = createInitialDb();
global.__licenseSystemDb = global.__licenseSystemDb || initial;

function getDb() {
  return global.__licenseSystemDb;
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
      checksToday: db.checkIns.filter((item) => item.at.slice(0, 10) === now.toISOString().slice(0, 10)).length
    },
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
  const broker = String(input.broker || "").trim().toLowerCase();
  const now = new Date();
  const base = {
    ok: false,
    authorized: false,
    reason: "MISSING_FIELDS",
    serverTime: now.toISOString(),
    expiresAt: null,
    robot: robotName,
    account
  };

  if (!account || !robotName || !key) return saveCheckIn(db, base, req);

  const user = db.users.find((item) => String(item.account) === account);
  if (!user) return saveCheckIn(db, { ...base, reason: "ACCOUNT_NOT_FOUND" }, req);
  if (broker && !String(user.broker || "").toLowerCase().includes(broker)) {
    return saveCheckIn(db, { ...base, reason: "BROKER_MISMATCH", userId: user.id }, req);
  }

  const robot = db.robots.find((item) => item.name.toLowerCase() === robotName.toLowerCase());
  if (!robot) return saveCheckIn(db, { ...base, reason: "ROBOT_NOT_FOUND", userId: user.id }, req);

  const license = db.licenses.find((item) => item.userId === user.id && item.robotId === robot.id && item.key === key);
  if (!license) return saveCheckIn(db, { ...base, reason: "LICENSE_NOT_FOUND", userId: user.id, robotId: robot.id }, req);
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
    name: "FLOWWIN.mq5",
    version: "v1.00",
    status: "active",
    message: "Robo liberado.",
    createdAt: "2026-06-16T14:31:00.000Z",
    updatedAt: "2026-06-16T14:31:00.000Z"
  };
  const robotTwo = {
    id: "bot_seed_grid",
    name: "GRID.mq5",
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
        key: "LIC-19485815-FLOWWIN",
        status: "active",
        type: "REAL",
        price: 497,
        paidAt: "2026-06-16",
        expiresAt: "2027-06-16T14:31:00.000Z",
        createdAt: "2026-06-16T14:31:00.000Z",
        updatedAt: "2026-06-16T14:31:00.000Z"
      }
    ],
    checkIns: []
  };
}

module.exports = {
  getDb,
  login,
  requireAuth,
  buildState,
  checkLicense,
  createUser,
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
