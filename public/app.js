const state = {
  token: localStorage.getItem("licenseToken") || "",
  view: "dashboard",
  data: null,
  editingUserId: null
};

const navItems = [
  ["dashboard", "Dashboard"],
  ["monitor", "Monitor"],
  ["ranking", "Ranking"],
  ["users", "Usuarios"],
  ["robots", "Robos"],
  ["performance", "Performance"],
  ["reports", "Relatorio"],
  ["finance", "Financeiro"],
  ["admins", "Admins"],
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
        ${navItems.map(([id, label]) => `<button data-view="${id}" class="${state.view === id ? "active" : ""}" onclick="go('${id}')">${label}</button>`).join("")}
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

async function go(view) {
  state.view = view;
  updateNav();
  try {
    await loadState();
    renderView();
  } catch (error) {
    toast(error.message);
  }
}

function renderView() {
  const content = document.querySelector("#content");
  if (!content || !state.data) return;
  updateNav();
  const views = {
    dashboard: renderDashboard,
    monitor: renderMonitor,
    ranking: renderRanking,
    users: renderUsers,
    robots: renderRobots,
    performance: renderPerformance,
    reports: renderReports,
    finance: renderFinance,
    admins: renderAdmins,
    checks: renderChecks
  };
  content.innerHTML = views[state.view]();
}

function updateNav() {
  document.querySelectorAll(".nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
}

function renderDashboard() {
  const s = state.data.summary;
  const perf = performanceSummary();
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
    <section class="panel">
      <h2>Resultados do dia</h2>
      <div class="metrics compact">
        ${metric("Operadores", perf.accounts)}
        ${metric("Operacoes", perf.trades)}
        ${metric("Volume", numberBR(perf.volume))}
        ${metric("Lucro", money(perf.profit))}
      </div>
      ${profitChart(perf.dailySeries, "Nenhum resultado enviado pelos robos ainda.")}
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

function renderRanking() {
  const rows = rankingRows("month");
  const top = rows.slice(0, 3);
  return `
    <section class="panel hero-panel">
      <h1>Ranking do mes</h1>
      <p class="muted">Contas ordenadas pelo lucro enviado pelos robos.</p>
    </section>
    <section class="podium">
      ${top.map((row, index) => podiumCard(row, index + 1)).join("") || empty("Nenhum resultado para ranquear ainda.")}
    </section>
    <section class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Operador</th><th>Conta</th><th>Corretora</th><th>Operacoes</th><th>Volume</th><th>Lucro</th></tr></thead>
        <tbody>${rows.map((row, index) => `
          <tr>
            <td><span class="badge">${index + 1}</span></td>
            <td>${escapeHtml(row.userName)}</td>
            <td>${escapeHtml(row.account)}</td>
            <td>${escapeHtml(row.broker)}</td>
            <td>${row.trades}</td>
            <td>${numberBR(row.volume)}</td>
            <td class="${row.profit >= 0 ? "positive" : "negative"}">${money(row.profit)}</td>
          </tr>
        `).join("") || `<tr><td colspan="7">Nenhum resultado recebido.</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

function renderPerformance() {
  const perf = performanceSummary();
  const bySymbol = groupPerformanceBySymbol();
  return `
    <section class="panel hero-panel">
      <h1>Performance</h1>
      <p class="muted">Historico e metricas consolidadas por conta e ativo.</p>
      <div class="filters">
        <label>Periodo <select><option>Hoje</option><option>Semana</option><option>Mes</option></select></label>
        <label>Tipo de conta <select><option>Todos</option><option>Real</option><option>Demo</option></select></label>
        <label>Ativo <select><option>Todos</option>${bySymbol.map((item) => `<option>${escapeHtml(item.symbol)}</option>`).join("")}</select></label>
      </div>
    </section>
    <section class="metrics">
      ${metric("Contas", perf.accounts)}
      ${metric("Operacoes", perf.trades)}
      ${metric("Volume", numberBR(perf.volume))}
      ${metric("Lucro", money(perf.profit))}
    </section>
    <section class="panel">
      <h2>Grafico de resultados do dia</h2>
      ${profitChart(perf.dailySeries, "O grafico aparece quando o EA enviar o primeiro resultado.")}
    </section>
    <section class="panel">
      <h2>Resultados por ativo</h2>
      <div class="bar-list">${bySymbol.map(symbolBar).join("") || `<div class="muted">Nenhum ativo recebido ainda.</div>`}</div>
    </section>
  `;
}

function renderReports() {
  const rows = rankingRows("day");
  const totals = performanceSummary();
  return `
    <section class="panel hero-panel">
      <h1>Relatorio de Pontos</h1>
      <p class="muted">Resumo operacional por conta, projeto, corretora e ativo.</p>
    </section>
    <section class="metrics">
      ${metric("Operadores", totals.accounts)}
      ${metric("Operacoes", totals.trades)}
      ${metric("Volume", numberBR(totals.volume))}
      ${metric("Lucro", money(totals.profit))}
    </section>
    <section class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Cliente</th><th>Conta</th><th>Projeto</th><th>Corretora</th><th>Ops</th><th>Volume</th><th>Lucro</th><th>Ativos</th></tr></thead>
        <tbody>${rows.map((row, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(row.userName)}</td>
            <td>${escapeHtml(row.account)}</td>
            <td>${escapeHtml(row.robot)}</td>
            <td>${escapeHtml(row.broker)}</td>
            <td>${row.trades}</td>
            <td>${numberBR(row.volume)}</td>
            <td class="${row.profit >= 0 ? "positive" : "negative"}">${money(row.profit)}</td>
            <td>${escapeHtml(row.symbols.join(", ") || "-")}</td>
          </tr>
        `).join("") || `<tr><td colspan="9">Nenhum relatorio recebido.</td></tr>`}</tbody>
      </table>
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
            <div class="muted">${escapeHtml(robot.message || "Sem mensagem ativa")}</div>
          </div>
          <button class="btn btn-blue" onclick="openRobotMessage('${robot.id}')">Mensagem</button>
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

function renderAdmins() {
  const admins = state.data.admins || [];
  return `
    <section class="panel">
      <h1>Administradores</h1>
      <p class="muted">Acessos ao painel do sistema de licencas.</p>
      <form class="actions" onsubmit="createAdmin(event)">
        <label>Nome <input name="name" placeholder="Andrei" required></label>
        <label>Usuario <input name="username" placeholder="andrei" required autocomplete="off"></label>
        <label>Senha <input name="password" type="password" required autocomplete="new-password"></label>
        <label>Status <select name="status"><option value="active">Ativo</option><option value="blocked">Bloqueado</option></select></label>
        <button class="btn btn-red" type="submit">Adicionar</button>
      </form>
    </section>
    <section class="table-wrap">
      <table>
        <thead><tr><th>Nome</th><th>Usuario</th><th>Perfil</th><th>Status</th><th>Atualizado</th><th>Editar</th></tr></thead>
        <tbody>${admins.map((admin) => `
          <tr>
            <td>${escapeHtml(admin.name)}</td>
            <td><strong>${escapeHtml(admin.username)}</strong></td>
            <td>${escapeHtml(admin.role || "admin")}</td>
            <td><span class="badge ${admin.status === "active" ? "green" : "red"}">${admin.status === "active" ? "Ativo" : "Bloqueado"}</span></td>
            <td>${formatDate(admin.updatedAt)}</td>
            <td><button class="btn btn-ghost" onclick="openAdmin('${admin.id}')">Editar</button></td>
          </tr>
        `).join("") || `<tr><td colspan="6">Nenhum administrador cadastrado.</td></tr>`}</tbody>
      </table>
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
        <div class="actions">
          <button class="btn btn-blue" onclick="openUserPerformance('${user.id}')">Desempenho</button>
          <button class="btn btn-ghost" onclick="closeModal()">Fechar</button>
        </div>
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

function openAdmin(adminId) {
  const admin = (state.data.admins || []).find((item) => item.id === adminId);
  if (!admin) return toast("Administrador nao encontrado");
  const modal = document.querySelector("#modal");
  modal.classList.add("open");
  modal.innerHTML = `
    <article class="modal-card">
      <div class="actions" style="justify-content: space-between">
        <h2>${escapeHtml(admin.name)}</h2>
        <button class="btn btn-ghost" onclick="closeModal()">Fechar</button>
      </div>
      <form onsubmit="saveAdmin(event, '${admin.id}')">
        <div class="split">
          <label>Nome <input name="name" value="${escapeAttr(admin.name)}" required></label>
          <label>Usuario <input value="${escapeAttr(admin.username)}" disabled></label>
          <label>Status <select name="status"><option value="active" ${admin.status === "active" ? "selected" : ""}>Ativo</option><option value="blocked" ${admin.status === "blocked" ? "selected" : ""}>Bloqueado</option></select></label>
          <label>Nova senha <input name="password" type="password" placeholder="Deixe em branco para manter" autocomplete="new-password"></label>
        </div>
        <br>
        <div class="actions">
          <button class="btn btn-red" type="submit">Salvar</button>
          <button class="btn btn-ghost" type="button" onclick="deleteAdmin('${admin.id}')">Excluir</button>
        </div>
      </form>
    </article>
  `;
}

function openUserPerformance(userId) {
  const user = findUser(userId);
  const reports = performanceReports().filter((item) => item.userId === userId);
  const totals = summarizeReports(reports);
  const bySymbol = groupReportsBySymbol(reports);
  const modal = document.querySelector("#modal");
  modal.classList.add("open");
  modal.innerHTML = `
    <article class="modal-card">
      <div class="actions" style="justify-content: space-between">
        <h2>Desempenho - ${escapeHtml(user.name)}</h2>
        <button class="btn btn-ghost" onclick="openUser('${user.id}')">Voltar</button>
      </div>
      <p class="muted">Conta ${escapeHtml(user.account)} - ${escapeHtml(user.broker)}</p>
      <div class="metrics compact">
        ${metric("Dia", money(totals.profitDay))}
        ${metric("Semana", money(totals.profitWeek))}
        ${metric("Mes", money(totals.profitMonth))}
        ${metric("Total", money(totals.profitTotal))}
      </div>
      <section class="panel inset">
        <h3>Grafico de resultado diario</h3>
        ${profitChart(dailySeries(reports), "Nenhum resultado recebido deste usuario ainda.")}
      </section>
      <section class="panel inset">
        <h3>Ativos operados</h3>
        <div class="bar-list">${bySymbol.map(symbolBar).join("") || `<div class="muted">Nenhum ativo recebido ainda.</div>`}</div>
      </section>
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

async function createAdmin(event) {
  event.preventDefault();
  await api("/api/admins", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries())) });
  toast("Administrador adicionado");
  await reload();
}

async function saveAdmin(event, adminId) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.target).entries());
  if (!body.password) delete body.password;
  await api(`/api/admins/${adminId}`, { method: "PUT", body: JSON.stringify(body) });
  toast("Administrador salvo");
  closeModal();
  await reload();
}

