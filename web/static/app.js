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

  // ------------------------------- Utils -------------------------------
  qs: (s) => document.querySelector(s),
  async fetchJSON(url, opts = {}) {
    opts.headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `Erreur ${res.status}`;
      throw new Error(msg);
    }
    return data;
  },
  flash(msg, t = 3500) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("show"), 5);
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 300);
    }, t);
  },
  openModal(title, body) {
    const modal = document.getElementById("modal");
    modal.innerHTML = `<div class="modal-card">
      <div class="modal-head">
        <h3>${title}</h3>
        <button class="btn btn-ghost" onclick="App.closeModal()">✕</button>
      </div>
      <div class="modal-body">${body}</div>
    </div>`;
    modal.classList.add("open");
  },
  closeModal() {
    const modal = document.getElementById("modal");
    modal.classList.remove("open");
    modal.innerHTML = "";
  },

  // ------------------------------- Init / Auth -------------------------------
  async init() {
    this.renderNav();
    this.show("dashboard");
  },
  async me() {
    try {
      const u = await this.fetchJSON("/api/users");
      if (Array.isArray(u)) {
        // if /api/users returns list, we are logged in
        this.user = { ok: true };
      }
    } catch {}
  },
  async login() {
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPass").value;
    const err = document.getElementById("loginErr");
    err.textContent = "";
    if (!email || !password) { err.textContent = "Email et mot de passe requis"; return; }
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (res.ok) { location.reload(); return; }
      err.textContent = "Identifiants invalides";
    } catch(e) { err.textContent = e.message || "Erreur de connexion"; }
  },
  logout() { location.href = "/api/logout"; },

  // ------------------------------- Nav / Pages -------------------------------
  show(id) {
    document.querySelectorAll(".page").forEach((p) => p.style.display = (p.id === id ? "block" : "none"));
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.id === id));
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

  // ------------------------------ Dashboard ------------------------------
  async renderDashboard(){
    const [stats, stock] = await Promise.all([
      this.fetchJSON('/api/stats'),
      this.fetchJSON('/api/stock'),
    ]);

    // seuils antennes
    const byAntenna = {};
    const byType = {};
    stock.forEach(s => { byAntenna[s.antenna] = (byAntenna[s.antenna] || 0) + s.quantity; byType[s.garment_type] = (byType[s.garment_type] || 0) + s.quantity; });

    const lowStock = [];
    const ants = await this.fetchJSON('/api/antennas');
    ants.forEach(a => {
      const total = Object.entries(stock).filter(([_,v])=>v).length;
      const sum = Object.values(stock).reduce((acc, v) => acc + (v?.quantity || 0), 0);
      void(total); void(sum);
    });

    const el=this.qs('#dashboard'); el.innerHTML=`
      <div class="card">
        <h2>Tableau de bord</h2>
        <div class="grid-3">
          <div>Total stock: <b>${stats.stock_total}</b></div>
          <div>Prêts ouverts: <b>${stats.prets_ouverts}</b></div>
          <div>Bénévoles: <b>${stats.benevoles}</b></div>
        </div>
        <div class="grid-2 mt">
          <div>
            <h3>Alertes stock bas</h3>
            ${lowStock.length?`<table class="table"><thead><tr><th>Type</th><th>Taille</th><th>Antenne</th><th>Qté</th></tr></thead>
              <tbody>${lowStock.map(s=>`<tr><td>${s.garment_type}</td><td>${s.size||''}</td><td>${s.antenna}</td><td><span class="badge">${s.quantity}</span></td></tr>`).join('')}</tbody></table>`
              :`<div class="muted">Aucune alerte.</div>`}
          </div>
          <div>
            <h3>Répartition par antenne</h3>
            <div class="chips">${Object.keys(byAntenna).length? Object.entries(byAntenna).map(([k,v])=>`<span class="chip">${k}: <b>${v}</b></span>`).join('') : '<span class="muted">Aucune donnée</span>'}</div>
            <h3 class="mt">Top types</h3>
            <div class="chips">${Object.keys(byType).length? Object.entries(byType).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>`<span class="chip">${k}: <b>${v}</b></span>`).join('') : '<span class="muted">Aucune donnée</span>'}</div>
          </div>
        </div>
      </div>`;
  },

  // ------------------------------ Antennes ------------------------------
  async renderAntennes(){
    const el=this.qs('#antennes'); const data=await this.fetchJSON('/api/antennas');
    el.innerHTML=`<div class="card">
      <div class="chips" style="justify-content:space-between">
        <h2>Antennes</h2>
        <button class="btn btn-primary" onclick="App.modalAddAntenna()">+ Antenne</button>
      </div>
      <div class="mt">
        ${data.length?`<table class="table">
          <thead><tr><th>Nom</th><th>Adresse</th><th>Seuil bas</th><th>Actions</th></tr></thead>
          <tbody>${data.map(a=>`<tr>
            <td>${a.name}</td>
            <td>${a.address||''}</td>
            <td>${a.low_stock_threshold??''}</td>
            <td>
              <button class="btn btn-ghost" onclick='App.modalEditAntenna(${a.id}, ${JSON.stringify(a).replaceAll("'","&apos;")})'>Modifier</button>
              <button class="btn btn-danger" onclick="App.deleteAntenna(${a.id})">Supprimer</button>
            </td></tr>`).join('')}</tbody></table>`:'<div class="muted">Aucune antenne</div>'}
      </div>
    </div>`;
  },
  modalAddAntenna(){ this.openModal('Ajouter une antenne', `<div class="grid-2">
      <input id="a_name" class="input" placeholder="Nom">
      <input id="a_address" class="input" placeholder="Adresse (optionnel)">
      <input id="a_threshold" class="input" type="number" min="0" placeholder="Seuil bas (optionnel)">
      <input id="a_lat" class="input" type="number" placeholder="Latitude (optionnel)">
      <input id="a_lng" class="input" type="number" placeholder="Longitude (optionnel)">
    </div>
    <div class="mt"><button class="btn btn-primary" onclick="App.saveAntenna()">Enregistrer</button></div>`); },
  async saveAntenna(){ const d={ name:this.qs('#a_name').value.trim(), address:this.qs('#a_address').value.trim(),
    low_stock_threshold:Number(this.qs('#a_threshold').value||0)||null, lat: Number(this.qs('#a_lat').value||0)||null, lng: Number(this.qs('#a_lng').value||0)||null };
    try{ await this.fetchJSON('/api/antennas',{method:'POST',body:JSON.stringify(d)}); this.closeModal(); this.renderAntennes(); this.flash('Antenne ajoutée'); }catch(e){ this.flash(e.message||'Erreur'); } },
  modalEditAntenna(id,a){ this.openModal('Modifier une antenne', `<div class="grid-2">
      <input id="e_name" class="input" value="${a.name}">
      <input id="e_address" class="input" value="${a.address||''}">
      <input id="e_threshold" class="input" type="number" min="0" value="${a.low_stock_threshold??''}">
      <input id="e_lat" class="input" type="number" value="${a.lat??''}">
      <input id="e_lng" class="input" type="number" value="${a.lng??''}">
    </div>
    <div class="mt"><button class="btn btn-primary" onclick="App.saveEditAntenna(${id})">Enregistrer</button></div>`); },
  async saveEditAntenna(id){ const d={ name:this.qs('#e_name').value.trim(), address:this.qs('#e_address').value.trim(),
    low_stock_threshold:Number(this.qs('#e_threshold').value||0)||null, lat: Number(this.qs('#e_lat').value||0)||null, lng: Number(this.qs('#e_lng').value||0)||null };
    try{ await this.fetchJSON('/api/antennas/'+id,{method:'PUT',body:JSON.stringify(d)}); this.closeModal(); this.renderAntennes(); this.flash('Antenne mise à jour'); }catch(e){ this.flash(e.message||'Erreur'); } },
  async deleteAntenna(id){ if(!confirm('Supprimer cette antenne ?')) return;
    try{ await this.fetchJSON('/api/antennas/'+id,{method:'DELETE'}); this.renderAntennes(); this.flash('Antenne supprimée'); }catch(e){ this.flash(e.message||'Suppression refusée'); } },

  // ------------------------------ Stock ------------------------------
  renderStock(){ const el=this.qs('#stock'); const [types, ants]=await Promise.all([this.fetchJSON('/api/types'), this.fetchJSON('/api/antennas')]); this._types=types; this._ants=ants;
    const optType=(v)=>['<option value="">Type</option>'].concat(types.map(t=>`<option value="${t.id}" ${v==t.id?'selected':''}>${t.label}</option>`)).join('');
    const optAnt=(v)=>['<option value="">Antenne</option>'].concat(ants.map(a=>`<option value="${a.id}" ${v==a.id?'selected':''}>${a.name}</option>`)).join('');
    el.innerHTML=`<div class="card">
      <div class="chips" style="justify-content:space-between"><h2>Stock</h2>
        <div class="chips">
          <button class="btn btn-ghost" onclick="App.modalAddType()">+ Type</button>
          <button class="btn btn-primary" onclick="App.modalAddStock()">+ Article</button>
        </div>
      </div>
      <div class="grid-3 mt"><select id="f_type">${optType('')}</select><select id="f_ant">${optAnt('')}</select><button class="btn btn-ghost" onclick="App.loadStock()">Filtrer</button><button class="btn btn-ghost" onclick="App.exportStock()">⬇️ Exporter CSV</button></div>
      <div id="stockTable" class="mt"></div>
    </div>`;
    this._optType=optType; this._optAnt=optAnt; await this.loadStock(); },
  async loadStock(){ const t=this.qs('#f_type')?.value||''; const a=this.qs('#f_ant')?.value||''; const params=new URLSearchParams(); if(t) params.set('type_id', t); if(a) params.set('antenna_id', a);
    const data=await this.fetchJSON('/api/stock'+(params.toString()?('?'+params.toString()):'')); const el=this.qs('#stockTable');
    el.innerHTML = data.length? `<table class="table">
      <thead><tr><th>Type</th><th>Taille</th><th>Antenne</th><th>Qté</th><th>Tags</th><th>Actions</th></tr></thead>
      <tbody>${data.map(s=>`<tr>
        <td>${s.garment_type}</td>
        <td>${s.size||''}</td>
        <td>${s.antenna}</td>
        <td><span class="badge">${s.quantity}</span></td>
        <td>${App.renderTagsInline(s.tags)}</td>
        <td>
          <button class="btn btn-ghost" onclick='App.modalEditStock(${s.id}, ${JSON.stringify({garment_type_id:s.garment_type_id, antenna_id:s.antenna_id, size:s.size||"", quantity:s.quantity, tags:s.tags||[]}).replaceAll("'","&apos;")})'>Modifier</button>
          <button class="btn btn-danger" onclick="App.deleteStock(${s.id})">Supprimer</button>
        </td>
      </tr>`).join('')}</tbody></table>` : `<div class="muted">Aucun stock</div>`;
  },
  exportStock(){ const t=this.qs('#f_type')?.value||''; const a=this.qs('#f_ant')?.value||'';
    const p=new URLSearchParams(); if(t) p.set('type_id', t); if(a) p.set('antenna_id', a);
    const url='/api/stock/export.csv'+(p.toString()?('?'+p.toString()):'');
    window.location.href=url;
  },
  renderTagsInline(tags){ tags=Array.isArray(tags)? tags: String(tags||'').split(',').map(s=>s.trim()).filter(Boolean); return `<div class="chips">${tags.map(t=>`<span class="badge">${t}</span>`).join('')}</div>`; },
  modalAddType(){ this.openModal('Ajouter un type', `<div class="grid-2">
      <input id="new_type" class="input" placeholder="Libellé du type">
      <label class="row"><input type="checkbox" id="new_type_has_size" checked> <span>Avec tailles</span></label>
    </div>
    <div class="mt"><button class="btn btn-primary" onclick="App.saveType()">Enregistrer</button> <button class="btn btn-ghost" onclick="App.manageTypes()">Gérer / Supprimer</button></div>`); },
  async manageTypes(){ const types=await this.fetchJSON('/api/types'); const body = `<table class="table"><thead><tr><th>Type</th><th>Actions</th></tr></thead>
      <tbody>${types.map(t=>`<tr><td>${t.label}</td><td><button class="btn btn-danger" onclick="App.deleteType(${t.id})">Supprimer</button></td></tr>`).join('')}</tbody></table>`; this.openModal('Types existants', body); },
  async deleteType(id){ if(!confirm('Supprimer ce type ?\n(Refus si du stock existe pour ce type)')) return;
    try{ await this.fetchJSON('/api/types/'+id,{method:'DELETE'}); this.closeModal(); this.renderStock(); this.flash('Type supprimé'); } catch(e){ this.flash(e.message||'Suppression refusée'); } },
  async saveType(){ const label=this.qs('#new_type').value.trim(); const has_size=this.qs('#new_type_has_size').checked;
    if(!label){ this.flash('Libellé requis'); return; }
    try{ await this.fetchJSON('/api/types',{method:'POST', body: JSON.stringify({label, has_size})}); this.closeModal(); this.renderStock(); this.flash('Type créé'); }catch(e){ this.flash(e.message||'Création refusée'); }},
  modalAddStock(){ this.openModal('Ajouter au stock', `<div class="grid-2">
      <label>Type<select id="s_type" class="input">${this._optType('')}</select></label>
      <label>Antenne<select id="s_ant" class="input">${this._optAnt('')}</select></label>
      <input id="s_size" class="input" placeholder="Taille (optionnel)">
      <input id="s_qty" class="input" type="number" min="1" value="1" placeholder="Quantité">
      <input id="s_tags" class="input" placeholder="Tags séparés par des virgules (optionnel)">
    </div>
    <div class="mt"><button class="btn btn-primary" onclick="App.saveStock()">Enregistrer</button></div>`); },
  async saveStock(){ const t=Number(this.qs('#s_type').value); const a=Number(this.qs('#s_ant').value); const size=this.qs('#s_size').value.trim(); const quantity=Number(this.qs('#s_qty').value||0); const tags=this.qs('#s_tags').value.trim();
    if(!t||!a||quantity<=0){ this.flash('Type, antenne et quantité > 0 requis'); return; }
    try{ await this.fetchJSON('/api/stock',{method:'POST', body: JSON.stringify({garment_type_id:t, antenna_id:a, size, quantity, tags})}); this.closeModal(); this.loadStock(); this.flash('Stock ajouté'); }catch(e){ this.flash(e.message||'Erreur ajout stock'); } },
  modalEditStock(id,s){ this.openModal('Modifier un article de stock', `<div class="grid-2">
      <label>Type<select id="e_type" class="input">${this._optType(s.garment_type_id)}</select></label>
      <label>Antenne<select id="e_ant" class="input">${this._optAnt(s.antenna_id)}</select></label>
      <input id="e_size" class="input" value="${s.size||''}" placeholder="Taille (optionnel)">
      <input id="e_qty" class="input" type="number" min="0" value="${s.quantity}" placeholder="Quantité">
      <input id="e_tags" class="input" value="${(s.tags||[]).join(', ')}" placeholder="Tags (optionnel)">
    </div>
    <div class="mt"><button class="btn btn-primary" onclick="App.saveEditStock(${id})">Enregistrer</button></div>`); },
  async saveEditStock(id){ const t=Number(this.qs('#e_type').value); const a=Number(this.qs('#e_ant').value); const size=this.qs('#e_size').value.trim(); const quantity=Number(this.qs('#e_qty').value||0); const tags=this.qs('#e_tags').value.trim();
    try{ await this.fetchJSON('/api/stock/'+id,{method:'PUT', body: JSON.stringify({garment_type_id:t, antenna_id:a, size, quantity, tags})}); this.closeModal(); this.loadStock(); this.flash('Stock mis à jour'); }catch(e){ this.flash(e.message||'Mise à jour refusée'); } },
  async deleteStock(id){ if(!confirm('Supprimer cet article ?')) return;
    try{ await this.fetchJSON('/api/stock/'+id,{method:'DELETE'}); this.loadStock(); this.flash('Article supprimé'); } catch(e){ this.flash(e.message||'Suppression impossible'); } },

  // ------------------------------ Bénévoles (CRUD + recherche + import) ------------------------------
  _volLocal: [],
  async renderBenevoles(){ const el=this.qs('#benevoles'); const data=await this.fetchJSON('/api/volunteers'); this._volLocal=data;
    el.innerHTML=`<div class="card">
      <div class="chips" style="justify-content:space-between">
        <h2>Bénévoles</h2>
        <div class="chips">
          <input id="volSearch" class="input" placeholder="Rechercher (nom, prénom, note)" style="min-width:260px">
          <a class="btn btn-ghost" href="/api/volunteers/template.csv">⬇️ Modèle CSV</a>
          <input id="volImportFile" type="file" accept=".csv" style="display:none">
          <button class="btn btn-ghost" onclick="document.getElementById('volImportFile').click()">⬆️ Import CSV</button>
          <button class="btn btn-primary" onclick="App.modalAddVolunteer()">+ Bénévole</button>
        </div>
      </div>
      <div id="volList" class="mt"></div>
    </div>`;
    const inp=this.qs('#volSearch'); inp.addEventListener('input',()=>this.filterVol()); this.renderVolList(this._volLocal);
    document.getElementById('volImportFile').addEventListener('change',(e)=>this.importVolCSV(e.target.files[0]));
  },
  filterVol(){ const q=(this.qs('#volSearch').value||'').trim().toLowerCase(); if(!q){ this.renderVolList(this._volLocal); return; }
    const f=this._volLocal.filter(v=>[v.last_name, v.first_name, v.note||''].join(' ').toLowerCase().includes(q)); this.renderVolList(f); },
  renderVolList(list){ const el=this.qs('#volList'); el.innerHTML=list.length? `<table class="table">
      <thead><tr><th>Nom</th><th>Prénom</th><th>Note</th><th>Prêts</th><th>Actions</th></tr></thead>
      <tbody>${list.map(v=>`<tr>
        <td>${v.last_name}</td><td>${v.first_name}</td><td>${v.note||''}</td>
        <td><button class="btn btn-ghost" onclick="App.viewLoans(${v.id})">Voir</button></td>
        <td><button class="btn btn-ghost" onclick='App.modalEditVolunteer(${v.id}, ${JSON.stringify(v).replaceAll("'","&apos;")})'>Modifier</button>
            <button class="btn btn-danger" onclick="App.deleteVolunteer(${v.id})">Supprimer</button></td>
      </tr>`).join('')}</tbody></table>` : `<div class="muted">Aucun bénévole</div>`; },
  async importVolCSV(file){ if(!file){ this.flash('Fichier manquant'); return; }
    const fd=new FormData(); fd.append('file', file);
    try{
      const res = await fetch('/api/volunteers/import', { method:'POST', body: fd });
      if(!res.ok){ const t=await res.json().catch(()=>({})); throw new Error(t.error||'Import refusé'); }
      const out=await res.json(); this.flash(`Import: ${out.added} ajoutés, ${out.skipped} ignorés`);
      this.renderBenevoles();
    }catch(e){ this.flash(e.message||'Import échoué'); }
  },
  async viewLoans(volId){ const loans=await this.fetchJSON('/api/volunteers/'+volId+'/loans');
    this.openModal('Prêts en cours', loans.length? `<table class="table"><thead><tr><th>Article</th><th>Taille</th><th>Antenne</th><th>Depuis</th><th>Qté</th><th>Action</th></tr></thead>
      <tbody>${loans.map(l=>`<tr><td>${l.type}</td><td>${l.size||''}</td><td>${l.antenna}</td><td>${(new Date(l.since)).toLocaleDateString()}</td><td>${l.qty}</td>
        <td><button class="btn btn-primary" onclick="App.returnLoan(${l.id})">Rendre</button></td></tr>`).join('')}</tbody></table>` : `<div class="muted">Aucun prêt en cours</div>`); },
  async returnLoan(id){ try{ await this.fetchJSON('/api/loans/return/'+id,{method:'POST'}); this.closeModal(); this.renderBenevoles(); this.flash('Prêt rendu'); } catch(e){ this.flash(e.message||'Retour refusé'); } },
  modalAddVolunteer(){ this.openModal('Ajouter un bénévole', `<div class="grid-2">
      <input id="v_last" class="input" placeholder="Nom">
      <input id="v_first" class="input" placeholder="Prénom">
      <input id="v_note" class="input" placeholder="Note (taille, etc.)">
    </div>
    <div class="mt"><button class="btn btn-primary" onclick="App.saveVolunteer()">Enregistrer</button></div>`); },
  async saveVolunteer(){ const last=this.qs('#v_last').value.trim(); const first=this.qs('#v_first').value.trim(); const note=this.qs('#v_note').value.trim();
    if(!last||!first){ this.flash('Nom et prénom requis'); return; }
    try{ await this.fetchJSON('/api/volunteers',{method:'POST', body: JSON.stringify({ last_name:last, first_name:first, note })}); this.closeModal(); this.renderBenevoles(); this.flash('Bénévole créé'); }catch(e){ this.flash(e.message||'Création refusée'); } },
  modalEditVolunteer(id,v){ this.openModal('Modifier un bénévole', `<div class="grid-2">
      <input id="e_last" class="input" value="${v.last_name}">
      <input id="e_first" class="input" value="${v.first_name}">
      <input id="e_note" class="input" value="${v.note||''}">
    </div>
    <div class="mt"><button class="btn btn-primary" onclick="App.saveEditVolunteer(${id})">Enregistrer</button></div>`); },
  async saveEditVolunteer(id){ const last=this.qs('#e_last').value.trim(); const first=this.qs('#e_first').value.trim(); const note=this.qs('#e_note').value.trim();
    try{ await this.fetchJSON('/api/volunteers/'+id,{method:'PUT', body: JSON.stringify({ last_name:last, first_name:first, note })}); this.closeModal(); this.renderBenevoles(); this.flash('Bénévole mis à jour'); }catch(e){ this.flash(e.message||'Mise à jour refusée'); } },
  async deleteVolunteer(id){ if(!confirm('Supprimer ce bénévole ?')) return;
    try{ await this.fetchJSON('/api/volunteers/'+id,{method:'DELETE'}); this.renderBenevoles(); this.flash('Bénévole supprimé'); } catch(e){ this.flash(e.message||'Suppression impossible'); } },

  // ------------------------------ Prêts en cours ------------------------------
  async renderPrets(){ const el=this.qs('#prets'); const data=await this.fetchJSON('/api/loans/open');
    el.innerHTML=`<div class="card">
      <h2>Prêts en cours</h2>
      ${data.length?`<table class="table">
        <thead><tr><th>Bénévole</th><th>Type</th><th>Taille</th><th>Antenne</th><th>Depuis</th><th>Qté</th><th>Action</th></tr></thead>
        <tbody>${data.map(l=>`<tr>
          <td>${l.volunteer}</td><td>${l.type}</td><td>${l.size||''}</td><td>${l.antenna}</td><td>${(new Date(l.since)).toLocaleDateString()}</td><td>${l.qty}</td>
          <td><button class="btn btn-primary" onclick="App.returnLoan(${l.id})">Rendre</button></td>
        </tr>`).join('')}</tbody></table>` : `<div class="muted">Aucun prêt</div>`}
    </div>`;
  },

  // ------------------------------ Inventaire ------------------------------
  _invSession: null,
  async renderInventaire(){ const el=this.qs('#inventaire'); const ants=await this.fetchJSON('/api/antennas');
    el.innerHTML=`<div class="card">
      <h2>Inventaire</h2>
      ${this._invSession? `<div class="muted">Session #${this._invSession.id} – ${this._invSession.antenna}</div>`:''}
      <div class="grid-3 mt">
        ${this._invSession? `<button class="btn btn-ghost" onclick="App.closeInventaire()">Clôturer</button>`:
        `<select id="inv_ant">${ants.map(a=>`<option value="${a.id}">${a.name}</option>`).join('')}</select>
         <button class="btn btn-primary" onclick="App.startInventaire()">Démarrer</button>`}
      </div>
      <div id="invTable" class="mt"></div>
    </div>`;
    if(this._invSession){ this.loadInventaire(); }
  },
  async startInventaire(){ const ant=Number(this.qs('#inv_ant').value); if(!ant) return this.flash('Choisis une antenne');
    try{ const {id}=await this.fetchJSON('/api/inventory/start',{method:'POST', body: JSON.stringify({antenna_id:ant})}); this._invSession={id, antenna: this.qs('#inv_ant').selectedOptions[0].textContent}; this.renderInventaire(); }
    catch(e){ this.flash(e.message||'Impossible de démarrer'); } },
  async loadInventaire(){ const {antenna, rows}=await this.fetchJSON('/api/inventory/'+this._invSession.id);
    this.qs('#invTable').innerHTML = rows.length? `<table class="table"><thead><tr><th>Type</th><th>Taille</th><th>Qté actuelle</th><th>Comptée</th></tr></thead>
      <tbody>${rows.map(r=>`<tr><td>${r.type}</td><td>${r.size||''}</td><td>${r.quantity}</td>
        <td><input class="input" type="number" min="0" value="${r.quantity}" oninput="App.invSet(${r.stock_item_id}, this.value)"></td></tr>`).join('')}</tbody></table>` : `<div class="muted">Rien à compter</div>`;
  },
  invSet(id,val){ clearTimeout(this._invT); this._invT=setTimeout(async()=>{ try{ await this.fetchJSON('/api/inventory/'+this._invSession.id+'/count',{method:'POST', body: JSON.stringify({stock_item_id:id, counted_qty:Number(val||0)})}); }catch{} }, 250); },
  async closeInventaire(){ if(!confirm('Clôturer l’inventaire et appliquer les quantités comptées ?')) return;
    try{ await this.fetchJSON('/api/inventory/'+this._invSession.id+'/close',{method:'POST'}); this._invSession=null; this.renderInventaire(); this.flash('Inventaire clôturé'); }catch(e){ this.flash(e.message||'Impossible de clôturer'); } },

  // ------------------------------ Admin ------------------------------
  async renderAdmin(){ const el=this.qs('#admin'); const users=await this.fetchJSON('/api/users');
    el.innerHTML=`<div class="card">
      <div class="chips" style="justify-content:space-between">
        <h2>Administration</h2>
        <button class="btn btn-primary" onclick="App.modalAddUser()">+ Utilisateur</button>
      </div>
      ${users.length? `<table class="table">
        <thead><tr><th>Email</th><th>Nom</th><th>Rôle</th><th>Actions</th></tr></thead>
        <tbody>${users.map(u=>`<tr><td>${u.email}</td><td>${u.name}</td><td>${u.role}</td>
          <td><button class="btn btn-ghost" onclick='App.modalEditUser(${u.id}, ${JSON.stringify(u).replaceAll("'","&apos;")})'>Modifier</button>
              <button class="btn btn-danger" onclick="App.deleteUser(${u.id})">Supprimer</button></td></tr>`).join('')}</tbody></table>` : `<div class="muted">Aucun utilisateur</div>`}
    </div>`;
  },
  modalAddUser(){ this.openModal('Ajouter un utilisateur', `<div class="grid-2">
      <input id="u_email" class="input" placeholder="Email">
      <input id="u_name" class="input" placeholder="Nom">
      <input id="u_pass" class="input" type="password" placeholder="Mot de passe">
      <select id="u_role"><option value="admin">admin</option><option value="manager">manager</option></select>
    </div>
    <div class="mt"><button class="btn btn-primary" onclick="App.saveUser()">Enregistrer</button></div>`); },
  async saveUser(){ const email=this.qs('#u_email').value.trim(); const name=this.qs('#u_name').value.trim(); const password=this.qs('#u_pass').value; const role=this.qs('#u_role').value;
    if(!email||!password){ this.flash('Email et mot de passe requis'); return; }
    try{ await this.fetchJSON('/api/users',{method:'POST', body: JSON.stringify({ email, name, password, role })}); this.closeModal(); this.renderAdmin(); this.flash('Utilisateur créé'); }catch(e){ this.flash(e.message||'Création refusée'); } },
  modalEditUser(id,u){ this.openModal('Modifier un utilisateur', `<div class="grid-2">
      <input id="e_email" class="input" value="${u.email}" disabled>
      <input id="e_name" class="input" value="${u.name}">
      <input id="e_pass" class="input" type="password" placeholder="Nouveau mot de passe (optionnel)">
      <select id="e_role"><option value="admin" ${u.role==='admin'?'selected':''}>admin</option><option value="manager" ${u.role==='manager'?'selected':''}>manager</option></select>
    </div>
    <div class="mt"><button class="btn btn-primary" onclick="App.saveEditUser(${id})">Enregistrer</button></div>`); },
  async saveEditUser(id){ const name=this.qs('#e_name').value.trim(); const password=this.qs('#e_pass').value; const role=this.qs('#e_role').value;
    try{ await this.fetchJSON('/api/users/'+id,{method:'PUT', body: JSON.stringify({ name, password, role })}); this.closeModal(); this.renderAdmin(); this.flash('Utilisateur mis à jour'); }catch(e){ this.flash(e.message||'Mise à jour refusée'); } },
  async deleteUser(id){ if(!confirm('Supprimer cet utilisateur ?')) return;
    try{ await this.fetchJSON('/api/users/'+id,{method:'DELETE'}); this.renderAdmin(); this.flash('Utilisateur supprimé'); } catch(e){ this.flash(e.message||'Suppression impossible'); } },

  // ------------------------------ Public prêt antenne ------------------------------
  async renderPretPublic(){
    const el=this.qs('#pretPublic');
    const ants=await this.fetchJSON('/api/antennas');

    el.innerHTML=`<div class="card">
      <h2>Prêt public (antenne)</h2>
      <div class="grid-3">
        <label>Antenne<select id="pub_ant" class="input">${ants.map(a=>`<option value="${a.id}">${a.name}</option>`).join('')}</select></label>
        <label>Nom<input id="pub_ln" class="input" placeholder="Nom (DUPONT)"></label>
        <label>Prénom<input id="pub_fn" class="input" placeholder="Prénom (Jean)"></label>
      </div>
      <div class="grid-3 mt">
        <button class="btn btn-primary" onclick="App.pubFind()">Rechercher bénévole</button>
        <div></div><div></div>
      </div>
      <div id="pubVol" class="mt"></div>
      <hr class="mt">
      <div class="grid-3">
        <label>Type<select id="pub_type" class="input"></select></label>
        <label>Taille<select id="pub_size" class="input"><option value="">Toutes</option></select></label>
        <label>&nbsp;<button class="btn btn-ghost" onclick="App.pubReload()">Filtrer</button></label>
      </div>
      <div id="pubStock" class="mt"></div>
    </div>`;

    // Pré-remplir types selon antenne
    this.publicAntennaId = Number(this.qs('#pub_ant').value);
    this.qs('#pub_ant').addEventListener('change', ()=>{ this.publicAntennaId = Number(this.qs('#pub_ant').value); this.pubLoadTypes(); this.pubReload(); });
    await this.pubLoadTypes();
    await this.pubReload();
  },
  async pubLoadTypes(){
    const types=await this.fetchJSON('/api/public/types?antenna_id='+this.publicAntennaId);
    const sel = this.qs('#pub_type'); sel.innerHTML = `<option value="">Tous</option>` + types.map(t=>`<option value="${t.id}">${t.label}</option>`).join('');
    sel.addEventListener('change', ()=>this.pubLoadSizes());
    await this.pubLoadSizes();
  },
  async pubLoadSizes(){
    const t = Number(this.qs('#pub_type').value||0);
    const sizes = t? await this.fetchJSON(`/api/public/sizes?antenna_id=${this.publicAntennaId}&type_id=${t}`) : [];
    const sel = this.qs('#pub_size'); sel.innerHTML = `<option value="">Toutes</option>` + sizes.map(s=>`<option value="${s}">${s}</option>`).join('');
  },
  async pubFind(){
    const ln=(this.qs('#pub_ln').value||'').trim(); const fn=(this.qs('#pub_fn').value||'').trim();
    if(!ln || !fn){ this.flash('Nom et prénom requis'); return; }
    try{
      const d=await this.fetchJSON(`/api/public/volunteer?first_name=${encodeURIComponent(fn)}&last_name=${encodeURIComponent(ln)}`);
      this.qs('#pubVol').innerHTML = `<div class="alert success">Bénévole trouvé : <b>${d.last_name} ${d.first_name}</b> (id=${d.id})</div>`;
      this.qs('#pubVol').dataset.volunteerId = d.id;
    }catch(e){
      this.qs('#pubVol').innerHTML = `<div class="alert danger">Bénévole introuvable</div>`;
      this.qs('#pubVol').dataset.volunteerId = "";
    }
  },
  async pubReload(){
    const ant=this.publicAntennaId; const t=Number(this.qs('#pub_type').value||0); const size=this.qs('#pub_size').value||'';
    const params = new URLSearchParams(); if(ant) params.set('antenna_id', ant); if(t) params.set('type_id', t); if(size) params.set('size', size);
    const data = await this.fetchJSON('/api/public/stock'+(params.toString()?('?'+params.toString()):''));
    this.qs('#pubStock').innerHTML = data.length? `<table class="table">
      <thead><tr><th>Type</th><th>Taille</th><th>Qté</th><th>Antenne</th><th>Action</th></tr></thead>
      <tbody>${data.map(s=>`<tr><td>${s.type}</td><td>${s.size||''}</td><td>${s.quantity}</td><td>${s.antenna}</td>
        <td><button class="btn btn-primary" onclick="App.loanPublic(${s.id})">Emprunter</button></td></tr>`).join('')}</tbody></table>` : `<div class="muted">Aucun article</div>`;
  },
  async loanPublic(stockId){
    const volId = Number(this.qs('#pubVol').dataset.volunteerId||0);
    if(!volId){ this.flash('Sélectionne d’abord un bénévole'); return; }
    try{
      await this.fetchJSON('/api/public/loan',{method:'POST', body: JSON.stringify({ volunteer_id: volId, stock_item_id: stockId, qty: 1 })});
      this.flash('Prêt enregistré'); this.pubReload();
    }catch(e){ this.flash(e.message||'Prêt refusé'); }
  },
  async returnLoanPublic(id){ try{ await this.fetchJSON('/api/public/return/'+id,{method:'POST'}); this.flash('Prêt rendu'); this.pubReload(); } catch(e){ this.flash(e.message||'Retour refusé'); } },
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
