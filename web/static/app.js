const App = {
  user:null,
  publicAntennaId:null,
  nav:[
    {id:'dashboard', label:'Dashboard', auth:true},
    {id:'antennes', label:'Antennes', auth:true},
    {id:'stock', label:'Stock', auth:true},
    {id:'benevoles', label:'Bénévoles', auth:true},
    {id:'prets', label:'Prêts en cours', auth:true},
    {id:'admin', label:'Administration', auth:true},
    {id:'pretPublic', label:'Prêt publique', auth:false},
  ],
  qs:(s)=>document.querySelector(s),
  show(id){
    document.querySelectorAll('.screen').forEach(e=>e.classList.add('hidden'));
    if(id==='dashboard') this.renderDashboard();
    if(id==='antennes') this.renderAntennes();
    if(id==='stock') this.renderStock();
    if(id==='benevoles') this.renderBenevoles();
    if(id==='prets') this.renderPrets();
    if(id==='admin') this.renderAdmin();
    if(id==='pretPublic') this.renderPretPublic();
    this.qs('#'+id)?.classList.remove('hidden');
    document.querySelectorAll('.nav a').forEach(a=>a.classList.toggle('active', a.dataset.id===id));
  },
  flash(msg, ok=true){ 
    const el=document.getElementById('flash'); 
    el.innerHTML=`<div class="toast ${ok?'show':''}">${msg}</div>`; 
    setTimeout(()=>{ el.innerHTML=''; }, 2500); 
  },
  openModal(title, bodyHTML){ 
    this.qs('#modalTitle').textContent=title; 
    this.qs('#modalBody').innerHTML=bodyHTML; 
    this.qs('#modal').classList.remove('hidden'); 
  },
  closeModal(){ 
    this.qs('#modal').classList.add('hidden'); 
    this.qs('#modalBody').innerHTML=''; 
  },

  // ✅ fetchJSON corrigé
  async fetchJSON(url, opts={}){
    opts.headers={'Content-Type':'application/json', ...(opts.headers||{})};
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch(e){ /* ignore parse error */ }
    if(!res.ok){
      const msg = (data && (data.error || data.message)) || `Erreur ${res.status}`;
      const err = new Error(msg); err.status = res.status; err.data = data; throw err;
    }
    return data;
  },

  renderNav(){
    const el=this.qs('#nav'); el.innerHTML=''; const frag=document.createDocumentFragment();
    (this.user?this.nav: this.nav.filter(x=>!x.auth)).forEach(item=>{
      const a=document.createElement('a'); 
      a.href='#'; a.dataset.id=item.id; a.textContent=item.label; 
      a.onclick=(e)=>{e.preventDefault(); this.show(item.id);}; 
      frag.appendChild(a); 
    });
    if(this.user){ 
      const user=document.createElement('a'); user.href='#'; user.style.marginLeft='auto'; user.textContent=this.user.name||this.user.email; frag.appendChild(user);
      const lo=document.createElement('a'); lo.href='#'; lo.textContent='Déconnexion'; 
      lo.onclick=async(e)=>{e.preventDefault(); await this.fetchJSON('/api/logout',{method:'POST'}); this.user=null; location.href='/';}; 
      frag.appendChild(lo); 
    }
    el.appendChild(frag);
  },

  async init(){
    const m=location.pathname.match(/^\\/a\\/(\\d+)/); if(m){ this.publicAntennaId=Number(m[1]); }
    try{ 
      const me=await this.fetchJSON('/api/me'); 
      if(me.ok){ 
        this.user=me.user; this.renderNav(); this.qs('#loginView').classList.add('hidden'); this.show('dashboard'); 
        return; 
      } 
    }catch{}
    this.renderNav(); this.qs('#loginView').classList.remove('hidden'); 
    if(this.publicAntennaId) this.show('pretPublic');
  },

  // ✅ login corrigé
  async login(){
    const btn = document.getElementById('loginBtn');
    const email=this.qs('#loginEmail').value.trim();
    const password=this.qs('#loginPass').value;
    const errBox = this.qs('#loginError');
    errBox.classList.add('hidden'); errBox.textContent='';

    if(!email || !password){
      errBox.textContent = "Email et mot de passe requis";
      errBox.classList.remove('hidden');
      return;
    }

    btn.disabled = true; const oldTxt = btn.textContent; btn.textContent = 'Connexion...';
    try{
      const r=await this.fetchJSON('/api/login',{method:'POST', body: JSON.stringify({email,password})});
      this.user=r.user; this.renderNav(); this.qs('#loginView').classList.add('hidden'); this.show('dashboard');
      this.flash('Bienvenue ' + (this.user.name || this.user.email));
    }catch(e){
      errBox.textContent = e.message || 'Identifiants invalides';
      errBox.classList.remove('hidden');
      this.flash('Connexion refusée', false);
    }finally{
      btn.disabled = false; btn.textContent = oldTxt;
    }
  },

  // --- reste du code (inchangé) ---
  async renderDashboard(){ const box=this.qs('#dashboard'); const stats=await this.fetchJSON('/api/stats');
    box.innerHTML=`<div class="card"><h1>Tableau de bord</h1>
      <div class="stats">
        <div class="stat"><div class="kpi"><span class="dot"></span><div class="muted">Articles en stock</div></div><div class="num">${stats.stock_total}</div></div>
        <div class="stat"><div class="kpi"><span class="dot"></span><div class="muted">Prêts en cours</div></div><div class="num">${stats.prets_ouverts}</div></div>
        <div class="stat"><div class="kpi"><span class="dot"></span><div class="muted">Bénévoles</div></div><div class="num">${stats.benevoles}</div></div>
      </div>
      <p class="mt muted">QR par antenne : utilisez <span class="badge">/a/&lt;antenna_id&gt;</span> pour la page prêt publique filtrée.</p>
    </div>`; },

  async renderAntennes(){ const box=this.qs('#antennes'); const ants=await this.fetchJSON('/api/antennas'); const base=location.origin;
    box.innerHTML=`<div class="card"><h1>Antennes</h1>
      <div class="toolbar">
        <input id="ant_name" class="input" placeholder="Nom">
        <input id="ant_addr" class="input" placeholder="Adresse">
        <button class="btn btn-primary" onclick="App.addAntenne()">Ajouter</button>
      </div>
      <table class="table"><thead><tr><th>Nom</th><th>Adresse</th><th>Lien public</th></tr></thead><tbody>
        ${ants.map(a=>`<tr><td>${a.name}</td><td class="muted">${a.address||''}</td><td><a class="link" href="/a/${a.id}" target="_blank">${base}/a/${a.id}</a></td></tr>`).join('')}
      </tbody></table></div>`; },
  async addAntenne(){ const name=this.qs('#ant_name').value.trim(); const address=this.qs('#ant_addr').value.trim(); if(!name) return this.flash('Nom requis',false); await this.fetchJSON('/api/antennas',{method:'POST', body: JSON.stringify({name,address})}); this.renderAntennes(); this.flash('Antenne créée'); },

  async renderStock(){ const box=this.qs('#stock'); const [types,ants,stock]=await Promise.all([this.fetchJSON('/api/types'), this.fetchJSON('/api/antennas'), this.fetchJSON('/api/stock')]);
    box.innerHTML=`<div class="card"><h1>Stock</h1>
      <div class="toolbar grid-4">
        <select id="s_type">${['<option value=\"\">Type</option>'].concat(types.map(t=>`<option value="${t.id}">${t.label}</option>`)).join('')}</select>
        <select id="s_ant">${['<option value=\"\">Antenne</option>'].concat(ants.map(a=>`<option value="${a.id}">${a.name}</option>`)).join('')}</select>
        <input id="s_size" class="input" placeholder="Taille (optionnel)">
        <div class="grid-2"><input id="s_qty" class="input" type="number" value="1" min="1"><button class="btn btn-primary" onclick="App.saveStock()">Enregistrer</button></div>
      </div>
      <div class="toolbar"><input id="new_type" class="input" placeholder="Nouveau type (ex: Parka)"><button class="btn btn-ghost" onclick="App.addType()">+ Type</button></div>
      <table class="table"><thead><tr><th>Type</th><th>Antenne</th><th>Taille</th><th>Qté</th><th></th></tr></thead><tbody>
        ${stock.map(s=>`<tr>
            <td>${s.garment_type}</td><td>${s.antenna}</td><td>${s.size||'—'}</td><td>${s.quantity}</td>
            <td class="chips">
              <button class="btn btn-ghost" onclick='App.editStock(${s.id}, ${JSON.stringify(s).replaceAll(\"'\",\"&apos;\")})'>Modifier</button>
              <button class="btn btn-ghost" onclick="App.deleteStock(${s.id})">Supprimer</button>
            </td>
          </tr>`).join('')}
      </tbody></table></div>`; },
  async addType(){ const label=this.qs('#new_type').value.trim(); if(!label) return; await this.fetchJSON('/api/types',{method:'POST', body: JSON.stringify({label,has_size:true})}); this.renderStock(); this.flash('Type ajouté'); },
  async saveStock(){ const payload={ garment_type_id:Number(this.qs('#s_type').value), antenna_id:Number(this.qs('#s_ant').value), size:this.qs('#s_size').value.trim()||null, quantity:Number(this.qs('#s_qty').value||0) };
    if(!payload.garment_type_id||!payload.antenna_id||!payload.quantity) return this.flash('Champs requis manquants',false);
    await this.fetchJSON('/api/stock',{method:'POST', body: JSON.stringify(payload)}); this.renderStock(); this.flash('Stock mis à jour'); },
  editStock(id,s){ this.openModal('Modifier un article de stock', `
      <div class="grid-4">
        <input id="es_type" class="input" type="number" value="${s.garment_type_id}" title="garment_type_id">
        <input id="es_ant" class="input" type="number" value="${s.antenna_id}" title="antenna_id">
        <input id="es_size" class="input" value="${s.size||''}" placeholder="Taille">
        <input id="es_qty" class="input" type="number" value="${s.quantity}" min="0">
      </div>
      <div class="toolbar" style="justify-content:flex-end">
        <button class="btn btn-primary" onclick="App.saveEditStock(${id})">Enregistrer</button>
      </div>`); },
  async saveEditStock(id){ const body={ garment_type_id:Number(this.qs('#es_type').value), antenna_id:Number(this.qs('#es_ant').value), size:this.qs('#es_size').value.trim()||null, quantity:Number(this.qs('#es_qty').value||0) };
    await this.fetchJSON('/api/stock/'+id,{method:'PUT', body: JSON.stringify(body)}); this.closeModal(); this.renderStock(); this.flash('Article mis à jour'); },
  async deleteStock(id){ if(!confirm('Supprimer cet article du stock ?')) return; await this.fetchJSON('/api/stock/'+id,{method:'DELETE'}); this.renderStock(); this.flash('Article supprimé'); },

  async renderBenevoles(){ const box=this.qs('#benevoles'); const data=await this.fetchJSON('/api/volunteers');
    box.innerHTML=`<div class="card"><h1>Bénévoles</h1>
      <div class="toolbar grid-4">
        <input id="v_first" class="input" placeholder="Prénom">
        <input id="v_last" class="input" placeholder="Nom">
        <input id="v_note" class="input" placeholder="Infos complémentaires">
        <button class="btn btn-primary" onclick="App.addVol()">Enregistrer</button>
      </div>
      <table class="table"><thead><tr><th>Nom</th><th>Prénom</th><th>Notes</th><th></th></tr></thead><tbody>
        ${data.map(v=>`<tr>
          <td>${v.last_name}</td><td>${v.first_name}</td><td class="muted">${v.note||''}</td>
          <td><div class="chips">
            <button class="btn btn-ghost" onclick='App.editVol(${v.id}, ${JSON.stringify(v).replaceAll(\"'\",\"&apos;\")})'>Modifier</button>
            <button class="btn btn-ghost" onclick='App.viewVol(${v.id}, ${JSON.stringify(v).replaceAll(\"'\",\"&apos;\")})'>Voir</button>
          </div></td>
        </tr>`).join('')}
      </tbody></table></div>`; },
  async addVol(){ const first_name=this.qs('#v_first').value.trim(); const last_name=this.qs('#v_last').value.trim(); const note=this.qs('#v_note').value.trim();
    if(!first_name||!last_name) return this.flash('Prénom et nom requis',false);
    await this.fetchJSON('/api/volunteers',{method:'POST', body: JSON.stringify({first_name,last_name,note})}); this.renderBenevoles(); this.flash('Bénévole créé'); },
  editVol(id, v){ this.openModal('Modifier bénévole', `
      <div class="grid-3">
        <input id="e_first" class="input" value="${v.first_name}">
        <input id="e_last" class="input" value="${v.last_name}">
        <input id="e_note" class="input" value="${v.note||''}">
      </div>
      <div class="toolbar" style="justify-content:flex-end;"><button class="btn btn-primary" onclick="App.saveEditVol(${id})">Enregistrer</button></div>`); },
  async saveEditVol(id){ const first_name=this.qs('#e_first').value.trim(), last_name=this.qs('#e_last').value.trim(), note=this.qs('#e_note').value.trim();
    await this.fetchJSON('/api/volunteers/'+id,{method:'PUT', body: JSON.stringify({first_name,last_name,note})}); this.closeModal(); this.renderBenevoles(); this.flash('Bénévole mis à jour'); },
  async viewVol(id, v){ const loans=await this.fetchJSON(`/api/volunteers/${id}/loans`);
    const html = `
      <div class="grid-2">
        <div><div class="muted">Nom</div><div class="badge">${v.last_name}</div></div>
        <div><div class="muted">Prénom</div><div class="badge">${v.first_name}</div></div>
      </div>
      <div class="mt"><div class="muted">Notes</div><div class="card" style="padding:.6rem;">${v.note || '<span class="muted">Aucune note</span>'}</div></div>
      <div class="mt">
        <h3>Prêts en cours</h3>
        ${loans.length ? `<table class="table"><thead><tr><th>Article</th><th>Qté</th><th>Depuis</th></tr></thead><tbody>${loans.map(l=>`<tr><td>${l.type} / ${l.size||'—'}</td><td>${l.qty}</td><td>${new Date(l.since).toLocaleString()}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aucun prêt en cours</p>'}
      </div>
    `;
    this.openModal('Détails bénévole', html);
  },

  async renderPrets(){ const box=this.qs('#prets'); const loans=await this.fetchJSON('/api/loans/open');
    box.innerHTML=`<div class="card"><h1>Prêts en cours</h1>
      <table class="table"><thead><tr><th>Bénévole</th><th>Article</th><th>Qté</th><th>Depuis</th><th></th></tr></thead><tbody>
        ${loans.map(l=>`<tr><td>${l.volunteer}</td><td>${l.type} / ${l.size||'—'} @ ${l.antenna}</td><td>${l.qty}</td><td>${new Date(l.since).toLocaleString()}</td><td><button class="btn btn-ghost" onclick="App.returnLoan(${l.id})">Marquer rendu</button></td></tr>`).join('')}
      </tbody></table></div>`; },
  async returnLoan(id){ await this.fetchJSON('/api/loans/return/'+id,{method:'POST'}); this.renderPrets(); this.flash('Prêt rendu'); },

  async renderAdmin(){ const box=this.qs('#admin'); const users=await this.fetchJSON('/api/users');
    box.innerHTML=`<div class="card"><h1>Administration</h1>
      <div class="toolbar grid-4"><input id="u_name" class="input" placeholder="Nom"><input
