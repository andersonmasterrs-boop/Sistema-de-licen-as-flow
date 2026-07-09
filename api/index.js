const {
  getDb,
  login,
  requireAuth,
  buildState,
  checkLicense,
  reportPerformance,
  createAdmin,
  updateAdmin,
  createUser,
  createRobot,
  createLicense,
  updateById,
  removeById,
  resolvePendingRequestsForAccount,
  loadDb,
  saveDb,
  storageStatus,
  readBody,
  sendJson,
  sendText,
  methodNotAllowed,
  pick
} = require("../lib/store");

module.exports = async function handler(req, res) {
  try {
    await loadDb();
    const route = normalizeRoute(req);

    if (route === "/health") {
      return sendJson(res, 200, { ok: true, service: "license-system-api", storage: storageStatus(), time: new Date().toISOString() });
    }

    if (route === "/session/login") {
      if (req.method !== "POST") return methodNotAllowed(res);
      const session = login(await readBody(req));
      if (!session) return sendJson(res, 401, { ok: false, error: "INVALID_LOGIN" });
      return sendJson(res, 200, session);
    }

    if (route === "/license/check") {
      if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(res);
      const url = new URL(req.url, "https://license.local");
      const input = req.method === "GET" ? Object.fromEntries(url.searchParams.entries()) : await readBody(req);
      const result = checkLicense(input, req);
      await persistDb();

      if (url.searchParams.get("format") === "text" || input.format === "text") {
        return sendText(res, result.authorized ? 200 : 403, result.authorized ? `AUTHORIZED|${result.expiresAt}|${sanitizeTextMessage(result.message || "")}` : `DENIED|${result.reason}|${sanitizeTextMessage(result.message || "")}`);
      }
      return sendJson(res, result.authorized ? 200 : 403, result);
    }

    if (route === "/performance/report") {
      if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(res);
      const url = new URL(req.url, "https://license.local");
      const input = req.method === "GET" ? Object.fromEntries(url.searchParams.entries()) : await readBody(req);
      const result = reportPerformance(input, req);
      await persistDb();
      if (url.searchParams.get("format") === "text" || input.format === "text") {
        return sendText(res, result.ok ? 200 : 403, result.ok ? "OK" : `DENIED|${result.error}`);
      }
      return sendJson(res, result.ok ? 200 : 403, result);
    }

    if (!requireAuth(req, res)) return;

    if (route === "/me") {
      if (req.method !== "GET") return methodNotAllowed(res);
      return sendJson(res, 200, { ok: true, user: { name: process.env.ADMIN_USER || "admin" } });
    }

    if (route === "/state") {
      if (req.method !== "GET") return methodNotAllowed(res);
      return sendJson(res, 200, { ok: true, data: buildState() });
    }

    if (route === "/admins") return handleAdmins(req, res);
    if (route.startsWith("/admins/")) return handleAdminById(req, res, route.slice("/admins/".length));
    if (route === "/users") return handleUsers(req, res);
    if (route.startsWith("/users/")) return handleUserById(req, res, route.slice("/users/".length));
    if (route === "/robots") return handleRobots(req, res);
    if (route.startsWith("/robots/")) return handleRobotById(req, res, route.slice("/robots/".length));
    if (route === "/licenses") return handleLicenses(req, res);
    if (route.startsWith("/licenses/")) return handleLicenseById(req, res, route.slice("/licenses/".length));

    return sendJson(res, 404, { ok: false, error: "NOT_FOUND", route });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: "INTERNAL_ERROR", message: error.message });
  }
};

function normalizeRoute(req) {
  const queryPath = req.query && req.query.path;
  const value = Array.isArray(queryPath) ? queryPath.join("/") : queryPath;
  if (value) return `/${String(value).replace(/^\/+/, "").replace(/\.js$/, "")}`;

  const url = new URL(req.url, "https://license.local");
  return url.pathname.replace(/^\/api/, "") || "/";
}

function sanitizeTextMessage(message) {
  return String(message || "").replace(/\|/g, "/").replace(/[\r\n]+/g, " ").trim();
}

async function persistDb() {
  const saved = await saveDb();
  if (!saved && process.env.VERCEL) {
    throw new Error("PERSISTENCE_SAVE_FAILED");
  }
}

async function handleUsers(req, res) {
  const db = getDb();
  if (req.method === "GET") return sendJson(res, 200, { ok: true, users: db.users });
  if (req.method === "POST") {
    const user = createUser(await readBody(req));
    db.users.unshift(user);
    resolvePendingRequestsForAccount(user.account);
    await persistDb();
    return sendJson(res, 201, { ok: true, user });
  }
  return methodNotAllowed(res);
}

