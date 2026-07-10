const {
  getDb,
  login,
  requireAuth,
  buildState,
  buildPublicCheckoutState,
  checkLicense,
  reportPerformance,
  createAdmin,
  updateAdmin,
  createUser,
  updateUser,
  createRobot,
  createPlan,
  createPayment,
  applyApprovedPayment,
  createLicense,
  updateById,
  removeById,
  resolvePendingRequestsForAccount,
  loadDb,
  saveDb,
  storageStatus,
  readBody,
  sendJson,
  sendText,
  methodNotAllowed,
  pick
} = require("../lib/store");

module.exports = async function handler(req, res) {
  try {
    await loadDb();
    const route = normalizeRoute(req);

    if (route === "/health") {
      return sendJson(res, 200, { ok: true, service: "license-system-api", storage: storageStatus(), time: new Date().toISOString() });
    }

    if (route === "/session/login") {
      if (req.method !== "POST") return methodNotAllowed(res);
      const session = login(await readBody(req));
      if (!session) return sendJson(res, 401, { ok: false, error: "INVALID_LOGIN" });
      return sendJson(res, 200, session);
    }

    if (route === "/license/check") {
      if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(res);
      const url = new URL(req.url, "https://license.local");
      const input = req.method === "GET" ? Object.fromEntries(url.searchParams.entries()) : await readBody(req);
      const result = checkLicense(input, req);
      await persistDb();

      if (url.searchParams.get("format") === "text" || input.format === "text") {
        return sendText(res, result.authorized ? 200 : 403, result.authorized ? `AUTHORIZED|${result.expiresAt}|${sanitizeTextMessage(result.message || "")}` : `DENIED|${result.reason}|${sanitizeTextMessage(result.message || "")}`);
      }
      return sendJson(res, result.authorized ? 200 : 403, result);
    }

    if (route === "/performance/report") {
      if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(res);
      const url = new URL(req.url, "https://license.local");
      const input = req.method === "GET" ? Object.fromEntries(url.searchParams.entries()) : await readBody(req);
      const result = reportPerformance(input, req);
      await persistDb();
      if (url.searchParams.get("format") === "text" || input.format === "text") {
        return sendText(res, result.ok ? 200 : 403, result.ok ? "OK" : `DENIED|${result.error}`);
      }
      return sendJson(res, result.ok ? 200 : 403, result);
    }

    if (route === "/checkout/config") {
      if (req.method !== "GET") return methodNotAllowed(res);
      return sendJson(res, 200, { ok: true, data: buildPublicCheckoutState() });
    }

    if (route === "/checkout") {
      if (req.method !== "POST") return methodNotAllowed(res);
      const result = await createCheckout(await readBody(req), req);
      await persistDb();
      return sendJson(res, 201, { ok: true, ...result });
    }

    if (route === "/payments/mercadopago/webhook") {
      if (req.method !== "GET" && req.method !== "POST") return methodNotAllowed(res);
      const result = await handleMercadoPagoWebhook(req);
      await persistDb();
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (!requireAuth(req, res)) return;

    if (route === "/me") {
      if (req.method !== "GET") return methodNotAllowed(res);
      return sendJson(res, 200, { ok: true, user: { name: process.env.ADMIN_USER || "admin" } });
    }

    if (route === "/state") {
      if (req.method !== "GET") return methodNotAllowed(res);
      return sendJson(res, 200, { ok: true, data: buildState() });
    }

    if (route === "/admins") return handleAdmins(req, res);
    if (route.startsWith("/admins/")) return handleAdminById(req, res, route.slice("/admins/".length));
    if (route === "/users") return handleUsers(req, res);
    if (route.startsWith("/users/")) return handleUserById(req, res, route.slice("/users/".length));
    if (route === "/robots") return handleRobots(req, res);
    if (route.startsWith("/robots/")) return handleRobotById(req, res, route.slice("/robots/".length));
    if (route === "/plans") return handlePlans(req, res);
    if (route.startsWith("/plans/")) return handlePlanById(req, res, route.slice("/plans/".length));
    if (route === "/payments") return handlePayments(req, res);
    if (route === "/licenses") return handleLicenses(req, res);
    if (route.startsWith("/licenses/")) return handleLicenseById(req, res, route.slice("/licenses/".length));

    return sendJson(res, 404, { ok: false, error: "NOT_FOUND", route });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: "INTERNAL_ERROR", message: error.message });
  }
};

