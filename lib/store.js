const crypto = require("crypto");

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const DB_KEY = process.env.LICENSE_DB_KEY || "license-system-db";

const initial = createInitialDb();
global.__licenseSystemDb = global.__licenseSystemDb || initial;

function getDb() {
  return global.__licenseSystemDb;
}

function hasPersistentStore() {
  return hasSupabaseStore() || hasKvStore();
}

async function loadDb() {
  if (!hasPersistentStore()) return getDb();

  try {
    if (hasSupabaseStore()) {
      const db = await supabaseLoadDb();
      if (db) {
        global.__licenseSystemDb = db;
        ensureDbShape(global.__licenseSystemDb);
        return global.__licenseSystemDb;
      }

      await saveDb();
      return getDb();
    }

    const response = await kvCommand(["GET", DB_KEY]);
    if (response && response.result) {
      global.__licenseSystemDb = JSON.parse(response.result);
      ensureDbShape(global.__licenseSystemDb);
      return global.__licenseSystemDb;
    }

    await saveDb();
    return getDb();
  } catch (error) {
    console.error("Failed to load persistent DB", error);
    return getDb();
  }
}

async function saveDb() {
  if (!hasPersistentStore()) return false;

  try {
    if (hasSupabaseStore()) {
      await supabaseSaveDb(getDb());
      return true;
    }

    await kvCommand(["SET", DB_KEY, JSON.stringify(getDb())]);
    return true;
  } catch (error) {
    console.error("Failed to save persistent DB", error);
    return false;
  }
}

function storageStatus() {
  if (hasSupabaseStore()) return "supabase";
  if (hasKvStore()) return "kv";
  return "memory";
}

