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

  // Utils
  qs: (s) => document.querySelector(s),
  async fetchJSON(url, opts = {}) {
    opts.headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    const res = await fetch(url, opts);
    let data = null; try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error((data && (data.error || data.message)) || `Erreur ${res.status}`);
    return data;
  },
  flash(msg) { const el = document.getElementById("flash"); el.innerHTML = `<div class="toast">${msg}</div>`; setTimeout(() => (el.innerHTML = ""), 2500); },
  daysBetween(a, b) { return Math.round((b - a) / (1000 * 60 * 60 * 24)); },
  getSetting(key, def) { try { const v = localStorage.getItem("pc:" + key); return v !== null ? JSON.parse(v) : def; } catch { return def; } },
  setSetting(key, val) { try { localStorage.setItem("pc:" + key, JSON.stringify(val)); } catch {} },

  // Nav / Login
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
    if (this.publicAntennaId) { document.getElementById("loginView").classList.add("hidden"); this.renderNav(); this.show("pretPublic"); return; }
    try { const me = await this.fetchJSON("/api/me"); if (me.ok) { this.user = me.user; this.renderNav(); this.qs("#loginView").classList.add("hidden"); this.show("dashboard"); return; } } catch {}
    this.renderNav(); this.qs("#loginView").classList.remove("hidden");
  },
  async login() {
    const btn = document.getElementById("loginBtn");
    const email = this.qs("#loginEmail").value.trim();
    const password = this.qs("#loginPass").value;
    const err = this.qs("#loginError"); err.classList.add("hidden"); err.textContent = "";
    if (!email || !password) { err.textContent = "Email et mot de passe requis"; err.classList.remove("hidden"); return; }
    btn.disabled = true; const old = btn.textContent; btn.textContent = "Connexion...";
    try { const r = await this.fetchJSON("/api/login", { method: "POST", body: JSON.stringify({ email, password }) }); this.user = r.user; this.renderNav(); this.qs("#loginView").classList.add("hidden"); this.show("dashboard"); this.flash("Bienvenue " + (this.user.name || this.user.email)); }
    catch (e) { err.textContent = e.message || "Identifiants invalides"; err.classList.remove("hidden"); this.flash("Connexion refusée"); }
    finally { btn.disabled = false; btn.textContent = old; }
  },

  // Modal
  openModal(title, bodyHTML) { this.qs("#modalTitle").textContent = title; this.qs("#modalBody").innerHTML = bodyHTML; const m = this.qs("#modal"); m.classList.remove("hidden"); m.classList.add("show"); },
  closeModal() { const m = this.qs("#modal"); m.classList.remove("show"); m.classList.add("hidden"); this.qs("#modalBody").innerHTML = ""; },

  // Dashboard (identique à la dernière version – abrégé ici)
  async renderDashboard() {
    const [stats, ants, stock, openLoans] = await Promise.all([
      this.fetchJSON("/api/stats").catch(() => ({ stock_total: 0, prets_ouverts: 0, benevoles: 0 })),
      this.fetchJSON("/api/antennas").catch(() => []),
      this.fetchJSON("/api/stock").catch(() => []),
      this.fetchJSON("/api/loans/open").catch(() => []),
    ]);
    const overdueDays = this.getSetting("overdue_days", 30);
    const now = Date.now();
    const overdue = openLoans.map(l => ({ ...l, days: this.daysBetween(new Date(l.since).getTime(), now) })).filter(l => l.days > overdueDays);
    const antThreshold = Object.fromEntries(ants.map(a => [a.id, (a.low_stock_threshold ?? this.getSetting("default_threshold", 5))]));
    const lowStock = stock.filter(s => s.quantity <= (antThreshold[s.antenna_id] ?? 5));
    const byAntenna = {}, byType = {};
    stock.forEach(s => { byAntenna[s.antenna] = (byAntenna[s.antenna] || 0) + s.quantity; byType[s.garment_type] = (byType[s.garment_type] || 0) + s.quantity; });

    let hist=[]; try{ const h=await this.fetchJSON('/api/analytics/history'); hist=Array.isArray(h)?h:[]; }catch{ hist = openLoans.map(l=>({date:l.since,type:l.type,antenna:l.antenna,qty:l.qty})); }
    const lendCountByType={}; (hist||[]).forEach(x=>{ const k=x.type||'?'; lendCountByType[k]=(lendCountByType[k]||0)+(x.qty||1); });
    const top10=Object.entries(lendCountByType).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const perMonth=new Array(12).fill(0); (hist||[]).forEach(x=>{ const d=new Date(x.date||Date.now()); const idx=(new Date().getMonth()-d.getMonth()+12)%12; perMonth[idx]+=(x.qty||1); });
    const monthLabels=Array.from({length:12},(_,i)=>{ const d=new Date(); d.setMonth(d.getMonth()-i); return d.toLocaleString(undefined,{month:'short'}); });

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
              <tbody>${lowStock.map(s=>`<tr><td>${s.garment_type}</td><td>${s.size||'—'}</td><td>${s.antenna}</td><td><span class="badge">${s.quantity}</span></td></tr>`).join('')}</tbody></table>`:`<p class="muted">Aucune alerte.</p>`}
          </div>
          <div>
            <div class="chips" style="justify-content:space-between">
              <h3>Retards de prêt</h3>
              <button class="btn btn-ghost" onclick="App.setOverdue()">Seuil: ${overdueDays} j</button>
            </div>
            ${overdue.length?`<table class="table"><thead><tr><th>Bénévole</th><th>Article</th><th>Jours</th><th></th></tr></thead>
              <tbody>${overdue.map(l=>`<tr><td>${l.volunteer}</td><td>${l.type} ${l.size||''}</td>
              <td><span class="badge" style="background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.35);color:#fecaca">${l.days}</span></td>
              <td><button class="btn btn-ghost" onclick="App.returnLoan(${l.id})">Rendu</button></td></tr>`).join('')}</tbody></table>`:`<p class="muted">Aucun retard.</p>`}
          </div>
        </div>

        <div class="grid-2 mt">
          <div class="card"><h3>Stock par antenne</h3>${this.svgBar(Object.entries(byAntenna),320,160)}</div>
          <div class="card"><h3>Stock par type</h3>${this.svgBar(Object.entries(byType),320,160)}</div>
        </div>

        <div class="grid-2 mt">
          <div class="card"><h3>Top 10 le plus prêté</h3>${this.svgBar(top10,320,160)}</div>
          <div class="card"><h3>Saisonnalité (12 derniers mois)</h3>${this.svgBar(monthLabels.map((m,i)=>[m,perMonth[i]||0]).reverse(),320,160)}</div>
        </div>

        <div class="mt"><h3>Carte des antennes</h3>
          <div class="grid-3">
            ${ants.map(a=>`
              <div class="card">
                <div class="chips" style="justify-content:space-between">
                  <div><b>${a.name}</b><div class="muted">${a.address||''}</div></div>
                  ${typeof a.low_stock_threshold==='number'?`<span class="badge">Seuil ${a.low_stock_threshold}</span>`:''}
                </div>
                ${
                  typeof a.lat==='number' && typeof a.lng==='number'
                  ? `<iframe style="width:100%;height:180px;border:0;border-radius:12px;margin-top:.6rem"
                       src="https://www.openstreetmap.org/export/embed.html?bbox=${a.lng-0.01}%2C${a.lat-0.01}%2C${a.lng+0.01}%2C${a.lat+0.01}&layer=mapnik&marker=${a.lat}%2C${a.lng}"></iframe>`
                  : (a.address ? `<iframe style="width:100%;height:180px;border:0;border-radius:12px;margin-top:.6rem"
                       src="https://www.openstreetmap.org/export/embed.html?search=${encodeURIComponent(a.address)}"></iframe>` : `<div class="muted mt">Pas de position</div>`)
                }
              </div>
            `).join('')}
          </div>
        </div>
      </div>`;
  },
  setOverdue(){ const cur=this.getSetting('overdue_days',30); const v=prompt('Nombre de jours avant retard ?', String(cur)); if(!v) return; const n=Math.max(1, parseInt(v,10)||30); this.setSetting('overdue_days', n); this.flash('Seuil mis à jour'); this.renderDashboard(); },
  svgBar(pairs,w=320,h=160){ const pad=20,row=18,gap=6; const data=(pairs||[]).slice(0,8); const max=Math.max(1,...data.map(d=>+d[1]||0)); const height=Math.min(h,pad+data.length*(row+gap)+pad); const bars=data.map((d,i)=>{ const y=pad+i*(row+gap); const val=+d[1]||0; const bw=Math.round((w-120)*(val/max)); const lab=(d[0]||'').toString().slice(0,18); return `<text x="6" y="${y+row-6}" font-size="10" fill="#94a3b8">${lab}</text><rect x="100" y="${y}" width="${bw}" height="${row}" rx="6" ry="6" fill="rgba(56,189,248,.7)"></rect><text x="${100+bw+6}" y="${y+row-6}" font-size="10" fill="#e2e8f0">${val}</text>`; }).join(''); return `<svg viewBox="0 0 ${w} ${height}" width="100%" height="${height}px">${bars}</svg>`; },

  // Antennes (idem version précédente, avec seuil éditable)
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
  async deleteAntenna(id){ if(!confirm('Supprimer cette antenne ?')) return; try{ await this.fetchJSON('/api/antennas/'+id,{method:'DELETE'}); this.renderAntennes(); this.flash('Antenne supprimée'); } catch(e){ this.flash(e.message||'Suppression impossible',false); } },

  // Stock (CRUD + tags réparés)
  async renderStock(){ const el=this.qs('#stock'); const [types, ants]=await Promise.all([this.fetchJSON('/api/types'), this.fetchJSON('/api/antennas')]); this._types=types; this._ants=ants;
    const optType=(v)=>['<option value="">Type</option>'].concat(types.map(t=>`<option value="${t.id}" ${v==t.id?'selected':''}>${t.label}</option>`)).join('');
    const optAnt=(v)=>['<option value="">Antenne</option>'].concat(ants.map(a=>`<option value="${a.id}" ${v==a.id?'selected':''}>${a.name}</option>`)).join('');
    el.innerHTML=`<div class="card">
      <div class="chips" style="justify-content:space-between"><h2>Stock</h2>
        <div class="chips">
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
  async manageTypes(){ const types=await this.fetchJSON('/api/types'); const body=`<table class="table"><thead><tr><th>Type</th><th>Taille ?</th><th></th></tr></thead><tbody>${types.map(t=>`<tr><td>${t.label}</td><td>${t.has_size?'Oui':'Non'}</td><td><button class="btn btn-ghost" onclick="App.deleteType(${t.id})">Supprimer</button></td></tr>`).join('')}</tbody></table>`; this.openModal('Types existants', body); },
  async deleteType(id){ if(!confirm('Supprimer ce type ?\\n(Refusé s’il existe du stock)')) return; try{ await this.fetchJSON('/api/types/'+id,{method:'DELETE'}); this.flash('Type supprimé'); this.closeModal(); this.renderStock(); } catch(e){ this.flash(e.message||'Suppression refusée'); } },
  async saveType(){ const label=this.qs('#new_type').value.trim(); const has_size=this.qs('#new_has_size').checked; if(!label) return this.flash('Libellé requis',false); await this.fetchJSON('/api/types',{method:'POST', body: JSON.stringify({label,has_size})}); this.closeModal(); this.renderStock(); this.flash('Type ajouté'); },
  modalAddStock(){ this.openModal('Ajouter au stock', `<div class="grid-4"><select id="s_type">${this._optType('')}</select><select id="s_ant">${this._optAnt('')}</select><input id="s_size" class="input" placeholder="Taille (optionnel)"><input id="s_qty" class="input" type="number" value="1" min="1" placeholder="Quantité"></div><div class="mt"><input id="s_tags" class="input" placeholder="Tags séparés par des virgules (ex: Hiver, EPS)"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.saveStock()">Enregistrer</button></div>`); },
  async saveStock(){ const t=Number(this.qs('#s_type').value); const a=Number(this.qs('#s_ant').value); const size=this.qs('#s_size').value.trim()||null; const qty=Number(this.qs('#s_qty').value||0); const tags=this.qs('#s_tags').value.split(',').map(x=>x.trim()).filter(Boolean); if(!t||!a||qty<=0) return this.flash('Type, antenne et quantité requis',false); await this.fetchJSON('/api/stock',{method:'POST', body: JSON.stringify({garment_type_id:t, antenna_id:a, size, quantity:qty, tags})}); this.closeModal(); this.loadStock(); this.flash('Stock ajouté'); },
  modalEditStock(id,s){ this.openModal('Modifier un article de stock', `<div class="grid-4"><select id="es_type">${this._optType(s.type_id)}</select><select id="es_ant">${this._optAnt(s.ant_id)}</select><input id="es_size" class="input" value="${s.size||''}" placeholder="Taille"><input id="es_qty" class="input" type="number" value="${s.qty}" min="0"></div><div class="mt"><input id="es_tags" class="input" value="${(s.tags||[]).join(', ')}" placeholder="Tags séparés par des virgules"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.saveEditStock(${id})">Enregistrer</button></div>`); },
  async saveEditStock(id){ const body={ garment_type_id:Number(this.qs('#es_type').value), antenna_id:Number(this.qs('#es_ant').value), size:this.qs('#es_size').value.trim()||null, quantity:Number(this.qs('#es_qty').value||0), tags:this.qs('#es_tags').value.split(',').map(x=>x.trim()).filter(Boolean) }; await this.fetchJSON('/api/stock/'+id,{method:'PUT', body: JSON.stringify(body)}); this.closeModal(); this.loadStock(); this.flash('Article mis à jour'); },
  async deleteStock(id){ if(!confirm('Supprimer cet article ?')) return; try{ await this.fetchJSON('/api/stock/'+id,{method:'DELETE'}); await this.loadStock(); this.flash('Article supprimé'); } catch(e){ this.flash(e.message||'Suppression impossible'); } },

  // Bénévoles (CRUD + recherche + import CSV)
  _volLocal: [],
  async renderBenevoles(){ const el=this.qs('#benevoles'); const data=await this.fetchJSON('/api/volunteers'); this._volLocal=data;
    el.innerHTML=`<div class="card">
      <div class="chips" style="justify-content:space-between">
        <h2>Bénévoles</h2>
        <div class="chips">
          <input id="volSearch" class="input" placeholder="Rechercher (nom, prénom, note)" style="min-width:260px">
          <a class="btn btn-ghost" href="/api/volunteers/template.csv">⬇️ Modèle CSV</a>
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
  async addVol(){ const first_name=this.qs('#v_first').value.trim(); const last_name=this.qs('#v_last').value.trim(); const note=this.qs('#v_note').value.trim(); if(!first_name||!last_name) return this.flash('Prénom et nom requis',false); await this.fetchJSON('/api/volunteers',{method:'POST', body: JSON.stringify({first_name,last_name,note})}); this.closeModal(); this.renderBenevoles(); this.flash('Bénévole créé'); },
  modalEditVol(id,v){ this.openModal('Modifier bénévole', `<div class="grid-3"><input id="e_first" class="input" value="${v.first_name}"><input id="e_last" class="input" value="${v.last_name}"><input id="e_note" class="input" value="${v.note||''}"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.saveEditVol(${id})">Enregistrer</button></div>`); },
  async saveEditVol(id){ const first_name=this.qs('#e_first').value.trim(), last_name=this.qs('#e_last').value.trim(), note=this.qs('#e_note').value.trim(); await this.fetchJSON('/api/volunteers/'+id,{method:'PUT', body: JSON.stringify({first_name,last_name,note})}); this.closeModal(); this.renderBenevoles(); this.flash('Bénévole mis à jour'); },
  async deleteVol(id){ if(!confirm('Supprimer ce bénévole ?')) return; try{ await this.fetchJSON('/api/volunteers/'+id,{method:'DELETE'}); await this.renderBenevoles(); this.flash('Bénévole supprimé'); } catch(e){ this.flash(e.message||'Suppression impossible'); } },
  async viewVol(id,v){ const loans=await this.fetchJSON(`/api/volunteers/${id}/loans`); const html=`<div class="grid-2"><div><div class="muted">Nom</div><div class="badge">${v.last_name}</div></div><div><div class="muted">Prénom</div><div class="badge">${v.first_name}</div></div></div><div class="mt"><div class="muted">Notes</div><div class="card" style="padding:.6rem;">${v.note||"<span class='muted'>Aucune note</span>"}</div></div><div class="mt"><h3>Prêts en cours</h3>${loans.length?`<table class="table"><thead><tr><th>Article</th><th>Qté</th><th>Depuis</th></tr></thead><tbody>${loans.map(l=>`<tr><td>${l.type} / ${l.size||'—'}</td><td>${l.qty}</td><td>${new Date(l.since).toLocaleString()}</td></tr>`).join('')}</tbody></table>`:'<p class="muted">Aucun prêt en cours</p>'}</div>`; this.openModal('Détails bénévole', html); },
  async importVolunteersCSV(file){ try{ const fd=new FormData(); fd.append('file', file, file.name); const res=await fetch('/api/volunteers/import',{method:'POST', body: fd}); const data=await res.json(); if(!res.ok) throw new Error((data&&(data.error||data.message))||'Import refusé'); this.flash(`Import: +${data.added} ajoutés, ${data.skipped} ignorés (${data.total} lignes)`); await this.renderBenevoles(); } catch(e){ this.flash(e.message||'Erreur import CSV'); } },

  // Prêts
  async renderPrets(){ const el=this.qs('#prets'); const r=await this.fetchJSON('/api/loans/open'); el.innerHTML=`<div class="card"><h2>Prêts en cours</h2><table class="table"><thead><tr><th>Bénévole</th><th>Article</th><th>Qté</th><th>Depuis</th><th></th></tr></thead><tbody>${r.map(l=>`<tr><td>${l.volunteer}</td><td>${l.type} / ${l.size||'—'} @ ${l.antenna}</td><td>${l.qty}</td><td>${new Date(l.since).toLocaleString()}</td><td><button class="btn btn-ghost" onclick="App.returnLoan(${l.id})">Marquer rendu</button></td></tr>`).join('')}</tbody></table></div>`; },
  async returnLoan(id){ await this.fetchJSON('/api/loans/return/'+id,{method:'POST'}); this.renderPrets(); this.flash('Prêt rendu'); },

  // Inventaire
  async renderInventaire(){ const el=this.qs('#inventaire'); const ants=await this.fetchJSON('/api/antennas'); el.innerHTML=`<div class="card"><h2>Inventaire / Audit</h2><div class="grid-2"><select id="inv_ant">${['<option value="">Choisir une antenne</option>'].concat(ants.map(a=>`<option value="${a.id}">${a.name}</option>`)).join('')}</select><button class="btn btn-primary" onclick="App.startInventory()">Démarrer</button></div><div id="invZone" class="mt"></div></div>`; },
  async startInventory(){ const ant=Number(this.qs('#inv_ant').value||0); if(!ant) return this.flash('Choisis une antenne'); const sess=await this.fetchJSON('/api/inventory/start',{method:'POST', body: JSON.stringify({antenna_id:ant})}); const items=await this.fetchJSON(`/api/inventory/${sess.id}/items`); const zone=this.qs('#invZone'); zone.innerHTML=`<div class="card"><div class="chips" style="justify-content:space-between"><h3>Session #${sess.id} — ${items.antenna}</h3><button class="btn btn-ghost" onclick="App.closeInventory(${sess.id})">Valider et clôturer</button></div><p class="muted">Tape la quantité physiquement comptée (mobile friendly).</p><table class="table"><thead><tr><th>Article</th><th>Taille</th><th>Stock</th><th>Compté</th></tr></thead><tbody>${items.rows.map(r=>`<tr><td>${r.type}</td><td>${r.size||'—'}</td><td>${r.quantity}</td><td><input class="input" type="number" min="0" value="${r.quantity}" onblur="App.saveCount(${sess.id},${r.stock_item_id},this.value)"></td></tr>`).join('')}</tbody></table></div>`; },
  async saveCount(sid,stockId,val){ const counted=Math.max(0, Number(val||0)); await this.fetchJSON(`/api/inventory/${sid}/count`,{method:'POST', body: JSON.stringify({stock_item_id:stockId, counted_qty:counted})}); this.flash('Comptage enregistré'); },
  async closeInventory(sid){ await this.fetchJSON(`/api/inventory/${sid}/close`,{method:'POST'}); this.flash('Inventaire clôturé ✅'); this.renderInventaire(); },

  // Admin
  async renderAdmin(){ const el=this.qs('#admin'); const users=await this.fetchJSON('/api/users'); const overdue=this.getSetting('overdue_days',30); const defThr=this.getSetting('default_threshold',5); el.innerHTML=`<div class="card"><div class="chips" style="justify-content:space-between"><h2>Administration</h2><div class="chips"><button class="btn btn-ghost" onclick="App.viewLogs()">Journaux</button><button class="btn btn-primary" onclick="App.modalAddUser()">+ Utilisateur</button></div></div><div class="grid-3 mt"><div><label class="muted">Jours avant retard</label><input id="set_overdue" class="input" type="number" min="1" value="${overdue}" onblur="App.saveAdminSettings()"></div><div><label class="muted">Seuil stock bas par défaut</label><input id="set_threshold" class="input" type="number" min="0" value="${defThr}" onblur="App.saveAdminSettings()"></div><div class="muted" style="display:flex;align-items:flex-end">Réglages locaux appliqués immédiatement.</div></div><h3 class="mt">Utilisateurs</h3><table class="table"><thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th></th></tr></thead><tbody>${users.map(u=>`<tr><td>${u.name}</td><td>${u.email}</td><td><span class="badge">${u.role}</span></td><td class="chips"><button class="btn btn-ghost" onclick='App.modalEditUser(${u.id}, ${JSON.stringify(u).replaceAll("'","&apos;")})'>Modifier</button><button class="btn btn-ghost" onclick='App.deleteUser(${u.id})'>Supprimer</button></td></tr>`).join('')}</tbody></table></div>`; },
  saveAdminSettings(){ const od=Math.max(1, Number(this.qs('#set_overdue').value)||30); const thr=Math.max(0, Number(this.qs('#set_threshold').value)||5); this.setSetting('overdue_days', od); this.setSetting('default_threshold', thr); this.flash('Réglages enregistrés'); },
  async viewLogs(){ const logs=await this.fetchJSON('/api/logs?limit=200'); this.openModal('Journaux récents', `<div style="max-height:55vh;overflow:auto"><table class="table"><thead><tr><th>Date</th><th>Acteur</th><th>Action</th><th>Cible</th><th>Détails</th></tr></thead><tbody>${logs.map(l=>`<tr><td>${new Date(l.at).toLocaleString()}</td><td>${l.actor||'public'}</td><td>${l.action}</td><td>${l.entity}#${l.entity_id||''}</td><td class="muted">${l.details||''}</td></tr>`).join('')}</tbody></table></div>`); },
  modalAddUser(){ this.openModal('Créer un utilisateur', `<div class="grid-3"><input id="u_name" class="input" placeholder="Nom"><input id="u_email" class="input" placeholder="Email"><input id="u_pass" class="input" type="password" placeholder="Mot de passe"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.addUser()">Enregistrer</button></div>`); },
  async addUser(){ const name=this.qs('#u_name').value.trim(), email=this.qs('#u_email').value.trim(), password=this.qs('#u_pass').value; if(!name||!email||!password) return this.flash('Tous les champs sont requis',false); try{ await this.fetchJSON('/api/users',{method:'POST', body: JSON.stringify({name,email,password,role:'admin'})}); this.closeModal(); this.renderAdmin(); this.flash('Compte admin créé'); } catch(e){ this.flash(e.message||'Création refusée', false); } },
  modalEditUser(id,u){ this.openModal('Modifier utilisateur', `<div class="grid-3"><input id="eu_name" class="input" value="${u.name}"><input id="eu_role" class="input" value="${u.role}"><input id="eu_pass" class="input" type="password" placeholder="Nouveau mot de passe (optionnel)"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.saveUser(${id})">Enregistrer</button></div>`); },
  async saveUser(id){ const name=this.qs('#eu_name').value.trim(), role=this.qs('#eu_role').value.trim(), password=this.qs('#eu_pass').value; await this.fetchJSON('/api/users/'+id,{method:'PUT', body: JSON.stringify({name,role,password})}); this.closeModal(); this.renderAdmin(); this.flash('Compte mis à jour'); },
  async deleteUser(id){ if(!confirm('Supprimer ce compte ?')) return; try{ await this.fetchJSON('/api/users/'+id,{method:'DELETE'}); this.renderAdmin(); this.flash('Compte supprimé'); } catch(e){ this.flash(e.message||'Suppression refusée', false); } },

  // Public (QR antenne)
  async renderPretPublic(){ const el=this.qs('#pretPublic'); el.innerHTML=`<div class="card"><h2>Prêt public</h2><div class="grid-3"><input id='pubFN' class='input' placeholder='Prénom'><input id='pubLN' class='input' placeholder='Nom'><button class='btn btn-primary' onclick='App.findVolPublic()'>Chercher</button></div><div id='pubResult' class="mt"></div></div>`; },
  async findVolPublic(){ const fn=this.qs('#pubFN').value; const ln=this.qs('#pubLN').value; try{ const v=await this.fetchJSON(`/api/public/volunteer?first_name=${encodeURIComponent(fn)}&last_name=${encodeURIComponent(ln)}`); this.showVolPublic(v); }catch{ this.qs('#pubResult').innerHTML='<p class="alert">Bénévole non trouvé</p>'; } },
  async showVolPublic(v){ const stock=await this.fetchJSON(`/api/public/stock${this.publicAntennaId?`?antenna_id=${this.publicAntennaId}`:''}`); const loans=await this.fetchJSON(`/api/public/loans?volunteer_id=${v.id}`); this.qs('#pubResult').innerHTML=`<h3>${v.first_name} ${v.last_name}</h3><h4>Stock disponible</h4><ul>${stock.map(s=>`<li>${s.type} ${s.size||''} (${s.quantity}) <button class='btn btn-ghost' onclick='App.borrow(${v.id},${s.id})'>Emprunter</button></li>`).join('')}</ul><h4>Prêts en cours</h4><ul>${loans.map(l=>`<li>${l.type} ${l.size||''} depuis ${new Date(l.since).toLocaleDateString()} <button class='btn btn-ghost' onclick='App.returnLoanPublic(${l.id})'>Rendre</button></li>`).join('')}</ul>`; },
  async borrow(volId, stockId){ await this.fetchJSON('/api/public/loan',{method:'POST', body: JSON.stringify({volunteer_id:volId, stock_item_id:stockId, qty:1})}); this.flash('Tenue empruntée'); this.findVolPublic(); },
  async returnLoanPublic(id){ await this.fetchJSON('/api/public/return/'+id,{method:'POST'}); this.flash('Tenue rendue'); this.findVolPublic(); },
};

window.App = App;

document.addEventListener("DOMContentLoaded", () => {
  const onEnter = (e) => { if (e.key === "Enter") { e.preventDefault(); App.login(); } };
  const em = document.getElementById("loginEmail");
  const pw = document.getElementById("loginPass");
  if (em) em.addEventListener("keydown", onEnter);
  if (pw) pw.addEventListener("keydown", onEnter);
  App.init();
});
