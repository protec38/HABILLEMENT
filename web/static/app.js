const App = {
  user:null,
  publicAntennaId:null,
  nav:[
    {id:'dashboard', label:'Dashboard', auth:true},
    {id:'antennes', label:'Antennes', auth:true},
    {id:'stock', label:'Stock', auth:true},
    {id:'benevoles', label:'Bénévoles', auth:true},
    {id:'prets', label:'Prêts en cours', auth:true},
    {id:'inventaire', label:'Inventaire', auth:true},
    {id:'admin', label:'Administration', auth:true},
    {id:'pretPublic', label:'Prêt publique', auth:false},
  ],
  qs:(s)=>document.querySelector(s),

  async fetchJSON(url, opts={}){
    opts.headers={'Content-Type':'application/json', ...(opts.headers||{})};
    const res = await fetch(url, opts);
    let data=null; try{ data=await res.json(); }catch{}
    if(!res.ok){ const msg=(data && (data.error||data.message)) || `Erreur ${res.status}`; throw new Error(msg); }
    return data;
  },
  flash(msg){ const el=document.getElementById('flash'); el.innerHTML=`<div class="toast">${msg}</div>`; setTimeout(()=>el.innerHTML='',2500); },

  show(id){
    document.querySelectorAll('.screen').forEach(e=>e.classList.add('hidden'));
    this.qs('#'+id)?.classList.remove('hidden');
    document.querySelectorAll('.nav a').forEach(a=>a.classList.toggle('active', a.dataset.id===id));
    if(id==='dashboard') this.renderDashboard();
    if(id==='antennes') this.renderAntennes();
    if(id==='stock') this.renderStock();
    if(id==='benevoles') this.renderBenevoles();
    if(id==='prets') this.renderPrets();
    if(id==='inventaire') this.renderInventaire();
    if(id==='admin') this.renderAdmin();
    if(id==='pretPublic') this.renderPretPublic();
  },
  renderNav(){
    const el=this.qs('#nav'); el.innerHTML=''; const frag=document.createDocumentFragment();
    (this.user?this.nav: this.nav.filter(x=>!x.auth)).forEach(item=>{
      const a=document.createElement('a'); a.href='#'; a.dataset.id=item.id; a.textContent=item.label;
      a.onclick=(e)=>{e.preventDefault(); this.show(item.id);}; frag.appendChild(a);
    });
    if(this.user){
      const lo=document.createElement('a'); lo.href='#'; lo.textContent='Déconnexion';
      lo.onclick=async(e)=>{e.preventDefault(); await this.fetchJSON('/api/logout',{method:'POST'}); this.user=null; location.href='/';};
      frag.appendChild(lo);
    }
    el.appendChild(frag);
  },
  async init(){
    const m=location.pathname.match(/^\/a\/(\d+)/); if(m){ this.publicAntennaId=Number(m[1]); }
    // Si URL publique : masquer complètement le login
    if(this.publicAntennaId){ document.getElementById('loginView').classList.add('hidden'); this.renderNav(); this.show('pretPublic'); return; }
    try{ const me=await this.fetchJSON('/api/me'); if(me.ok){ this.user=me.user; this.renderNav(); this.qs('#loginView').classList.add('hidden'); this.show('dashboard'); return; } }catch{}
    this.renderNav(); this.qs('#loginView').classList.remove('hidden');
  },
  async login(){
    const btn=document.getElementById('loginBtn');
    const email=this.qs('#loginEmail').value.trim(); const password=this.qs('#loginPass').value;
    const errBox=this.qs('#loginError'); errBox.classList.add('hidden'); errBox.textContent='';
    if(!email||!password){ errBox.textContent="Email et mot de passe requis"; errBox.classList.remove('hidden'); return; }
    btn.disabled=true; const oldTxt=btn.textContent; btn.textContent='Connexion...';
    try{ const r=await this.fetchJSON('/api/login',{method:'POST', body:JSON.stringify({email,password})});
      this.user=r.user; this.renderNav(); this.qs('#loginView').classList.add('hidden'); this.show('dashboard'); this.flash('Bienvenue '+(this.user.name||this.user.email));
    }catch(e){ errBox.textContent=e.message||'Identifiants invalides'; errBox.classList.remove('hidden'); this.flash('Connexion refusée'); }
    finally{ btn.disabled=false; btn.textContent=oldTxt; }
  },

  // Modal
  openModal(title, bodyHTML){ this.qs('#modalTitle').textContent=title; this.qs('#modalBody').innerHTML=bodyHTML; const m=this.qs('#modal'); m.classList.remove('hidden'); m.classList.add('show'); },
  closeModal(){ const m=this.qs('#modal'); m.classList.remove('show'); m.classList.add('hidden'); this.qs('#modalBody').innerHTML=''; },

  // Dashboard
  async renderDashboard(){
    const el=this.qs('#dashboard'); const r=await this.fetchJSON('/api/stats');
    el.innerHTML=`<div class="card">
      <h2>Tableau de bord</h2>
      <div class="grid-3">
        <div>Total tenues en stock: <b>${r.stock_total}</b></div>
        <div>Prêts ouverts: <b>${r.prets_ouverts}</b></div>
        <div>Bénévoles: <b>${r.benevoles}</b></div>
      </div>
      <div class="chips mt">
        <a class="btn btn-ghost" href="/api/export/stock.csv">⬇️ Export stock</a>
        <a class="btn btn-ghost" href="/api/export/loans.csv">⬇️ Export prêts en cours</a>
        <a class="btn btn-ghost" href="/api/export/loans_history.csv">⬇️ Export historique</a>
      </div>
    </div>`;
  },

  // Antennes CRUD
  async renderAntennes(){ /* identique à la version précédente */ this.qs('#antennes').innerHTML='<div class="card"><h2>Chargement...</h2></div>'; const ants=await this.fetchJSON('/api/antennas'); this.qs('#antennes').innerHTML=`<div class="card"><div class="chips" style="justify-content:space-between"><h2>Antennes</h2><button class="btn btn-primary" onclick="App.modalAddAntenna()">+ Antenne</button></div><table class="table"><thead><tr><th>Nom</th><th>Adresse</th><th></th></tr></thead><tbody>${ants.map(a=>`<tr><td>${a.name}</td><td class="muted">${a.address||''}</td><td class="chips"><button class="btn btn-ghost" onclick='App.modalEditAntenna(${a.id}, ${JSON.stringify(a).replaceAll("'","&apos;")})'>Modifier</button><button class="btn btn-ghost" onclick='App.deleteAntenna(${a.id})'>Supprimer</button></td></tr>`).join('')}</tbody></table></div>`; },
  modalAddAntenna(){ this.openModal('Nouvelle antenne', `<div class="grid-2"><input id="ant_name" class="input" placeholder="Nom"><input id="ant_addr" class="input" placeholder="Adresse"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.saveAntenna()">Enregistrer</button></div>`); },
  async saveAntenna(){ const name=this.qs('#ant_name').value.trim(); const address=this.qs('#ant_addr').value.trim(); if(!name) return this.flash('Nom requis',false); await this.fetchJSON('/api/antennas',{method:'POST', body: JSON.stringify({name,address})}); this.closeModal(); this.renderAntennes(); this.flash('Antenne créée'); },
  modalEditAntenna(id,a){ this.openModal('Modifier antenne', `<div class="grid-2"><input id="e_ant_name" class="input" value="${a.name}"><input id="e_ant_addr" class="input" value="${a.address||''}"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.updateAntenna(${id})">Enregistrer</button></div>`); },
  async updateAntenna(id){ const name=this.qs('#e_ant_name').value.trim(); const address=this.qs('#e_ant_addr').value.trim(); await this.fetchJSON('/api/antennas/'+id,{method:'PUT', body: JSON.stringify({name,address})}); this.closeModal(); this.renderAntennes(); this.flash('Antenne mise à jour'); },
  async deleteAntenna(id){ if(!confirm('Supprimer cette antenne ?')) return; try{ await this.fetchJSON('/api/antennas/'+id,{method:'DELETE'}); this.renderAntennes(); this.flash('Antenne supprimée'); }catch(e){ this.flash(e.message||'Suppression impossible',false); } },

  // Stock + filtres + selects
  async renderStock(){ /* identique à la dernière version envoyée, non répété ici par manque de place */ return this.renderStock_impl ??= this._renderStockImpl(), this.renderStock_impl(); },
  _renderStockImpl(){ /* renvoie une fonction */ const self=this; return async function(){
    const el=self.qs('#stock');
    const [types, ants] = await Promise.all([ self.fetchJSON('/api/types'), self.fetchJSON('/api/antennas') ]);
    self._types=types; self._ants=ants;
    const optType=(v)=>['<option value="">Type</option>'].concat(types.map(t=>`<option value="${t.id}" ${v==t.id?'selected':''}>${t.label}</option>`)).join('');
    const optAnt=(v)=>['<option value="">Antenne</option>'].concat(ants.map(a=>`<option value="${a.id}" ${v==a.id?'selected':''}>${a.name}</option>`)).join('');
    el.innerHTML=`<div class="card"><div class="chips" style="justify-content:space-between"><h2>Stock</h2><div class="chips"><button class="btn btn-ghost" onclick="App.modalAddType()">+ Type</button><button class="btn btn-primary" onclick="App.modalAddStock()">+ Article</button></div></div><div class="grid-3 mt"><select id="f_type">${optType('')}</select><select id="f_ant">${optAnt('')}</select><button class="btn btn-ghost" onclick="App.loadStock()">Filtrer</button></div><div id="stockTable" class="mt"></div></div>`;
    self._optType=optType; self._optAnt=optAnt; await self.loadStock();
  }},
  async loadStock(){ const t=this.qs('#f_type')?.value||''; const a=this.qs('#f_ant')?.value||''; const qs=[]; if(t) qs.push(`type_id=${t}`); if(a) qs.push(`antenna_id=${a}`); const stock=await this.fetchJSON('/api/stock'+(qs.length?`?${qs.join('&')}`:'')); this.qs('#stockTable').innerHTML = `<table class="table"><thead><tr><th>Type</th><th>Taille</th><th>Antenne</th><th>Qté</th><th></th></tr></thead><tbody>${stock.map(s=>`<tr><td>${s.garment_type}</td><td>${s.size||'—'}</td><td>${s.antenna}</td><td>${s.quantity}</td><td class="chips"><button class="btn btn-ghost" onclick='App.modalEditStock(${s.id}, ${JSON.stringify({id:s.id,type_id:s.garment_type_id,ant_id:s.antenna_id,size:s.size||"",qty:s.quantity}).replaceAll("'","&apos;")})'>Modifier</button><button class="btn btn-ghost" onclick="App.deleteStock(${s.id})">Supprimer</button></td></tr>`).join('')}</tbody></table>`; },
  modalAddType(){ this.openModal('Ajouter un type', `<div class="grid-2"><input id="new_type" class="input" placeholder="Libellé (ex: Parka)"><label><input id="new_has_size" type="checkbox" checked> Avec taille</label></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.saveType()">Enregistrer</button></div>`); },
  async saveType(){ const label=this.qs('#new_type').value.trim(); const has_size=this.qs('#new_has_size').checked; if(!label) return this.flash('Libellé requis',false); await this.fetchJSON('/api/types',{method:'POST', body: JSON.stringify({label,has_size})}); this.closeModal(); this.renderStock(); this.flash('Type ajouté'); },
  modalAddStock(){ this.openModal('Ajouter au stock', `<div class="grid-4"><select id="s_type">${this._optType('')}</select><select id="s_ant">${this._optAnt('')}</select><input id="s_size" class="input" placeholder="Taille (optionnel)"><input id="s_qty" class="input" type="number" value="1" min="1" placeholder="Quantité"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.saveStock()">Enregistrer</button></div>`); },
  async saveStock(){ const t=Number(this.qs('#s_type').value); const a=Number(this.qs('#s_ant').value); const size=this.qs('#s_size').value.trim()||null; const qty=Number(this.qs('#s_qty').value||0); if(!t||!a||qty<=0) return this.flash('Type, antenne et quantité requis',false); await this.fetchJSON('/api/stock',{method:'POST', body: JSON.stringify({garment_type_id:t, antenna_id:a, size, quantity:qty})}); this.closeModal(); this.loadStock(); this.flash('Stock ajouté'); },
  modalEditStock(id, s){ this.openModal('Modifier un article de stock', `<div class="grid-4"><select id="es_type">${this._optType(s.type_id)}</select><select id="es_ant">${this._optAnt(s.ant_id)}</select><input id="es_size" class="input" value="${s.size||''}" placeholder="Taille"><input id="es_qty" class="input" type="number" value="${s.qty}" min="0"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.saveEditStock(${id})">Enregistrer</button></div>`); },
  async saveEditStock(id){ const body={ garment_type_id:Number(this.qs('#es_type').value), antenna_id:Number(this.qs('#es_ant').value), size:this.qs('#es_size').value.trim()||null, quantity:Number(this.qs('#es_qty').value||0) }; await this.fetchJSON('/api/stock/'+id,{method:'PUT', body: JSON.stringify(body)}); this.closeModal(); this.loadStock(); this.flash('Article mis à jour'); },
  async deleteStock(id){ if(!confirm('Supprimer cet article ?')) return; await this.fetchJSON('/api/stock/'+id,{method:'DELETE'}); this.loadStock(); this.flash('Article supprimé'); },

  // Bénévoles CRUD (identique version précédente)
  async renderBenevoles(){ const el=this.qs('#benevoles'); const data=await this.fetchJSON('/api/volunteers'); el.innerHTML=`<div class="card"><div class="chips" style="justify-content:space-between"><h2>Bénévoles</h2><button class="btn btn-primary" onclick="App.modalAddVol()">+ Bénévole</button></div><table class="table"><thead><tr><th>Nom</th><th>Prénom</th><th>Notes</th><th></th></tr></thead><tbody>${data.map(v=>`<tr><td>${v.last_name}</td><td>${v.first_name}</td><td class="muted">${v.note||''}</td><td class="chips"><button class="btn btn-ghost" onclick='App.modalEditVol(${v.id}, ${JSON.stringify(v).replaceAll("'","&apos;")})'>Modifier</button><button class="btn btn-ghost" onclick='App.deleteVol(${v.id})'>Supprimer</button><button class="btn btn-ghost" onclick='App.viewVol(${v.id}, ${JSON.stringify(v).replaceAll("'","&apos;")})'>Voir</button></td></tr>`).join('')}</tbody></table></div>`; },
  modalAddVol(){ this.openModal('Nouveau bénévole', `<div class="grid-3"><input id="v_first" class="input" placeholder="Prénom"><input id="v_last" class="input" placeholder="Nom"><input id="v_note" class="input" placeholder="Infos"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.addVol()">Enregistrer</button></div>`); },
  async addVol(){ const first_name=this.qs('#v_first').value.trim(); const last_name=this.qs('#v_last').value.trim(); const note=this.qs('#v_note').value.trim(); if(!first_name||!last_name) return this.flash('Prénom et nom requis',false); await this.fetchJSON('/api/volunteers',{method:'POST', body: JSON.stringify({first_name,last_name,note})}); this.closeModal(); this.renderBenevoles(); this.flash('Bénévole créé'); },
  modalEditVol(id, v){ this.openModal('Modifier bénévole', `<div class="grid-3"><input id="e_first" class="input" value="${v.first_name}"><input id="e_last" class="input" value="${v.last_name}"><input id="e_note" class="input" value="${v.note||''}"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.saveEditVol(${id})">Enregistrer</button></div>`); },
  async saveEditVol(id){ const first_name=this.qs('#e_first').value.trim(), last_name=this.qs('#e_last').value.trim(), note=this.qs('#e_note').value.trim(); await this.fetchJSON('/api/volunteers/'+id,{method:'PUT', body: JSON.stringify({first_name,last_name,note})}); this.closeModal(); this.renderBenevoles(); this.flash('Bénévole mis à jour'); },
  async deleteVol(id){ if(!confirm('Supprimer ce bénévole ?')) return; await this.fetchJSON('/api/volunteers/'+id,{method:'DELETE'}); this.renderBenevoles(); this.flash('Bénévole supprimé'); },
  async viewVol(id, v){ const loans=await this.fetchJSON(`/api/volunteers/${id}/loans`); const html = `<div class="grid-2"><div><div class="muted">Nom</div><div class="badge">${v.last_name}</div></div><div><div class="muted">Prénom</div><div class="badge">${v.first_name}</div></div></div><div class="mt"><div class="muted">Notes</div><div class="card" style="padding:.6rem;">${v.note || '<span class="muted">Aucune note</span>'}</div></div><div class="mt"><h3>Prêts en cours</h3>${loans.length ? `<table class="table"><thead><tr><th>Article</th><th>Qté</th><th>Depuis</th></tr></thead><tbody>${loans.map(l=>`<tr><td>${l.type} / ${l.size||'—'}</td><td>${l.qty}</td><td>${new Date(l.since).toLocaleString()}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aucun prêt en cours</p>'}</div>`; this.openModal('Détails bénévole', html); },

  // Prêts en cours (admin)
  async renderPrets(){ const el=this.qs('#prets'); const r=await this.fetchJSON('/api/loans/open'); el.innerHTML=`<div class="card"><h2>Prêts en cours</h2><table class="table"><thead><tr><th>Bénévole</th><th>Article</th><th>Qté</th><th>Depuis</th><th></th></tr></thead><tbody>${r.map(l=>`<tr><td>${l.volunteer}</td><td>${l.type} / ${l.size||'—'} @ ${l.antenna}</td><td>${l.qty}</td><td>${new Date(l.since).toLocaleString()}</td><td><button class="btn btn-ghost" onclick="App.returnLoan(${l.id})">Marquer rendu</button></td></tr>`).join('')}</tbody></table></div>`; },
  async returnLoan(id){ await this.fetchJSON('/api/loans/return/'+id,{method:'POST'}); this.renderPrets(); this.flash('Prêt rendu'); },

  // Inventaire / Audit
  async renderInventaire(){
    const el=this.qs('#inventaire');
    const ants=await this.fetchJSON('/api/antennas');
    el.innerHTML=`<div class="card">
      <h2>Inventaire / Audit</h2>
      <div class="grid-2">
        <select id="inv_ant">
          ${['<option value="">Choisir une antenne</option>'].concat(ants.map(a=>`<option value="${a.id}">${a.name}</option>`)).join('')}
        </select>
        <button class="btn btn-primary" onclick="App.startInventory()">Démarrer</button>
      </div>
      <div id="invZone" class="mt"></div>
    </div>`;
  },
  async startInventory(){
    const ant=Number(this.qs('#inv_ant').value||0); if(!ant) return this.flash('Choisis une antenne');
    const sess=await this.fetchJSON('/api/inventory/start',{method:'POST', body: JSON.stringify({antenna_id:ant})});
    const items=await this.fetchJSON(`/api/inventory/${sess.id}/items`);
    const zone=this.qs('#invZone');
    zone.innerHTML=`<div class="card">
      <div class="chips" style="justify-content:space-between">
        <h3>Session #${sess.id} — ${items.antenna}</h3>
        <button class="btn btn-ghost" onclick="App.closeInventory(${sess.id})">Valider et clôturer</button>
      </div>
      <p class="muted">Tape la quantité physiquement comptée (mobile friendly).</p>
      <table class="table"><thead><tr><th>Article</th><th>Taille</th><th>Stock</th><th>Compté</th></tr></thead><tbody>
        ${items.rows.map(r=>`<tr>
          <td>${r.type}</td><td>${r.size||'—'}</td><td>${r.quantity}</td>
          <td><input class="input" type="number" min="0" value="${r.quantity}" onblur="App.saveCount(${sess.id},${r.stock_item_id},this.value)"></td>
        </tr>`).join('')}
      </tbody></table>
    </div>`;
  },
  async saveCount(sid, stockId, val){ const counted=Math.max(0, Number(val||0)); await this.fetchJSON(`/api/inventory/${sid}/count`,{method:'POST', body: JSON.stringify({stock_item_id:stockId, counted_qty:counted})}); this.flash('Comptage enregistré'); },
  async closeInventory(sid){ await this.fetchJSON(`/api/inventory/${sid}/close`,{method:'POST'}); this.flash('Inventaire clôturé ✅'); this.renderInventaire(); },

  // Administration (users + logs)
  async renderAdmin(){
    const el=this.qs('#admin'); const users=await this.fetchJSON('/api/users');
    el.innerHTML=`<div class="card">
      <div class="chips" style="justify-content:space-between"><h2>Administration</h2>
        <div class="chips">
          <button class="btn btn-ghost" onclick="App.viewLogs()">Journaux</button>
          <button class="btn btn-primary" onclick="App.modalAddUser()">+ Utilisateur</button>
        </div>
      </div>
      <table class="table"><thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th></th></tr></thead><tbody>
        ${users.map(u=>`<tr><td>${u.name}</td><td>${u.email}</td><td><span class="badge">${u.role}</span></td><td class="chips"><button class="btn btn-ghost" onclick='App.modalEditUser(${u.id}, ${JSON.stringify(u).replaceAll("'","&apos;")})'>Modifier</button><button class="btn btn-ghost" onclick='App.deleteUser(${u.id})'>Supprimer</button></td></tr>`).join('')}
      </tbody></table>
    </div>`;
  },
  async viewLogs(){
    const logs=await this.fetchJSON('/api/logs?limit=200');
    this.openModal('Journaux récents', `
      <div style="max-height:55vh;overflow:auto">
      <table class="table"><thead><tr><th>Date</th><th>Acteur</th><th>Action</th><th>Cible</th><th>Détails</th></tr></thead><tbody>
      ${logs.map(l=>`<tr><td>${new Date(l.at).toLocaleString()}</td><td>${l.actor||'public'}</td><td>${l.action}</td><td>${l.entity}#${l.entity_id||''}</td><td class="muted">${l.details||''}</td></tr>`).join('')}
      </tbody></table></div>`);
  },
  modalAddUser(){ this.openModal('Créer un utilisateur', `<div class="grid-3"><input id="u_name" class="input" placeholder="Nom"><input id="u_email" class="input" placeholder="Email"><input id="u_pass" class="input" type="password" placeholder="Mot de passe"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.addUser()">Enregistrer</button></div>`); },
  async addUser(){ const name=this.qs('#u_name').value.trim(), email=this.qs('#u_email').value.trim(), password=this.qs('#u_pass').value; if(!name||!email||!password) return this.flash('Tous les champs sont requis', false); try{ await this.fetchJSON('/api/users',{method:'POST', body: JSON.stringify({name,email,password,role:'admin'})}); this.closeModal(); this.renderAdmin(); this.flash('Compte admin créé'); } catch(e){ this.flash(e.message||'Création refusée', false); } },
  modalEditUser(id,u){ this.openModal('Modifier utilisateur', `<div class="grid-3"><input id="eu_name" class="input" value="${u.name}"><input id="eu_role" class="input" value="${u.role}"><input id="eu_pass" class="input" type="password" placeholder="Nouveau mot de passe (optionnel)"></div><div class="chips" style="justify-content:flex-end"><button class="btn btn-primary" onclick="App.saveUser(${id})">Enregistrer</button></div>`); },
  async saveUser(id){ const name=this.qs('#eu_name').value.trim(), role=this.qs('#eu_role').value.trim(), password=this.qs('#eu_pass').value; await this.fetchJSON('/api/users/'+id,{method:'PUT', body: JSON.stringify({name,role,password})}); this.closeModal(); this.renderAdmin(); this.flash('Compte mis à jour'); },
  async deleteUser(id){ if(!confirm('Supprimer ce compte ?')) return; try{ await this.fetchJSON('/api/users/'+id,{method:'DELETE'}); this.renderAdmin(); this.flash('Compte supprimé'); } catch(e){ this.flash(e.message||'Suppression refusée', false); } },

  // Public (QR)
  async renderPretPublic(){
    const el=this.qs('#pretPublic');
    el.innerHTML=`<div class="card"><h2>Prêt public</h2>
      <div class="grid-3"><input id='pubFN' class='input' placeholder='Prénom'><input id='pubLN' class='input' placeholder='Nom'><button class='btn btn-primary' onclick='App.findVolPublic()'>Chercher</button></div>
      <div id='pubResult' class="mt"></div></div>`;
  },
  async findVolPublic(){ const fn=this.qs('#pubFN').value; const ln=this.qs('#pubLN').value;
    try{ const v=await this.fetchJSON(`/api/public/volunteer?first_name=${encodeURIComponent(fn)}&last_name=${encodeURIComponent(ln)}`); this.showVolPublic(v);
    }catch{ this.qs('#pubResult').innerHTML='<p class="alert">Bénévole non trouvé</p>'; } },
  async showVolPublic(v){
    const el=this.qs('#pubResult');
    const stock=await this.fetchJSON(`/api/public/stock${this.publicAntennaId?`?antenna_id=${this.publicAntennaId}`:''}`);
    const loans=await this.fetchJSON(`/api/public/loans?volunteer_id=${v.id}`);
    el.innerHTML=`<h3>${v.first_name} ${v.last_name}</h3>
      <h4>Stock disponible</h4>
      <ul>${stock.map(s=>`<li>${s.type} ${s.size||''} (${s.quantity}) <button class='btn btn-ghost' onclick='App.borrow(${v.id},${s.id})'>Emprunter</button></li>`).join('')}</ul>
      <h4>Prêts en cours</h4>
      <ul>${loans.map(l=>`<li>${l.type} ${l.size||''} depuis ${new Date(l.since).toLocaleDateString()} <button class='btn btn-ghost' onclick='App.returnLoanPublic(${l.id})'>Rendre</button></li>`).join('')}</ul>`;
  },
  async borrow(volId, stockId){ await this.fetchJSON('/api/public/loan',{method:'POST', body: JSON.stringify({volunteer_id:volId, stock_item_id:stockId, qty:1})}); this.flash('Tenue empruntée'); this.findVolPublic(); },
  async returnLoanPublic(id){ await this.fetchJSON('/api/public/return/'+id,{method:'POST'}); this.flash('Tenue rendue'); this.findVolPublic(); },
};

window.App=App;
