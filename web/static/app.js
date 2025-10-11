/* web/static/app.js */

const App = {
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
  dashboardData: null,
  dashboardState: null,

  // ------------------------------- Utils -------------------------------
  qs: (s) => document.querySelector(s),
  async fetchJSON(url, opts = {}) {
    opts.headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
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
  formatNumber(n) { return (Number.isFinite(n) ? n : 0).toLocaleString("fr-FR"); },
  formatDateTime(value) {
    try { return new Date(value).toLocaleString(); }
    catch { return value || ""; }
  },

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
    if (this.user) {
      const lo = document.createElement("a");
      lo.href = "#"; lo.textContent = "Déconnexion";
      lo.onclick = async (e) => { e.preventDefault(); await this.fetchJSON("/api/logout", { method: "POST" }); this.user = null; location.href = "/"; };
      frag.appendChild(lo);
    }
    el.appendChild(frag);
  },
  async init() {
    const m = location.pathname.match(/^\/a\/(\d+)/);
    if (m) this.publicAntennaId = Number(m[1]);
    if (this.publicAntennaId) { // page publique
      document.getElementById("loginView").classList.add("hidden");
      this.renderNav(); this.show("pretPublic"); return;
    }
    try { const me = await this.fetchJSON("/api/me"); if (me.ok) { this.user = me.user; this.renderNav(); this.qs("#loginView").classList.add("hidden"); this.show("dashboard"); return; } } catch {}
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

  // ------------------------------ Modal ------------------------------
  openModal(title, bodyHTML) {
    this.qs("#modalTitle").textContent = title;
    this.qs("#modalBody").innerHTML = bodyHTML;
    const m = this.qs("#modal");
    document.body.classList.add("no-scroll");
    m.classList.remove("hidden"); m.classList.add("show");
  },
  closeModal() {
    const m = this.qs("#modal");
    m.classList.remove("show"); m.classList.add("hidden");
    this.qs("#modalBody").innerHTML = "";
    document.body.classList.remove("no-scroll");
  },

  // ------------------------------ Dashboard enrichi ------------------------------
  async renderDashboard() {
    const el = this.qs('#dashboard');
    if (el) el.innerHTML = `<div class="card"><p class="muted">Chargement du tableau de bord…</p></div>`;
    try {
      const data = await this.fetchJSON('/api/stats');
      this.dashboardData = data;
      this.ensureDashboardState();
      this.drawDashboard();
    } catch (e) {
      if (el) el.innerHTML = `<div class="card"><p class="alert">${e.message || 'Impossible de charger le tableau de bord'}</p></div>`;
    }
  },
  ensureDashboardState() {
    const baseDays = this.dashboardData?.overdue_default || 30;
    if (!this.dashboardState) {
      this.dashboardState = {
        lowOnly: this.getSetting('dash_low_only', false),
        selectedType: 'all',
        selectedAntenna: 'all',
        overdueDays: this.getSetting('overdue_days', baseDays),
      };
    } else if (typeof this.dashboardState.overdueDays === 'undefined') {
      this.dashboardState.overdueDays = this.getSetting('overdue_days', baseDays);
    }
  },
  aggregateStockByType(antennaId) {
    if (!this.dashboardData) return [];
    if (!antennaId || antennaId === 'all') {
      return [...(this.dashboardData.stock_by_type || [])];
    }
    const map = new Map();
    (this.dashboardData.stock_snapshot || []).forEach((item) => {
      if (item.antenna_id !== antennaId) return;
      if (!map.has(item.garment_type_id)) {
        map.set(item.garment_type_id, { id: item.garment_type_id, label: item.garment_type, total_qty: 0 });
      }
      const entry = map.get(item.garment_type_id);
      entry.total_qty += item.quantity || 0;
    });
    return Array.from(map.values()).sort((a, b) => b.total_qty - a.total_qty);
  },
  aggregateStockByAntenna(typeId) {
    if (!this.dashboardData) return [];
    if (!typeId || typeId === 'all') {
      return [...(this.dashboardData.stock_by_antenna || [])];
    }
    const thresholdMap = new Map((this.dashboardData.antenna_options || []).map((a) => [a.id, a.low_stock_threshold]));
    const map = new Map();
    (this.dashboardData.stock_snapshot || []).forEach((item) => {
      if (item.garment_type_id !== typeId) return;
      if (!map.has(item.antenna_id)) {
        map.set(item.antenna_id, { id: item.antenna_id, name: item.antenna, total_qty: 0 });
      }
      map.get(item.antenna_id).total_qty += item.quantity || 0;
    });
    return Array.from(map.values()).map((row) => {
      const thr = thresholdMap.get(row.id);
      return {
        ...row,
        threshold: thr,
        is_below_threshold: typeof thr === 'number' ? row.total_qty <= thr : false,
      };
    }).sort((a, b) => b.total_qty - a.total_qty);
  },
  drawDashboard() {
    const el = this.qs('#dashboard');
    if (!el) return;
    const data = this.dashboardData;
    if (!data) {
      el.innerHTML = `<div class="card"><p class="alert">Aucune donnée disponible</p></div>`;
      return;
    }
    const state = this.dashboardState || {};
    const selectedType = state.selectedType === 'all' ? null : Number(state.selectedType);
    const selectedAntenna = state.selectedAntenna === 'all' ? null : Number(state.selectedAntenna);
    const lowOnly = !!state.lowOnly;
    const antennaOptions = data.antenna_options || [];
    const typeOptions = data.type_options || [];

    const antennaStats = this.aggregateStockByAntenna(selectedType || 'all').filter((row) => !lowOnly || row.is_below_threshold);
    const typeStats = this.aggregateStockByType(selectedAntenna || 'all');
    const maxAntennaQty = Math.max(1, ...antennaStats.map((r) => r.total_qty || 0));
    const maxTypeQty = Math.max(1, ...typeStats.map((r) => r.total_qty || 0));

    const lowStockItems = (data.low_stock_items || []).filter((item) => {
      if (selectedAntenna && item.antenna_id !== selectedAntenna) return false;
      if (selectedType && item.garment_type_id !== selectedType) return false;
      return true;
    });

    const overdueDays = Math.max(1, Number(state.overdueDays) || (data.overdue_default || 30));
    const now = new Date();
    const openLoansWithAge = (data.open_loans || []).map((l) => ({
      ...l,
      days: this.daysBetween(new Date(l.since), now),
    })).sort((a, b) => b.days - a.days);
    const overdueLoans = openLoansWithAge.filter((l) => l.days >= overdueDays);
    const topOpenLoans = openLoansWithAge.slice(0, 6);

    const activity = data.loan_activity || [];
    const maxActivity = Math.max(1, ...activity.map((a) => Math.max(a.created || 0, a.returned || 0)));
    const activityBars = activity.map((item) => {
      const createdHeight = Math.round(((item.created || 0) / maxActivity) * 100);
      const returnedHeight = Math.round(((item.returned || 0) / maxActivity) * 100);
      return `<div class="chart-column"><div class="chart-pair"><span class="chart-bar" style="height:${createdHeight}%"></span><span class="chart-bar chart-bar-returned" style="height:${returnedHeight}%"></span></div><span class="chart-label">${item.label}</span><small>${item.created || 0} sortis • ${item.returned || 0} rendus</small></div>`;
    }).join('');

    const lowAntennaCount = (data.stock_by_antenna || []).filter((a) => a.is_below_threshold).length;
    const loansThisMonth = activity.slice(-1)[0]?.created || 0;

    const antennaOptionsHTML = ['<option value="all">Toutes les antennes</option>']
      .concat(antennaOptions.map((a) => `<option value="${a.id}">${a.name}</option>`)).join('');
    const typeOptionsHTML = ['<option value="all">Tous les types</option>']
      .concat(typeOptions.map((t) => `<option value="${t.id}">${t.label}</option>`)).join('');

    const antennaRowsHTML = antennaStats.length ? antennaStats.map((row) => `
      <div class="stat-row">
        <div class="stat-row-head">
          <span>${row.name}</span>
          <span class="muted">${this.formatNumber(row.total_qty)} pièces</span>
        </div>
        <div class="progress ${row.is_below_threshold ? 'warning' : ''}"><span style="width:${Math.round(((row.total_qty || 0) / maxAntennaQty) * 100)}%"></span></div>
        ${typeof row.threshold === 'number' ? `<small class="muted">Seuil ${row.threshold}</small>` : ''}
      </div>`).join('') : '<p class="muted">Aucune donnée disponible avec ces filtres.</p>';

    const typeRowsHTML = typeStats.length ? typeStats.map((row) => `
      <div class="stat-row">
        <div class="stat-row-head">
          <span>${row.label}</span>
          <span class="muted">${this.formatNumber(row.total_qty)}</span>
        </div>
        <div class="progress"><span style="width:${Math.round(((row.total_qty || 0) / maxTypeQty) * 100)}%"></span></div>
      </div>`).join('') : '<p class="muted">Aucun type trouvé.</p>';

    const lowStockHTML = lowStockItems.length ? `
      <table class="table"><thead><tr><th>Article</th><th>Antenne</th><th>Qté</th></tr></thead><tbody>
        ${lowStockItems.map((item) => `<tr><td>${item.garment_type} ${item.size || ''}</td><td>${item.antenna}</td><td><span class="badge badge-danger">${item.quantity}</span></td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">Aucun article sous le seuil avec les filtres actuels.</p>';

    const overdueHTML = overdueLoans.length ? `
      <table class="table"><thead><tr><th>Bénévole</th><th>Article</th><th>Jours</th><th></th></tr></thead><tbody>
        ${overdueLoans.slice(0, 6).map((loan) => `<tr><td>${loan.volunteer}</td><td>${loan.type} ${loan.size || ''}</td><td><span class="badge badge-danger">${loan.days}</span></td><td><button class="btn btn-ghost" onclick="App.returnLoan(${loan.id})">Rendu</button></td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">Aucun prêt en retard au-delà du seuil.</p>';

    const openHTML = topOpenLoans.length ? `
      <table class="table"><thead><tr><th>Bénévole</th><th>Article</th><th>Jours</th></tr></thead><tbody>
        ${topOpenLoans.map((loan) => `<tr><td>${loan.volunteer}</td><td>${loan.type} ${loan.size || ''}</td><td>${loan.days}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">Aucun prêt en cours.</p>';

    const recentLoansHTML = (data.recent_loans || []).length ? `
      <table class="table"><thead><tr><th>Bénévole</th><th>Article</th><th>Qté</th><th>Statut</th></tr></thead><tbody>
        ${(data.recent_loans || []).map((loan) => `<tr><td>${loan.volunteer}</td><td>${loan.type} ${loan.size || ''}</td><td>${loan.qty}</td><td>${loan.returned_at ? '<span class="badge badge-green">Rendu</span>' : '<span class="badge">En cours</span>'}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">Aucun mouvement récent.</p>';

    const recentLogsHTML = (data.recent_logs || []).length ? `
      <table class="table"><thead><tr><th>Date</th><th>Acteur</th><th>Action</th></tr></thead><tbody>
        ${(data.recent_logs || []).map((log) => `<tr><td>${this.formatDateTime(log.at)}</td><td>${log.actor || '—'}</td><td>${log.action} ${log.entity ? '(' + log.entity + (log.entity_id ? '#' + log.entity_id : '') + ')' : ''}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">Aucun journal récent.</p>';

    el.innerHTML = `
      <div class="dashboard-grid">
        <div class="kpi-card">
          <span class="kpi-label">Articles en stock</span>
          <span class="kpi-value">${this.formatNumber(data.stock_total)}</span>
          <span class="kpi-sub">${this.formatNumber(data.types)} types suivis</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">Prêts ouverts</span>
          <span class="kpi-value">${this.formatNumber(data.prets_ouverts)}</span>
          <span class="kpi-sub">${this.formatNumber(loansThisMonth)} sorties ce mois</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">Bénévoles actifs</span>
          <span class="kpi-value">${this.formatNumber(data.active_volunteers)}</span>
          <span class="kpi-sub">${this.formatNumber(data.benevoles)} bénévoles enregistrés</span>
        </div>
        <div class="kpi-card">
          <span class="kpi-label">Antennes</span>
          <span class="kpi-value">${this.formatNumber(data.antennas)}</span>
          <span class="kpi-sub">${lowAntennaCount} antennes sous le seuil</span>
        </div>
      </div>

      <div class="dashboard-columns">
        <div class="card">
          <div class="chips dashboard-toolbar">
            <h3>Répartition par antenne</h3>
            <div class="chips">
              <select id="dashFilterType">${typeOptionsHTML}</select>
              <button class="btn btn-ghost" id="dashLowToggle"></button>
            </div>
          </div>
          ${antennaRowsHTML}
        </div>
        <div class="card">
          <div class="chips dashboard-toolbar">
            <h3>Répartition par type</h3>
            <select id="dashFilterAntenna">${antennaOptionsHTML}</select>
          </div>
          ${typeRowsHTML}
        </div>
      </div>

      <div class="dashboard-columns">
        <div class="card">
          <div class="chips" style="justify-content:space-between">
            <h3>Activité prêts (6 mois)</h3>
            <button class="btn btn-ghost" id="dashRefresh">↻ Actualiser</button>
          </div>
          ${activityBars ? `<div class="chart-bars">${activityBars}</div>` : '<p class="muted">Pas encore de données.</p>'}
        </div>
        <div class="card">
          <div class="chips" style="justify-content:space-between">
            <h3>Articles sous le seuil</h3>
            <button class="btn btn-ghost" id="dashResetFilters">Réinitialiser les filtres</button>
          </div>
          ${lowStockHTML}
        </div>
      </div>

      <div class="dashboard-columns">
        <div class="card">
          <div class="chips" style="justify-content:space-between">
            <h3>Prêts à relancer</h3>
            <label class="muted">Seuil <input id="dashOverdueInput" class="input input-inline" type="number" min="1" value="${overdueDays}"> jours</label>
          </div>
          ${overdueHTML}
          <div class="mt">
            <h4>Prêts les plus anciens</h4>
            ${openHTML}
          </div>
        </div>
        <div class="card">
          <h3>Mouvements récents</h3>
          ${recentLoansHTML}
          <div class="mt">
            <h4>Derniers journaux</h4>
            ${recentLogsHTML}
          </div>
        </div>
      </div>
    `;

    const typeSelect = this.qs('#dashFilterType');
    if (typeSelect) {
      typeSelect.value = state.selectedType || 'all';
      typeSelect.onchange = (ev) => {
        this.dashboardState.selectedType = ev.target.value || 'all';
        this.drawDashboard();
      };
    }
    const antennaSelect = this.qs('#dashFilterAntenna');
    if (antennaSelect) {
      antennaSelect.value = state.selectedAntenna || 'all';
      antennaSelect.onchange = (ev) => {
        this.dashboardState.selectedAntenna = ev.target.value || 'all';
        this.drawDashboard();
      };
    }
    const lowToggle = this.qs('#dashLowToggle');
    if (lowToggle) {
      lowToggle.textContent = lowOnly ? 'Afficher toutes les antennes' : 'Filtrer antennes sous seuil';
      lowToggle.onclick = () => {
        this.dashboardState.lowOnly = !this.dashboardState.lowOnly;
        this.setSetting('dash_low_only', this.dashboardState.lowOnly);
        this.drawDashboard();
      };
    }
    const overdueInput = this.qs('#dashOverdueInput');
    if (overdueInput) {
      overdueInput.onchange = (ev) => {
        const val = Math.max(1, parseInt(ev.target.value, 10) || overdueDays);
        this.dashboardState.overdueDays = val;
        this.setSetting('overdue_days', val);
        this.drawDashboard();
      };
    }
    const resetBtn = this.qs('#dashResetFilters');
    if (resetBtn) {
      resetBtn.onclick = () => {
        this.dashboardState.selectedType = 'all';
        this.dashboardState.selectedAntenna = 'all';
        this.drawDashboard();
      };
    }
    const refreshBtn = this.qs('#dashRefresh');
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        this.renderDashboard();
      };
    }
  },

  // ------------------------------ Antennes ------------------------------
  async renderAntennes(){ const el=this.qs('#antennes'); const ants=await this.fetchJSON('/api/antennas'); el.innerHTML=`<div class="card">
    <div class="chips" style="justify-content:space-between"><h2>Antennes</h2><button class="btn btn-primary" onclick="App.modalAddAntenna()">+ Antenne</button></div>
    <table class="table"><thead><tr><th>Nom</th><th>Adresse</th><th>Seuil alerte</th><th></th></tr></thead><tbody>
      ${ants.map(a=>`<tr><td>${a.name}</td><td class="muted">${a.address||''}</td>
      <td style="max-width:140px"><input class="input" type="number" min="0" value="${typeof a.low_stock_threshold==='number'?a.low_stock_threshold:''}" onblur="App.saveAntennaThreshold(${a.id}, this.value)"></td>
      <td class="chips"><button class="btn btn-ghost" onclick='App.modalEditAntenna(${a.id}, ${JSON.stringify(a).replaceAll("'","&apos;")})'>Modifier</button>
      <button class="btn btn-ghost" onclick='App.deleteAntenna(${a.id})'>Supprimer</button></td></tr>`).join('')}
    </tbody></table></div>`; },
  modalAddAntenna(){ this.openModal('Nouvelle antenne', `<div class="grid-3"><input id="ant_name" class="input" placeholder="Nom"><input id="ant_addr" class="input" placeholder="Adresse"><input id="ant_thr" class="input" type="number" min="0" placeholder="Seuil alerte (ex: 5)"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.saveAntenna()">Enregistrer</button></div>`); },
  async saveAntenna(){ const name=this.qs('#ant_name').value.trim(); const address=this.qs('#ant_addr').value.trim(); const thr=this.qs('#ant_thr').value ? Number(this.qs('#ant_thr').value) : null; if(!name) return this.flash('Nom requis',false); const body={name,address}; if(thr!==null) body.low_stock_threshold=thr; await this.fetchJSON('/api/antennas',{method:'POST', body: JSON.stringify(body)}); this.closeModal(); this.renderAntennes(); this.flash('Antenne créée'); },
  modalEditAntenna(id,a){ this.openModal('Modifier antenne', `<div class="grid-3"><input id="e_ant_name" class="input" value="${a.name}"><input id="e_ant_addr" class="input" value="${a.address||''}"><input id="e_ant_thr" class="input" type="number" min="0" value="${typeof a.low_stock_threshold==='number'?a.low_stock_threshold:''}"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.updateAntenna(${id})">Enregistrer</button></div>`); },
  async updateAntenna(id){ const name=this.qs('#e_ant_name').value.trim(); const address=this.qs('#e_ant_addr').value.trim(); const thr=this.qs('#e_ant_thr').value ? Number(this.qs('#e_ant_thr').value) : null; const body={name,address}; if(thr!==null) body.low_stock_threshold=thr; await this.fetchJSON('/api/antennas/'+id,{method:'PUT', body: JSON.stringify(body)}); this.closeModal(); this.renderAntennes(); this.flash('Antenne mise à jour'); },
  async saveAntennaThreshold(id,val){ const thr = val==='' ? null : Math.max(0, Number(val)||0); const body={}; if(thr!==null) body.low_stock_threshold=thr; await this.fetchJSON('/api/antennas/'+id,{method:'PUT', body: JSON.stringify(body)}); this.flash('Seuil mis à jour'); },
  async deleteAntenna(id){ if(!confirm('Supprimer cette antenne ?')) return; try{ await this.fetchJSON('/api/antennas/'+id,{method:'DELETE'}); this.renderAntennes(); this.flash('Antenne supprimée'); } catch(e){ this.flash(e.message||'Suppression impossible'); } },

  // ------------------------------ Stock (CRUD + tags) ------------------------------
  async renderStock(){ const el=this.qs('#stock'); const [types, ants]=await Promise.all([this.fetchJSON('/api/types'), this.fetchJSON('/api/antennas')]); this._types=types; this._ants=ants;
    const optType=(v)=>['<option value="">Type</option>'].concat(types.map(t=>`<option value="${t.id}" ${v==t.id?'selected':''}>${t.label}</option>`)).join('');
    const optAnt=(v)=>['<option value="">Antenne</option>'].concat(ants.map(a=>`<option value="${a.id}" ${v==a.id?'selected':''}>${a.name}</option>`)).join('');
    el.innerHTML=`<div class="card">
      <div class="chips" style="justify-content:space-between"><h2>Stock</h2>
        <div class="chips">
          <button class="btn btn-export" onclick="App.exportStockCSV()">⭳ Export CSV</button>
          <button class="btn btn-ghost" onclick="App.modalAddType()">+ Type</button>
          <button class="btn btn-primary" onclick="App.modalAddStock()">+ Article</button>
        </div>
      </div>
      <div class="grid-3 mt"><select id="f_type">${optType('')}</select><select id="f_ant">${optAnt('')}</select><button class="btn btn-ghost" onclick="App.loadStock()">Filtrer</button></div>
      <div id="stockTable" class="mt"></div>
    </div>`;
    this._optType=optType; this._optAnt=optAnt; await this.loadStock(); },
  async loadStock(){ const t=this.qs('#f_type')?.value||''; const a=this.qs('#f_ant')?.value||''; const qs=[]; if(t) qs.push(`type_id=${t}`); if(a) qs.push(`antenna_id=${a}`); const stock=await this.fetchJSON('/api/stock'+(qs.length?`?${qs.join('&')}`:'')); this.qs('#stockTable').innerHTML=`<table class="table"><thead><tr><th>Type</th><th>Taille</th><th>Antenne</th><th>Qté</th><th>Tags</th><th></th></tr></thead><tbody>${stock.map(s=>`<tr><td>${s.garment_type}</td><td>${s.size||'—'}</td><td>${s.antenna}</td><td>${s.quantity}</td><td>${this.renderTagsInline(s.tags||[])}</td><td class="chips"><button class="btn btn-ghost" onclick='App.modalEditStock(${s.id}, ${JSON.stringify({id:s.id,type_id:s.garment_type_id,ant_id:s.antenna_id,size:s.size||"",qty:s.quantity,tags:s.tags||[]}).replaceAll("'","&apos;")})'>Modifier</button><button class="btn btn-ghost" onclick="App.deleteStock(${s.id})">Supprimer</button></td></tr>`).join('')}</tbody></table>`; },
  renderTagsInline(tags){ tags=Array.isArray(tags)? tags: String(tags||'').split(',').map(x=>x.trim()).filter(Boolean); if(!tags.length) return `<span class="muted">—</span>`; return `<div class="chips">${tags.map(t=>`<span class="badge">${t}</span>`).join('')}</div>`; },
  modalAddType(){ this.openModal('Ajouter un type', `<div class="grid-2"><input id="new_type" class="input" placeholder="Libellé (ex: Parka)"><label><input id="new_has_size" type="checkbox" checked> Avec taille</label></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.saveType()">Enregistrer</button></div><div class="mt"><button class="btn btn-ghost" onclick="App.manageTypes()">Gérer / Supprimer</button></div>`); },
  async manageTypes(){ const types=await this.fetchJSON('/api/types'); const body=`<div style="max-height:60vh;overflow:auto;"><table class="table"><thead><tr><th>Type</th><th>Taille ?</th><th></th></tr></thead><tbody>${types.map(t=>`<tr><td>${t.label}</td><td>${t.has_size?'Oui':'Non'}</td><td><button class="btn btn-ghost" onclick="App.deleteType(${t.id})">Supprimer</button></td></tr>`).join('')}</tbody></table></div>`; this.openModal('Types existants', body); },
  async deleteType(id){ if(!confirm('Supprimer ce type ?\n(Refusé s’il existe du stock)')) return; try{ await this.fetchJSON('/api/types/'+id,{method:'DELETE'}); this.flash('Type supprimé'); this.closeModal(); this.renderStock(); } catch(e){ this.flash(e.message||'Suppression refusée'); } },
  async saveType(){ const label=this.qs('#new_type').value.trim(); const has_size=this.qs('#new_has_size').checked; if(!label) return this.flash('Libellé requis',false); try{ await this.fetchJSON('/api/types',{method:'POST', body: JSON.stringify({label,has_size})}); this.closeModal(); this.renderStock(); this.flash('Type ajouté'); }catch(e){ this.flash(e.message||'Création refusée'); }},
  modalAddStock(){ this.openModal('Ajouter au stock', `<div class="grid-4"><select id="s_type">${this._optType('')}</select><select id="s_ant">${this._optAnt('')}</select><input id="s_size" class="input" placeholder="Taille (optionnel)"><input id="s_qty" class="input" type="number" value="1" min="1" placeholder="Quantité"></div><div class="mt"><input id="s_tags" class="input" placeholder="Tags séparés par des virgules (ex: Hiver, EPS)"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.saveStock()">Enregistrer</button></div>`); },
  async saveStock(){ const t=Number(this.qs('#s_type').value); const a=Number(this.qs('#s_ant').value); const size=this.qs('#s_size').value.trim()||null; const qty=Number(this.qs('#s_qty').value||0); const tags=this.qs('#s_tags').value.split(',').map(x=>x.trim()).filter(Boolean); if(!t||!a||qty<=0) return this.flash('Type, antenne et quantité requis',false); try{ await this.fetchJSON('/api/stock',{method:'POST', body: JSON.stringify({garment_type_id:t, antenna_id:a, size, quantity:qty, tags})}); this.closeModal(); this.loadStock(); this.flash('Stock ajouté'); }catch(e){ this.flash(e.message||'Erreur ajout stock'); } },
  modalEditStock(id,s){ this.openModal('Modifier un article de stock', `<div class="grid-4"><select id="es_type">${this._optType(s.type_id)}</select><select id="es_ant">${this._optAnt(s.ant_id)}</select><input id="es_size" class="input" value="${s.size||''}" placeholder="Taille"><input id="es_qty" class="input" type="number" value="${s.qty}" min="0"></div><div class="mt"><input id="es_tags" class="input" value="${(s.tags||[]).join(', ')}" placeholder="Tags séparés par des virgules"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.saveEditStock(${id})">Enregistrer</button></div>`); },
  async saveEditStock(id){ const body={ garment_type_id:Number(this.qs('#es_type').value), antenna_id:Number(this.qs('#es_ant').value), size:this.qs('#es_size').value.trim()||null, quantity:Number(this.qs('#es_qty').value||0), tags:this.qs('#es_tags').value.split(',').map(x=>x.trim()).filter(Boolean) }; try{ await this.fetchJSON('/api/stock/'+id,{method:'PUT', body: JSON.stringify(body)}); this.closeModal(); this.loadStock(); this.flash('Article mis à jour'); }catch(e){ this.flash(e.message||'Mise à jour refusée'); } },
  async deleteStock(id){
    if(!confirm('Supprimer cet article ?')) return;
    try{
      const res = await this.fetchJSON('/api/stock/'+id,{method:'DELETE'});
      await this.loadStock();
      const removed = res && typeof res.removed_loans === 'number' ? res.removed_loans : 0;
      const msg = removed > 0 ? `Article supprimé (${removed} prêt(s) associé(s) clos)` : 'Article supprimé';
      this.flash(msg);
      if(this.dashboardData){ this.renderDashboard(); }
    } catch(e){
      this.flash(e.message||'Suppression impossible');
    }
  },

  async exportStockCSV(){
    const t=this.qs('#f_type')?.value||'';
    const a=this.qs('#f_ant')?.value||'';
    const params=new URLSearchParams();
    if(t) params.set('type_id', t);
    if(a) params.set('antenna_id', a);
    const url='/api/stock/export'+(params.toString()?`?${params.toString()}`:'');
    try{
      const res=await fetch(url);
      if(!res.ok) throw new Error('Export impossible');
      const blob=await res.blob();
      const link=document.createElement('a');
      const stamp=new Date();
      link.href=URL.createObjectURL(blob);
      link.download=`stock_protection_civile_${stamp.toISOString().slice(0,10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(()=>URL.revokeObjectURL(link.href), 1200);
      this.flash('Export CSV généré');
    }catch(e){
      console.error(e);
      this.flash(e.message||'Export impossible');
    }
  },

  // ------------------------------ Bénévoles (CRUD + recherche + import) ------------------------------
  _volLocal: [],
  async renderBenevoles(){ const el=this.qs('#benevoles'); const data=await this.fetchJSON('/api/volunteers'); this._volLocal=data;
    el.innerHTML=`<div class="card">
      <div class="chips" style="justify-content:space-between">
        <h2>Bénévoles</h2>
        <div class="chips">
          <input id="volSearch" class="input" placeholder="Rechercher (nom, prénom, note)" style="min-width:260px">
          <a class="btn btn-ghost" href="/api/volunteers/template.csv">⬇️ Modèle CSV</a>
          <a class="btn btn-ghost" href="/api/volunteers/export.csv">⬇️ Export CSV</a>
          <input id="volImportFile" type="file" accept=".csv" style="display:none">
          <button class="btn btn-ghost" onclick="document.getElementById('volImportFile').click()">Importer CSV</button>
          <button class="btn btn-primary" onclick="App.modalAddVol()">+ Bénévole</button>
        </div>
      </div>
      <p class="muted">Les doublons nom+prénom sont ignorés à l'import.</p>
      <div id="volTable"></div>
    </div>`;
    this.drawVolTable(this._volLocal);
    const fileInput=document.getElementById('volImportFile'); fileInput.onchange=async()=>{ const file=fileInput.files[0]; if(!file) return; await this.importVolunteersCSV(file); fileInput.value=""; };
    const search=this.qs('#volSearch'); search.oninput=()=>{ const q=search.value.trim().toLowerCase(); if(!q) return this.drawVolTable(this._volLocal); const f=this._volLocal.filter(v=> (v.last_name||'').toLowerCase().includes(q) || (v.first_name||'').toLowerCase().includes(q) || (v.note||'').toLowerCase().includes(q) ); this.drawVolTable(f); };
  },
  drawVolTable(list){ this.qs('#volTable').innerHTML=`<table class="table"><thead><tr><th>Nom</th><th>Prénom</th><th>Notes</th><th></th></tr></thead><tbody>${(list||[]).map(v=>`<tr><td>${v.last_name}</td><td>${v.first_name}</td><td class="muted">${v.note||''}</td><td class="chips"><button class="btn btn-ghost" onclick='App.modalEditVol(${v.id}, ${JSON.stringify(v).replaceAll("'","&apos;")})'>Modifier</button><button class="btn btn-ghost" onclick='App.deleteVol(${v.id})'>Supprimer</button><button class="btn btn-ghost" onclick='App.viewVol(${v.id}, ${JSON.stringify(v).replaceAll("'","&apos;")})'>Voir</button></td></tr>`).join('')}</tbody></table>`; },
  modalAddVol(){ this.openModal('Nouveau bénévole', `<div class="grid-3"><input id="v_first" class="input" placeholder="Prénom"><input id="v_last" class="input" placeholder="Nom"><input id="v_note" class="input" placeholder="Infos"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.addVol()">Enregistrer</button></div>`); },
  async addVol(){ const first_name=this.qs('#v_first').value.trim(); const last_name=this.qs('#v_last').value.trim(); const note=this.qs('#v_note').value.trim(); if(!first_name||!last_name) return this.flash('Prénom et nom requis',false); try{ await this.fetchJSON('/api/volunteers',{method:'POST', body: JSON.stringify({first_name,last_name,note})}); this.closeModal(); this.renderBenevoles(); this.flash('Bénévole créé'); }catch(e){ this.flash(e.message||'Création refusée'); } },
  modalEditVol(id,v){ this.openModal('Modifier bénévole', `<div class="grid-3"><input id="e_first" class="input" value="${v.first_name}"><input id="e_last" class="input" value="${v.last_name}"><input id="e_note" class="input" value="${v.note||''}"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.saveEditVol(${id})">Enregistrer</button></div>`); },
  async saveEditVol(id){ const first_name=this.qs('#e_first').value.trim(), last_name=this.qs('#e_last').value.trim(), note=this.qs('#e_note').value.trim(); try{ await this.fetchJSON('/api/volunteers/'+id,{method:'PUT', body: JSON.stringify({first_name,last_name,note})}); this.closeModal(); this.renderBenevoles(); this.flash('Bénévole mis à jour'); }catch(e){ this.flash(e.message||'Mise à jour refusée'); } },
  async deleteVol(id){ if(!confirm('Supprimer ce bénévole ?')) return; try{ await this.fetchJSON('/api/volunteers/'+id,{method:'DELETE'}); await this.renderBenevoles(); this.flash('Bénévole supprimé'); } catch(e){ this.flash(e.message||'Suppression impossible'); } },
  async viewVol(id,v){ const loans=await this.fetchJSON(`/api/volunteers/${id}/loans`); const html=`<div class="grid-2"><div><div class="muted">Nom</div><div class="badge">${v.last_name}</div></div><div><div class="muted">Prénom</div><div class="badge">${v.first_name}</div></div></div><div class="mt"><div class="muted">Notes</div><div class="card" style="padding:.6rem;">${v.note||"<span class='muted'>Aucune note</span>"}</div></div><div class="mt"><h3>Prêts en cours</h3>${loans.length?`<table class="table"><thead><tr><th>Article</th><th>Qté</th><th>Depuis</th></tr></thead><tbody>${loans.map(l=>`<tr><td>${l.type} / ${l.size||'—'}</td><td>${l.qty}</td><td>${new Date(l.since).toLocaleString()}</td></tr>`).join('')}</tbody></table>`:'<p class="muted">Aucun prêt en cours</p>'}</div>`; this.openModal('Détails bénévole', html); },
  async importVolunteersCSV(file){ try{ const fd=new FormData(); fd.append('file', file, file.name); const res=await fetch('/api/volunteers/import',{method:'POST', body: fd}); const data=await res.json(); if(!res.ok) throw new Error((data&&(data.error||data.message))||'Import refusé'); this.flash(`Import: +${data.added} ajoutés, ${data.skipped} ignorés (${data.total} lignes)`); await this.renderBenevoles(); } catch(e){ this.flash(e.message||'Erreur import CSV'); } },

  // ------------------------------ Prêts ------------------------------
  async renderPrets(){
    const el=this.qs('#prets');
    if(!el) return;
    el.innerHTML=`<div class="card"><p class="muted">Chargement des prêts…</p></div>`;
    try{
      const loans=await this.fetchJSON('/api/loans/open');
      const rows=loans.length?loans.map(l=>`
            <tr>
              <td>${l.volunteer}</td>
              <td>${l.type} / ${l.size||'—'} @ ${l.antenna}</td>
              <td>${l.qty}</td>
              <td>${this.formatDateTime(l.since)}</td>
              <td><button class="btn btn-ghost" onclick="App.returnLoan(${l.id})">Marquer rendu</button></td>
            </tr>
          `).join(''):`<tr><td colspan="5" class="muted" style="text-align:center;padding:1.2rem 0;">Aucun prêt en cours</td></tr>`;
      el.innerHTML=`
        <div class="card">
          <div class="card-header">
            <h2>Prêts en cours</h2>
            <button class="btn btn-primary" onclick="App.showLoanHistory()">Historique des prêts</button>
          </div>
          <table class="table">
            <thead>
              <tr><th>Bénévole</th><th>Article</th><th>Qté</th><th>Depuis</th><th></th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }catch(e){
      el.innerHTML=`<div class="card"><p class="alert">${e.message||'Impossible de charger les prêts'}</p></div>`;
    }
  },
  async returnLoan(id){ try{ await this.fetchJSON('/api/loans/return/'+id,{method:'POST'}); this.renderPrets(); this.flash('Prêt rendu'); }catch(e){ this.flash(e.message||'Action refusée'); } },
  async showLoanHistory(){
    try{
      const history=await this.fetchJSON('/api/loans/history?limit=200');
      const rows=history.length?history.map(l=>`
            <tr>
              <td>${l.volunteer}</td>
              <td>${l.type} / ${l.size||'—'} @ ${l.antenna}</td>
              <td>${l.qty}</td>
              <td>${this.formatDateTime(l.created_at)}</td>
              <td>${l.returned_at?this.formatDateTime(l.returned_at):'<span class="badge badge-danger">En cours</span>'}</td>
              <td class="chips"><button class="btn btn-ghost" onclick="App.deleteLoan(${l.id})">Supprimer</button></td>
            </tr>
          `).join(''):`<tr><td colspan="6" class="muted" style="text-align:center;padding:1.2rem 0;">Aucun prêt trouvé</td></tr>`;
      const body=`
        <div style="max-height:60vh;overflow:auto;">
          <table class="table">
            <thead>
              <tr><th>Bénévole</th><th>Article</th><th>Qté</th><th>Emprunté le</th><th>Rendu le</th><th></th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
      this.openModal('Historique des prêts', body);
    }catch(e){
      this.openModal('Historique des prêts', `<p class="alert">${e.message||'Impossible de charger l\'historique des prêts'}</p>`);
    }
  },

  async deleteLoan(id){
    if(!confirm('Supprimer ce prêt ?')) return;
    try{
      await this.fetchJSON('/api/loans/'+id,{method:'DELETE'});
      this.flash('Prêt supprimé');
      this.renderPrets();
      this.showLoanHistory();
    }catch(e){
      this.flash(e.message||'Suppression refusée');
    }
  },

  // ------------------------------ Inventaire ------------------------------
  async renderInventaire(){ const el=this.qs('#inventaire'); const ants=await this.fetchJSON('/api/antennas'); el.innerHTML=`<div class="card"><h2>Inventaire / Audit</h2><div class="grid-2"><select id="inv_ant">${['<option value="">Choisir une antenne</option>'].concat(ants.map(a=>`<option value="${a.id}">${a.name}</option>`)).join('')}</select><button class="btn btn-primary" onclick="App.startInventory()">Démarrer</button></div><div id="invZone" class="mt"></div></div>`; },
  async startInventory(){ const ant=Number(this.qs('#inv_ant').value||0); if(!ant) return this.flash('Choisis une antenne'); const sess=await this.fetchJSON('/api/inventory/start',{method:'POST', body: JSON.stringify({antenna_id:ant})}); const items=await this.fetchJSON(`/api/inventory/${sess.id}/items`); const zone=this.qs('#invZone'); zone.innerHTML=`<div class="card"><div class="chips" style="justify-content:space-between"><h3>Session #${sess.id} — ${items.antenna}</h3><button class="btn btn-ghost" onclick="App.closeInventory(${sess.id})">Valider et clôturer</button></div><p class="muted">Tape la quantité physiquement comptée.</p><table class="table"><thead><tr><th>Article</th><th>Taille</th><th>Stock</th><th>Compté</th></tr></thead><tbody>${items.rows.map(r=>`<tr><td>${r.type}</td><td>${r.size||'—'}</td><td>${r.quantity}</td><td><input class="input" type="number" min="0" value="${r.quantity}" onblur="App.saveCount(${sess.id},${r.stock_item_id},this.value)"></td></tr>`).join('')}</tbody></table></div>`; },
  async saveCount(sid,stockId,val){ const counted=Math.max(0, Number(val||0)); try{ await this.fetchJSON(`/api/inventory/${sid}/count`,{method:'POST', body: JSON.stringify({stock_item_id:stockId, counted_qty:counted})}); this.flash('Comptage enregistré'); }catch(e){ this.flash(e.message||'Enregistrement refusé'); } },
  async closeInventory(sid){ try{ await this.fetchJSON(`/api/inventory/${sid}/close`,{method:'POST'}); this.flash('Inventaire clôturé ✅'); this.renderInventaire(); }catch(e){ this.flash(e.message||'Clôture refusée'); } },

  // ------------------------------ Administration ------------------------------
  async renderAdmin(){ const el=this.qs('#admin'); const users=await this.fetchJSON('/api/users'); const overdue=this.getSetting('overdue_days',30); const defThr=this.getSetting('default_threshold',5); el.innerHTML=`<div class="card"><div class="chips" style="justify-content:space-between"><h2>Administration</h2><div class="chips"><button class="btn btn-ghost" onclick="App.viewLogs()">Journaux</button><button class="btn btn-primary" onclick="App.modalAddUser()">+ Utilisateur</button></div></div><div class="grid-3 mt"><div><label class="muted">Jours avant retard</label><input id="set_overdue" class="input" type="number" min="1" value="${overdue}" onblur="App.saveAdminSettings()"></div><div><label class="muted">Seuil stock bas par défaut</label><input id="set_threshold" class="input" type="number" min="0" value="${defThr}" onblur="App.saveAdminSettings()"></div><div class="muted" style="display:flex;align-items:flex-end">Réglages locaux appliqués immédiatement.</div></div><h3 class="mt">Utilisateurs</h3><table class="table"><thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th></th></tr></thead><tbody>${users.map(u=>`<tr><td>${u.name}</td><td>${u.email}</td><td><span class="badge">${u.role}</span></td><td class="chips"><button class="btn btn-ghost" onclick='App.modalEditUser(${u.id}, ${JSON.stringify(u).replaceAll("'","&apos;")})'>Modifier</button><button class="btn btn-ghost" onclick='App.deleteUser(${u.id})'>Supprimer</button></td></tr>`).join('')}</tbody></table></div>`; },
  saveAdminSettings(){ const od=Math.max(1, Number(this.qs('#set_overdue').value)||30); const thr=Math.max(0, Number(this.qs('#set_threshold').value)||5); this.setSetting('overdue_days', od); this.setSetting('default_threshold', thr); this.flash('Réglages enregistrés'); },
  async viewLogs(){ const logs=await this.fetchJSON('/api/logs?limit=200'); this.openModal('Journaux récents', `<div style="max-height:55vh;overflow:auto"><table class="table"><thead><tr><th>Date</th><th>Acteur</th><th>Action</th><th>Cible</th><th>Détails</th></tr></thead><tbody>${logs.map(l=>`<tr><td>${new Date(l.at).toLocaleString()}</td><td>${l.actor||'public'}</td><td>${l.action}</td><td>${l.entity}#${l.entity_id||''}</td><td class="muted">${l.details||''}</td></tr>`).join('')}</tbody></table></div>`); },
  modalAddUser(){ this.openModal('Créer un utilisateur', `<div class="grid-3"><input id="u_name" class="input" placeholder="Nom"><input id="u_email" class="input" placeholder="Email"><input id="u_pass" class="input" type="password" placeholder="Mot de passe"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.addUser()">Enregistrer</button></div>`); },
  async addUser(){ const name=this.qs('#u_name').value.trim(), email=this.qs('#u_email').value.trim(), password=this.qs('#u_pass').value; if(!name||!email||!password) return this.flash('Tous les champs sont requis',false); try{ await this.fetchJSON('/api/users',{method:'POST', body: JSON.stringify({name,email,password,role:'admin'})}); this.closeModal(); this.renderAdmin(); this.flash('Compte admin créé'); } catch(e){ this.flash(e.message||'Création refusée'); } },
  modalEditUser(id,u){ this.openModal('Modifier utilisateur', `<div class="grid-3"><input id="eu_name" class="input" value="${u.name}"><input id="eu_role" class="input" value="${u.role}"><input id="eu_pass" class="input" type="password" placeholder="Nouveau mot de passe (optionnel)"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.saveUser(${id})">Enregistrer</button></div>`); },
  async saveUser(id){ const name=this.qs('#eu_name').value.trim(), role=this.qs('#eu_role').value.trim(), password=this.qs('#eu_pass').value; try{ await this.fetchJSON('/api/users/'+id,{method:'PUT', body: JSON.stringify({name,role,password})}); this.closeModal(); this.renderAdmin(); this.flash('Compte mis à jour'); }catch(e){ this.flash(e.message||'Mise à jour refusée'); } },
  async deleteUser(id){ if(!confirm('Supprimer ce compte ?')) return; try{ await this.fetchJSON('/api/users/'+id,{method:'DELETE'}); this.renderAdmin(); this.flash('Compte supprimé'); } catch(e){ this.flash(e.message||'Suppression refusée'); } },

  // ------------------------------ Public (QR antenne) + filtres ------------------------------
  async renderPretPublic(){
    const el=this.qs('#pretPublic');
    let antennaName='';
    if(this.publicAntennaId){
      try{
        const info=await this.fetchJSON(`/api/public/antenna/${this.publicAntennaId}`);
        antennaName=info.name||'';
      }catch{}
    }
    // Précharge les types pour l’antenne
    const types = await this.fetchJSON(`/api/public/types${this.publicAntennaId?`?antenna_id=${this.publicAntennaId}`:''}`);
    el.innerHTML = `
      <section class="public-hero">
        <div>
          <h1>Prêt public${antennaName?` <span class="badge">${antennaName}</span>`:''}</h1>
          <p>Gérez les prêts d'une antenne depuis une interface claire : recherchez un bénévole, consultez ses prêts en cours et choisissez immédiatement la tenue à lui attribuer.</p>
        </div>
        <div class="public-card">
          <div class="public-search-grid">
            <input id='pubFN' class='input' placeholder='Prénom'>
            <input id='pubLN' class='input' placeholder='Nom'>
            <button type="button" class='btn btn-primary' onclick='App.findVolPublic()'>Chercher</button>
          </div>
        </div>
      </section>
      <section class="public-layout">
        <div id="publicFilters" class="card public-card hidden">
          <h2>Filtrer le stock disponible</h2>
          <div class="public-filters-grid">
            <label class="field"><span>Type</span><select id="pubType"><option value="">Tous types</option>${types.map(t=>`<option value="${t.id}">${t.label}</option>`).join('')}</select></label>
            <label class="field"><span>Taille</span><select id="pubSize" disabled><option value="">Toutes tailles</option></select></label>
          </div>
          <div class="chips" style="justify-content:flex-end">
            <button type="button" class="btn btn-ghost" id="pubFilterBtn">Mettre à jour la liste</button>
          </div>
          <p class="helper-text">Le filtre s’applique au stock présenté pour le bénévole sélectionné.</p>
        </div>
        <div id='pubResult' class="card public-card">
          <div class="empty-state">
            <h3>Recherchez un bénévole</h3>
            <p>Saisissez un nom pour afficher ses prêts en cours et la disponibilité de l’antenne.</p>
          </div>
        </div>
      </section>`;

    const resultBox = this.qs('#pubResult');
    if (resultBox) delete resultBox.dataset.volId;
    const filterCard=this.qs('#publicFilters');
    const firstNameInput = this.qs('#pubFN');
    const lastNameInput = this.qs('#pubLN');
    const updatePublicFiltersVisibility = () => {
      if(!filterCard) return;
      const show = Boolean(firstNameInput?.value.trim()) && Boolean(lastNameInput?.value.trim());
      filterCard.classList.toggle('hidden', !show);
    };
    if(filterCard) filterCard.classList.add('hidden');
    if(firstNameInput) firstNameInput.addEventListener('input', updatePublicFiltersVisibility);
    if(lastNameInput) lastNameInput.addEventListener('input', updatePublicFiltersVisibility);
    updatePublicFiltersVisibility();

    // Gestion dynamique des tailles en fonction du type
    const typeSel = this.qs('#pubType');
    const sizeSel = this.qs('#pubSize');
    typeSel.onchange = async () => {
      const typeId = typeSel.value;
      if(!typeId){ sizeSel.innerHTML = `<option value="">Toutes tailles</option>`; sizeSel.disabled = true; return; }
      const sizes = await this.fetchJSON(`/api/public/sizes?type_id=${typeId}${this.publicAntennaId?`&antenna_id=${this.publicAntennaId}`:''}`);
      sizeSel.innerHTML = `<option value="">Toutes tailles</option>` + sizes.map(s=>`<option>${s}</option>`).join('');
      sizeSel.disabled = false;
    };

    // Bouton Filtrer : met à jour la liste du stock si un bénévole est déjà affiché
    this.qs('#pubFilterBtn').onclick = () => {
      const box = this.qs('#pubResult');
      if(box.dataset.volId){ // un bénévole est chargé
        this.reloadPublicStock(Number(box.dataset.volId));
      }else{
        this.flash('Cherche d’abord un bénévole.');
      }
    };
  },
  async findVolPublic(){
    const fn=this.qs('#pubFN').value; const ln=this.qs('#pubLN').value;
    try { const v=await this.fetchJSON(`/api/public/volunteer?first_name=${encodeURIComponent(fn)}&last_name=${encodeURIComponent(ln)}`); await this.showVolPublic(v); }
    catch {
      const box = this.qs('#pubResult');
      if (box) {
        delete box.dataset.volId;
        box.innerHTML = `<div class="empty-state"><h3>Bénévole non trouvé</h3><p>Vérifiez l’orthographe ou essayez avec un autre prénom/nom.</p></div>`;
      }
      const filters=this.qs('#publicFilters');
      if(filters){
        const fnFilled = Boolean(this.qs('#pubFN')?.value.trim());
        const lnFilled = Boolean(this.qs('#pubLN')?.value.trim());
        filters.classList.toggle('hidden', !(fnFilled && lnFilled));
      }
    }
  },
  async buildPublicStockQuery(){
    const typeId = this.qs('#pubType')?.value || '';
    const size = this.qs('#pubSize')?.value || '';
    const params = new URLSearchParams();
    if(this.publicAntennaId) params.set('antenna_id', this.publicAntennaId);
    if(typeId) params.set('type_id', typeId);
    if(size) params.set('size', size);
    return params.toString();
  },
  async reloadPublicStock(volId){
    const q = await this.buildPublicStockQuery();
    const stock = await this.fetchJSON(`/api/public/stock${q?`?${q}`:''}`);
    const loans = await this.fetchJSON(`/api/public/loans?volunteer_id=${volId}`);
    const elList = this.qs('#pubLists');
    const loansHTML = loans.length ? loans.map(l=>`
        <li>
          <div>
            <strong>${l.type} ${l.size||''}</strong>
            <small>Depuis le ${new Date(l.since).toLocaleDateString()}</small>
          </div>
          <button class='btn btn-ghost' onclick='App.returnLoanPublic(${l.id})'>Rendre</button>
        </li>`).join('') : `<li class="public-empty">Aucun prêt en cours</li>`;
    const stockHTML = stock.length ? stock.map(s=>`
        <li>
          <div>
            <strong>${s.type} ${s.size||''}</strong>
            <small>${s.quantity} en stock</small>
          </div>
          <button class='btn btn-primary' onclick='App.borrow(${volId},${s.id})'>Emprunter</button>
        </li>`).join('') : `<li class="public-empty">Aucun article correspondant</li>`;
    elList.innerHTML = `
      <div class="public-lists">
        <div>
          <h4>Prêts en cours</h4>
          <ul>${loansHTML}</ul>
        </div>
        <div>
          <h4>Stock disponible</h4>
          <ul>${stockHTML}</ul>
        </div>
      </div>
    `;
  },
  async showVolPublic(v){
    const el = this.qs('#pubResult');
    el.dataset.volId = v.id;
    el.innerHTML = `
      <div class="public-volunteer">
        <div>
          <h3>${v.first_name} ${v.last_name}</h3>
          <p class="helper-text">Sélectionnez une tenue ci-dessous pour enregistrer un prêt instantanément.</p>
        </div>
        <div id="pubLists"></div>
      </div>`;
    const filters=this.qs('#publicFilters');
    if(filters) filters.classList.remove('hidden');
    await this.reloadPublicStock(v.id);
  },
  async borrow(volId, stockId){ try{ await this.fetchJSON('/api/public/loan',{method:'POST', body: JSON.stringify({volunteer_id:volId, stock_item_id:stockId, qty:1})}); this.flash('Tenue empruntée'); await this.reloadPublicStock(volId); }catch(e){ this.flash(e.message||'Emprunt refusé'); } },
  async returnLoanPublic(id){ try{ await this.fetchJSON('/api/public/return/'+id,{method:'POST'}); this.flash('Tenue rendue'); const box=this.qs('#pubResult'); if(box.dataset.volId){ await this.reloadPublicStock(Number(box.dataset.volId)); } }catch(e){ this.flash(e.message||'Retour refusé'); } },
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
