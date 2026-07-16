const state = {
  token: localStorage.getItem("licenseToken") || "",
  view: "dashboard",
  data: null,
  checkout: null,
  editingUserId: null,
  dashboardType: "all",
  dashboardPeriod: "30",
  rankingPeriod: "month",
  rankingFrom: "",
  rankingTo: "",
  userSearch: ""
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

async function publicApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || "Erro na requisicao");
  return payload;
}

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
  if (window.location.pathname === "/comprar") {
    renderCheckoutPage();
    return;
  }

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

function renderCheckoutPage() {
  app.innerHTML = `
    <section class="checkout-page">
      <div class="checkout-shell">
        <section class="panel hero-panel">
          <h1>Rompedor Flow</h1>
          <p class="muted">Escolha o plano, informe sua conta MT5 e finalize o pagamento com seguranca.</p>
          ${checkoutStatusMessage()}
        </section>
        <section id="checkout-content">${empty("Carregando planos...")}</section>
      </div>
    </section>
  `;

  publicApi("/api/checkout/config")
    .then((payload) => {
      state.checkout = payload.data;
      renderCheckoutContent();
    })
    .catch((error) => {
      document.querySelector("#checkout-content").innerHTML = `<section class="panel"><h2>Nao foi possivel carregar</h2><p class="muted">${escapeHtml(error.message)}</p></section>`;
    });
}

function checkoutStatusMessage() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("status");
  if (status === "success") return `<div class="badge green">Pagamento recebido. A licenca sera liberada automaticamente em instantes.</div>`;
  if (status === "pending") return `<div class="badge">Pagamento pendente. Assim que aprovar, a licenca sera liberada.</div>`;
  if (status === "failure") return `<div class="badge red">Pagamento nao aprovado. Voce pode tentar novamente.</div>`;
  return "";
}

function renderCheckoutContent() {
  const plans = state.checkout?.plans || [];
  const selectedPlanId = new URLSearchParams(window.location.search).get("plan");
  const firstPlanId = plans.some((plan) => plan.id === selectedPlanId) ? selectedPlanId : plans[0]?.id || "";
  const node = document.querySelector("#checkout-content");
  if (!node) return;
  node.innerHTML = `
    <section class="checkout-grid">
      <div class="panel">
        <h2>Planos disponiveis</h2>
        <div class="cards-list">
          ${plans.map((plan, index) => checkoutPlanCard(plan, index === 0)).join("") || empty("Nenhum plano ativo no momento.")}
        </div>
      </div>
      <div class="panel">
        <h2>Dados para liberar a licenca</h2>
        <form onsubmit="startCheckout(event)">
          <label>Plano
            <select name="planId" required>
              ${plans.map((plan) => `<option value="${plan.id}" ${plan.id === firstPlanId ? "selected" : ""}>${escapeHtml(plan.name)} - ${money(plan.price)}</option>`).join("")}
            </select>
          </label>
          <br>
          <label>Numero da conta MT5 <input name="account" required inputmode="numeric" placeholder="Ex: 1951361"></label>
          <br>
          <label>Nome <input name="name" required placeholder="Nome do titular"></label>
          <br>
          <label>E-mail <input name="email" type="email" required placeholder="email do comprador"></label>
          <br>
          <label>CPF/CNPJ <input name="document" required inputmode="numeric" placeholder="Somente numeros"></label>
          <br>
          <label>Telefone/WhatsApp <input name="phone" required placeholder="DDD + numero"></label>
          <br>
          <label>Corretora <input name="broker" placeholder="Ex: Genial, XP, Banco"></label>
          <br>
          <label>Tipo de conta <select name="type"><option>Real</option><option>Demo</option></select></label>
          <br>
          <button class="btn btn-red" type="submit" ${plans.length ? "" : "disabled"}>Ir para pagamento</button>
          <p class="muted" style="margin-top: 12px">Apos a aprovacao do pagamento, a licenca e liberada automaticamente para a conta informada.</p>
        </form>
      </div>
    </section>
  `;
}

function checkoutPlanCard(plan, highlighted) {
  return `
    <article class="robot-row ${highlighted ? "plan-highlight" : ""}">
      <div>
        <strong>${escapeHtml(plan.name)}</strong>
        <span class="badge green">${money(plan.price)}</span>
        <span class="badge">${plan.durationDays} dias</span>
        <div class="muted">${escapeHtml(plan.description || plan.robotName || "")}</div>
      </div>
    </article>
  `;
}

