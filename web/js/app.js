/**
 * app.js — Orquestación del dashboard, cambio de idioma en header,
 * y filtros/ordenación en la tabla de acciones.
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
      th_prod: "Producto",
      th_cant: "Cant.",
      th_val: "Valor",
      th_inv: "Invertido",
      th_rec: "Recibido",
      th_div: "Div.",
      upload_h2: "Analiza tu cuenta de DEGIRO",
      upload_p1: "Arrastra aquí tu archivo Account.xlsx (Actividad → Estado de cuenta → Exportar)",
      upload_p2: "Todo se procesa en tu navegador. Nada se sube a ningún servidor.",
      upload_btn: "Seleccionar archivo",
      rentabilidad_vs: "Rentabilidad vs índices",
      mi_cartera: "Mi cartera",
      desde: "Desde",
      hasta: "Hasta",
      ticker_ph: "Añadir ticker de Yahoo (ej. AAPL, SAN.MC)",
      ticker_btn: "Añadir acción",
      dinero_vs: "Dinero ingresado vs valor y ganancia",
      resultado_inv: "Resultado por inversión",
      avisos: "Avisos",
      cargando: "Cargando...",
      hint_zoom: "Consejo: usa la rueda del ratón o arrastra para hacer zoom en el gráfico. Doble clic para restablecer.",
      hint_dinero: "(usa el mismo filtro de fechas del gráfico de arriba)",
      footer: "Los datos de mercado provienen de Yahoo Finance",
      compras: "Compras",
      ventas: "Ventas",
      rentabilidad_pct: "Rentabilidad (%)",
      rentabilidad_anual: "Rentabilidad por año natural",
      activo: "Activo"
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
      th_prod: "Product",
      th_cant: "Qty.",
      th_val: "Value",
      th_inv: "Invested",
      th_rec: "Received",
      th_div: "Div.",
      upload_h2: "Analyze your DEGIRO account",
      upload_p1: "Drag & drop your Account.xlsx file here (Activity → Account Statement → Export)",
      upload_p2: "Everything is processed in your browser. Nothing is uploaded to any server.",
      upload_btn: "Select file",
      rentabilidad_vs: "Performance vs Indices",
      mi_cartera: "My portfolio",
      desde: "From",
      hasta: "To",
      ticker_ph: "Add Yahoo ticker (e.g. AAPL, SAN.MC)",
      ticker_btn: "Add stock",
      dinero_vs: "Deposits vs Value and Gain",
      resultado_inv: "Result per investment",
      avisos: "Warnings",
      cargando: "Loading...",
      hint_zoom: "Tip: use mouse wheel or drag to zoom the chart. Double click to reset.",
      hint_dinero: "(uses the same date filter as the chart above)",
      footer: "Market data provided by Yahoo Finance",
      compras: "Buys",
      ventas: "Sells",
      rentabilidad_pct: "Return (%)",
      rentabilidad_anual: "Yearly Return (Calendar Year)",
      activo: "Asset"
    }
  };

  let lang = "es";
  const t = (k) => i18n[lang][k] || k;
  DG.t = t; 

  function applyTranslations() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
      const key = el.getAttribute("data-i18n");
      if (i18n[lang][key]) el.innerHTML = i18n[lang][key]; 
    });
    document.querySelectorAll("[data-i18n-ph]").forEach(el => {
      const key = el.getAttribute("data-i18n-ph");
      if (i18n[lang][key]) el.placeholder = i18n[lang][key];
    });
  }

  applyTranslations();

  const fmtLoc = () => lang === "es" ? "es-ES" : "en-US";
  const fmt = (v, maxF) => new Intl.NumberFormat(fmtLoc(), { style: "currency", currency: "EUR", maximumFractionDigits: maxF }).format(v);
  const PCT = v => (v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%");

  const ctx = {
    state: null, twr: null, valueSeries: null,
    benchSeries: new Map(), visibleBench: new Set(), customSeries: new Map(),
    priceProviders: new Map(), fxSeries: new Map(),
    productRows: [], range: null, warnings: [], events: []
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
        applyTranslations(); 
        if (ctx.state) render();
      };
      container.appendChild(btn);
    }
    $("langHeaderBtn").textContent = t("btn_lang");
  }
  setupHeaderLangButton();

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
      log(`Error al cargar: ${err.message}`, true);
    }
  }

  async function loadAllPrices() {
    const st = ctx.state;
    const from = st.firstDate;

    const fxJobs = [...st.currencies].filter(c => c !== "EUR").map(async c => {
      try { ctx.fxSeries.set(c, await DG.fetchFxSeries(c, from)); }
      catch { ctx.warnings.push("Sin serie FX para " + c); }
    });

    await Promise.allSettled(fxJobs);

    const benchJobs = DG.BENCHMARKS.map(async b => {
      try {
        const { map, adjMap } = await DG.fetchYahooSeries(b.symbol, from);
        ctx.benchSeries.set(b.id, { label: b.label, color: b.color, map, adjMap });
        if (b.on) ctx.visibleBench.add(b.id);
      } catch {
        ctx.benchSeries.set(b.id, { label: b.label, color: b.color, map: null, adjMap: null });
        ctx.warnings.push("Índice no disponible: " + b.label);
      }
    });

    const isins = [...st.products.keys()];
    const prodJobs = isins.map(async isin => {
      const fbPoints = st.tradePricePoints.get(isin) || [];
      const fb = fbPoints.length ? DG.tradeFallbackSeries(fbPoints) : null;
      let symbol = DG.ISIN_TO_YAHOO[isin];
      const prodName = st.products.get(isin).name;
      const stillOpen = Math.abs(st.products.get(isin).qty) > 1e-9;
      
      if (!symbol && stillOpen) {
        symbol = await DG.searchYahooTicker(isin, prodName);
      }

      if (symbol) {
        try {
          const { map, adjMap, meta } = await DG.fetchYahooSeries(symbol, from);
          const pp = { kind: "yahoo", map, adjMap, meta, fb };
          const verdict = DG.validateAgainstTrades(pp, fbPoints, ctx.fxSeries);
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

    await Promise.allSettled([...benchJobs, ...prodJobs]);
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
  }

  function render() {
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
    if($("benchToggles").children.length === 0) renderBenchToggles();
    setupCustomTickers();
    drawPerf();
    renderTable(currentTab || "open");
    renderWarnings();

    if ($("rangeStart")) $("rangeStart").value = ctx.range.from;
    if ($("rangeEnd")) $("rangeEnd").value = ctx.range.to;
  }

  function setupCustomTickers() {
    const input = $("customTickerInput");
    const btn = $("addCustomTickerBtn");
    if (!input || !btn) return;

    if (!btn.dataset.init) {
      btn.onclick = () => addCustomTicker(input.value);
      input.onkeypress = (e) => { if (e.key === "Enter") addCustomTicker(input.value); };
      btn.dataset.init = "true";
    }
    if($("customTickerList").children.length === 0) renderCustomTickerList();
  }

  async function addCustomTicker(symbol) {
    symbol = symbol.trim().toUpperCase();
    if (!symbol || ctx.customSeries.has(symbol)) return;

    const btn = $("addCustomTickerBtn");
    const prevText = btn.textContent;
    btn.textContent = t("cargando");
    btn.disabled = true;

    try {
      const from = ctx.state.firstDate;
      const { map, adjMap } = await DG.fetchYahooSeries(symbol, from);
      if (map && map.size > 0) {
        const colors = ["#ff5722", "#9c27b0", "#00bcd4", "#ffeb3b", "#795548", "#e91e63", "#3f51b5", "#607d8b"];
        const color = colors[ctx.customSeries.size % colors.length];
        ctx.customSeries.set(symbol, { label: symbol, color: color, map, adjMap });
        $("customTickerInput").value = "";
        renderCustomTickerList();
        drawPerf();
      } else {
        alert("No se encontraron precios para el ticker: " + symbol);
      }
    } catch (err) {
      alert("Error al cargar el ticker: " + symbol);
    } finally {
      btn.textContent = prevText;
      btn.disabled = false;
    }
  }

  function getRangeReturn(map) {
    if (!ctx.twr || !ctx.range || !map) return null;
    const pts = ctx.twr.filter(p => p.day >= ctx.range.from && p.day <= ctx.range.to);
    if (!pts.length) return null;
    
    let start = null, end = null;
    for (const p of pts) { start = DG.seriesAt(map, p.day); if (start) break; }
    for (let i = pts.length - 1; i >= 0; i--) { end = DG.seriesAt(map, pts[i].day); if (end) break; }
    if (start && end) return (end / start) - 1;
    return null;
  }

  function renderBenchToggles() {
    const el = $("benchToggles");
    if (!el) return;
    el.innerHTML = "";
    for (const b of DG.BENCHMARKS) {
      const s = ctx.benchSeries.get(b.id);
      const div = document.createElement("div");
      div.id = `toggle-bench-${b.id}`;
      const avail = s && s.map;
      div.className = "toggle" + (avail ? (ctx.visibleBench.has(b.id) ? "" : " off") : " unavailable");
      
      const r = avail ? getRangeReturn(s.adjMap || s.map) : null;
      const tStr = r != null ? ` (${r >= 0 ? '+' : ''}${(r * 100).toFixed(1)}%)` : "";
      
      div.innerHTML = `<span class="dot" style="background:${b.color}"></span>${b.label}${tStr}`;
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

  function renderCustomTickerList() {
    const list = $("customTickerList");
    if (!list) return;
    list.innerHTML = "";
    for (const [symbol, data] of ctx.customSeries) {
      const tag = document.createElement("div");
      tag.className = "ticker-tag";
      tag.id = `toggle-custom-${symbol}`;
      
      const r = getRangeReturn(data.adjMap || data.map);
      const tStr = r != null ? ` (${r >= 0 ? '+' : ''}${(r * 100).toFixed(1)}%)` : "";
      
      tag.innerHTML = `<span class="dot" style="background:${data.color}"></span>${symbol}${tStr} <button class="ticker-remove" data-sym="${symbol}">×</button>`;
      list.appendChild(tag);
    }
    list.querySelectorAll(".ticker-remove").forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        ctx.customSeries.delete(e.target.dataset.sym);
        renderCustomTickerList();
        drawPerf();
      };
    });
  }

  function ensureTabs() {
    const tabsContainer = document.querySelector(".tabs");
    if (!tabsContainer) return;
    tabsContainer.innerHTML = `
      <button id="tabOpen" class="${currentTab === 'open' ? 'active' : ''}">${t("tab_open")}</button>
      <button id="tabClosed" class="${currentTab === 'closed' ? 'active' : ''}">${t("tab_closed")}</button>
      <button id="tabAll" class="${currentTab === 'all' ? 'active' : ''}">${t("tab_all")}</button>
    `;
    $("tabOpen").onclick = () => renderTable("open");
    $("tabClosed").onclick = () => renderTable("closed");
    $("tabAll").onclick = () => renderTable("all");
  }

  function updatePerfTitle() {
    const titleEl = $("perfPanelTitle");
    if (!titleEl) return;
    let pRetStr = "—";
    if (ctx.twr && ctx.range) {
       const m = DG.rangeMetrics(ctx.valueSeries, ctx.twr, ctx.state.flows, ctx.range);
       if (m && m.twrPeriod != null) pRetStr = (m.twrPeriod >= 0 ? '+' : '') + (m.twrPeriod * 100).toFixed(1) + '%';
    }
    titleEl.innerHTML = `<span data-i18n="rentabilidad_vs">${t("rentabilidad_vs")}</span> <span style="font-weight:normal; font-size:14px; margin-left:12px; color:var(--dg-blue)">${t("mi_cartera")}: <b>${pRetStr}</b></span>`;
  }

  function updateToggleReturns() {
    const getRetStr = (map) => {
      const r = getRangeReturn(map);
      return r != null ? ` (${r >= 0 ? '+' : ''}${(r * 100).toFixed(1)}%)` : "";
    };

    for (const b of DG.BENCHMARKS) {
       const div = $(`toggle-bench-${b.id}`);
       if (div) {
         const s = ctx.benchSeries.get(b.id);
         const avail = s && s.map;
         if (avail) {
           div.innerHTML = `<span class="dot" style="background:${b.color}"></span>${b.label}${getRetStr(s.adjMap || s.map)}`;
         }
       }
    }

    for (const [sym, data] of ctx.customSeries) {
       const tag = $(`toggle-custom-${sym}`);
       if (tag) {
         tag.innerHTML = `<span class="dot" style="background:${data.color}"></span>${sym}${getRetStr(data.adjMap || data.map)} <button class="ticker-remove" data-sym="${sym}">×</button>`;
         const btn = tag.querySelector(".ticker-remove");
         if (btn) btn.onclick = (e) => {
            e.stopPropagation();
            ctx.customSeries.delete(sym);
            renderCustomTickerList();
            drawPerf();
         };
       }
    }
  }

  function renderYearlyTable() {
    let container = $("yearlyTableContainer");
    if (!container) {
       container = document.createElement("div");
       container.id = "yearlyTableContainer";
       container.style = "margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--dg-border); overflow-x: auto;";
       const customSec = document.querySelector(".custom-tickers-sec");
       if (customSec && customSec.parentNode) {
           customSec.parentNode.insertBefore(container, customSec.nextSibling);
       } else {
           return;
       }
    }
    
    if (!ctx.twr || ctx.twr.length === 0) {
      container.innerHTML = "";
      return;
    }
    
    const years = [...new Set(ctx.twr.map(p => p.day.substring(0, 4)))].sort();
    const results = {};
    
    const getAssetYearly = (map) => {
      const ret = {};
      const daysInMap = Array.from(map.keys()).sort();
      if (daysInMap.length === 0) {
        years.forEach(y => ret[y] = null);
        return ret;
      }
      for (let i = 0; i < years.length; i++) {
        const y = years[i];
        const prevY = (parseInt(y) - 1).toString();
        
        const daysInY = daysInMap.filter(d => d.startsWith(y));
        if (daysInY.length === 0) {
          ret[y] = null;
          continue;
        }
        
        let startVal = null;
        const daysInPrevY = daysInMap.filter(d => d.startsWith(prevY));
        if (daysInPrevY.length > 0) {
          startVal = map.get(daysInPrevY[daysInPrevY.length - 1]);
        } else {
          startVal = map.get(daysInY[0]);
        }
        
        const endVal = map.get(daysInY[daysInY.length - 1]);
        
        if (startVal != null && endVal != null && startVal !== 0) {
          ret[y] = (endVal / startVal) - 1;
        } else {
          ret[y] = null;
        }
      }
      return ret;
    };
    
    const portMap = new Map();
    ctx.twr.forEach(p => portMap.set(p.day, p.index));
    results[t("mi_cartera") || "Mi cartera"] = getAssetYearly(portMap);
    
    for (const b of DG.BENCHMARKS) {
      if (ctx.visibleBench.has(b.id)) {
         const s = ctx.benchSeries.get(b.id);
         if (s && s.map) results[b.label] = getAssetYearly(s.adjMap || s.map);
      }
    }
    for (const [sym, data] of ctx.customSeries) {
       if (data && data.map) results[sym] = getAssetYearly(data.adjMap || data.map);
    }
    
    let html = `<table style="width: 100%; border-collapse: collapse; font-size: 13px;">
      <thead>
        <tr>
          <th style="text-align: left; padding: 8px; border-bottom: 1px solid var(--dg-border); color: var(--dg-muted); font-size: 11px; text-transform: uppercase;">${t("activo") || "Activo"}</th>
          ${years.map(y => `<th style="text-align: right; padding: 8px; border-bottom: 1px solid var(--dg-border); color: var(--dg-muted); font-size: 11px; text-transform: uppercase;">${y}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
    `;
    
    for (const [name, yearData] of Object.entries(results)) {
      html += `<tr><td style="font-weight:600; color:var(--dg-navy); padding: 8px; border-bottom: 1px solid var(--dg-border);">${name}</td>`;
      for (const y of years) {
        const r = yearData[y];
        if (r == null) {
          html += `<td style="text-align: right; color:var(--dg-muted); padding: 8px; border-bottom: 1px solid var(--dg-border);">N/A</td>`;
        } else {
          const cls = r >= 0 ? "color: var(--dg-green);" : "color: var(--dg-red);";
          const sign = r >= 0 ? "+" : "";
          html += `<td style="text-align: right; ${cls} padding: 8px; border-bottom: 1px solid var(--dg-border);"><b>${sign}${(r * 100).toFixed(1)}%</b></td>`;
        }
      }
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    
    container.innerHTML = `<h4 style="margin: 0 0 10px 0; font-size:14px; color:var(--dg-navy); font-weight:600;">${t("rentabilidad_anual") || "Rentabilidad por año natural"}</h4>` + html;
  }

  function drawPerf() {
    if (ctx.twr && ctx.benchSeries && ctx.range) {
       DG.renderPerfChart(ctx.twr, ctx.benchSeries, ctx.visibleBench, ctx.range, ctx.events, ctx.customSeries);
       DG.renderMoneyChart(ctx.moneySeries, ctx.range);
       updateRangeCards();
       updatePerfTitle();
       updateToggleReturns();
       renderYearlyTable();
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
        case "2y": fromD.setUTCFullYear(fromD.getUTCFullYear() - 2); break;
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

  function renderTable(tab) {
    currentTab = tab;
    ensureTabs();

    const tableWrap = document.getElementById("productTableWrap");
    if (!tableWrap) return;

    let controls = $("tableControls");
    if (!controls && tableWrap.parentNode) {
      controls = document.createElement("div");
      controls.id = "tableControls";
      controls.className = "table-controls";
      tableWrap.parentNode.insertBefore(controls, tableWrap);
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

    for (const [id, t_id] of [["tabOpen", "open"], ["tabClosed", "closed"], ["tabAll", "all"]]) {
      if ($(id)) {
         $(id).classList.toggle("active", t_id === tab);
      }
    }

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

  function renderWarnings() {
    const uniq = [...new Set(ctx.warnings)];
    if (!uniq.length) return;
    if ($("warnPanel")) $("warnPanel").classList.remove("hidden");
    if ($("warnList")) $("warnList").innerHTML = uniq.map(w => `<li>${w}</li>`).join("");
  }
})();