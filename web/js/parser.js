/**
 * parser.js — Lee el Account.xlsx de DEGIRO y lo convierte en una lista de
 * eventos tipados en orden cronológico. Todo ocurre en el navegador.
 */
"use strict";

const DG = window.DG = window.DG || {};

DG.numES = function (s) {
  if (typeof s === "number") return s;
  if (!s) return NaN;
  return parseFloat(String(s).trim().replace(/\./g, "").replace(",", "."));
};

DG.parseDate = function (v) {
  if (v instanceof Date) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const m = String(v).trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
};

DG.dayKey = d => d.toISOString().slice(0, 10);

const TRADE_RE = new RegExp(
  "^(?:(FUSI\u00d3N|CAMBIO DE PRODUCTO|CAMBIO DE ISIN|EMISI\u00d3N DE DERECHOS|DESLISTAMIENTO)\\s*:?\\s*)?" +
  "(Compra|Venta)\\s+([\\d.,]+)\\s+([\\s\\S]*?)@([\\d.,]+)\\s+([A-Z]{3})\\s*\\((\\w{12})\\)?"
);
const SPLIT_RE = /^AJUSTE POR SPLIT:\s*([\d.,]+)\s+([\s\S]*?)\s*@\s*([\d.,]+)\s+([A-Z]{3})\s*\((\w{12})\)/;

const DEPOSIT_DESCS = new Set(["flatex Deposit", "Flatex Instant Deposit", "Ingreso Sofort/Trustly", "Ingreso"]);
const WITHDRAW_DESCS = new Set(["flatex Withdrawal", "Retirada"]);

DG.parseAccountFile = function (buf) {
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  let start = 0;
  for (let i = 0; i < Math.min(raw.length, 5); i++) {
    if (String(raw[i][0]).trim() === "Fecha") { start = i + 1; break; }
  }
  const rows = raw.slice(start).filter(r => r && r.some(c => c !== null && c !== ""));

  const merged = [];
  for (const r of rows) {
    const hasDate = r[0] !== null && r[0] !== "" && DG.parseDate(r[0]) !== null;
    if (!hasDate && merged.length) {
      const prev = merged[merged.length - 1];
      const a = String(prev[5] || "").replace(/\s+$/, "");
      const b = String(r[5] || "").trim();
      const glue = (/[\d][.,]$/.test(a) && /^\d/.test(b)) ? "" : " ";
      prev[5] = a + glue + b;
      for (const c of [7, 8, 9, 10, 11]) if (prev[c] === null && r[c] !== null) prev[c] = r[c];
    } else if (hasDate) {
      merged.push(r.slice());
    }
  }
  merged.reverse();

  const events = [];
  const warnings = [];

  for (const r of merged) {
    const date = DG.parseDate(r[0]);
    const desc = String(r[5] || "").trim();
    const ev = {
      date, time: r[1] || "", product: r[3] || null, isin: r[4] || null,
      desc, fxRate: (typeof r[6] === "number") ? r[6] : null,
      cur: r[7] || null, amount: (typeof r[8] === "number") ? r[8] : null,
      orderId: r[11] || null, type: "other",
    };

    let m;
    if ((m = TRADE_RE.exec(desc))) {
      ev.type = "trade";
      ev.special = m[1] || null;
      ev.side = m[2] === "Compra" ? 1 : -1;
      ev.qty = DG.numES(m[3]) * ev.side;
      ev.price = DG.numES(m[5]);
      ev.tradeCur = m[6];
      ev.isin = m[7];
      if (!ev.product) ev.product = m[4].trim();
    } else if ((m = SPLIT_RE.exec(desc))) {
      ev.type = "split";
      const q = DG.numES(m[1]);
      ev.qty = (ev.amount !== null && ev.amount < 0) ? q : -q;
      ev.price = DG.numES(m[3]);
      ev.tradeCur = m[4];
      ev.isin = m[5];
    } else if (DEPOSIT_DESCS.has(desc)) {
      ev.type = "deposit";
    } else if (WITHDRAW_DESCS.has(desc)) {
      ev.type = "withdrawal";
    } else if (desc === "Reservation iDEAL") {
      ev.type = "reservation";
    } else if (desc === "Processed Flatex Withdrawal") {
      ev.type = "wprocessed";
    } else if (desc === "Ingreso Cambio de Divisa" || desc === "Retirada Cambio de Divisa") {
      ev.type = "fx";
    } else if (desc === "Degiro Cash Sweep Transfer" || /fondos del mercado monetario/i.test(desc)) {
      ev.type = "sweep";
    } else if (/^Dividendo$/i.test(desc)) {
      ev.type = "dividend";
    } else if (/Retenci\u00f3n del dividendo/i.test(desc)) {
      ev.type = "divtax";
    } else if (/Pr\u00e9stamo de Valores/i.test(desc)) {
      ev.type = "lending";
    } else if (/comisi\u00f3n|costes de|coste de|conectividad|inter\u00e9s/i.test(desc)) {
      ev.type = "fee";
    } else if (/^(Compra|Venta)/.test(desc) || /POR SPLIT/.test(desc)) {
      warnings.push("Fila tipo operación sin interpretar: " + desc.slice(0, 120));
    }

    events.push(ev);
  }

  return { events, warnings };
};