async function startCheckout(event) {
  event.preventDefault();
  const button = event.target.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Criando checkout...";
  try {
    const body = Object.fromEntries(new FormData(event.target).entries());
    const payload = await publicApi("/api/checkout", { method: "POST", body: JSON.stringify(body) });
    if (!payload.checkoutUrl) throw new Error("CHECKOUT_URL_NOT_CREATED");
    window.location.href = payload.checkoutUrl;
  } catch (error) {
    button.disabled = false;
    button.textContent = "Ir para pagamento";
    alert(error.message === "MERCADOPAGO_ACCESS_TOKEN_REQUIRED"
      ? "Pagamento ainda nao configurado. Configure MERCADOPAGO_ACCESS_TOKEN no Vercel."
      : error.message);
  }
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

function setDashboardFilter(key, value) {
  state[key] = value;
  renderView();
}

function setRankingFilter(key, value) {
  state[key] = value;
  renderView();
}

function dashboardSummary() {
  const range = getPeriodRange(state.dashboardPeriod);
  const users = usersByType(state.dashboardType);
  const userIds = new Set(users.map((user) => user.id));
  const now = new Date();
  const activeLicenses = state.data.licenses.filter((license) =>
    userIds.has(license.userId) &&
    license.status === "active" &&
    new Date(license.expiresAt) > now
  );
  const checks = state.data.checkIns.filter((check) =>
    (!check.userId || userIds.has(check.userId)) &&
    inDateRange(check.at, range)
  );
  const pending = (state.data.pendingRequests || []).filter((request) =>
    users.some((user) => userAccounts(user).some((account) => String(account.account) === String(request.account))) || state.dashboardType === "all"
  );
  const revenue = state.data.licenses
    .filter((license) => userIds.has(license.userId) && license.paidAt && inDateRange(license.paidAt, range))
    .reduce((sum, license) => sum + Number(license.price || 0), 0);

  return {
    activeAccounts: new Set(activeLicenses.map((license) => license.userId)).size,
    activeLicenses: activeLicenses.length,
    robots: state.data.robots.length,
    checksToday: checks.length,
    pendingRequests: pending.length,
    revenue
  };
}

function renderDashboard() {
  const s = dashboardSummary();
  const perf = performanceSummary({ type: state.dashboardType, period: state.dashboardPeriod });
  const alerts = licenseAlerts();
  return `
    <section class="panel hero-panel">
      <h1>Painel operacional <span class="badge green">LIVE</span></h1>
      <p class="muted">Controle de contas, licencas e verificacoes dos Expert Advisors.</p>
      <div class="filters">
        <label>Tipo de conta <select onchange="setDashboardFilter('dashboardType', this.value)">
          <option value="all" ${state.dashboardType === "all" ? "selected" : ""}>Todos</option>
          <option value="Real" ${state.dashboardType === "Real" ? "selected" : ""}>Real</option>
          <option value="Demo" ${state.dashboardType === "Demo" ? "selected" : ""}>Demo</option>
        </select></label>
        <label>Periodo <select onchange="setDashboardFilter('dashboardPeriod', this.value)">
          <option value="today" ${state.dashboardPeriod === "today" ? "selected" : ""}>Hoje</option>
          <option value="30" ${state.dashboardPeriod === "30" ? "selected" : ""}>30 dias</option>
          <option value="month" ${state.dashboardPeriod === "month" ? "selected" : ""}>Mes atual</option>
        </select></label>
      </div>
    </section>
    <section class="metrics">
      ${metric("Contas ativas", s.activeAccounts)}
      ${metric("Licencas ativas", s.activeLicenses)}
      ${metric("Robos", s.robots)}
      ${metric("Checks no periodo", s.checksToday)}
      ${metric("Pendentes", s.pendingRequests || 0)}
    </section>
    ${alerts.length ? `
      <section class="panel">
        <h2>Atencao</h2>
        <div class="cards-list">
          ${alerts.map(alertRow).join("")}
        </div>
      </section>
    ` : ""}
    <section class="panel">
      <h2>Resumo financeiro</h2>
      <div class="metric"><span>Faturado no periodo</span><strong>${money(s.revenue)}</strong></div>
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
  const period = state.rankingPeriod || "month";
  const range = getRankingRange();
  const rows = rankingRows(period, range);
  const top = rows.slice(0, 3);
  return `
    <section class="panel hero-panel">
      <h1>Ranking</h1>
      <p class="muted">Contas ordenadas pelo lucro enviado pelos robos no periodo selecionado.</p>
      <div class="filters">
        <label>Periodo <select onchange="setRankingFilter('rankingPeriod', this.value)">
          <option value="today" ${period === "today" ? "selected" : ""}>Dia</option>
          <option value="week" ${period === "week" ? "selected" : ""}>Semana</option>
          <option value="month" ${period === "month" ? "selected" : ""}>Mes</option>
          <option value="custom" ${period === "custom" ? "selected" : ""}>Periodo</option>
        </select></label>
        ${period === "custom" ? `
          <label>Inicio <input type="date" value="${escapeAttr(rankingDateValue("rankingFrom"))}" onchange="setRankingFilter('rankingFrom', this.value)"></label>
          <label>Fim <input type="date" value="${escapeAttr(rankingDateValue("rankingTo"))}" onchange="setRankingFilter('rankingTo', this.value)"></label>
        ` : ""}
      </div>
      <div class="muted">Exibindo: ${escapeHtml(periodLabel(period, range))}</div>
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
  const users = filteredUsers();
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
                ${request.phone ? `<div class="muted">Telefone/WhatsApp: ${escapeHtml(request.phone)}</div>` : ""}
                ${request.message ? `<div class="muted">${escapeHtml(request.message)}</div>` : ""}
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
      <div class="filters">
        <label>Busca <input value="${escapeAttr(state.userSearch)}" placeholder="Nome, conta, telefone, corretora..." oninput="setDashboardFilter('userSearch', this.value)"></label>
      </div>
      <form class="actions" onsubmit="createUser(event)">
        <label>Conta <input name="account" required></label>
        <label>Usuario <input name="name" required></label>
        <label>Corretora <input name="broker" required></label>
        <label>Telefone <input name="phone" placeholder="WhatsApp"></label>
        <label>Status <select name="status"><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
        <label>Tipo <select name="type"><option>Real</option><option>Demo</option></select></label>
        <button class="btn btn-red" type="submit">Adicionar</button>
      </form>
    </section>
    <section class="table-wrap">
      <table>
        <thead><tr><th>Contas</th><th>Usuario</th><th>Telefone</th><th>Status</th><th>Tipo</th><th>Corretora</th><th>Licencas</th><th>Editar</th></tr></thead>
        <tbody>
          ${users.map((user) => {
            const licenses = state.data.licenses.filter((license) => license.userId === user.id);
            const expired = licenses.some((license) => new Date(license.expiresAt) < new Date());
            const active = (user.status || "active") === "active";
            return `<tr class="${expired ? "warn" : ""}">
              <td><strong>${escapeHtml(primaryAccount(user))}</strong><div class="muted">${userAccounts(user).length} conta(s)</div></td>
              <td>${escapeHtml(user.name)}</td>
              <td>${escapeHtml(user.phone || "-")}</td>
              <td><span class="badge ${active ? "green" : "red"}">${active ? "Ativo" : "Inativo"}</span></td>
              <td><span class="badge green">${escapeHtml(user.type)}</span></td>
              <td>${escapeHtml(user.broker)}</td>
              <td>${licenses.length}</td>
              <td><button class="btn btn-ghost" onclick="openUser('${user.id}')">Editar</button></td>
            </tr>`;
          }).join("")}
          ${!users.length ? `<tr><td colspan="8">Nenhum usuario encontrado.</td></tr>` : ""}
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
            <span class="badge">versao informativa</span>
            <div class="muted">${escapeHtml(robot.messageId ? robot.message : (robot.message ? "Mensagem antiga sem disparo ativo" : "Sem mensagem ativa"))}</div>
            ${robotVersionSummary(robot)}
          </div>
          <button class="btn btn-blue" onclick="openRobotMessage('${robot.id}')">Mensagem</button>
        </article>
      `).join("")}
    </section>
  `;
}

function renderFinance() {
  const plans = state.data.plans || [];
  const payments = state.data.payments || [];
  const paid = state.data.licenses.filter((license) => Number(license.price) > 0);
  const approved = payments.filter((payment) => payment.status === "approved");
  const total = approved.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const publicUrl = `${window.location.origin}/comprar`;
  return `
    <section class="panel">
      <h1>Financeiro e pagamentos</h1>
      <p class="muted">Planos, checkout publico e historico de pagamentos.</p>
      <div class="metrics compact">
        ${metric("Total aprovado", money(total))}
        ${metric("Pagamentos", payments.length)}
        ${metric("Planos ativos", plans.filter((plan) => plan.status === "active").length)}
        ${metric("Checkout", `<button class="btn btn-ghost" onclick="copyText('${escapeAttr(publicUrl)}')">Copiar link</button>`)}
      </div>
    </section>
    <section class="panel">
      <h2>Planos de venda</h2>
      <form class="actions" onsubmit="createPlan(event)">
        <label>Nome <input name="name" placeholder="Rompedor Flow - 30 dias" required></label>
        <label>Robo <select name="robotId">${state.data.robots.map((robot) => `<option value="${robot.id}">${escapeHtml(robot.name)}</option>`).join("")}</select></label>
        <label>Dias <input name="durationDays" type="number" min="1" value="30" required></label>
        <label>Valor <input name="price" type="number" step="0.01" min="0" value="197" required></label>
        <label>Status <select name="status"><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
        <label class="field-wide">Descricao <input name="description" placeholder="Licenca para uso do robo"></label>
        <button class="btn btn-red" type="submit">Adicionar plano</button>
      </form>
      <div class="cards-list" style="margin-top: 16px">
        ${plans.map(planCard).join("") || empty("Nenhum plano cadastrado.")}
      </div>
    </section>
    <section class="table-wrap">
      <table>
        <thead><tr><th>Status</th><th>Plano</th><th>Conta</th><th>Cliente</th><th>Contato</th><th>Pagamento</th><th>Total</th></tr></thead>
        <tbody>${payments.map((payment) => {
          const plan = findPlan(payment.planId);
          return `<tr>
            <td><span class="badge ${payment.status === "approved" ? "green" : payment.status === "pending" ? "" : "red"}">${escapeHtml(payment.status)}</span></td>
            <td>${escapeHtml(plan.name || "-")}</td>
            <td><strong>${escapeHtml(payment.account)}</strong></td>
            <td>${escapeHtml(payment.name)}</td>
            <td>${escapeHtml(payment.phone || "-")}<div class="muted">${escapeHtml(payment.email || payment.document || "-")}</div></td>
            <td>${formatDate(payment.paidAt || payment.updatedAt)}</td>
            <td>${money(payment.amount)}</td>
          </tr>`;
        }).join("") || paid.map((license) => {
          const user = findUser(license.userId);
          const robot = findRobot(license.robotId);
          return `<tr><td><span class="badge green">manual</span></td><td>${escapeHtml(robot.name)}</td><td>${escapeHtml(primaryAccount(user))}</td><td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.phone || "-")}</td><td>${formatDate(license.paidAt)}</td><td>${money(license.price)}</td></tr>`;
        }).join("") || `<tr><td colspan="7">Nenhum pagamento registrado.</td></tr>`}</tbody>
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
      ${state.data.checkIns.slice(0, 120).map(checkRow).join("") || empty("Nenhuma verificacao ainda.")}
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
  const accounts = userAccounts(user);
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
          <label>Conta principal <input name="account" value="${escapeAttr(primaryAccount(user))}"></label>
          <label>Usuario <input name="name" value="${escapeAttr(user.name)}"></label>
          <label>Corretora <input name="broker" value="${escapeAttr(user.broker)}"></label>
          <label>Telefone/WhatsApp <input name="phone" value="${escapeAttr(user.phone || "")}"></label>
          <label>Status <select name="status"><option value="active" ${(user.status || "active") === "active" ? "selected" : ""}>Ativo</option><option value="inactive" ${user.status === "inactive" ? "selected" : ""}>Inativo</option></select></label>
          <label>Tipo <select name="type"><option ${user.type === "Real" ? "selected" : ""}>Real</option><option ${user.type === "Demo" ? "selected" : ""}>Demo</option></select></label>
        </div>
        <br>
        <label>Observacao <textarea name="notes">${escapeHtml(user.notes || "")}</textarea></label>
        <br>
        <div class="actions">
          <button class="btn btn-red" type="submit">Salvar usuario</button>
          <button class="btn btn-ghost" type="button" onclick="deleteUser('${user.id}')">Excluir usuario</button>
        </div>
      </form>
      <hr>
      <h3>Contas MT5 do cliente</h3>
      <div class="cards-list">
        ${accounts.map((account) => `
          <article class="robot-row">
            <div>
              <strong>${escapeHtml(account.account)}</strong>
              ${account.account === primaryAccount(user) ? `<span class="badge green">Principal</span>` : ""}
              <div class="muted">Titular: ${escapeHtml(account.name || user.name || "-")}</div>
              <div class="muted">${escapeHtml(account.broker || user.broker || "-")} ${account.accountServer ? `- ${escapeHtml(account.accountServer)}` : ""}</div>
            </div>
            ${account.account !== primaryAccount(user) ? `<button class="btn btn-ghost" onclick="removeUserAccount('${user.id}', '${escapeAttr(account.account)}')">Remover</button>` : ""}
          </article>
        `).join("") || empty("Nenhuma conta vinculada.")}
      </div>
      <form class="actions" style="margin-top: 14px" onsubmit="addUserAccount(event, '${user.id}')">
        <label>Nova conta MT5 <input name="account" required></label>
        <label>Titular da conta <input name="name" placeholder="Opcional"></label>
        <label>Corretora <input name="broker" placeholder="Opcional"></label>
        <label>Servidor <input name="accountServer" placeholder="Opcional"></label>
        <button class="btn btn-red" type="submit">Adicionar conta</button>
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
      <p class="muted">Conta principal ${escapeHtml(primaryAccount(user))} - ${escapeHtml(user.broker)} - ${userAccounts(user).length} conta(s)</p>
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
  const effectiveType = String(license.type || "REAL").toUpperCase();
  return `
    <article class="robot-row">
      <div>
        <strong>${escapeHtml(robot.name)}</strong>
        <span class="badge ${license.status === "active" && !expired ? "green" : "red"}">${expired ? "expirado" : license.status}</span>
        <span class="badge">${escapeHtml(effectiveType)}</span>
        <span class="badge">${formatDate(license.expiresAt)}</span>
        ${Number(license.price || 0) > 0 ? `<span class="badge green">${money(license.price)}</span>` : ""}
        <div class="muted">Chave: ${escapeHtml(license.key)}</div>
      </div>
      <div class="actions">
        <button class="btn btn-blue" onclick="openLicenseDetails('${license.id}')">Detalhes</button>
        <button class="btn btn-ghost" onclick="copyText('${escapeAttr(license.key)}')">Copiar chave</button>
        ${effectiveType === "TRIAL" ? `<button class="btn btn-ghost" onclick="openConvertLicense('${license.id}')">Converter para paga</button>` : ""}
        <button class="btn btn-ghost" onclick="extendLicense('${license.id}', 365)">+1 ano</button>
        <button class="btn btn-red" onclick="deleteLicense('${license.id}')">Excluir</button>
      </div>
    </article>
  `;
}

function openLicenseDetails(licenseId) {
  const license = state.data.licenses.find((item) => item.id === licenseId);
  if (!license) return toast("Licenca nao encontrada");
  const user = findUser(license.userId);
  const robot = findRobot(license.robotId);
  const checks = (state.data.checkIns || [])
    .filter((item) => item.licenseId === license.id || (item.userId === user.id && item.robotId === robot.id))
    .slice(0, 8);
  const payments = (state.data.payments || [])
    .filter((item) => item.licenseId === license.id || (item.userId === user.id && item.robotId === robot.id))
    .slice(0, 6);
  const audits = (state.data.auditLog || [])
    .filter((item) => item.details?.licenseId === license.id || item.details?.userId === user.id || item.details?.robotId === robot.id)
    .slice(0, 8);
  const modal = document.querySelector("#modal");
  modal.classList.add("open");
  modal.innerHTML = `
    <article class="modal-card">
      <div class="actions" style="justify-content: space-between">
        <h2>Licenca - ${escapeHtml(robot.name)}</h2>
        <button class="btn btn-ghost" onclick="openUser('${user.id}')">Voltar</button>
      </div>
      <div class="metrics compact">
        ${metric("Cliente", escapeHtml(user.name))}
        ${metric("Status", escapeHtml(license.status))}
        ${metric("Tipo", escapeHtml(license.type || "REAL"))}
        ${metric("Vencimento", formatDate(license.expiresAt))}
      </div>
      <section class="panel inset">
        <h3>Dados comerciais</h3>
        <div class="metrics compact">
          ${metric("Valor", money(license.price))}
          ${metric("Pagamento", formatDate(license.paidAt))}
        </div>
        <article class="check-row">
          <div>
            <strong>Chave</strong>
            <div class="muted">${escapeHtml(license.key)}</div>
          </div>
          <button class="btn btn-ghost" onclick="copyText('${escapeAttr(license.key)}')">Copiar</button>
        </article>
      </section>
      <section class="panel inset">
        <h3>Contas vinculadas</h3>
        <div class="cards-list">${userAccounts(user).map((account) => `
          <article class="robot-row">
            <div>
              <strong>${escapeHtml(account.account)}</strong>
              <div class="muted">${escapeHtml(account.name || user.name || "-")} - ${escapeHtml(account.broker || user.broker || "-")}</div>
            </div>
          </article>
        `).join("") || `<div class="muted">Nenhuma conta vinculada.</div>`}</div>
      </section>
      <section class="panel inset">
        <h3>Ultimos check-ins</h3>
        <div class="cards-list">${checks.map(checkRow).join("") || `<div class="muted">Nenhuma verificacao registrada.</div>`}</div>
      </section>
      <section class="panel inset">
        <h3>Pagamentos</h3>
        <div class="cards-list">${payments.map(paymentRow).join("") || `<div class="muted">Nenhum pagamento vinculado.</div>`}</div>
      </section>
      <section class="panel inset">
        <h3>Auditoria</h3>
        <div class="cards-list">${audits.map(auditRow).join("") || `<div class="muted">Nenhuma acao registrada.</div>`}</div>
      </section>
    </article>
  `;
}

function planCard(plan) {
  const robot = findRobot(plan.robotId);
  const link = `${window.location.origin}/comprar?plan=${encodeURIComponent(plan.id)}`;
  return `
    <article class="robot-row">
      <div>
        <strong>${escapeHtml(plan.name)}</strong>
        <span class="badge ${plan.status === "active" ? "green" : "red"}">${plan.status === "active" ? "Ativo" : "Inativo"}</span>
        <span class="badge">${money(plan.price)}</span>
        <span class="badge">${Number(plan.durationDays || 0)} dias</span>
        <div class="muted">${escapeHtml(robot.name)} - ${escapeHtml(plan.description || "Sem descricao")}</div>
      </div>
      <div class="actions">
        <button class="btn btn-ghost" onclick="copyText('${escapeAttr(link)}')">Copiar link</button>
        <button class="btn btn-blue" onclick="openPlan('${plan.id}')">Editar</button>
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
    phone: request.phone || "",
    status: "active",
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

