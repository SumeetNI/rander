// ---------- CONFIG ----------
const BASE_URL = "http://127.0.0.1:8000";

// ---------- Utilities ----------
const fmt = (n) => Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(n);

// Save + Load history in localStorage
const store = {
  key: "wc-forecast-history",
  load: () => JSON.parse(localStorage.getItem("wc-forecast-history") || "[]"),
  save: (arr) => localStorage.setItem("wc-forecast-history", JSON.stringify(arr)),
  add: (item) => { const arr = store.load(); arr.unshift(item); store.save(arr); }
};

// ---------- Router ----------
const routes = [...document.querySelectorAll('.route')];
const links = [...document.querySelectorAll('.link')];

function activate(id) {
  routes.forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addEventListener('hashchange', () => activate(location.hash.replace('#', '') || 'home'));
activate(location.hash.replace('#', '') || 'home');

document.querySelector('.brand').addEventListener('click', () => { location.hash = '#home' });

// ---------- COUNTRY DROPDOWNS ----------
const countrySel = document.getElementById('country');
const countryAnalysis = document.getElementById('countryAnalysis');

// Load countries from backend
(async () => {
  try {
    const res = await fetch(`${BASE_URL}/countries`);
    const countries = await res.json();

    countries.forEach(c => {
      const o1 = document.createElement('option');
      o1.value = o1.textContent = c;
      countrySel.appendChild(o1);

      const o2 = o1.cloneNode(true);
      countryAnalysis.appendChild(o2);
    });

    countrySel.value = "India";
    countryAnalysis.value = "India";

    renderCompare(countrySel.value);
  } catch (e) {
    alert("Failed to load countries from backend. Is backend running?");
  }
})();

// ---------- HOME SPARKLINE (DEMO ONLY) ----------
function demoSeries(seed = 1, start = 1990, end = 2024) {
  const rnd = () => Math.random();
  const years = [], values = [];
  let v = 800 + rnd() * 300;
  for (let y = start; y <= end; y++) {
    v += (rnd() - .4) * 15;
    v = Math.max(300, v);
    years.push(y); values.push(v);
  }
  return { years, values };
}

const sparkCtx = document.getElementById('homeSpark').getContext('2d');
const demoHome = demoSeries(7);
new Chart(sparkCtx, {
  type: 'line',
  data: { labels: demoHome.years, datasets: [{ label: '', data: demoHome.values, fill: false, tension: .35 }] },
  options: {
    plugins: { legend: { display: false } },
    scales: { x: { display: false }, y: { display: false } },
    elements: { point: { radius: 0 } }
  }
});

// ---------- RECENT CAROUSEL ----------
function renderCarousel() {
  const wrap = document.getElementById('recentCarousel');
  wrap.innerHTML = '';
  const items = store.load().slice(0, 6);
  if (!items.length) {
    wrap.innerHTML = '<div class="muted">No predictions yet. Try Predict tab.</div>';
    return;
  }
  items.forEach(p => {
    const d = document.createElement('div');
    d.className = 'cardlet';
    d.innerHTML = `
      <div><b>${p.country}</b> • ${p.year}</div>
      <div>${p.models.join(', ')}</div>
      <div><small>${new Date(p.ts).toLocaleString()}</small></div>
      <div><b>${fmt(p.predicted)} m³</b> (${p.change > 0 ? '+' : ''}${fmt(p.change)}%)</div>
    `;
    wrap.appendChild(d);
  });
}
renderCarousel();

// ---------- PREDICT ----------
const predictForm = document.getElementById('predictForm');
const predictCtx = document.getElementById('predictChart').getContext('2d');
let predictChart;

function renderPredictChart(labels, series, band) {
  if (predictChart) predictChart.destroy();
  predictChart = new Chart(predictCtx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Prediction', data: series, fill: false, tension: .35 },
        { label: 'Lower Bound', data: band.map(b => b[0]), fill: '+1', tension: .35, pointRadius: 0 },
        { label: 'Upper Bound', data: band.map(b => b[1]), fill: false, tension: .35, pointRadius: 0 }
      ]
    },
    options: {
      plugins: { legend: { display: false } },
      interaction: { mode: 'index', intersect: false },
      elements: { point: { radius: 0 } },
      scales: { x: { grid: { display: false } } }
    }
  });
}

predictForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const country = countrySel.value;
  const year = +document.getElementById('year').value;
  const models = [...document.querySelectorAll('input[name="model"]:checked')].map(i => i.value);

  try {
    const response = await fetch(`${BASE_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country, year, models })
    });

    if (!response.ok) throw new Error("Prediction failed.");

    const data = await response.json();

    document.getElementById('statCurrent').textContent = data.current.toFixed(2);
    document.getElementById('statPredicted').textContent = data.predicted.toFixed(2);
    document.getElementById('statChange').textContent = data.change.toFixed(2) + '%';

    renderPredictChart(data.years, data.values, data.band);

    store.add({ country, year, models, predicted: data.predicted, change: data.change, ts: Date.now() });
    renderHistory();
    renderCarousel();
    renderCompare(country);

  } catch (err) {
    alert("Error: " + err.message);
  }
});

// ---------- COMPARE ----------
const compareCtx = document.getElementById('compareChart').getContext('2d');
let compareChart;

async function renderCompare(country = "India") {

  try {
    const res = await fetch(`${BASE_URL}/compare?country=${encodeURIComponent(country)}`);
    if (!res.ok) throw new Error("Failed to load comparison data");
    const data = await res.json();

    const labels = data.years || [];
    const lasso = data.lasso || [];
    const ridge = data.ridge || [];
    const knn = data.knn || [];

    if (compareChart) compareChart.destroy();

    compareChart = new Chart(compareCtx, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "LASSO", data: lasso, borderColor: "blue", borderWidth: 2, fill: false },
          { label: "Ridge", data: ridge, borderColor: "green", borderWidth: 2, fill: false },
          { label: "KNN", data: knn, borderColor: "red", borderWidth: 2, fill: false }
        ]
      },
      options: {
        elements: { point: { radius: 0 } },
        interaction: { mode: "index", intersect: false }
      }
    });

  } catch (err) {
    alert("Compare chart error: " + err.message);
  }

  try {
    const mres = await fetch(`${BASE_URL}/metrics?country=${encodeURIComponent(country)}`);
    if (!mres.ok) throw new Error("Failed to fetch metrics");
    const metrics = await mres.json();
    updateCompareTable(metrics);
  } catch (err) {
    console.warn(err);
  }
}

function updateCompareTable(metrics) {
  const models = ["lasso", "knn", "ridge"];
  models.forEach(m => {
    const x = metrics[m] || {};
    document.querySelector(`[data-k="mae-${m}"]`).textContent = x.MAE ? fmt(x.MAE) : "—";
    document.querySelector(`[data-k="rmse-${m}"]`).textContent = x.RMSE ? fmt(x.RMSE) : "—";
    document.querySelector(`[data-k="r2-${m}"]`).textContent = x.R2 ? x.R2.toFixed(2) : "—";
    document.querySelector(`[data-k="mape-${m}"]`).textContent = x.MAPE ? fmt(x.MAPE) : "—";
  });
}

countrySel.addEventListener('change', e => renderCompare(e.target.value));

renderCompare();

// ---------- COUNTRY ANALYSIS (FIXED) ----------
const analysisCtx = document.getElementById('analysisChart').getContext('2d');
let analysisChart;

async function renderAnalysis(country = "India") {
  try {
    const res = await fetch(`${BASE_URL}/analysis?country=${encodeURIComponent(country)}`);
    if (!res.ok) throw new Error("Failed to load analysis data");

    const data = await res.json();

    if (analysisChart) analysisChart.destroy();

    analysisChart = new Chart(analysisCtx, {
      type: 'line',
      data: {
        labels: data.years,
        datasets: [{
          label: `${country} Water Consumption`,
          data: data.true_values,   // <-- FIXED
          borderColor: "#00b7ff",
          borderWidth: 2,
          fill: false,
          tension: 0.35
        }]
      },
      options: {
        elements: { point: { radius: 0 } },
        plugins: { legend: { display: false } }
      }
    });

    document.getElementById('countryFacts').innerHTML =
      `<div class="stat"><span class="label">Years</span><span class="value">${data.years[0]} - ${data.years[data.years.length - 1]}</span></div>
       <div class="stat"><span class="label">Total Records</span><span class="value">${data.true_values.length}</span></div>`;

  } catch (err) {
    alert("Error loading analysis data: " + err.message);
  }
}

countryAnalysis.addEventListener('change', e => renderAnalysis(e.target.value));
renderAnalysis("India");

// ---------- HISTORY ----------
function renderHistory() {
  const tbody = document.querySelector('#historyTable tbody');
  tbody.innerHTML = '';

  store.load().forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${r.country}</td>
      <td>${new Date(r.ts).toLocaleString()}</td>
      <td>${r.year}</td>
      <td>${r.models.join(', ')}</td>
      <td>${fmt(r.predicted)} m³</td>
      <td>${r.change > 0 ? '+' : ''}${fmt(r.change)}%</td>
      <td class="action">
        <button class="btn ghost" data-view="${i}"><i class="fa-solid fa-eye"></i></button>
        <button class="btn danger" data-del="${i}"><i class="fa-solid fa-trash"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

renderHistory();

document.getElementById('exportAll').addEventListener('click', () => {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(store.load(), null, 2));
  const a = document.createElement('a');
  a.href = dataStr;
  a.download = "predictions-history.json";
  a.click();
});

document.getElementById('clearHistory').addEventListener('click', () => {
  if (confirm("Clear all saved predictions?")) {
    localStorage.removeItem("wc-forecast-history");
    renderHistory();
    renderCarousel();
  }
});

// Footer year
document.getElementById('yearNow').textContent = new Date().getFullYear();