function normalizeRoute(req) {
  const queryPath = req.query && req.query.path;
  const value = Array.isArray(queryPath) ? queryPath.join("/") : queryPath;
  if (value) return `/${String(value).replace(/^\/+/, "").replace(/\.js$/, "")}`;

  const url = new URL(req.url, "https://license.local");
  return url.pathname.replace(/^\/api/, "") || "/";
}

function sanitizeTextMessage(message) {
  return String(message || "").replace(/\|/g, "/").replace(/[\r\n]+/g, " ").trim();
}

async function persistDb() {
  const saved = await saveDb();
  if (!saved && process.env.VERCEL) {
    throw new Error("PERSISTENCE_SAVE_FAILED");
  }
}

async function handleUsers(req, res) {
  const db = getDb();
  if (req.method === "GET") return sendJson(res, 200, { ok: true, users: db.users });
  if (req.method === "POST") {
    const user = createUser(await readBody(req));
    db.users.unshift(user);
    resolvePendingRequestsForAccount(user.account);
    await persistDb();
    return sendJson(res, 201, { ok: true, user });
  }
  return methodNotAllowed(res);
}

async function handleAdmins(req, res) {
  const db = getDb();
  if (req.method === "GET") return sendJson(res, 200, { ok: true, admins: buildState().admins });
  if (req.method === "POST") {
    const admin = createAdmin(await readBody(req));
    db.admins.unshift(admin);
    await persistDb();
    const { passwordHash, passwordSalt, ...publicAdmin } = admin;
    return sendJson(res, 201, { ok: true, admin: publicAdmin });
  }
  return methodNotAllowed(res);
}

async function handleAdminById(req, res, id) {
  const db = getDb();
  const decodedId = decodeURIComponent(id);
  if (req.method === "PUT") {
    const body = pick(await readBody(req), ["name", "role", "status", "password"]);
    const currentAdmin = (db.admins || []).find((item) => item.id === decodedId);
    if (!currentAdmin) return sendJson(res, 404, { ok: false, error: "ADMIN_NOT_FOUND" });
    if (currentAdmin.status === "active" && body.status && body.status !== "active" && db.admins.filter((item) => item.status === "active").length <= 1) {
      return sendJson(res, 400, { ok: false, error: "LAST_ADMIN_REQUIRED" });
    }
    const admin = updateAdmin(decodedId, body);
    if (!admin) return sendJson(res, 404, { ok: false, error: "ADMIN_NOT_FOUND" });
    await persistDb();
    const { passwordHash, passwordSalt, ...publicAdmin } = admin;
    return sendJson(res, 200, { ok: true, admin: publicAdmin });
  }

  if (req.method === "DELETE") {
    const admin = (db.admins || []).find((item) => item.id === decodedId);
    if (!admin) return sendJson(res, 404, { ok: false, error: "ADMIN_NOT_FOUND" });
    const activeAdmins = db.admins.filter((item) => item.status === "active");
    if (admin.status === "active" && activeAdmins.length <= 1) {
      return sendJson(res, 400, { ok: false, error: "LAST_ADMIN_REQUIRED" });
    }
    removeById("admins", decodedId);
    await persistDb();
    return sendJson(res, 200, { ok: true });
  }

  return methodNotAllowed(res);
}