async function addUserAccount(event, userId) {
  event.preventDefault();
  const addAccount = Object.fromEntries(new FormData(event.target).entries());
  await api(`/api/users/${userId}`, { method: "PUT", body: JSON.stringify({ addAccount }) });
  toast("Conta adicionada ao cliente");
  await reload();
  openUser(userId);
}

async function removeUserAccount(userId, account) {
  if (!confirm(`Remover a conta ${account} deste cliente?`)) return;
  await api(`/api/users/${userId}`, { method: "PUT", body: JSON.stringify({ removeAccount: account }) });
  toast("Conta removida");
  await reload();
  openUser(userId);
}

async function deleteUser(userId) {
  const user = findUser(userId);
  if (!confirm(`Excluir o usuario ${user.name}? As licencas dele tambem serao removidas.`)) return;
  await api(`/api/users/${userId}`, { method: "DELETE" });
  toast("Usuario excluido");
  closeModal();
  await reload();
}

async function createRobot(event) {
  event.preventDefault();
  await api("/api/robots", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries())) });
  toast("Robo adicionado");
  await reload();
}

async function createPlan(event) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.target).entries());
  await api("/api/plans", { method: "POST", body: JSON.stringify(body) });
  toast("Plano adicionado");
  event.target.reset();
  await reload();
}

