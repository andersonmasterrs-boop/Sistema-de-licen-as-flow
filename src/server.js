const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const dataDir = path.join(rootDir, "data");
const dbPath = path.join(dataDir, "db.json");

const PORT = Number(process.env.APP_PORT || process.env.PORT || 3000);
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const sessions = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

ensureDatabase();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: "INTERNAL_ERROR", message: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Sistema de licencas rodando em http://localhost:${PORT}`);
});

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/session/login") {
    const body = await readJson(req);
    if (body.username === ADMIN_USER && body.password === ADMIN_PASSWORD) {
      const token = crypto.randomBytes(24).toString("hex");
      sessions.set(token, { user: ADMIN_USER, expiresAt: Date.now() + SESSION_TTL_MS });
      sendJson(res, 200, { ok: true, token, user: { name: ADMIN_USER } });
      return;
    }
    sendJson(res, 401, { ok: false, error: "INVALID_LOGIN" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/license/check") {
    const result = checkLicense(Object.fromEntries(url.searchParams.entries()), req);
    if (url.searchParams.get("format") === "text") {
      sendText(res, result.authorized ? `AUTHORIZED|${result.expiresAt}` : `DENIED|${result.reason}`, result.authorized ? 200 : 403);
      return;
    }
    sendJson(res, result.authorized ? 200 : 403, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/license/check") {
    const body = await readJson(req);
    const result = checkLicense(body, req);
    sendJson(res, result.authorized ? 200 : 403, result);
    return;
  }

  if (!isAuthenticated(req)) {
    sendJson(res, 401, { ok: false, error: "UNAUTHORIZED" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    sendJson(res, 200, { ok: true, user: { name: ADMIN_USER } });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    const db = readDb();
    sendJson(res, 200, { ok: true, data: buildState(db) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/users") {
    const body = await readJson(req);
    const db = readDb();
    const user = createUser(body);
    db.users.unshift(user);
    writeDb(db);
    sendJson(res, 201, { ok: true, user });
    return;
  }

  const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (userMatch && req.method === "PUT") {
    const body = await readJson(req);
    const db = readDb();
    const user = db.users.find((item) => item.id === userMatch[1]);
    if (!user) return sendJson(res, 404, { ok: false, error: "USER_NOT_FOUND" });
    Object.assign(user, pick(body, ["account", "name", "broker", "type", "notes"]));
    user.updatedAt = new Date().toISOString();
    writeDb(db);
    sendJson(res, 200, { ok: true, user });
    return;
  }

  if (userMatch && req.method === "DELETE") {
    const db = readDb();
    db.users = db.users.filter((item) => item.id !== userMatch[1]);
    db.licenses = db.licenses.filter((item) => item.userId !== userMatch[1]);
    writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/licenses") {
    const body = await readJson(req);
    const db = readDb();
    const license = createLicense(body, db);
    db.licenses.unshift(license);
    writeDb(db);
    sendJson(res, 201, { ok: true, license });
    return;
  }

  const licenseMatch = url.pathname.match(/^\/api\/licenses\/([^/]+)$/);
  if (licenseMatch && req.method === "PUT") {
    const body = await readJson(req);
    const db = readDb();
    const license = db.licenses.find((item) => item.id === licenseMatch[1]);
    if (!license) return sendJson(res, 404, { ok: false, error: "LICENSE_NOT_FOUND" });
    Object.assign(license, pick(body, ["status", "type", "price", "paidAt", "expiresAt", "key"]));
    license.updatedAt = new Date().toISOString();
    writeDb(db);
    sendJson(res, 200, { ok: true, license });
    return;
  }

  if (licenseMatch && req.method === "DELETE") {
    const db = readDb();
    db.licenses = db.licenses.filter((item) => item.id !== licenseMatch[1]);
    writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/robots") {
    const body = await readJson(req);
    const db = readDb();
    const robot = createRobot(body);
    db.robots.unshift(robot);
    writeDb(db);
    sendJson(res, 201, { ok: true, robot });
    return;
  }

  const robotMatch = url.pathname.match(/^\/api\/robots\/([^/]+)$/);
  if (robotMatch && req.method === "PUT") {
    const body = await readJson(req);
    const db = readDb();
    const robot = db.robots.find((item) => item.id === robotMatch[1]);
    if (!robot) return sendJson(res, 404, { ok: false, error: "ROBOT_NOT_FOUND" });
    Object.assign(robot, pick(body, ["name", "version", "status", "message"]));
    robot.updatedAt = new Date().toISOString();
    writeDb(db);
    sendJson(res, 200, { ok: true, robot });
    return;
  }

  sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
}

function checkLicense(input, req) {
  const db = readDb();
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
    ip: req.socket.remoteAddress,
    account: result.account,
    robot: result.robot,
    authorized: result.authorized,
    reason: result.reason,
    userId: result.userId || null,
    robotId: result.robotId || null,
    licenseId: result.licenseId || null
  });
  db.checkIns = db.checkIns.slice(0, 500);
  writeDb(db);
  return result;
}

function buildState(db) {
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

function createLicense(body, db) {
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

function serveStatic(req, res, url) {
  let filePath = url.pathname === "/" ? path.join(publicDir, "index.html") : path.join(publicDir, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(publicDir)) {
    sendText(res, "Forbidden", 403);
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(publicDir, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) sendText(res, "Not found", 404);
        else sendBuffer(res, fallback, "text/html; charset=utf-8");
      });
      return;
    }
    sendBuffer(res, content, mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  });
}

function isAuthenticated(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = sessions.get(token);
  if (!session) return false;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function readDb() {
  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function ensureDatabase() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(dbPath)) return;
  const userOne = createUser({ account: "19485815", name: "LORENI LUCIA BENINI TOSIN", broker: "XP Investimentos CCTVM SA", type: "Real" });
  const userTwo = createUser({ account: "13115936", name: "EVELIZE MASIERO", broker: "Banco", type: "Real" });
  const robotOne = createRobot({ name: "FLOWWIN.mq5", version: "v1.00", status: "active", message: "Robo liberado." });
  const robotTwo = createRobot({ name: "GRID.mq5", version: "v5.00", status: "updated", message: "Versao atualizada disponivel." });
  const seed = {
    users: [userOne, userTwo],
    robots: [robotOne, robotTwo],
    licenses: [
      createLicense({
        userId: userOne.id,
        robotId: robotOne.id,
        key: "LIC-19485815-FLOWWIN",
        status: "active",
        type: "REAL",
        price: 497,
        paidAt: "2026-06-16",
        expiresAt: "2027-06-16T14:31:00.000Z"
      }, { users: [userOne], robots: [robotOne] })
    ],
    checkIns: []
  };
  writeDb(seed);
}

function pick(source, fields) {
  return fields.reduce((result, field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) result[field] = source[field];
    return result;
  }, {});
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function sendJson(res, status, payload) {
  sendBuffer(res, Buffer.from(JSON.stringify(payload)), "application/json; charset=utf-8", status);
}

function sendText(res, text, status = 200) {
  sendBuffer(res, Buffer.from(text), "text/plain; charset=utf-8", status);
}

function sendBuffer(res, buffer, contentType, status = 200) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(buffer);
}