async function handleUserById(req, res, id) {
  const decodedId = decodeURIComponent(id);
  if (req.method === "PUT") {
    const body = await readBody(req);
    const user = updateUser(decodedId, body);
    if (!user) return sendJson(res, 404, { ok: false, error: "USER_NOT_FOUND" });
    if (body.addAccount && body.addAccount.account) resolvePendingRequestsForAccount(body.addAccount.account);
    await persistDb();
    return sendJson(res, 200, { ok: true, user });
  }

  if (req.method === "DELETE") {
    const db = getDb();
    removeById("users", decodedId);
    db.licenses = db.licenses.filter((item) => item.userId !== decodedId);
    await persistDb();
    return sendJson(res, 200, { ok: true });
  }

  return methodNotAllowed(res);
}

async function handleRobots(req, res) {
  const db = getDb();
  if (req.method === "GET") return sendJson(res, 200, { ok: true, robots: db.robots });
  if (req.method === "POST") {
    const robot = createRobot(await readBody(req));
    db.robots.unshift(robot);
    await persistDb();
    return sendJson(res, 201, { ok: true, robot });
  }
  return methodNotAllowed(res);
}

async function handlePlans(req, res) {
  const db = getDb();
  if (req.method === "GET") return sendJson(res, 200, { ok: true, plans: db.plans });
  if (req.method === "POST") {
    const plan = createPlan(await readBody(req));
    db.plans.unshift(plan);
    await persistDb();
    return sendJson(res, 201, { ok: true, plan });
  }
  return methodNotAllowed(res);
}

async function handlePlanById(req, res, id) {
  const decodedId = decodeURIComponent(id);
  if (req.method === "PUT") {
    const plan = updateById("plans", decodedId, pick(await readBody(req), ["name", "description", "robotId", "durationDays", "price", "status"]));
    if (!plan) return sendJson(res, 404, { ok: false, error: "PLAN_NOT_FOUND" });
    await persistDb();
    return sendJson(res, 200, { ok: true, plan });
  }
  if (req.method === "DELETE") {
    removeById("plans", decodedId);
    await persistDb();
    return sendJson(res, 200, { ok: true });
  }
  return methodNotAllowed(res);
}

async function handlePayments(req, res) {
  const db = getDb();
  if (req.method === "GET") return sendJson(res, 200, { ok: true, payments: db.payments });
  return methodNotAllowed(res);
}

async function handleRobotById(req, res, id) {
  if (req.method !== "PUT") return methodNotAllowed(res);
  const robot = updateById("robots", decodeURIComponent(id), pick(await readBody(req), ["name", "version", "status", "message"]));
  if (!robot) return sendJson(res, 404, { ok: false, error: "ROBOT_NOT_FOUND" });
  await persistDb();
  return sendJson(res, 200, { ok: true, robot });
}

async function createCheckout(body, req) {
  const db = getDb();
  const plan = db.plans.find((item) => item.id === body.planId && item.status === "active");
  if (!plan) throw new Error("PLAN_NOT_FOUND");
  const robot = db.robots.find((item) => item.id === plan.robotId);
  if (!robot) throw new Error("ROBOT_NOT_FOUND");

  const payment = createPayment({
    provider: "mercadopago",
    status: "pending",
    planId: plan.id,
    robotId: robot.id,
    account: body.account,
    name: body.name,
    phone: body.phone,
    broker: body.broker,
    type: body.type || "Real",
    amount: plan.price,
    currency: "BRL"
  });
  payment.externalReference = payment.id;
  db.payments.unshift(payment);

  const preference = await createMercadoPagoPreference({ payment, plan, robot, req });
  payment.providerPreferenceId = preference.id || "";
  payment.checkoutUrl = preference.init_point || preference.sandbox_init_point || "";
  payment.updatedAt = new Date().toISOString();

  return {
    payment,
    checkoutUrl: payment.checkoutUrl
  };
}