function openPlan(planId) {
  const plan = findPlan(planId);
  if (!plan.id) return toast("Plano nao encontrado");
  const modal = document.querySelector("#modal");
  modal.classList.add("open");
  modal.innerHTML = `
    <article class="modal-card">
      <div class="actions" style="justify-content: space-between">
        <h2>${escapeHtml(plan.name)}</h2>
        <button class="btn btn-ghost" onclick="closeModal()">Fechar</button>
      </div>
      <form onsubmit="savePlan(event, '${plan.id}')">
        <div class="split">
          <label>Nome <input name="name" value="${escapeAttr(plan.name)}" required></label>
          <label>Robo <select name="robotId">${state.data.robots.map((robot) => `<option value="${robot.id}" ${robot.id === plan.robotId ? "selected" : ""}>${escapeHtml(robot.name)}</option>`).join("")}</select></label>
          <label>Dias <input name="durationDays" type="number" min="1" value="${escapeAttr(plan.durationDays)}" required></label>
          <label>Valor <input name="price" type="number" step="0.01" min="0" value="${escapeAttr(plan.price)}" required></label>
          <label>Status <select name="status"><option value="active" ${plan.status === "active" ? "selected" : ""}>Ativo</option><option value="inactive" ${plan.status === "inactive" ? "selected" : ""}>Inativo</option></select></label>
        </div>
        <br>
        <label>Descricao <textarea name="description">${escapeHtml(plan.description || "")}</textarea></label>
        <br>
        <div class="actions">
          <button class="btn btn-red" type="submit">Salvar plano</button>
          <button class="btn btn-ghost" type="button" onclick="deletePlan('${plan.id}')">Excluir plano</button>
        </div>
      </form>
    </article>
  `;
}

