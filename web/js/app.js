/**
 * app.js — Orquestación del dashboard, cambio de idioma en header,
 * filtros/ordenación y módulo de Fiscalidad (FIFO) a prueba de fallos.
 */
"use strict";

(function () {
  const DG = window.DG;
  const $ = id => document.getElementById(id);
  
  DG.tradeFilters = DG.tradeFilters || { hidden: new Set() };

  const i18n = {
    es: {
      btn_lang: "EN",
      val_cartera: "Valor de la cartera",
      efectivo: "efectivo: ",
      aportado: "Aportado neto",
      ingresos: "ingresos",
      retiradas: "retiradas",
      ganancia: "Ganancia total",
      sobre_aportado: "sobre aportado",
      xirr: "¿Cuánto rinde mi dinero?",
      twr: "¿Cómo lo hace mi estrategia?",
      divs: "Dividendos + préstamo",
      comisiones: "comisiones: ",
      productos: "productos",
      hacer_ticks: "Hacer todos los ticks",
      quitar_ticks: "Quitar todos los ticks",
      ord_alfabeto: "Alfabeto ↕",
      ord_pg: "P/G ↕",
      ord_por: "Ordenar por:",
      tab_open: "Abiertas",
      tab_closed: "Cerradas",
      tab_all: "Todas",
      tab_fiscal: "Fiscalidad (FIFO)",
      th_prod: "Producto",
      th_cant: "Cant.",
      th_val: "Valor",
      th_inv: "Invertido",
      th_rec: "Recibido",
      th_div: "Div.",
      f_year: "Año Fiscal:",
      f_acq: "Total Adquisición",
      f_trans: "Total Transmisión",
      f_net: "Rendimiento Neto",
      f_buy: "F. Compra",
      f_sell: "F. Venta",
      f_pbuy: "P. Compra",
      f_psell: "P. Venta",
      f_export: "Exportar CSV"
    },
    en: {
      btn_lang: "ES",
      val_cartera: "Portfolio Value",
      efectivo: "cash: ",
      aportado: "Net Contributed",
      ingresos: "deposits",
      retiradas: "withdrawals",
      ganancia: "Total Gain",
      sobre_aportado: "on contributed",
      xirr: "Money-Weighted Return?",
      twr: "Time-Weighted Return?",
      divs: "Dividends + Lending",
      comisiones: "fees: ",
      productos: "products",
      hacer_ticks: "Check all",
      quitar_ticks: "Uncheck all",
      ord_alfabeto: "Alphabet ↕",
      ord_pg: "P/L ↕",
      ord_por: "Sort by:",
      tab_open: "Open",
      tab_closed: "Closed",
      tab_all: "All",
      tab_fiscal: "Tax (FIFO)",
      th_prod: "Product",
      th_cant: "Qty.",
      th_val: "Value",
      th_inv: "Invested",
      th_rec: "Received",
      th_div: "Div.",
      f_year: "Fiscal Year:",
      f_acq: "Total Acquisition",
      f_trans: "Total Transmission",
      f_net: "Net Yield",
      f_buy: "Buy Date",
      f_sell: "Sell Date",
      f_pbuy: "Buy Price",
      f_psell: "Sell Price",
      f_export: "Export CSV"
    }
  };

  let lang = "es";
  const t = (k) => i18n[lang][k] || k;

  const fmtLoc = () => lang === "es" ? "es-ES" : "en-US";
  const fmt = (v, maxF) => new Intl.NumberFormat(fmtLoc(), { style: "currency", currency: "EUR", maximumFractionDigits: maxF }).format(v);
  const PCT = v => (v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%");

  const ctx = {
    state: null, twr: null, valueSeries: null,
    benchSeries: new Map(), visibleBench: new Set(),
    priceProviders: new Map(), fxSeries: new Map(),
    productRows: [], fifoRows: [], range: null, warnings: [], events: [],
    fiscalYear: "Todos"
  };

  function setupHeaderLangButton() {
    let container = document.querySelector(".topbar-right");
    if (!container) return;
    if (!$("langHeaderBtn")) {
      const btn = document.createElement("button");
      btn.id = "langHeaderBtn";
      btn.className = "lang-btn";
      btn.onclick = () => {
        lang = lang === "es" ? "en" : "es";
        btn.textContent = t("btn_lang");
        if (ctx.state) render();
      };
      container.appendChild(btn);
    }
    $("langHeaderBtn").textContent = t("btn_lang");
  }

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

  function log(msg, isError = false) {
    $("loadStatus").classList.remove("hidden");
    $("loadLog").textContent = msg;
    const spinner = document.querySelector(".spinner");
    if (spinner) spinner.style.display = isError ? "none" : "block";
  }

  async function handleFile(file) {
    setupHeaderLangButton();
    try {
      log(`Leyendo ${file.name}…`);
      const buf = await file.arrayBuffer();
      const { events, warnings } = DG.parseAccountFile(buf);
      ctx.warnings = warnings;
      ctx.events = events;
      
      log(`${events.length} movimientos. Reconstruyendo cartera…`);
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
      log(`Error CRÍTICO al cargar: ${err.message}. Pulsa F12 para ver la consola.`, true);
    }
  }

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
            return;
          }
          ctx.priceProviders.set(isin, pp);
          return;
        } catch { }
      }
      if (fb) ctx.priceProviders.set(isin, { kind: "fallback", fb });
    });

    await Promise.allSettled([...fxJobs, ...benchJobs, ...prodJobs]);
  }

  function compute() {
    const st = ctx.state;
    DG.resolvePending(st, ctx.fxSeries);
    const { series, missingPrices } = DG.buildValueSeries(st, ctx.priceProviders, ctx.fxSeries);
    ctx.valueSeries = series;
    ctx.twr = DG.buildTWR(series, st.flows);
    const lastDay = series[series.length > 0 ? series.length - 1 : 0]?.day || DG.dayKey(new Date());
    ctx.productRows = DG.productPnL(st, ctx.priceProviders, ctx.fxSeries, lastDay);
    ctx.moneySeries = DG.buildMoneySeries(series, st.flows);
    ctx.range = { from: series[0]?.day, to: lastDay };
    ctx.fifoRows = DG.calculateFIFO(ctx.events);
  }

  function render() {
    setupHeaderLangButton();
    const st = ctx.state;
    const series = ctx.valueSeries;
    if (!series || series.length === 0) return;
    
    const last = series[series.length - 1];
    const netDeposits = st.totals.deposits + st.totals.withdrawals;
    const totalGain = last.value - netDeposits;
    
    let infoSpan = $("topbarInfoText");
    if (!infoSpan && $("topbarInfo")) {
      $("topbarInfo").innerHTML = `<span id="topbarInfoText"></span>`;
    }
    if ($("topbarInfoText")) {
      $("topbarInfoText").textContent = `${DG.dayKey(st.firstDate)} → ${last.day} · ${st.products.size} ${t("productos")}`;
    }

    const cards = [
      { label: t("val_cartera"), value: fmt(last.value, 2), sub: t("efectivo") + fmt(last.cash, 2) },
      { label: t("aportado"), value: fmt(netDeposits, 0), sub: `${t("ingresos")} ${fmt(st.totals.deposits, 0)} · ${t("retiradas")} ${fmt(-st.totals.withdrawals, 0)}` },
      { label: t("ganancia"), value: fmt(totalGain, 0), cls: totalGain >= 0 ? "pos" : "neg", sub: PCT(netDeposits > 0 ? totalGain / netDeposits : null) + " " + t("sobre_aportado") },
      { id: "cardXirr", label: t("xirr"), value: "—", sub: "" },
      { id: "cardTwr", label: t("twr"), value: "—", sub: "" },
      { label: t("divs"), value: fmt(st.totals.dividendsEUR + st.totals.lendingEUR, 0), sub: t("comisiones") + fmt(st.totals.fees, 0) },
    ];
    
    if ($("summaryCards")) {
      $("summaryCards").innerHTML = cards.map(c =>
        `<div class="card"${c.id ? ` id="${c.id}"` : ""}><div class="label">${c.label}</div><div class="value ${c.cls || ""}">${c.value}</div><div class="sub">${c.sub || ""}</div></div>`
      ).join("");
    }

    ensureTabs();
    renderBenchToggles();
    drawPerf();
    renderTable(currentTab || "open");
    renderWarnings();

    if ($("rangeStart")) $("rangeStart").value = ctx.range.from;
    if ($("rangeEnd")) $("rangeEnd").value = ctx.range.to;
  }

  function ensureTabs() {
    const tabsContainer = document.querySelector(".tabs");
    if (!tabsContainer) return;
    tabsContainer.innerHTML = `
      <button id="tabOpen" class="${currentTab === 'open' ? 'active' : ''}">${t("tab_open")}</button>
      <button id="tabClosed" class="${currentTab === 'closed' ? 'active' : ''}">${t("tab_closed")}</button>
      <button id="tabAll" class="${currentTab === 'all' ? 'active' : ''}">${t("tab_all")}</button>
      <button id="tabFiscal" class="${currentTab === 'fiscal' ? 'active' : ''}">${t("tab_fiscal")}</button>
    `;
    $("tabOpen").onclick = () => renderTable("open");
    $("tabClosed").onclick = () => renderTable("closed");
    $("tabAll").onclick = () => renderTable("all");
    $("tabFiscal").onclick = () => renderTable("fiscal");
  }

  function renderBenchToggles() {
    const el = $("benchToggles");
    if (!el) return;
    el.innerHTML = "";
    for (const b of DG.BENCHMARKS) {
      const s = ctx.benchSeries.get(b.id);
      const div = document.createElement("div");
      const avail = s && s.map;
      div.className = "toggle" + (avail ? (ctx.visibleBench.has(b.id) ? "" : " off") : " unavailable");
      div.innerHTML = `<span class="dot" style="background:${b.color}"></span>${b.label}`;
      if (avail) {
        div.onclick = () => {
          ctx.visibleBench.has(b.id) ? ctx.visibleBench.delete(b.id) : ctx.visibleBench.add(b.id);
          div.classList.toggle("off");
          drawPerf();
        };
      }
      el.appendChild(div);
    }
  }

  function drawPerf() {
    if (ctx.twr && ctx.benchSeries && ctx.range) {
       DG.renderPerfChart(ctx.twr, ctx.benchSeries, ctx.visibleBench, ctx.range, ctx.events);
       DG.renderMoneyChart(ctx.moneySeries, ctx.range);
       updateRangeCards();
    }
  }

  function updateRangeCards() {
    const m = DG.rangeMetrics(ctx.valueSeries, ctx.twr, ctx.state.flows, ctx.range);
    if (!m) return;
    const setCard = (id, value, cls, sub) => {
      const el = $(id);
      if (!el) return;
      el.querySelector(".value").textContent = value;
      el.querySelector(".value").className = "value " + cls;
      el.querySelector(".sub").textContent = sub;
    };
    const twrAnnual = (m.twrPeriod != null && m.years >= 1 && m.twrPeriod > -1) ? Math.pow(1 + m.twrPeriod, 1 / m.years) - 1 : null;
    if (m.years >= 1) {
      setCard("cardXirr", m.xirr != null ? PCT(m.xirr) : "—", (m.xirr ?? 0) >= 0 ? "pos" : "neg", "");
      setCard("cardTwr", twrAnnual != null ? PCT(twrAnnual) : "—", (twrAnnual ?? 0) >= 0 ? "pos" : "neg", "");
    } else {
      setCard("cardXirr", m.periodMoney != null ? PCT(m.periodMoney) : "—", (m.periodMoney ?? 0) >= 0 ? "pos" : "neg", "");
      setCard("cardTwr", m.twrPeriod != null ? PCT(m.twrPeriod) : "—", (m.twrPeriod ?? 0) >= 0 ? "pos" : "neg", "");
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
      if ($("rangeStart")) $("rangeStart").value = ctx.range.from;
      if ($("rangeEnd")) $("rangeEnd").value = ctx.range.to;
      drawPerf();
    };
  });

  function onCustomRange() {
    const from = $("rangeStart")?.value, to = $("rangeEnd")?.value;
    if (!from || !to || from >= to) return;
    document.querySelectorAll("#presetBtns button").forEach(b => b.classList.remove("active"));
    ctx.range = { from, to };
    drawPerf();
  }
  if ($("rangeStart")) $("rangeStart").addEventListener("change", onCustomRange);
  if ($("rangeEnd")) $("rangeEnd").addEventListener("change", onCustomRange);

  let currentTab = "open";
  let currentSort = { col: 'pnl', asc: false }; 

  function exportCSV(rows) {
    let csv = "Producto,ISIN,Fecha Compra,Fecha Venta,Cantidad,Precio Compra,Precio Venta,P/G,Divisa\n";
    rows.forEach(r => {
      const pName = (ctx.state.products.get(r.isin) || {}).name || r.isin;
      const buyD = r.buyDate ? DG.dayKey(r.buyDate) : "";
      const sellD = r.sellDate ? DG.dayKey(r.sellDate) : "";
      csv += `"${pName}",${r.isin},${buyD},${sellD},${r.qty},${r.buyPrice},${r.sellPrice},${r.pl},${r.cur}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "fiscalidad_fifo.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function renderTable(tab) {
    currentTab = tab;
    ensureTabs();

    const tableWrap = document.querySelector(".table-wrap");
    if (!tableWrap) return; 

    let controls = $("tableControls");
    if (!controls && tableWrap.parentNode) {
      controls = document.createElement("div");
      controls.id = "tableControls";
      controls.className = "table-controls";
      tableWrap.parentNode.insertBefore(controls, tableWrap);
    }

    let fControls = $("fiscalControls");
    if (!fControls && tableWrap.parentNode) {
      fControls = document.createElement("div");
      fControls.id = "fiscalControls";
      fControls.className = "fiscal-controls";
      tableWrap.parentNode.insertBefore(fControls, tableWrap);
    }

    let thead = document.querySelector("#productTable thead");
    if (!thead) {
      const table = document.getElementById("productTable");
      if (table) {
        thead = document.createElement("thead");
        table.insertBefore(thead, table.firstChild);
      }
    }

    const tbody = document.querySelector("#productTable tbody");
    if (!tbody) return;

    if (tab === "fiscal") {
      if (controls) controls.style.display = "none";
      if (fControls) fControls.style.display = "block";

      const years = [...new Set(ctx.fifoRows.filter(r => r && r.sellDate).map(r => r.sellDate.getFullYear()))].sort((a, b) => b - a);
      
      if (fControls) {
        fControls.innerHTML = `
          <div class="fiscal-header">
            <label><b>${t("f_year")}</b> 
              <select id="fiscalYearSelect">
                <option value="Todos">Todos</option>
                ${years.map(y => `<option value="${y}" ${ctx.fiscalYear == y ? "selected" : ""}>${y}</option>`).join("")}
              </select>
            </label>
            <button id="btnExportCSV" class="btn-secondary">${t("f_export")}</button>
          </div>
          <div class="cards" id="fiscalSummaryCards" style="margin-top:12px; margin-bottom: 0;"></div>
        `;

        $("fiscalYearSelect").onchange = (e) => {
          ctx.fiscalYear = e.target.value;
          renderTable("fiscal");
        };
      }

      let filteredRows = ctx.fifoRows;
      if (ctx.fiscalYear !== "Todos") {
        filteredRows = ctx.fifoRows.filter(r => r.sellDate && r.sellDate.getFullYear().toString() === ctx.fiscalYear);
      }

      if ($("btnExportCSV")) $("btnExportCSV").onclick = () => exportCSV(filteredRows);

      let totalAcq = 0, totalTrans = 0, netYield = 0;
      filteredRows.forEach(r => {
        totalAcq += r.qty * r.buyPrice;
        totalTrans += r.qty * r.sellPrice;
        netYield += r.pl;
      });

      if ($("fiscalSummaryCards")) {
        $("fiscalSummaryCards").innerHTML = `
          <div class="card"><div class="label">${t("f_acq")}</div><div class="value">${fmt(totalAcq, 2)}</div></div>
          <div class="card"><div class="label">${t("f_trans")}</div><div class="value">${fmt(totalTrans, 2)}</div></div>
          <div class="card"><div class="label">${t("f_net")}</div><div class="value ${netYield >= 0 ? 'pos' : 'neg'}">${fmt(netYield, 2)}</div></div>
        `;
      }

      if (thead) {
        thead.innerHTML = `<tr>
          <th>${t("th_prod")}</th>
          <th class="center">${t("f_buy")}</th>
          <th class="center">${t("f_sell")}</th>
          <th class="num">${t("th_cant")}</th>
          <th class="num">${t("f_pbuy")}</th>
          <th class="num">${t("f_psell")}</th>
          <th class="num">P/G</th>
          <th class="center">Div.</th>
        </tr>`;
      }

      tbody.innerHTML = filteredRows.sort((a,b) => (b.sellDate || 0) - (a.sellDate || 0)).map(r => {
        const pName = (ctx.state.products.get(r.isin) || {}).name || r.isin;
        return `<tr>
          <td class="prod" title="${r.isin}">${pName}</td>
          <td class="center">${r.buyDate ? DG.dayKey(r.buyDate) : "—"}</td>
          <td class="center">${r.sellDate ? DG.dayKey(r.sellDate) : "—"}</td>
          <td class="num">${r.qty.toLocaleString(fmtLoc(), { maximumFractionDigits: 4 })}</td>
          <td class="num">${r.buyPrice.toLocaleString(fmtLoc(), { minimumFractionDigits: 2 })}</td>
          <td class="num">${r.sellPrice.toLocaleString(fmtLoc(), { minimumFractionDigits: 2 })}</td>
          <td class="num ${r.pl >= 0 ? "pos" : "neg"}"><b>${(r.pl >= 0 ? "+" : "") + r.pl.toLocaleString(fmtLoc(), { minimumFractionDigits: 2 })}</b></td>
          <td class="center">${r.cur}</td>
        </tr>`;
      }).join("");

    } else {
      if (fControls) fControls.style.display = "none";
      if (controls) {
        controls.style.display = "flex";
        controls.innerHTML = `
          <button id="btnCheckAll" class="btn-secondary">${t("hacer_ticks")}</button>
          <button id="btnUncheckAll" class="btn-secondary">${t("quitar_ticks")}</button>
          <span class="sort-label">${t("ord_por")}</span>
          <button id="btnSortName" class="btn-secondary">${t("ord_alfabeto")}</button>
          <button id="btnSortPnL" class="btn-secondary">${t("ord_pg")}</button>
        `;

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

      if (thead) {
        thead.innerHTML = `<tr>
          <th class="center" title="Tick">📉</th>
          <th>${t("th_prod")}</th>
          <th class="num">${t("th_cant")}</th>
          <th class="num">${t("th_val")}</th>
          <th class="num">${t("th_inv")}</th>
          <th class="num">${t("th_rec")}</th>
          <th class="num">${t("th_div")}</th>
          <th class="num">P/G</th>
          <th class="num">%</th>
        </tr>`;
      }

      const rows = ctx.productRows.filter(r => tab === "all" ? true : tab === "open" ? r.open : !r.open);
      rows.sort((a, b) => {
         let valA = a[currentSort.col] || (currentSort.col === 'name' ? "" : 0);
         let valB = b[currentSort.col] || (currentSort.col === 'name' ? "" : 0);
         if (typeof valA === 'string') valA = valA.toLowerCase();
         if (typeof valB === 'string') valB = valB.toLowerCase();
         if (valA < valB) return currentSort.asc ? -1 : 1;
         if (valA > valB) return currentSort.asc ? 1 : -1;
         return 0;
      });

      tbody.innerHTML = rows.map(r => {
        const ticker = (DG.ISIN_TO_YAHOO && DG.ISIN_TO_YAHOO[r.isin]) ? DG.ISIN_TO_YAHOO[r.isin] : r.isin;
        const isChecked = !DG.tradeFilters.hidden.has(ticker);
        return `
        <tr>
          <td class="center"><input type="checkbox" class="trade-toggle" data-ticker="${ticker}" ${isChecked ? "checked" : ""}></td>
          <td class="prod" title="${r.isin}">${r.name}</td>
          <td class="num">${r.open ? r.qty.toLocaleString(fmtLoc(), { maximumFractionDigits: 4 }) : "—"}</td>
          <td class="num">${r.open ? fmt(r.value, 2) : "—"}</td>
          <td class="num">${fmt(r.invested, 2)}</td>
          <td class="num">${fmt(r.received, 2)}</td>
          <td class="num">${r.dividends ? fmt(r.dividends, 2) : "—"}</td>
          <td class="num ${r.pnl >= 0 ? "pos" : "neg"}"><b>${(r.pnl >= 0 ? "+" : "") + fmt(r.pnl, 2)}</b></td>
          <td class="num ${r.pnl >= 0 ? "pos" : "neg"}">${PCT(r.pct)}</td>
        </tr>`;
      }).join("");

      document.querySelectorAll(".trade-toggle").forEach(cb => {
        cb.addEventListener("change", (e) => {
           const ticker = e.target.dataset.ticker;
           e.target.checked ? DG.tradeFilters.hidden.delete(ticker) : DG.tradeFilters.hidden.add(ticker);
           drawPerf();
        });
      });
    }
  }

  function renderWarnings() {
    const uniq = [...new Set(ctx.warnings)];
    if (!uniq.length) return;
    if ($("warnPanel")) $("warnPanel").classList.remove("hidden");
    if ($("warnList")) $("warnList").innerHTML = uniq.map(w => `<li>${w}</li>`).join("");
  }
})();
