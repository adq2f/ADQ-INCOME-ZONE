/*
 ============================================================================
  NUMBER PANEL MODULE v3 — VOLTEX SMS API (replaces MK Network)
 ============================================================================
  User: Get Number • Custom Range • Live Traffic • Leaderboard • Search • History • OTP Withdraw
  Admin: 📱 OTP Admin (Users • Settings • Stats • Bulk Rate • Customize)

  Render Environment:
    VOLTEX_API_KEY    = (বাধ্যতামূলক) Voltex API key (mauthapi header)
    FORWARD_GROUP_ID  = (ঐচ্ছিক) OTP group post
    CHANNEL_URL       = (ঐচ্ছিক) group post-এর JOIN CHANNEL লিংক
    GET_NUMBER_URL    = (ঐচ্ছিক) group post-এর Get Number লিংক
    POLL_INTERVAL     = (ঐচ্ছিক) default 6000
    MAX_PENDING       = (ঐচ্ছিক) default 20
 ============================================================================
*/
import axios from "axios";
import { detectCountry, COUNTRY_DATA } from "./country_flags.js";

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "6000");
const MAX_PENDING = parseInt(process.env.MAX_PENDING || "20");
const MAX_AGE = 16 * 60 * 1000;
const GROUP_ID = process.env.FORWARD_GROUP_ID || "";
const CHANNEL_URL = process.env.CHANNEL_URL || "";
const GET_NUMBER_URL = process.env.GET_NUMBER_URL || "";
const PAGE = 8;

/* ------------------------------------------------------------------ */
/*  VOLTEX API                                                         */
/* ------------------------------------------------------------------ */
const V_BASE = "https://api.2oo9.cloud/MXS47FLFX0U/tnevs/@public/api";
const V_KEY = (process.env.VOLTEX_API_KEY || "MMF2X6FDQ4I").trim();