async function savePlan(event, planId) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.target).entries());
  await api(`/api/plans/${planId}`, { method: "PUT", body: JSON.stringify(body) });
  toast("Plano salvo");
  closeModal();
  await reload();
}

async function deletePlan(planId) {
  if (!confirm("Excluir este plano?")) return;
  await api(`/api/plans/${planId}`, { method: "DELETE" });
  toast("Plano excluido");
  closeModal();
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
        <label>Novo aviso para enviar uma vez no MT5
          <textarea name="message" rows="5" placeholder="Ex: Nova versao disponivel. Atualize seu robo hoje.">${escapeHtml(robot.message || "")}</textarea>
        </label>
        <div class="muted">Ao salvar, este texto vira um novo disparo e cada conta recebe apenas uma vez. Limpe a mensagem para cancelar disparos futuros.</div>
        <br>
        <div class="actions">
          <button class="btn btn-red" type="submit">Salvar novo disparo</button>
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
  toast("Disparo de mensagem salvo");
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
  await api(`/api/licenses/${licenseId}`, { method: "PUT", body: JSON.stringify({ expiresAt: date.toISOString(), status: "active", type: "REAL" }) });
  toast("Licenca efetivada e prorrogada");
  closeModal();
  await reload();
  openUser(license.userId);
}