function createToken(username) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${username}:${expiresAt}`;
  const signature = sign(payload);
  return Buffer.from(`${payload}:${signature}`).toString("base64url");
}

function isAuthenticated(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return false;

  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split(":");
    const user = parts[0];
    const expiresAt = Number(parts[1]);
    const signature = parts[2];
    const payload = `${user}:${expiresAt}`;
    if (expiresAt <= Date.now() || signature !== sign(payload)) return false;
    if (user === ADMIN_USER) return true;
    const db = getDb();
    return Boolean((db.admins || []).find((admin) => admin.username === user && admin.status === "active"));
  } catch {
    return false;
  }
}

function requireAuth(req, res) {
  if (isAuthenticated(req)) return true;
  sendJson(res, 401, { ok: false, error: "UNAUTHORIZED" });
  return false;
}

function login(body) {
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const db = getDb();
  const admin = (db.admins || []).find((item) => item.username === username && item.status === "active");

  if (admin && verifyPassword(password, admin.passwordHash, admin.passwordSalt)) {
    return { ok: true, token: createToken(admin.username), user: { name: admin.name || admin.username, username: admin.username } };
  }

  if (username === ADMIN_USER && password === ADMIN_PASSWORD) {
    return { ok: true, token: createToken(ADMIN_USER), user: { name: ADMIN_USER, username: ADMIN_USER } };
  }
  return null;
}

function buildState() {
  const db = getDb();
  const now = new Date();
  const activeLicenses = db.licenses.filter((item) => item.status === "active" && new Date(item.expiresAt) > now);
  const month = now.toISOString().slice(0, 7);
  const monthRevenue = db.payments
    .filter((item) => item.status === "approved" && item.paidAt && item.paidAt.slice(0, 7) === month)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return {
    summary: {
      activeAccounts: new Set(activeLicenses.map((item) => item.userId)).size,
      totalUsers: db.users.length,
      activeLicenses: activeLicenses.length,
      robots: db.robots.length,
      monthRevenue,
      checksToday: db.checkIns.filter((item) => item.at.slice(0, 10) === now.toISOString().slice(0, 10)).length,
      pendingRequests: (db.pendingRequests || []).filter((request) => !request.resolvedAt).length
    },
    pendingRequests: (db.pendingRequests || []).filter((request) => !request.resolvedAt).slice(0, 80),
    admins: (db.admins || []).map(publicAdmin),
    users: db.users,
    robots: db.robots.map((robot) => ({
      ...robot,
      clients: activeLicenses.filter((license) => license.robotId === robot.id).length
    })),
    plans: db.plans,
    payments: db.payments,
    licenses: db.licenses,
    auditLog: (db.auditLog || []).slice(0, 120),
    checkIns: db.checkIns.slice(0, 500),
    performanceReports: (db.performanceReports || []).slice(0, 1000)
  };
}

function buildPublicCheckoutState() {
  const db = getDb();
  const activePlans = db.plans
    .filter((plan) => plan.status === "active")
    .map((plan) => {
      const robot = db.robots.find((item) => item.id === plan.robotId);
      return {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        price: plan.price,
        durationDays: plan.durationDays,
        robotId: plan.robotId,
        robotName: robot ? robot.name : "Robo"
      };
    });
  return { plans: activePlans };
}

function checkLicense(input, req) {
  const db = getDb();
  const account = String(input.account || "").trim();
  const robotName = String(input.robot || "").trim();
  const key = String(input.key || "").trim();
  const phone = String(input.phone || input.whatsapp || "").trim();
  const brokerRaw = String(input.broker || "").trim();
  const broker = brokerRaw.toLowerCase();
  const accountName = String(input.name || input.accountName || "").trim();
  const accountServer = String(input.server || input.accountServer || "").trim();
  const clientVersion = String(input.version || input.clientVersion || "").trim();
  const now = new Date();
  const base = {
    ok: false,
    authorized: false,
    reason: "MISSING_FIELDS",
    serverTime: now.toISOString(),
    expiresAt: null,
    robot: robotName,
    account,
    accountName,
    broker: brokerRaw,
    accountServer,
    clientVersion,
    key,
    phone
  };

  if (!account || !robotName || !key) return saveCheckIn(db, base, req);

  const robot = db.robots.find((item) => item.name.toLowerCase() === robotName.toLowerCase());
  if (!robot) return savePendingRequest(db, saveCheckIn(db, { ...base, reason: "ROBOT_NOT_FOUND" }, req));

  let user = findUserByAccount(db, account);
  if (!user && accountName) user = findUserByAccountHolder(db, accountName);
  if (!user && phone) user = findPaidUnlinkedUserByPhone(db, phone, robot.id);
  if (!user && !phone) {
    return savePendingRequest(db, saveCheckIn(db, {
      ...base,
      reason: "PHONE_REQUIRED",
      robotId: robot.id,
      message: "Para liberar sua licenca, abra os parametros do robo e preencha o campo TelefoneWhatsApp com seu numero de WhatsApp. Depois carregue o robo novamente."
    }, req));
  }

  if (!user && phone) {
    user = createUser({
      account,
      name: accountName || `Conta ${account}`,
      broker: brokerRaw || accountServer || "-",
      type: "Real",
      phone,
      notes: `Criado automaticamente pela liberacao de avaliacao. Telefone/WhatsApp: ${phone}.`
    });
    db.users.unshift(user);
  }

  const linkedAccount = addAccountToUser(user, { account, name: accountName, broker: brokerRaw, accountServer, updateName: true });

  if (user && phone && !String(user.phone || "").trim()) {
    user.phone = phone;
    user.updatedAt = new Date().toISOString();
  }

  if (user && brokerRaw && (!String(user.broker || "").trim() || String(user.broker || "").trim() === "-")) {
    user.broker = brokerRaw;
    user.updatedAt = new Date().toISOString();
  }

  if (user && user.status && user.status !== "active") {
    return saveCheckIn(db, {
      ...base,
      reason: "USER_INACTIVE",
      userId: user.id,
      robotId: robot.id,
      message: "Seu cadastro esta inativo. Entre em contato para liberar o acesso."
    }, req);
  }

  const storedBroker = String(linkedAccount.broker || user.broker || "").trim().toLowerCase();
  if (broker && storedBroker && storedBroker !== "-" && !storedBroker.includes(broker)) {
    return savePendingRequest(db, saveCheckIn(db, { ...base, reason: "BROKER_MISMATCH", userId: user.id }, req));
  }

  let license = db.licenses.find((item) => item.userId === user.id && item.robotId === robot.id);
  if (!license && !phone) {
    return savePendingRequest(db, saveCheckIn(db, {
      ...base,
      reason: "PHONE_REQUIRED",
      userId: user.id,
      robotId: robot.id,
      message: "Para liberar sua licenca, abra os parametros do robo e preencha o campo TelefoneWhatsApp com seu numero de WhatsApp. Depois carregue o robo novamente."
    }, req));
  }

  if (!license && phone) {
    if (hasTrialHistory(db, account, robot.id, user.id)) {
      return saveCheckIn(db, {
        ...base,
        reason: "TRIAL_ALREADY_USED",
        userId: user.id,
        robotId: robot.id,
        message: "Esta conta ja utilizou a liberacao de avaliacao. Para continuar usando, efetue a compra da licenca."
      }, req);
    }
    license = createTrialLicense({ user, robot, key, phone });
    db.licenses.unshift(license);
    registerTrialHistory(db, { account, user, robot, license, phone, req });
    resolvePendingRequestsForAccount(account);
  }

  if (license.status !== "active") {
    return saveCheckIn(db, {
      ...base,
      reason: "LICENSE_INACTIVE",
      userId: user.id,
      robotId: robot.id,
      licenseId: license.id,
      message: "Sua licenca esta inativa. Entre em contato para efetuar a compra e liberar o acesso."
    }, req);
  }
  if (new Date(license.expiresAt) <= now) {
    const trialExpired = licenseType(license) === "TRIAL";
    return saveCheckIn(db, {
      ...base,
      reason: trialExpired ? "TRIAL_EXPIRED" : "LICENSE_EXPIRED",
      expiresAt: license.expiresAt,
      userId: user.id,
      robotId: robot.id,
      licenseId: license.id,
      message: trialExpired
        ? "Seu periodo de avaliacao acabou. Para continuar usando, efetue a compra da licenca."
        : "Sua licenca expirou. Entre em contato para renovar o acesso."
    }, req);
  }

  return saveCheckIn(db, {
    ok: true,
    authorized: true,
    reason: "AUTHORIZED",
    serverTime: now.toISOString(),
    expiresAt: license.expiresAt,
    account,
    robot: robot.name,
    userId: user.id,
    robotId: robot.id,
    licenseId: license.id,
    message: licenseType(license) === "TRIAL"
      ? `Licenca de avaliacao liberada ate ${new Date(license.expiresAt).toLocaleDateString("pt-BR")}.`
      : takeRobotMessage(robot, license, account)
  }, req);
}

function reportPerformance(input, req) {
  const db = getDb();
  const account = String(input.account || "").trim();
  const robotName = String(input.robot || "").trim();
  const key = String(input.key || "").trim();
  const symbol = String(input.symbol || "").trim() || "-";
  const date = String(input.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const now = new Date();

  const user = findUserByAccount(db, account);
  if (!user) return { ok: false, error: "ACCOUNT_NOT_FOUND" };
  if (user.status && user.status !== "active") return { ok: false, error: "USER_INACTIVE" };

  const robot = db.robots.find((item) => item.name.toLowerCase() === robotName.toLowerCase());
  if (!robot) return { ok: false, error: "ROBOT_NOT_FOUND" };

  const license = db.licenses.find((item) => item.userId === user.id && item.robotId === robot.id);
  if (!license) return { ok: false, error: "LICENSE_NOT_FOUND" };
  if (license.status !== "active") return { ok: false, error: "LICENSE_INACTIVE" };
  if (new Date(license.expiresAt) <= now) return { ok: false, error: "LICENSE_EXPIRED" };
  const linkedAccount = findUserAccount(user, account);

  db.performanceReports = db.performanceReports || [];
  const existing = db.performanceReports.find((item) =>
    item.account === account &&
    item.robotId === robot.id &&
    item.symbol === symbol &&
    item.date === date
  );

  const payload = {
    account,
    userId: user.id,
    userName: linkedAccount?.name || user.name,
    broker: linkedAccount?.broker || user.broker,
    type: user.type,
    robot: robot.name,
    robotId: robot.id,
    licenseId: license.id,
    key,
    symbol,
    magic: String(input.magic || "").trim(),
    date,
    profitDay: Number(input.profitDay || input.profit || 0),
    profitWeek: Number(input.profitWeek || 0),
    profitMonth: Number(input.profitMonth || 0),
    profitTotal: Number(input.profitTotal || 0),
    tradesDay: Number(input.tradesDay || input.trades || 0),
    volumeDay: Number(input.volumeDay || input.volume || 0),
    updatedAt: now.toISOString(),
    ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || ""
  };

  if (existing) {
    Object.assign(existing, payload);
    return { ok: true, report: existing };
  }

  const report = {
    id: createId("perf"),
    createdAt: now.toISOString(),
    ...payload
  };
  db.performanceReports.unshift(report);
  db.performanceReports = db.performanceReports.slice(0, 5000);
  return { ok: true, report };
}

function saveCheckIn(db, result, req) {
  db.checkIns.unshift({
    id: createId("chk"),
    at: new Date().toISOString(),
    ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
    account: result.account,
    accountName: result.accountName || "",
    broker: result.broker || "",
    accountServer: result.accountServer || "",
    clientVersion: result.clientVersion || "",
    key: result.key || "",
    robot: result.robot,
    authorized: result.authorized,
    reason: result.reason,
    userId: result.userId || null,
    robotId: result.robotId || null,
    licenseId: result.licenseId || null
  });
  db.checkIns = db.checkIns.slice(0, 500);
  return result;
}

function savePendingRequest(db, result) {
  if (!result.account || !result.robot) return result;
  db.pendingRequests = db.pendingRequests || [];

  const existing = db.pendingRequests.find((request) =>
    !request.resolvedAt &&
    request.account === result.account &&
    request.robot === result.robot
  );

  if (existing) {
    existing.accountName = result.accountName || existing.accountName || "";
    existing.broker = result.broker || existing.broker || "";
    existing.accountServer = result.accountServer || existing.accountServer || "";
    existing.clientVersion = result.clientVersion || existing.clientVersion || "";
    existing.key = result.key || existing.key || "";
    existing.phone = result.phone || existing.phone || "";
    existing.reason = result.reason;
    existing.message = result.message || existing.message || "";
    existing.lastSeenAt = new Date().toISOString();
    existing.attempts = Number(existing.attempts || 1) + 1;
    return result;
  }

  db.pendingRequests.unshift({
    id: createId("req"),
    account: result.account,
    accountName: result.accountName || "",
    broker: result.broker || "",
    accountServer: result.accountServer || "",
    clientVersion: result.clientVersion || "",
    key: result.key || "",
    phone: result.phone || "",
    robot: result.robot,
    reason: result.reason,
    message: result.message || "",
    attempts: 1,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    resolvedAt: null
  });
  db.pendingRequests = db.pendingRequests.slice(0, 200);
  return result;
}

function createUser(body) {
  const now = new Date().toISOString();
  const account = String(body.account || "").trim();
  const broker = String(body.broker || "").trim();
  const accountName = String(body.accountName || body.name || "").trim();
  const accountServer = String(body.accountServer || "").trim();
  return {
    id: createId("usr"),
    account,
    name: String(body.name || "").trim(),
    broker,
    phone: String(body.phone || body.whatsapp || "").trim(),
    status: body.status || "active",
    type: body.type || "Real",
    notes: body.notes || "",
    accounts: account ? [createAccountEntry({ account, name: accountName, broker, accountServer, primary: true })] : [],
    createdAt: now,
    updatedAt: now
  };
}

function updateUser(id, body) {
  const db = getDb();
  const user = db.users.find((item) => item.id === id);
  if (!user) return null;

  ["account", "name", "broker", "phone", "status", "type", "notes"].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) user[field] = String(body[field] || "").trim();
  });
  if (!user.status) user.status = "active";
  if (!user.type) user.type = "Real";

  if (body.account) {
    addAccountToUser(user, {
      account: body.account,
      name: user.name,
      broker: user.broker,
      primary: true
    });
  }

  if (body.addAccount && body.addAccount.account) {
    addAccountToUser(user, body.addAccount);
  }

  if (body.removeAccount) {
    const accountToRemove = String(body.removeAccount).trim();
    user.accounts = ensureUserAccounts(user).filter((item) => item.account !== accountToRemove);
    if (String(user.account) === accountToRemove) {
      user.account = user.accounts[0]?.account || "";
    }
  }

  user.updatedAt = new Date().toISOString();
  ensureUserAccounts(user);
  return user;
}

function resolvePendingRequestsForAccount(account) {
  const db = getDb();
  db.pendingRequests = db.pendingRequests || [];
  db.pendingRequests.forEach((request) => {
    if (request.account === String(account)) request.resolvedAt = new Date().toISOString();
  });
}

function createAccountEntry({ account, name = "", broker = "", accountServer = "", primary = false }) {
  const now = new Date().toISOString();
  return {
    account: String(account || "").trim(),
    name: String(name || "").trim(),
    broker: String(broker || "").trim(),
    accountServer: String(accountServer || "").trim(),
    primary: Boolean(primary),
    addedAt: now,
    lastSeenAt: now
  };
}

function ensureUserAccounts(user) {
  user.accounts = Array.isArray(user.accounts) ? user.accounts.filter((item) => item && item.account) : [];
  if (user.account && !user.accounts.some((item) => String(item.account) === String(user.account))) {
    user.accounts.unshift(createAccountEntry({
      account: user.account,
      name: user.name,
      broker: user.broker,
      primary: true
    }));
  }
  if (!user.account && user.accounts[0]) user.account = user.accounts[0].account;
  user.accounts.forEach((item, index) => {
    item.account = String(item.account || "").trim();
    item.name = String(item.name || "").trim();
    item.broker = String(item.broker || "").trim();
    item.accountServer = String(item.accountServer || "").trim();
    item.primary = user.account ? item.account === user.account : index === 0;
  });
  return user.accounts;
}

function addAccountToUser(user, accountData) {
  const account = String(accountData.account || "").trim();
  const accounts = ensureUserAccounts(user);
  let entry = accounts.find((item) => String(item.account) === account);
  if (!entry && account) {
    entry = createAccountEntry(accountData);
    accounts.push(entry);
  }
  if (entry) {
    if (accountData.name && (!entry.name || accountData.updateName)) entry.name = String(accountData.name).trim();
    if (accountData.broker && (!entry.broker || entry.broker === "-")) entry.broker = String(accountData.broker).trim();
    if (accountData.accountServer && !entry.accountServer) entry.accountServer = String(accountData.accountServer).trim();
    entry.lastSeenAt = new Date().toISOString();
  }
  if (!user.account && account) user.account = account;
  if (!user.broker && accountData.broker) user.broker = String(accountData.broker).trim();
  user.updatedAt = new Date().toISOString();
  return entry || createAccountEntry(accountData);
}

function findUserAccount(user, account) {
  const value = String(account || "").trim();
  return ensureUserAccounts(user).find((item) => String(item.account) === value) || null;
}

function normalizeAccountHolderName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findUserByAccountHolder(db, accountName) {
  const value = normalizeAccountHolderName(accountName);
  if (!value) return null;
  return db.users.find((user) => {
    if (normalizeAccountHolderName(user.name) === value) return true;
    return ensureUserAccounts(user).some((item) => normalizeAccountHolderName(item.name) === value);
  }) || null;
}

function findUserByAccount(db, account) {
  const value = String(account || "").trim();
  if (!value) return null;
  return db.users.find((user) =>
    String(user.account) === value ||
    ensureUserAccounts(user).some((item) => String(item.account) === value)
  ) || null;
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function findUserByPhone(db, phone) {
  const value = normalizePhone(phone);
  if (!value) return null;
  return db.users.find((user) => normalizePhone(user.phone) === value) || null;
}

function findPaidUnlinkedUserByPhone(db, phone, robotId) {
  const user = findUserByPhone(db, phone);
  if (!user) return null;
  if (ensureUserAccounts(user).length) return null;
  const now = new Date();
  const license = db.licenses.find((item) =>
    item.userId === user.id &&
    item.robotId === robotId &&
    item.status === "active" &&
    licenseType(item) !== "TRIAL" &&
    new Date(item.expiresAt) > now
  );
  return license ? user : null;
}

function createRobot(body) {
  const now = new Date().toISOString();
  return {
    id: createId("bot"),
    name: String(body.name || "").trim(),
    version: body.version || "v1.00",
    status: body.status || "updated",
    message: body.message || "",
    createdAt: now,
    updatedAt: now
  };
}

function createLicense(body) {
  const db = getDb();
  const now = new Date().toISOString();
  const user = db.users.find((item) => item.id === body.userId);
  const robot = db.robots.find((item) => item.id === body.robotId);
  const key = body.key || `LIC-${user ? user.account : "CONTA"}-${robot ? robot.name.replace(/[^a-z0-9]/gi, "").toUpperCase() : crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  return {
    id: createId("lic"),
    userId: body.userId,
    robotId: body.robotId,
    key,
    status: body.status || "active",
    type: body.type || "REAL",
    price: Number(body.price || 0),
    paidAt: body.paidAt || "",
    expiresAt: body.expiresAt || addDays(365),
    createdAt: now,
    updatedAt: now
  };
}

