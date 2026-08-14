/**
 * app.js — Orquestación: carga del archivo, descarga de precios,
 * cálculo de métricas y render del dashboard.
 */
"use strict";

(function () {
  const DG = window.DG;
  const $ = id => document.getElementById(id);
  
  // Estado global para las acciones ocultas
  DG.tradeFilters = DG.tradeFilters || { hidden: new Set() };

  const EUR = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
  const EUR0 = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const PCT = v => (v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%");

  const ctx = {
    state: null, twr: null, valueSeries: null,
    benchSeries: new Map(), visibleBench: new Set(),
    priceProviders: new Map(), fxSeries: new Map(),
    productRows: [], range: null, warnings: [],
    events: [] 
  };

  // ---------- carga de archivo ----------
  const dz = $("dropZone");
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("dragover"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
  dz.addEventListener("drop", e => {
    e.preventDefault(); dz.classList.remove("dragover");
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  $("fileInput").addEventListener("change", e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  function log(msg) {
    $("loadStatus").classList.remove("hidden");
    $("loadLog").textContent = msg;
  }

  async function handleFile(file) {
    try {
      log("Leyendo " + file.name + "…");
      const buf = await file.arrayBuffer();
      const { events, warnings } = DG.parseAccountFile(buf);
      ctx.warnings = warnings;
      ctx.events = events; 
      
      log(`${events.length} movimientos leídos. Reconstruyendo cartera…`);
      ctx.state = DG.replay(events);

      log("Descargando precios históricos (Yahoo Finance)…");
      await loadAllPrices();

      log("Calculando métricas…");
      compute();
      render();
      $("uploadView").classList.add("hidden");
      $("dashboard").classList.remove("hidden");
    } catch (err) {
      console.error(err);
      log("Error: " + err.message + "\nRevisa que el archivo sea el export de 'Estado de cuenta' de DEGIRO.");
    }
  }

  // ---------- precios ----------
  async function loadAllPrices() {
    const st = ctx.state;
    const from = st.firstDate;

    const fxJobs = [...st.currencies].filter(c => c !== "EUR").map(async c => {
      try { ctx.fxSeries.set(c, await DG.fetchFxSeries(c, from)); }
      catch { ctx.warnings.push("Sin serie FX para " + c); }
    });

    const benchJobs = DG.BENCHMARKS.map(async b => {
      try {
        const { map } = await DG.fetchYahooSeries(b.symbol, from);
        ctx.benchSeries.set(b.id, { label: b.label, color: b.color, map });
        if (b.on) ctx.visibleBench.add(b.id);
      } catch {
        ctx.benchSeries.set(b.id, { label: b.label, color: b.color, map: null });
        ctx.warnings.push("Índice no disponible: " + b.label);
      }
    });

    const isins = [...st.products.keys()];
    const prodJobs = isins.map(async isin => {
      const fbPoints = st.tradePricePoints.get(isin) || [];
      const fb = fbPoints.length ? DG.tradeFallbackSeries(fbPoints) : null;
      let symbol = DG.ISIN_TO_YAHOO[isin];
      const stillOpen = Math.abs(st.products.get(isin).qty) > 1e-9;
      if (!symbol && stillOpen) symbol = await DG.searchYahooByISIN(isin);
      if (symbol) {
        try {
          const { map, meta } = await DG.fetchYahooSeries(symbol, from);
          const pp = { kind: "yahoo", map, meta, fb };
          const verdict = DG.validateAgainstTrades(pp, fbPoints);
          if (verdict === "rejected") {
            if (fb) ctx.priceProviders.set(isin, { kind: "fallback", fb });
            ctx.warnings.push("Cotización de Yahoo (" + symbol + ") incoherente con tus operaciones en " + st.products.get(isin).name + " — usando precios de tus operaciones.");
            return;
          }
          if (verdict === "rescaled") {
            ctx.warnings.push("Serie de " + st.products.get(isin).name + " re-escalada (consolidación no publicada en Yahoo).");
          }
          ctx.priceProviders.set(isin, pp);
          return;
        } catch { }
      }
      if (fb) {
        ctx.priceProviders.set(isin, { kind: "fallback", fb });
        if (stillOpen) ctx.warnings.push("Sin cotización online para " + st.products.get(isin).name + " — usando precios de tus operaciones.");
      }
    });

    await Promise.allSettled([...fxJobs, ...benchJobs, ...prodJobs]);
  }

  // ---------- métricas ----------
  function compute() {
    const st = ctx.state;
    DG.resolvePending(st, ctx.fxSeries);
    const { series, missingPrices } = DG.buildValueSeries(st, ctx.priceProviders, ctx.fxSeries);
    ctx.valueSeries = series;
    for (const isin of missingPrices) {
      const p = st.products.get(isin);
      if (p && Math.abs(p.qty) > 1e-9) ctx.warnings.push("Sin precio en parte del histórico: " + p.name);
    }
    ctx.twr = DG.buildTWR(series, st.flows);
    const lastDay = series[series.length - 1].day;
    ctx.productRows = DG.productPnL(st, ctx.priceProviders, ctx.fxSeries, lastDay);
    ctx.moneySeries = DG.buildMoneySeries(series, st.flows);
    ctx.range = { from: series[0].day, to: lastDay };
  }

  // ---------- render ----------
  function render() {
    const st = ctx.state;
    const series = ctx.valueSeries;
    const last = series[series.length - 1];
    const valuationDate = new Date(last.day + "T00:00:00Z");
    const netDeposits = st.totals.deposits + st.totals.withdrawals;
    const totalGain = last.value - netDeposits;
    
    $("topbarInfo").textContent = `${DG.dayKey(st.firstDate)} → ${last.day} · ${st.products.size} productos`;

    const cards = [
      { label: "Valor de la cartera", value: EUR.format(last.value), sub: "efectivo: " + EUR.format(last.cash) },
      { label: "Aportado neto", value: EUR0.format(netDeposits), sub: `ingresos ${EUR0.format(st.totals.deposits)} · retiradas ${EUR0.format(-st.totals.withdrawals)}` },
      { label: "Ganancia total", value: EUR0.format(totalGain), cls: totalGain >= 0 ? "pos" : "neg", sub: PCT(netDeposits > 0 ? totalGain / netDeposits : null) + " sobre aportado" },
      { id: "cardXirr", label: "¿Cuánto rinde mi dinero?", value: "—", sub: "" },
      { id: "cardTwr", label: "¿Cómo lo hace mi estrategia?", value: "—", sub: "" },
      { label: "Dividendos + préstamo", value: EUR0.format(st.totals.dividendsEUR + st.totals.lendingEUR), sub: "comisiones: " + EUR0.format(st.totals.fees) },
    ];
    $("summaryCards").innerHTML = cards.map(c =>
      `<div class="card"${c.id ? ` id="${c.id}"` : ""}><div class="label">${c.label}</div><div class="value ${c.cls || ""}">${c.value}</div><div class="sub">${c.sub || ""}</div></div>`
    ).join("");

    renderBenchToggles();
    drawPerf();
    renderTable("open");
    renderWarnings();

    $("rangeStart").value = ctx.range.from;
    $("rangeEnd").value = ctx.range.to;
  }

  function renderBenchToggles() {
    const el = $("benchToggles");
    el.innerHTML = "";
    for (const b of DG.BENCHMARKS) {
      const s = ctx.benchSeries.get(b.id);
      const div = document.createElement("div");
      const avail = s && s.map;
      div.className = "toggle" + (avail ? (ctx.visibleBench.has(b.id) ? "" : " off") : " unavailable");
      div.innerHTML = `<span class="dot" style="background:${b.color}"></span>${b.label}`;
      if (avail) {
        div.onclick = () => {
          if (ctx.visibleBench.has(b.id)) ctx.visibleBench.delete(b.id);
          else ctx.visibleBench.add(b.id);
          div.classList.toggle("off");
          drawPerf();
        };
      } else {
        div.title = "No disponible en Yahoo Finance";
      }
      el.appendChild(div);
    }
  }

  function drawPerf() {
    DG.renderPerfChart(ctx.twr, ctx.benchSeries, ctx.visibleBench, ctx.range, ctx.events);
    DG.renderMoneyChart(ctx.moneySeries, ctx.range);
    updateRangeCards();
  }

  function updateRangeCards() {
    const m = DG.rangeMetrics(ctx.valueSeries, ctx.twr, ctx.state.flows, ctx.range);
    const isFull = ctx.range.from === ctx.valueSeries[0].day &&
                   ctx.range.to === ctx.valueSeries[ctx.valueSeries.length - 1].day;
    const rangeTxt = isFull ? "" : ` · ${ctx.range.from} → ${ctx.range.to}`;
    if (!m) return;

    const setCard = (id, value, cls, sub) => {
      const el = $(id);
      if (!el) return;
      el.querySelector(".value").textContent = value;
      el.querySelector(".value").className = "value " + cls;
      el.querySelector(".sub").textContent = sub;
    };

    const twrAnnual = (m.twrPeriod != null && m.years >= 1 && m.twrPeriod > -1)
      ? Math.pow(1 + m.twrPeriod, 1 / m.years) - 1 : null;

    if (m.years >= 1) {
      setCard("cardXirr", m.xirr != null ? PCT(m.xirr) : "—", (m.xirr ?? 0) >= 0 ? "pos" : "neg",
        `anual, con tu timing de aportaciones · acumulado ${PCT(m.periodMoney)}` + rangeTxt);
      setCard("cardTwr", twrAnnual != null ? PCT(twrAnnual) : "—", (twrAnnual ?? 0) >= 0 ? "pos" : "neg",
        `anual, comparable con índices · acumulado ${PCT(m.twrPeriod)}` + rangeTxt);
    } else {
      setCard("cardXirr", m.periodMoney != null ? PCT(m.periodMoney) : "—", (m.periodMoney ?? 0) >= 0 ? "pos" : "neg",
        "del periodo, sin anualizar (rango < 1 año)" + rangeTxt);
      setCard("cardTwr", m.twrPeriod != null ? PCT(m.twrPeriod) : "—", (m.twrPeriod ?? 0) >= 0 ? "pos" : "neg",
        "del periodo, comparable con índices (rango < 1 año)" + rangeTxt);
    }
  }

  document.querySelectorAll("#presetBtns button").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("#presetBtns button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const to = ctx.valueSeries[ctx.valueSeries.length - 1].day;
      const toD = new Date(to + "T00:00:00Z");
      let fromD = new Date(toD);
      switch (btn.dataset.range) {
        case "1m": fromD.setUTCMonth(fromD.getUTCMonth() - 1); break;
        case "6m": fromD.setUTCMonth(fromD.getUTCMonth() - 6); break;
        case "ytd": fromD = new Date(Date.UTC(toD.getUTCFullYear(), 0, 1)); break;
        case "1y": fromD.setUTCFullYear(fromD.getUTCFullYear() - 1); break;
        case "3y": fromD.setUTCFullYear(fromD.getUTCFullYear() - 3); break;
        case "5y": fromD.setUTCFullYear(fromD.getUTCFullYear() - 5); break;
        default: fromD = new Date(ctx.valueSeries[0].day + "T00:00:00Z");
      }
      const from = fromD.toISOString().slice(0, 10);
      ctx.range = { from: from < ctx.valueSeries[0].day ? ctx.valueSeries[0].day : from, to };
      $("rangeStart").value = ctx.range.from;
      $("rangeEnd").value = ctx.range.to;
      drawPerf();
    };
  });

  function onCustomRange() {
    const from = $("rangeStart").value, to = $("rangeEnd").value;
    if (!from || !to || from >= to) return;
    document.querySelectorAll("#presetBtns button").forEach(b => b.classList.remove("active"));
    ctx.range = { from, to };
    drawPerf();
  }
  $("rangeStart").addEventListener("change", onCustomRange);
  $("rangeEnd").addEventListener("change", onCustomRange);

  // ---------- TABLA Y ORDENACIÓN ----------
  let currentTab = "open";
  let currentSort = { col: 'pnl', asc: false }; // Por defecto: P/G de mayor a menor

  function renderTable(tab) {
    currentTab = tab;
    for (const [id, t] of [["tabOpen", "open"], ["tabClosed", "closed"], ["tabAll", "all"]]) {
      $(id).classList.toggle("active", t === tab);
    }

    // Inyectar dinámicamente la cabecera del tick si no existe
    const theadTr = document.querySelector("#productTable thead tr");
    if (theadTr && !theadTr.dataset.modified) {
       theadTr.insertAdjacentHTML('afterbegin', '<th class="center" title="Mostrar/ocultar operaciones en la gráfica">📉</th>');
       theadTr.dataset.modified = "true";
    }

    // Inyectar controles de la tabla dinámicamente
    let controls = $("tableControls");
    if (!controls) {
      controls = document.createElement("div");
      controls.id = "tableControls";
      controls.className = "table-controls";
      controls.innerHTML = `
        <button id="btnCheckAll" class="btn-secondary">Hacer todos los ticks</button>
        <button id="btnUncheckAll" class="btn-secondary">Quitar todos los ticks</button>
        <span class="sort-label">Ordenar por:</span>
        <button id="btnSortName" class="btn-secondary">Alfabeto ↕</button>
        <button id="btnSortPnL" class="btn-secondary">P/G ↕</button>
      `;
      const tableWrap = document.querySelector(".table-wrap");
      if (tableWrap) tableWrap.parentNode.insertBefore(controls, tableWrap);

      $("btnCheckAll").onclick = () => { DG.tradeFilters.hidden.clear(); renderTable(currentTab); drawPerf(); };
      $("btnUncheckAll").onclick = () => {
         ctx.productRows.forEach(r => {
            const ticker = (DG.ISIN_TO_YAHOO && DG.ISIN_TO_YAHOO[r.isin]) ? DG.ISIN_TO_YAHOO[r.isin] : r.isin;
            DG.tradeFilters.hidden.add(ticker);
         });
         renderTable(currentTab); drawPerf();
      };
      $("btnSortName").onclick = () => { 
         if(currentSort.col === 'name') currentSort.asc = !currentSort.asc;
         else { currentSort.col = 'name'; currentSort.asc = true; }
         renderTable(currentTab); 
      };
      $("btnSortPnL").onclick = () => { 
         if(currentSort.col === 'pnl') currentSort.asc = !currentSort.asc;
         else { currentSort.col = 'pnl'; currentSort.asc = false; }
         renderTable(currentTab); 
      };
    }

    const rows = ctx.productRows.filter(r =>
      tab === "all" ? true : tab === "open" ? r.open : !r.open
    );

    // Aplicar ordenación
    rows.sort((a, b) => {
       let valA = a[currentSort.col] || (currentSort.col === 'name' ? "" : 0);
       let valB = b[currentSort.col] || (currentSort.col === 'name' ? "" : 0);
       if (typeof valA === 'string') valA = valA.toLowerCase();
       if (typeof valB === 'string') valB = valB.toLowerCase();
       
       if (valA < valB) return currentSort.asc ? -1 : 1;
       if (valA > valB) return currentSort.asc ? 1 : -1;
       return 0;
    });

    const tbody = document.querySelector("#productTable tbody");
    tbody.innerHTML = rows.map(r => {
      const ticker = (DG.ISIN_TO_YAHOO && DG.ISIN_TO_YAHOO[r.isin]) ? DG.ISIN_TO_YAHOO[r.isin] : r.isin;
      const isChecked = !DG.tradeFilters.hidden.has(ticker);
      return `
      <tr>
        <td class="center"><input type="checkbox" class="trade-toggle" data-ticker="${ticker}" ${isChecked ? "checked" : ""}></td>
        <td class="prod" title="${r.isin}">${r.name}</td>
        <td class="num">${r.open ? r.qty.toLocaleString("es-ES", { maximumFractionDigits: 4 }) : "—"}</td>
        <td class="num">${r.open ? EUR.format(r.value) : "—"}</td>
        <td class="num">${EUR.format(r.invested)}</td>
        <td class="num">${EUR.format(r.received)}</td>
        <td class="num">${r.dividends ? EUR.format(r.dividends) : "—"}</td>
        <td class="num ${r.pnl >= 0 ? "pos" : "neg"}"><b>${(r.pnl >= 0 ? "+" : "") + EUR.format(r.pnl)}</b></td>
        <td class="num ${r.pnl >= 0 ? "pos" : "neg"}">${PCT(r.pct)}</td>
      </tr>`;
    }).join("");

    // Eventos de los checkboxes para actualizar la gráfica
    document.querySelectorAll(".trade-toggle").forEach(cb => {
      cb.addEventListener("change", (e) => {
         const ticker = e.target.dataset.ticker;
         if (e.target.checked) {
             DG.tradeFilters.hidden.delete(ticker);
         } else {
             DG.tradeFilters.hidden.add(ticker);
         }
         drawPerf(); // Re-dibuja al instante
      });
    });
  }

  $("tabOpen").onclick = () => renderTable("open");
  $("tabClosed").onclick = () => renderTable("closed");
  $("tabAll").onclick = () => renderTable("all");

  function renderWarnings() {
    const uniq = [...new Set(ctx.warnings)];
    if (!uniq.length) return;
    $("warnPanel").classList.remove("hidden");
    $("warnList").innerHTML = uniq.map(w => `<li>${w}</li>`).join("");
  }
})();
