/**
 * prices.js — Precios históricos desde Yahoo Finance (vía proxies CORS)
 * con control de concurrencia (Throttling) y fallback a los precios de operaciones.
 */
"use strict";

(function () {
  const DG = window.DG;

  const PROXIES = [
    u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
    u => "https://corsproxy.io/?" + encodeURIComponent(u),
    u => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u),
    u => "https://thingproxy.freeboard.io/fetch/" + encodeURIComponent(u)
  ];

  DG.BENCHMARKS = [
    { id: "sp500",  label: "S&P 500",            symbol: "^GSPC",       color: "#e8a33d", on: true },
    { id: "dow",    label: "Dow Jones",          symbol: "^DJI",        color: "#8e6bbf", on: false },
    { id: "russell",label: "Russell 2000",       symbol: "^RUT",        color: "#d64541", on: false },
    { id: "msci",   label: "MSCI World (URTH)",  symbol: "URTH",        color: "#2e9e5b", on: true },
    { id: "numantia", label: "Numantia Patrimonio", symbol: "0P000168OI.F", color: "#666f7a", on: false },
  ];

  DG.ISIN_TO_YAHOO = {
    "US00217D1000": "ASTS",      
    "US5901061003": "MRLN",      
    "CA0074082060": "ACT.TO",    
    "IE00BK5BZX59": "GOO3.L",    
    "IE00BK5C1B80": "FB3.L",     
    "IE00BK5BZV36": "MSF3.L",    
    "GB00BJYDH287": "BTCW.SW",   
    "XS2595672036": "TLT5.L",    
    "CA11271J1075": "BN",        
    "FR0000121014": "MC.PA",     
    "CA3803551074": "GSY.TO",    
    "US4330001060": "HIMS",      
    "IE00B4ND3602": "IGLN.L",    
    "DE000A3H2200": "NA9.DE",    
    "PLDINPL00011": "DNP.WA",    
    "US30292L1070": "FRPH",      
    "FR0000051807": "TEP.PA",    
    "CA2674881040": "DND.TO",    
    "CA5266821092": "LNF.TO",    
    "CA09173B1076": "BITF",      
    "CA3615692058": "GDI.TO",    
    "US22160K1051": "COST",      
    "NL0006294274": "ENX.PA",    
    "AU0000185993": "IREN",      
    "NL0015000IY2": "UMG.AS",    
    "CA55378N1078": "MTY.TO",    
    "AU0000056269": "MAD.AX",    
    "DE000FTG1111": "FTK.DE",    
    "AU0000048001": "AFL.AX",    
    "IT0005439085": "TISG.MI",   
    "CA21250C1068": "CTS.TO",    
    "IT0005385213": "NWL.MI",    
    "CA59162N1096": "MRU.TO",    
    "CA0679011084": "GOLD",      
    "US00287Y1091": "ABBV",      
    "IE00BF4RFH31": "IUSN.DE",   
    "IT0003549422": "SL.MI",     
    "ES0183746314": "VID.MC",    
    "US30212P3038": "EXPE",      
    "US0463531089": "AZN",       
    "US43300A2033": "HLT",       
    "US4592001014": "IBM",
    "US9497461015": "WFC",       
    "US00206R1023": "T",         
    "US2561631068": "DOCU",      
    "US0079031078": "AMD",
    "PLATPRT00018": "APR.WA",    
    "US79466L3024": "CRM",       
    "NL0010273215": "ASML.AS",   
    "NL0009805522": "NBIS",      
    "US78409V1044": "SPGI",      
    "US01609W1027": "BABA",      
    "LU1681048630": "GLUX.PA",   
    "US68236H2040": "ONDS",      
    "US6877931096": "OSCR",      
    "GB0002875804": "BATS.L",    
    "IE00BK5BZS07": "AAP3.L",    
    "IE00B8K7KM88": "3USS.MI",   
    "CA55027C1068": "LMN.V",     
    "US92826C8394": "V",         
    "IE00B7Y34M31": "3USL.MI",    
    "GB0006215205": "MCG.L",     
    "AU000000KPG7": "KPG.AX",    
    "US17253J1060": "CIFR",      
    "IE00BK5BZQ82": "AMZ3.L",    
    "US5835433013": "SLNH",      
    "US57636Q1040": "MA",        
    "CA50077N1024": "PNG.V",     
    "US0258161092": "AXP",       
    "FR0000072597": "ALITL.PA",  
    "US2473617023": "DAL",       
    "DE0007236101": "SIE.DE",    
    "AU0000109159": "DUR.AX",    
    "US3927091013": "GRBK",      
    "IE00BMC38736": "SMH.L",     
    "GB00B3FBWW43": "SDI.L",     
    "US0970231058": "BA",        
    "CH1134540470": "ONON",      
    "US85208M1027": "SFM",       
    "US1912161007": "KO",        
    "US70450Y1038": "PYPL",      
    "IE00B3XXRP09": "VUSA.L",    
    "IE0001827041": "CRH",       
    "US7170811035": "PFE",       
    "CA82509L1076": "SHOP",      
    "FI4000391487": "RELAIS.HE", 
    "IE00B60SX394": "SC0J.DE",   
    "US8522341036": "XYZ",       
    "ES0105025003": "MRL.MC",    
    "US0378331005": "AAPL",
    "US88160R1014": "TSLA",
    "US02079K3059": "GOOGL",
    "US0231351067": "AMZN",
    "US30303M1027": "META",
    "US64110L1061": "NFLX",
    "US5949181045": "MSFT",
    "US67066G1040": "NVDA",
    "KYG651631007": "JOBY",      
    "KYG254571055": "CRDO",      
    "US46222L1089": "IONQ",      
    "US7731211089": "RKLB",      
    "US02156V1098": "OKLO",      
    "US00218A1051": "ASPI",      
    "US76655K1034": "RGTI",      
    "US22788C1053": "CRWD",      
    "US81762P1021": "NOW",       
    "US67079K1007": "SMR",       
    "CA65340P1062": "NXE.TO",    
    "US68389X1054": "ORCL",      
    "DK0062498333": "NOVO-B.CO", 
    "US46625H1005": "JPM",       
    "US8740391003": "TSM",       
    "US78392B2060": "HXSCF",     
    "US78392B1070": "HXSCF",     
    "US84615Q1031": "SPCX"
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
        const timeoutId = setTimeout(() => controller.abort(), 7000); 
        
        const res = await fetch(p(url), { 
            headers: { Accept: "application/json" },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        return data.contents ? JSON.parse(data.contents) : data;
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
    
    const promise = (async () => {
      try {
        const j = await fetchJSON(url);
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
      } catch (e) {
        console.warn("Fallo al obtener precios de Yahoo para: " + symbol + ". Usando fallback.", e);
        return { map: new Map(), adjMap: new Map(), meta: {} };
      }
    })();

    cache.set(key, promise);
    return promise;
  };

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
    if (!map || map.size === 0) return null;
    if (map.has(dayKey)) return map.get(dayKey);
    const d = new Date(dayKey + "T00:00:00Z");
    for (let i = 1; i <= 15; i++) {
      d.setUTCDate(d.getUTCDate() - 1);
      const k = d.toISOString().slice(0, 10);
      if (map.has(k)) return map.get(k);
    }
    const allVals = Array.from(map.values());
    return allVals.length > 0 ? allVals[allVals.length - 1] : null;
  };

  DG.validateAgainstTrades = function (pp, tradePoints, fxSeries) {
    if (!pp || pp.kind !== "yahoo" || !tradePoints || !tradePoints.length) return "ok";
    if (!pp.map || pp.map.size === 0) return "rejected";

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