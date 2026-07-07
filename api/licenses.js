const { getDb, requireAuth, createLicense, methodNotAllowed, readBody, sendJson } = require("./_lib/store");

module.exports = async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const db = getDb();

  if (req.method === "GET") return sendJson(res, 200, { ok: true, licenses: db.licenses });
  if (req.method === "POST") {
    const license = createLicense(await readBody(req));
    db.licenses.unshift(license);
    return sendJson(res, 201, { ok: true, license });
  }

  methodNotAllowed(res);
};