async function deleteAdmin(adminId) {
  await api(`/api/admins/${adminId}`, { method: "DELETE" });
  toast("Administrador excluido");
  closeModal();
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

function openRobotMessage(robotId) {
  const robot = findRobot(robotId);
  const modal = document.querySelector("#modal");
  modal.classList.add("open");
  modal.innerHTML = `
    <article class="modal-card">
      <div class="actions" style="justify-content: space-between">
        <h2>Mensagem - ${escapeHtml(robot.name)}</h2>
        <button class="btn btn-ghost" onclick="closeModal()">Fechar</button>
      </div>
      <form onsubmit="saveRobotMessage(event, '${robot.id}')">
        <label>Mensagem enviada ao MT5
          <textarea name="message" rows="5" placeholder="Ex: Nova versao disponivel. Atualize seu robo hoje.">${escapeHtml(robot.message || "")}</textarea>
        </label>
        <br>
        <div class="actions">
          <button class="btn btn-red" type="submit">Salvar mensagem</button>
          <button class="btn btn-ghost" type="button" onclick="clearRobotMessage('${robot.id}')">Limpar</button>
        </div>
      </form>
    </article>
  `;
}

async function saveRobotMessage(event, robotId) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.target).entries());
  await api(`/api/robots/${robotId}`, { method: "PUT", body: JSON.stringify(body) });
  toast("Mensagem salva");
  closeModal();
  await reload();
}

