const { requireAuth, methodNotAllowed, sendJson } = require("./_lib/store");

module.exports = function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res);
  if (!requireAuth(req, res)) return;
  sendJson(res, 200, { ok: true, user: { name: process.env.ADMIN_USER || "admin" } });
};
