const state = {
  token: localStorage.getItem("licenseToken") || "",
  view: "dashboard",
  data: null,
  editingUserId: null
};

const navItems = [
  ["dashboard", "Dashboard"],
  ["monitor", "Monitor"],
  ["users", "Usuarios"],
  ["robots", "Robos"],
  ["finance", "Financeiro"],
  ["checks", "Check-ins"]
];

const app = document.querySelector("#app");

render();

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Erro na requisicao");
  return payload;
}

async function loadState() {
  const payload = await api("/api/state");
  state.data = payload.data;
}

function render() {
  if (!state.token) {
    renderLogin();
    return;
  }

  app.innerHTML = `
    <header class="topbar">
      <div class="brand">Licencas EA</div>
      <nav class="nav">
        ${navItems.map(([id, label]) => `<button class="${state.view === id ? "active" : ""}" onclick="go('${id}')">${label}</button>`).join("")}
      </nav>
      <button class="btn btn-ghost" onclick="logout()">Sair</button>
    </header>
    <section class="shell" id="content"></section>
    <section class="modal" id="modal"></section>
    <div class="toast" id="toast"></div>
  `;

  loadState()
    .then(renderView)
    .catch((error) => {
      if (error.message === "UNAUTHORIZED") logout();
      else toast(error.message);
    });
}

function renderLogin() {
  app.innerHTML = `
    <section class="login">
      <form class="login-box" onsubmit="login(event)">
        <h1>Sistema de Licencas</h1>
        <p class="muted">Acesse o painel para gerenciar usuarios, robos e liberacoes do EA.</p>
        <label>Usuario <input name="username" value="admin" autocomplete="username"></label>
        <br>
        <label>Senha <input name="password" value="admin123" type="password" autocomplete="current-password"></label>
        <br>
        <button class="btn btn-red" type="submit">Entrar</button>
      </form>
    </section>
  `;
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = await api("/api/session/login", {
    method: "POST",
    body: JSON.stringify(Object.fromEntries(form.entries()))
  });
  state.token = payload.token;
  localStorage.setItem("licenseToken", state.token);
  render();
}

function logout() {
  state.token = "";
  localStorage.removeItem("licenseToken");
  render();
}

function go(view) {
  state.view = view;
  renderView();
}

function renderView() {
  const content = document.querySelector("#content");
  if (!content || !state.data) return;
  const views = {
    dashboard: renderDashboard,
    monitor: renderMonitor,
    users: renderUsers,
    robots: renderRobots,
    finance: renderFinance,
    checks: renderChecks
  };
  content.innerHTML = views[state.view]();
}

function renderDashboard() {
  const s = state.data.summary;
  return `
    <section class="panel hero-panel">
      <h1>Painel operacional <span class="badge green">LIVE</span></h1>
      <p class="muted">Controle de contas, licencas e verificacoes dos Expert Advisors.</p>
      <div class="filters">
        <label>Tipo de conta <select><option>Real</option><option>Demo</option></select></label>
        <label>Periodo <select><option>30 dias</option><option>Hoje</option><option>Mes atual</option></select></label>
      </div>
    </section>
    <section class="metrics">
      ${metric("Contas ativas", s.activeAccounts)}
      ${metric("Licencas ativas", s.activeLicenses)}
      ${metric("Robos", s.robots)}
      ${metric("Checks hoje", s.checksToday)}
      ${metric("Pendentes", s.pendingRequests || 0)}
    </section>
    <section class="panel">
      <h2>Resumo financeiro</h2>
      <div class="metric"><span>Faturado no mes</span><strong>${money(s.monthRevenue)}</strong></div>
    </section>
  `;
}

function renderMonitor() {
  const checks = state.data.checkIns.slice(0, 12);
  return `
    <section class="panel hero-panel">
      <h1>Monitor <span class="badge green">LIVE</span></h1>
      <p class="muted">Ultimas validacoes feitas pelos EAs.</p>
    </section>
    <section class="cards-list">
      ${checks.map(checkRow).join("") || empty("Nenhum check-in registrado ainda.")}
    </section>
  `;
}

