const { requireAuth, methodNotAllowed, pick, readBody, removeById, sendJson, updateById } = require("../_lib/store");

module.exports = async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const id = req.query.id;

  if (req.method === "PUT") {
    const license = updateById("licenses", id, pick(await readBody(req), ["status", "type", "price", "paidAt", "expiresAt", "key"]));
    if (!license) return sendJson(res, 404, { ok: false, error: "LICENSE_NOT_FOUND" });
    return sendJson(res, 200, { ok: true, license });
  }

  if (req.method === "DELETE") {
    removeById("licenses", id);
    return sendJson(res, 200, { ok: true });
  }

  methodNotAllowed(res);
};