function addAudit(action, details = {}) {
  const db = getDb();
  db.auditLog = Array.isArray(db.auditLog) ? db.auditLog : [];
  db.auditLog.unshift({
    id: createId("aud"),
    action,
    details,
    at: new Date().toISOString()
  });
  db.auditLog = db.auditLog.slice(0, 1000);
}

function createPlan(body) {
  const now = new Date().toISOString();
  return {
    id: createId("plan"),
    name: String(body.name || "").trim(),
    description: String(body.description || "").trim(),
    robotId: body.robotId,
    durationDays: Number(body.durationDays || 30),
    price: Number(body.price || 0),
    status: body.status || "active",
    createdAt: now,
    updatedAt: now
  };
}

function createPayment(body) {
  const now = new Date().toISOString();
  return {
    id: createId("pay"),
    provider: body.provider || "mercadopago",
    status: body.status || "pending",
    planId: body.planId,
    robotId: body.robotId,
    userId: body.userId || null,
    licenseId: body.licenseId || null,
    account: String(body.account || "").trim(),
    name: String(body.name || "").trim(),
    email: String(body.email || "").trim(),
    document: String(body.document || body.cpf || body.cnpj || "").replace(/\D/g, ""),
    phone: String(body.phone || body.whatsapp || "").trim(),
    broker: String(body.broker || "").trim(),
    type: body.type || "Real",
    amount: Number(body.amount || 0),
    currency: body.currency || "BRL",
    externalReference: body.externalReference || "",
    providerPreferenceId: body.providerPreferenceId || "",
    providerPaymentId: body.providerPaymentId || "",
    checkoutUrl: body.checkoutUrl || "",
    rawStatus: body.rawStatus || "",
    paidAt: body.paidAt || "",
    createdAt: now,
    updatedAt: now
  };
}

