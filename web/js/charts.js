/**
 * charts.js — Gráficos con Chart.js: rendimiento vs índices y dinero
 * ingresado vs valor/ganancia.
 */
"use strict";

(function () {
  const DG = window.DG;
  let perfChart = null;
  let moneyChart = null;

  const EUR = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  DG.tradeFilters = DG.tradeFilters || { hidden: new Set(), dropdownOpen: false };

  document.addEventListener("click", (e) => {
    const dropdown = document.getElementById("tradeDropdown");
    if (dropdown && !dropdown.contains(e.target)) {
      dropdown.classList.remove("open");
      DG.tradeFilters.dropdownOpen = false;
    }
  });

  DG.renderPerfChart = function (twr, benchSeries, visible, range, events = []) {
    const pts = twr.filter(p => p.day >= range.from && p.day <= range.to);
    if (!pts.length) return;

    const base = pts[0].index;
    const userData = pts.map(p => ({ 
      x: new Date(p.day + "T00:00:00Z").getTime(), 
      y: (p.index / base) * 100,
      trades: [] 
    }));

    const datasets = [{
      label: "Mi cartera",
      data: userData,
      borderColor: "#009fdf",
      backgroundColor: "rgba(0,159,223,.08)",
      borderWidth: 2.5, pointRadius: 0, fill: true, tension: .1,
    }];

    const buyData = [];
    const sellData = [];
    const tickersInView = new Set();

    for (const ev of events) {
      if (ev.type === "trade" && ev.date) {
        const day = DG.dayKey(ev.date);
        const tradeTime = new Date(day + "T00:00:00Z").getTime();
        const fromTime = new Date(range.from + "T00:00:00Z").getTime();
        const toTime = new Date(range.to + "T00:00:00Z").getTime();
        
        if (tradeTime >= fromTime && tradeTime <= toTime) {
          const ticker = (DG.ISIN_TO_YAHOO && DG.ISIN_TO_YAHOO[ev.isin]) ? DG.ISIN_TO_YAHOO[ev.isin] : ev.isin;
          tickersInView.add(ticker);

          if (DG.tradeFilters.hidden.has(ticker)) continue;

          const qty = Math.abs(ev.qty).toLocaleString("es-ES");
          const price = ev.price.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const action = ev.side === 1 ? "Compra" : "Venta";
          const desc = `${action} ${ticker}, ${qty}x${price}`;

          let closestIdx = 0;
          let minDiff = Infinity;
          for (let i = 0; i < userData.length; i++) {
             const diff = Math.abs(userData[i].x - tradeTime);
             if (diff < minDiff) { minDiff = diff; closestIdx = i; }
             if (userData[i].x > tradeTime) break;
          }
          
          const snapPt = userData[closestIdx];
          snapPt.trades.push(desc);
          const pt = { x: snapPt.x, y: snapPt.y };
          if (ev.side === 1) buyData.push(pt); else sellData.push(pt);
        }
      }
    }

    if (buyData.length > 0) datasets.push({ label: "Compras", data: buyData, type: "scatter", backgroundColor: "#2e9e5b", borderColor: "#ffffff", borderWidth: 1.5, pointRadius: 5, pointHoverRadius: 7, order: 0 });
    if (sellData.length > 0) datasets.push({ label: "Ventas", data: sellData, type: "scatter", backgroundColor: "#d64541", borderColor: "#ffffff", borderWidth: 1.5, pointRadius: 5, pointHoverRadius: 7, order: 0 });

    for (const [id, b] of benchSeries) {
      if (!visible.has(id) || !b.map) continue;
      const start = DG.seriesAt(b.map, pts[0].day);
      if (!start) continue;
      const data = pts.map(p => {
        const v = DG.seriesAt(b.map, p.day);
        return v != null ? { x: new Date(p.day + "T00:00:00Z").getTime(), y: (v / start) * 100 } : null;
      }).filter(Boolean);
      datasets.push({ label: b.label, data, borderColor: b.color, borderWidth: 1.6, pointRadius: 0, fill: false, tension: .1 });
    }

    const cfg = {
      type: "line",
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "x", intersect: false },
        scales: {
          x: { type: "time", time: { unit: "month", tooltipFormat: "dd MMM yyyy" }, grid: { display: false } },
          y: { ticks: { callback: v => v.toFixed(0) }, title: { display: true, text: "Base 100" } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => item.dataset.type !== "scatter",
            callbacks: { label: ctx => {
              const labelStr = ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`;
              return (ctx.datasetIndex === 0 && ctx.raw?.trades?.length) ? [labelStr, ...ctx.raw.trades.map(t => `   • ${t}`)] : labelStr;
            }}
          },
          zoom: { zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" }, pan: { enabled: true, mode: "x", modifierKey: "shift" } },
        },
      },
    };

    const ctxCanvas = document.getElementById("perfChart");
    if (perfChart) perfChart.destroy();
    perfChart = new Chart(ctxCanvas, cfg);
    ctxCanvas.ondblclick = () => perfChart.resetZoom();

    renderTradeDropdown(tickersInView, twr, benchSeries, visible, range, events);
  };

  function renderTradeDropdown(tickers, twr, benchSeries, visible, range, events) {
    let container = document.getElementById("tradeFiltersContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "tradeFiltersContainer";
      container.className = "trade-filters-container";
      const benchDiv = document.getElementById("benchToggles");
      if (benchDiv) benchDiv.parentNode.insertBefore(container, benchDiv.nextSibling);
    }

    const tickerArray = Array.from(tickers).sort();
    const visibleCount = tickerArray.filter(t => !DG.tradeFilters.hidden.has(t)).length;
    const btnText = `Acciones (${visibleCount}/${tickerArray.length}) ▼`;

    let dropdown = document.getElementById("tradeDropdown");
    if (!dropdown) {
      container.innerHTML = `
        <div class="custom-dropdown" id="tradeDropdown">
          <button class="dropdown-btn" id="tradeDropdownBtn"><span>${btnText}</span></button>
          <div class="dropdown-content">
            <div class="dropdown-search"><input type="text" id="tradeSearchInput" placeholder="Buscar ticker..."></div>
            <div class="dropdown-actions">
              <button id="btnMarcarTodas">Todas</button>
              <button id="btnDesmarcarTodas">Limpiar</button>
            </div>
            <div id="dropdownList"></div>
          </div>
        </div>
      `;

      document.getElementById("tradeDropdownBtn").onclick = (e) => { e.stopPropagation(); document.getElementById("tradeDropdown").classList.toggle("open"); };
      document.getElementById("tradeSearchInput").onkeyup = (e) => {
        const val = e.target.value.toLowerCase();
        document.querySelectorAll(".dropdown-item").forEach(i => i.style.display = i.textContent.toLowerCase().includes(val) ? "flex" : "none");
      };
      document.getElementById("btnMarcarTodas").onclick = () => { DG.tradeFilters.hidden.clear(); DG.renderPerfChart(twr, benchSeries, visible, range, events); };
      document.getElementById("btnDesmarcarTodas").onclick = () => { tickerArray.forEach(t => DG.tradeFilters.hidden.add(t)); DG.renderPerfChart(twr, benchSeries, visible, range, events); };
    } else {
      document.getElementById("tradeDropdownBtn").querySelector("span").textContent = btnText;
    }

    const list = document.getElementById("dropdownList");
    list.innerHTML = "";
    tickerArray.forEach(ticker => {
      const label = document.createElement("label");
      label.className = "dropdown-item";
      label.innerHTML = `<input type="checkbox" ${!DG.tradeFilters.hidden.has(ticker) ? "checked" : ""}> ${ticker}`;
      label.querySelector("input").onchange = (e) => {
        e.target.checked ? DG.tradeFilters.hidden.delete(ticker) : DG.tradeFilters.hidden.add(ticker);
        DG.renderPerfChart(twr, benchSeries, visible, range, events);
      };
      list.appendChild(label);
    });
  }

  DG.renderMoneyChart = function (moneySeries, range) {
    let rows = moneySeries;
    if (range) {
      const mFrom = range.from.slice(0, 7), mTo = range.to.slice(0, 7);
      rows = moneySeries.filter(m => m.month >= mFrom && m.month <= mTo);
    }
    const cfg = {
      data: {
        labels: rows.map(m => m.month),
        datasets: [
          { type: "bar", label: "Aportado", data: rows.map(m => m.netCum), backgroundColor: "rgba(0,41,78,.55)", stack: "money" },
          { type: "bar", label: "Ganancia", data: rows.map(m => m.gain), backgroundColor: rows.map(m => (m.gain ?? 0) >= 0 ? "rgba(46,158,91,.65)" : "rgba(214,69,65,.65)"), stack: "money" },
          { type: "line", label: "Valor", data: rows.map(m => m.value), borderColor: "#009fdf", borderWidth: 2, pointRadius: 0, tension: .15 }
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: v => EUR.format(v) } } } }
    };
    if (moneyChart) moneyChart.destroy();
    moneyChart = new Chart(document.getElementById("moneyChart"), cfg);
  };
})();
