const { sendJson } = require("./_lib/store");

module.exports = function handler(req, res) {
  sendJson(res, 200, {
    ok: true,
    service: "license-system-api",
    time: new Date().toISOString()
  });
};