function applyApprovedPayment(payment, providerPayload = {}) {
  const db = getDb();
  const plan = db.plans.find((item) => item.id === payment.planId);
  if (!plan) throw new Error("PLAN_NOT_FOUND");
  const robot = db.robots.find((item) => item.id === plan.robotId);
  if (!robot) throw new Error("ROBOT_NOT_FOUND");

  let user = (payment.account ? findUserByAccount(db, payment.account) : null) || findUserByAccountHolder(db, payment.name) || findUserByPhone(db, payment.phone);
  if (!user) {
    user = createUser({
      account: payment.account,
      name: payment.name || (payment.account ? `Conta ${payment.account}` : "Cliente sem conta MT5"),
      broker: payment.broker || "-",
      phone: payment.phone || "",
      type: payment.type || "Real",
      notes: `Criado automaticamente pelo pagamento do plano ${plan.name}.`
    });
    db.users.unshift(user);
  } else {
    if (payment.account) {
      addAccountToUser(user, {
        account: payment.account,
        name: payment.name,
        broker: payment.broker,
        primary: !user.account
      });
    }
    if (payment.name && (!user.name || user.name.startsWith("Conta "))) user.name = payment.name;
    if (payment.phone && !String(user.phone || "").trim()) user.phone = payment.phone;
    if (payment.broker && (!user.broker || user.broker === "-")) user.broker = payment.broker;
    user.status = "active";
    user.updatedAt = new Date().toISOString();
  }

  let license = db.licenses.find((item) => item.userId === user.id && item.robotId === robot.id);
  const baseDate = license && new Date(license.expiresAt) > new Date()
    ? new Date(license.expiresAt)
    : new Date();
  baseDate.setDate(baseDate.getDate() + Number(plan.durationDays || 30));

  if (!license) {
    license = createLicense({
      userId: user.id,
      robotId: robot.id,
      key: "LIC-ROMPEDOR-FLOW",
      status: "active",
      type: "REAL",
      price: payment.amount,
      paidAt: payment.paidAt || new Date().toISOString().slice(0, 10),
      expiresAt: baseDate.toISOString()
    });
    db.licenses.unshift(license);
  } else {
    license.status = "active";
    license.type = "REAL";
    license.price = Number(payment.amount || license.price || 0);
    license.paidAt = payment.paidAt || new Date().toISOString().slice(0, 10);
    license.expiresAt = baseDate.toISOString();
    license.updatedAt = new Date().toISOString();
  }

  payment.status = "approved";
  payment.userId = user.id;
  payment.licenseId = license.id;
  payment.robotId = robot.id;
  payment.providerPaymentId = String(providerPayload.providerPaymentId || payment.providerPaymentId || "");
  payment.rawStatus = providerPayload.rawStatus || payment.rawStatus || "approved";
  payment.paidAt = payment.paidAt || new Date().toISOString();
  payment.updatedAt = new Date().toISOString();
  resolvePendingRequestsForAccount(payment.account);

  return { user, license, payment };
}

