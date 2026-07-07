const { getDb, requireAuth, createUser, methodNotAllowed, readBody, sendJson } = require("./_lib/store");

module.exports = async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const db = getDb();

  if (req.method === "GET") return sendJson(res, 200, { ok: true, users: db.users });
  if (req.method === "POST") {
    const user = createUser(await readBody(req));
    db.users.unshift(user);
    return sendJson(res, 201, { ok: true, user });
  }

  methodNotAllowed(res);
};