async function clearRobotMessage(robotId) {
  await api(`/api/robots/${robotId}`, { method: "PUT", body: JSON.stringify({ message: "" }) });
  toast("Mensagem limpa");
  closeModal();
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

function performanceReports() {
  return state.data.performanceReports || [];
}

function performanceSummary() {
  const reports = performanceReports();
  const today = new Date().toISOString().slice(0, 10);
  const todayReports = reports.filter((item) => item.date === today);
  const source = todayReports.length ? todayReports : reports;
  const totals = summarizeReports(source);
  return {
    accounts: new Set(source.map((item) => item.account)).size,
    trades: totals.tradesDay,
    volume: totals.volumeDay,
    profit: totals.profitDay,
    dailySeries: dailySeries(reports)
  };
}

function summarizeReports(reports) {
  return reports.reduce((sum, item) => ({
    profitDay: sum.profitDay + Number(item.profitDay || 0),
    profitWeek: sum.profitWeek + Number(item.profitWeek || 0),
    profitMonth: sum.profitMonth + Number(item.profitMonth || 0),
    profitTotal: sum.profitTotal + Number(item.profitTotal || 0),
    tradesDay: sum.tradesDay + Number(item.tradesDay || 0),
    volumeDay: sum.volumeDay + Number(item.volumeDay || 0)
  }), { profitDay: 0, profitWeek: 0, profitMonth: 0, profitTotal: 0, tradesDay: 0, volumeDay: 0 });
}

function dailySeries(reports) {
  const grouped = new Map();
  reports.forEach((item) => {
    grouped.set(item.date, (grouped.get(item.date) || 0) + Number(item.profitDay || 0));
  });
  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([date, profit]) => ({ date, profit }));
}

