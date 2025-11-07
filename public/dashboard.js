// Saamagrii.AI Dashboard front-end
// This file expects backend endpoints (examples below). It does not include synthetic data.
// Configure the BASE_URL to point to your Node/Express server.

let BASE_URL = '';
// Try reading from /config.json if present, fallback to same-origin
(async function bootstrapBaseUrl(){
  try {
    const cfg = await fetch('/config.json').then(r => r.ok ? r.json() : {}).catch(()=>({}));
    if (cfg && typeof cfg.BASE_URL === 'string' && cfg.BASE_URL.trim()) BASE_URL = cfg.BASE_URL.replace(/\/$/, '');
  } catch {}
})();

const els = {
  kpiSales: document.getElementById('kpiSales'),
  kpiItems: document.getElementById('kpiItems'),
  kpiLow: document.getElementById('kpiLow'),
  kpiExp: document.getElementById('kpiExp'),
  period: document.getElementById('period'),
  expiryDays: document.getElementById('expiryDays'),
  refreshBtn: document.getElementById('refreshBtn'),    
  fltState: document.getElementById('fltState'),
  fltCity: document.getElementById('fltCity'),
  fltSegment: document.getElementById('fltSegment'),
  fltShop: document.getElementById('fltShop'),
  tblLowBody: document.querySelector('#tblLow tbody'),
  tblExpBody: document.querySelector('#tblExp tbody'),
  tblReorderBody: document.querySelector('#tblReorder tbody'),
  tblPricesBody: document.querySelector('#tblPrices tbody'),
  emptyLow: document.getElementById('emptyLow'),
  emptyExp: document.getElementById('emptyExp'),
  emptyReorder: document.getElementById('emptyReorder'),
  emptyPrices: document.getElementById('emptyPrices'),
};

let chartTop;
let filterCache = { states: [], cities: [], segments: [], shops: [] };

