// Saamagrii.AI Dashboard front-end
// This file expects backend endpoints (examples below). It does not include synthetic data.
// Configure the BASE_URL to point to your Node/Express server.
const BASE_URL = '';

const els = {
  kpiSales: document.getElementById('kpiSales'),
  kpiItems: document.getElementById('kpiItems'),
  kpiLow: document.getElementById('kpiLow'),
  kpiExp: document.getElementById('kpiExp'),
  period: document.getElementById('period'),
  expiryDays: document.getElementById('expiryDays'),
  refreshBtn: document.getElementById('refreshBtn'),
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
  const url = BASE_URL + path;
  const res = await fetch(url);
  if(!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function loadKPIs(){
  const period = els.period.value;
  try{
    const sum = await fetchJSON(`/api/dashboard/summary?period=${encodeURIComponent(period)}`);
    setText(els.kpiSales, sum.totalValue?.toFixed?.(2) ?? '–');
    setText(els.kpiItems, sum.totalItems ?? '–');
  }catch(e){ setText(els.kpiSales, '–'); setText(els.kpiItems, '–'); }

  try{
    const low = await fetchJSON('/api/dashboard/low-stock?limit=50');
    setText(els.kpiLow, (low.items?.length ?? 0));
    if((low.items?.length ?? 0) > 0){
      renderRows(els.tblLowBody, low.items.map(p => [p.name, p.quantity, p.unit]));
      showEmpty(els.emptyLow, false);
    } else { renderRows(els.tblLowBody, []); showEmpty(els.emptyLow, true); }
  }catch(e){ renderRows(els.tblLowBody, []); showEmpty(els.emptyLow, true); }

  const days = els.expiryDays.value;
  try{
    const exp = await fetchJSON(`/api/dashboard/expiring?days=${encodeURIComponent(days)}`);
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
    const top = await fetchJSON(`/api/dashboard/top-products?period=${encodeURIComponent(period)}&limit=10`);
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
    const reo = await fetchJSON('/api/dashboard/reorder');
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
  await loadKPIs();
  await loadTopProducts();
  await loadReorder();
  await loadPrices();
}

els.refreshBtn.addEventListener('click', refreshAll);
window.addEventListener('load', refreshAll);
