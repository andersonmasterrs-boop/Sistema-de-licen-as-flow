const {
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
  resolvePendingRequestsForAccount,
  readBody,
  sendJson,
  sendText,
  methodNotAllowed,
  pick
} = require("./_lib/store");

module.exports = async function handler(req, res) {
  try {
    const route = normalizeRoute(req);

    if (route === "/health") {
      return sendJson(res, 200, { ok: true, service: "license-system-api", time: new Date().toISOString() });
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

      if (url.searchParams.get("format") === "text" || input.format === "text") {
        return sendText(res, result.authorized ? 200 : 403, result.authorized ? `AUTHORIZED|${result.expiresAt}` : `DENIED|${result.reason}`);
      }
      return sendJson(res, result.authorized ? 200 : 403, result);
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

async function handleUsers(req, res) {
  const db = getDb();
  if (req.method === "GET") return sendJson(res, 200, { ok: true, users: db.users });
  if (req.method === "POST") {
    const user = createUser(await readBody(req));
    db.users.unshift(user);
    resolvePendingRequestsForAccount(user.account);
    return sendJson(res, 201, { ok: true, user });
  }
  return methodNotAllowed(res);
}

async function handleUserById(req, res, id) {
  const decodedId = decodeURIComponent(id);
  if (req.method === "PUT") {
    const user = updateById("users", decodedId, pick(await readBody(req), ["account", "name", "broker", "type", "notes"]));
    if (!user) return sendJson(res, 404, { ok: false, error: "USER_NOT_FOUND" });
    return sendJson(res, 200, { ok: true, user });
  }

  if (req.method === "DELETE") {
    const db = getDb();
    removeById("users", decodedId);
    db.licenses = db.licenses.filter((item) => item.userId !== decodedId);
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
    return sendJson(res, 201, { ok: true, robot });
  }
  return methodNotAllowed(res);
}

async function handleRobotById(req, res, id) {
  if (req.method !== "PUT") return methodNotAllowed(res);
  const robot = updateById("robots", decodeURIComponent(id), pick(await readBody(req), ["name", "version", "status", "message"]));
  if (!robot) return sendJson(res, 404, { ok: false, error: "ROBOT_NOT_FOUND" });
  return sendJson(res, 200, { ok: true, robot });
}

async function handleLicenses(req, res) {
  const db = getDb();
  if (req.method === "GET") return sendJson(res, 200, { ok: true, licenses: db.licenses });
  if (req.method === "POST") {
    const license = createLicense(await readBody(req));
    db.licenses.unshift(license);
    return sendJson(res, 201, { ok: true, license });
  }
  return methodNotAllowed(res);
}

async function handleLicenseById(req, res, id) {
  const decodedId = decodeURIComponent(id);
  if (req.method === "PUT") {
    const license = updateById("licenses", decodedId, pick(await readBody(req), ["status", "type", "price", "paidAt", "expiresAt", "key"]));
    if (!license) return sendJson(res, 404, { ok: false, error: "LICENSE_NOT_FOUND" });
    return sendJson(res, 200, { ok: true, license });
  }

  if (req.method === "DELETE") {
    removeById("licenses", decodedId);
    return sendJson(res, 200, { ok: true });
  }

  return methodNotAllowed(res);
}
