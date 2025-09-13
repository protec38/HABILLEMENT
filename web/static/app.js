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

  async fetchJSON(url, opts={}){
    opts.headers={'Content-Type':'application/json', ...(opts.headers||{})};
    const res = await fetch(url, opts);
    let data=null; try{ data=await res.json(); }catch{}
    if(!res.ok){
      const msg=(data && (data.error||data.message)) || `Erreur ${res.status}`;
      const err=new Error(msg); throw err;
    }
    return data;
  },

  flash(msg){ const el=document.getElementById('flash');
    el.innerHTML=`<div class="toast">${msg}</div>`; setTimeout(()=>el.innerHTML='',2500); },

  show(id){
    document.querySelectorAll('.screen').forEach(e=>e.classList.add('hidden'));
    this.qs('#'+id)?.classList.remove('hidden');
    document.querySelectorAll('.nav a').forEach(a=>a.classList.toggle('active', a.dataset.id===id));
    if(id==='dashboard') this.renderDashboard();
    if(id==='antennes') this.renderAntennes();
    if(id==='stock') this.renderStock();
    if(id==='benevoles') this.renderBenevoles();
    if(id==='prets') this.renderPrets();
    if(id==='admin') this.renderAdmin();
    if(id==='pretPublic') this.renderPretPublic();
  },

  async init(){
    const m=location.pathname.match(/^\/a\/(\d+)/); if(m){ this.publicAntennaId=Number(m[1]); }
    try{ const me=await this.fetchJSON('/api/me'); if(me.ok){ this.user=me.user; this.renderNav(); this.qs('#loginView').classList.add('hidden'); this.show('dashboard'); return; } }catch{}
    this.renderNav(); this.qs('#loginView').classList.remove('hidden'); if(this.publicAntennaId) this.show('pretPublic');
  },

  renderNav(){
    const el=this.qs('#nav'); el.innerHTML='';
    const frag=document.createDocumentFragment();
    (this.user?this.nav: this.nav.filter(x=>!x.auth)).forEach(item=>{
      const a=document.createElement('a'); a.href='#'; a.dataset.id=item.id; a.textContent=item.label;
      a.onclick=(e)=>{e.preventDefault(); this.show(item.id);}; frag.appendChild(a);
    });
    if(this.user){ const lo=document.createElement('a'); lo.href='#'; lo.textContent='Déconnexion';
      lo.onclick=async(e)=>{e.preventDefault(); await this.fetchJSON('/api/logout',{method:'POST'}); this.user=null; location.href='/';};
      frag.appendChild(lo); }
    el.appendChild(frag);
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

  // --- Modal ---
  openModal(title, bodyHTML){
    this.qs('#modalTitle').textContent = title;
    this.qs('#modalBody').innerHTML = bodyHTML;
    const m=this.qs('#modal');
    m.classList.remove('hidden');
    m.classList.add('show');
  },
  closeModal(){
    const m=this.qs('#modal');
    m.classList.remove('show');
    m.classList.add('hidden');
    this.qs('#modalBody').innerHTML='';
  },

  // --- Renders ---
  async renderDashboard(){
    const el=this.qs('#dashboard');
    const r=await this.fetchJSON('/api/stats');
    el.innerHTML=`<div class="card"><h2>Statistiques</h2>
      <p>Total tenues en stock: <b>${r.stock_total}</b></p>
      <p>Prêts ouverts: <b>${r.prets_ouverts}</b></p>
      <p>Bénévoles: <b>${r.benevoles}</b></p>
    </div>`;
  },

  async renderAntennes(){
    const el=this.qs('#antennes');
    const r=await this.fetchJSON('/api/antennas');
    el.innerHTML=`<div class="card"><h2>Antennes</h2>
      <button class="btn btn-primary" onclick="App.openModal('Nouvelle antenne', App.formAntenne())">+ Ajouter</button>
      <table class="table"><tr><th>Nom</th><th>Adresse</th></tr>
        ${r.map(a=>`<tr><td>${a.name}</td><td>${a.address}</td></tr>`).join('')}
      </table></div>`;
  },
  formAntenne(){ return `<input id='antName' class='input' placeholder='Nom'><input id='antAddr' class='input' placeholder='Adresse'><button class='btn btn-primary' onclick='App.saveAntenne()'>Enregistrer</button>`; },
  async saveAntenne(){ const name=this.qs('#antName').value; const address=this.qs('#antAddr').value;
    await this.fetchJSON('/api/antennas',{method:'POST', body:JSON.stringify({name,address})}); this.closeModal(); this.renderAntennes(); this.flash('Antenne créée'); },

  async renderStock(){
    const el=this.qs('#stock');
    const r=await this.fetchJSON('/api/stock');
    el.innerHTML=`<div class="card"><h2>Stock</h2>
      <button class="btn btn-primary" onclick="App.openModal('Ajouter stock', App.formStock())">+ Ajouter</button>
      <table class="table"><tr><th>Type</th><th>Taille</th><th>Antenne</th><th>Quantité</th></tr>
        ${r.map(s=>`<tr><td>${s.garment_type}</td><td>${s.size||''}</td><td>${s.antenna}</td><td>${s.quantity}</td></tr>`).join('')}
      </table></div>`;
  },
  formStock(){ return `<input id='sType' class='input' placeholder='Type ID'><input id='sAnt' class='input' placeholder='Antenne ID'><input id='sSize' class='input' placeholder='Taille'><input id='sQty' type='number' class='input' placeholder='Quantité'><button class='btn btn-primary' onclick='App.saveStock()'>Enregistrer</button>`; },
  async saveStock(){ const t=Number(this.qs('#sType').value); const a=Number(this.qs('#sAnt').value); const size=this.qs('#sSize').value; const q=Number(this.qs('#sQty').value);
    await this.fetchJSON('/api/stock',{method:'POST', body:JSON.stringify({garment_type_id:t,antenna_id:a,size,quantity:q})}); this.closeModal(); this.renderStock(); this.flash('Stock ajouté'); },

  async renderBenevoles(){
    const el=this.qs('#benevoles');
    const r=await this.fetchJSON('/api/volunteers');
    el.innerHTML=`<div class="card"><h2>Bénévoles</h2>
      <button class="btn btn-primary" onclick="App.openModal('Nouveau bénévole', App.formVol())">+ Ajouter</button>
      <table class="table"><tr><th>Nom</th><th>Prénom</th><th>Note</th></tr>
        ${r.map(v=>`<tr><td>${v.last_name}</td><td>${v.first_name}</td><td>${v.note||''}</td></tr>`).join('')}
      </table></div>`;
  },
  formVol(){ return `<input id='vFirst' class='input' placeholder='Prénom'><input id='vLast' class='input' placeholder='Nom'><textarea id='vNote' class='input' placeholder='Note'></textarea><button class='btn btn-primary' onclick='App.saveVol()'>Enregistrer</button>`; },
  async saveVol(){ const fn=this.qs('#vFirst').value; const ln=this.qs('#vLast').value; const note=this.qs('#vNote').value;
    await this.fetchJSON('/api/volunteers',{method:'POST', body:JSON.stringify({first_name:fn,last_name:ln,note})}); this.closeModal(); this.renderBenevoles(); this.flash('Bénévole créé'); },

  async renderPrets(){
    const el=this.qs('#prets');
    const r=await this.fetchJSON('/api/loans/open');
    el.innerHTML=`<div class="card"><h2>Prêts en cours</h2>
      <table class="table"><tr><th>Bénévole</th><th>Type</th><th>Taille</th><th>Antenne</th><th>Depuis</th><th></th></tr>
        ${r.map(l=>`<tr><td>${l.volunteer}</td><td>${l.type}</td><td>${l.size||''}</td><td>${l.antenna}</td><td>${new Date(l.since).toLocaleDateString()}</td><td><button class='btn btn-ghost' onclick='App.returnLoan(${l.id})'>Rendu</button></td></tr>`).join('')}
      </table></div>`;
  },
  async returnLoan(id){ await this.fetchJSON('/api/loans/return/'+id,{method:'POST'}); this.renderPrets(); this.flash('Prêt rendu'); },

  async renderAdmin(){
    const el=this.qs('#admin');
    const r=await this.fetchJSON('/api/users');
    el.innerHTML=`<div class="card"><h2>Utilisateurs</h2>
      <button class="btn btn-primary" onclick="App.openModal('Nouvel utilisateur', App.formUser())">+ Ajouter</button>
      <table class="table"><tr><th>Email</th><th>Nom</th><th>Rôle</th></tr>
        ${r.map(u=>`<tr><td>${u.email}</td><td>${u.name}</td><td>${u.role}</td></tr>`).join('')}
      </table></div>`;
  },
  formUser(){ return `<input id='uEmail' class='input' placeholder='Email'><input id='uName' class='input' placeholder='Nom'><input id='uPass' class='input' type='password' placeholder='Mot de passe'><button class='btn btn-primary' onclick='App.saveUser()'>Enregistrer</button>`; },
  async saveUser(){ const email=this.qs('#uEmail').value; const name=this.qs('#uName').value; const password=this.qs('#uPass').value;
    await this.fetchJSON('/api/users',{method:'POST', body:JSON.stringify({email,name,password,role:'admin'})}); this.closeModal(); this.renderAdmin(); this.flash('Utilisateur créé'); },

  async renderPretPublic(){
    const el=this.qs('#pretPublic');
    el.innerHTML=`<div class="card"><h2>Prêt public</h2>
      <input id='pubFN' class='input' placeholder='Prénom'>
      <input id='pubLN' class='input' placeholder='Nom'>
      <button class='btn btn-primary' onclick='App.findVolPublic()'>Chercher</button>
      <div id='pubResult'></div></div>`;
  },

  async findVolPublic(){
    const fn=this.qs('#pubFN').value; const ln=this.qs('#pubLN').value;
    try{ const v=await this.fetchJSON(`/api/public/volunteer?first_name=${encodeURIComponent(fn)}&last_name=${encodeURIComponent(ln)}`);
      this.showVolPublic(v);
    }catch{ this.qs('#pubResult').innerHTML='<p class="alert">Non trouvé</p>'; }
  },

  async showVolPublic(v){
    const el=this.qs('#pubResult');
    const stock=await this.fetchJSON(`/api/public/stock?antenna_id=${this.publicAntennaId||''}`);
    const loans=await this.fetchJSON(`/api/public/loans?volunteer_id=${v.id}`);
    el.innerHTML=`<h3>${v.first_name} ${v.last_name}</h3>
      <h4>Stock disponible</h4>
      <ul>${stock.map(s=>`<li>${s.type} ${s.size||''} (${s.quantity}) <button class='btn btn-ghost' onclick='App.borrow(${v.id},${s.id})'>Emprunter</button></li>`).join('')}</ul>
      <h4>Prêts en cours</h4>
      <ul>${loans.map(l=>`<li>${l.type} ${l.size||''} depuis ${new Date(l.since).toLocaleDateString()} <button class='btn btn-ghost' onclick='App.returnLoanPublic(${l.id})'>Rendre</button></li>`).join('')}</ul>`;
  },

  async borrow(volId, stockId){
    await this.fetchJSON('/api/public/loan',{method:'POST', body:JSON.stringify({volunteer_id:volId, stock_item_id:stockId, qty:1})});
    this.flash('Tenue empruntée'); this.findVolPublic();
  },
  async returnLoanPublic(id){
    await this.fetchJSON('/api/public/return/'+id,{method:'POST'});
    this.flash('Tenue rendue'); this.findVolPublic();
  },
};