function renderUsers() {
  const users = state.data.users;
  const pending = state.data.pendingRequests || [];
  return `
    ${pending.length ? `
      <section class="panel">
        <h1>Solicitacoes pendentes</h1>
        <p class="muted">Contas que colocaram o robo no grafico e ainda nao possuem licenca liberada.</p>
        <div class="cards-list">
          ${pending.map((request) => `
            <article class="robot-row">
              <div>
                <strong>${escapeHtml(request.accountName || `Conta ${request.account}`)}</strong>
                <span class="badge">${escapeHtml(request.account)}</span>
                <span class="badge">${escapeHtml(request.robot)}</span>
                <span class="badge red">${escapeHtml(request.reason)}</span>
                <div class="muted">${escapeHtml(request.broker || "-")} ${request.accountServer ? `- ${escapeHtml(request.accountServer)}` : ""}</div>
                <div class="muted">Chave enviada: ${escapeHtml(request.key || "-")} - Tentativas: ${request.attempts || 1}</div>
              </div>
              <button class="btn btn-red" onclick="approvePending('${request.id}')">Cadastrar e liberar 1 ano</button>
            </article>
          `).join("")}
        </div>
      </section>
    ` : ""}
    <section class="panel">
      <h1>Usuarios e licencas</h1>
      <form class="actions" onsubmit="createUser(event)">
        <label>Conta <input name="account" required></label>
        <label>Usuario <input name="name" required></label>
        <label>Corretora <input name="broker" required></label>
        <label>Tipo <select name="type"><option>Real</option><option>Demo</option></select></label>
        <button class="btn btn-red" type="submit">Adicionar</button>
      </form>
    </section>
    <section class="table-wrap">
      <table>
        <thead><tr><th>Conta</th><th>Usuario</th><th>Tipo</th><th>Corretora</th><th>Licencas</th><th>Editar</th></tr></thead>
        <tbody>
          ${users.map((user) => {
            const licenses = state.data.licenses.filter((license) => license.userId === user.id);
            const expired = licenses.some((license) => new Date(license.expiresAt) < new Date());
            return `<tr class="${expired ? "warn" : ""}">
              <td><strong>${escapeHtml(user.account)}</strong></td>
              <td>${escapeHtml(user.name)}</td>
              <td><span class="badge green">${escapeHtml(user.type)}</span></td>
              <td>${escapeHtml(user.broker)}</td>
              <td>${licenses.length}</td>
              <td><button class="btn btn-ghost" onclick="openUser('${user.id}')">Editar</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderRobots() {
  return `
    <section class="panel">
      <h1>Robos</h1>
      <form class="actions" onsubmit="createRobot(event)">
        <label>Nome do robo <input name="name" placeholder="Rompedor Flow" required></label>
        <label>Versao <input name="version" value="v1.00"></label>
        <label>Status <select name="status"><option value="updated">Atualizado</option><option value="active">Ativo</option><option value="paused">Pausado</option></select></label>
        <button class="btn btn-red" type="submit">Adicionar</button>
      </form>
    </section>
    <section class="cards-list">
      ${state.data.robots.map((robot) => `
        <article class="robot-row">
          <div>
            <strong>${escapeHtml(robot.name)}</strong>
            <span class="badge red">${escapeHtml(robot.version)}</span>
            <span class="badge green">${escapeHtml(robot.status)}</span>
            <span class="badge">${robot.clients} clientes</span>
          </div>
          <button class="btn btn-blue" onclick="copyRobotMessage('${robot.id}')">Mensagem</button>
        </article>
      `).join("")}
    </section>
  `;
}

function renderFinance() {
  const paid = state.data.licenses.filter((license) => Number(license.price) > 0);
  const total = paid.reduce((sum, item) => sum + Number(item.price || 0), 0);
  return `
    <section class="panel">
      <h1>Financeiro</h1>
      <p class="muted">Total faturado com licencas registradas.</p>
      <div class="metric"><span>Total faturado</span><strong>${money(total)}</strong></div>
    </section>
    <section class="table-wrap">
      <table>
        <thead><tr><th>Projeto</th><th>Usuario</th><th>Pagamento</th><th>Total</th></tr></thead>
        <tbody>${paid.map((license) => {
          const user = findUser(license.userId);
          const robot = findRobot(license.robotId);
          return `<tr><td>${escapeHtml(robot.name)}</td><td>${escapeHtml(user.name)}</td><td>${formatDate(license.paidAt)}</td><td>${money(license.price)}</td></tr>`;
        }).join("")}</tbody>
      </table>
    </section>
  `;
}

function renderChecks() {
  return `
    <section class="panel">
      <h1>Check-ins da API</h1>
      <p class="muted">Historico das ultimas verificacoes feitas pelos robos.</p>
    </section>
    <section class="cards-list">
      ${state.data.checkIns.map(checkRow).join("") || empty("Nenhuma verificacao ainda.")}
    </section>
  `;
}

function openUser(userId) {
  const user = findUser(userId);
  const licenses = state.data.licenses.filter((license) => license.userId === userId);
  const modal = document.querySelector("#modal");
  modal.classList.add("open");
  modal.innerHTML = `
    <article class="modal-card">
      <div class="actions" style="justify-content: space-between">
        <h2>${escapeHtml(user.name)}</h2>
        <button class="btn btn-ghost" onclick="closeModal()">Fechar</button>
      </div>
      <form onsubmit="saveUser(event, '${user.id}')">
        <div class="split">
          <label>Conta <input name="account" value="${escapeAttr(user.account)}"></label>
          <label>Usuario <input name="name" value="${escapeAttr(user.name)}"></label>
          <label>Corretora <input name="broker" value="${escapeAttr(user.broker)}"></label>
          <label>Tipo <select name="type"><option ${user.type === "Real" ? "selected" : ""}>Real</option><option ${user.type === "Demo" ? "selected" : ""}>Demo</option></select></label>
        </div>
        <br>
        <label>Observacao <textarea name="notes">${escapeHtml(user.notes || "")}</textarea></label>
        <br>
        <button class="btn btn-red" type="submit">Salvar usuario</button>
      </form>
      <hr>
      <h3>Expert Advisors</h3>
      <form class="actions" onsubmit="createLicense(event, '${user.id}')">
        <label>Robo <select name="robotId">${state.data.robots.map((robot) => `<option value="${robot.id}">${escapeHtml(robot.name)}</option>`).join("")}</select></label>
        <label>Status <select name="status"><option value="active">Ativado</option><option value="paused">Pausado</option><option value="blocked">Bloqueado</option></select></label>
        <label>Tipo <select name="type"><option>REAL</option><option>DEMO</option></select></label>
        <label>Valor <input name="price" type="number" step="0.01" value="0"></label>
        <label>Pagamento <input name="paidAt" type="date"></label>
        <label>Expira em <input name="expiresAt" type="datetime-local" required value="${defaultDateInput()}"></label>
        <button class="btn btn-red" type="submit">Adicionar licenca</button>
      </form>
      <div class="cards-list" style="margin-top: 16px">
        ${licenses.map(licenseCard).join("") || empty("Nenhum EA vinculado.")}
      </div>
    </article>
  `;
}

function licenseCard(license) {
  const robot = findRobot(license.robotId);
  const expired = new Date(license.expiresAt) < new Date();
  return `
    <article class="robot-row">
      <div>
        <strong>${escapeHtml(robot.name)}</strong>
        <span class="badge ${license.status === "active" && !expired ? "green" : "red"}">${expired ? "expirado" : license.status}</span>
        <span class="badge">${formatDate(license.expiresAt)}</span>
        <div class="muted">Chave: ${escapeHtml(license.key)}</div>
      </div>
      <div class="actions">
        <button class="btn btn-ghost" onclick="copyText('${escapeAttr(license.key)}')">Copiar chave</button>
        <button class="btn btn-ghost" onclick="extendLicense('${license.id}', 365)">+1 ano</button>
        <button class="btn btn-red" onclick="deleteLicense('${license.id}')">Excluir</button>
      </div>
    </article>
  `;
}

async function createUser(event) {
  event.preventDefault();
  await api("/api/users", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries())) });
  toast("Usuario adicionado");
  await reload();
}

