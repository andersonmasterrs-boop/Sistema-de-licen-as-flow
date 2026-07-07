const { getDb, requireAuth, methodNotAllowed, pick, readBody, removeById, sendJson, updateById } = require("../_lib/store");

module.exports = async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const id = req.query.id;

  if (req.method === "PUT") {
    const user = updateById("users", id, pick(await readBody(req), ["account", "name", "broker", "type", "notes"]));
    if (!user) return sendJson(res, 404, { ok: false, error: "USER_NOT_FOUND" });
    return sendJson(res, 200, { ok: true, user });
  }

  if (req.method === "DELETE") {
    const db = getDb();
    removeById("users", id);
    db.licenses = db.licenses.filter((item) => item.userId !== id);
    return sendJson(res, 200, { ok: true });
  }

  methodNotAllowed(res);
};