function createTrialLicense({ user, robot, key, phone }) {
  const now = new Date().toISOString();
  return {
    id: createId("lic"),
    userId: user.id,
    robotId: robot.id,
    key,
    status: "active",
    type: "TRIAL",
    price: 0,
    paidAt: "",
    expiresAt: addDays(7),
    phone,
    createdAt: now,
    updatedAt: now
  };
}

function licenseType(license) {
  const type = String(license.type || "").toUpperCase();
  if (type !== "TRIAL") return type || "REAL";
  if (Number(license.price || 0) <= 0) return "TRIAL";

  const createdAt = new Date(license.createdAt || 0).getTime();
  const expiresAt = new Date(license.expiresAt || 0).getTime();
  const days = createdAt && expiresAt ? (expiresAt - createdAt) / 86400000 : 0;
  return days > 30 ? "REAL" : "TRIAL";
}

function takeRobotMessage(robot, license, account) {
  const message = String(robot.message || "").trim();
  const messageId = String(robot.messageId || "").trim();
  if (!message || !messageId) return "";

  const target = String(account || license.id || "").trim();
  license.deliveredMessages = Array.isArray(license.deliveredMessages) ? license.deliveredMessages : [];
  const alreadyDelivered = license.deliveredMessages.some((item) =>
    item.messageId === messageId && String(item.account || "") === target
  );
  if (alreadyDelivered) return "";

  license.deliveredMessages.unshift({
    messageId,
    account: target,
    deliveredAt: new Date().toISOString()
  });
  license.deliveredMessages = license.deliveredMessages.slice(0, 50);
  license.updatedAt = new Date().toISOString();
  return message;
}

