/*
 ============================================================================
  NUMBER PANEL MODULE v4 — VOLTEX SMS API  (Pro UI + auto-refresh fix)
  • Auto-refresh: keyboard আর হারায় না (reply_markup ঠিকভাবে পাঠানো হয়)
  • Live sort: সবচেয়ে বেশি hit উপরে • Hash-diff: পরিবর্তন না হলে edit হয় না
  • Pagination: ◀️  1 / 5  ▶️  (নিচে ফিক্সড)
  Render Environment:
    VOLTEX_API_KEY   = (বাধ্যতামূলক) Voltex API key — কোডে লিখবেন না
    VOLTEX_BASE      = (ঐচ্ছিক) API base URL (না দিলে ডিফল্ট)
    IVAS_API_KEY     = (V2-এর জন্য) IVAS Developer API key (sk_live_…) — কোডে লিখবেন না
    IVAS_WEBHOOK_SECRET = (ঐচ্ছিক, প্রস্তাবিত) IVAS Webhooks পেজের signing secret → OTP দ্রুত আসে
    IVAS_POLL_MS, IVAS_MIN_GAP_MS, IVAS_LEASE_MIN, IVAS_BASE (সব ঐচ্ছিক)
    FORWARD_GROUP_ID, CHANNEL_URL, GET_NUMBER_URL, POLL_INTERVAL, MAX_PENDING
    AUTO_REFRESH_MS (default 1500), API_MIN_GAP_MS (default 900)
 ============================================================================
*/
import axios from "axios";
import crypto from "crypto";
import { detectCountry, COUNTRY_DATA } from "./country_flags.js";

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "6000");
const MAX_PENDING = parseInt(process.env.MAX_PENDING || "20");
const MAX_AGE = 16 * 60 * 1000;
const GROUP_RAW = process.env.FORWARD_GROUP_ID || "";
function normalizeChatId(v) {
  const x = String(v || "").trim().replace(/^['"]|['"]$/g, "");
  if (!x) return "";
  let m = x.match(/t\.me\/c\/(\d+)/i);
  if (m) return `-100${m[1]}`;
  if (/t\.me\/(joinchat\/|\+)/i.test(x)) return "";
  m = x.match(/t\.me\/([A-Za-z0-9_]{4,})/i);
  if (m) return `@${m[1]}`;
  if (/^@[A-Za-z0-9_]{4,}$/.test(x)) return x;
  if (/^-?\d+$/.test(x)) return x;
  return "";
}
const GROUP_ID = normalizeChatId(GROUP_RAW);
const CHANNEL_URL = process.env.CHANNEL_URL || "";
const GET_NUMBER_URL = process.env.GET_NUMBER_URL || "";
const PAGE = 8;
const PP_SERVICES = 8;
const PP_COUNTRIES = 8;
const PP_RANGES_GET = 8;
const PP_RANGES_TRAFFIC = 5;

const AUTO_REFRESH_MS = Math.max(800, parseInt(process.env.AUTO_REFRESH_MS || "1500"));
const API_MIN_GAP_MS = Math.max(500, parseInt(process.env.API_MIN_GAP_MS || "900"));
const VIEW_IDLE_LIMIT = 200;            // এতবার পরপর পরিবর্তন না হলে auto-refresh বন্ধ
const VIEW_MAX_AGE = 30 * 60 * 1000;
const MAX_ACTIVE_VIEWS = 500;
const HR = "━━━━━━━━━━━━━━━━━━";

/* IVAS (V2) */
const IVAS_BASE = (process.env.IVAS_BASE || "https://www.ivasms.com/api/v1").trim();
const IVAS_KEY = (process.env.IVAS_API_KEY || "").trim().replace(/^['"]|['"]$/g, "");
const IVAS_SECRET = (process.env.IVAS_WEBHOOK_SECRET || "").trim();
const IVAS_MIN_GAP_MS = Math.max(5000, parseInt(process.env.IVAS_MIN_GAP_MS || "6500")); // IVAS সীমা: ১০ রিকোয়েস্ট/মিনিট
const IVAS_POLL_MS = Math.max(10000, parseInt(process.env.IVAS_POLL_MS || (IVAS_SECRET ? "30000" : "15000")));
const LEASE_MS = Math.max(2, parseInt(process.env.IVAS_LEASE_MIN || "10")) * 60 * 1000;
const HITS_WINDOW = 30 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  VOLTEX API                                                         */
/* ------------------------------------------------------------------ */
const V_BASE = (process.env.VOLTEX_BASE || "https://api.2oo9.cloud/MXS47FLFX0U/tnevs/@public/api").trim();
const V_KEY = (process.env.VOLTEX_API_KEY || "").trim().replace(/^['"]|['"]$/g, "");
const vc = axios.create({
  baseURL: V_BASE,
  headers: { mauthapi: V_KEY, "Content-Type": "application/json", Accept: "application/json" },
  timeout: 25000,
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function vreq(method, path, body, tries = 2) {
  if (!V_KEY) return { ok: false, err: new Error("VOLTEX_API_KEY নেই") };
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await vc.request({ method, url: path, data: body });
      const j = res.data || {};
      if (j.meta?.code !== 200) {
        const err = new Error(j.message || `voltex ${j.meta?.code}`);
        err.code = j.meta?.code;
        err.isOutOfStock = j.meta?.code === 2946;
        return { ok: false, err };
      }
      return { ok: true, data: j.data };
    } catch (e) {
      const st = e.response?.status;
      console.error(`❌ Voltex ${path} [${i}/${tries}]:`, st || "", e.message);
      if (st && st < 500 && st !== 429) return { ok: false, err: e };
      if (i === tries) return { ok: false, err: e };
      await wait(600 * i);
    }
  }
  return { ok: false, err: new Error("max retries") };
}

const getLiveAccess = async () => (await vreq("GET", "/liveaccess")).data || null;
const getConsoleFeed = async () => (await vreq("GET", "/console")).data || null;
const getSuccessOtp = async () => (await vreq("GET", "/success-otp")).data || null;
const allocateNumber = async (range) => {
  const rid = String(range || "").replace(/X+$/i, "");
  return vreq("POST", "/getnum", { rid }, 1);
};

/* ------------------------------------------------------------------ */
/*  IVAS API (V2) — সীমা ১০/মিনিট, তাই সব কল একটা queue দিয়ে যায়          */
/* ------------------------------------------------------------------ */
const ivc = axios.create({
  baseURL: IVAS_BASE,
  headers: { Authorization: `Bearer ${IVAS_KEY}`, Accept: "application/json" },
  timeout: 20000,
});
let ivChain = Promise.resolve();
let ivNextAt = 0;
let ivBlockedUntil = 0;
const ivState = { lastErr: "", calls: 0, limited: 0 };
function ivreq(path, params) {
  const run = async () => {
    if (!IVAS_KEY) return { ok: false, status: 0, err: new Error("IVAS_API_KEY নেই") };
    const w = Math.max(ivNextAt - Date.now(), ivBlockedUntil - Date.now(), 0);
    if (w) await wait(w);
    ivNextAt = Date.now() + IVAS_MIN_GAP_MS;
    ivState.calls++;
    try {
      const res = await ivc.get(path, { params });
      ivState.lastErr = "";
      return { ok: true, data: res.data };
    } catch (e) {
      const st = e.response?.status || 0;
      const body = e.response?.data?.error || {};
      if (st === 429) {
        const ra = Number(body.retry_after || e.response?.headers?.["retry-after"] || 30);
        ivBlockedUntil = Date.now() + ra * 1000 + 500;
        ivState.limited++;
      }
      ivState.lastErr = `${st || "ERR"} ${body.code || e.message}`;
      console.error(`❌ IVAS ${path}:`, ivState.lastErr);
      return { ok: false, status: st, err: e, code: body.code };
    }
  };
  const p = ivChain.then(run, run);
  ivChain = p.catch(() => {});
  return p;
}

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */
const tr = (s, n) => { const x = String(s ?? ""); return x.length > n ? x.slice(0, n - 1) + "…" : x; };
const bar = (n, total, len = 10) => {
  const p = total > 0 ? Math.max(0, Math.min(1, n / total)) : 0;
  const f = Math.round(p * len);
  return "▰".repeat(f) + "▱".repeat(len - f) + ` ${Math.round(p * 100)}%`;
};
const head = (icon, title, tag = "") => `${icon} <b>${title}</b>${tag ? ` ┃ ${tag}` : ""}\n${HR}`;

// callback_data সীমা ৬৪ বাইট — বেশি লম্বা বাটন বাদ, খালি row বাদ
const cleanRows = (rows) =>
  (rows || [])
    .map((r) => (r || []).filter((b) => b && (!b.callback_data || Buffer.byteLength(String(b.callback_data)) <= 64)))
    .filter((r) => r.length);

// দেশের নাম → ছোট ডিটারমিনিস্টিক কী (callback_data ছোট রাখতে, রিস্টার্টেও একই থাকে)
const ck = (s) => {
  let h = 5381;
  const x = String(s);
  for (let i = 0; i < x.length; i++) h = (((h << 5) + h) + x.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

function countryShort(iso, name) {
  const i = String(iso || "").toUpperCase().trim();
  if (/^[A-Z]{2,3}$/.test(i)) return i;
  const nm = String(name || "").trim();
  if (!nm || nm === "Unknown") return "UN";
  const w = nm.split(/\s+/)[0].slice(0, 2).toUpperCase();
  return w.length >= 2 ? w : "UN";
}

function resolveCountry(name, number) {
  const n = String(name || "").trim();
  if (n && !/^(unknown|custom range)$/i.test(n)) {
    const d = detectCountry(n);
    if (d.code || d.iso) return { flag: d.flag, name: d.name };
  }
  const digits = String(number || "").replace(/\D/g, "");
  if (digits) {
    const d2 = detectCountry(digits);
    if (d2.code || d2.iso) return { flag: d2.flag, name: d2.name };
  }
  return { flag: "🌐", name: n && !/^custom range$/i.test(n) ? n : "Unknown" };
}
const flagOf = (name) => resolveCountry(name, "").flag;

const SERVICES = [
  ["facebook", "Facebook"], ["instagram", "Instagram"], ["whatsapp", "WhatsApp"], ["telegram", "Telegram"],
  ["paypal", "PayPal"], ["imo", "IMO"], ["google", "Google"], ["tiktok", "TikTok"], ["twitter", "Twitter/X"],
  ["snapchat", "Snapchat"], ["discord", "Discord"], ["amazon", "Amazon"], ["microsoft", "Microsoft"], ["binance", "Binance"],
];
function detectService(msg) {
  const m = String(msg || "").toLowerCase();
  for (const [k, name] of SERVICES) if (m.includes(k)) return name;
  return "OTP";
}
const COUNTRIES = (() => {
  const m = new Map();
  for (const c of COUNTRY_DATA) m.set(c.name.toLowerCase(), { name: c.name, flag: c.flag });
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
})();
const rangeKey = (r) => String(r || "unknown").replace(/[.\/\[\]*`~\s]/g, "_").slice(0, 60);

const extractOtp = (text) => {
  const s = String(text || "");
  let m = s.match(/\b(\d{3})[-\s](\d{3})\b/);
  if (m) return m[1] + m[2];
  m = s.match(/(?:code|otp)[\s:]+(\d{4,8})/i);
  if (m) return m[1];
  m = s.match(/\b(\d{4,8})\b/);
  if (m) return m[1];
  return "";
};

function paginate(arr, page, per) {
  const pages = Math.max(1, Math.ceil(arr.length / per));
  page = Math.min(Math.max(0, page), pages - 1);
  return { items: arr.slice(page * per, (page + 1) * per), page, pages, hasPrev: page > 0, hasNext: page < pages - 1, total: arr.length };
}

/* premium emoji helpers */
const ID_RE = /^\d{5,30}$/;
const escH = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function renderHtml(text, entities, start, end) {
  const ents = (entities || [])
    .filter((e) => e.type === "custom_emoji" && ID_RE.test(String(e.custom_emoji_id)) && e.offset >= start && e.offset + e.length <= end)
    .sort((a, b) => a.offset - b.offset);
  let out = "", pos = start;
  for (const e of ents) {
    out += escH(text.slice(pos, e.offset));
    out += `<tg-emoji emoji-id="${e.custom_emoji_id}">${escH(text.slice(e.offset, e.offset + e.length))}</tg-emoji>`;
    pos = e.offset + e.length;
  }
  return out + escH(text.slice(pos, end));
}
const plainOf = (h) => String(h).replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const hasPremium = (h) => /<tg-emoji/i.test(String(h));
const degradeText = (h) => String(h).replace(/<tg-emoji[^>]*>([\s\S]*?)<\/tg-emoji>/gi, "$1");
const stripIcon = (b) => { const { icon_custom_emoji_id, ...rest } = b; return rest; };
const degradeMarkup = (m) => {
  if (!m || typeof m !== "object") return m;
  if (m.inline_keyboard) return { ...m, inline_keyboard: m.inline_keyboard.map((r) => r.map(stripIcon)) };
  return m;
};
const usesPremium = (text, markup) => hasPremium(text || "") || JSON.stringify(markup || {}).includes("icon_custom_emoji_id");
function parseLabel(rawText, entities = []) {
  const lead = rawText.length - rawText.trimStart().length;
  const first = (entities || []).find((e) => e.type === "custom_emoji" && e.offset === lead && ID_RE.test(String(e.custom_emoji_id)));
  if (first) return { text: rawText.slice(first.offset + first.length).trim(), icon: String(first.custom_emoji_id) };
  return { text: rawText.trim(), icon: null };
}

const LBL = {
  p_get: "📞 Get Number", p_custom: "🔥 Custom Range", p_search: "🔍 Search OTP", p_hist: "📊 History",
  p_traffic: "📈 Live Traffic", p_lead: "🏆 Leaderboard", p_wd: "💸 OTP Withdraw",
  p_vone: "⚡ V1 Panel", p_vtwo: "📡 V2 Panel",
  g_join: "JOIN CHANNEL", g_copy: "{otp}", g_get: "📞 Get Number",
};
const EM = {
  head: { label: "Header", def: "random" }, number: { label: "Number", def: "📞" }, time: { label: "Time", def: "⏰" },
  key: { label: "OTP Key", def: "🔑" }, msg: { label: "Message", def: "🔔" }, arrow: { label: "Arrow", def: "➤" },
  dot: { label: "Dot", def: "◇" }, sep: { label: "Divider", def: "━━━━━━━━━━━━━━━━━━" },
};
const COLORS = [["🔴", "🟥"], ["🟢", "🟩"], ["🟣", "🟪"], ["🔵", "🟦"], ["🟡", "🟨"], ["⚫", "⬛"], ["⚪", "⬜"], ["🟤", "🟫"]];
const SCOPES = { user: "🤖 Bot-এ আসা OTP মেসেজ", group: "👥 Group-এ যাওয়া OTP মেসেজ" };

/* ------------------------------------------------------------------ */
/*  FACTORY                                                            */
/* ------------------------------------------------------------------ */
export function createNumberPanel(d) {
  const {
    bot, db, FieldValue, Timestamp, Markup, ib, kbx, edit, esc, tk, round2, bn2en, METHODS,
    userRef, getUser, needUser, isAdmin, getWdConfig, normAccount, accountPrompt,
    setSession, clearSession, getSession, safe, adminOnly, adminCb, adminLabel, commitOps, dm,
  } = d;

  const num = (t) => Number(bn2en(String(t)).trim().replace(/,/g, ""));

  /* ---------------- AUTO-REFRESH (live view) ---------------- */
  const activeViews = new Map();
  let floodUntil = 0;
  let lastApiAt = 0;
  let refreshing = false;

  function hashMsg(text, rows) {
    const s = String(text) + "|" + JSON.stringify(rows);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  async function refreshSharedCaches() {
    const now = Date.now();
    if (now - lastApiAt < API_MIN_GAP_MS) return;
    lastApiAt = now;
    await getServices(true).catch(() => {});
    await Promise.all([getRanges(true).catch(() => {}), getConsoleHits(true).catch(() => {})]);
  }

  async function autoRefreshLoop() {
    if (refreshing || !activeViews.size) return; // আগের রাউন্ড চলতে থাকলে নতুনটা শুরু হবে না
    if (Date.now() < floodUntil) return;
    refreshing = true;
    try {
      if ([...activeViews.values()].some((v) => v.kind !== "v2")) await refreshSharedCaches();
      const now = Date.now();
      for (const [key, view] of [...activeViews]) {
        if (now - view.born > VIEW_MAX_AGE || view.idle >= VIEW_IDLE_LIMIT) { activeViews.delete(key); continue; }
        if (view.busy) continue;
        if (Date.now() < floodUntil) break;

        view.busy = true;
        try {
          const built = await view.rerender();
          const rows = cleanRows(built?.rows);
          if (!built || !rows.length) { view.idle++; continue; }
          const newHash = hashMsg(built.text, rows);
          if (newHash === view.lastHash) { view.idle++; continue; }

          // ✅ FIX: আগে এখানে Markup অবজেক্ট (kb) সরাসরি reply_markup-এ দেওয়া হত → Telegram কিবোর্ড মুছে ফেলত,
          //         শুধু টেক্সট থাকত। এখন সঠিক { inline_keyboard } পাঠানো হয়।
          const send = (rs) => bot.telegram.editMessageText(view.chatId, view.messageId, undefined, built.text, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: rs },
            link_preview_options: { is_disabled: true },
          });
          try {
            try { await send(rows); }
            catch (e) {
              if (e.response?.error_code === 400 && JSON.stringify(rows).includes("icon_custom_emoji_id")) await send(rows.map((r) => r.map(stripIcon)));
              else throw e;
            }
          } catch (e) {
            const desc = String(e.description || e.message || "");
            if (desc.includes("message is not modified")) { view.lastHash = newHash; view.idle = 0; continue; }
            const m = desc.match(/retry after (\d+)/i);
            if (m || desc.includes("Too Many Requests")) {
              floodUntil = Date.now() + (m ? parseInt(m[1]) : 3) * 1000 + 500;
              view.idle++;
              continue;
            }
            if (/message to edit not found|chat not found|MESSAGE_ID_INVALID|message can't be edited|bot was blocked/i.test(desc)) {
              activeViews.delete(key); continue;
            }
            view.idle++;
            continue;
          }
          view.lastHash = newHash;
          view.lastAt = Date.now();
          view.idle = 0;
        } catch (e) {
          console.error("auto refresh:", e.message);
          view.idle++;
        } finally {
          view.busy = false;
        }
      }
    } finally {
      refreshing = false;
    }
  }

  /* ---------------- config ---------------- */
  const cfgRef = db.collection("settings").doc("otp_config");
  let cfgCache = { at: 0, v: null };
  async function getCfg(force = false) {
    if (!force && cfgCache.v && Date.now() - cfgCache.at < 20000) return cfgCache.v;
    const s = await cfgRef.get();
    const x = s.exists ? s.data() : {};
    const v = {
      perOtp: Number(x.perOtp ?? 0.25), minOtp: Number(x.minOtp ?? 100), minWithdraw: Number(x.minWithdraw ?? 50),
      referComm: Number(x.referComm ?? 0.1), enabled: x.enabled !== false, withdrawEnabled: x.withdrawEnabled !== false,
      showUnknown: x.showUnknown !== false,
    };
    cfgCache = { at: Date.now(), v };
    return v;
  }
  const saveCfg = async (patch) => { await cfgRef.set(patch, { merge: true }); cfgCache.at = 0; };

  /* ---------------- UI customization ---------------- */
  const uiRef = db.collection("settings").doc("otp_ui");
  let ui = { labels: {}, icons: {}, emoji: { user: {}, group: {} }, flags: { user: {}, group: {} } };
  async function loadUi() {
    try {
      const s = await uiRef.get();
      if (s.exists) {
        const x = s.data();
        ui = {
          labels: x.labels || {}, icons: x.icons || {},
          emoji: { user: x.emoji?.user || {}, group: x.emoji?.group || {} },
          flags: { user: x.flags?.user || {}, group: x.flags?.group || {} },
        };
      }
    } catch (e) { console.error("loadUi:", e.message); }
  }
  const saveUi = () => uiRef.set(ui).then(() => true).catch((e) => { console.error("saveUi:", e.message); return false; });
  const lab = (k) => ui.labels[k] || LBL[k];
  const bt = (k, extra) => ({ text: lab(k), ...(ui.icons[k] ? { icon_custom_emoji_id: ui.icons[k] } : {}), ...extra });

  const E = (scope, slot) => { const v = ui.emoji[scope]?.[slot]; return typeof v === "string" ? v : escH(EM[slot].def); };
  const getHead = (scope) => { const h = ui.emoji[scope]?.head; return h && typeof h === "object" ? h : "random"; };
  const headPair = (scope) => { const h = getHead(scope); return h === "random" ? COLORS[Math.floor(Math.random() * COLORS.length)] : [h.l, h.r]; };
  const describeEmoji = (scope, slot) => {
    if (slot === "head") { const h = getHead(scope); return h === "random" ? "random" : `${plainOf(h.l)} ${plainOf(h.r)}${hasPremium(h.l + h.r) ? " 💎" : ""}`; }
    const v = E(scope, slot);
    return plainOf(v) + (hasPremium(v) ? " 💎" : "");
  };
  async function setEmoji(scope, slot, rawText, entities = []) {
    const def = EM[slot];
    if (!def || !ui.emoji[scope]) return { error: "Invalid" };
    const t = rawText.trim();
    const lead = rawText.length - rawText.trimStart().length;
    if (t.toLowerCase() === "reset") { delete ui.emoji[scope][slot]; await saveUi(); return {}; }
    if (slot === "head") {
      if (t.toLowerCase() === "random") ui.emoji[scope].head = "random";
      else {
        const toks = [...rawText.matchAll(/\S+/g)];
        if (!toks.length || toks.length > 2 || toks.some((m) => m[0].length > 12)) return { error: "Header: random অথবা ১–২টা emoji দিন।" };
        const html = toks.map((m) => renderHtml(rawText, entities, m.index, m.index + m[0].length));
        ui.emoji[scope].head = { l: html[0], r: html[1] || html[0] };
      }
    } else {
      const max = slot === "sep" ? 40 : 12;
      if (!t || t.length > max) return { error: `১–${max} অক্ষরের মধ্যে লিখুন।` };
      ui.emoji[scope][slot] = renderHtml(rawText, entities, lead, lead + t.length);
    }
    await saveUi();
    return {};
  }
  const flagKey = (n) => String(n || "").toLowerCase().trim();
  const flagHtml = (scope, name, def) => { const v = ui.flags[scope]?.[flagKey(name)]; return typeof v === "string" ? v : escH(def); };
  const describeFlag = (scope, name, def) => { const v = ui.flags[scope]?.[flagKey(name)]; return typeof v !== "string" ? def : plainOf(v) + (hasPremium(v) ? "💎" : ""); };
  async function setFlag(scope, name, rawText, entities = []) {
    const t = rawText.trim();
    const k = flagKey(name);
    if (t.toLowerCase() === "reset") { delete ui.flags[scope][k]; await saveUi(); return {}; }
    if (!t || t.length > 12) return { error: "শুধু একটা flag/emoji পাঠান (সর্বোচ্চ ১২ অক্ষর)।" };
    const lead = rawText.length - rawText.trimStart().length;
    ui.flags[scope][k] = renderHtml(rawText, entities, lead, lead + t.length);
    await saveUi();
    return {};
  }

  /* ---------------- OTP message builders ---------------- */
  const nowDhaka = () => new Date().toLocaleString("en-GB", { timeZone: "Asia/Dhaka" });
  function buildOtpMessage(scope, { number, otp, service, full, country, masked }) {
    const c = resolveCountry(country, number);
    const [l, r] = headPair(scope);
    const sep = E(scope, "sep");
    const digits = String(number || "").replace(/\D/g, "");
    const shown = masked && digits.length >= 8 ? `${digits.slice(0, 4)}****${digits.slice(-3)}` : digits;
    return (
      `${l} <b>NEW OTP RECEIVED</b> ${r}\n${sep}\n\n` +
      `${flagHtml(scope, c.name, c.flag)} <b>${esc(c.name)}</b> ${E(scope, "arrow")} <b>${esc(service)}</b>\n` +
      `${E(scope, "number")} <b>Number</b> ${E(scope, "arrow")} <code>${esc(shown)}</code>\n` +
      `${E(scope, "time")} <b>Time</b> ${E(scope, "dot")} ${nowDhaka()}\n\n` +
      `${sep}\n${E(scope, "key")} <b>OTP CODE</b> ${E(scope, "key")}\n<code>${esc(otp)}</code>\n${sep}\n\n` +
      `${E(scope, "msg")} <b>MESSAGE</b>\n<blockquote>${esc(String(full || "N/A").slice(0, 400))}</blockquote>`
    );
  }
  function buildOtpKeyboard(scope, otp) {
    const copy = bt("g_copy", { copy_text: { text: String(otp) }, style: "success" });
    copy.text = copy.text.replace("{otp}", String(otp));
    if (scope === "user") return { inline_keyboard: [[copy]] };
    const row1 = [];
    if (CHANNEL_URL) row1.push(bt("g_join", { url: CHANNEL_URL, style: "primary" }));
    row1.push(copy);
    const rows = [row1];
    const link = GET_NUMBER_URL || (bot.botInfo?.username ? `https://t.me/${bot.botInfo.username}` : "");
    if (link) rows.push([bt("g_get", { url: link, style: "danger" })]);
    return { inline_keyboard: rows };
  }
  async function sendRich(chatId, html, markup) {
    const go = (t, m) => bot.telegram.sendMessage(chatId, t, { parse_mode: "HTML", reply_markup: m, link_preview_options: { is_disabled: true } });
    try { return await go(html, markup); }
    catch (e) {
      if (e.response?.error_code === 400 && usesPremium(html, markup)) return go(degradeText(html), degradeMarkup(markup));
      throw e;
    }
  }

  /* ---------------- pending numbers ---------------- */
  const pending = new Map();
  const pendCol = db.collection("voltex_pending_numbers");
  const claimsCol = db.collection("voltex_otp_claims");
  const seenOtps = new Set();
  const userPending = (uid) => [...pending.entries()].filter(([, v]) => v.userId === uid);

  function track(number, uid, country, operator, range) {
    const n = String(number).replace(/\D/g, "");
    if (!n) return;
    const v = { userId: String(uid), number: n, country: country || "Unknown", operator: operator || "", range: range || "", allocatedAt: Date.now() };
    pending.set(n, v);
    pendCol.doc(n).set(v).catch((e) => console.error("persist pending:", e.message));
  }
  function done(number) {
    const n = String(number).replace(/\D/g, "");
    pending.delete(n);
    pendCol.doc(n).delete().catch(() => {});
  }
  async function loadPending() {
    try {
      const snap = await pendCol.get();
      const now = Date.now();
      snap.forEach((doc) => {
        const v = doc.data();
        if (now - (v.allocatedAt || 0) > MAX_AGE) doc.ref.delete().catch(() => {});
        else if (!pending.has(doc.id)) pending.set(doc.id, v);
      });
      const cutoff = Date.now() - 60 * 60 * 1000;
      const cs = await claimsCol.where("time", ">=", cutoff).select().get();
      cs.forEach((x) => seenOtps.add(x.id));
    } catch (e) { console.error("loadPending:", e.message); }
  }

  /* ---------------- live caches ---------------- */
  // refreshSharedCaches প্রতি টিকে একবার API থেকে আনে; বাকি সবাই এই cache পড়ে (API হ্যামার হয় না)
  const CACHE_TTL = 5000;
  let liveCache = { at: 0, services: [] };
  let consoleCache = { at: 0, hits: [] };
  let rangeCache = { at: 0, items: [] };

  async function getServices(force = false) {
    if (!force && Date.now() - liveCache.at < CACHE_TTL && liveCache.services.length) return liveCache.services;
    const data = await getLiveAccess();
    if (data?.services) liveCache = { at: Date.now(), services: data.services };
    return liveCache.services;
  }
  async function getConsoleHits(force = false) {
    if (!force && Date.now() - consoleCache.at < CACHE_TTL && consoleCache.hits.length) return consoleCache.hits;
    const data = await getConsoleFeed();
    if (data?.hits) consoleCache = { at: Date.now(), hits: data.hits };
    return consoleCache.hits;
  }
  async function getRanges(force = false) {
    if (!force && Date.now() - rangeCache.at < CACHE_TTL && rangeCache.items.length) return rangeCache.items;
    const services = await getServices(force);
    const items = [];
    for (const svc of services) {
      for (const r of svc.ranges || []) {
        const base = String(r).replace(/X+$/i, "");
        const info = detectCountry(base + "0000");
        const iso = String(info.iso || "").toUpperCase().trim();
        const hasIso = /^[A-Z]{2,3}$/.test(iso);
        const countryName = info.name && info.name !== "Unknown" ? info.name : "Unknown";
        items.push({
          range: String(r).toUpperCase(), base, country: countryName,
          countryCode: hasIso ? iso : countryShort("", countryName),
          flag: info.flag || "🌐", operator: svc.sid, sid: svc.sid, last_at: svc.last_at || 0,
        });
      }
    }
    if (items.length) rangeCache = { at: Date.now(), items };
    return rangeCache.items;
  }
  async function hitMapByRange(force = false) {
    const hits = await getConsoleHits(force);
    const map = new Map();
    for (const h of hits) {
      const r = String(h.range || "").toUpperCase();
      if (r) map.set(r, (map.get(r) || 0) + 1);
    }
    return map;
  }
  function groupByCountry(ranges, hitMap) {
    const map = new Map();
    for (const r of ranges) {
      if (!map.has(r.country)) map.set(r.country, { name: r.country, code: r.countryCode || "UN", flag: r.flag, ranges: [], hits: 0 });
      const e = map.get(r.country);
      e.ranges.push(r);
      e.hits += hitMap.get(r.range) || 0;
    }
    return [...map.values()];
  }
  const countryNameByKey = async (key) => {
    const all = await getRanges();
    return [...new Set(all.map((r) => r.country))].find((n) => ck(n) === key) || "";
  };

  const statsRef = db.collection("settings").doc("otp_range_stats");
  const bumpRange = (range) => statsRef.set({ [rangeKey(range)]: FieldValue.increment(1) }, { merge: true }).catch(() => {});

  /* ---------------- OTP digit learning (শুধু Facebook OTP থেকে) ---------------- */
  const isFbText = (t) => /facebook|\bfb-\d/i.test(String(t || ""));
  const digitsRef = db.collection("settings").doc("otp_range_digits");
  const classRef = db.collection("settings").doc("otp_range_class");
  let digitStats = {};
  let classOv = {};
  const incBuf = {};
  async function loadDigits() {
    try {
      const [a, b] = await Promise.all([digitsRef.get(), classRef.get()]);
      digitStats = a.exists ? a.data() : {};
      classOv = b.exists ? b.data() : {};
    } catch (e) { console.error("loadDigits:", e.message); }
  }
  function learn(range, len) {
    if (!range || len < 5) return; // ৫ ডিজিট → s, ৬ বা তার বেশি → l
    const k = rangeKey(range);
    const t = len === 5 ? "s" : "l";
    (digitStats[k] ||= { s: 0, l: 0 })[t]++;
    (incBuf[k] ||= { s: 0, l: 0 })[t]++;
  }
  async function flushDigits() {
    const keys = Object.keys(incBuf);
    if (!keys.length) return;
    const patch = {};
    for (const k of keys) {
      const b = incBuf[k];
      patch[k] = {};
      if (b.s) patch[k].s = FieldValue.increment(b.s);
      if (b.l) patch[k].l = FieldValue.increment(b.l);
      delete incBuf[k];
    }
    try { await digitsRef.set(patch, { merge: true }); } catch (e) { console.error("flushDigits:", e.message); }
  }
  function classOf(range) {
    const k = rangeKey(range);
    if (classOv[k]) return classOv[k];
    const e = digitStats[k];
    if (!e || (e.s || 0) + (e.l || 0) === 0) return "unknown";
    const s1 = e.s || 0, l1 = e.l || 0, t = s1 + l1;
    if (s1 && !l1) return "short";
    if (l1 && !s1) return "long";
    if (s1 / t >= 0.8) return "short";
    if (l1 / t >= 0.8) return "long";
    return "both";
  }
  function matchesMode(range, filter, cfg) {
    if (!filter || filter === "a") return true;
    const c = classOf(range);
    if (c === "unknown") return cfg.showUnknown;
    if (c === "both") return true;
    return c === (filter === "s" ? "short" : "long");
  }

  const seenFeed = new Set();
  function rangeForNumber(dg, items) {
    if (!dg || dg.length < 5) return "";
    const known = items
      .filter((i) => { const p = String(i.range).replace(/X+$/i, ""); return p.length >= 4 && (dg.startsWith(p) || p.startsWith(dg)); })
      .sort((a, b) => b.range.replace(/X+$/i, "").length - a.range.replace(/X+$/i, "").length)[0];
    return known?.range || "";
  }
  async function learnFromOtpFeed() {
    const data = await getSuccessOtp();
    const otps = data?.otps || [];
    if (!otps.length) return;
    const items = await getRanges();
    for (const o of otps) {
      const id = String(o.otp_id);
      if (seenFeed.has(id)) continue;
      const num = String(o.number || "").replace(/\D/g, "");
      if (pending.has(num)) continue;
      seenFeed.add(id);
      const msg = String(o.message || "");
      if (!isFbText(msg)) continue;
      const range = rangeForNumber(num, items);
      if (!range) continue;
      const otp = extractOtp(msg);
      if (!otp) continue;
      learn(range, otp.length);
    }
    if (seenFeed.size > 5000) seenFeed.clear();
  }
  async function syncDigits() { await flushDigits(); await loadDigits(); }

  /* ---------------- ui helpers ---------------- */
  const back = [ib("🏠 Number Panel", "np_home", "danger")];
  const backV1 = [ib("🏠 V1 Panel", "np_v1", "danger")];
  const backV2 = [ib("🏠 V2 Panel", "np_v2", "danger")];
  async function show(ctx, text, rows, opts = {}) {
    rows = cleanRows(rows);
    if (!rows.length) rows = [back];
    const render = (rs) => {
      const kb = Markup.inlineKeyboard(rs);
      return ctx.callbackQuery ? edit(ctx, text, kb) : ctx.reply(text, kbx(kb));
    };
    let msg;
    try { msg = await render(rows); }
    catch (e) {
      if (JSON.stringify(rows).includes("icon_custom_emoji_id")) msg = await render(rows.map((r) => r.map(stripIcon)));
      else throw e;
    }
    const cb = ctx.callbackQuery;
    const mid = cb?.message?.message_id;
    const cid = cb?.message?.chat?.id;
    if (mid && cid) {
      const key = `${cid}:${mid}`;
      if (opts.auto) {
        if (activeViews.size >= MAX_ACTIVE_VIEWS && !activeViews.has(key)) {
          let oldestKey = null, oldestAt = Infinity;
          for (const [k, v] of activeViews) if (v.lastAt < oldestAt) { oldestAt = v.lastAt; oldestKey = k; }
          if (oldestKey) activeViews.delete(oldestKey);
        }
        activeViews.set(key, {
          chatId: cid, messageId: mid, rerender: opts.auto,
          kind: opts.kind || "v1", lastHash: hashMsg(text, rows), lastAt: Date.now(), born: Date.now(), idle: 0, busy: false,
        });
      } else {
        activeViews.delete(key);
      }
    }
    return msg;
  }
  const ask = async (ctx, session, text, rows = []) => { await setSession(ctx.from.id, session); return show(ctx, text, rows); };
  const lockMsg = (cfg, cnt) =>
    `🔒 OTP Balance withdraw করতে কমপক্ষে <b>${cfg.minOtp}টি</b> OTP রিসিভ করতে হবে।\nআপনার আছে: <b>${cnt}টি</b> (আর ${Math.max(0, cfg.minOtp - cnt)}টি বাকি)`;

  // ◀️  2 / 5  ▶️ — পেজ ১টা হলে দেখায় না; প্রথম/শেষ পেজে ফাঁকা ঘর (লেআউট নড়ে না)
  function navRow(pg, prevCb, nextCb) {
    if (pg.pages <= 1) return [];
    return [[
      pg.hasPrev ? ib("⬅️", prevCb, "primary") : ib("▫️", "np_noop", "primary"),
      ib(`${pg.page + 1} / ${pg.pages}`, "np_noop", "primary"),
      pg.hasNext ? ib("➡️", nextCb, "primary") : ib("▫️", "np_noop", "primary"),
    ]];
  }
  bot.action("np_noop", safe(async (ctx) => { await ctx.answerCbQuery().catch(() => {}); }));

  const filterLabel = (f) => (f === "s" ? "5 digit" : f === "l" ? "6+ digit" : "");
  const medalOf = (rank) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "");

  async function homeText(u) {
    const cfg = await getCfg();
    const cnt = Number(u.otpCount) || 0;
    const rate = Number(u.customPerOtp) || cfg.perOtp;
    const unlocked = cnt >= cfg.minOtp;
    return (
      `${head("📱", "NUMBER PANEL", cfg.enabled ? "🟢 ONLINE" : "🔴 OFFLINE")}\n` +
      `💰 Balance ▸ <b>${tk(u.otpBalance)}</b>\n` +
      `💵 Rate ▸ <b>৳${rate}</b> / OTP\n` +
      `🎁 Refer আয় ▸ <b>${tk(u.otpReferEarning)}</b>\n\n` +
      `🔑 OTP ▸ <b>${cnt}</b> / ${cfg.minOtp}\n<code>${bar(Math.min(cnt, cfg.minOtp), cfg.minOtp)}</code>\n` +
      `${unlocked ? "🟢 <b>Withdraw আনলক হয়েছে</b>" : `🔒 আর <b>${cfg.minOtp - cnt}টি</b> OTP-তে Withdraw আনলক`}\n\n` +
      `<blockquote>⚡ <b>V1</b> · Voltex — সার্ভিস, দেশ ও রেঞ্জ বেছে নাম্বার\n📡 <b>V2</b> · IVAS — দেশ ও রেঞ্জ বেছে ফ্রি নাম্বার</blockquote>\n` +
      `<i>OTP Balance আর Task Balance আলাদা।</i>`
    );
  }
  const homeRows = () => [
    [bt("p_vone", { callback_data: "np_v1", style: "success" }), bt("p_vtwo", { callback_data: "np_v2", style: "primary" })],
    [bt("p_lead", { callback_data: "np_lead", style: "success" }), bt("p_hist", { callback_data: "np_hist", style: "primary" })],
    [bt("p_search", { callback_data: "np_search", style: "primary" }), bt("p_wd", { callback_data: "np_wd", style: "success" })],
  ];
  async function gate(ctx) {
    const u = await needUser(ctx);
    if (!u) return null;
    if (u.otpBanned) { await show(ctx, "🚫 আপনার Number Panel অ্যাক্সেস বন্ধ করা হয়েছে।", [back]); return null; }
    return u;
  }
  async function open(ctx) {
    const u = await gate(ctx);
    if (!u) return;
    await clearSession(ctx.from.id);
    return show(ctx, await homeText(u), homeRows());
  }
  bot.action("np_home", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const u = await gate(ctx);
    if (!u) return;
    await clearSession(ctx.from.id);
    return show(ctx, await homeText(u), homeRows());
  }));

  bot.action("np_v1", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const u = await gate(ctx);
    if (!u) return;
    await clearSession(ctx.from.id);
    return show(ctx,
      `${head("⚡", "V1 PANEL", "Voltex")}\n💰 Balance ▸ <b>${tk(u.otpBalance)}</b>\n🔑 OTP ▸ <b>${Number(u.otpCount) || 0}</b>\n\n` +
      `<blockquote>📞 Get Number — সার্ভিস → দেশ → রেঞ্জ\n🔥 Custom Range — নিজে রেঞ্জ লিখুন\n📈 Live Traffic — এখন যেখানে বেশি hit</blockquote>`,
      [
        [bt("p_get", { callback_data: "np_get", style: "success" }), bt("p_custom", { callback_data: "np_custom", style: "danger" })],
        [bt("p_traffic", { callback_data: "np_traffic", style: "primary" })],
        [ib("⬅️ Number Panel", "np_home", "primary")],
      ]);
  }));

  /* ================================================================ */
  /*  GET NUMBER  (Service → Country → Range)                          */
  /* ================================================================ */
  async function buildServiceList(page, force = false) {
    const services = await getServices(force);
    const live = services.filter((s) => (s.ranges || []).length);
    if (!live.length) {
      return { text: `${head("📱", "SERVICES")}\n❌ এখন কোনো সার্ভিস সচল নেই।`, rows: [[ib("🔄 Retry", "np_get", "success")], backV1] };
    }
    const sorted = [...live].sort((a, b) => (b.last_at || 0) - (a.last_at || 0));
    const pg = paginate(sorted, page, PP_SERVICES);
    const btns = pg.items.map((s) => ib(`📱 ${tr(s.sid, 14)}`, `np_gsv:${s.sid}`, "success"));
    const rows = [];
    for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
    rows.push(...navRow(pg, `np_gsl:${pg.page - 1}`, `np_gsl:${pg.page + 1}`));
    rows.push([ib("🔄 Refresh", "np_get", "primary"), backV1[0]]);
    const text = `${head("📱", "SERVICES", "🟢 LIVE")}\n📡 Panel ▸ <b>V1 · Voltex</b>\n📦 সার্ভিস ▸ <b>${pg.total}</b>\n<blockquote>👇 সার্ভিস বেছে নিন — তারপর দেশ ও রেঞ্জ</blockquote>`;
    return { text, rows };
  }
  async function showServiceList(ctx, page = 0, auto = false) {
    const built = await buildServiceList(page, true);
    if (auto && ctx.callbackQuery) return show(ctx, built.text, built.rows, { auto: () => buildServiceList(page, false) });
    return show(ctx, built.text, built.rows);
  }
  bot.action("np_get", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await gate(ctx))) return;
    const cfg = await getCfg();
    if (!cfg.enabled) return show(ctx, "🔴 Number Panel এখন বন্ধ আছে।", [backV1]);
    return showServiceList(ctx, 0, true);
  }));
  bot.action(/^np_gsl:(\d+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await gate(ctx))) return;
    return showServiceList(ctx, Number(ctx.match[1]), true);
  }));
  bot.action(/^np_gsv:(.+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery("⏳").catch(() => {});
    if (!(await gate(ctx))) return;
    return showCountryList(ctx, ctx.match[1], "a", 0, true);
  }));

  async function buildCountryList(sid, filter, page, force = false) {
    const cfg = await getCfg();
    const all = await getRanges(force);
    const hitMap = await hitMapByRange(force);
    const sidLower = sid.toLowerCase();
    const allSvcRanges = all.filter((r) => r.sid && r.sid.toLowerCase() === sidLower);
    if (!allSvcRanges.length) {
      return { text: `${head("🌍", "COUNTRY")}\n❌ <b>${esc(sid)}</b>-এ এখন কোনো রেঞ্জ নেই।`, rows: [[ib("🔄 Retry", "np_get", "success")], backV1] };
    }
    const svcRanges = allSvcRanges.filter((r) => matchesMode(r.range, filter, cfg));
    const countries = groupByCountry(svcRanges, hitMap);
    countries.sort((a, b) => (b.hits - a.hits) || (b.ranges.length - a.ranges.length) || a.name.localeCompare(b.name)); // ⚡ live sort

    const cntS = allSvcRanges.filter((r) => { const c = classOf(r.range); return c === "short" || c === "both"; }).length;
    const cntL = allSvcRanges.filter((r) => { const c = classOf(r.range); return c === "long" || c === "both"; }).length;

    const pg = paginate(countries, page, PP_COUNTRIES);
    const btns = pg.items.map((c, i) => {
      const rank = pg.page * PP_COUNTRIES + i + 1;
      const medal = c.hits > 0 ? medalOf(rank) : "";
      const hitTag = c.hits > 0 ? ` · 🔥${c.hits}` : "";
      return ib(`${c.flag} ${c.code}${hitTag}`, `np_grc:${sid}:${filter}:${ck(c.name)}:0`, c.hits > 0 ? "danger" : "success");
    });
    const rows = [];
    if (cntS > 0 || cntL > 0) {
      const f = [ib(filter === "a" ? "✅ All" : "All", `np_gcl:${sid}:a:0`, filter === "a" ? "success" : "primary")];
      if (cntS > 0) f.push(ib(filter === "s" ? "✅ 5" : "5", `np_gcl:${sid}:s:0`, filter === "s" ? "success" : "primary"));
      if (cntL > 0) f.push(ib(filter === "l" ? "✅ 6+" : "6+", `np_gcl:${sid}:l:0`, filter === "l" ? "success" : "primary"));
      rows.push(f);
    }
    for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
    rows.push(...navRow(pg, `np_gcl:${sid}:${filter}:${pg.page - 1}`, `np_gcl:${sid}:${filter}:${pg.page + 1}`));
    rows.push([ib("⬅️ Services", "np_get", "primary"), backV1[0]]);

    const fl = filterLabel(filter);
    const text = `${head("🌍", "COUNTRY", "🟢 LIVE")}\n📡 Panel ▸ <b>V1 · Voltex</b>\n📱 Service ▸ <b>${esc(sid)}</b>${fl ? `\n🔢 Filter ▸ <b>${fl}</b>` : ""}\n🗺 দেশ ▸ <b>${pg.total}</b>\n<blockquote>🔥 = live hit  •  বেশি hit উপরে</blockquote>`;
    return { text, rows };
  }
  async function showCountryList(ctx, sid, filter = "a", page = 0, auto = false) {
    const built = await buildCountryList(sid, filter, page, true);
    if (auto && ctx.callbackQuery) return show(ctx, built.text, built.rows, { auto: () => buildCountryList(sid, filter, page, false) });
    return show(ctx, built.text, built.rows);
  }
  bot.action(/^np_gcl:([^:]+):([asl]):(\d+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await gate(ctx))) return;
    const [, sid, filter, page] = ctx.match;
    return showCountryList(ctx, sid, filter, Number(page), true);
  }));
  bot.action(/^np_gwc:([^:]+):([asl]):(\d+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await gate(ctx))) return;
    const [, sid, filter, page] = ctx.match;
    return showCountryList(ctx, sid, filter, Number(page), true);
  }));

  async function buildRangeList(sid, filter, country, page, force = false) {
    const cfg = await getCfg();
    const all = await getRanges(force);
    const hitMap = await hitMapByRange(force);
    const sidLower = sid.toLowerCase();
    let list = all
      .filter((r) => r.sid && r.sid.toLowerCase() === sidLower && r.country === country)
      .map((r) => ({ ...r, hits: hitMap.get(r.range) || 0 }))
      .filter((r) => matchesMode(r.range, filter, cfg));
    list.sort((a, b) => b.hits - a.hits || a.range.localeCompare(b.range)); // ⚡ live sort
    if (!list.length) {
      return { text: `${head("📞", "RANGES")}\n❌ এই দেশে এখন কোনো রেঞ্জ নেই।`, rows: [[ib("⬅️ Countries", `np_gwc:${sid}:${filter}:0`, "primary")], backV1] };
    }
    const pg = paginate(list, page, PP_RANGES_GET);
    const headCode = countryShort(list[0].countryCode, list[0].country);
    const btns = pg.items.map((r, i) => {
      const rank = pg.page * PP_RANGES_GET + i + 1;
      const medal = r.hits > 0 ? medalOf(rank) : "";
      const hitTag = r.hits > 0 ? ` · 🔥${r.hits}` : "";
      return ib(`${r.flag} ${tr(r.range, 14)}${hitTag}`, `np_grab:${sid}:${r.range}`, r.hits > 0 ? "danger" : "success");
    });
    const rows = [];
    for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
    rows.push(...navRow(pg, `np_grc:${sid}:${filter}:${ck(country)}:${pg.page - 1}`, `np_grc:${sid}:${filter}:${ck(country)}:${pg.page + 1}`));
    rows.push([ib("⬅️ Countries", `np_gwc:${sid}:${filter}:0`, "primary"), backV1[0]]);
    const fl = filterLabel(filter);
    const text = `${head("📞", "RANGES", "🟢 LIVE")}\n${list[0].flag} <b>${headCode}</b> · 📱 ${esc(sid)}${fl ? `\n🔢 Filter ▸ <b>${fl}</b>` : ""}\n📦 রেঞ্জ ▸ <b>${pg.total}</b>\n<blockquote>🔥 = live hit  •  👇 রেঞ্জে চাপলেই নাম্বার পাবেন</blockquote>`;
    return { text, rows };
  }
  async function showRangeList(ctx, sid, filter, country, page = 0, auto = false) {
    const built = await buildRangeList(sid, filter, country, page, true);
    if (auto && ctx.callbackQuery) return show(ctx, built.text, built.rows, { auto: () => buildRangeList(sid, filter, country, page, false) });
    return show(ctx, built.text, built.rows);
  }
  bot.action(/^np_grc:([^:]+):([asl]):([a-z0-9]+):(\d+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery("⏳").catch(() => {});
    if (!(await gate(ctx))) return;
    const [, sid, filter, key, page] = ctx.match;
    const country = await countryNameByKey(key);
    if (!country) return showCountryList(ctx, sid, filter, 0, true);
    return showRangeList(ctx, sid, filter, country, Number(page), true);
  }));

  /* ================================================================ */
  /*  LIVE TRAFFIC  (Service → Country → Top Ranges)                   */
  /* ================================================================ */
  async function buildTrafficServices(page, force = false) {
    const services = await getServices(force);
    const live = services.filter((s) => (s.ranges || []).length);
    if (!live.length) {
      return { text: `${head("📈", "LIVE TRAFFIC")}\n❌ এখন কোনো ট্রাফিক ডেটা নেই।`, rows: [[ib("🔄 Retry", "np_traffic", "success")], backV1] };
    }
    const sorted = [...live].sort((a, b) => (b.last_at || 0) - (a.last_at || 0));
    const pg = paginate(sorted, page, PP_SERVICES);
    const btns = pg.items.map((s) => ib(`🔥 ${tr(s.sid, 14)}`, `np_tsv:${s.sid}`, "danger"));
    const rows = [];
    for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
    rows.push(...navRow(pg, `np_tsl:${pg.page - 1}`, `np_tsl:${pg.page + 1}`));
    rows.push([ib("🔄 Refresh", "np_traffic", "primary"), backV1[0]]);
    return { text: `${head("📈", "LIVE TRAFFIC", "🟢 LIVE")}\n📡 Panel ▸ <b>V1 · Voltex</b>\n📦 সার্ভিস ▸ <b>${pg.total}</b>\n<blockquote>👇 সার্ভিস বেছে নিন</blockquote>`, rows };
  }
  async function showTrafficServices(ctx, page = 0, auto = false) {
    const built = await buildTrafficServices(page, true);
    if (auto && ctx.callbackQuery) return show(ctx, built.text, built.rows, { auto: () => buildTrafficServices(page, false) });
    return show(ctx, built.text, built.rows);
  }
  bot.action("np_traffic", safe(async (ctx) => {
    await ctx.answerCbQuery("🔄").catch(() => {});
    if (!(await gate(ctx))) return;
    return showTrafficServices(ctx, 0, true);
  }));
  bot.action(/^np_tsl:(\d+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await gate(ctx))) return;
    return showTrafficServices(ctx, Number(ctx.match[1]), true);
  }));
  bot.action(/^np_tsv:(.+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery("⏳").catch(() => {});
    if (!(await gate(ctx))) return;
    return showTrafficCountries(ctx, ctx.match[1], 0, true);
  }));

  async function buildTrafficCountries(sid, page, force = false) {
    const all = await getRanges(force);
    const sidLower = sid.toLowerCase();
    const svcRanges = all.filter((r) => r.sid && r.sid.toLowerCase() === sidLower);
    if (!svcRanges.length) {
      return { text: `${head("🌍", "COUNTRY")}\n❌ <b>${esc(sid)}</b>-এ এখন কোনো রেঞ্জ নেই।`, rows: [[ib("⬅️ Traffic", "np_traffic", "primary")], backV1] };
    }
    const hitMap = await hitMapByRange(force);
    const countries = groupByCountry(svcRanges, hitMap);
    countries.sort((a, b) => (b.hits - a.hits) || (b.ranges.length - a.ranges.length) || a.name.localeCompare(b.name)); // ⚡ live sort
    const pg = paginate(countries, page, PP_COUNTRIES);
    const btns = pg.items.map((c, i) => {
      const rank = pg.page * PP_COUNTRIES + i + 1;
      const medal = c.hits > 0 ? medalOf(rank) : "";
      const hitTag = c.hits > 0 ? ` · 🔥${c.hits}` : "";
      return ib(`${c.flag} ${c.code}${hitTag}`, `np_tc:${sid}:${ck(c.name)}:0`, c.hits > 0 ? "danger" : "success");
    });
    const rows = [];
    for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
    rows.push(...navRow(pg, `np_tcl:${sid}:${pg.page - 1}`, `np_tcl:${sid}:${pg.page + 1}`));
    rows.push([ib("⬅️ Traffic", "np_traffic", "primary"), backV1[0]]);
    return { text: `${head("🌍", "TRAFFIC · COUNTRY", "🟢 LIVE")}\n📱 Service ▸ <b>${esc(sid)}</b>\n🗺 দেশ ▸ <b>${pg.total}</b>\n<blockquote>🔥 = live hit  •  বেশি hit উপরে</blockquote>`, rows };
  }
  async function showTrafficCountries(ctx, sid, page = 0, auto = false) {
    const built = await buildTrafficCountries(sid, page, true);
    if (auto && ctx.callbackQuery) return show(ctx, built.text, built.rows, { auto: () => buildTrafficCountries(sid, page, false) });
    return show(ctx, built.text, built.rows);
  }
  bot.action(/^np_tcl:([^:]+):(\d+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await gate(ctx))) return;
    return showTrafficCountries(ctx, ctx.match[1], Number(ctx.match[2]), true);
  }));

  async function buildTrafficRanges(sid, country, page, force = false) {
    const all = await getRanges(force);
    const sidLower = sid.toLowerCase();
    const hitMap = await hitMapByRange(force);
    const list = all
      .filter((r) => r.sid && r.sid.toLowerCase() === sidLower && r.country === country)
      .map((r) => ({ ...r, hits: hitMap.get(r.range) || 0 }));
    list.sort((a, b) => b.hits - a.hits || a.range.localeCompare(b.range)); // ⚡ live sort
    if (!list.length) {
      return { text: `${head("📈", "TOP RANGES")}\n❌ এই দেশে এখন কোনো রেঞ্জ নেই।`, rows: [[ib("⬅️ Countries", `np_tsv:${sid}`, "primary")], backV1] };
    }
    const pg = paginate(list, page, PP_RANGES_TRAFFIC);
    const start = pg.page * PP_RANGES_TRAFFIC;
    const headCode = countryShort(list[0].countryCode, list[0].country);
    const rows = pg.items.map((r, i) => {
      const rank = start + i + 1;
      const medal = `#${rank}`;
      const hitTag = r.hits > 0 ? ` · 🔥${r.hits}` : "";
      return [ib(`${medal} ${r.flag} ${tr(r.range, 12)}${hitTag}`, `np_grab:${sid}:${r.range}`, rank <= 3 ? "danger" : "success")];
    });
    rows.push(...navRow(pg, `np_tc:${sid}:${ck(country)}:${pg.page - 1}`, `np_tc:${sid}:${ck(country)}:${pg.page + 1}`));
    rows.push([ib("⬅️ Countries", `np_tsv:${sid}`, "primary"), backV1[0]]);
    return {
      text: `${head("📈", "TOP RANGES", "🟢 LIVE")}\n${list[0].flag} <b>${headCode}</b> · 📱 ${esc(sid)}\n📦 রেঞ্জ ▸ <b>${pg.total}</b>\n<blockquote>live hit অনুযায়ী সাজানো  •  👇 রেঞ্জে চাপলেই নাম্বার পাবেন</blockquote>`,
      rows,
    };
  }
  async function showTrafficRanges(ctx, sid, country, page = 0, auto = false) {
    const built = await buildTrafficRanges(sid, country, page, true);
    if (auto && ctx.callbackQuery) return show(ctx, built.text, built.rows, { auto: () => buildTrafficRanges(sid, country, page, false) });
    return show(ctx, built.text, built.rows);
  }
  bot.action(/^np_tc:([^:]+):([a-z0-9]+):(\d+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery("⏳").catch(() => {});
    if (!(await gate(ctx))) return;
    const [, sid, key, page] = ctx.match;
    const country = await countryNameByKey(key);
    if (!country) return showTrafficCountries(ctx, sid, 0, true);
    return showTrafficRanges(ctx, sid, country, Number(page), true);
  }));

  /* ================================================================ */
  /*  CUSTOM RANGE                                                     */
  /* ================================================================ */
  bot.action("np_custom", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await gate(ctx))) return;
    return ask(ctx, { action: "np_range" },
      `${head("🔥", "CUSTOM RANGE")}\nরেঞ্জ লিখে পাঠান\nExample: <code>88017XXXX</code>\n\n<i>শুধু সংখ্যা ও X দিন। শেষে X দিয়ে বাকি ডিজিট বোঝান।</i>\n\nবাতিল: /menu`,
      [backV1]);
  }));

  /* ================================================================ */
  /*  ALLOCATE                                                         */
  /* ================================================================ */
  const allocating = new Set();
  const lastNum = new Map();

  async function grabNumbers(range, want = 2) {
    const got = [];
    const seenNums = new Set();
    const deadline = Date.now() + 12000;
    let round = 0;
    while (got.length < want && Date.now() < deadline && round < 8) {
      round++;
      const need = want - got.length;
      const results = await Promise.all(Array.from({ length: need }, () => allocateNumber(range).catch(() => ({ ok: false }))));
      for (const res of results) {
        if (!res || !res.ok) continue;
        const x = res.data;
        if (!x) continue;
        const full = String(x.no_plus_number || x.full_number || "").replace(/\D/g, "");
        if (full && !seenNums.has(full) && got.length < want) {
          seenNums.add(full);
          got.push({ number: full, country: x.country, operator: x.operator });
        }
      }
      if (got.length >= want || Date.now() >= deadline) break;
      await wait(250);
    }
    return got;
  }

  async function allocate(ctx, rangeId, sid, countryName = "Unknown", operatorName = "", isCustom = false) {
    const uid = String(ctx.from.id);
    if (!(await gate(ctx))) return;
    const cfg = await getCfg();
    if (!cfg.enabled) return show(ctx, "🔴 Number Panel এখন বন্ধ আছে।", [backV1]);
    if (!rangeId) return show(ctx, "❌ রেঞ্জ পাওয়া যায়নি, আবার চেষ্টা করুন।", [backV1]);
    if (allocating.has(uid)) { if (ctx.callbackQuery) ctx.answerCbQuery("⏳ অপেক্ষা করুন...").catch(() => {}); return; }
    if (userPendingAll(uid).length >= MAX_PENDING) return show(ctx, "⚠️ অনেকগুলো নাম্বার pending আছে। কিছু OTP আসা বা মেয়াদ শেষ হওয়া পর্যন্ত অপেক্ষা করুন।", [backV1]);
    lastNum.set(uid, { range: rangeId, sid, countryName, operator: operatorName, isCustom });
    allocating.add(uid);
    try {
      const range = String(rangeId).trim().toUpperCase();
      await show(ctx, `${head("⏳", "ALLOCATING")}\n🌐 Range ▸ <code>${esc(range)}</code>\n<blockquote>নাম্বার আনা হচ্ছে, একটু অপেক্ষা করুন…</blockquote>`, [backV1]);
      const picked = await grabNumbers(range, 2);
      if (!picked.length) {
        return show(ctx, `${head("❌", "ALLOCATE FAILED")}\n🌐 Range ▸ <code>${esc(range)}</code>\n<blockquote>এই রেঞ্জে এখন নাম্বার নেই।</blockquote>`,
          [[ib("🔄 Try Again", "np_chg", "success")], [ib("⬅️ ফিরে যান", isCustom ? "np_custom" : `np_gwc:${sid}:a:0`, "primary")], backV1]);
      }
      for (const p of picked) track(p.number, uid, p.country || countryName, p.operator || operatorName, range);
      const c = resolveCountry(picked[0].country || (isCustom ? "" : countryName), picked[0].number);
      const rows = picked.map((p) => [{ text: `${c.flag} ${p.number}`, copy_text: { text: p.number }, style: "success" }]);
      rows.push([ib("🔄 Change Number", "np_chg", "danger")]);
      if (isCustom) rows.push([ib("🔥 Custom Range", "np_custom", "primary")]);
      else if (sid) rows.push([ib("🌍 Change Country", `np_gwc:${sid}:a:0`, "primary")]);
      rows.push(backV1);
      const partial = picked.length < 2 ? `\n⚠️ <i>মাত্র ${picked.length}টি নাম্বার পাওয়া গেছে (রেঞ্জ সীমিত)</i>` : "";
      const svcLine = !isCustom && sid ? `📱 Service ▸ <b>${esc(sid)}</b>\n` : "";
      return show(ctx,
        `${c.flag} <b>${esc(c.name.toUpperCase())}</b> ┃ ✅ ALLOCATED\n${HR}\n📡 Panel ▸ <b>V1 · Voltex</b>\n${svcLine}🌐 Range ▸ <code>${esc(range)}</code>\n⏳ Status ▸ <b>OTP-র অপেক্ষায়…</b>${partial}\n\n<blockquote>👇 নাম্বারে ট্যাপ করলেই কপি হবে</blockquote>`,
        rows);
    } finally {
      allocating.delete(uid);
    }
  }

  bot.action(/^np_grab:([^:]+):(.+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery("⏳").catch(() => {});
    const [, sid, range] = ctx.match;
    const all = await getRanges();
    const it = all.find((r) => r.range === range);
    return allocate(ctx, range, sid, it?.country || "Unknown", it?.operator || "", false);
  }));
  bot.action("np_chg", safe(async (ctx) => {
    await ctx.answerCbQuery("🔄").catch(() => {});
    const last = lastNum.get(String(ctx.from.id));
    if (!last) return ctx.answerCbQuery("❌ আগে number নিন", { show_alert: true }).catch(() => {});
    return allocate(ctx, last.range, last.sid, last.countryName, last.operator, last.isCustom);
  }));

  /* ================================================================ */
  /*  V2 — IVAS PANEL  (account-এর নাম্বার পুল থেকে ধার দেওয়া হয়)       */
  /*  IVAS API শুধু পড়ার (numbers / messages) — তাই bot নিজে নাম্বার     */
  /*  "lease" দেয়, মেসেজ এলে যার lease তাকে OTP + টাকা দেয়।              */
  /* ================================================================ */
  const ivOn = () => !!IVAS_KEY;
  let ivNumbers = [];                       // [{number, range, country, flag, code}]
  const pending2 = new Map();               // number → { userId, range, country, allocatedAt }
  const pend2Col = db.collection("ivas_pending_numbers");
  const claims2Col = db.collection("ivas_claims");
  const lastLeased = new Map();             // number → সর্বশেষ কখন দেওয়া হয়েছে (ঘুরিয়ে দেওয়ার জন্য)
  const lastNum2 = new Map();               // uid → { range, numbers }
  const seenMsgs = new Set();
  const seenDeliveries = new Set();
  let hits2 = [];                           // [{ range, t }]
  const ivSt = { numbersAt: 0, msgAt: 0, polls: 0, webhooks: 0, lastWebhookAt: 0, lastHookErr: "" };

  function userPendingAll(uid) {
    return [...userPending(uid), ...[...pending2.entries()].filter(([, v]) => v.userId === uid)];
  }
  const errText = (r) => `${r?.status || "ERR"} ${r?.code || r?.err?.message || ""}`.trim();

  function ivInfoOf(n) {
    const range = String(n.range_name || "").trim().toUpperCase();
    const number = String(n.number || "").replace(/\D/g, "");
    const nameOnly = range.replace(/[0-9]+/g, " ").replace(/\s+/g, " ").trim();
    let info = nameOnly ? detectCountry(nameOnly) : { code: "", iso: "" };
    if (!(info.code || info.iso)) info = detectCountry(number);
    const known = !!(info.code || info.iso);
    const iso = String(info.iso || "").toUpperCase();
    const country = known ? info.name : (nameOnly || "Unknown");
    return {
      number, range, country,
      flag: known ? info.flag : "🌐",
      code: /^[A-Z]{2,3}$/.test(iso) ? iso : countryShort("", country),
    };
  }
  const ivService = (m) => {
    const s = String(m.source || "").trim();
    const dsv = detectService(`${s} ${m.message || ""}`);
    return dsv !== "OTP" ? dsv : (s || "OTP");
  };

  /* ---- lease (pending2) ---- */
  function track2(number, uid, country, range) {
    const v = { userId: String(uid), number, country: country || "Unknown", range: range || "", allocatedAt: Date.now() };
    pending2.set(number, v);
    pend2Col.doc(number).set(v).catch((e) => console.error("persist pending2:", e.message));
  }
  function done2(number) {
    pending2.delete(number);
    pend2Col.doc(number).delete().catch(() => {});
  }
  function cleanupLeases() {
    const now = Date.now();
    for (const [n, v] of pending2) if (now - v.allocatedAt > LEASE_MS) done2(n);
  }
  async function loadPending2() {
    try {
      const snap = await pend2Col.get();
      const now = Date.now();
      snap.forEach((x) => {
        const v = x.data();
        if (now - (v.allocatedAt || 0) > LEASE_MS) x.ref.delete().catch(() => {});
        else if (!pending2.has(x.id)) pending2.set(x.id, v);
      });
    } catch (e) { console.error("loadPending2:", e.message); }
  }

  /* ---- numbers / messages ---- */
  async function syncIvasNumbers() {
    if (!ivOn()) return;
    const all = [];
    let page = 1, last = 1;
    do {
      const r = await ivreq("/numbers", { per_page: 100, page });
      if (!r.ok) return;
      for (const n of r.data?.data || []) all.push(ivInfoOf(n));
      last = r.data?.pagination?.last_page || 1;
      page++;
    } while (page <= last && page <= 15);
    ivNumbers = all.filter((n) => n.number);
    ivSt.numbersAt = Date.now();
  }

  const fpOf = (m) => crypto.createHash("md5").update(`${m.received_at}${m.number}${m.source}${m.message}`).digest("hex");

  async function processIvasMessage(m) {
    if (!m || !m.number) return;
    if (m.status && m.status !== "delivered") return;
    const fp = fpOf(m);
    if (seenMsgs.has(fp)) return;
    seenMsgs.add(fp);
    if (seenMsgs.size > 20000) [...seenMsgs].slice(0, 10000).forEach((x) => seenMsgs.delete(x));

    const number = String(m.number).replace(/\D/g, "");
    const range = String(m.range_name || "").trim().toUpperCase();
    const t = Date.parse(m.received_at) || Date.now();
    if (range && Date.now() - t < HITS_WINDOW) hits2.push({ range, t });

    const text = String(m.message || "");
    const otp = extractOtp(text);
    const lease = pending2.get(number);

    if (lease && otp && t >= lease.allocatedAt - 10000) {
      try { await claims2Col.doc(fp).create({ number, userId: lease.userId, t }); }
      catch (e) { if (e.code === 6) return; throw e; }
      try {
        await credit({ number, otp, full: text, service: ivService(m), info: { userId: lease.userId, country: lease.country, range: lease.range || range } });
        done2(number);
      } catch (e) {
        console.error("ivas credit failed:", e.message);
        await claims2Col.doc(fp).delete().catch(() => {});
        seenMsgs.delete(fp);
      }
      return;
    }
    // কারো lease নেই → শুধু Facebook OTP থেকে রেঞ্জের digit শেখা
    if (otp && range && (isFbText(text) || /facebook/i.test(m.source || ""))) learn(range, otp.length);
  }

  let ivPolling = false;
  async function pollIvasMessages() {
    if (!ivOn() || ivPolling) return;
    ivPolling = true;
    try {
      cleanupLeases();
      const start = new Date(Date.now() - 86400000).toISOString().slice(0, 10); // গতকাল + আজ (UTC)
      const r = await ivreq("/messages", { per_page: 200, start_date: start });
      if (!r.ok) return;
      ivSt.msgAt = Date.now();
      ivSt.polls++;
      for (const m of (r.data?.data || []).slice().reverse()) await processIvasMessage(m); // পুরনো আগে
      hits2 = hits2.filter((h) => h.t > Date.now() - HITS_WINDOW);
    } catch (e) { console.error("pollIvasMessages:", e.message); }
    finally { ivPolling = false; }
  }

  async function handleIvasEvent(ev) {
    const id = String(ev?.id || "");
    if (id) {
      if (seenDeliveries.has(id)) return;
      seenDeliveries.add(id);
      if (seenDeliveries.size > 5000) seenDeliveries.clear();
    }
    ivSt.webhooks++;
    ivSt.lastWebhookAt = Date.now();
    const d = ev?.data || {};
    switch (ev?.event) {
      case "message.received": return processIvasMessage(d);
      case "number.assigned": {
        const n = ivInfoOf({ number: d.number, range_name: d.range_name });
        if (n.number && !ivNumbers.some((x) => x.number === n.number)) ivNumbers.push(n);
        return;
      }
      case "number.removed": {
        const num2 = String(d.number || "").replace(/\D/g, "");
        ivNumbers = ivNumbers.filter((x) => x.number !== num2);
        return;
      }
      default: return;
    }
  }

  // bot.js-এর http server থেকে ডাকা হয়: POST /ivas-webhook
  function handleWebhook(req, res) {
    if (!IVAS_SECRET) { res.writeHead(503); return res.end("webhook not configured"); }
    const chunks = [];
    let size = 0;
    req.on("data", (c) => { size += c.length; if (size > 1_000_000) { req.destroy(); return; } chunks.push(c); });
    req.on("error", () => {});
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const ts = String(req.headers["x-ivas-timestamp"] || "");
      const sig = String(req.headers["x-ivas-signature"] || "");
      const expected = "sha256=" + crypto.createHmac("sha256", IVAS_SECRET).update(`${ts}.${raw}`).digest("hex");
      const okSig = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      const fresh = Math.abs(Date.now() / 1000 - Number(ts)) <= 300;
      if (!okSig || !fresh) {
        ivSt.lastHookErr = !okSig ? "signature মেলেনি (IVAS_WEBHOOK_SECRET ঠিক আছে?)" : "timestamp পুরনো";
        res.writeHead(401);
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "text/plain" }); // ৫ সেকেন্ডের মধ্যে আগে উত্তর
      res.end("ok");
      let ev;
      try { ev = JSON.parse(raw); } catch { return; }
      handleIvasEvent(ev).catch((e) => console.error("ivas webhook:", e.message));
    });
  }

  async function startV2() {
    if (!ivOn()) { console.log("ℹ️ V2 (IVAS) বন্ধ — IVAS_API_KEY সেট করা নেই।"); return; }
    await loadPending2();
    const r = await ivreq("/numbers", { per_page: 1 });
    if (r.ok) console.log(`✅ IVAS API OK (${r.data?.pagination?.total ?? "?"} numbers)`);
    else console.error(`❌ IVAS API সমস্যা: ${errText(r)} — IVAS_API_KEY ঠিক আছে? (401 = key ভুল/regenerate হয়েছে)`);
    console.log(IVAS_SECRET
      ? `✅ IVAS webhook চালু → ${(process.env.RENDER_EXTERNAL_URL || "https://<আপনার-render-url>")}/ivas-webhook`
      : "ℹ️ IVAS_WEBHOOK_SECRET নেই — শুধু polling চলছে (webhook দিলে OTP আরও দ্রুত আসবে)");
    syncIvasNumbers().then(() => pollIvasMessages()).catch(() => {});
    setInterval(() => syncIvasNumbers().catch((e) => console.error("syncIvasNumbers:", e.message)), 3 * 60 * 1000);
    setInterval(() => pollIvasMessages().catch((e) => console.error("pollIvasMessages:", e.message)), IVAS_POLL_MS);
  }

  /* ---- pool helpers ---- */
  const isFree = (n) => !pending2.has(n.number);
  function hitMap2() {
    const cutoff = Date.now() - HITS_WINDOW;
    const m = new Map();
    for (const h of hits2) if (h.t > cutoff) m.set(h.range, (m.get(h.range) || 0) + 1);
    return m;
  }
  function groupRanges(filter, cfg) {
    const hm = hitMap2();
    const byRange = new Map();
    for (const n of ivNumbers) {
      if (!matchesMode(n.range, filter, cfg)) continue;
      const e = byRange.get(n.range) || { range: n.range, country: n.country, code: n.code, flag: n.flag, total: 0, avail: 0, hits: hm.get(n.range) || 0 };
      e.total++;
      if (isFree(n)) e.avail++;
      byRange.set(n.range, e);
    }
    return [...byRange.values()];
  }
  const rangeNameByKey = (key) => [...new Set(ivNumbers.map((n) => n.range))].find((r) => ck(r) === key) || "";
  const countryNameByKey2 = (key) => [...new Set(ivNumbers.map((n) => n.country))].find((c) => ck(c) === key) || "";

  /* ---- V2 menu ---- */
  async function v2Text(u) {
    if (!ivOn()) return `${head("📡", "V2 PANEL", "IVAS")}\n🔴 V2 এখনো চালু হয়নি।\n<blockquote>Admin: Render Environment-এ <code>IVAS_API_KEY</code> দিন।</blockquote>`;
    const free = ivNumbers.filter(isFree).length;
    const hits = [...hitMap2().values()].reduce((a, b) => a + b, 0);
    return (
      `${head("📡", "V2 PANEL", "IVAS")}\n` +
      `💰 Balance ▸ <b>${tk(u.otpBalance)}</b>\n🔑 OTP ▸ <b>${Number(u.otpCount) || 0}</b>\n\n` +
      `📦 পুল ▸ <b>${ivNumbers.length}</b> নাম্বার  •  🟢 ফ্রি <b>${free}</b>\n🔥 শেষ ৩০ মিনিটে hit ▸ <b>${hits}</b>\n\n` +
      `<blockquote>📞 Get Number — দেশ → রেঞ্জ বেছে ফ্রি নাম্বার\n📈 Live Traffic — এখন যেসব রেঞ্জে OTP আসছে\n⏱ নাম্বার ${Math.round(LEASE_MS / 60000)} মিনিট আপনার নামে থাকে</blockquote>` +
      (ivNumbers.length ? "" : "\n\n⏳ <i>নাম্বার লিস্ট লোড হচ্ছে… ১ মিনিট পর আবার দেখুন।</i>")
    );
  }
  bot.action("np_v2", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const u = await gate(ctx);
    if (!u) return;
    await clearSession(ctx.from.id);
    return show(ctx, await v2Text(u), [
      [bt("p_get", { callback_data: "np2_cl:a:0", style: "success" }), bt("p_traffic", { callback_data: "np2_tp:0", style: "danger" })],
      [ib("⬅️ Number Panel", "np_home", "primary")],
    ]);
  }));

  /* ---- V2 Get Number: Country → Range ---- */
  async function buildV2Countries(filter, page) {
    const cfg = await getCfg();
    if (!ivNumbers.length) {
      return { text: `${head("🌍", "COUNTRY", "IVAS")}\n❌ পুলে এখন কোনো নাম্বার নেই।`, rows: [[ib("🔄 Retry", "np2_cl:a:0", "success")], backV2] };
    }
    const all = groupRanges("a", cfg);
    const ranges = groupRanges(filter, cfg);
    const byC = new Map();
    for (const r of ranges) {
      const e = byC.get(r.country) || { name: r.country, code: r.code, flag: r.flag, hits: 0, avail: 0, ranges: 0 };
      e.hits += r.hits; e.avail += r.avail; e.ranges++;
      byC.set(r.country, e);
    }
    const list = [...byC.values()].sort((a, b) => (b.hits - a.hits) || (b.avail - a.avail) || a.name.localeCompare(b.name)); // ⚡ live sort
    const cntS = all.filter((r) => { const c = classOf(r.range); return c === "short" || c === "both"; }).length;
    const cntL = all.filter((r) => { const c = classOf(r.range); return c === "long" || c === "both"; }).length;

    const pg = paginate(list, page, PP_COUNTRIES);
    const btns = pg.items.map((c) =>
      ib(`${c.flag} ${c.code}${c.hits ? ` · 🔥${c.hits}` : ""} · ${c.avail}`, `np2_rl:${filter}:${ck(c.name)}:0`, c.hits > 0 ? "danger" : "success"));
    const rows = [];
    if (cntS > 0 || cntL > 0) {
      const f = [ib(filter === "a" ? "✅ All" : "All", "np2_cl:a:0", filter === "a" ? "success" : "primary")];
      if (cntS > 0) f.push(ib(filter === "s" ? "✅ 5" : "5", "np2_cl:s:0", filter === "s" ? "success" : "primary"));
      if (cntL > 0) f.push(ib(filter === "l" ? "✅ 6+" : "6+", "np2_cl:l:0", filter === "l" ? "success" : "primary"));
      rows.push(f);
    }
    for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
    rows.push(...navRow(pg, `np2_cl:${filter}:${pg.page - 1}`, `np2_cl:${filter}:${pg.page + 1}`));
    rows.push([ib("⬅️ V2 Panel", "np_v2", "primary"), back[0]]);
    const fl = filterLabel(filter);
    const text =
      `${head("🌍", "COUNTRY", "🟢 LIVE")}\n📡 Panel ▸ <b>V2 · IVAS</b>${fl ? `\n🔢 Filter ▸ <b>${fl}</b>` : ""}\n🗺 দেশ ▸ <b>${pg.total}</b>\n` +
      `<blockquote>🔥 = live hit  •  শেষের সংখ্যা = ফ্রি নাম্বার</blockquote>`;
    return { text, rows };
  }
  async function showV2Countries(ctx, filter = "a", page = 0) {
    const built = await buildV2Countries(filter, page);
    if (ctx.callbackQuery) return show(ctx, built.text, built.rows, { auto: () => buildV2Countries(filter, page), kind: "v2" });
    return show(ctx, built.text, built.rows);
  }
  bot.action(/^np2_cl:([asl]):(\d+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await gate(ctx))) return;
    const cfg = await getCfg();
    if (!cfg.enabled) return show(ctx, "🔴 Number Panel এখন বন্ধ আছে।", [back]);
    return showV2Countries(ctx, ctx.match[1], Number(ctx.match[2]));
  }));

  async function buildV2Ranges(filter, country, page) {
    const cfg = await getCfg();
    const list = groupRanges(filter, cfg).filter((r) => r.country === country)
      .sort((a, b) => (b.hits - a.hits) || (b.avail - a.avail) || a.range.localeCompare(b.range)); // ⚡ live sort
    if (!list.length) {
      return { text: `${head("📞", "RANGES", "IVAS")}\n❌ এই দেশে এখন কোনো রেঞ্জ নেই।`, rows: [[ib("⬅️ Countries", `np2_cl:${filter}:0`, "primary")], backV2] };
    }
    const pg = paginate(list, page, PP_RANGES_GET);
    const btns = pg.items.map((r) =>
      ib(`${r.flag} ${tr(r.range, 16)}${r.hits ? ` · 🔥${r.hits}` : ""} · ${r.avail}`, `np2_grab:${ck(r.range)}`, r.hits > 0 ? "danger" : "success"));
    const rows = [];
    for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
    rows.push(...navRow(pg, `np2_rl:${filter}:${ck(country)}:${pg.page - 1}`, `np2_rl:${filter}:${ck(country)}:${pg.page + 1}`));
    rows.push([ib("⬅️ Countries", `np2_cl:${filter}:0`, "primary"), back[0]]);
    const fl = filterLabel(filter);
    const text =
      `${head("📞", "RANGES", "🟢 LIVE")}\n${list[0].flag} <b>${list[0].code}</b> · ${esc(country)}${fl ? `\n🔢 Filter ▸ <b>${fl}</b>` : ""}\n📦 রেঞ্জ ▸ <b>${pg.total}</b>\n` +
      `<blockquote>🔥 = live hit  •  শেষের সংখ্যা = ফ্রি নাম্বার\n👇 রেঞ্জে চাপলেই ২টি নাম্বার পাবেন</blockquote>`;
    return { text, rows };
  }
  async function showV2Ranges(ctx, filter, country, page = 0) {
    const built = await buildV2Ranges(filter, country, page);
    if (ctx.callbackQuery) return show(ctx, built.text, built.rows, { auto: () => buildV2Ranges(filter, country, page), kind: "v2" });
    return show(ctx, built.text, built.rows);
  }
  bot.action(/^np2_rl:([asl]):([a-z0-9]+):(\d+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery("⏳").catch(() => {});
    if (!(await gate(ctx))) return;
    const [, filter, key, page] = ctx.match;
    const country = countryNameByKey2(key);
    if (!country) return showV2Countries(ctx, filter, 0);
    return showV2Ranges(ctx, filter, country, Number(page));
  }));

  /* ---- V2 Live Traffic: সব রেঞ্জ, hit অনুযায়ী ---- */
  const PP_TOP2 = 6;
  async function buildV2Top(page) {
    const cfg = await getCfg();
    const list = groupRanges("a", cfg).sort((a, b) => (b.hits - a.hits) || (b.avail - a.avail) || a.range.localeCompare(b.range));
    if (!list.length) return { text: `${head("📈", "LIVE TRAFFIC", "IVAS")}\n❌ এখন কোনো ডেটা নেই।`, rows: [[ib("🔄 Retry", "np2_tp:0", "success")], backV2] };
    const pg = paginate(list, page, PP_TOP2);
    const start = pg.page * PP_TOP2;
    const rows = pg.items.map((r, i) => [ib(`#${start + i + 1} ${r.flag} ${tr(r.range, 16)}${r.hits ? ` · 🔥${r.hits}` : ""} · ${r.avail}`, `np2_grab:${ck(r.range)}`, start + i < 3 && r.hits > 0 ? "danger" : "success")]);
    rows.push(...navRow(pg, `np2_tp:${pg.page - 1}`, `np2_tp:${pg.page + 1}`));
    rows.push([ib("⬅️ V2 Panel", "np_v2", "primary"), back[0]]);
    const total = [...hitMap2().values()].reduce((a, b) => a + b, 0);
    return {
      text: `${head("📈", "LIVE TRAFFIC", "🟢 LIVE")}\n📡 Panel ▸ <b>V2 · IVAS</b>\n🔥 শেষ ৩০ মিনিটে hit ▸ <b>${total}</b>\n<blockquote>hit অনুযায়ী সাজানো  •  শেষের সংখ্যা = ফ্রি নাম্বার\n👇 রেঞ্জে চাপলেই নাম্বার পাবেন</blockquote>`,
      rows,
    };
  }
  bot.action(/^np2_tp:(\d+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery("🔄").catch(() => {});
    if (!(await gate(ctx))) return;
    const page = Number(ctx.match[1]);
    const built = await buildV2Top(page);
    return show(ctx, built.text, built.rows, { auto: () => buildV2Top(page), kind: "v2" });
  }));

  /* ---- V2 Allocate ---- */
  async function allocate2(ctx, rangeName) {
    const uid = String(ctx.from.id);
    if (!(await gate(ctx))) return;
    const cfg = await getCfg();
    if (!cfg.enabled) return show(ctx, "🔴 Number Panel এখন বন্ধ আছে।", [back]);
    if (!ivOn()) return show(ctx, "🔴 V2 এখনো চালু হয়নি।", [back]);
    if (!rangeName) return show(ctx, "❌ রেঞ্জ পাওয়া যায়নি, আবার চেষ্টা করুন।", [backV2]);
    if (allocating.has(uid)) { if (ctx.callbackQuery) ctx.answerCbQuery("⏳ অপেক্ষা করুন...").catch(() => {}); return; }
    if (userPendingAll(uid).length >= MAX_PENDING) return show(ctx, "⚠️ অনেকগুলো নাম্বার pending আছে। কিছু OTP আসা বা মেয়াদ শেষ হওয়া পর্যন্ত অপেক্ষা করুন।", [backV2]);
    allocating.add(uid);
    try {
      cleanupLeases();
      const free = ivNumbers
        .filter((n) => n.range === rangeName && isFree(n))
        .sort((a, b) => ((lastLeased.get(a.number) || 0) - (lastLeased.get(b.number) || 0)) || (Math.random() - 0.5)); // যেটা সবচেয়ে কম ব্যবহৃত
      const picked = free.slice(0, 2);
      if (!picked.length) {
        return show(ctx, `${head("❌", "কোনো ফ্রি নাম্বার নেই")}\n🌐 Range ▸ <code>${esc(rangeName)}</code>\n<blockquote>এই রেঞ্জের সব নাম্বার এখন অন্যদের কাছে। একটু পরে চেষ্টা করুন বা অন্য রেঞ্জ নিন।</blockquote>`,
          [[ib("🔄 Try Again", "np2_chg", "success")], [ib("⬅️ ফিরে যান", "np2_cl:a:0", "primary")], backV2]);
      }
      for (const n of picked) { track2(n.number, uid, n.country, n.range); lastLeased.set(n.number, Date.now()); }
      lastNum2.set(uid, { range: rangeName, numbers: picked.map((p) => p.number) });
      const c = picked[0];
      const rows = picked.map((p) => [{ text: `${p.flag} ${p.number}`, copy_text: { text: p.number }, style: "success" }]);
      rows.push([ib("🔄 Change Number", "np2_chg", "danger")]);
      rows.push([ib("🌍 Change Country", "np2_cl:a:0", "primary")]);
      rows.push(backV2);
      const partial = picked.length < 2 ? `\n⚠️ <i>মাত্র ${picked.length}টি ফ্রি নাম্বার ছিল</i>` : "";
      return show(ctx,
        `${c.flag} <b>${esc(c.country.toUpperCase())}</b> ┃ ✅ ALLOCATED\n${HR}\n📡 Panel ▸ <b>V2 · IVAS</b>\n🌐 Range ▸ <code>${esc(rangeName)}</code>\n⏳ Status ▸ <b>OTP-র অপেক্ষায়…</b>\n⏱ মেয়াদ ▸ <b>${Math.round(LEASE_MS / 60000)} মিনিট</b>${partial}\n\n<blockquote>👇 নাম্বারে ট্যাপ করলেই কপি হবে</blockquote>`,
        rows);
    } finally {
      allocating.delete(uid);
    }
  }
  bot.action(/^np2_grab:([a-z0-9]+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery("⏳").catch(() => {});
    return allocate2(ctx, rangeNameByKey(ctx.match[1]));
  }));
  bot.action("np2_chg", safe(async (ctx) => {
    await ctx.answerCbQuery("🔄").catch(() => {});
    const uid = String(ctx.from.id);
    const last = lastNum2.get(uid);
    if (!last) return ctx.answerCbQuery("❌ আগে number নিন", { show_alert: true }).catch(() => {});
    for (const n of last.numbers) {                 // আগের নাম্বার ছেড়ে দিন (OTP না এলে) — অন্যরা নিতে পারবে
      if (pending2.get(n)?.userId === uid) { done2(n); lastLeased.set(n, Date.now()); }
    }
    return allocate2(ctx, last.range);
  }));

  /* ================================================================ */
  /*  LEADERBOARD / SEARCH / HISTORY                                   */
  /* ================================================================ */
  let lbCache = { at: 0, msg: "" };
  bot.action("np_lead", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await gate(ctx))) return;
    if (!lbCache.msg || Date.now() - lbCache.at > 120000) {
      const snap = await db.collection("users").orderBy("otpCount", "desc").limit(80).get();
      const list = snap.docs.map((x) => x.data()).filter((u) => !u.otpBanned && u.role !== "admin" && (Number(u.otpCount) || 0) > 0);
      let msg = `${head("🏆", "TOP 10 OTP MASTERS")}\n`;
      if (!list.length) msg += "❌ এখনো কোনো ইউজার OTP নেয়নি।";
      list.slice(0, 10).forEach((u, i) => {
        const medal = ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;
        msg += `\n${medal} <b>${esc(u.username)}</b>${u.telegramUsername ? ` @${esc(u.telegramUsername)}` : ""} — <b>${u.otpCount}</b> 🔑`;
      });
      if (list.length > 10) {
        msg += `\n\n${HR}\n✨ <b>TOP 11-50</b>\n`;
        list.slice(10, 50).forEach((u, i) => { msg += `\n${i + 11}. ${esc(u.username)} — <b>${u.otpCount}</b>`; });
      }
      lbCache = { at: Date.now(), msg };
    }
    return show(ctx, lbCache.msg, [back]);
  }));

  bot.action("np_search", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await gate(ctx))) return;
    return ask(ctx, { action: "np_search" }, `${head("🔍", "SEARCH OTP")}\nআপনার নাম্বারটি লিখে পাঠান\n\nবাতিল: /menu`, [back]);
  }));
  bot.action("np_hist", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await gate(ctx))) return;
    const snap = await userRef(ctx.from.id).collection("otp_logs").orderBy("at", "desc").limit(10).get();
    if (snap.empty) return ctx.answerCbQuery("❌ কোনো হিস্ট্রি নেই", { show_alert: true }).catch(() => {});
    let msg = `${head("📊", "LAST 10 OTP")}\n`;
    snap.docs.forEach((x, i) => {
      const o = x.data();
      msg += `\n<b>${i + 1}.</b> 📱 <code>${esc(o.number)}</code>\n     🔐 <code>${esc(o.otp)}</code> · 📩 ${esc(o.service || "OTP")} · +${tk(o.earned)}\n`;
    });
    return show(ctx, msg, [back]);
  }));

  /* ================================================================ */
  /*  OTP WITHDRAW                                                     */
  /* ================================================================ */
  const wdAmtText = (method, account, cfg, bal) =>
    `${head("💸", "WITHDRAW AMOUNT")}\n💳 <b>${METHODS[method]}</b> — <code>${esc(account)}</code>\n📱 OTP Balance: <b>${tk(bal)}</b>\n📉 Min: ${tk(cfg.minWithdraw)}\n\nকত টাকা তুলবেন? (শুধু সংখ্যা):`;
  const wdAmtKb = (method) => [[ib("✏️ নম্বর বদলান", `np_wdc:${method}`), ib("Cancel", "np_wd_no", "danger")]];

  bot.action("np_wd", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const u = await gate(ctx);
    if (!u) return;
    const [cfg, wcfg] = await Promise.all([getCfg(true), getWdConfig()]);
    if (!cfg.withdrawEnabled || !wcfg.withdrawEnabled) return show(ctx, "🔴 এখন OTP withdraw বন্ধ।", [back]);
    const cnt = Number(u.otpCount) || 0;
    const bal = Number(u.otpBalance) || 0;
    if (cnt < cfg.minOtp) return show(ctx, lockMsg(cfg, cnt), [back]);
    if (bal < cfg.minWithdraw) return show(ctx, `🔴 Minimum ${tk(cfg.minWithdraw)} দরকার। আছে ${tk(bal)}।`, [back]);
    const on = Object.keys(METHODS).filter((m) => wcfg.methods[m] !== false);
    if (!on.length) return show(ctx, "🔴 এখন কোনো payment method চালু নেই।", [back]);
    const rows = on.map((m) => {
      const n = u.wallets?.[m]?.number;
      return [ib(n ? `${METHODS[m]} — ${n}` : `${METHODS[m]} — নম্বর সেট করুন`, `np_wdp:${m}`, "primary")];
    });
    rows.push([ib("Cancel", "np_wd_no", "danger")]);
    return show(ctx, `${head("💸", "OTP WITHDRAW")}\n💰 OTP Balance: <b>${tk(bal)}</b>\n📉 Min: ${tk(cfg.minWithdraw)}\n\nকোন method-এ তুলবেন?`, rows);
  }));

  bot.action(/^np_wdp:(.+)$/, safe(async (ctx) => {
    const method = ctx.match[1];
    if (!METHODS[method]) return ctx.answerCbQuery("❌ method সঠিক নয়।", { show_alert: true });
    const u = await gate(ctx);
    if (!u) return;
    const [cfg, wcfg] = await Promise.all([getCfg(true), getWdConfig()]);
    if (!cfg.withdrawEnabled || !wcfg.withdrawEnabled) return ctx.answerCbQuery("🔴 withdraw বন্ধ।", { show_alert: true });
    if (wcfg.methods[method] === false) return ctx.answerCbQuery("🔴 এই method বন্ধ।", { show_alert: true });
    if ((Number(u.otpCount) || 0) < cfg.minOtp) return ctx.answerCbQuery(`🔒 আগে ${cfg.minOtp}টি OTP লাগবে`, { show_alert: true });
    await ctx.answerCbQuery().catch(() => {});
    const account = u.wallets?.[method]?.number;
    if (account) return ask(ctx, { action: "np_wd_amt", method, account }, wdAmtText(method, account, cfg, Number(u.otpBalance) || 0), wdAmtKb(method));
    return ask(ctx, { action: "np_wd_acc", method }, `${head("💳", METHODS[method].toUpperCase())}\n${accountPrompt(method)}`, [[ib("Cancel", "np_wd_no", "danger")]]);
  }));
  bot.action(/^np_wdc:(.+)$/, safe(async (ctx) => {
    const method = ctx.match[1];
    if (!METHODS[method]) return ctx.answerCbQuery("❌ method সঠিক নয়।", { show_alert: true });
    await ctx.answerCbQuery().catch(() => {});
    return ask(ctx, { action: "np_wd_acc", method }, `${head("✏️", METHODS[method].toUpperCase())}\nনতুন নম্বর\n\n${accountPrompt(method)}`, [[ib("Cancel", "np_wd_no", "danger")]]);
  }));
  bot.action("np_wd_no", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await clearSession(ctx.from.id);
    return show(ctx, "🔴 Withdraw বাতিল হয়েছে।", [back]);
  }));
  bot.action("np_wd_ok", safe(async (ctx) => {
    const s = await getSession(ctx.from.id);
    if (!s || s.action !== "np_wd_cf") return ctx.answerCbQuery("⚠️ সেশন শেষ। আবার শুরু করুন।", { show_alert: true });
    await ctx.answerCbQuery().catch(() => {});
    await clearSession(ctx.from.id);
    const { amount, method, account } = s;
    const [cfg, wcfg] = await Promise.all([getCfg(true), getWdConfig()]);
    if (!cfg.withdrawEnabled || !wcfg.withdrawEnabled) return show(ctx, "🔴 এখন withdraw বন্ধ।", [back]);
    if (wcfg.methods[method] === false) return show(ctx, "🔴 এই method এখন বন্ধ।", [back]);
    const uref = userRef(ctx.from.id);
    const wref = db.collection("withdrawals").doc(`${ctx.from.id}_otp_${Date.now()}`);
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(uref);
        if (!snap.exists) throw new Error("NO_USER");
        const u = snap.data();
        if (u.otpBanned) throw new Error("BANNED");
        if ((Number(u.otpCount) || 0) < cfg.minOtp) throw new Error("LOCKED");
        const bal = Number(u.otpBalance) || 0;
        if (bal < amount) throw new Error("LOW_BALANCE");
        tx.update(uref, { otpBalance: round2(bal - amount) });
        tx.set(wref, {
          userId: String(ctx.from.id), username: u.username, email: u.email || "", method, methodName: METHODS[method],
          amount, accountNum: account, balanceType: "otp", status: "pending", requestedAt: Timestamp.now(), source: "telegram_otp",
        });
      });
    } catch (e) {
      if (e.message === "LOW_BALANCE") return show(ctx, "🔴 যথেষ্ট OTP balance নেই।", [back]);
      if (e.message === "LOCKED") return show(ctx, "🔒 এখনো withdraw আনলক হয়নি।", [back]);
      if (e.message === "BANNED") return show(ctx, "🚫 আপনার Number Panel অ্যাক্সেস বন্ধ।", [back]);
      throw e;
    }
    return show(ctx, `${head("✅", "WITHDRAW SUBMITTED")}\n💰 ${tk(amount)}\n💳 ${method.toUpperCase()}\n📱 <code>${esc(account)}</code>\n\n🟡 Admin approve করার অপেক্ষায়।`, [back]);
  }));

  /* ================================================================ */
  /*  ADMIN                                                            */
  /* ================================================================ */
  const aBack = [ib("🏠 OTP Admin", "npa_home", "primary")];
  async function adminHome(ctx) {
    return show(ctx, `${head("📱", "OTP ADMIN PANEL")}\n<i>Withdraw approve/reject → মূল Admin Panel-এর 💸 Withdrawals থেকে।\nBroadcast → 📢 Broadcast থেকে।</i>`, [
      [ib("👥 Users", "npa_ul_0", "primary"), ib("⚙️ Settings", "npa_set", "primary")],
      [ib("📊 Stats", "npa_stats", "success"), ib("🎨 Customize", "npa_ui", "success")],
      [ib("🔢 OTP Digit (5 / 6+)", "npa_dg", "success"), ib("🌐 Bulk Rate", "npa_bulk", "danger")],
      [ib("📡 V2 (IVAS) Status", "npa_iv", "primary")],
    ]);
  }
  bot.hears(adminLabel, adminOnly(async (ctx) => adminHome(ctx)));
  bot.command("otpcfg", adminOnly(async (ctx) => adminHome(ctx)));
  const A = (re, fn) => bot.action(re, adminCb(async (ctx) => { await ctx.answerCbQuery().catch(() => {}); return fn(ctx); }));
  A("npa_home", (ctx) => adminHome(ctx));

  async function cfgScreen(ctx) {
    const c = await getCfg(true);
    const text =
      `${head("⚙️", "NUMBER PANEL SETTINGS")}\n💵 Per OTP: <b>৳${c.perOtp}</b>\n🔢 Min OTP (Withdraw): <b>${c.minOtp}</b>\n⬇️ Min Withdraw: <b>${tk(c.minWithdraw)}</b>\n` +
      `🎁 Refer: <b>৳${c.referComm}</b>\n🟢 Number Panel: <b>${c.enabled ? "ON" : "OFF"}</b>\n💸 OTP Withdraw: <b>${c.withdrawEnabled ? "ON" : "OFF"}</b>`;
    return show(ctx, text, [
      [ib(`💵 Per OTP (${c.perOtp})`, "npa_e_perOtp", "primary"), ib(`🔢 Min OTP (${c.minOtp})`, "npa_e_minOtp", "primary")],
      [ib(`⬇️ Min Withdraw (${c.minWithdraw})`, "npa_e_minWithdraw", "primary"), ib(`🎁 Refer (${c.referComm})`, "npa_e_referComm", "primary")],
      [ib(`Panel: ${c.enabled ? "ON ✅" : "OFF ❌"}`, "npa_t_enabled", c.enabled ? "success" : "danger")],
      [ib(`Withdraw: ${c.withdrawEnabled ? "ON ✅" : "OFF ❌"}`, "npa_t_withdrawEnabled", c.withdrawEnabled ? "success" : "danger")],
      [ib("🔢 OTP Digit Settings", "npa_dg", "primary")],
      aBack,
    ]);
  }
  const CFG_LABEL = { perOtp: "Per OTP Rate (৳)", minOtp: "Min OTP সংখ্যা", minWithdraw: "Min Withdraw (৳)", referComm: "Refer Commission (৳)" };
  A("npa_set", cfgScreen);
  A(/^npa_e_(perOtp|minOtp|minWithdraw|referComm)$/, (ctx) =>
    ask(ctx, { action: "npa_cfg", field: ctx.match[1] }, `${head("✏️", CFG_LABEL[ctx.match[1]])}\nনতুন মান (শুধু সংখ্যা)\nবাতিল: /menu`, [aBack]));
  A(/^npa_t_(enabled|withdrawEnabled|showUnknown)$/, async (ctx) => {
    const c = await getCfg(true);
    await saveCfg({ [ctx.match[1]]: !c[ctx.match[1]] });
    return ctx.match[1] === "showUnknown" ? digitScreen(ctx) : cfgScreen(ctx);
  });

  async function digitScreen(ctx) {
    const c = await getCfg(true);
    const items = await getRanges();
    const cnt = { short: 0, long: 0, both: 0, unknown: 0 };
    for (const i of items) cnt[classOf(i.range)]++;
    return show(ctx,
      `${head("🔢", "OTP DIGIT SETTINGS")}\nলাইভ রেঞ্জ: <b>${items.length}</b>\n• 5 Digit: <b>${cnt.short}</b>\n• 6+ Digit: <b>${cnt.long}</b>\n• মিশ্র: <b>${cnt.both}</b>\n• অজানা: <b>${cnt.unknown}</b>\n\n` +
      `অজানা রেঞ্জ দেখানো: <b>${c.showUnknown ? "ON ✅" : "OFF ❌"}</b>\n\n` +
      `<i>Facebook OTP থেকে নিজে শেখে। হাতে ঠিক করতে:</i>\n<code>/rangedigits 88017XXXX short</code>\n<code>/rangedigits country Cameroon long</code>`,
      [[ib(`অজানা: ${c.showUnknown ? "ON ✅" : "OFF ❌"}`, "npa_t_showUnknown", c.showUnknown ? "success" : "danger")],
       [ib("🔄 Refresh", "npa_dg", "primary")], [ib("⚙️ Settings", "npa_set", "primary"), aBack[0]]]);
  }
  A("npa_dg", digitScreen);

  bot.command("rangedigits", adminOnly(async (ctx) => {
    const p = ctx.message.text.trim().split(/\s+/).slice(1);
    const valid = ["short", "long", "both", "clear"];
    const normV = (v) => ({ "5": "short", "6": "long", "6+": "long" }[v] || v); // 5 = ৫ ডিজিট, 6 = ৬+ ডিজিট
    const usage = "⚠️ ব্যবহার:\n<code>/rangedigits 88017XXXX short</code>\n<code>/rangedigits country Cameroon long</code>\n\nমান: short (5) • long (6+) • both • clear";
    const apply = async (ranges, val) => {
      const patch = {};
      for (const r of ranges) {
        const k = rangeKey(r);
        if (val === "clear") { delete classOv[k]; patch[k] = FieldValue.delete(); }
        else { classOv[k] = val; patch[k] = val; }
      }
      await classRef.set(patch, { merge: true });
    };
    if (p[0] === "country") {
      const val = normV((p[p.length - 1] || "").toLowerCase());
      const name = p.slice(1, -1).join(" ").toLowerCase();
      if (!name || !valid.includes(val)) return ctx.reply(usage, { parse_mode: "HTML" });
      const items = (await getRanges()).filter((i) => String(i.country || "").toLowerCase() === name);
      if (!items.length) return ctx.reply("❌ কোনো লাইভ রেঞ্জ নেই।");
      await apply(items.map((i) => i.range), val);
      return ctx.reply(`✅ ${items.length}টি রেঞ্জ → ${val}`);
    }
    const range = (p[0] || "").toUpperCase();
    const val = normV((p[1] || "").toLowerCase());
    if (!range || !valid.includes(val)) return ctx.reply(usage, { parse_mode: "HTML" });
    await apply([range], val);
    return ctx.reply(`✅ ${range} → ${val}`);
  }));

  bot.command("dbgcountry", adminOnly(async (ctx) => {
    const p = ctx.message.text.trim().split(/\s+/).slice(1);
    if (!p.length) return ctx.reply("Usage: <code>/dbgcountry 2370000</code>", { parse_mode: "HTML" });
    const input = p.join(" ");
    const raw = detectCountry(input);
    return ctx.reply(
      `🧪 <b>detectCountry Debug</b>\n\nInput: <code>${esc(input)}</code>\n\nflag: <code>${esc(raw.flag)}</code>\nname: <code>${esc(raw.name)}</code>\ncode (phone): <code>${esc(raw.code)}</code>\niso: <code>${esc(raw.iso || "(empty)")}</code>`,
      { parse_mode: "HTML" });
  }));

  async function ivasScreen(ctx) {
    const free = ivNumbers.filter(isFree).length;
    const hits = [...hitMap2().values()].reduce((a, b) => a + b, 0);
    const ago = (t) => (t ? `${Math.round((Date.now() - t) / 1000)}s আগে` : "—");
    const base = process.env.RENDER_EXTERNAL_URL || "https://<আপনার-render-url>";
    return show(ctx,
      `${head("📡", "V2 · IVAS STATUS")}\n🔑 API key ▸ <b>${IVAS_KEY ? "✅ সেট আছে" : "❌ নেই"}</b>\n🪝 Webhook ▸ <b>${IVAS_SECRET ? "✅ secret সেট" : "❌ secret নেই"}</b>\n\n` +
      `📦 পুল ▸ <b>${ivNumbers.length}</b> • ফ্রি <b>${free}</b> • lease <b>${pending2.size}</b>\n🔥 hit (৩০ মি) ▸ <b>${hits}</b>\n\n` +
      `🔄 numbers sync ▸ ${ago(ivSt.numbersAt)}\n📨 messages poll ▸ ${ago(ivSt.msgAt)} (${ivSt.polls}বার)\n🪝 webhook ▸ ${ivSt.webhooks}টি, শেষ ${ago(ivSt.lastWebhookAt)}\n` +
      `📊 API call ▸ ${ivState.calls} • 429 ▸ ${ivState.limited}\n⚠️ শেষ error ▸ <code>${esc(ivState.lastErr || ivSt.lastHookErr || "নেই")}</code>\n\n` +
      `<blockquote>Webhook URL (IVAS → Webhooks পেজে দিন):\n<code>${esc(base)}/ivas-webhook</code>\nEvent: message.received</blockquote>`,
      [[ib("🔄 Refresh", "npa_iv", "primary"), ib("♻️ Numbers Sync", "npa_ivsync", "success")], aBack]);
  }
  A("npa_iv", ivasScreen);
  A("npa_ivsync", async (ctx) => { await syncIvasNumbers(); return ivasScreen(ctx); });
  bot.command("ivasstatus", adminOnly(async (ctx) => ivasScreen(ctx)));

  A("npa_stats", async (ctx) => {
    const [users, wds] = await Promise.all([
      db.collection("users").select("otpBalance", "otpCount", "otpBanned").get(),
      db.collection("withdrawals").where("status", "==", "pending").get(),
    ]);
    let active = 0, totalOtp = 0, totalBal = 0, banned = 0;
    users.forEach((x) => {
      const c = Number(x.get("otpCount")) || 0;
      if (c > 0) active++;
      totalOtp += c;
      totalBal += Number(x.get("otpBalance")) || 0;
      if (x.get("otpBanned")) banned++;
    });
    const otpWds = wds.docs.filter((x) => x.get("balanceType") === "otp");
    const pendAmt = otpWds.reduce((s, x) => s + (Number(x.get("amount")) || 0), 0);
    return show(ctx,
      `${head("📊", "OTP STATS")}\n👥 Active: <b>${active}</b> (🚫 ${banned})\n🔑 মোট OTP: <b>${totalOtp}</b>\n💰 মোট Balance: <b>${tk(totalBal)}</b>\n💸 Pending withdraw: <b>${otpWds.length}</b> (${tk(pendAmt)})\n⏳ Pending numbers: <b>V1 ${pending.size} • V2 ${pending2.size}</b>\n📡 IVAS পুল: <b>${ivNumbers.length}</b>\n🔄 Live views: <b>${activeViews.size}</b>`,
      [[ib("🔄 Refresh", "npa_stats", "primary")], aBack]);
  });

  const nm = (u) => String(u.username || "User").slice(0, 22) + (u.telegramUsername ? ` @${u.telegramUsername}` : "");
  async function usersView(ctx, page = 0, q = "") {
    const snap = await db.collection("users").select("username", "telegramUsername", "otpBalance", "otpCount", "otpBanned").get();
    let list = snap.docs.map((x) => ({ id: x.id, ...x.data() })).filter((u) => /^\d+$/.test(u.id));
    if (q) {
      const l = q.toLowerCase().replace(/^@/, "");
      list = list.filter((u) => u.id.includes(l) || String(u.username || "").toLowerCase().includes(l) || String(u.telegramUsername || "").toLowerCase().includes(l));
    }
    list.sort((a, b) => (Number(b.otpBalance) || 0) - (Number(a.otpBalance) || 0));
    const pg = paginate(list, page, PAGE);
    const slice = q ? list.slice(0, 10) : pg.items;
    const rows = slice.map((u) => [ib(`${u.otpBanned ? "🚫 " : ""}${nm(u)} · ${tk(u.otpBalance)} · ${u.otpCount || 0}`.slice(0, 60), `npa_u_${u.id}`, "primary")]);
    if (!q) rows.push(...navRow(pg, `npa_ul_${pg.page - 1}`, `npa_ul_${pg.page + 1}`));
    rows.push([ib("🔍 Search", "npa_us", "success"), aBack[0]]);
    const title = q ? `${head("🔍", "SEARCH")}\n<b>"${esc(q)}"</b> — ${list.length}টি` : `${head("👥", "USERS")}\nমোট <b>${list.length}</b> জন • OTP Balance অনুযায়ী`;
    return show(ctx, title, rows);
  }
  async function userView(ctx, id) {
    const u = await getUser(id);
    if (!u) return show(ctx, "❌ User পাওয়া যায়নি।", [[ib("⬅️ Users", "npa_ul_0", "primary")]]);
    const c = await getCfg();
    const text =
      `${head("👤", esc(nm(u)))}\n🆔 <code>${esc(id)}</code>\n\n📱 OTP Balance: <b>${tk(u.otpBalance)}</b>\n🔑 OTPs: <b>${Number(u.otpCount) || 0}</b>\n` +
      `💵 Rate: <b>${u.customPerOtp ?? "Global"}</b> (global ${c.perOtp})\n🎁 Refer: <b>${u.customReferComm ?? "Global"}</b> (global ${c.referComm})\n` +
      `🎁 Refer আয়: <b>${tk(u.otpReferEarning)}</b>\n📛 Panel: <b>${u.otpBanned ? "🚫 BANNED" : "✅ ACTIVE"}</b>\n💰 Task Balance: ${tk(u.balance)}`;
    return show(ctx, text, [
      [ib("➕ OTP Balance", `npa_uadd_${id}`, "success"), ib("➖ OTP Balance", `npa_urem_${id}`, "danger")],
      [ib("⚙️ Custom Rate", `npa_ucs_${id}`, "primary")],
      [ib(u.otpBanned ? "✅ Unban" : "🚫 Ban", `npa_ubn_${id}`, u.otpBanned ? "success" : "danger")],
      [ib("⬅️ Users", "npa_ul_0", "primary"), aBack[0]],
    ]);
  }
  A(/^npa_ul_(\d+)$/, (ctx) => usersView(ctx, Number(ctx.match[1])));
  A("npa_us", (ctx) => ask(ctx, { action: "npa_usearch" }, `${head("🔍", "USER SEARCH")}\nName / @username / ID লিখুন\n\nবাতিল: /menu`, [aBack]));
  A(/^npa_u_(\d+)$/, (ctx) => userView(ctx, ctx.match[1]));
  A(/^npa_uadd_(\d+)$/, (ctx) => ask(ctx, { action: "npa_ubal", op: "add", uid: ctx.match[1] }, "➕ কত ৳ যোগ করবেন? (সংখ্যা)\nবাতিল: /menu"));
  A(/^npa_urem_(\d+)$/, (ctx) => ask(ctx, { action: "npa_ubal", op: "rem", uid: ctx.match[1] }, "➖ কত ৳ কাটবেন? (সংখ্যা)\nবাতিল: /menu"));
  A(/^npa_ucs_(\d+)$/, (ctx) => ask(ctx, { action: "npa_ucust", uid: ctx.match[1], step: 1 }, `${head("⚙️", "CUSTOM RATE")}\n1️⃣ প্রতি OTP-তে কত ৳?\n<i>Global ফেরত দিতে <code>-</code> লিখুন</i>`));
  A(/^npa_ubn_(\d+)$/, async (ctx) => {
    const u = await getUser(ctx.match[1]);
    if (!u) return show(ctx, "❌ User পাওয়া যায়নি।", [aBack]);
    await userRef(ctx.match[1]).update({ otpBanned: !u.otpBanned });
    return userView(ctx, ctx.match[1]);
  });

  A("npa_bulk", (ctx) => ask(ctx, { action: "npa_bulk", step: 1 }, `${head("🌐", "সব USER-এর জন্য")}\n1️⃣ প্রতি OTP-তে কত ৳?`));
  A("npa_bulkok", async (ctx) => {
    const s = await getSession(ctx.from.id);
    if (!s || s.action !== "npa_bulk_cf") return show(ctx, "❌ Draft নেই।", [aBack]);
    await clearSession(ctx.from.id);
    const snap = await db.collection("users").select().get();
    await commitOps(snap.docs.map((x) => (b) => b.update(x.ref, { customPerOtp: s.perOtp, customReferComm: s.referComm })));
    return show(ctx, `✅ ${snap.size} জন User-এ প্রয়োগ হয়েছে।`, [aBack]);
  });

  /* ---- Customize ---- */
  A("npa_ui", (ctx) => show(ctx,
    `${head("🎨", "CUSTOMIZE")}\nবাটনের নাম, OTP মেসেজের emoji ও flag বদলান।\n💎 Premium emoji পাঠালেও চলবে।`,
    [
      [ib("🔘 বাটনের নাম", "npa_ll", "primary")],
      [ib("😀 Bot OTP Emoji", "npa_em_user", "success"), ib("😀 Group OTP Emoji", "npa_em_group", "success")],
      [ib("🏳️ Bot OTP Flags", "npa_fl_user_0", "success"), ib("🏳️ Group OTP Flags", "npa_fl_group_0", "success")],
      aBack,
    ]));
  const uiBack = ib("⬅️ Customize", "npa_ui", "primary");

  A("npa_ll", (ctx) => {
    const rows = Object.keys(LBL).map((k) => [ib(`${lab(k)}`.slice(0, 30) || k, `npa_lb_${k}`, "primary")]);
    rows.push([uiBack, aBack[0]]);
    return show(ctx, `${head("🔘", "বাটন")}\nযেটার নাম বদলাবেন সেটায় চাপুন`, rows);
  });
  async function labelView(ctx, key) {
    if (!LBL[key]) return;
    const hint = key === "g_copy" ? "\nℹ️ <code>{otp}</code> লিখলে OTP কোড বসবে।" : "";
    return show(ctx,
      `${head("🔘", "বাটন এডিট")}\nএখন: <b>${esc(lab(key))}</b>${ui.icons[key] ? " 💎" : ""}\n<i>ডিফল্ট: ${esc(LBL[key])}</i>${hint}`,
      [[ib("✏️ Edit", `npa_le_${key}`, "success"), ib("♻️ Reset", `npa_lr_${key}`, "danger")], [ib("⬅️ List", "npa_ll", "primary")]]);
  }
  A(/^npa_lb_([a-z_]+)$/, (ctx) => labelView(ctx, ctx.match[1]));
  A(/^npa_le_([a-z_]+)$/, (ctx) => ask(ctx, { action: "npa_lbl", key: ctx.match[1] },
    `${head("✏️", "নতুন নাম")}\n(সর্বোচ্চ ৪০ অক্ষর)\nএখন: <b>${esc(lab(ctx.match[1]))}</b>\n\n💎 শুরুতে premium emoji দিলে বাটনের আইকন হবে।`));
  A(/^npa_lr_([a-z_]+)$/, async (ctx) => { delete ui.labels[ctx.match[1]]; delete ui.icons[ctx.match[1]]; await saveUi(); return labelView(ctx, ctx.match[1]); });

  async function emojiView(ctx, scope) {
    let text = `${head("😀", SCOPES[scope])}\n`;
    for (const [slot, def] of Object.entries(EM)) text += `${def.label}: <b>${esc(describeEmoji(scope, slot))}</b>\n`;
    text += "\n💎 = premium emoji";
    const btns = Object.entries(EM).map(([slot, def]) => ib(`${def.label} ${describeEmoji(scope, slot).slice(0, 8)}`, `npa_ems_${scope}_${slot}`, "primary"));
    const rows = [];
    for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
    rows.push([ib("👁 Preview", `npa_emp_${scope}`, "success"), ib("♻️ সব Reset", `npa_emr_${scope}`, "danger")]);
    rows.push([uiBack, aBack[0]]);
    return show(ctx, text, rows);
  }
  A(/^npa_em_(user|group)$/, (ctx) => emojiView(ctx, ctx.match[1]));
  A(/^npa_ems_(user|group)_([a-z]+)$/, (ctx) => {
    const [, scope, slot] = ctx.match;
    if (!EM[slot]) return;
    const hint = slot === "head" ? "\n<code>random</code> অথবা দুইটা emoji space দিয়ে।\n" : "";
    return ask(ctx, { action: "npa_emo", scope, slot }, `${head("✏️", EM[slot].label)}\nএখন: <b>${esc(describeEmoji(scope, slot))}</b>\n${hint}\n💎 Premium চলবে। <code>reset</code> লিখলে ডিফল্ট।`);
  });
  A(/^npa_emr_(user|group)$/, async (ctx) => { ui.emoji[ctx.match[1]] = {}; await saveUi(); return emojiView(ctx, ctx.match[1]); });
  A(/^npa_emp_(user|group)$/, async (ctx) => {
    const scope = ctx.match[1];
    const html = buildOtpMessage(scope, { number: "237624324691", otp: "123456", service: "Facebook", full: "123456 is your Facebook code", country: "Cameroon", masked: scope === "group" });
    try { await sendRich(ctx.chat.id, html, buildOtpKeyboard(scope, "123456")); }
    catch (e) { await ctx.reply(`⚠️ Preview পাঠানো যায়নি: ${e.description || e.message}`); }
  });

  async function flagList(ctx, scope, page = 0, q = "") {
    const entries = COUNTRIES.map((c, idx) => ({ ...c, idx })).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
    const pg = paginate(entries, page, 10);
    const slice = q ? entries.slice(0, 12) : pg.items;
    const rows = slice.map((c) => [ib(`${c.name}   ${describeFlag(scope, c.name, c.flag)}   ✏️`, `npa_fle_${scope}_${c.idx}`, "primary")]);
    if (!q) rows.push(...navRow(pg, `npa_fl_${scope}_${pg.page - 1}`, `npa_fl_${scope}_${pg.page + 1}`));
    rows.push([ib("🔍 Search", `npa_fls_${scope}`, "success"), ib("♻️ সব Reset", `npa_flr_${scope}`, "danger")]);
    rows.push([uiBack, aBack[0]]);
    return show(ctx, `${head("🏳️", SCOPES[scope])}\nযেটার flag বদলাবেন সেটায় চাপুন • 💎 = premium`, rows);
  }
  A(/^npa_fl_(user|group)_(\d+)$/, (ctx) => flagList(ctx, ctx.match[1], Number(ctx.match[2])));
  A(/^npa_fls_(user|group)$/, (ctx) => ask(ctx, { action: "npa_flsearch", scope: ctx.match[1] }, `${head("🔍", "দেশ খুঁজুন")}\nদেশের নাম লিখুন (যেমন <code>tanz</code>)`));
  A(/^npa_flr_(user|group)$/, async (ctx) => { ui.flags[ctx.match[1]] = {}; await saveUi(); return flagList(ctx, ctx.match[1], 0); });
  A(/^npa_fle_(user|group)_(\d+)$/, (ctx) => {
    const [, scope, i] = ctx.match;
    const c = COUNTRIES[Number(i)];
    if (!c) return flagList(ctx, scope, 0);
    return ask(ctx, { action: "npa_flag", scope, idx: Number(i) }, `${head("🏳️", esc(c.name))}\nএখন: ${esc(describeFlag(scope, c.name, c.flag))} <i>(ডিফল্ট ${c.flag})</i>\n\nনতুন flag/emoji পাঠান — 💎 চলবে।\n<code>reset</code> লিখলে ডিফল্ট।`);
  });

  /* ================================================================ */
  /*  TEXT INPUT                                                       */
  /* ================================================================ */
  async function adminText(ctx, s, text) {
    const id = ctx.from.id;
    switch (s.action) {
      case "npa_usearch": await clearSession(id); return usersView(ctx, 0, text);
      case "npa_ubal": {
        const amt = num(text);
        if (!Number.isFinite(amt) || amt <= 0) return ctx.reply("⚠️ শুধু সংখ্যা লিখুন। যেমন: 100");
        const uref = userRef(s.uid);
        let after = 0;
        try {
          await db.runTransaction(async (tx) => {
            const sn = await tx.get(uref);
            if (!sn.exists) throw new Error("NO_USER");
            const bal = Number(sn.get("otpBalance")) || 0;
            const nb = s.op === "add" ? bal + amt : bal - amt;
            if (nb < 0) { const e = new Error("LOW"); e.bal = bal; throw e; }
            after = round2(nb);
            tx.update(uref, { otpBalance: after });
          });
        } catch (e) {
          await clearSession(id);
          if (e.message === "LOW") return ctx.reply(`🔴 ইউজারের OTP balance ${tk(e.bal)} — এর বেশি কাটা যাবে না।`);
          if (e.message === "NO_USER") return ctx.reply("❌ user পাওয়া যায়নি।");
          throw e;
        }
        await clearSession(id);
        await dm(s.uid, `📱 <b>OTP Balance আপডেট</b>\n\nAdmin আপনার OTP Balance-এ ${tk(amt)} ${s.op === "add" ? "যোগ করেছে" : "কেটে নিয়েছে"}।\nনতুন OTP Balance: ${tk(after)}`);
        return userView(ctx, s.uid);
      }
      case "npa_ucust": {
        const dash = text.trim() === "-";
        const v = dash ? null : num(text);
        if (!dash && (!Number.isFinite(v) || v < 0)) return ctx.reply("❌ সংখ্যা বা - লিখুন।");
        if (s.step === 1) {
          await setSession(id, { action: "npa_ucust", uid: s.uid, step: 2, perOtp: v });
          return ctx.reply("2️⃣ Refer commission কত ৳? (প্রতি OTP)\n<i>Global-এর জন্য <code>-</code></i>", { parse_mode: "HTML" });
        }
        await clearSession(id);
        await userRef(s.uid).update({ customPerOtp: s.perOtp ?? null, customReferComm: v });
        return userView(ctx, s.uid);
      }
      case "npa_cfg": {
        const v = num(text);
        if (!Number.isFinite(v) || v < 0) return ctx.reply("⚠️ সঠিক সংখ্যা লিখুন।");
        await saveCfg({ [s.field]: s.field === "minOtp" ? Math.floor(v) : v });
        await clearSession(id);
        return cfgScreen(ctx);
      }
      case "npa_bulk": {
        const v = num(text);
        if (!Number.isFinite(v) || v < 0) return ctx.reply("⚠️ সঠিক সংখ্যা লিখুন।");
        if (s.step === 1) {
          await setSession(id, { action: "npa_bulk", step: 2, perOtp: v });
          return ctx.reply("2️⃣ Refer commission কত ৳?");
        }
        await setSession(id, { action: "npa_bulk_cf", perOtp: s.perOtp, referComm: v });
        return show(ctx, `⚠️ <b>সব User-এ প্রয়োগ হবে</b>\n\n💵 Per OTP: <b>${s.perOtp}</b>\n🎁 Refer: <b>${v}</b>`,
          [[ib("✅ নিশ্চিত", "npa_bulkok", "danger"), ib("❌ বাতিল", "npa_home", "primary")]]);
      }
      case "npa_lbl": {
        const { text: v, icon } = parseLabel(ctx.message.text, ctx.message.entities || []);
        if (!v || v.length > 40) return ctx.reply("❌ নাম ১–৪০ অক্ষরের মধ্যে হতে হবে।");
        await clearSession(id);
        ui.labels[s.key] = v;
        if (icon) ui.icons[s.key] = icon; else delete ui.icons[s.key];
        await saveUi();
        return labelView(ctx, s.key);
      }
      case "npa_emo": {
        const r = await setEmoji(s.scope, s.slot, ctx.message.text, ctx.message.entities || []);
        if (r.error) return ctx.reply(`❌ ${r.error}`);
        await clearSession(id);
        return emojiView(ctx, s.scope);
      }
      case "npa_flsearch": await clearSession(id); return flagList(ctx, s.scope, 0, text);
      case "npa_flag": {
        const c = COUNTRIES[s.idx];
        if (!c) { await clearSession(id); return flagList(ctx, s.scope, 0); }
        const r = await setFlag(s.scope, c.name, ctx.message.text, ctx.message.entities || []);
        if (r.error) return ctx.reply(`❌ ${r.error}`);
        await clearSession(id);
        return flagList(ctx, s.scope, Math.floor(s.idx / 10));
      }
      default: return ctx.reply("☝️ উপরের বাটন ব্যবহার করুন। বাতিল: /menu");
    }
  }

  async function handleText(ctx, s, text) {
    const id = ctx.from.id;
    const uid = String(id);
    if (s.action.startsWith("npa_")) {
      if (!(await isAdmin(id))) { await clearSession(id); return; }
      return adminText(ctx, s, text);
    }
    switch (s.action) {
      case "np_range": {
        const r = text.replace(/\s/g, "").toUpperCase();
        if (!/^[0-9X]{4,20}$/.test(r)) return ctx.reply("❌ রেঞ্জ ঠিক নেই। শুধু সংখ্যা ও X দিন।\nExample: <code>88017XXXX</code>", { parse_mode: "HTML" });
        await clearSession(id);
        const info = detectCountry(r.replace(/X+$/i, "") + "0000");
        return allocate(ctx, r, "_custom", info.name || "Custom Range", "", true);
      }
      case "np_search": {
        const clean = bn2en(text).replace(/\D/g, "");
        if (clean.length < 5) return ctx.reply("❌ সঠিক নাম্বার দিন।");
        await clearSession(id);
        const snap = await userRef(id).collection("otp_logs").orderBy("at", "desc").limit(200).get();
        const own = snap.docs.map((x) => x.data()).filter((o) => String(o.number).includes(clean)).slice(0, 3);
        if (own.length) {
          let msg = `${head("✅", "পাওয়া গেছে")}\n`;
          own.forEach((o) => { msg += `\n📱 <code>${esc(o.number)}</code>\n🔐 <code>${esc(o.otp)}</code> · 📩 ${esc(o.service || "OTP")}\n`; });
          return show(ctx, msg, [back]);
        }
        const pm = userPendingAll(uid).find(([, v]) => String(v.number).includes(clean));
        if (pm) return show(ctx, `${head("⏳", "PENDING")}\n📱 <code>${esc(pm[1].number)}</code>\n\nOTP এখনো আসেনি।`, [back]);
        return show(ctx, `❌ <code>${esc(clean)}</code> — কোনো OTP পাওয়া যায়নি।`, [back]);
      }
      case "np_wd_acc": {
        const method = s.method;
        if (!METHODS[method]) return ctx.reply("⚠️ আবার শুরু করুন।");
        const acc = normAccount(method, text);
        if (!acc) return ctx.reply(method === "binance" ? "🔴 Binance ID কমপক্ষে ৪ অক্ষরের হতে হবে।" : "🔴 সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।");
        const u = await needUser(ctx);
        if (!u) return;
        const cfg = await getCfg(true);
        await userRef(id).update({ [`wallets.${method}.number`]: acc });
        await setSession(id, { action: "np_wd_amt", method, account: acc });
        return show(ctx, `✅ ${METHODS[method]} নম্বর সেভ হয়েছে।\n\n` + wdAmtText(method, acc, cfg, Number(u.otpBalance) || 0), wdAmtKb(method));
      }
      case "np_wd_amt": {
        const u = await gate(ctx);
        if (!u) return;
        const [cfg, wcfg] = await Promise.all([getCfg(true), getWdConfig()]);
        const amount = num(text);
        const bal = Number(u.otpBalance) || 0;
        if (!Number.isFinite(amount) || amount <= 0) return ctx.reply("⚠️ শুধু সংখ্যা লিখুন। যেমন: 100");
        if ((Number(u.otpCount) || 0) < cfg.minOtp) return ctx.reply(lockMsg(cfg, Number(u.otpCount) || 0), { parse_mode: "HTML" });
        if (amount < cfg.minWithdraw) return ctx.reply(`🔴 Minimum ${tk(cfg.minWithdraw)} তুলতে হবে।`);
        if (amount > bal) return ctx.reply(`🔴 যথেষ্ট OTP balance নেই। আছে ${tk(bal)}।`);
        if (!METHODS[s.method] || !s.account) return ctx.reply("⚠️ আবার শুরু করুন।");
        if (wcfg.methods[s.method] === false) return ctx.reply("🔴 এই method এখন বন্ধ।");
        await setSession(id, { action: "np_wd_cf", amount: round2(amount), method: s.method, account: s.account });
        return show(ctx,
          `${head("💸", "CONFIRM WITHDRAW")}\n💰 Amount: <b>${tk(amount)}</b>\n💳 Method: <b>${s.method.toUpperCase()}</b>\n📱 Account: <code>${esc(s.account)}</code>\n\n🟢 Confirm করলে OTP Balance থেকে কাটা হবে।`,
          [[ib("Confirm", "np_wd_ok", "success"), ib("Cancel", "np_wd_no", "danger")]]);
      }
      case "np_wd_cf":
        return ctx.reply("☝️ উপরের Confirm বা Cancel বাটন চাপুন। বাতিল: /menu");
      default:
        return ctx.reply("⚠️ /menu দিন।");
    }
  }

  /* ================================================================ */
  /*  OTP CREDIT                                                       */
  /* ================================================================ */
  async function credit({ number, otp, full, info, service: svcOverride }) {
    const service = svcOverride || detectService(full);
    const country = info?.country || "";

    if (info?.userId) {
      const cfg = await getCfg();
      const uref = userRef(info.userId);
      const snap = await uref.get();
      if (snap.exists) {
        const rate = Number(snap.get("customPerOtp")) || cfg.perOtp;
        const b = db.batch();
        b.update(uref, { otpBalance: FieldValue.increment(rate), otpCount: FieldValue.increment(1) });
        b.set(uref.collection("otp_logs").doc(), { number, otp, service, message: String(full || "").slice(0, 400), earned: rate, at: Timestamp.now() });
        const refId = snap.get("referredBy");
        if (refId && String(refId) !== String(info.userId)) {
          const rsnap = await userRef(refId).get();
          if (rsnap.exists && !rsnap.get("otpBanned")) {
            const comm = Number(rsnap.get("customReferComm")) || cfg.referComm;
            if (comm > 0) b.update(rsnap.ref, { otpBalance: FieldValue.increment(comm), otpReferEarning: FieldValue.increment(comm) });
          }
        }
        await b.commit(); // এরপর আর throw হবে না (claim ফেরত গেলে double-credit হত)
        bumpRange(info.range);
        if (isFbText(full) || service === "Facebook") learn(info.range, String(otp).replace(/\D/g, "").length);

        try {
          const cnt = (Number(snap.get("otpCount")) || 0) + 1;
          const left = Math.max(0, cfg.minOtp - cnt);
          const html = buildOtpMessage("user", { number, otp, service, full, country, masked: false });
          const extra = `\n\n${HR}\n💰 <b>+${tk(rate)}</b> (OTP Balance)\n🔑 মোট OTP: <b>${cnt}</b> / ${cfg.minOtp}${left ? ` • আর ${left}টি বাকি` : " • 🟢 Withdraw আনলক"}`;
          await sendRich(Number(info.userId), html + extra, buildOtpKeyboard("user", otp));
        } catch (e) { console.error("OTP DM failed:", e.description || e.message); }
      }
    }

    if (GROUP_ID) {
      (async () => {
        await wait(2000 + Math.random() * 2000);
        await sendRich(GROUP_ID, buildOtpMessage("group", { number, otp, service, full, country, masked: true }), buildOtpKeyboard("group", otp));
      })().catch((e) => console.error("group send:", e.description || e.message));
    }
  }

  /* ================================================================ */
  /*  POLLER                                                           */
  /* ================================================================ */
  let polling = false;
  async function poll() {
    if (polling || !pending.size) return;
    polling = true;
    try {
      const now = Date.now();
      for (const [n, v] of pending) if (now - v.allocatedAt > MAX_AGE) done(n);

      const data = await getSuccessOtp();
      const otps = data?.otps || [];
      for (const o of otps) {
        const oid = String(o.otp_id);
        if (seenOtps.has(oid)) continue;
        const num2 = String(o.number || "").replace(/\D/g, "");
        const info = pending.get(num2);
        if (!info) continue;
        try {
          await claimsCol.doc(oid).create({ number: num2, time: o.time, userId: info.userId });
        } catch (e) {
          if (e.code === 6) { seenOtps.add(oid); continue; }
          throw e;
        }
        seenOtps.add(oid);
        try {
          const otp = extractOtp(o.message);
          if (!otp) { await claimsCol.doc(oid).delete().catch(() => {}); seenOtps.delete(oid); continue; }
          await credit({ number: num2, otp, full: o.message, info });
          done(num2);
        } catch (e) {
          console.error("credit failed:", e.message);
          await claimsCol.doc(oid).delete().catch(() => {});
          seenOtps.delete(oid);
        }
      }
    } catch (e) { console.error("Poll error:", e.message); }
    finally { polling = false; }
  }

  /* ================================================================ */
  /*  START                                                            */
  /* ================================================================ */
  async function start() {
    if (!V_KEY) {
      console.error("❌ VOLTEX_API_KEY সেট করা নেই — Render → Environment-এ VOLTEX_API_KEY দিন।");
    } else {
      const test = await getLiveAccess();
      if (test?.services) console.log(`✅ Voltex API key OK (${test.services.length} services)`);
      else console.error("❌ Voltex API key কাজ করছে না / API সাড়া দিচ্ছে না।");
    }
    if (GROUP_RAW && !GROUP_ID) {
      console.error(`❌ FORWARD_GROUP_ID="${GROUP_RAW}" বোঝা যায়নি। সংখ্যা (-100…) অথবা পাবলিক @username দিন।`);
    } else if (GROUP_ID) {
      try {
        const ch = await bot.telegram.getChat(GROUP_ID);
        const me = await bot.telegram.getMe();
        const cm = await bot.telegram.getChatMember(GROUP_ID, me.id).catch(() => null);
        const okRole = cm && ["administrator", "creator", "member"].includes(cm.status);
        console.log(`${okRole ? "✅" : "⚠️"} OTP group: ${ch.title || ch.username} (${GROUP_ID}) — bot ${cm?.status || "নেই"}`);
      } catch (e) {
        console.error(`❌ OTP group-এ পৌঁছানো যাচ্ছে না (${GROUP_ID}): ${e.description || e.message}`);
      }
    }
    await loadUi();
    await loadDigits();
    await loadPending();
    await startV2();
    setInterval(poll, POLL_INTERVAL);
    setInterval(() => autoRefreshLoop().catch((e) => console.error("autoRefreshLoop:", e.message)), AUTO_REFRESH_MS);
    setInterval(() => syncDigits().catch((e) => console.error("syncDigits:", e.message)), 2 * 60 * 1000);
    setInterval(() => learnFromOtpFeed().catch((e) => console.error("learnFromOtpFeed:", e.message)), 2 * 60 * 1000);
    setTimeout(() => learnFromOtpFeed().catch(() => {}), 20000);
    setInterval(loadPending, 60 * 1000);
    setInterval(loadUi, 2 * 60 * 1000);
    console.log(`✅ Number Panel started (VOLTEX)${GROUP_ID ? ` → group ${GROUP_ID}` : ""} • auto-refresh ${AUTO_REFRESH_MS}ms`);
  }

  return { open, handleText, start, handleWebhook };
}