async function createMercadoPagoPreference({ payment, plan, robot, req }) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN || "";
  if (!token) throw new Error("MERCADOPAGO_ACCESS_TOKEN_REQUIRED");

  const baseUrl = publicBaseUrl(req);
  const payload = {
    items: [
      {
        title: plan.name,
        description: plan.description || `Licenca ${robot.name}`,
        quantity: 1,
        currency_id: "BRL",
        unit_price: Number(plan.price || 0)
      }
    ],
    payer: {
      name: payment.name,
      phone: { number: payment.phone }
    },
    external_reference: payment.externalReference,
    notification_url: `${baseUrl}/api/payments/mercadopago/webhook`,
    back_urls: {
      success: `${baseUrl}/comprar?status=success&payment=${encodeURIComponent(payment.id)}`,
      pending: `${baseUrl}/comprar?status=pending&payment=${encodeURIComponent(payment.id)}`,
      failure: `${baseUrl}/comprar?status=failure&payment=${encodeURIComponent(payment.id)}`
    },
    auto_return: "approved",
    metadata: {
      payment_id: payment.id,
      plan_id: plan.id,
      account: payment.account,
      robot: robot.name
    }
  };

  const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `MERCADOPAGO_PREFERENCE_FAILED_${response.status}`);
  }
  return data;
}

async function handleMercadoPagoWebhook(req) {
  const body = req.method === "POST" ? await readBody(req) : {};
  const url = new URL(req.url, "https://license.local");
  const paymentId = String(
    body?.data?.id ||
    body?.resource?.split?.("/")?.pop?.() ||
    url.searchParams.get("data.id") ||
    url.searchParams.get("id") ||
    ""
  );

  if (!paymentId) return { received: true, ignored: "NO_PAYMENT_ID" };

  const mercadoPagoPayment = await fetchMercadoPagoPayment(paymentId);
  const externalReference = String(mercadoPagoPayment.external_reference || "");
  const db = getDb();
  const payment = db.payments.find((item) => item.externalReference === externalReference || item.id === externalReference);
  if (!payment) return { received: true, ignored: "PAYMENT_NOT_FOUND", providerPaymentId: paymentId };

  payment.providerPaymentId = String(mercadoPagoPayment.id || paymentId);
  payment.rawStatus = mercadoPagoPayment.status || "";
  payment.updatedAt = new Date().toISOString();

  if (mercadoPagoPayment.status === "approved") {
    payment.paidAt = mercadoPagoPayment.date_approved || new Date().toISOString();
    applyApprovedPayment(payment, {
      providerPaymentId: mercadoPagoPayment.id,
      rawStatus: mercadoPagoPayment.status
    });
    return { received: true, paymentId: payment.id, status: "approved" };
  }

  if (["rejected", "cancelled", "refunded", "charged_back"].includes(mercadoPagoPayment.status)) {
    payment.status = mercadoPagoPayment.status;
  } else {
    payment.status = "pending";
  }

  return { received: true, paymentId: payment.id, status: payment.status };
}

async function fetchMercadoPagoPayment(paymentId) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN || "";
  if (!token) throw new Error("MERCADOPAGO_ACCESS_TOKEN_REQUIRED");
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `MERCADOPAGO_PAYMENT_FETCH_FAILED_${response.status}`);
  }
  return data;
}

function publicBaseUrl(req) {
  return (process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`).replace(/\/+$/, "");
}

async function handleLicenses(req, res) {
  const db = getDb();
  if (req.method === "GET") return sendJson(res, 200, { ok: true, licenses: db.licenses });
  if (req.method === "POST") {
    const license = createLicense(await readBody(req));
    db.licenses.unshift(license);
    await persistDb();
    return sendJson(res, 201, { ok: true, license });
  }
  return methodNotAllowed(res);
}

async function handleLicenseById(req, res, id) {
  const decodedId = decodeURIComponent(id);
  if (req.method === "PUT") {
    const license = updateById("licenses", decodedId, pick(await readBody(req), ["status", "type", "price", "paidAt", "expiresAt", "key"]));
    if (!license) return sendJson(res, 404, { ok: false, error: "LICENSE_NOT_FOUND" });
    await persistDb();
    return sendJson(res, 200, { ok: true, license });
  }

  if (req.method === "DELETE") {
    removeById("licenses", decodedId);
    await persistDb();
    return sendJson(res, 200, { ok: true });
  }

  return methodNotAllowed(res);
}