function hasTrialHistory(db, account, robotId, userId = "") {
  db.trialHistory = Array.isArray(db.trialHistory) ? db.trialHistory : [];
  return db.trialHistory.some((item) =>
    item.robotId === robotId &&
    (item.account === String(account) || (userId && item.userId === userId))
  );
}

function registerTrialHistory(db, { account, user, robot, license, phone, req }) {
  db.trialHistory = Array.isArray(db.trialHistory) ? db.trialHistory : [];
  if (hasTrialHistory(db, account, robot.id, user.id)) return;
  db.trialHistory.unshift({
    id: createId("trial"),
    account: String(account),
    userId: user.id,
    robotId: robot.id,
    licenseId: license.id,
    phone,
    startedAt: license.createdAt,
    expiresAt: license.expiresAt,
    ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || ""
  });
  db.trialHistory = db.trialHistory.slice(0, 5000);
}

function createAdmin(body) {
  const db = getDb();
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) throw new Error("ADMIN_FIELDS_REQUIRED");
  if (username.includes(":")) throw new Error("ADMIN_USERNAME_INVALID");
  if ((db.admins || []).some((admin) => admin.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("ADMIN_ALREADY_EXISTS");
  }

  const now = new Date().toISOString();
  const passwordSalt = crypto.randomBytes(16).toString("hex");
  return {
    id: createId("adm"),
    username,
    name: String(body.name || username).trim(),
    role: body.role || "admin",
    status: body.status || "active",
    passwordSalt,
    passwordHash: hashPassword(password, passwordSalt),
    createdAt: now,
    updatedAt: now
  };
}

