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

  // Estado global para los filtros de operaciones
  DG.tradeFilters = DG.tradeFilters || { hidden: new Set(), dropdownOpen: false };

  // Listener global para cerrar el dropdown si se hace clic fuera de él
  document.addEventListener("click", (e) => {
    const dropdown = document.getElementById("tradeDropdown");
    if (dropdown && !dropdown.contains(e.target)) {
      dropdown.classList.remove("open");
      DG.tradeFilters.dropdownOpen = false;
    }
  });

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
    
    // Mapa para saber en qué índice (0, 1, 2...) del array cae cada fecha exacta
    const dayToIndex = new Map(pts.map((p, i) => [p.day, i]));

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

    // Rellenamos de 'null' para que los índices coincidan milimétricamente con la línea de la cartera
    const buyData = new Array(pts.length).fill(null);
    const sellData = new Array(pts.length).fill(null);
    const tickersInView = new Set();

    for (const ev of events) {
      if (ev.type === "trade" && ev.date) {
        const day = DG.dayKey(ev.date);
        
        // Si el día de la operación existe en el rango visible
        if (dayToIndex.has(day)) {
          const idx = dayToIndex.get(day); // Obtenemos el índice exacto del día
          const yVal = userData[idx].y; 
          
          const ticker = (DG.ISIN_TO_YAHOO && DG.ISIN_TO_YAHOO[ev.isin]) ? DG.ISIN_TO_YAHOO[ev.isin] : ev.isin;
          tickersInView.add(ticker);

          if (DG.tradeFilters.hidden.has(ticker)) continue;

          const qty = Math.abs(ev.qty).toLocaleString("es-ES");
          const price = ev.price.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const action = ev.side === 1 ? "Compra" : "Venta";
          
          const desc = `${action} de ${ticker}, ${qty}x$${price}`;
          const pt = { x: userData[idx].x, y: yVal, desc: desc };

          // Si hay varias operaciones el mismo día, concatenamos el texto en el mismo índice
          if (ev.side === 1) {
            if (buyData[idx]) buyData[idx].desc += " | " + desc;
            else buyData[idx] = pt;
          } else {
            if (sellData[idx]) sellData[idx].desc += " | " + desc;
            else sellData[idx] = pt;
          }
        }
      }
    }

    if (buyData.some(d => d !== null)) {
      datasets.push({
        label: "Compras", data: buyData, type: "line", showLine: false,
        backgroundColor: "#2e9e5b", borderColor: "#ffffff", borderWidth: 1.5,
        pointRadius: ctx => ctx.raw ? 5 : 0, pointHoverRadius: ctx => ctx.raw ? 7 : 0, order: 0 
      });
    }

    if (sellData.some(d => d !== null)) {
      datasets.push({
        label: "Ventas", data: sellData, type: "line", showLine: false,
        backgroundColor: "#d64541", borderColor: "#ffffff", borderWidth: 1.5,
        pointRadius: ctx => ctx.raw ? 5 : 0, pointHoverRadius: ctx => ctx.raw ? 7 : 0, order: 0
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
        else data.push(null); // Conservamos el 'null' para no descuadrar los índices de los benchmarks
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
        // Al alinear los arrays con nulls, el modo 'index' funciona perfectamente
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
                if (ctx.raw && ctx.raw.desc) {
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

    // Renderizar o actualizar el menú desplegable dinámicamente
    renderTradeDropdown(tickersInView, twr, benchSeries, visible, range, events);
  };

  /**
   * Genera y mantiene el estado del menú desplegable con buscador.
   */
  function renderTradeDropdown(tickers, twr, benchSeries, visible, range, events) {
    let container = document.getElementById("tradeFiltersContainer");
    
    // Inyectarlo debajo de los botones de índices si no existe
    if (!container) {
      container = document.createElement("div");
      container.id = "tradeFiltersContainer";
      container.className = "trade-filters-container";
      const benchDiv = document.getElementById("benchToggles");
      if (benchDiv) benchDiv.parentNode.insertBefore(container, benchDiv.nextSibling);
    }
    
    if (tickers.size === 0) {
      container.innerHTML = "";
      return;
    }

    const tickerArray = Array.from(tickers).sort();
    const visibleCount = tickerArray.filter(t => !DG.tradeFilters.hidden.has(t)).length;
    const btnText = `Filtro operaciones: ${visibleCount}/${tickerArray.length} visibles ▼`;

    // Si el menú no existe en el DOM, lo construimos desde cero
    let dropdown = document.getElementById("tradeDropdown");
    if (!dropdown) {
      container.innerHTML = `
        <div class="custom-dropdown ${DG.tradeFilters.dropdownOpen ? 'open' : ''}" id="tradeDropdown">
          <button class="dropdown-btn" id="tradeDropdownBtn">
            <span class="dot" style="background:#1c2b3a"></span>
            <span id="tradeDropdownText">${btnText}</span>
          </button>
          <div class="dropdown-content" id="tradeDropdownContent">
            <div class="dropdown-header">
              <div class="dropdown-search">
                <input type="text" id="tradeSearchInput" placeholder="Buscar ticker..." autocomplete="off">
              </div>
              <div class="dropdown-actions">
                <button id="btnMarcarTodas">Marcar todas</button>
                <button id="btnDesmarcarTodas">Limpiar</button>
              </div>
            </div>
            <div id="dropdownList"></div>
          </div>
        </div>
      `;

      // Eventos del botón principal
      document.getElementById("tradeDropdownBtn").onclick = (e) => {
        e.stopPropagation();
        DG.tradeFilters.dropdownOpen = !DG.tradeFilters.dropdownOpen;
        document.getElementById("tradeDropdown").classList.toggle("open", DG.tradeFilters.dropdownOpen);
        if (DG.tradeFilters.dropdownOpen) {
          document.getElementById("tradeSearchInput").focus();
        }
      };

      // Eventos del buscador
      const searchInput = document.getElementById("tradeSearchInput");
      searchInput.onclick = (e) => e.stopPropagation();
      searchInput.onkeyup = (e) => {
        const filter = e.target.value.toLowerCase();
        const items = document.querySelectorAll(".dropdown-item");
        items.forEach(item => {
          const text = item.textContent.toLowerCase();
          item.style.display = text.includes(filter) ? "flex" : "none";
        });
      };

      // Eventos de limpieza global
      document.getElementById("btnMarcarTodas").onclick = (e) => {
        e.stopPropagation();
        DG.tradeFilters.hidden.clear();
        DG.renderPerfChart(twr, benchSeries, visible, range, events);
      };

      document.getElementById("btnDesmarcarTodas").onclick = (e) => {
        e.stopPropagation();
        tickerArray.forEach(t => DG.tradeFilters.hidden.add(t));
        DG.renderPerfChart(twr, benchSeries, visible, range, events);
      };

      // Rellenar la lista de checkboxes
      const list = document.getElementById("dropdownList");
      tickerArray.forEach(ticker => {
        const isChecked = !DG.tradeFilters.hidden.has(ticker);
        const label = document.createElement("label");
        label.className = "dropdown-item";
        label.innerHTML = `<input type="checkbox" value="${ticker}" ${isChecked ? "checked" : ""}> ${ticker}`;
        
        const checkbox = label.querySelector("input");
        checkbox.onclick = (e) => e.stopPropagation(); // Evitar cerrar al hacer clic
        checkbox.onchange = (e) => {
          if (e.target.checked) {
            DG.tradeFilters.hidden.delete(ticker);
          } else {
            DG.tradeFilters.hidden.add(ticker);
          }
          DG.renderPerfChart(twr, benchSeries, visible, range, events);
        };
        
        list.appendChild(label);
      });
    } else {
      // Si el menú ya existe, SOLO actualizamos los textos y las marcas (sin destruir el DOM)
      document.getElementById("tradeDropdownText").textContent = btnText;
      
      const checkboxes = document.querySelectorAll("#dropdownList input[type='checkbox']");
      checkboxes.forEach(cb => {
        cb.checked = !DG.tradeFilters.hidden.has(cb.value);
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