function openConvertLicense(licenseId) {
  const license = state.data.licenses.find((item) => item.id === licenseId);
  const date = new Date(Math.max(Date.now(), new Date(license.expiresAt).getTime()));
  if (String(license.type || "").toUpperCase() === "TRIAL") date.setDate(date.getDate() + 365);
  const modal = document.querySelector("#modal");
  modal.classList.add("open");
  modal.innerHTML = `
    <article class="modal-card">
      <div class="actions" style="justify-content: space-between">
        <h2>Converter licenca</h2>
        <button class="btn btn-ghost" onclick="openUser('${license.userId}')">Voltar</button>
      </div>
      <form onsubmit="convertLicense(event, '${license.id}')">
        <div class="split">
          <label>Valor pago <input name="price" type="number" step="0.01" min="0" value="${escapeAttr(license.price || "")}"></label>
          <label>Data de pagamento <input name="paidAt" type="date" value="${todayISO()}"></label>
          <label>Expira em <input name="expiresAt" type="datetime-local" value="${dateTimeInputValue(date)}"></label>
        </div>
        <br>
        <div class="actions">
          <button class="btn btn-red" type="submit">Converter para paga</button>
          <button class="btn btn-ghost" type="button" onclick="openUser('${license.userId}')">Cancelar</button>
        </div>
      </form>
    </article>
  `;
}

async function convertLicense(event, licenseId) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.target).entries());
  const license = state.data.licenses.find((item) => item.id === licenseId);
  await api(`/api/licenses/${licenseId}`, {
    method: "PUT",
    body: JSON.stringify({
      status: "active",
      type: "REAL",
      price: Number(body.price || 0),
      paidAt: body.paidAt || todayISO(),
      expiresAt: new Date(body.expiresAt).toISOString()
    })
  });
  toast("Licenca convertida para paga");
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

function performanceSummary(filters = {}) {
  const range = getPeriodRange(filters.period || "today");
  const userIds = new Set(usersByType(filters.type || "all").map((user) => user.id));
  const reports = performanceReports().filter((item) =>
    userIds.has(item.userId) &&
    inDateRange(item.date, range)
  );
  const source = reports;
  const totals = summarizeReports(source);
  return {
    accounts: new Set(source.map((item) => item.account)).size,
    trades: totals.tradesDay,
    volume: totals.volumeDay,
    profit: totals.profitDay,
    dailySeries: dailySeries(reports)
  };
}

