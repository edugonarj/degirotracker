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

  // Estado global para los filtros de operaciones en el gráfico
  DG.tradeFilters = DG.tradeFilters || { showAny: true, hidden: new Set() };

  /**
   * @param twr [{day,index}] serie del usuario
   * @param benchSeries Map id -> {label,color,map} (Map dayKey->close)
   * @param visible Set de ids visibles
   * @param range {from,to} dayKeys
   * @param events [] Movimientos en bruto para dibujar compras/ventas
   */
  DG.renderPerfChart = function (twr, benchSeries, visible, range, events = []) {
    const pts = twr.filter(p => p.day >= range.from && p.day <= range.to);
    if (!pts.length) return;

    const base = pts[0].index;
    const yByDay = new Map(pts.map(p => [p.day, (p.index / base) * 100]));

    const userData = pts.map(p => ({ 
      x: new Date(p.day + "T00:00:00Z").getTime(), 
      y: (p.index / base) * 100 
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
        
        if (day >= range.from && day <= range.to && yByDay.has(day)) {
          const ticker = (DG.ISIN_TO_YAHOO && DG.ISIN_TO_YAHOO[ev.isin]) ? DG.ISIN_TO_YAHOO[ev.isin] : ev.isin;
          tickersInView.add(ticker);

          if (!DG.tradeFilters.showAny || DG.tradeFilters.hidden.has(ticker)) continue;

          const yVal = yByDay.get(day); 
          const qty = Math.abs(ev.qty).toLocaleString("es-ES");
          const price = ev.price.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const action = ev.side === 1 ? "Compra" : "Venta";
          
          const desc = `${action} de ${ticker}, ${qty}x$${price}`;

          const pt = { 
            x: new Date(day + "T00:00:00Z").getTime(), 
            y: yVal, 
            desc: desc 
          };
          
          if (ev.side === 1) buyData.push(pt);
          else sellData.push(pt);
        }
      }
    }

    if (buyData.length > 0) {
      datasets.push({
        label: "Compras", data: buyData, type: "scatter", xAxisID: "x",
        backgroundColor: "#2e9e5b", borderColor: "#ffffff", borderWidth: 1.5,
        pointRadius: 5, pointHoverRadius: 7, order: 0 
      });
    }

    if (sellData.length > 0) {
      datasets.push({
        label: "Ventas", data: sellData, type: "scatter", xAxisID: "x",
        backgroundColor: "#d64541", borderColor: "#ffffff", borderWidth: 1.5,
        pointRadius: 5, pointHoverRadius: 7, order: 0
      });
    }

    for (const [id, b] of benchSeries) {
      if (!visible.has(id) || !b.map) continue;
      const start = DG.seriesAt(b.map, pts[0].day);
      if (!start) continue;
      const data = [];
      for (const p of pts) {
        const v = DG.seriesAt(b.map, p.day);
        if (v != null) data.push({ x: new Date(p.day + "T00:00:00Z").getTime(), y: (v / start) * 100 });
      }
      datasets.push({
        label: b.label, data, borderColor: b.color,
        borderWidth: 1.6, pointRadius: 0, fill: false, tension: .1,
      });
    }

    const cfg = {
      type: "line",
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { type: "time", time: { unit: "month", tooltipFormat: "dd MMM yyyy" }, grid: { display: false } },
          y: { ticks: { callback: v => v.toFixed(0) }, title: { display: true, text: "Base 100" } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                if (ctx.dataset.type === "scatter") {
                  return ` ${ctx.raw.desc}`;
                }
                return ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} (${(ctx.parsed.y - 100).toFixed(1)}%)`;
              }
            },
          },
          zoom: {
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" },
            pan: { enabled: true, mode: "x", modifierKey: "shift" },
          },
        },
      },
    };

    const ctxCanvas = document.getElementById("perfChart");
    if (perfChart) perfChart.destroy();
    perfChart = new Chart(ctxCanvas, cfg);
    ctxCanvas.ondblclick = () => perfChart.resetZoom();

    renderTradeToggles(tickersInView, twr, benchSeries, visible, range, events);
  };

  /**
   * Genera los botones para encender/apagar puntos de compra y venta.
   */
  function renderTradeToggles(tickers, twr, benchSeries, visible, range, events) {
    let container = document.getElementById("tradeToggles");
    
    // Si no existe, lo inyectamos dinámicamente debajo de benchToggles
    if (!container) {
      container = document.createElement("div");
      container.id = "tradeToggles";
      container.className = "bench-toggles";
      container.style.marginTop = "8px";
      const benchDiv = document.getElementById("benchToggles");
      if (benchDiv) benchDiv.parentNode.insertBefore(container, benchDiv.nextSibling);
    }
    
    container.innerHTML = "";
    if (tickers.size === 0) return;

    // Botón Bulk
    const bulkBtn = document.createElement("div");
    bulkBtn.className = "toggle" + (DG.tradeFilters.showAny ? "" : " off");
    bulkBtn.innerHTML = `<span class="dot" style="background:#1c2b3a"></span>Mostrar Operaciones`;
    bulkBtn.onclick = () => {
      DG.tradeFilters.showAny = !DG.tradeFilters.showAny;
      DG.renderPerfChart(twr, benchSeries, visible, range, events);
    };
    container.appendChild(bulkBtn);

    // Botones Individuales (se ocultan si el Bulk está desactivado)
    if (DG.tradeFilters.showAny) {
      Array.from(tickers).sort().forEach(ticker => {
        const btn = document.createElement("div");
        const isHidden = DG.tradeFilters.hidden.has(ticker);
        btn.className = "toggle" + (isHidden ? " off" : "");
        btn.innerHTML = `<span class="dot" style="background:#6b7a89"></span>${ticker}`;
        btn.onclick = () => {
          if (isHidden) {
            DG.tradeFilters.hidden.delete(ticker);
          } else {
            DG.tradeFilters.hidden.add(ticker);
          }
          DG.renderPerfChart(twr, benchSeries, visible, range, events);
        };
        container.appendChild(btn);
      });
    }
  }

  /**
   * @param moneySeries serie mensual completa
   * @param range {from,to} dayKeys
   */
  DG.renderMoneyChart = function (moneySeries, range) {
    let rows = moneySeries;
    if (range) {
      const mFrom = range.from.slice(0, 7), mTo = range.to.slice(0, 7);
      rows = moneySeries.filter(m => m.month >= mFrom && m.month <= mTo);
    }
    if (!rows.length) rows = moneySeries;
    const cfg = {
      data: {
        labels: rows.map(m => m.month),
        datasets: [
          {
            type: "bar", label: "Aportación neta acumulada",
            data: rows.map(m => m.netCum),
            backgroundColor: "rgba(0,41,78,.55)", borderRadius: 2, order: 3,
            stack: "money",
          },
          {
            type: "bar", label: "Ganancia (valor − aportado)",
            data: rows.map(m => m.gain),
            backgroundColor: rows.map(m => (m.gain ?? 0) >= 0 ? "rgba(46,158,91,.65)" : "rgba(214,69,65,.65)"),
            borderRadius: 2, order: 2,
            stack: "money",
          },
          {
            type: "line", label: "Valor de la cartera",
            data: rows.map(m => m.value),
            borderColor: "#009fdf", borderWidth: 2, pointRadius: 0, tension: .15, order: 1,
            stack: "valor",
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, ticks: { callback: v => EUR.format(v) } },
        },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${EUR.format(ctx.parsed.y ?? 0)}` } },
        },
      },
    };
    const ctxCanvas = document.getElementById("moneyChart");
    if (moneyChart) moneyChart.destroy();
    moneyChart = new Chart(ctxCanvas, cfg);
  };
})();
