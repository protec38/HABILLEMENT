// -------------------------------------------------------------
// Minimal SPA with CSRF, pagination, live search, sorting, charts
// -------------------------------------------------------------
const state = {
  user: null,
  csrf: null,
  // pagination
  stock: { page: 1, per_page: 25, q: "", items: [], sort: { key: "", dir: 1 }, total: 0, pages: 1 },
  vols:  { page: 1, per_page: 25, q: "", items: [], sort: { key: "", dir: 1 }, total: 0, pages: 1 },
  loans: [],
  history: [],
  charts: { stock: null, loans: null },
};

const $ = (sel, el=document) => el.querySelector(sel);
const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

function show(screenId){
  $$(".screen").forEach(s => s.classList.add("hidden"));
  $("#"+screenId).classList.remove("hidden");
  // close mobile nav
  $("#mainnav").classList.remove("open");
}

function toast(msg){ console.log("INFO:", msg); } // hook to add UI later

// Debounce helper
function debounce(fn, delay=300){
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(()=>fn(...args), delay); };
}

// Auth ------------------------------------------------------------------------
async function whoami(){
  const r = await fetch("/api/me");
  const j = await r.json();
  if (j.authenticated){
    state.user = j.user;
    state.csrf = r.headers.get("X-CSRF-Token") || j.csrf || state.csrf;
    initApp();
  }else{
    state.csrf = r.headers.get("X-CSRF-Token") || j.csrf || state.csrf;
    show("login");
  }
}

async function post(url, body){
  const r = await fetch(url, {
    method: "POST",
    headers: {"Content-Type":"application/json", "X-CSRF-Token": state.csrf || ""},
    body: JSON.stringify(body || {})
  });
  if (!r.ok){ throw await r.json().catch(()=>({error: r.statusText})); }
  state.csrf = r.headers.get("X-CSRF-Token") || state.csrf;
  return r.json();
}
async function put(url, body){
  const r = await fetch(url, {
    method: "PUT",
    headers: {"Content-Type":"application/json", "X-CSRF-Token": state.csrf || ""},
    body: JSON.stringify(body || {})
  });
  if (!r.ok){ throw await r.json().catch(()=>({error: r.statusText})); }
  state.csrf = r.headers.get("X-CSRF-Token") || state.csrf;
  return r.json();
}
async function del(url){
  const r = await fetch(url, { method: "DELETE", headers: {"X-CSRF-Token": state.csrf || ""}});
  if (!r.ok){ throw await r.json().catch(()=>({error: r.statusText})); }
  state.csrf = r.headers.get("X-CSRF-Token") || state.csrf;
  return r.json();
}

// Login UI
$("#loginBtn").addEventListener("click", async () => {
  $("#loginError").textContent = "";
  try{
    const j = await post("/api/login", {email: $("#loginEmail").value, password: $("#loginPass").value});
    state.user = j.user;
    show("dashboard");
    initApp();
  }catch(e){
    $("#loginError").textContent = e.error || "Erreur";
  }
});
$("#logoutBtn").addEventListener("click", async () => {
  try{ await post("/api/logout"); location.reload(); }catch(e){ toast(e.error); }
});

// Burger menu
$("#burger").addEventListener("click", ()=> $("#mainnav").classList.toggle("open"));

// Nav
$$("[data-nav]").forEach(a => a.addEventListener("click", (ev)=>{
  ev.preventDefault();
  const id = a.getAttribute("href").slice(1);
  show(id);
  if (id === "dashboard") loadDashboard();
  if (id === "stock") loadStock();
  if (id === "volunteers") loadVolunteers();
  if (id === "loans") loadLoans();
  if (id === "inventory") {} // nothing
  if (id === "history") loadHistory();
}));