function rankingRows(period) {
  const grouped = new Map();
  performanceReports().forEach((item) => {
    const key = `${item.userId}:${item.robotId}`;
    const current = grouped.get(key) || {
      account: item.account,
      userName: item.userName,
      broker: item.broker,
      robot: item.robot,
      profit: 0,
      trades: 0,
      volume: 0,
      symbols: new Set()
    };
    current.profit += Number(period === "month" ? item.profitMonth : item.profitDay || 0);
    current.trades += Number(item.tradesDay || 0);
    current.volume += Number(item.volumeDay || 0);
    if (item.symbol) current.symbols.add(item.symbol);
    grouped.set(key, current);
  });
  return Array.from(grouped.values())
    .map((item) => ({ ...item, symbols: Array.from(item.symbols) }))
    .sort((a, b) => b.profit - a.profit);
}

function groupPerformanceBySymbol() {
  return groupReportsBySymbol(performanceReports());
}

function groupReportsBySymbol(reports) {
  const grouped = new Map();
  reports.forEach((item) => {
    const symbol = item.symbol || "-";
    const current = grouped.get(symbol) || { symbol, profit: 0, trades: 0, volume: 0, accounts: new Set() };
    current.profit += Number(item.profitDay || 0);
    current.trades += Number(item.tradesDay || 0);
    current.volume += Number(item.volumeDay || 0);
    current.accounts.add(item.account);
    grouped.set(symbol, current);
  });
  return Array.from(grouped.values())
    .map((item) => ({ ...item, accounts: item.accounts.size }))
    .sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit));
}

function profitChart(series, emptyText) {
  if (!series.length) return `<div class="chart-empty">${emptyText}</div>`;
  const width = 720;
  const height = 220;
  const pad = 28;
  const maxAbs = Math.max(...series.map((item) => Math.abs(item.profit)), 1);
  const step = (width - pad * 2) / Math.max(series.length - 1, 1);
  const zeroY = height / 2;
  const points = series.map((item, index) => {
    const x = pad + index * step;
    const y = zeroY - (item.profit / maxAbs) * (height / 2 - pad);
    return { ...item, x, y };
  });
  const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  return `
    <div class="chart-wrap">
      <svg class="profit-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafico de lucro por dia">
        <line x1="${pad}" y1="${zeroY}" x2="${width - pad}" y2="${zeroY}" class="chart-zero"></line>
        <path d="${path}" class="chart-line"></path>
        ${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4" class="${point.profit >= 0 ? "chart-dot positive-dot" : "chart-dot negative-dot"}"></circle>`).join("")}
        ${points.map((point, index) => index % Math.ceil(points.length / 6) === 0 ? `<text x="${point.x}" y="${height - 6}" text-anchor="middle">${escapeHtml(point.date.slice(5))}</text>` : "").join("")}
      </svg>
    </div>
  `;
}

function podiumCard(row, place) {
  return `
    <article class="podium-card place-${place}">
      <span class="badge">${place}o</span>
      <div class="avatar">${initials(row.userName)}</div>
      <h3>${escapeHtml(row.userName)}</h3>
      <p class="muted">${escapeHtml(row.broker)}</p>
      <strong class="${row.profit >= 0 ? "positive" : "negative"}">${money(row.profit)}</strong>
      <div class="muted">${row.trades} ops - ${numberBR(row.volume)} vol</div>
    </article>
  `;
}

function symbolBar(item) {
  const max = Math.max(...groupPerformanceBySymbol().map((entry) => Math.abs(entry.profit)), Math.abs(item.profit), 1);
  const width = Math.max(6, Math.round((Math.abs(item.profit) / max) * 100));
  return `
    <div class="bar-row">
      <strong>${escapeHtml(item.symbol)}</strong>
      <div class="bar-track"><span style="width:${width}%" class="${item.profit >= 0 ? "bar-positive" : "bar-negative"}"></span></div>
      <span>${money(item.profit)}</span>
      <span class="muted">${item.trades} ops</span>
    </div>
  `;
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

function numberBR(value) {
  return Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
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

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
