const { checkLicense, methodNotAllowed, readBody, sendJson, sendText } = require("../_lib/store");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(res);

  const url = new URL(req.url, "https://license.local");
  const input = req.method === "GET" ? Object.fromEntries(url.searchParams.entries()) : await readBody(req);
  const result = checkLicense(input, req);

  if (url.searchParams.get("format") === "text" || input.format === "text") {
    return sendText(res, result.authorized ? 200 : 403, result.authorized ? `AUTHORIZED|${result.expiresAt}` : `DENIED|${result.reason}`);
  }

  sendJson(res, result.authorized ? 200 : 403, result);
};
