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

    // Re-basar el TWR del usuario a 100 al inicio del rango
    const base = pts[0].index;
    const userData = pts.map(p => ({ x: p.day, y: (p.index / base) * 100 }));
    
    // Diccionario rápido para saber qué altura (Y) tenía la cartera en cada día (X)
    const yByDay = new Map(userData.map(d => [d.x, d.y]));

    const datasets = [{
      label: "Mi cartera",
      data: userData,
      borderColor: "#009fdf",
      backgroundColor: "rgba(0,159,223,.08)",
      borderWidth: 2.5, pointRadius: 0, fill: true, tension: .1,
    }];

    // --- PROCESAMIENTO DE COMPRAS Y VENTAS PARA PINTAR PUNTOS ---
    const buyData = [];
    const sellData = [];

    for (const ev of events) {
      if (ev.type === "trade" && ev.date) {
        const day = DG.dayKey(ev.date);
        
        // Solo dibujamos los puntos si están dentro del rango de fechas que miramos
        if (day >= range.from && day <= range.to && yByDay.has(day)) {
          const yVal = yByDay.get(day); // Altura exacta de la línea ese día
          const qty = Math.abs(ev.qty).toLocaleString("es-ES");
          const price = ev.price.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
          const cur = ev.tradeCur || "EUR";
          const action = ev.side === 1 ? "Compra" : "Venta";
          
          // Intentar sacar el Ticker (ej: ASTS) desde el ISIN, si no, usa el propio ISIN
          const ticker = (DG.ISIN_TO_YAHOO && DG.ISIN_TO_YAHOO[ev.isin]) ? DG.ISIN_TO_YAHOO[ev.isin] : ev.isin;
          const product = ev.product || "Desconocido";

          // Texto exacto para el Tooltip
          const desc = `${action} de ${product}, ${qty}x$${price}. Tipo: ${ticker}`;

          const pt = { x: day, y: yVal, desc: desc };
          
          if (ev.side === 1) buyData.push(pt);
          else sellData.push(pt);
        }
      }
    }

    // Dibujar puntos verdes encima de la línea
    if (buyData.length > 0) {
      datasets.push({
        label: "Compras", data: buyData, type: "scatter",
        backgroundColor: "#2e9e5b", borderColor: "#ffffff", borderWidth: 1.5,
        pointRadius: 5, pointHoverRadius: 7, order: 0 // order 0 para que se dibuje por encima
      });
    }

    // Dibujar puntos rojos encima de la línea
    if (sellData.length > 0) {
      datasets.push({
        label: "Ventas", data: sellData, type: "scatter",
        backgroundColor: "#d64541", borderColor: "#ffffff", borderWidth: 1.5,
        pointRadius: 5, pointHoverRadius: 7, order: 0
      });
    }
    // -------------------------------------------------------------

    for (const [id, b] of benchSeries) {
      if (!visible.has(id) || !b.map) continue;
      const start = DG.seriesAt(b.map, pts[0].day);
      if (!start) continue;
      const data = [];
      for (const p of pts) {
        const v = DG.seriesAt(b.map, p.day);
        if (v != null) data.push({ x: p.day, y: (v / start) * 100 });
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
                // MODIFICACIÓN DEL TOOLTIP: Si es un punto de compra/venta, muestra nuestra descripción
                if (ctx.dataset.type === "scatter") {
                  return ` ${ctx.raw.desc}`;
                }
                // Si es la línea de cartera o índice, muestra el porcentaje normal
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
  };

  /**
   * @param moneySeries serie mensual completa
   * @param range {from,to} dayKeys — mismo filtro de fechas que el gráfico
   *              de rendimiento (se comparan por mes 'YYYY-MM')
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
