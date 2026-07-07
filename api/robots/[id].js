const { requireAuth, methodNotAllowed, pick, readBody, sendJson, updateById } = require("../_lib/store");

module.exports = async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "PUT") return methodNotAllowed(res);
  const robot = updateById("robots", req.query.id, pick(await readBody(req), ["name", "version", "status", "message"]));
  if (!robot) return sendJson(res, 404, { ok: false, error: "ROBOT_NOT_FOUND" });
  sendJson(res, 200, { ok: true, robot });
};