async function handleAdmins(req, res) {
  const db = getDb();
  if (req.method === "GET") return sendJson(res, 200, { ok: true, admins: buildState().admins });
  if (req.method === "POST") {
    const admin = createAdmin(await readBody(req));
    db.admins.unshift(admin);
    await persistDb();
    const { passwordHash, passwordSalt, ...publicAdmin } = admin;
    return sendJson(res, 201, { ok: true, admin: publicAdmin });
  }
  return methodNotAllowed(res);
}

async function handleAdminById(req, res, id) {
  const db = getDb();
  const decodedId = decodeURIComponent(id);
  if (req.method === "PUT") {
    const body = pick(await readBody(req), ["name", "role", "status", "password"]);
    const currentAdmin = (db.admins || []).find((item) => item.id === decodedId);
    if (!currentAdmin) return sendJson(res, 404, { ok: false, error: "ADMIN_NOT_FOUND" });
    if (currentAdmin.status === "active" && body.status && body.status !== "active" && db.admins.filter((item) => item.status === "active").length <= 1) {
      return sendJson(res, 400, { ok: false, error: "LAST_ADMIN_REQUIRED" });
    }
    const admin = updateAdmin(decodedId, body);
    if (!admin) return sendJson(res, 404, { ok: false, error: "ADMIN_NOT_FOUND" });
    await persistDb();
    const { passwordHash, passwordSalt, ...publicAdmin } = admin;
    return sendJson(res, 200, { ok: true, admin: publicAdmin });
  }

  if (req.method === "DELETE") {
    const admin = (db.admins || []).find((item) => item.id === decodedId);
    if (!admin) return sendJson(res, 404, { ok: false, error: "ADMIN_NOT_FOUND" });
    const activeAdmins = db.admins.filter((item) => item.status === "active");
    if (admin.status === "active" && activeAdmins.length <= 1) {
      return sendJson(res, 400, { ok: false, error: "LAST_ADMIN_REQUIRED" });
    }
    removeById("admins", decodedId);
    await persistDb();
    return sendJson(res, 200, { ok: true });
  }

  return methodNotAllowed(res);
}

async function handleUserById(req, res, id) {
  const decodedId = decodeURIComponent(id);
  if (req.method === "PUT") {
    const user = updateById("users", decodedId, pick(await readBody(req), ["account", "name", "broker", "type", "notes"]));
    if (!user) return sendJson(res, 404, { ok: false, error: "USER_NOT_FOUND" });
    await persistDb();
    return sendJson(res, 200, { ok: true, user });
  }

  if (req.method === "DELETE") {
    const db = getDb();
    removeById("users", decodedId);
    db.licenses = db.licenses.filter((item) => item.userId !== decodedId);
    await persistDb();
    return sendJson(res, 200, { ok: true });
  }

  return methodNotAllowed(res);
}

async function handleRobots(req, res) {
  const db = getDb();
  if (req.method === "GET") return sendJson(res, 200, { ok: true, robots: db.robots });
  if (req.method === "POST") {
    const robot = createRobot(await readBody(req));
    db.robots.unshift(robot);
    await persistDb();
    return sendJson(res, 201, { ok: true, robot });
  }
  return methodNotAllowed(res);
}

async function handleRobotById(req, res, id) {
  if (req.method !== "PUT") return methodNotAllowed(res);
  const robot = updateById("robots", decodeURIComponent(id), pick(await readBody(req), ["name", "version", "status", "message"]));
  if (!robot) return sendJson(res, 404, { ok: false, error: "ROBOT_NOT_FOUND" });
  await persistDb();
  return sendJson(res, 200, { ok: true, robot });
}

async function handleLicenses(req, res) {
  const db = getDb();
  if (req.method === "GET") return sendJson(res, 200, { ok: true, licenses: db.licenses });
  if (req.method === "POST") {
    const license = createLicense(await readBody(req));
    db.licenses.unshift(license);
    await persistDb();
    return sendJson(res, 201, { ok: true, license });
  }
  return methodNotAllowed(res);
}

async function handleLicenseById(req, res, id) {
  const decodedId = decodeURIComponent(id);
  if (req.method === "PUT") {
    const license = updateById("licenses", decodedId, pick(await readBody(req), ["status", "type", "price", "paidAt", "expiresAt", "key"]));
    if (!license) return sendJson(res, 404, { ok: false, error: "LICENSE_NOT_FOUND" });
    await persistDb();
    return sendJson(res, 200, { ok: true, license });
  }

  if (req.method === "DELETE") {
    removeById("licenses", decodedId);
    await persistDb();
    return sendJson(res, 200, { ok: true });
  }

  return methodNotAllowed(res);
}