// Dashboard (stats + charts) ---------------------------------------------------
async function loadDashboard(){
  const r1 = await fetch("/api/stats");
  const s = await r1.json();
  $("#statStock").textContent = s.total_stock;
  $("#statLoans").textContent = s.open_loans;
  $("#statVols").textContent = s.volunteers;

  const r2 = await fetch("/api/stats/graph");
  const g = await r2.json();

  // Chart 1: stock per antenna (bar)
  if (state.charts.stock) state.charts.stock.destroy();
  const ctx1 = $("#chartStock").getContext("2d");
  state.charts.stock = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: g.stock_by_antenna.map(x=>x.label),
      datasets: [{label:"Stock", data: g.stock_by_antenna.map(x=>x.value)}]
    },
    options: { responsive: true, maintainAspectRatio:false }
  });

  // Chart 2: loans per week (line)
  if (state.charts.loans) state.charts.loans.destroy();
  const ctx2 = $("#chartLoans").getContext("2d");
  state.charts.loans = new Chart(ctx2, {
    type: 'line',
    data: {
      labels: g.loans_per_week.map(x=>x.label),
      datasets: [{label:"Prêts/semaine", data: g.loans_per_week.map(x=>x.value)}]
    },
    options: { responsive: true, maintainAspectRatio:false }
  });
}

// Stock (search + pagination + sorting) ---------------------------------------
async function loadStock(){
  const p = state.stock;
  const url = `/api/stock?page=${p.page}&per_page=${p.per_page}&q=${encodeURIComponent(p.q)}`
  const r = await fetch(url);
  const j = await r.json();
  p.items = j.items; p.total = j.total; p.pages = j.pages; p.page = j.page;
  renderStock();
}
function renderStock(){
  const tbody = $("#stock tbody"); tbody.innerHTML = "";
  const items = sortBy(state.stock.items, state.stock.sort);
  for (const it of items){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.garment_type || ""}</td>
      <td>${it.antenna || ""}</td>
      <td>${it.size || ""}</td>
      <td class="right">${it.quantity}</td>
      <td>${(it.tags||[]).join(", ")}</td>`;
    tbody.appendChild(tr);
  }
  $("#stockPageInfo").textContent = `Page ${state.stock.page}/${state.stock.pages}`;
}
// Search with debounce
$("#stockSearch").addEventListener("input", debounce(ev => {
  state.stock.q = ev.target.value.trim();
  state.stock.page = 1;
  loadStock();
}, 300));
// Pager
$("#stock .pager [data-page='prev']").addEventListener("click", ()=>{ if (state.stock.page>1){ state.stock.page--; loadStock(); }});
$("#stock .pager [data-page='next']").addEventListener("click", ()=>{ if (state.stock.page<state.stock.pages){ state.stock.page++; loadStock(); }});
// Export
$("#exportStock").addEventListener("click", ()=>{ window.location = "/api/export/stock"; });

// Volunteers (search + pagination + sorting) ----------------------------------
async function loadVolunteers(){
  const p = state.vols;
  const url = `/api/volunteers?page=${p.page}&per_page=${p.per_page}&q=${encodeURIComponent(p.q)}`;
  const r = await fetch(url);
  const j = await r.json();
  p.items = j.items; p.total = j.total; p.pages = j.pages; p.page = j.page;
  renderVolunteers();
}
function renderVolunteers(){
  const tbody = $("#volunteers tbody"); tbody.innerHTML = "";
  const items = sortBy(state.vols.items, state.vols.sort);
  for (const v of items){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${v.last_name}</td><td>${v.first_name}</td><td>${v.note||""}</td>`;
    tbody.appendChild(tr);
  }
  $("#volPageInfo").textContent = `Page ${state.vols.page}/${state.vols.pages}`;
}
$("#volSearch").addEventListener("input", debounce(ev => {
  state.vols.q = ev.target.value.trim();
  state.vols.page = 1;
  loadVolunteers();
}, 300));
$("#volunteers .pager [data-page='prev']").addEventListener("click", ()=>{ if (state.vols.page>1){ state.vols.page--; loadVolunteers(); }});
$("#volunteers .pager [data-page='next']").addEventListener("click", ()=>{ if (state.vols.page<state.vols.pages){ state.vols.page++; loadVolunteers(); }});