function updateAdmin(id, body) {
  const db = getDb();
  const admin = db.admins.find((item) => item.id === id);
  if (!admin) return null;
  if (Object.prototype.hasOwnProperty.call(body, "name")) admin.name = String(body.name || admin.username).trim();
  if (Object.prototype.hasOwnProperty.call(body, "role")) admin.role = body.role || "admin";
  if (Object.prototype.hasOwnProperty.call(body, "status")) admin.status = body.status || "active";
  if (body.password) {
    admin.passwordSalt = crypto.randomBytes(16).toString("hex");
    admin.passwordHash = hashPassword(String(body.password), admin.passwordSalt);
  }
  admin.updatedAt = new Date().toISOString();
  return admin;
}

function updateById(collection, id, fields) {
  const db = getDb();
  const item = db[collection].find((entry) => entry.id === id);
  if (!item) return null;
  if (collection === "robots" && Object.prototype.hasOwnProperty.call(fields, "message")) {
    const nextMessage = String(fields.message || "").trim();
    fields.message = nextMessage;
    fields.messageId = nextMessage ? createId("msg") : "";
    fields.messageCreatedAt = nextMessage ? new Date().toISOString() : "";
  }
  Object.assign(item, fields, { updatedAt: new Date().toISOString() });
  return item;
}

function removeById(collection, id) {
  const db = getDb();
  db[collection] = db[collection].filter((entry) => entry.id !== id);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    if (typeof req.body === "string") {
      if (!req.body.trim()) return resolve({});
      try {
        return resolve(JSON.parse(req.body));
      } catch (error) {
        return reject(error);
      }
    }
    if (typeof req.on !== "function") return resolve({});

    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(text);
}

function methodNotAllowed(res) {
  sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
}

function pick(source, fields) {
  return fields.reduce((result, field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) result[field] = source[field];
    return result;
  }, {});
}

function sign(payload) {
  return crypto.createHmac("sha256", ADMIN_PASSWORD).update(payload).digest("hex");
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
}

function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const candidate = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(hash, "hex"));
}