async function approvePending(requestId) {
  const request = (state.data.pendingRequests || []).find((item) => item.id === requestId);
  if (!request) return toast("Solicitacao nao encontrada");

  const userPayload = {
    account: request.account,
    name: request.accountName || `Conta ${request.account}`,
    broker: request.broker || request.accountServer || "-",
    type: "Real",
    notes: `Criado automaticamente pela tentativa de uso do ${request.robot}.`
  };
  const userResponse = await api("/api/users", { method: "POST", body: JSON.stringify(userPayload) });
  const robot = state.data.robots.find((item) => item.name.toLowerCase() === String(request.robot || "").toLowerCase());

  if (robot) {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    await api("/api/licenses", {
      method: "POST",
      body: JSON.stringify({
        userId: userResponse.user.id,
        robotId: robot.id,
        key: request.key || `LIC-${request.account}-${robot.name.replace(/[^a-z0-9]/gi, "").toUpperCase()}`,
        status: "active",
        type: "REAL",
        price: 0,
        paidAt: new Date().toISOString().slice(0, 10),
        expiresAt: expiresAt.toISOString()
      })
    });
    toast("Conta cadastrada e licenca liberada");
  } else {
    toast("Conta cadastrada. Cadastre o robo para liberar a licenca.");
  }

  await reload();
  openUser(userResponse.user.id);
}

