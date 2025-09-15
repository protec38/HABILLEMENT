/* static/app.js — FULL */

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

  /* ------------------------------- Utils ------------------------------- */
  getCookie(name) {
    const m = document.cookie.match(new RegExp('(^|; )' + name.replace(/([.$?*|{}()\\[\\]\\\\\\/\\+^])/g, '\\$1') + '=([^;]*)'));
    return m ? decodeURIComponent(m[2]) : null;
  },
  qs: (s, r = document) => r.querySelector(s),
  qsa: (s, r = document) => [...r.querySelectorAll(s)],

  async fetchJSON(url, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    const csrf = this.getCookie("XSRF-TOKEN");
    if (csrf) headers["X-CSRFToken"] = csrf;
    const res = await fetch(url, { credentials: "include", ...opts, headers });
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

  /* ------------------------------ Modal ------------------------------ */
  openModal(title, html, onOpen) {
    this.qs("#modalTitle").textContent = title;
    this.qs("#modalBody").innerHTML = html;
    const m = this.qs("#modal");
    m.style.display = "flex";
    m.classList.remove("hidden");
    if (typeof onOpen === "function") onOpen();
  },
  closeModal() {
    const m = this.qs("#modal");
    m.style.display = "none";
    m.classList.add("hidden");
    this.qs("#modalBody").innerHTML = "";
  },

  /* ------------------------------ Nav / Login ------------------------------ */
  show(id) {
    this.qsa(".screen").forEach((e) => e.classList.add("hidden"));
    this.qs("#" + id)?.classList.remove("hidden");
    this.qsa(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.id === id));
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
      lo.onclick = async (e) => { e.preventDefault(); try { await this.fetchJSON("/api/logout", { method: "POST" }); } catch {} this.user = null; location.href = "/"; };
      frag.appendChild(lo);
    }
    el.appendChild(frag);
  },
  async init() {
    const m = location.pathname.match(/^\/a\/(\d+)/);
    if (m) this.publicAntennaId = Number(m[1]);
    if (this.publicAntennaId) { // page publique
      this.qs("#loginView").classList.add("hidden");
      this.renderNav(); this.show("pretPublic"); return;
    }
    try {
      const me = await this.fetchJSON("/api/me");
      if (me.ok) { this.user = me.user; this.renderNav(); this.qs("#loginView").classList.add("hidden"); this.show("dashboard"); return; }
    } catch {}
    this.renderNav(); this.qs("#loginView").classList.remove("hidden");
  },
  async login() {
    const btn = this.qs("#loginBtn");
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

  /* ------------------------------ Dashboard ------------------------------ */
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
  async returnLoan(id){
    try{ await this.fetchJSON(`/api/loans/return/${id}`,{method:"POST"}); this.flash("Prêt clôturé"); this.renderDashboard(); this.renderPrets(); }catch(e){ this.flash(e.message); }
  },

  /* ------------------------------ Antennes ------------------------------ */
  async renderAntennes(){
    const el=this.qs('#antennes');
    const ants=await this.fetchJSON('/api/antennas').catch(()=>[]);
    el.innerHTML=`
      <div class="card">
        <div class="chips" style="justify-content:space-between">
          <h2>Antennes</h2>
          <button class="btn btn-primary" id="btnAddAnt">+ Antenne</button>
        </div>
        <table class="table">
          <thead><tr><th>Nom</th><th>Adresse</th><th>Seuil stock bas</th><th></th></tr></thead>
          <tbody>
            ${ants.map(a=>`<tr>
              <td>${a.name}</td>
              <td>${a.address||''}</td>
              <td>${a.low_stock_threshold ?? ''}</td>
              <td><button class="btn btn-ghost" onclick="App.editAntenna(${a.id}, '${(a.name||'').replace(/'/g,"&#39;")}', '${(a.address||'').replace(/'/g,"&#39;")}', ${a.low_stock_threshold??'null'})">Modifier</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    this.qs('#btnAddAnt').onclick=()=>this.editAntenna(null,'','',null);
  },
  editAntenna(id,name,address,th){
    this.openModal(id?'Modifier antenne':'Nouvelle antenne', `
      <div class="grid-3">
        <input id="antName" class="input" placeholder="Nom" value="${name||''}">
        <input id="antAddr" class="input" placeholder="Adresse" value="${address||''}">
        <input id="antTh" type="number" class="input" placeholder="Seuil stock bas" value="${th??''}">
      </div>
      <div class="mt"><button class="btn btn-primary" id="saveAnt">Enregistrer</button></div>
    `, ()=>{
      this.qs('#saveAnt').onclick=async()=>{
        const body={name:this.qs('#antName').value.trim(), address:this.qs('#antAddr').value.trim()};
        const v=this.qs('#antTh').value; if(v!=='') body.low_stock_threshold=Number(v);
        try{
          if(id){ await this.fetchJSON(`/api/antennas/${id}`,{method:'PUT', body:JSON.stringify(body)}); }
          else{ await this.fetchJSON(`/api/antennas`,{method:'POST', body:JSON.stringify(body)}); }
          this.closeModal(); this.renderAntennes(); this.flash('Sauvegardé');
        }catch(e){ this.flash(e.message); }
      };
    });
  },

  /* ------------------------------ Stock ------------------------------ */
  async renderStock(){
    const [types,ants]=await Promise.all([this.fetchJSON('/api/types').catch(()=>[]), this.fetchJSON('/api/antennas').catch(()=>[])]);
    const el=this.qs('#stock');
    const optType=(v)=>['<option value="">Type</option>'].concat(types.map(t=>`<option value="${t.id}" ${v==t.id?'selected':''}>${t.label}</option>`)).join('');
    const optAnt=(v)=>['<option value="">Antenne</option>'].concat(ants.map(a=>`<option value="${a.id}" ${v==a.id?'selected':''}>${a.name}</option>`)).join('');
    el.innerHTML=`<div class="card">
      <div class="chips" style="justify-content:space-between"><h2>Stock</h2>
        <div class="chips">
          <a class="btn btn-ghost" href="/api/stock/export.csv">⬇️ Export CSV</a>
          <button class="btn btn-ghost" id="btnAddType">+ Type</button>
          <button class="btn btn-primary" id="btnAddStock">+ Article</button>
        </div>
      </div>
      <div class="grid-3 mt">
        <select id="f_type">${optType('')}</select>
        <select id="f_ant">${optAnt('')}</select>
        <button class="btn btn-ghost" id="btnFilter">Filtrer</button>
      </div>
      <div id="stockTable" class="mt"></div>
    </div>`;
    this.qs('#btnFilter').onclick=()=>this.loadStock();
    this.qs('#btnAddStock').onclick=()=>this.editStock(null, {garment_type_id:'', antenna_id:'', size:'', quantity:0, tags:''}, types, ants);
    this.qs('#btnAddType').onclick=()=>this.addType();
    await this.loadStock();
  },
  async loadStock(){
    const t=this.qs('#f_type')?.value || '';
    const a=this.qs('#f_ant')?.value || '';
    const params = new URLSearchParams();
    if(t) params.set('type_id', t);
    if(a) params.set('antenna_id', a);
    const stock=await this.fetchJSON('/api/stock'+(params.toString()?`?${params.toString()}`:'' )).catch(()=>[]);
    const el=this.qs('#stockTable');
    if(!stock.length){ el.innerHTML='<p class="muted">Aucun article.</p>'; return; }
    el.innerHTML=`<table class="table">
      <thead><tr><th>Antenne</th><th>Type</th><th>Taille</th><th>Qté</th><th>Tags</th><th></th></tr></thead>
      <tbody>
        ${stock.map(s=>`<tr>
          <td>${s.antenna}</td>
          <td>${s.garment_type}</td>
          <td>${s.size||''}</td>
          <td>${s.quantity}</td>
          <td>${s.tags||''}</td>
          <td>
            <button class="btn btn-ghost" onclick='App.editStock(${s.id}, ${JSON.stringify(s)}, null, null)'>Modifier</button>
            <button class="btn btn-ghost" onclick='App.deleteStock(${s.id})'>Supprimer</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  },
  editStock(id,data,types,ants){
    const loadMeta = async()=>({
      types: types || await this.fetchJSON('/api/types'),
      ants: ants || await this.fetchJSON('/api/antennas')
    });
    loadMeta().then(meta=>{
      const optType=(v)=>meta.types.map(t=>`<option value="${t.id}" ${String(v)==String(t.id)?'selected':''}>${t.label}</option>`).join('');
      const optAnt=(v)=>meta.ants.map(a=>`<option value="${a.id}" ${String(v)==String(a.id)?'selected':''}>${a.name}</option>`).join('');
      this.openModal(id?'Modifier article':'Nouvel article', `
        <div class="grid-4">
          <label>Type<select id="stType">${optType(data.garment_type_id||'')}</select></label>
          <label>Antenne<select id="stAnt">${optAnt(data.antenna_id||'')}</select></label>
          <input id="stSize" class="input" placeholder="Taille" value="${data.size||''}">
          <input id="stQty" class="input" type="number" placeholder="Quantité" value="${data.quantity||0}">
        </div>
        <div class="mt"><input id="stTags" class="input" placeholder="Tags (séparés par des virgules)" value="${data.tags||''}"></div>
        <div class="mt"><button id="saveStock" class="btn btn-primary">Enregistrer</button></div>
      `, ()=>{
        this.qs('#saveStock').onclick=async()=>{
          const body={
            garment_type_id:Number(this.qs('#stType').value),
            antenna_id:Number(this.qs('#stAnt').value),
            size:this.qs('#stSize').value.trim()||null,
            quantity:Number(this.qs('#stQty').value || 0),
            tags:this.qs('#stTags').value.trim()
          };
          try{
            if(id) await this.fetchJSON(`/api/stock/${id}`, {method:'PUT', body:JSON.stringify(body)});
            else await this.fetchJSON('/api/stock', {method:'POST', body:JSON.stringify(body)});
            this.closeModal(); this.loadStock(); this.flash('Stock sauvegardé');
          }catch(e){ this.flash(e.message); }
        };
      });
    });
  },
  async deleteStock(id){
    if(!confirm('Supprimer cet article ?')) return;
    try{ await this.fetchJSON(`/api/stock/${id}`, {method:'DELETE'}); this.flash('Article supprimé'); this.loadStock(); }catch(e){ this.flash(e.message); }
  },
  async addType(){
    this.openModal('Nouveau type', `
      <div class="grid-2">
        <input id="tpLabel" class="input" placeholder="Label (ex. Parka)">
        <label><input type="checkbox" id="tpSize" checked> Gérer les tailles</label>
      </div>
      <div class="mt"><button class="btn btn-primary" id="saveType">Créer</button></div>
    `, ()=>{
      this.qs('#saveType').onclick=async()=>{
        const label=this.qs('#tpLabel').value.trim();
        const has_size=this.qs('#tpSize').checked;
        if(!label){ this.flash('Label requis'); return; }
        try{ await this.fetchJSON('/api/types', {method:'POST', body:JSON.stringify({label, has_size})}); this.closeModal(); this.renderStock(); this.flash('Type créé'); }catch(e){ this.flash(e.message); }
      };
    });
  },

  /* ------------------------------ Bénévoles ------------------------------ */
  async renderBenevoles(){
    const el=this.qs('#benevoles');
    el.innerHTML=`<div class="card">
      <div class="chips" style="justify-content:space-between">
        <h2>Bénévoles</h2>
        <div class="chips">
          <input id="volQ" class="input" placeholder="Rechercher...">
          <button class="btn btn-ghost" id="volSearch">Rechercher</button>
          <button class="btn btn-primary" id="volAdd">+ Bénévole</button>
        </div>
      </div>
      <div id="volTable" class="mt"></div>
    </div>`;
    const load=async()=>{
      const q=encodeURIComponent(this.qs('#volQ').value.trim());
      const rows=await this.fetchJSON('/api/volunteers'+(q?`?q=${q}`:'')); 
      this.qs('#volTable').innerHTML = rows.length? `<table class="table">
        <thead><tr><th>Nom</th><th>Prénom</th><th>Note</th><th></th></tr></thead>
        <tbody>${rows.map(v=>`<tr><td>${v.last_name}</td><td>${v.first_name}</td><td>${v.note||''}</td>
          <td><button class="btn btn-ghost" onclick='App.editVolunteer(${v.id},"${v.first_name.replace(/"/g,'&quot;')}","${v.last_name.replace(/"/g,'&quot;')}","${(v.note||'').replace(/"/g,'&quot;')}")'>Modifier</button>
          <button class="btn btn-ghost" onclick='App.deleteVolunteer(${v.id})'>Supprimer</button></td></tr>`).join('')}</tbody></table>` : `<p class="muted">Aucun résultat.</p>`;
    };
    this.qs('#volSearch').onclick=load; this.qs('#volAdd').onclick=()=>this.editVolunteer(null,'','','');
    load();
  },
  editVolunteer(id, first, last, note){
    this.openModal(id?'Modifier bénévole':'Nouveau bénévole', `
      <div class="grid-3">
        <input id="vFirst" class="input" placeholder="Prénom" value="${first||''}">
        <input id="vLast" class="input" placeholder="Nom" value="${last||''}">
        <input id="vNote" class="input" placeholder="Note" value="${note||''}">
      </div>
      <div class="mt"><button id="saveVol" class="btn btn-primary">Enregistrer</button></div>
    `, ()=>{
      this.qs('#saveVol').onclick=async()=>{
        const body={ first_name:this.qs('#vFirst').value.trim(), last_name:this.qs('#vLast').value.trim(), note:this.qs('#vNote').value.trim() };
        if(!body.first_name || !body.last_name){ this.flash('Prénom et nom requis'); return; }
        try{
          if(id) await this.fetchJSON(`/api/volunteers/${id}`, {method:'PUT', body:JSON.stringify(body)});
          else await this.fetchJSON('/api/volunteers', {method:'POST', body:JSON.stringify(body)});
          this.closeModal(); this.renderBenevoles(); this.flash('Sauvegardé');
        }catch(e){ this.flash(e.message); }
      };
    });
  },
  async deleteVolunteer(id){
    if(!confirm('Supprimer ce bénévole ?')) return;
    try{ await this.fetchJSON(`/api/volunteers/${id}`, {method:'DELETE'}); this.flash('Bénévole supprimé'); this.renderBenevoles(); }catch(e){ this.flash(e.message); }
  },

  /* ------------------------------ Prêts ------------------------------ */
  async renderPrets(){
    const el=this.qs('#prets');
    const rows=await this.fetchJSON('/api/loans/open').catch(()=>[]);
    el.innerHTML=`<div class="card">
      <div class="chips" style="justify-content:space-between"><h2>Prêts en cours</h2></div>
      ${rows.length?`<table class="table"><thead><tr><th>Bénévole</th><th>Article</th><th>Taille</th><th>Qté</th><th>Depuis</th><th></th></tr></thead>
      <tbody>${rows.map(l=>`<tr><td>${l.volunteer}</td><td>${l.type}</td><td>${l.size||''}</td><td>${l.qty}</td><td>${new Date(l.since).toLocaleDateString('fr-FR')}</td>
      <td><button class="btn btn-ghost" onclick="App.returnLoan(${l.id})">Retour</button></td></tr>`).join('')}</tbody></table>`:`<p class="muted">Aucun prêt ouvert.</p>`}
    </div>`;
  },

  /* ------------------------------ Inventaire ------------------------------ */
  async renderInventaire(){
    const ants=await this.fetchJSON('/api/antennas').catch(()=>[]);
    const el=this.qs('#inventaire');
    const optAnt=ants.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
    el.innerHTML=`<div class="card">
      <div class="chips" style="justify-content:space-between"><h2>Inventaire</h2></div>
      <div class="grid-3">
        <label>Antenne<select id="invAnt">${optAnt}</select></label>
        <button class="btn btn-primary" id="invStart">Démarrer</button>
        <span id="invInfo" class="muted"></span>
      </div>
      <div id="invTable" class="mt"></div>
    </div>`;
    this.qs('#invStart').onclick=async()=>{
      const ant=Number(this.qs('#invAnt').value);
      try{
        const r=await this.fetchJSON('/api/inventory/start',{method:'POST', body:JSON.stringify({antenna_id:ant})});
        this.flash('Session inventaire ouverte');
        await this.loadInventory(r.id);
      }catch(e){ this.flash(e.message); }
    };
  },
  async loadInventory(sid){
    this.qs('#invInfo').textContent=`Session #${sid}`;
    const rows=await this.fetchJSON(`/api/inventory/${sid}`).catch(()=>[]);
    this.qs('#invTable').innerHTML = rows.length? `<table class="table">
      <thead><tr><th>Type</th><th>Taille</th><th>Quantité actuelle</th><th>Compté</th></tr></thead>
      <tbody>
        ${rows.map(r=>`<tr>
          <td>${r.type}</td><td>${r.size||''}</td><td>${r.quantity}</td>
          <td><input type="number" class="input" style="max-width:120px" value="${r.quantity}" onchange="App.saveCount(${sid}, ${r.id}, this.value)"></td>
        </tr>`).join('')}
      </tbody></table>
      <div class="mt"><button class="btn btn-primary" onclick="App.closeInventory(${sid})">Clore l'inventaire</button></div>
    `:`<p class="muted">Aucun stock pour cette antenne.</p>`;
  },
  async saveCount(sid, stockId, val){
    try{ await this.fetchJSON(`/api/inventory/${sid}/count`,{method:'POST', body:JSON.stringify({stock_item_id:stockId, counted_qty:Number(val||0)})}); }catch(e){ this.flash(e.message); }
  },
  async closeInventory(sid){
    try{ await this.fetchJSON(`/api/inventory/${sid}/close`,{method:'POST'}); this.flash("Inventaire clôturé"); this.renderInventaire(); }catch(e){ this.flash(e.message); }
  },

  /* ------------------------------ Admin ------------------------------ */
  async renderAdmin(){
    const el=this.qs('#admin');
    const users=await this.fetchJSON('/api/users').catch(()=>[]);
    el.innerHTML=`<div class="card">
      <div class="chips" style="justify-content:space-between"><h2>Administration</h2>
        <button class="btn btn-primary" id="btnAddUser">+ Utilisateur</button>
      </div>
      ${users.length?`<table class="table"><thead><tr><th>Email</th><th>Nom</th><th>Rôle</th><th></th></tr></thead>
      <tbody>${users.map(u=>`<tr><td>${u.email}</td><td>${u.name||''}</td><td>${u.role||''}</td>
      <td><button class="btn btn-ghost" onclick='App.editUser(${u.id},"${u.email.replace(/"/g,'&quot;')}","${(u.name||'').replace(/"/g,'&quot;')}")'>Modifier</button></td></tr>`).join('')}</tbody></table>`:`<p class="muted">Aucun utilisateur.</p>`}
    </div>`;
    this.qs('#btnAddUser').onclick=()=>this.editUser(null,'','');
  },
  editUser(id,email,name){
    this.openModal(id?'Modifier utilisateur':'Nouvel utilisateur', `
      <div class="grid-3">
        <input id="uEmail" class="input" type="email" placeholder="Email" value="${email||''}">
        <input id="uName" class="input" placeholder="Nom" value="${name||''}">
        <input id="uPass" class="input" type="password" placeholder="${id?'Nouveau mot de passe (optionnel)':'Mot de passe'}">
      </div>
      <div class="mt"><button id="saveUser" class="btn btn-primary">Enregistrer</button></div>
    `, ()=>{
      this.qs('#saveUser').onclick=async()=>{
        const body={ name:this.qs('#uName').value.trim() };
        const pass=this.qs('#uPass').value;
        if(id){
          if(pass) body.password=pass;
          try{ await this.fetchJSON(`/api/users/${id}`, {method:'PUT', body:JSON.stringify(body)}); this.closeModal(); this.renderAdmin(); this.flash('Utilisateur modifié'); }catch(e){ this.flash(e.message); }
        }else{
          body.email=this.qs('#uEmail').value.trim();
          body.password=pass;
          if(!body.email || !body.password){ this.flash('Email et mot de passe requis'); return; }
          try{ await this.fetchJSON('/api/users', {method:'POST', body:JSON.stringify(body)}); this.closeModal(); this.renderAdmin(); this.flash('Utilisateur créé'); }catch(e){ this.flash(e.message); }
        }
      };
    });
  },

  /* ------------------------------ Public ------------------------------ */
  async renderPretPublic(){
    const el=this.qs('#pretPublic');
    const antennaId=this.publicAntennaId || null;
    const types=await this.fetchJSON('/api/public/types'+(antennaId?`?antenna_id=${antennaId}`:'')).catch(()=>[]);
    el.innerHTML=`<div class="card">
      <h2>Prêt public ${antennaId?`– antenne #${antennaId}`:''}</h2>
      <div class="grid-3 mt">
        <input id="pubVolId" class="input" type="number" placeholder="ID bénévole">
        <select id="pubType"><option value="">Type</option>${types.map(t=>`<option value="${t.id}">${t.label}</option>`).join('')}</select>
        <select id="pubSize"><option value="">Taille</option></select>
      </div>
      <div class="mt chips">
        <button class="btn btn-ghost" id="pubLoadLoans">Voir prêts en cours</button>
      </div>
      <div id="pubLoans" class="mt"></div>
      <p class="muted mt">Note : pour des raisons de sécurité, le prêt public détaillé (sélection exacte d'article) est géré par les bénévoles connectés.</p>
    </div>`;
    const sizeSel=this.qs('#pubSize');
    this.qs('#pubType').onchange=async (e)=>{
      const typeId=e.target.value;
      if(!typeId){ sizeSel.innerHTML='<option value="">Taille</option>'; return; }
      const sizes=await this.fetchJSON(`/api/public/sizes?type_id=${typeId}`+(antennaId?`&antenna_id=${antennaId}`:'')).catch(()=>[]);
      sizeSel.innerHTML = '<option value="">Taille</option>'+ sizes.map(s=>`<option value="${s}">${s}</option>`).join('');
    };
    this.qs('#pubLoadLoans').onclick=async()=>{
      const vol=Number(this.qs('#pubVolId').value||0);
      if(!vol){ this.flash('ID bénévole requis'); return; }
      const rows=await this.fetchJSON(`/api/public/loans?volunteer_id=${vol}`).catch(()=>[]);
      this.qs('#pubLoans').innerHTML = rows.length? `<table class="table">
        <thead><tr><th>Type</th><th>Taille</th><th>Qté</th><th>Depuis</th><th>Antenne</th><th></th></tr></thead>
        <tbody>${rows.map(l=>`<tr><td>${l.type}</td><td>${l.size||''}</td><td>${l.qty}</td><td>${new Date(l.since).toLocaleDateString('fr-FR')}</td><td>${l.antenna}</td>
        <td><button class="btn btn-ghost" onclick="App.publicReturn(${l.id})">Retour</button></td></tr>`).join('')}</tbody></table>` : `<p class="muted">Aucun prêt en cours.</p>`;
    };
  },
  async publicReturn(id){
    try{ await this.fetchJSON(`/api/public/return/${id}`, {method:'POST'}); this.flash('Prêt marqué rendu'); this.renderPretPublic(); }catch(e){ this.flash(e.message); }
  }
};

window.App = App;

/* Boot */
document.addEventListener("DOMContentLoaded", () => {
  const onEnter = (e) => { if (e.key === "Enter") { e.preventDefault(); App.login(); } };
  const em = document.getElementById("loginEmail");
  const pw = document.getElementById("loginPass");
  if (em) em.addEventListener("keydown", onEnter);
  if (pw) pw.addEventListener("keydown", onEnter);
  App.init();
});