function usersByType(type) {
  if (!type || type === "all") return state.data.users;
  return state.data.users.filter((user) => String(user.type).toLowerCase() === String(type).toLowerCase());
}

function getPeriodRange(period) {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (period === "30") {
    start.setDate(start.getDate() - 29);
  } else if (period === "week") {
    const day = start.getDay();
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  } else if (period === "month") {
    start.setDate(1);
  }

  return { start, end };
}

function getCustomRange(fromValue, toValue) {
  const from = parseDateInput(fromValue || todayISO());
  const to = parseDateInput(toValue || fromValue || todayISO());
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getRankingRange() {
  const period = state.rankingPeriod || "month";
  if (period === "custom") return getCustomRange(rankingDateValue("rankingFrom"), rankingDateValue("rankingTo"));
  return getPeriodRange(period);
}

function rankingDateValue(key) {
  if (state[key]) return state[key];
  return key === "rankingFrom" ? todayISO() : todayISO();
}

function todayISO() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function parseDateInput(value) {
  const date = new Date(`${value || todayISO()}T12:00:00`);
  date.setHours(0, 0, 0, 0);
  return date;
}

function periodLabel(period, range) {
  const start = range.start.toLocaleDateString("pt-BR");
  const end = range.end.toLocaleDateString("pt-BR");
  if (period === "today") return `dia ${start}`;
  if (period === "week") return `semana de ${start} ate ${end}`;
  if (period === "month") return `mes atual, de ${start} ate ${end}`;
  return `${start} ate ${end}`;
}

function inDateRange(value, range) {
  if (!value) return false;
  const date = new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
  return date >= range.start && date <= range.end;
}

function summarizeReports(reports) {
  const sum = reports.reduce((acc, item) => ({
    profitDay: acc.profitDay + Number(item.profitDay || 0),
    tradesDay: acc.tradesDay + Number(item.tradesDay || 0),
    volumeDay: acc.volumeDay + Number(item.volumeDay || 0)
  }), { profitDay: 0, tradesDay: 0, volumeDay: 0 });

  const latestByRobotAccount = new Map();
  reports.forEach((item) => {
    const key = `${item.userId}:${item.robotId}:${item.account}`;
    const current = latestByRobotAccount.get(key);
    const updatedAt = item.updatedAt || item.createdAt || item.date || "";
    if (!current || String(updatedAt) >= String(current.updatedAt || current.createdAt || current.date || "")) {
      latestByRobotAccount.set(key, item);
    }
  });

  Array.from(latestByRobotAccount.values()).forEach((item) => {
    sum.profitWeek = (sum.profitWeek || 0) + Number(item.profitWeek || 0);
    sum.profitMonth = (sum.profitMonth || 0) + Number(item.profitMonth || 0);
    sum.profitTotal = (sum.profitTotal || 0) + Number(item.profitTotal || 0);
  });

  return { profitWeek: 0, profitMonth: 0, profitTotal: 0, ...sum };
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

function rankingRows(period, range = null) {
  const selectedRange = range || getPeriodRange(period || "today");
  const grouped = new Map();
  performanceReports().filter((item) => inDateRange(item.date, selectedRange)).forEach((item) => {
    const key = `${item.userId}:${item.robotId}:${item.account}`;
    const current = grouped.get(key) || {
      account: item.account,
      userName: accountHolderName(item.account, item.userName),
      broker: accountBrokerName(item.account, item.broker),
      robot: item.robot,
      profit: 0,
      trades: 0,
      volume: 0,
      symbols: new Set(),
      dailyProfitByDate: new Map()
    };
    current.dailyProfitByDate.set(item.date, (current.dailyProfitByDate.get(item.date) || 0) + Number(item.profitDay || 0));
    current.profit = Array.from(current.dailyProfitByDate.values()).reduce((sum, value) => sum + value, 0);
    current.trades += Number(item.tradesDay || 0);
    current.volume += Number(item.volumeDay || 0);
    if (item.symbol) current.symbols.add(item.symbol);
    grouped.set(key, current);
  });
  return Array.from(grouped.values())
    .map((item) => ({ ...item, symbols: Array.from(item.symbols), dailyProfitByDate: undefined }))
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
        <div class="muted">${formatDate(check.at)} - ${escapeHtml(check.ip || "")}${check.clientVersion ? ` - versao ${escapeHtml(check.clientVersion)}` : ""}</div>
      </div>
      <span class="badge ${check.authorized ? "green" : "red"}">${escapeHtml(check.reason)}</span>
    </article>
  `;
}

function paymentRow(payment) {
  const plan = findPlan(payment.planId);
  return `
    <article class="check-row">
      <div>
        <strong>${escapeHtml(plan.name || payment.provider || "Pagamento")}</strong>
        <div class="muted">${escapeHtml(payment.account || "-")} - ${formatDate(payment.paidAt || payment.updatedAt || payment.createdAt)}</div>
      </div>
      <span class="badge ${payment.status === "approved" ? "green" : payment.status === "pending" ? "" : "red"}">${money(payment.amount)}</span>
    </article>
  `;
}

function auditRow(audit) {
  return `
    <article class="check-row">
      <div>
        <strong>${escapeHtml(audit.action || "ACAO")}</strong>
        <div class="muted">${formatDate(audit.at)}</div>
      </div>
      <span class="badge">${escapeHtml(audit.details?.account || audit.details?.user || audit.details?.robot || audit.details?.licenseId || "-")}</span>
    </article>
  `;
}

function robotVersionSummary(robot) {
  const checks = latestChecksForRobot(robot);
  const versions = new Map();
  checks.forEach((check) => {
    const version = check.clientVersion || "sem versao";
    versions.set(version, (versions.get(version) || 0) + 1);
  });
  const expected = String(robot.version || "").replace(/^v/i, "");
  const outdated = checks.filter((check) => {
    const current = String(check.clientVersion || "").replace(/^v/i, "");
    return expected && current && compareVersions(current, expected) < 0;
  });
  return `
    <div class="muted">Versoes detectadas: ${Array.from(versions.entries()).map(([version, total]) => `${escapeHtml(version)} (${total})`).join(", ") || "nenhuma"}</div>
    ${outdated.length ? `<div class="muted">Desatualizados: ${outdated.slice(0, 6).map((check) => `${escapeHtml(check.accountName || check.account || "-")} ${check.clientVersion ? `v${escapeHtml(String(check.clientVersion).replace(/^v/i, ""))}` : ""}`).join("; ")}${outdated.length > 6 ? ` +${outdated.length - 6}` : ""}</div>` : ""}
  `;
}

function compareVersions(a, b) {
  const left = String(a || "").replace(/^v/i, "").split(".").map((part) => Number(part) || 0);
  const right = String(b || "").replace(/^v/i, "").split(".").map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function latestChecksForRobot(robot) {
  const byAccount = new Map();
  (state.data.checkIns || []).forEach((check) => {
    const sameRobot = check.robotId === robot.id || String(check.robot || "").toLowerCase() === String(robot.name || "").toLowerCase();
    if (!sameRobot) return;
    const key = String(check.account || check.accountName || check.id);
    if (!byAccount.has(key)) byAccount.set(key, check);
  });
  return Array.from(byAccount.values());
}

function alertRow(alert) {
  return `
    <article class="robot-row">
      <div>
        <strong>${escapeHtml(alert.title)}</strong>
        <div class="muted">${escapeHtml(alert.text)}</div>
      </div>
      <button class="btn btn-ghost" onclick="openUser('${alert.userId}')">Abrir</button>
    </article>
  `;
}

function findUser(id) {
  return state.data.users.find((item) => item.id === id) || { name: "-", account: "-", broker: "-" };
}

function filteredUsers() {
  const term = normalizeSearch(state.userSearch);
  if (!term) return state.data.users;
  return state.data.users.filter((user) => {
    const haystack = [
      user.name,
      user.phone,
      user.broker,
      user.status,
      user.type,
      ...userAccounts(user).flatMap((account) => [account.account, account.name, account.broker, account.accountServer])
    ].map(normalizeSearch).join(" ");
    return haystack.includes(term);
  });
}

function licenseAlerts() {
  const now = new Date();
  const soon = new Date(now);
  soon.setDate(soon.getDate() + 7);
  return (state.data.licenses || [])
    .filter((license) => license.status === "active")
    .map((license) => {
      const expiresAt = new Date(license.expiresAt);
      if (expiresAt > soon) return null;
      const user = findUser(license.userId);
      const robot = findRobot(license.robotId);
      const expired = expiresAt < now;
      return {
        userId: user.id,
        title: `${robot.name} - ${user.name}`,
        text: `${expired ? "Vencida" : "Vence em breve"} em ${formatDate(license.expiresAt)}`
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function userAccounts(user) {
  const accounts = Array.isArray(user.accounts) ? user.accounts.filter((item) => item && item.account) : [];
  if (!accounts.length && user.account) return [{ account: user.account, broker: user.broker || "", primary: true }];
  return accounts;
}

function accountEntry(account) {
  const value = String(account || "");
  for (const user of state.data.users || []) {
    const entry = userAccounts(user).find((item) => String(item.account) === value);
    if (entry) return { user, entry };
  }
  return null;
}

function accountHolderName(account, fallback = "-") {
  const linked = accountEntry(account);
  return linked?.entry?.name || fallback || linked?.user?.name || "-";
}

function accountBrokerName(account, fallback = "-") {
  const linked = accountEntry(account);
  return linked?.entry?.broker || fallback || linked?.user?.broker || "-";
}

function primaryAccount(user) {
  return user.account || userAccounts(user)[0]?.account || "-";
}

function findRobot(id) {
  return state.data.robots.find((item) => item.id === id) || { name: "-", version: "-" };
}

function findPlan(id) {
  return (state.data.plans || []).find((item) => item.id === id) || { name: "-", description: "" };
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
  return dateTimeInputValue(date);
}

function dateTimeInputValue(date) {
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