function publicAdmin(admin) {
  return {
    id: admin.id,
    username: admin.username,
    name: admin.name,
    role: admin.role,
    status: admin.status,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt
  };
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function createInitialDb() {
  const userOne = {
    id: "usr_seed_loreni",
    account: "19485815",
    name: "LORENI LUCIA BENINI TOSIN",
    broker: "XP Investimentos CCTVM SA",
    phone: "",
    status: "active",
    type: "Real",
    notes: "",
    createdAt: "2026-06-16T14:31:00.000Z",
    updatedAt: "2026-06-16T14:31:00.000Z"
  };
  const userTwo = {
    id: "usr_seed_evelize",
    account: "13115936",
    name: "EVELIZE MASIERO",
    broker: "Banco",
    phone: "",
    status: "active",
    type: "Real",
    notes: "",
    createdAt: "2026-06-17T14:31:00.000Z",
    updatedAt: "2026-06-17T14:31:00.000Z"
  };
  const robotOne = {
    id: "bot_seed_flowwin",
    name: "Rompedor Flow",
    version: "v1.00",
    status: "active",
    message: "Robo liberado.",
    createdAt: "2026-06-16T14:31:00.000Z",
    updatedAt: "2026-06-16T14:31:00.000Z"
  };
  const robotTwo = {
    id: "bot_seed_grid",
    name: "Grid Flow",
    version: "v5.00",
    status: "updated",
    message: "Versao atualizada disponivel.",
    createdAt: "2026-06-16T14:31:00.000Z",
    updatedAt: "2026-06-16T14:31:00.000Z"
  };

  return {
    admins: [createInitialAdmin()],
    users: [userOne, userTwo],
    robots: [robotOne, robotTwo],
    plans: defaultPlans(robotOne.id),
    payments: [],
    licenses: [
      {
        id: "lic_seed_flowwin",
        userId: userOne.id,
        robotId: robotOne.id,
        key: "LIC-ROMPEDOR-FLOW",
        status: "active",
        type: "REAL",
        price: 497,
        paidAt: "2026-06-16",
        expiresAt: "2027-06-16T14:31:00.000Z",
        createdAt: "2026-06-16T14:31:00.000Z",
        updatedAt: "2026-06-16T14:31:00.000Z"
      }
    ],
    checkIns: [],
    pendingRequests: [],
    performanceReports: [],
    trialHistory: []
  };
}

function ensureDbShape(db) {
  db.admins = Array.isArray(db.admins) ? db.admins : [];
  if (!db.admins.length) db.admins.push(createInitialAdmin());
  db.users = Array.isArray(db.users) ? db.users : [];
  db.users.forEach((user) => {
    if (!Object.prototype.hasOwnProperty.call(user, "phone")) user.phone = "";
    if (!Object.prototype.hasOwnProperty.call(user, "status")) user.status = "active";
    ensureUserAccounts(user);
  });
  db.robots = Array.isArray(db.robots) ? db.robots : [];
  db.plans = Array.isArray(db.plans) ? db.plans : [];
  if (!db.plans.length) {
    const flowRobot = db.robots.find((robot) => String(robot.name || "").toLowerCase() === "rompedor flow") || db.robots[0];
    if (flowRobot) db.plans = defaultPlans(flowRobot.id);
  }
  db.payments = Array.isArray(db.payments) ? db.payments : [];
  db.licenses = Array.isArray(db.licenses) ? db.licenses : [];
  db.checkIns = Array.isArray(db.checkIns) ? db.checkIns : [];
  db.pendingRequests = Array.isArray(db.pendingRequests) ? db.pendingRequests : [];
  db.performanceReports = Array.isArray(db.performanceReports) ? db.performanceReports : [];
  db.trialHistory = Array.isArray(db.trialHistory) ? db.trialHistory : [];
  db.auditLog = Array.isArray(db.auditLog) ? db.auditLog : [];
}

function defaultPlans(robotId) {
  return [
    {
      id: "plan_seed_30d",
      name: "Rompedor Flow - 30 dias",
      description: "Licenca de 30 dias para o Rompedor Flow.",
      robotId,
      durationDays: 30,
      price: 197,
      status: "active",
      createdAt: "2026-06-16T14:31:00.000Z",
      updatedAt: "2026-06-16T14:31:00.000Z"
    },
    {
      id: "plan_seed_1y",
      name: "Rompedor Flow - 1 ano",
      description: "Licenca anual para o Rompedor Flow.",
      robotId,
      durationDays: 365,
      price: 497,
      status: "active",
      createdAt: "2026-06-16T14:31:00.000Z",
      updatedAt: "2026-06-16T14:31:00.000Z"
    }
  ];
}

function createInitialAdmin() {
  const passwordSalt = crypto.randomBytes(16).toString("hex");
  return {
    id: "adm_seed_admin",
    username: ADMIN_USER,
    name: ADMIN_USER,
    role: "admin",
    status: "active",
    passwordSalt,
    passwordHash: hashPassword(ADMIN_PASSWORD, passwordSalt),
    createdAt: "2026-06-16T14:31:00.000Z",
    updatedAt: "2026-06-16T14:31:00.000Z"
  };
}

async function kvCommand(command) {
  const response = await fetch(getKvUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getKvToken()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });

  if (!response.ok) {
    throw new Error(`KV request failed: ${response.status}`);
  }

  return response.json();
}

async function supabaseLoadDb() {
  const url = `${getSupabaseUrl()}/rest/v1/license_state?key=eq.${encodeURIComponent(DB_KEY)}&select=value`;
  const response = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders()
  });

  if (!response.ok) {
    throw new Error(`Supabase load failed: ${response.status}`);
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || !rows[0] || !rows[0].value) return null;
  return rows[0].value;
}

async function supabaseSaveDb(db) {
  const url = `${getSupabaseUrl()}/rest/v1/license_state`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify({
      key: DB_KEY,
      value: db,
      updated_at: new Date().toISOString()
    })
  });

  if (!response.ok) {
    throw new Error(`Supabase save failed: ${response.status}`);
  }
}

function supabaseHeaders() {
  const key = getSupabaseServiceKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
}

function hasSupabaseStore() {
  return Boolean(getSupabaseUrl() && getSupabaseServiceKey());
}

function hasKvStore() {
  return Boolean(getKvUrl() && getKvToken());
}

function getSupabaseUrl() {
  return (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
}

function getSupabaseServiceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
}

function getKvUrl() {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
}

function getKvToken() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
}

module.exports = {
  getDb,
  loadDb,
  saveDb,
  storageStatus,
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
  resolvePendingRequestsForAccount,
  createRobot,
  createPlan,
  createPayment,
  applyApprovedPayment,
  createLicense,
  addAudit,
  updateById,
  removeById,
  readBody,
  sendJson,
  sendText,
  methodNotAllowed,
  pick
};
