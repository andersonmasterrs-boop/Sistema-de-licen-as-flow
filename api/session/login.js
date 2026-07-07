const { login, methodNotAllowed, readBody, sendJson } = require("../_lib/store");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res);
  const body = await readBody(req);
  const session = login(body);
  if (!session) return sendJson(res, 401, { ok: false, error: "INVALID_LOGIN" });
  sendJson(res, 200, session);
};
