/**
 * prices.js — Precios históricos desde Yahoo Finance (vía proxy CORS público)
 * con fallback a los precios de tus propias operaciones y normalización segura.
 * Buscador dinámico por ISIN y Nombre con caché en localStorage.
 */
"use strict";

(function () {
  const DG = window.DG;

  const PROXIES = [
    u => "https://corsproxy.io/?url=" + encodeURIComponent(u),
    u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
    u => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u)
  ];

  DG.BENCHMARKS = [
    { id: "sp500",  label: "S&P 500",            symbol: "^GSPC",       color: "#e8a33d", on: true },
    { id: "dow",    label: "Dow Jones",          symbol: "^DJI",        color: "#8e6bbf", on: false },
    { id: "russell",label: "Russell 2000",       symbol: "^RUT",        color: "#d64541", on: false },
    { id: "msci",   label: "MSCI World (URTH)",  symbol: "URTH",        color: "#2e9e5b", on: true },
    { id: "numantia", label: "Numantia Patrimonio", symbol: "0P000168OI.F", color: "#666f7a", on: false },
  ];

  // Mantenemos solo un pequeño diccionario de los ETFs raros que Yahoo no sabe buscar por ISIN
  DG.ISIN_TO_YAHOO = {
    "GB00BJYDH287": "BTCW.SW",   
    "IE00B7Y34M31": "3USL.MI",    
    "US78392B2060": "HXSCF", 
    "US78392B1070": "HXSCF"
  };

  const cache = new Map(); 

  const LOCAL_MAP_KEY = "dg_isin_map";
  let localMap = {};
  try { localMap = JSON.parse(localStorage.getItem(LOCAL_MAP_KEY)) || {}; } catch(e){}

  async function fetchJSON(url) {
    let lastErr;
    for (const p of PROXIES) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000); 
        
        const res = await fetch(p(url), { 
            headers: { Accept: "application/json" },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!res.ok) throw new Error("HTTP " + res.status);
        return await res.json();
      } catch (e) { 
        lastErr = e; 
      }
    }
    throw lastErr || new Error("fetch failed");
  }

  DG.fetchYahooSeries = async function (symbol, fromDate) {
    const key = "y:" + symbol;
    if (cache.has(key)) return cache.get(key);
    
    const p1 = Math.floor(fromDate.getTime() / 1000) - 86400 * 7;
    const p2 = Math.floor(Date.now() / 1000) + 86400;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit`;
    
    const promise = fetchJSON(url).then(j => {
      const r = j.chart && j.chart.result && j.chart.result[0];
      if (!r || !r.timestamp) throw new Error("sin datos para " + symbol);
      
      const closes = r.indicators.quote[0].close;
      const map = new Map();
      const adjMap = new Map();
      const meta = { currency: (r.meta && r.meta.currency) || "USD" };
      
      const splits = [];
      if (r.events && r.events.splits) {
        for (const s of Object.values(r.events.splits)) {
          const f = (s.numerator && s.denominator) ? s.numerator / s.denominator : null;
          if (f && f > 0) splits.push({ day: new Date(s.date * 1000).toISOString().slice(0, 10), f });
        }
        splits.sort((a, b) => (a.day < b.day ? -1 : 1));
      }
      
      const factorAfter = day => {
        let f = 1;
        for (const s of splits) if (s.day > day) f *= s.f;
        return f;
      };
      
      r.timestamp.forEach((t, i) => {
        const c = closes[i];
        if (c != null) {
          const day = new Date(t * 1000).toISOString().slice(0, 10);
          adjMap.set(day, c);
          map.set(day, c * (splits.length ? factorAfter(day) : 1));
        }
      });
      
      if (r.meta && r.meta.regularMarketPrice != null && r.meta.regularMarketTime) {
        const day = new Date(r.meta.regularMarketTime * 1000).toISOString().slice(0, 10);
        map.set(day, r.meta.regularMarketPrice);
        adjMap.set(day, r.meta.regularMarketPrice);
      }
      return { map, adjMap, meta };
      
    }).catch(e => {
      console.warn("Fallo al obtener precios de Yahoo para: " + symbol + ". Activando salvavidas (fallback).", e);
      return { map: new Map(), adjMap: new Map(), meta: {} };
    });

    cache.set(key, promise);
    return promise;
  };

  // Buscador inteligente por ISIN o por Nombre con memoria caché
  DG.searchYahooTicker = async function (isin, name) {
    if (localMap[isin]) return localMap[isin];

    const fetchSearch = async (query) => {
      if (!query) return null;
      try {
        const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=3&newsCount=0`;
        const j = await fetchJSON(url);
        if (j && j.quotes && j.quotes.length > 0) {
          const valid = j.quotes.find(q => q.quoteType === "EQUITY" || q.quoteType === "ETF" || q.quoteType === "MUTUALFUND");
          return valid ? valid.symbol : j.quotes[0].symbol;
        }
      } catch (e) {}
      return null;
    };

    let symbol = await fetchSearch(isin);
    
    if (!symbol && name) {
      let cleanName = name.replace(/Class [A-Z]/ig, "").replace(/,?\s*(Inc\.|Corp\.|Ltd\.|LLC|PLC|SA|SE|A\/S|Group)\b/ig, "").trim();
      cleanName = cleanName.split(" ").slice(0, 3).join(" ");
      symbol = await fetchSearch(cleanName);
    }

    if (symbol) {
      localMap[isin] = symbol;
      localStorage.setItem(LOCAL_MAP_KEY, JSON.stringify(localMap));
      return symbol;
    }
    return null;
  };

  DG.fetchFxSeries = async function (cur, fromDate) {
    if (cur === "EUR") return null;
    const { map } = await DG.fetchYahooSeries(`EUR${cur}=X`, fromDate);
    return map; 
  };

  DG.seriesAt = function (map, dayKey) {
    if (!map) return null;
    if (map.has(dayKey)) return map.get(dayKey);
    const d = new Date(dayKey + "T00:00:00Z");
    for (let i = 1; i <= 10; i++) {
      d.setUTCDate(d.getUTCDate() - 1);
      const k = d.toISOString().slice(0, 10);
      if (map.has(k)) return map.get(k);
    }
    return null;
  };

  DG.validateAgainstTrades = function (pp, tradePoints, fxSeries) {
    if (!pp || pp.kind !== "yahoo" || !tradePoints || !tradePoints.length) return "ok";
    
    let yCur = pp.meta.currency || "USD";
    const yIsPence = (yCur === "GBp" || yCur === "GBX");
    const normalizedYCur = yIsPence ? "GBP" : yCur;

    const ratios = [];
    
    for (const t of tradePoints) {
      let y = DG.seriesAt(pp.map, DG.dayKey(t.date));
      if (y == null || !t.price) continue;
      
      let yNorm = yIsPence ? y / 100 : y;
      
      let tCur = t.cur || "EUR";
      let tIsPence = (tCur === "GBX" || tCur === "GBp");
      let normalizedTCur = tIsPence ? "GBP" : tCur;
      let tNorm = tIsPence ? t.price / 100 : t.price;
      
      if (normalizedYCur !== normalizedTCur) {
        let yInEur = yNorm;
        if (normalizedYCur !== "EUR") {
           if (fxSeries && fxSeries.has(normalizedYCur)) {
               const fxY = DG.seriesAt(fxSeries.get(normalizedYCur), DG.dayKey(t.date));
               if (fxY) yInEur = yNorm / fxY;
               else continue; 
           } else continue; 
        }
        
        let tInEur = tNorm;
        if (normalizedTCur !== "EUR") {
           if (fxSeries && fxSeries.has(normalizedTCur)) {
               const fxT = DG.seriesAt(fxSeries.get(normalizedTCur), DG.dayKey(t.date));
               if (fxT) tInEur = tNorm / fxT;
               else continue; 
           } else continue; 
        }
        
        if (tInEur > 0) ratios.push(yInEur / tInEur);
      } else {
        if (tNorm > 0) ratios.push(yNorm / tNorm);
      }
    }
    
    if (ratios.length < 1) return "ok";
    ratios.sort((a, b) => a - b);
    const med = ratios[Math.floor(ratios.length / 2)];
    if (med > 0.67 && med < 1.5) return "ok"; 
    
    const spread = ratios[ratios.length - 1] / ratios[0];
    if (spread < 1.6) {
      for (const [k, v] of pp.map) pp.map.set(k, v / med);
      return "rescaled";
    }
    return "rejected";
  };

  DG.tradeFallbackSeries = function (points) {
    const sorted = [...points].sort((a, b) => a.date - b.date);
    return {
      cur: sorted.length ? sorted[sorted.length - 1].cur : "EUR",
      at(dayKey) {
        let last = null;
        for (const p of sorted) {
          if (DG.dayKey(p.date) <= dayKey) last = p.price; else break;
        }
        return last;
      },
    };
  };
})();