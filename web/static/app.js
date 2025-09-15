/* web/static/app.js */

const App = {
  // CSRF cookie reader
  getCookie(name) {
    const m = document.cookie.match(new RegExp('(^|; )' + name.replace(/([.$?*|{}()\\[\\]\\\\\\/\\+^])/g, '\\$1') + '=([^;]*)'));
    return m ? decodeURIComponent(m[2]) : null;
  },

  user: null,
  publicAntennaId: null,
  nav: [
    { id: "dashboard", label: "Dashboard", auth: true },
    { id: "antennes", label: "Antennes", auth: true },
    { id: "stock", label: "Stock", auth: true },
    { id: "benevoles", label: "Bénévoles", auth: true },
    { id: "prets", label: "Prêts en cours", auth: true },
    { id: "inventaire", label: "Inventaire", auth: true },
    { id: "admin", label: "Administration", auth: true },
    { id: "pretPublic", label: "Prêt publique", auth: false },
  ],

  qs(sel, root = document) { return root.querySelector(sel); },
  qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; },

  async fetchJSON(url, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    const csrf = this.getCookie("XSRF-TOKEN");
    if (csrf) headers["X-CSRFToken"] = csrf;
    opts.headers = headers;
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `Erreur ${res.status}`;
      const err = new Error(msg); err.status = res.status; err.data = data; throw err;
    }
    return data;
  },
  flash(msg) {
    const el = document.getElementById("flash");
    el.innerHTML = `<div class="toast">${msg}</div>`;
    setTimeout(() => (el.innerHTML = ""), 2600);
  },
  daysBetween(a, b) { return Math.round((b - a) / (1000 * 60 * 60 * 24)); },
  getSetting(key, def) { try { const v = localStorage.getItem("pc:" + key); return v !== null ? JSON.parse(v) : def; } catch { return def; } },
  setSetting(key, val) { try { localStorage.setItem("pc:" + key, JSON.stringify(val)); } catch {} },

  // ------------------------------ Nav / Login ------------------------------
  show(id) {
    document.querySelectorAll(".screen").forEach((e) => e.classList.add("hidden"));
    this.qs("#" + id)?.classList.remove("hidden");
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.id === id));
    if (id === "dashboard") this.renderDashboard();
    if (id === "antennes") this.renderAntennes();
    if (id === "stock") this.renderStock();
    if (id === "benevoles") this.renderBenevoles();
    if (id === "prets") this.renderPrets();
    if (id === "inventaire") this.renderInventaire();
    if (id === "admin") this.renderAdmin();
    if (id === "pretPublic") this.renderPretPublic();
  },
  renderNav() {
    const el = this.qs("#nav"); el.innerHTML = "";
    const frag = document.createDocumentFragment();
    (this.user ? this.nav : this.nav.filter((x) => !x.auth)).forEach((item) => {
      const a = document.createElement("a");
      a.href = "#"; a.dataset.id = item.id; a.textContent = item.label;
      a.onclick = (e) => { e.preventDefault(); this.show(item.id); };
      frag.appendChild(a);
    });
    el.appendChild(frag);
  },
  async init() {
    // Lecture antenne publique depuis l'URL
    const m = location.pathname.match(/^\\/a\\/(\\d+)/);
    if (m) this.publicAntennaId = Number(m[1]);
    if (this.publicAntennaId) { // page publique
      document.getElementById("loginView").classList.add("hidden");
      this.renderNav(); this.show("pretPublic"); return;
    }
    try {
      const me = await this.fetchJSON("/api/me");
      if (me.ok) { this.user = me.user; this.renderNav(); this.qs("#loginView").classList.add("hidden"); this.show("dashboard"); return; }
    } catch {}
    this.renderNav(); this.qs("#loginView").classList.remove("hidden");
  },
  async login() {
    const btn = document.getElementById("loginBtn");
    const email = this.qs("#loginEmail").value.trim();
    const password = this.qs("#loginPass").value;
    const err = this.qs("#loginError");
    err.classList.add("hidden"); err.textContent = "";
    if (!email || !password) { err.textContent = "Email et mot de passe requis"; err.classList.remove("hidden"); return; }
    btn.disabled = true; const old = btn.textContent; btn.textContent = "Connexion...";
    try {
      const r = await this.fetchJSON("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
      this.user = r.user; this.renderNav(); this.qs("#loginView").classList.add("hidden"); this.show("dashboard");
      this.flash("Bienvenue " + (this.user.name || this.user.email));
    } catch (e) {
      err.textContent = e.message || "Identifiants invalides"; err.classList.remove("hidden"); this.flash("Connexion refusée");
    } finally { btn.disabled = false; btn.textContent = old; }
  },

  // ------------------------------ Dashboard (amélioré) ------------------------------
  async renderDashboard() {
    const [stats, ants, stock, openLoans] = await Promise.all([
      this.fetchJSON("/api/stats").catch(() => ({ stock_total: 0, prets_ouverts: 0, benevoles: 0 })),
      this.fetchJSON("/api/antennas").catch(() => []),
      this.fetchJSON("/api/stock").catch(() => []),
      this.fetchJSON("/api/loans/open").catch(() => []),
    ]);

    const overdueDays = this.getSetting("overdue_days", 30);
    const now = Date.now();
    const overdue = openLoans.map(l => {
      const since = new Date(l.since).getTime();
      return { ...l, days: this.daysBetween(since, now) };
    }).filter(l => l.days > overdueDays);

    const antThreshold = Object.fromEntries(ants.map(a => [a.id, a.low_stock_threshold ?? this.getSetting("default_threshold", 5)]));
    const lowStock = stock.filter(s => s.quantity <= (antThreshold[s.antenna_id] ?? 5));

    // Aggregations
    const byAntenna = {}, byType = {};
    stock.forEach(s => {
      byAntenna[s.antenna] = (byAntenna[s.antenna] || 0) + s.quantity;
      byType[s.garment_type] = (byType[s.garment_type] || 0) + s.quantity;
    });

    const el = this.qs('#dashboard');
    el.innerHTML = `
      <div class="card">
        <div class="chips" style="justify-content:space-between">
          <h2>Tableau de bord</h2>
          <div class="chips">
            <a class="btn btn-ghost" href="/api/stock/export.csv">⬇️ Exporter le stock (CSV)</a>
          </div>
        </div>

        <div class="kpi-grid mt">
          <div class="kpi-card kpi-primary">
            <div class="kpi-label">Quantité en stock</div>
            <div class="kpi-value">${(stats.stock_total||0).toLocaleString('fr-FR')}</div>
          </div>
          <div class="kpi-card kpi-accent">
            <div class="kpi-label">Prêts ouverts</div>
            <div class="kpi-value">${stats.prets_ouverts||0}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Bénévoles avec prêt</div>
            <div class="kpi-value">${new Set(openLoans.map(l=>l.volunteer_id)).size}</div>
          </div>
          <div class="kpi-card kpi-warning">
            <div class="kpi-label">Alertes stock bas</div>
            <div class="kpi-value">${lowStock.length}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Retards &gt; ${overdueDays} j</div>
            <div class="kpi-value">${overdue.length}</div>
          </div>
        </div>

        <div class="grid-2 mt">
          <div>
            <div class="chips" style="justify-content:space-between">
              <h3>Répartition par antenne</h3>
            </div>
            ${Object.keys(byAntenna).length?Object.entries(byAntenna).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`
              <div class="bar-row"><div style="min-width:160px">${k}</div><div class="bar" style="width:${Math.max(8, v / Math.max(1, stats.stock_total) * 100)}%"></div><div style="min-width:60px;text-align:right">${v}</div></div>
            `).join(''):`<p class="muted">Aucune donnée</p>`}
          </div>
          <div>
            <div class="chips" style="justify-content:space-between">
              <h3>Retards de prêt</h3>
              <button class="btn btn-ghost" onclick="App.setOverdue()">Seuil: ${overdueDays} j</button>
            </div>
            ${overdue.length?`<table class="table"><thead><tr><th>Bénévole</th><th>Article</th><th>Jours</th><th></th></tr></thead>
              <tbody>${overdue.map(l=>`<tr><td>${l.volunteer}</td><td>${l.type} ${l.size||''}</td>
              <td><span class="badge badge-danger">${l.days}</span></td>
              <td><button class="btn btn-ghost" onclick="App.returnLoan(${l.id})">Marquer rendu</button></td></tr>`).join('')}</tbody></table>`:`<p class="muted">Aucun retard.</p>`}
          </div>
        </div>

        <div class="panel mt">
          <div class="panel-header">
            <h3>Alertes stock bas</h3>
          </div>
          <div class="table-responsive">
            <table class="table">
              <thead><tr><th>Antenne</th><th>Type</th><th>Taille</th><th>Qté</th><th>Seuil</th></tr></thead>
              <tbody>
                ${lowStock.map(r=>`<tr><td>${r.antenna}</td><td>${r.garment_type}</td><td>${r.size||''}</td><td>${r.quantity}</td><td>${antThreshold[r.antenna_id] ?? 5}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  },
  setOverdue(){ const cur=this.getSetting('overdue_days',30); const v=prompt('Nombre de jours avant retard ?', String(cur)); if(!v) return; const n=Math.max(1, Number(v)||30); this.setSetting('overdue_days', n); this.flash('Seuil mis à jour'); this.renderDashboard(); },

  // ------------------------------ Antennes ------------------------------
  async renderAntennes(){ /* … inchangé … */ },

  // ------------------------------ Stock (CRUD + tags) ------------------------------
  async renderStock(){
    const el=this.qs('#stock');
    const [types,ants]=await Promise.all([this.fetchJSON('/api/types'), this.fetchJSON('/api/antennas')]);
    this._types=types; this._ants=ants;
    const optType=(v)=>['<option value="">Type</option>'].concat(types.map(t=>`<option value="${t.id}" ${v==t.id?'selected':''}>${t.label}</option>`)).join('');
    const optAnt=(v)=>['<option value="">Antenne</option>'].concat(ants.map(a=>`<option value="${a.id}" ${v==a.id?'selected':''}>${a.name}</option>`)).join('');
    el.innerHTML=`<div class="card">
      <div class="chips" style="justify-content:space-between"><h2>Stock</h2>
        <div class="chips">
          <button class="btn btn-ghost" onclick="App.modalAddType()">+ Type</button>
          <a class="btn btn-ghost" href="/api/stock/export.csv">⬇️ Export CSV</a>
          <button class="btn btn-primary" onclick="App.modalAddStock()">+ Article</button>
        </div>
      </div>
      <div class="grid-3 mt"><select id="f_type">${optType('')}</select><select id="f_ant">${optAnt('')}</select><button class="btn btn-ghost" onclick="App.loadStock()">Filtrer</button></div>
      <div id="stockTable" class="mt"></div>
    </div>`;
    this._optType=optType; this._optAnt=optAnt; await this.loadStock();
  },

  async loadStock(){ /* … inchangé … */ },

  // ------------------------------ Bénévoles / Prêts / Inventaire / Admin / Public ------------------------------
  // (la suite du fichier reste identique à part l’ajout des boutons export/CSRF déjà gérés)
};

window.App = App;

// Boot
document.addEventListener("DOMContentLoaded", () => {
  const onEnter = (e) => { if (e.key === "Enter") { e.preventDefault(); App.login(); } };
  const em = document.getElementById("loginEmail");
  const pw = document.getElementById("loginPass");
  if (em) em.addEventListener("keydown", onEnter);
  if (pw) pw.addEventListener("keydown", onEnter);
  App.init();
});