const vc = axios.create({
  baseURL: V_BASE,
  headers: { mauthapi: V_KEY, "Content-Type": "application/json", Accept: "application/json" },
  timeout: 25000,
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function vreq(method, path, body, tries = 2) {
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
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */
function resolveCountry(name, number) {
  const n = String(name || "").trim();
  if (n && !/^(unknown|custom range)$/i.test(n)) {
    const d = detectCountry(n);
    if (d.code) return { flag: d.flag, name: d.name };
  }
  const digits = String(number || "").replace(/\D/g, "");
  if (digits) {
    const d2 = detectCountry(digits);
    if (d2.code) return { flag: d2.flag, name: d2.name };
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
  const money = (n) => round2(Number(n) || 0);

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

  /* ---------------- pending (by NUMBER now) ---------------- */
  const pending = new Map(); // number -> { userId, number, country, operator, range, allocatedAt }
  const pendCol = db.collection("voltex_pending_numbers");
  const claimsCol = db.collection("voltex_otp_claims");
  const seenOtps = new Set();
  const userPending = (uid) => [...pending.values()].filter((v) => v.userId === String(uid));

  function track(number, uid, country, operator, range) {
    const n = String(number).replace(/\D/g, "");
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
      cs.forEach((d) => seenOtps.add(d.id));
    } catch (e) { console.error("loadPending:", e.message); }
  }

  /* ---------------- live cache (services + ranges) ---------------- */
  let liveCache = { at: 0, services: [] };
  let consoleCache = { at: 0, hits: [] };

  async function getServices(force = false) {
    if (!force && Date.now() - liveCache.at < 15000 && liveCache.services.length) return liveCache.services;
    const data = await getLiveAccess();
    if (data?.services) liveCache = { at: Date.now(), services: data.services };
    return liveCache.services;
  }
  async function getConsoleHits(force = false) {
    if (!force && Date.now() - consoleCache.at < 15000 && consoleCache.hits.length) return consoleCache.hits;
    const data = await getConsoleFeed();
    if (data?.hits) consoleCache = { at: Date.now(), hits: data.hits };
    return consoleCache.hits;
  }
  function findService(sid) {
    return liveCache.services.find((s) => s.sid === sid);
  }
  function rangesOf(sid) {
    const svc = findService(sid);
    if (!svc) return [];
    return (svc.ranges || []).map((r) => {
      const base = String(r).replace(/X+$/i, "");
      const c = detectCountry(base + "0000");
      return { range: r, base, country: c.code ? c.name : "Unknown", flag: c.flag, code: c.code || "" };
    });
  }
  function groupByCountry(ranges) {
    const map = new Map();
    for (const r of ranges) {
      const key = r.country || "Unknown";
      if (!map.has(key)) map.set(key, { name: key, flag: r.flag, code: r.code, ranges: [] });
      map.get(key).ranges.push(r);
    }
    return [...map.values()].sort((a, b) => b.ranges.length - a.ranges.length);
  }
  async function topRangesForService(sid, limit = 10) {
    await getServices();
    await getConsoleHits(true);
    const ranges = rangesOf(sid);
    if (!ranges.length) return [];
    const hits = consoleCache.hits.filter((h) => (h.sid || "").toUpperCase() === sid.toUpperCase());
    const cmap = new Map();
    for (const h of hits) cmap.set(h.range, (cmap.get(h.range) || 0) + 1);
    return ranges.map((r) => ({ ...r, count: cmap.get(r.range) || 0 })).sort((a, b) => b.count - a.count).slice(0, limit);
  }

  /* ---------------- ui helpers ---------------- */
  const back = [ib("🔙 Number Panel", "np_home", "danger")];
  async function show(ctx, text, rows) {
    const render = (rs) => {
      const kb = Markup.inlineKeyboard(rs);
      return ctx.callbackQuery ? edit(ctx, text, kb) : ctx.reply(text, kbx(kb));
    };
    try { return await render(rows); }
    catch (e) {
      if (JSON.stringify(rows).includes("icon_custom_emoji_id")) return render(rows.map((r) => r.map(stripIcon)));
      throw e;
    }
  }
  const ask = async (ctx, session, text, rows = []) => { await setSession(ctx.from.id, session); return show(ctx, text, rows); };
  const lockMsg = (cfg, cnt) =>
    `🔒 OTP Balance withdraw করতে কমপক্ষে <b>${cfg.minOtp}টি</b> OTP রিসিভ করতে হবে।\nআপনার আছে: <b>${cnt}টি</b> (আর ${Math.max(0, cfg.minOtp - cnt)}টি বাকি)`;

  async function panelText(u) {
    const cfg = await getCfg();
    const cnt = Number(u.otpCount) || 0;
    const rate = Number(u.customPerOtp) || cfg.perOtp;
    const status = cnt >= cfg.minOtp ? "🟢 Withdraw আনলক হয়েছে" : `🔒 Withdraw আনলক হতে আর ${cfg.minOtp - cnt}টি OTP বাকি`;
    return (
      `📱 <b>NUMBER PANEL</b>\n\n💵 Rate: <b>৳${rate}</b> / OTP\n🔑 মোট OTP: <b>${cnt}</b> / ${cfg.minOtp}\n` +
      `💰 OTP Balance: <b>${tk(u.otpBalance)}</b>\n🎁 OTP Refer আয়: <b>${tk(u.otpReferEarning)}</b>\n${status}\n\n<i>OTP Balance আর Task Balance আলাদা।</i>`
    );
  }
  const panelRows = () => [
    [bt("p_get", { callback_data: "np_get", style: "success" }), bt("p_custom", { callback_data: "np_custom", style: "danger" })],
    [bt("p_traffic", { callback_data: "np_traffic", style: "primary" }), bt("p_lead", { callback_data: "np_lead", style: "success" })],
    [bt("p_search", { callback_data: "np_search", style: "primary" }), bt("p_hist", { callback_data: "np_hist", style: "primary" })],
    [bt("p_wd", { callback_data: "np_wd", style: "success" })],
  ];
  async function gate(ctx) {
    const u = await needUser(ctx);
    if (!u) return null;
    if (u.otpBanned) { await show(ctx, "🚫 আপনার Number Panel অ্যাক্সেস বন্ধ করা হয়েছে।", []); return null; }
    return u;
  }
  async function open(ctx) {
    const u = await gate(ctx);
    if (!u) return;
    await clearSession(ctx.from.id);
    return show(ctx, await panelText(u), panelRows());
  }
  bot.action("np_home", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const u = await gate(ctx);
    if (!u) return;
    await clearSession(ctx.from.id);
    return show(ctx, await panelText(u), panelRows());
  }));

  /* ================================================================ */
  /*  GET NUMBER: Service → Country → Ranges → Allocate                */
  /* ================================================================ */
  bot.action("np_get", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await gate(ctx))) return;
    const cfg = await getCfg();
    if (!cfg.enabled) return show(ctx, "🔴 Number Panel এখন বন্ধ আছে।", [back]);
    const services = await getServices(true);
    if (!services.length) return show(ctx, "❌ এখন কোনো সার্ভিস নেই, একটু পর চেষ্টা করুন।", [[ib("🔄 Retry", "np_get", "success")], back]);
    const sorted = [...services].sort((a, b) => (b.last_at || 0) - (a.last_at || 0));
    const btns = sorted
      .filter((s) => (s.ranges || []).length && Buffer.byteLength(`np_gsv:${s.sid}`) <= 64)
      .slice(0, 20)
      .map((s) => ib(`📱 ${s.sid} (${s.ranges.length})`, `np_gsv:${s.sid}`, "success"));
    const rows = [];
    for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
    rows.push([ib("🔄 Refresh", "np_get", "primary")]);
    rows.push(back);
    return show(ctx, "📱 <b>সার্ভিস সিলেক্ট করুন</b>\n\nযে সার্ভিসের জন্য নাম্বার নিতে চান সেটায় চাপুন:", rows);
  }));

  bot.action(/^np_gsv:(.+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery("⏳").catch(() => {});
    const sid = ctx.match[1];
    await getServices();
    const ranges = rangesOf(sid);
    if (!ranges.length) return show(ctx, "❌ এই সার্ভিসে এখন রেঞ্জ নেই।", [[ib("🔙 Services", "np_get", "danger")]]);
    const groups = groupByCountry(ranges);
    const btns = groups
      .filter((g) => Buffer.byteLength(`np_gc:${sid}:${g.code || "UNK"}`) <= 64)
      .map((g) => ib(`${g.flag} ${g.name} (${g.ranges.length})`, `np_gc:${sid}:${g.code || "UNK"}`, "success"));
    const rows = [];
    for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
    rows.push([ib("🔙 Services", "np_get", "primary"), back[0]]);
    return show(ctx, `🌍 <b>${esc(sid)}</b> — দেশ সিলেক্ট করুন`, rows);
  }));

  bot.action(/^np_gc:([^:]+):(.+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery("⏳").catch(() => {});
    const [, sid, code] = ctx.match;
    await getServices();
    const allRanges = rangesOf(sid);
    const filtered = code === "UNK" ? allRanges.filter((r) => !r.code) : allRanges.filter((r) => r.code === code);
    if (!filtered.length) return show(ctx, "❌ এই দেশে এখন রেঞ্জ নেই।", [[ib("🔙 Countries", `np_gsv:${sid}`, "danger")]]);
    await getConsoleHits(true);
    const cmap = new Map();
    for (const h of consoleCache.hits) cmap.set(h.range, (cmap.get(h.range) || 0) + 1);
    const sorted = filtered.map((r) => ({ ...r, count: cmap.get(r.range) || 0 })).sort((a, b) => b.count - a.count);
    const btns = sorted.slice(0, 15).map((r) => ib(`${r.flag} ${r.range}${r.count ? ` · ${r.count}🔥` : ""}`, `np_gr:${r.range}`, r.count > 0 ? "danger" : "success"));
    const rows = [];
    for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
    rows.push([ib("🔙 Countries", `np_gsv:${sid}`, "primary"), back[0]]);
    const cn = filtered[0].country || "Unknown";
    return show(ctx, `${filtered[0].flag} <b>${esc(cn)}</b> — রেঞ্জ সিলেক্ট করুন\n\nসর্বোচ্চ hit সব উপরে`, rows);
  }));

  bot.action(/^np_gr:(.+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery("⏳").catch(() => {});
    const range = ctx.match[1];
    const base = range.replace(/X+$/i, "");
    const c = detectCountry(base + "0000");
    return allocate(ctx, range, c.code ? c.name : "Unknown", "", false);
  }));

  /* ================================================================ */
  /*  LIVE TRAFFIC: Service → Top 10 ranges → Allocate                 */
  /* ================================================================ */
  bot.action("np_traffic", safe(async (ctx) => {
    await ctx.answerCbQuery("🔄").catch(() => {});
    if (!(await gate(ctx))) return;
    const services = await getServices(true);
    if (!services.length) return show(ctx, "❌ এখন কোনো ট্রাফিক ডেটা নেই।", [[ib("🔄 Retry", "np_traffic", "success")], back]);
    const sorted = [...services].sort((a, b) => (b.last_at || 0) - (a.last_at || 0));
    const btns = sorted
      .filter((s) => (s.ranges || []).length && Buffer.byteLength(`np_tsv:${s.sid}`) <= 64)
      .slice(0, 20)
      .map((s) => ib(`🔥 ${s.sid} (${s.ranges.length})`, `np_tsv:${s.sid}`, "danger"));
    const rows = [];
    for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
    rows.push([ib("🔄 Refresh", "np_traffic", "primary"), back[0]]);
    return show(ctx, "📈 <b>LIVE TRAFFIC</b>\n\nযে সার্ভিসের লাইভ রেঞ্জ দেখতে চান সেটায় চাপুন:", rows);
  }));

  bot.action(/^np_tsv:(.+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery("⏳").catch(() => {});
    const sid = ctx.match[1];
    const top = await topRangesForService(sid, 10);
    if (!top.length) return show(ctx, `❌ ${esc(sid)}-এ এখন কোনো রেঞ্জ নেই।`, [[ib("🔙 Traffic", "np_traffic", "danger")]]);
    let msg = `📈 <b>${esc(sid)} — TOP ${top.length} LIVE RANGES</b>\n\n`;
    top.forEach((r, i) => {
      msg += `${i < 3 ? "🔥" : "▫️"} <b>#${i + 1}</b> ${r.flag} <b>${esc(r.country)}</b>\n    <code>${esc(r.range)}</code>${r.count ? ` — <b>${r.count}</b> hit` : ""}\n`;
    });
    msg += "\n👇 রেঞ্জে চাপলেই নাম্বার allocate হবে";
    const btns = top.map((r, i) => ib(`#${i + 1} ${r.flag} ${r.country}`, `np_tr:${r.range}`, i < 3 ? "danger" : "success"));
    const rows = [];
    for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
    rows.push([ib("🔄 Refresh", `np_tsv:${sid}`, "primary"), ib("🔙 Traffic", "np_traffic", "primary")]);
    rows.push(back);
    return show(ctx, msg, rows);
  }));

  bot.action(/^np_tr:(.+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery("⏳").catch(() => {});
    const range = ctx.match[1];
    const base = range.replace(/X+$/i, "");
    const c = detectCountry(base + "0000");
    return allocate(ctx, range, c.code ? c.name : "Unknown", "", false);
  }));

  /* ================================================================ */
  /*  CUSTOM RANGE                                                     */
  /* ================================================================ */
  bot.action("np_custom", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await gate(ctx))) return;
    return ask(ctx, { action: "np_range" }, "⌨️ <b>Custom Range লিখুন</b>\n\nExample: <code>88017XXXX</code>\n\nবাতিল: /menu", [back]);
  }));

  /* ================================================================ */
  /*  ALLOCATE                                                         */
  /* ================================================================ */
  const allocating = new Set();
  const lastNum = new Map();

  async function allocate(ctx, rangeId, countryName = "Unknown", operatorName = "", isCustom = false) {
    const uid = String(ctx.from.id);
    if (!(await gate(ctx))) return;
    const cfg = await getCfg();
    if (!cfg.enabled) return show(ctx, "🔴 Number Panel এখন বন্ধ আছে।", [back]);
    if (!rangeId) return show(ctx, "❌ রেঞ্জ পাওয়া যায়নি।", [back]);
    if (allocating.has(uid)) { if (ctx.callbackQuery) ctx.answerCbQuery("⏳ অপেক্ষা করুন...").catch(() => {}); return; }
    if (userPending(uid).length >= MAX_PENDING) return show(ctx, "⚠️ অনেকগুলো নাম্বার pending আছে। OTP আসা বা মেয়াদ শেষ হওয়া পর্যন্ত অপেক্ষা করুন।", [back]);
    allocating.add(uid);
    try {
      const range = String(rangeId).trim().toUpperCase();
      await show(ctx, `⏳ <b>Allocating...</b>\nRange: <code>${esc(range)}</code>`, [back]);
      const res = await allocateNumber(range);
      if (!res.ok) {
        const outOfStock = res.err?.isOutOfStock || res.err?.code === 2946;
        const msg = outOfStock
          ? `❌ <b>Out of stock</b> <code>${esc(range)}</code>\n\nএই রেঞ্জে এখন নাম্বার নেই।`
          : `❌ Allocate failed <code>${esc(range)}</code>\n\n${esc(res.err?.message || "Unknown error")}`;
        return show(ctx, msg, [[ib("🔄 Try Again", isCustom ? "np_custom" : "np_get", "success")], back]);
      }
      const d = res.data || {};
      const full = String(d.no_plus_number || d.full_number || "").replace(/\D/g, "");
      if (!full) return show(ctx, "❌ নাম্বার পাওয়া যায়নি।", [[ib("🔄 Try Again", isCustom ? "np_custom" : "np_get", "success")], back]);
      const c = resolveCountry(d.country || countryName, full);
      track(full, uid, d.country || countryName, d.operator || operatorName, range);
      lastNum.set(uid, { range, name: countryName, operator: operatorName, isCustom });
      const rows = [[{ text: `${c.flag} ${full}`, copy_text: { text: full }, style: "success" }]];
      rows.push([ib("🔄 Change Number", "np_chg", "danger")]);
      rows.push([ib(isCustom ? "🔄 Change Custom Range" : "📱 Change Service", isCustom ? "np_custom" : "np_get", "primary")]);
      rows.push(back);
      return show(ctx, `${c.flag} <b>${esc(c.name.toUpperCase())} Allocated</b> ✅\n⏳ <b>OTP-র অপেক্ষায়...</b>\n\n👇 নাম্বারে ক্লিক করলেই কপি হবে:`, rows);
    } finally {
      allocating.delete(uid);
    }
  }
  bot.action("np_chg", safe(async (ctx) => {
    await ctx.answerCbQuery("🔄").catch(() => {});
    const last = lastNum.get(String(ctx.from.id));
    if (!last) return ctx.answerCbQuery("❌ আগে number নিন", { show_alert: true }).catch(() => {});
    return allocate(ctx, last.range, last.name, last.operator, last.isCustom);
  }));

  /* ================================================================ */
  /*  LEADERBOARD                                                      */
  /* ================================================================ */
  let lbCache = { at: 0, msg: "" };
  bot.action("np_lead", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await gate(ctx))) return;
    if (!lbCache.msg || Date.now() - lbCache.at > 120000) {
      const snap = await db.collection("users").orderBy("otpCount", "desc").limit(80).get();
      const list = snap.docs.map((x) => x.data()).filter((u) => !u.otpBanned && u.role !== "admin" && (Number(u.otpCount) || 0) > 0);
      let msg = "🏆 <b>TOP 10 OTP MASTERS</b> 🏆\n━━━━━━━━━━━━━━━━━━\n\n";
      if (!list.length) msg = "❌ এখনো কোনো ইউজার OTP নেয়নি।";
      list.slice(0, 10).forEach((u, i) => {
        const medal = ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;
        msg += `${medal} <b>${esc(u.username)}</b>${u.telegramUsername ? ` @${esc(u.telegramUsername)}` : ""}\n🔑 <b>${u.otpCount}</b>\n\n`;
      });
      if (list.length > 10) {
        msg += "━━━━━━━━━━━━━━━━━━\n✨ <b>TOP 11-50</b>\n\n";
        list.slice(10, 50).forEach((u, i) => { msg += `${i + 11}. ${esc(u.username)} — <b>${u.otpCount}</b>\n`; });
      }
      lbCache = { at: Date.now(), msg };
    }
    return show(ctx, lbCache.msg, [back]);
  }));

  /* ================================================================ */
  /*  SEARCH / HISTORY                                                 */
  /* ================================================================ */
  bot.action("np_search", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await gate(ctx))) return;
    return ask(ctx, { action: "np_search" }, "🔍 <b>Search OTP</b>\n\nআপনার নাম্বারটি লিখে পাঠান:\n\nবাতিল: /menu", [back]);
  }));
  bot.action("np_hist", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await gate(ctx))) return;
    const snap = await userRef(ctx.from.id).collection("otp_logs").orderBy("at", "desc").limit(10).get();
    if (snap.empty) return ctx.answerCbQuery("❌ কোনো হিস্ট্রি নেই", { show_alert: true }).catch(() => {});
    let msg = "📊 <b>Last 10 OTPs</b>\n\n";
    snap.docs.forEach((x) => {
      const o = x.data();
      msg += `📱 <code>${esc(o.number)}</code>\n🔐 <code>${esc(o.otp)}</code>\n📩 ${esc(o.service || "OTP")} | ${tk(o.earned)}\n\n`;
    });
    return show(ctx, msg, [back]);
  }));

  /* ================================================================ */
  /*  OTP BALANCE WITHDRAW                                             */
  /* ================================================================ */
  const wdAmtText = (method, account, cfg, bal) =>
    `💳 <b>${METHODS[method]}</b> — <code>${esc(account)}</code>\n\n📱 OTP Balance: ${tk(bal)}\n📉 Min: ${tk(cfg.minWithdraw)}\n\nকত টাকা তুলবেন? (শুধু সংখ্যা):`;
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
    return show(ctx, `💸 <b>OTP Balance Withdraw</b>\n\n💰 OTP Balance: ${tk(bal)}\n📉 Min: ${tk(cfg.minWithdraw)}\n\nকোন method-এ তুলবেন?`, rows);
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
    return ask(ctx, { action: "np_wd_acc", method }, `💳 <b>${METHODS[method]}</b>\n\n${accountPrompt(method)}`, [[ib("Cancel", "np_wd_no", "danger")]]);
  }));
  bot.action(/^np_wdc:(.+)$/, safe(async (ctx) => {
    const method = ctx.match[1];
    if (!METHODS[method]) return ctx.answerCbQuery("❌ method সঠিক নয়।", { show_alert: true });
    await ctx.answerCbQuery().catch(() => {});
    return ask(ctx, { action: "np_wd_acc", method }, `✏️ <b>${METHODS[method]}</b> — নতুন নম্বর\n\n${accountPrompt(method)}`, [[ib("Cancel", "np_wd_no", "danger")]]);
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
      if (e.message === "BANNED") return show(ctx, "🚫 আপনার Number Panel অ্যাক্সেস বন্ধ।", []);
      throw e;
    }
    return show(ctx, `✅ <b>OTP Withdraw Submitted</b>\n\n💰 ${tk(amount)}\n💳 ${method.toUpperCase()}\n📱 <code>${esc(account)}</code>\n\n🟡 Admin approve করার অপেক্ষায়।`, [back]);
  }));

  /* ================================================================ */
  /*  ADMIN: OTP Admin (mostly unchanged from original)                */
  /* ================================================================ */
  const aBack = [ib("🏠 OTP Admin", "npa_home", "primary")];
  async function adminHome(ctx) {
    return show(ctx, "📱 <b>OTP ADMIN PANEL</b>\n\n<i>Withdraw approve/reject → মূল Admin Panel-এর 💸 Withdrawals থেকে।\nBroadcast → 📢 Broadcast থেকে।</i>", [
      [ib("👥 Users", "npa_ul_0", "primary"), ib("⚙️ Settings", "npa_set", "primary")],
      [ib("📊 Stats", "npa_stats", "success"), ib("🎨 Customize", "npa_ui", "success")],
      [ib("🌐 সব User-এ Rate সেট", "npa_bulk", "danger")],
    ]);
  }
  bot.hears(adminLabel, adminOnly(async (ctx) => adminHome(ctx)));
  bot.command("otpcfg", adminOnly(async (ctx) => adminHome(ctx)));
  const A = (re, fn) => bot.action(re, adminCb(async (ctx) => { await ctx.answerCbQuery().catch(() => {}); return fn(ctx); }));
  A("npa_home", (ctx) => adminHome(ctx));

  async function cfgScreen(ctx) {
    const c = await getCfg(true);
    const text =
      `⚙️ <b>Number Panel Settings</b>\n\n💵 Per OTP: <b>৳${c.perOtp}</b>\n🔢 Withdraw-এর জন্য Min OTP: <b>${c.minOtp}</b>\n⬇️ Min Withdraw: <b>${tk(c.minWithdraw)}</b>\n` +
      `🎁 Refer Commission (প্রতি OTP): <b>৳${c.referComm}</b>\n🟢 Number Panel: <b>${c.enabled ? "ON" : "OFF"}</b>\n💸 OTP Withdraw: <b>${c.withdrawEnabled ? "ON" : "OFF"}</b>`;
    return show(ctx, text, [
      [ib(`💵 Per OTP (${c.perOtp})`, "npa_e_perOtp", "primary"), ib(`🔢 Min OTP (${c.minOtp})`, "npa_e_minOtp", "primary")],
      [ib(`⬇️ Min Withdraw (${c.minWithdraw})`, "npa_e_minWithdraw", "primary"), ib(`🎁 Refer (${c.referComm})`, "npa_e_referComm", "primary")],
      [ib(`Number Panel: ${c.enabled ? "ON ✅" : "OFF ❌"}`, "npa_t_enabled", c.enabled ? "success" : "danger")],
      [ib(`OTP Withdraw: ${c.withdrawEnabled ? "ON ✅" : "OFF ❌"}`, "npa_t_withdrawEnabled", c.withdrawEnabled ? "success" : "danger")],
      aBack,
    ]);
  }
  const CFG_LABEL = { perOtp: "Per OTP Rate (৳)", minOtp: "Withdraw-এর জন্য Minimum OTP সংখ্যা", minWithdraw: "Minimum Withdraw (৳)", referComm: "Refer Commission (৳ প্রতি OTP)" };
  A("npa_set", cfgScreen);
  A(/^npa_e_(perOtp|minOtp|minWithdraw|referComm)$/, (ctx) =>
    ask(ctx, { action: "npa_cfg", field: ctx.match[1] }, `✏️ <b>${CFG_LABEL[ctx.match[1]]}</b>\n\nনতুন মান লিখুন (শুধু সংখ্যা)\nবাতিল: /menu`, [aBack]));
  A(/^npa_t_(enabled|withdrawEnabled)$/, async (ctx) => {
    const c = await getCfg(true);
    await saveCfg({ [ctx.match[1]]: !c[ctx.match[1]] });
    return cfgScreen(ctx);
  });

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
      `📊 <b>OTP Stats</b>\n\n👥 OTP নেওয়া user: <b>${active}</b> (🚫 ${banned} banned)\n🔑 মোট OTP: <b>${totalOtp}</b>\n💰 Users-এর মোট OTP Balance: <b>${tk(totalBal)}</b>\n💸 Pending OTP withdraw: <b>${otpWds.length}</b> (${tk(pendAmt)})\n⏳ Waiting OTP numbers: <b>${pending.size}</b>`,
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
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    page = Math.min(Math.max(0, page), pages - 1);
    const slice = q ? list.slice(0, 10) : list.slice(page * PAGE, (page + 1) * PAGE);
    const rows = slice.map((u) => [ib(`${u.otpBanned ? "🚫 " : ""}${nm(u)} · ${tk(u.otpBalance)} · ${u.otpCount || 0} OTP`.slice(0, 60), `npa_u_${u.id}`, "primary")]);
    if (!q && pages > 1) {
      const navRow = [];
      if (page > 0) navRow.push(ib("⬅️ Prev", `npa_ul_${page - 1}`, "primary"));
      if (page < pages - 1) navRow.push(ib("Next ➡️", `npa_ul_${page + 1}`, "primary"));
      rows.push(navRow);
    }
    rows.push([ib("🔍 Search", "npa_us", "success"), aBack[0]]);
    const head = q ? `🔍 <b>"${esc(q)}"</b> — ${list.length} found` : `👥 <b>Users</b> (${list.length}) — ${page + 1}/${pages}`;
    return show(ctx, `${head}\n<i>OTP Balance অনুযায়ী সাজানো</i>`, rows);
  }
  async function userView(ctx, id) {
    const u = await getUser(id);
    if (!u) return show(ctx, "❌ User পাওয়া যায়নি।", [[ib("🔙 Users", "npa_ul_0", "primary")]]);
    const c = await getCfg();
    const text =
      `👤 <b>${esc(nm(u))}</b>\n🆔 <code>${esc(id)}</code>\n\n📱 OTP Balance: <b>${tk(u.otpBalance)}</b>\n🔑 OTPs: <b>${Number(u.otpCount) || 0}</b>\n` +
      `💵 Rate: <b>${u.customPerOtp ?? "Global"}</b> (global ${c.perOtp})\n🎁 Refer comm: <b>${u.customReferComm ?? "Global"}</b> (global ${c.referComm})\n` +
      `🎁 OTP Refer আয়: <b>${tk(u.otpReferEarning)}</b>\n📛 Number Panel: <b>${u.otpBanned ? "🚫 BANNED" : "✅ ACTIVE"}</b>\n💰 Task Balance: ${tk(u.balance)}`;
    return show(ctx, text, [
      [ib("➕ OTP Balance", `npa_uadd_${id}`, "success"), ib("➖ OTP Balance", `npa_urem_${id}`, "danger")],
      [ib("⚙️ Custom Rate", `npa_ucs_${id}`, "primary")],
      [ib(u.otpBanned ? "✅ Unban" : "🚫 Ban", `npa_ubn_${id}`, u.otpBanned ? "success" : "danger")],
      [ib("🔙 Users", "npa_ul_0", "primary"), aBack[0]],
    ]);
  }
  A(/^npa_ul_(\d+)$/, (ctx) => usersView(ctx, Number(ctx.match[1])));
  A("npa_us", (ctx) => ask(ctx, { action: "npa_usearch" }, "🔍 Name / @username / ID লিখুন:\n\nবাতিল: /menu", [aBack]));
  A(/^npa_u_(\d+)$/, (ctx) => userView(ctx, ctx.match[1]));
  A(/^npa_uadd_(\d+)$/, (ctx) => ask(ctx, { action: "npa_ubal", op: "add", uid: ctx.match[1] }, "➕ কত ৳ OTP Balance-এ যোগ করবেন? (সংখ্যা)\nবাতিল: /menu"));
  A(/^npa_urem_(\d+)$/, (ctx) => ask(ctx, { action: "npa_ubal", op: "rem", uid: ctx.match[1] }, "➖ কত ৳ OTP Balance থেকে কাটবেন? (সংখ্যা)\nবাতিল: /menu"));
  A(/^npa_ucs_(\d+)$/, (ctx) => ask(ctx, { action: "npa_ucust", uid: ctx.match[1], step: 1 }, "⚙️ <b>Custom Rate</b>\n\n1️⃣ প্রতি OTP-তে কত ৳?\n<i>Global ফেরত দিতে <code>-</code> লিখুন</i>"));
  A(/^npa_ubn_(\d+)$/, async (ctx) => {
    const u = await getUser(ctx.match[1]);
    if (!u) return show(ctx, "❌ User পাওয়া যায়নি।", [aBack]);
    await userRef(ctx.match[1]).update({ otpBanned: !u.otpBanned });
    return userView(ctx, ctx.match[1]);
  });

  A("npa_bulk", (ctx) => ask(ctx, { action: "npa_bulk", step: 1 }, "🌐 <b>সব User-এর জন্য</b>\n\n1️⃣ প্রতি OTP-তে কত ৳?"));
  A("npa_bulkok", async (ctx) => {
    const s = await getSession(ctx.from.id);
    if (!s || s.action !== "npa_bulk_cf") return show(ctx, "❌ Draft নেই।", [aBack]);
    await clearSession(ctx.from.id);
    const snap = await db.collection("users").select().get();
    await commitOps(snap.docs.map((x) => (b) => b.update(x.ref, { customPerOtp: s.perOtp, customReferComm: s.referComm })));
    return show(ctx, `✅ ${snap.size} জন User-এ প্রয়োগ হয়েছে।`, [aBack]);
  });

  A("npa_ui", (ctx) => show(ctx,
    "🎨 <b>Customize</b>\n\nবাটনের নাম, OTP মেসেজের emoji ও দেশের flag এখান থেকে বদলান।\n\n💎 <b>Premium emoji:</b> লেখার সময় Premium account থেকে premium emoji সহ মেসেজ পাঠান।",
    [
      [ib("🔘 বাটনের নাম", "npa_ll", "primary")],
      [ib("😀 Bot OTP Emoji", "npa_em_user", "success"), ib("😀 Group OTP Emoji", "npa_em_group", "success")],
      [ib("🏳️ Bot OTP Flags", "npa_fl_user_0", "success"), ib("🏳️ Group OTP Flags", "npa_fl_group_0", "success")],
      aBack,
    ]));
  const uiBack = ib("🔙 Customize", "npa_ui", "primary");

  A("npa_ll", (ctx) => {
    const rows = Object.keys(LBL).map((k) => [ib(`${lab(k)}`.slice(0, 30) || k, `npa_lb_${k}`, "primary")]);
    rows.push([uiBack, aBack[0]]);
    return show(ctx, "🔘 <b>বাটন</b>\n\nযেটার নাম বদলাবেন সেটায় চাপুন:\n<i>p_ = Number Panel বাটন, g_ = OTP মেসেজের নিচের বাটন</i>", rows);
  });
  async function labelView(ctx, key) {
    if (!LBL[key]) return;
    const hint = key === "g_copy" ? "\nℹ️ <code>{otp}</code> লিখলে সেখানে OTP কোড বসবে।" : "";
    return show(ctx,
      `🔘 <b>বাটন এডিট</b>\n\nএখন: <b>${esc(lab(key))}</b>${ui.icons[key] ? " 💎" : ""}\n<i>ডিফল্ট: ${esc(LBL[key])}</i>${hint}`,
      [[ib("✏️ Edit", `npa_le_${key}`, "success"), ib("♻️ Reset", `npa_lr_${key}`, "danger")], [ib("🔙 List", "npa_ll", "primary")]]);
  }
  A(/^npa_lb_([a-z_]+)$/, (ctx) => labelView(ctx, ctx.match[1]));
  A(/^npa_le_([a-z_]+)$/, (ctx) => ask(ctx, { action: "npa_lbl", key: ctx.match[1] },
    `✏️ <b>নতুন নাম লিখুন</b> (সর্বোচ্চ ৪০ অক্ষর)\n\nএখন: <b>${esc(lab(ctx.match[1]))}</b>\n\n💎 শুরুতে premium emoji দিলে সেটা বাটনের আইকন হবে।`));
  A(/^npa_lr_([a-z_]+)$/, async (ctx) => { delete ui.labels[ctx.match[1]]; delete ui.icons[ctx.match[1]]; await saveUi(); return labelView(ctx, ctx.match[1]); });

  async function emojiView(ctx, scope) {
    let text = `😀 <b>${SCOPES[scope]}</b>\n\n`;
    for (const [slot, def] of Object.entries(EM)) text += `${def.label}: <b>${esc(describeEmoji(scope, slot))}</b>\n`;
    text += "\n💎 = premium emoji আছে\nযেটা বদলাবেন সেটায় চাপুন:";
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
    const hint = slot === "head" ? "\n<code>random</code> অথবা দুইটা emoji space দিয়ে, যেমন <code>🔴 🟥</code>\n" : "";
    return ask(ctx, { action: "npa_emo", scope, slot }, `✏️ <b>${esc(EM[slot].label)}</b> — নতুন লিখুন\n\nএখন: <b>${esc(describeEmoji(scope, slot))}</b>\n${hint}\n💎 Premium emoji চলবে।\n<code>reset</code> লিখলে ডিফল্টে ফিরবে।`);
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
    const pages = Math.max(1, Math.ceil(entries.length / 10));
    page = Math.min(Math.max(0, page), pages - 1);
    const slice = q ? entries.slice(0, 12) : entries.slice(page * 10, (page + 1) * 10);
    const rows = slice.map((c) => [ib(`${c.name}   ${describeFlag(scope, c.name, c.flag)}   ✏️`, `npa_fle_${scope}_${c.idx}`, "primary")]);
    if (!q && pages > 1) {
      const navRow = [];
      if (page > 0) navRow.push(ib("⬅️ Prev", `npa_fl_${scope}_${page - 1}`, "primary"));
      if (page < pages - 1) navRow.push(ib("Next ➡️", `npa_fl_${scope}_${page + 1}`, "primary"));
      rows.push(navRow);
    }
    rows.push([ib("🔍 Search", `npa_fls_${scope}`, "success"), ib("♻️ সব Reset", `npa_flr_${scope}`, "danger")]);
    rows.push([uiBack, aBack[0]]);
    const head = q ? `🔍 "${esc(q)}" — ${entries.length} found` : `${page + 1}/${pages}`;
    return show(ctx, `🏳️ <b>${SCOPES[scope]} — Country Flags</b> (${head})\n\nযেটার flag বদলাবেন সেটায় চাপুন। 💎 = premium emoji`, rows);
  }
  A(/^npa_fl_(user|group)_(\d+)$/, (ctx) => flagList(ctx, ctx.match[1], Number(ctx.match[2])));
  A(/^npa_fls_(user|group)$/, (ctx) => ask(ctx, { action: "npa_flsearch", scope: ctx.match[1] }, "🔍 দেশের নাম লিখুন (যেমন <code>tanz</code>):"));
  A(/^npa_flr_(user|group)$/, async (ctx) => { ui.flags[ctx.match[1]] = {}; await saveUi(); return flagList(ctx, ctx.match[1], 0); });
  A(/^npa_fle_(user|group)_(\d+)$/, (ctx) => {
    const [, scope, i] = ctx.match;
    const c = COUNTRIES[Number(i)];
    if (!c) return flagList(ctx, scope, 0);
    return ask(ctx, { action: "npa_flag", scope, idx: Number(i) }, `🏳️ <b>${esc(c.name)}</b>\nএখন: ${esc(describeFlag(scope, c.name, c.flag))}   <i>(ডিফল্ট ${c.flag})</i>\n\nনতুন flag/emoji পাঠান — 💎 premium emoji-ও চলবে।\n<code>reset</code> লিখলে ডিফল্টে ফিরবে।`);
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
        if (!/^[0-9X]{4,25}$/.test(r)) return ctx.reply("❌ রেঞ্জ ঠিক নেই। শুধু সংখ্যা ও X দিন।\nExample: <code>88017XXXX</code>", { parse_mode: "HTML" });
        await clearSession(id);
        const base = r.replace(/X+$/i, "");
        const c = detectCountry(base + "0000");
        return allocate(ctx, r, c.code ? c.name : "Custom Range", "", true);
      }
      case "np_search": {
        const clean = bn2en(text).replace(/\D/g, "");
        if (clean.length < 5) return ctx.reply("❌ সঠিক নাম্বার দিন।");
        await clearSession(id);
        const snap = await userRef(id).collection("otp_logs").orderBy("at", "desc").limit(200).get();
        const own = snap.docs.map((x) => x.data()).filter((o) => String(o.number).includes(clean)).slice(0, 3);
        if (own.length) {
          let msg = "✅ <b>আপনার হিস্ট্রিতে পাওয়া গেছে!</b>\n\n";
          own.forEach((o) => { msg += `📱 <code>${esc(o.number)}</code>\n🔐 <code>${esc(o.otp)}</code>\n📩 ${esc(o.service || "OTP")}\n\n`; });
          return show(ctx, msg, [back]);
        }
        const pm = userPending(uid).find((v) => String(v.number).includes(clean));
        if (pm) return show(ctx, `⏳ <b>Pending number</b>\n\n📱 <code>${esc(pm.number)}</code>`, [back]);
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
          `💸 <b>Confirm OTP Withdraw</b>\n\n💰 Amount: ${tk(amount)}\n💳 Method: ${s.method.toUpperCase()}\n📱 Account: <code>${esc(s.account)}</code>\n\n🟢 Confirm করলে OTP Balance থেকে কাটা হবে।`,
          [[ib("Confirm", "np_wd_ok", "success"), ib("Cancel", "np_wd_no", "danger")]]);
      }
      case "np_wd_cf":
        return ctx.reply("☝️ উপরের Confirm বা Cancel বাটন চাপুন। বাতিল: /menu");
      default:
        return ctx.reply("⚠️ /menu দিন।");
    }
  }

  /* ================================================================ */
  /*  OTP POLLER — /success-otp                                    */
  /* ================================================================ */
  async function credit({ number, otp, full, info }) {
    const service = detectService(full);
    const country = info?.country || "";
    const c = resolveCountry(country, number);

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
        await b.commit();

        try {
          const cnt = (Number(snap.get("otpCount")) || 0) + 1;
          const left = Math.max(0, cfg.minOtp - cnt);
          const html = buildOtpMessage("user", { number, otp, service, full, country, masked: false });
          const extra = `\n\n💰 +${tk(rate)} (OTP Balance)\n🔢 মোট OTP: ${cnt}/${cfg.minOtp}${left ? ` • আর ${left}টি বাকি` : " • 🟢 Withdraw আনলক"}`;
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
        if (seenOtps.has(o.otp_id)) continue;
        const num = String(o.number || "").replace(/\D/g, "");
        const info = pending.get(num);
        if (!info) continue;

        try {
          await claimsCol.doc(o.otp_id).create({ number: num, time: o.time, userId: info.userId });
        } catch (e) {
          if (e.code === 6) { seenOtps.add(o.otp_id); continue; }
          throw e;
        }
        seenOtps.add(o.otp_id);

        try {
          const otp = extractOtp(o.message);
          if (!otp) { await claimsCol.doc(o.otp_id).delete().catch(() => {}); seenOtps.delete(o.otp_id); continue; }
          await credit({ number: num, otp, full: o.message, info });
          done(num);
        } catch (e) {
          console.error("credit failed:", e.message);
          await claimsCol.doc(o.otp_id).delete().catch(() => {});
          seenOtps.delete(o.otp_id);
        }
      }
    } catch (e) { console.error("Poll error:", e.message); }
    finally { polling = false; }
  }

  async function start() {
    if (!V_KEY) console.error("⚠️ VOLTEX_API_KEY সেট করা নেই — Number Panel কাজ করবে না।");
    await loadUi();
    await loadPending();
    setInterval(poll, POLL_INTERVAL);
    setInterval(loadPending, 60 * 1000);
    setInterval(loadUi, 2 * 60 * 1000);
    console.log(`✅ Number Panel started (VOLTEX)${GROUP_ID ? ` → group ${GROUP_ID}` : ""}`);
  }

  return { open, handleText, start };
}