async function saveUser(event, userId) {
  event.preventDefault();
  await api(`/api/users/${userId}`, { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries())) });
  toast("Usuario salvo");
  closeModal();
  await reload();
}

async function createRobot(event) {
  event.preventDefault();
  await api("/api/robots", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries())) });
  toast("Robo adicionado");
  await reload();
}

async function createLicense(event, userId) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.target).entries());
  body.userId = userId;
  body.expiresAt = new Date(body.expiresAt).toISOString();
  await api("/api/licenses", { method: "POST", body: JSON.stringify(body) });
  toast("Licenca adicionada");
  closeModal();
  await reload();
  openUser(userId);
}

async function extendLicense(licenseId, days) {
  const license = state.data.licenses.find((item) => item.id === licenseId);
  const date = new Date(Math.max(Date.now(), new Date(license.expiresAt).getTime()));
  date.setDate(date.getDate() + days);
  await api(`/api/licenses/${licenseId}`, { method: "PUT", body: JSON.stringify({ expiresAt: date.toISOString(), status: "active" }) });
  toast("Licenca prorrogada");
  closeModal();
  await reload();
  openUser(license.userId);
}

async function deleteLicense(licenseId) {
  const license = state.data.licenses.find((item) => item.id === licenseId);
  await api(`/api/licenses/${licenseId}`, { method: "DELETE" });
  toast("Licenca excluida");
  closeModal();
  await reload();
  openUser(license.userId);
}

async function reload() {
  await loadState();
  renderView();
}

function closeModal() {
  document.querySelector("#modal").classList.remove("open");
}

function metric(label, value) {
  return `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`;
}

function checkRow(check) {
  return `
    <article class="check-row">
      <div>
        <strong>${escapeHtml(check.account || "-")} / ${escapeHtml(check.robot || "-")}</strong>
        <div class="muted">${formatDate(check.at)} - ${escapeHtml(check.ip || "")}</div>
      </div>
      <span class="badge ${check.authorized ? "green" : "red"}">${escapeHtml(check.reason)}</span>
    </article>
  `;
}

function findUser(id) {
  return state.data.users.find((item) => item.id === id) || { name: "-", account: "-", broker: "-" };
}

function findRobot(id) {
  return state.data.robots.find((item) => item.id === id) || { name: "-", version: "-" };
}

function copyRobotMessage(robotId) {
  const robot = findRobot(robotId);
  copyText(robot.message || `Robo ${robot.name} disponivel.`);
}

function copyText(text) {
  navigator.clipboard.writeText(text);
  toast("Copiado");
}

function toast(message) {
  const node = document.querySelector("#toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 2400);
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR");
}

function defaultDateInput() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function empty(text) {
  return `<div class="panel muted">${text}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