function setText(el, val){ el.textContent = (val ?? '–'); }
function showEmpty(el, show){ el.hidden = !show; }
function renderRows(tbody, rows){
  tbody.innerHTML = '';
  for(const r of rows){
    const tr = document.createElement('tr');
    for(const c of r){
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

async function fetchJSON(path){
  const url = (BASE_URL || '') + path;
  const res = await fetch(url);
  if(!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function currentFilterQS(){
  const qs = new URLSearchParams();
  const s = els.fltState.value || '';
  const c = els.fltCity.value || '';
  const g = els.fltSegment.value || '';
  const h = els.fltShop.value || '';
  if (s) qs.set('state', s);
  if (c) qs.set('city', c);
  if (g) qs.set('segment', g);
  if (h) qs.set('shopId', h);
  return qs.toString() ? ('&' + qs.toString()) : '';
}

async function loadFilters(){
  const data = await fetchJSON('/api/dashboard/filters');
  filterCache.states = data.states || [];
  filterCache.cities = data.cities || [];
  filterCache.segments = data.segments || [];
  // shops list: derive lazily via low-stock (contains shopId/state/city/segment) or summary
  // For simplicity, keep shop select blank unless a state/city narrows it.
  populateSelect(els.fltState, filterCache.states);
  populateSelect(els.fltSegment, filterCache.segments);
  // City depends on state
  populateCitiesForState();
  // Shop depends on state/city/segment — we’ll fill after first KPI call
}
function populateSelect(sel, values){
  const cur = sel.value;
  sel.innerHTML = '<option value="">All</option>' + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  // restore if possible
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}
function populateCitiesForState(){
  const s = els.fltState.value;
  let cities = filterCache.cities;
  // If state chosen, we can filter cities by calling low-stock once and picking distinct cities from returned items
  // (cheap heuristic; avoids a dedicated shops endpoint)
  // Otherwise keep all cities.
  populateSelect(els.fltCity, cities);
}
function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function loadKPIs(){
  const period = els.period.value;
  try{    
    const qs = currentFilterQS();
    const sum = await fetchJSON(`/api/dashboard/summary?period=${encodeURIComponent(period)}${qs}`);
    setText(els.kpiSales, sum.totalValue?.toFixed?.(2) ?? '–');
    setText(els.kpiItems, sum.totalItems ?? '–');
  }catch(e){ setText(els.kpiSales, '–'); setText(els.kpiItems, '–'); }

  try{        
    const qs = currentFilterQS();
    const low = await fetchJSON(`/api/dashboard/low-stock?limit=50${qs}`);
    setText(els.kpiLow, (low.items?.length ?? 0));
    if((low.items?.length ?? 0) > 0){
      renderRows(els.tblLowBody, low.items.map(p => [p.name, p.quantity, p.unit]));
      showEmpty(els.emptyLow, false);            
      // Use low-stock response to populate Shop dropdown contextually (distinct shopIds)
      const shops = Array.from(new Set((low.items || []).map(x => x.shopId))).filter(Boolean);
      populateSelect(els.fltShop, shops);
    } else { renderRows(els.tblLowBody, []); showEmpty(els.emptyLow, true); }
  }catch(e){ renderRows(els.tblLowBody, []); showEmpty(els.emptyLow, true); }

  const days = els.expiryDays.value;
  try{     
    const qs = currentFilterQS();
    const exp = await fetchJSON(`/api/dashboard/expiring?days=${encodeURIComponent(days)}${qs}`);
    setText(els.kpiExp, (exp.items?.length ?? 0));
    if((exp.items?.length ?? 0) > 0){
      renderRows(els.tblExpBody, exp.items.map(p => [p.name, p.displayDate, p.quantity]));
      showEmpty(els.emptyExp, false);
    } else { renderRows(els.tblExpBody, []); showEmpty(els.emptyExp, true); }
  }catch(e){ renderRows(els.tblExpBody, []); showEmpty(els.emptyExp, true); }
}

async function loadTopProducts(){
  const period = els.period.value;
  try{       
    const qs = currentFilterQS();
    const top = await fetchJSON(`/api/dashboard/top-products?period=${encodeURIComponent(period)}&limit=10${qs}`);
    const labels = (top.items ?? []).map(x => x.name);
    const data = (top.items ?? []).map(x => x.quantity);
    const ctx = document.getElementById('chartTop').getContext('2d');
    if(chartTop){ chartTop.destroy(); }
    if(labels.length === 0){ document.getElementById('emptyTop').hidden = false; return; }
    document.getElementById('emptyTop').hidden = true;
    chartTop = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Units sold', data, backgroundColor: '#22c55e' }] },
      options: { responsive: true, plugins:{ legend:{ display:false }}, scales: { y: { beginAtZero:true } } }
    });
  }catch(e){ document.getElementById('emptyTop').hidden = false; }
}

async function loadReorder(){
  try{        
    const qs = currentFilterQS();
    const reo = await fetchJSON(`/api/dashboard/reorder${qs}`);
    if((reo.items?.length ?? 0) > 0){
      renderRows(els.tblReorderBody, reo.items.map(s => [s.name, s.dailyRate, s.currentQty, s.reorderQty]));
      showEmpty(els.emptyReorder, false);
    } else { renderRows(els.tblReorderBody, []); showEmpty(els.emptyReorder, true); }
  }catch(e){ renderRows(els.tblReorderBody, []); showEmpty(els.emptyReorder, true); }
}

async function loadPrices(){
  try{
    const pr = await fetchJSON('/api/dashboard/prices/stale?page=1');
    if((pr.items?.length ?? 0) > 0){
      renderRows(els.tblPricesBody, pr.items.map(p => [p.name, p.currentPrice, p.unit, p.lastUpdated]));
      showEmpty(els.emptyPrices, false);
    } else { renderRows(els.tblPricesBody, []); showEmpty(els.emptyPrices, true); }
  }catch(e){ renderRows(els.tblPricesBody, []); showEmpty(els.emptyPrices, true); }
}

async function refreshAll(){
  await Promise.all([loadKPIs(), loadTopProducts(), loadReorder(), loadPrices()]);
}

els.refreshBtn.addEventListener('click', refreshAll);
window.addEventListener('load', async () => {
  await loadFilters();
  await refreshAll();
});
// When filters change, re-run
['period','expiryDays','fltState','fltCity','fltSegment','fltShop'].forEach(id => {
  els[id].addEventListener('change', async () => {
    if (id === 'fltState') populateCitiesForState();
    await refreshAll();
  });
});
