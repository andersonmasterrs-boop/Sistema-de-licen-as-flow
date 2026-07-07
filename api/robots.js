const { getDb, requireAuth, createRobot, methodNotAllowed, readBody, sendJson } = require("./_lib/store");

module.exports = async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const db = getDb();

  if (req.method === "GET") return sendJson(res, 200, { ok: true, robots: db.robots });
  if (req.method === "POST") {
    const robot = createRobot(await readBody(req));
    db.robots.unshift(robot);
    return sendJson(res, 201, { ok: true, robot });
  }

  methodNotAllowed(res);
};