// Loans (export + list simple) -------------------------------------------------
async function loadLoans(){
  const r = await fetch("/api/loans?open=0");
  state.loans = await r.json();
  renderLoans();
}
function renderLoans(){
  const tbody = $("#loans tbody"); tbody.innerHTML = "";
  const items = sortBy(state.loans, { key: "" , dir: 1 });
  for (const l of items){
    const st = l.stock_item || {};
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${l.volunteer || ""}</td>
      <td>${[st.garment_type, st.antenna, st.size].filter(Boolean).join(" / ")}</td>
      <td class="right">${l.quantity}</td>
      <td>${formatDate(l.loan_date)}</td>
      <td>${l.return_date ? formatDate(l.return_date) : ""}</td>`;
    tbody.appendChild(tr);
  }
}
$("#exportLoans").addEventListener("click", ()=>{ window.location = "/api/export/loans"; });

// Inventory -------------------------------------------------------------------
$("#invStart").addEventListener("click", async ()=>{
  const antenna_id = parseInt($("#invAntennaId").value||"0",10);
  if (!antenna_id) return alert("Saisir l'id antenne");
  try{
    const j = await post("/api/inventory/start", {antenna_id});
    $("#invArea").classList.remove("hidden");
    $("#invSession").textContent = j.session_id;
    loadInvItems(j.session_id);
  }catch(e){ alert(e.error||"Erreur"); }
});
async function loadInvItems(session_id){
  const r = await fetch(`/api/inventory/${session_id}/items`);
  const items = await r.json();
  const tbody = $("#invItems tbody"); tbody.innerHTML = "";
  for (const it of items){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.garment_type}</td><td>${it.antenna}</td><td>${it.size||""}</td>
      <td class="right">${it.quantity}</td>
      <td><input type="number" value="${it.quantity}" data-sid="${it.id}" style="width:8ch"></td>
      <td class="right" data-delta="delta">0</td>`;
    const input = $("input", tr);
    input.addEventListener("change", async (ev)=>{
      const counted = parseInt(ev.target.value||"0",10);
      const j = await post(`/api/inventory/${$("#invSession").textContent}/count`, {stock_item_id: it.id, counted});
      $("[data-delta='delta']", tr).textContent = j.delta;
    });
    tbody.appendChild(tr);
  }
}
$("#invClose").addEventListener("click", async ()=>{
  const sid = $("#invSession").textContent;
  if (!sid) return;
  await post(`/api/inventory/${sid}/close`);
  alert("Session clôturée");
});

// History ---------------------------------------------------------------------
async function loadHistory(){
  const r = await fetch("/api/inventories/history");
  state.history = await r.json();
  const tbody = $("#history tbody"); tbody.innerHTML = "";
  for (const h of sortBy(state.history, {key:"started_at", dir:-1})){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(h.started_at)}</td>
      <td>${h.closed_at ? formatDate(h.closed_at) : ""}</td>
      <td>${h.antenna}</td>
      <td>${h.user}</td>
      <td class="right">${h.total_delta}</td>`;
    tbody.appendChild(tr);
  }
}

// Sorting helper --------------------------------------------------------------
function sortBy(list, sort){
  if (!sort || !sort.key) return list.slice();
  return list.slice().sort((a,b)=>{
    const av = (a[sort.key] ?? "").toString().toLowerCase();
    const bv = (b[sort.key] ?? "").toString().toLowerCase();
    if (av < bv) return -1 * sort.dir;
    if (av > bv) return  1 * sort.dir;
    return 0;
  });
}
// Clickable headers
$$(".table.sortable thead").forEach(th=>{
  th.addEventListener("click", ev=>{
    const el = ev.target.closest("[data-sort]");
    if (!el) return;
    const key = el.getAttribute("data-sort");
    const table = el.closest("table").dataset.table;
    const block = table === "stock" ? state.stock : table === "volunteers" ? state.vols :
                  table === "loans" ? { sort: { key:"loan_date", dir:-1 } } :
                  table === "history" ? { sort:{ key:"started_at", dir:-1 } } : null;
    if (!block) return;
    if (block.sort.key === key){ block.sort.dir *= -1; } else { block.sort.key = key; block.sort.dir = 1; }
    if (table === "stock") renderStock();
    if (table === "volunteers") renderVolunteers();
    if (table === "loans") renderLoans();
    if (table === "history") loadHistory();
  });
});

// Utils -----------------------------------------------------------------------
function formatDate(iso){
  try{ const d = new Date(iso); return d.toLocaleString(); }catch(e){ return ""; }
}

// Init ------------------------------------------------------------------------
function initApp(){
  // default screen
  show("dashboard");
  loadDashboard();
  // preload lists
  loadStock();
  loadVolunteers();
  loadLoans();
  loadHistory();
}

whoami();
