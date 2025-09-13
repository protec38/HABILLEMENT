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

  // --- ensuite : fonctions renderDashboard, renderAntennes, renderStock, renderBenevoles,
  // renderPrets, renderAdmin, renderPretPublic (comme donné précédemment)
};
