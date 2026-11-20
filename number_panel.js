/*
 ============================================================================
  NUMBER PANEL MODULE — ADQ Income Zone Task Bot-এর ভেতরে চলবে
  - আলাদা OTP Balance (users/{id}.otpBalance) — Task balance থেকে সম্পূর্ণ আলাদা
  - Withdraw আনলক হবে কমপক্ষে `minOtp` (default 100) OTP পাওয়ার পর
  - Per OTP rate / Min OTP / Min Withdraw — Admin Settings থেকে বদলানো যাবে
 ============================================================================
  Render Environment (এই module-এর জন্য):
    MKNETWORK_API_KEY = (বাধ্যতামূলক) MK Network API key
    FORWARD_GROUP_ID  = (ঐচ্ছিক) OTP পোস্ট যাবে যে group-এ
    CHANNEL_URL       = (ঐচ্ছিক) group post-এর "JOIN CHANNEL" বাটনের লিংক
    POLL_INTERVAL     = (ঐচ্ছিক) default 6000 (ms)
    MAX_PENDING       = (ঐচ্ছিক) প্রতি user সর্বোচ্চ pending number, default 20
 ============================================================================
*/
import axios from "axios";
import { detectCountry } from "./country_flags.js";

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "6000");
const MAX_PENDING = parseInt(process.env.MAX_PENDING || "20");
const MAX_AGE = 16 * 60 * 1000;
const GROUP_ID = process.env.FORWARD_GROUP_ID || "";
const CHANNEL_URL = process.env.CHANNEL_URL || "";

/* ------------------------------------------------------------------ */
/*  MK NETWORK API                                                     */
/* ------------------------------------------------------------------ */
const http = axios.create({ baseURL: "https://mknetworkbd.com/api/v3/public", timeout: 20000 });
const headers = () => ({ "mknetwork-key": process.env.MKNETWORK_API_KEY, "Content-Type": "application/json" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiReq(label, fn, tries = 2) {
  for (let i = 1; i <= tries; i++) {
    try {
      return (await fn()).data;
    } catch (err) {
      const st = err.response?.status;
      console.error(`❌ MK ${label} [${i}/${tries}]:`, st || "", err.message);
      const retriable = !st || st >= 500 || st === 429;
      if (!retriable || i === tries) return null;
      await wait(800 * i);
    }
  }
  return null;
}
const getAccessList = (limit = 500) => apiReq("access_list", () => http.get(`/access_list?limit=${limit}`, { headers: headers() }));
// allocate-এ retry নেই (ভুলে ২টা number নিয়ে ফেলতে পারে)
const allocateNumber = (range) =>
  apiReq(`allocate ${range}`, () => http.post("/getnum/number", { range }, { headers: headers() }), 1);
const checkStatus = (ids) => {
  const list = ids.map(Number).filter((n) => !isNaN(n));
  if (!list.length) return null;
  return apiReq("check_status", () => http.post("/check/status", { request_ids: list }, { headers: headers() }));
};

/* ------------------------------------------------------------------ */
/*  SMALL HELPERS                                                      */
/* ------------------------------------------------------------------ */
const RANGE_RE = /^\+?\d{3,}[xX*]{2,}$/;
function rangeOf(it) {
  if (!it || typeof it !== "object") return "";
  for (const k of ["range", "range_id", "rangeId", "prefix", "pattern", "name", "code", "access", "id"]) {
    const v = it[k];
    if (typeof v === "string" && RANGE_RE.test(v.trim())) return v.trim().toUpperCase();
  }
  for (const v of Object.values(it)) if (typeof v === "string" && RANGE_RE.test(v.trim())) return v.trim().toUpperCase();
  return "";
}

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
  return { flag: "🌐", name: n || "Unknown" };
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

/* ------------------------------------------------------------------ */
/*  FACTORY                                                            */
/* ------------------------------------------------------------------ */
export function createNumberPanel(d) {
  const {
    bot, db, FieldValue, Timestamp, Markup, ib, kbx, edit, esc, tk, round2, bn2en, METHODS,
    userRef, needUser, isAdmin, getWdConfig, normAccount, accountPrompt,
    setSession, clearSession, safe, adminOnly, adminCb,
  } = d;

  /* ---- config (Admin Settings) : settings/otp_config ---- */
  const cfgRef = db.collection("settings").doc("otp_config");
  let cfgCache = { at: 0, v: null };
  async function getCfg(force = false) {
    if (!force && cfgCache.v && Date.now() - cfgCache.at < 20000) return cfgCache.v;
    const s = await cfgRef.get();
    const x = s.exists ? s.data() : {};
    const v = {
      perOtp: Number(x.perOtp ?? 0.25),
      minOtp: Number(x.minOtp ?? 100),
      minWithdraw: Number(x.minWithdraw ?? 50),
      enabled: x.enabled !== false,
      withdrawEnabled: x.withdrawEnabled !== false,
    };
    cfgCache = { at: Date.now(), v };
    return v;
  }
  const saveCfg = async (patch) => {
    await cfgRef.set(patch, { merge: true });
    cfgCache.at = 0;
  };

  /* ---- pending requests (memory + Firestore, restart-safe) ---- */
  const pending = new Map();
  const pendCol = db.collection("pending_requests");
  const userPending = (uid) => [...pending.entries()].filter(([, v]) => v.userId === uid);
  function track(rid, uid, number, country, operator, range, expiresAt) {
    const id = String(rid);
    const v = {
      userId: String(uid), number: String(number), country: country || "Unknown", operator: operator || "",
      range: range || "", allocatedAt: Date.now(), expiresAt: expiresAt || null,
    };
    pending.set(id, v);
    pendCol.doc(id).set(v).catch((e) => console.error("persist pending:", e.message));
  }
  function done(rid) {
    pending.delete(String(rid));
    pendCol.doc(String(rid)).delete().catch(() => {});
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
    } catch (e) {
      console.error("loadPending:", e.message);
    }
  }

  /* ---- ranges ---- */
  let rangeCache = { at: 0, items: [] };
  async function getRanges() {
    if (Date.now() - rangeCache.at < 15000 && rangeCache.items.length) return rangeCache.items;
    const res = await getAccessList(500);
    const raw = res?.data?.items;
    if (Array.isArray(raw) && raw.length) {
      const items = raw.map((i) => ({ ...i, range: rangeOf(i) })).filter((i) => i.range);
      if (items.length) rangeCache = { at: Date.now(), items };
      else console.error("❌ access_list-এ range পাওয়া যায়নি:", JSON.stringify(raw[0]).slice(0, 300));
    }
    return rangeCache.items;
  }

  /* ---- ui helpers ---- */
  const back = [ib("🔙 Number Panel", "np_home", "danger")];
  const show = async (ctx, text, rows) => {
    const kb = Markup.inlineKeyboard(rows);
    if (ctx.callbackQuery) return edit(ctx, text, kb);
    return ctx.reply(text, kbx(kb));
  };
  const lockMsg = (cfg, cnt) =>
    `🔒 OTP Balance withdraw করতে কমপক্ষে <b>${cfg.minOtp}টি</b> OTP রিসিভ করতে হবে।\nআপনার আছে: <b>${cnt}টি</b> (আর ${Math.max(0, cfg.minOtp - cnt)}টি বাকি)`;

  async function panelText(u) {
    const cfg = await getCfg();
    const cnt = Number(u.otpCount) || 0;
    const status = cnt >= cfg.minOtp ? "🟢 Withdraw আনলক হয়েছে" : `🔒 Withdraw আনলক হতে আর ${cfg.minOtp - cnt}টি OTP বাকি`;
    return (
      `📱 <b>NUMBER PANEL</b>\n\n` +
      `💵 Rate: <b>৳${cfg.perOtp}</b> / OTP\n` +
      `🔑 মোট OTP: <b>${cnt}</b> / ${cfg.minOtp}\n` +
      `💰 OTP Balance: <b>${tk(u.otpBalance)}</b>\n${status}\n\n` +
      `<i>OTP Balance আর Task Balance আলাদা।</i>`
    );
  }
  const panelRows = () => [
    [ib("📞 Get Number", "np_get", "success"), ib("🔥 Custom Range", "np_custom", "danger")],
    [ib("🔍 Search OTP", "np_search", "primary"), ib("📊 History", "np_hist", "primary")],
    [ib("💸 OTP Balance Withdraw", "np_wd", "success")],
  ];

  async function open(ctx) {
    const u = await needUser(ctx);
    if (!u) return;
    await clearSession(ctx.from.id);
    return show(ctx, await panelText(u), panelRows());
  }

  bot.action("np_home", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const u = await needUser(ctx);
    if (!u) return;
    await clearSession(ctx.from.id);
    return show(ctx, await panelText(u), panelRows());
  }));

  /* ---------------------------------------------------------------- */
  /*  GET NUMBER                                                       */
  /* ---------------------------------------------------------------- */
  bot.action("np_get", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const cfg = await getCfg();
    if (!cfg.enabled) return show(ctx, "🔴 Number Panel এখন বন্ধ আছে।", [back]);
    const items = await getRanges();
    if (!items.length) {
      return show(ctx, "❌ এখন কোনো লাইভ রেঞ্জ নেই, একটু পর চেষ্টা করুন।", [[ib("🔄 Retry", "np_get", "success")], back]);
    }
    const groups = new Map();
    for (const it of items) {
      const c = it.country || "Unknown";
      groups.set(c, (groups.get(c) || 0) + 1);
    }
    const buttons = [...groups.entries()]
      .sort((a, b) => b[1] - a[1])
      .filter(([c]) => Buffer.byteLength(`np_c:${c}`) <= 64)
      .map(([c, n]) => ib(`${flagOf(c)} ${c} (${n})`, `np_c:${c}`, "success"));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    rows.push(back);
    return show(ctx, "🌍 <b>দেশ সিলেক্ট করুন</b>", rows);
  }));

  bot.action(/^np_c:(.+)$/, safe(async (ctx) => {
    await ctx.answerCbQuery("⏳").catch(() => {});
    const country = ctx.match[1];
    const items = (await getRanges()).filter((i) => i.country === country);
    if (!items.length) return show(ctx, "❌ এই দেশে এখন কোনো রেঞ্জ নেই।", [[ib("🔙 Back", "np_get", "danger")]]);
    const ex = items.filter((r) => r.health === "excellent");
    const gd = items.filter((r) => r.health === "good");
    const pool = ex.length ? ex : gd.length ? gd : items;
    const p = pool[Math.floor(Math.random() * pool.length)];
    return allocate(ctx, p.range, country, p.operator || "", false);
  }));

  bot.action("np_custom", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await setSession(ctx.from.id, { action: "np_range" });
    return show(ctx, "⌨️ <b>Custom Range লিখুন</b>\n\nExample: <code>88017XXXX</code>\n\nবাতিল: /menu", [back]);
  }));

  const allocating = new Set();
  const lastNum = new Map();

  async function grabNumbers(range, want = 2) {
    const got = [];
    const seenNums = new Set();
    for (let round = 0; round < 4 && got.length < want; round++) {
      const results = await Promise.all(Array.from({ length: want - got.length }, () => allocateNumber(range)));
      for (const res of results) {
        const x = res?.data;
        if (!x?.number || !x?.request_id) continue;
        const full = String(x.full_number || x.number).replace(/\D/g, "");
        if (full && !seenNums.has(full)) {
          seenNums.add(full);
          got.push({ requestId: x.request_id, number: full, country: x.country, operator: x.operator, expiresAt: x.expires_at });
        }
      }
    }
    return got;
  }

  async function allocate(ctx, rangeId, countryName = "Unknown", operatorName = "", isCustom = false) {
    const uid = String(ctx.from.id);
    const cfg = await getCfg();
    if (!cfg.enabled) return show(ctx, "🔴 Number Panel এখন বন্ধ আছে।", [back]);
    if (!rangeId) return show(ctx, "❌ রেঞ্জ পাওয়া যায়নি, আবার চেষ্টা করুন।", [back]);
    if (allocating.has(uid)) {
      if (ctx.callbackQuery) ctx.answerCbQuery("⏳ অপেক্ষা করুন...").catch(() => {});
      return;
    }
    if (userPending(uid).length >= MAX_PENDING) {
      return show(ctx, "⚠️ অনেকগুলো নাম্বার pending আছে। কিছু OTP আসা বা মেয়াদ শেষ হওয়া পর্যন্ত অপেক্ষা করুন।", [back]);
    }
    allocating.add(uid);
    try {
      const range = String(rangeId).trim().toUpperCase();
      await show(ctx, `⏳ <b>Allocating...</b>\nRange: <code>${esc(range)}</code>`, [back]);
      const picked = await grabNumbers(range, 2);
      if (!picked.length) {
        return show(ctx, `❌ <b>Allocate করা যায়নি</b> <code>${esc(range)}</code>\n\nএই রেঞ্জে এখন নাম্বার নেই।`, [
          [ib("🔄 Try Again", isCustom ? "np_custom" : "np_get", "success")],
          back,
        ]);
      }
      for (const p of picked) track(p.requestId, uid, p.number, p.country || countryName, p.operator || operatorName, range, p.expiresAt);
      const c = resolveCountry(picked[0].country || (isCustom ? "" : countryName), picked[0].number);
      lastNum.set(uid, { range, name: countryName, operator: operatorName, isCustom });

      const rows = picked.map((p) => [{ text: `${c.flag} ${p.number}`, copy_text: { text: p.number }, style: "success" }]);
      rows.push([ib("🔄 Change Number", "np_chg", "danger")]);
      rows.push([ib(isCustom ? "🔄 Change Custom Range" : "🌍 Change Country", isCustom ? "np_custom" : "np_get", "primary")]);
      rows.push(back);
      return show(
        ctx,
        `${c.flag} <b>${esc(c.name.toUpperCase())} Allocated</b> ✅\n⏳ <b>OTP-র অপেক্ষায়...</b>\n\n👇 নাম্বারে ক্লিক করলেই কপি হবে:`,
        rows
      );
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

  /* ---------------------------------------------------------------- */
  /*  SEARCH / HISTORY                                                 */
  /* ---------------------------------------------------------------- */
  bot.action("np_search", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await setSession(ctx.from.id, { action: "np_search" });
    return show(ctx, "🔍 <b>Search OTP</b>\n\nআপনার নাম্বারটি লিখে পাঠান:\n\nবাতিল: /menu", [back]);
  }));

  bot.action("np_hist", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const snap = await userRef(ctx.from.id).collection("otp_logs").orderBy("at", "desc").limit(10).get();
    if (snap.empty) return ctx.answerCbQuery("❌ কোনো হিস্ট্রি নেই", { show_alert: true }).catch(() => {});
    let msg = "📊 <b>Last 10 OTPs</b>\n\n";
    snap.docs.forEach((x) => {
      const o = x.data();
      msg += `📱 <code>${esc(o.number)}</code>\n🔐 <code>${esc(o.otp)}</code>\n📩 ${esc(o.service || "OTP")} | ${tk(o.earned)}\n\n`;
    });
    return show(ctx, msg, [back]);
  }));

  /* ---------------------------------------------------------------- */
  /*  OTP BALANCE WITHDRAW  (users.otpBalance → withdrawals)           */
  /* ---------------------------------------------------------------- */
  const wdAmtText = (method, account, cfg, bal) =>
    `💳 <b>${METHODS[method]}</b> — <code>${esc(account)}</code>\n\n📱 OTP Balance: ${tk(bal)}\n📉 Min: ${tk(cfg.minWithdraw)}\n\nকত টাকা তুলবেন? (শুধু সংখ্যা):`;
  const wdAmtKb = (method) => [[ib("✏️ নম্বর বদলান", `np_wdc:${method}`), ib("Cancel", "np_wd_no", "danger")]];

  bot.action("np_wd", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const u = await needUser(ctx);
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
    const u = await needUser(ctx);
    if (!u) return;
    const [cfg, wcfg] = await Promise.all([getCfg(true), getWdConfig()]);
    if (!cfg.withdrawEnabled || !wcfg.withdrawEnabled) return ctx.answerCbQuery("🔴 withdraw বন্ধ।", { show_alert: true });
    if (wcfg.methods[method] === false) return ctx.answerCbQuery("🔴 এই method বন্ধ।", { show_alert: true });
    if ((Number(u.otpCount) || 0) < cfg.minOtp) return ctx.answerCbQuery(`🔒 আগে ${cfg.minOtp}টি OTP লাগবে`, { show_alert: true });
    await ctx.answerCbQuery().catch(() => {});
    const account = u.wallets?.[method]?.number;
    if (account) {
      await setSession(ctx.from.id, { action: "np_wd_amt", method, account });
      return show(ctx, wdAmtText(method, account, cfg, Number(u.otpBalance) || 0), wdAmtKb(method));
    }
    await setSession(ctx.from.id, { action: "np_wd_acc", method });
    return show(ctx, `💳 <b>${METHODS[method]}</b>\n\n${accountPrompt(method)}`, [[ib("Cancel", "np_wd_no", "danger")]]);
  }));

  bot.action(/^np_wdc:(.+)$/, safe(async (ctx) => {
    const method = ctx.match[1];
    if (!METHODS[method]) return ctx.answerCbQuery("❌ method সঠিক নয়।", { show_alert: true });
    await ctx.answerCbQuery().catch(() => {});
    await setSession(ctx.from.id, { action: "np_wd_acc", method });
    return show(ctx, `✏️ <b>${METHODS[method]}</b> — নতুন নম্বর\n\n${accountPrompt(method)}`, [[ib("Cancel", "np_wd_no", "danger")]]);
  }));

  bot.action("np_wd_no", safe(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await clearSession(ctx.from.id);
    return show(ctx, "🔴 Withdraw বাতিল হয়েছে।", [back]);
  }));

  bot.action("np_wd_ok", safe(async (ctx) => {
    const s = await (async () => {
      const x = await db.collection("telegram_sessions").doc(String(ctx.from.id)).get();
      return x.exists ? x.data() : null;
    })();
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
        if ((Number(u.otpCount) || 0) < cfg.minOtp) throw new Error("LOCKED");
        const bal = Number(u.otpBalance) || 0;
        if (bal < amount) throw new Error("LOW_BALANCE");
        tx.update(uref, { otpBalance: round2(bal - amount) });
        tx.set(wref, {
          userId: String(ctx.from.id), username: u.username, email: u.email || "",
          method, methodName: METHODS[method], amount, accountNum: account,
          balanceType: "otp", // ← reject হলে otpBalance-এ ফেরত যাবে
          status: "pending", requestedAt: Timestamp.now(), source: "telegram_otp",
        });
      });
    } catch (e) {
      if (e.message === "LOW_BALANCE") return show(ctx, "🔴 যথেষ্ট OTP balance নেই।", [back]);
      if (e.message === "LOCKED") return show(ctx, "🔒 এখনো withdraw আনলক হয়নি।", [back]);
      throw e;
    }
    return show(ctx, `✅ <b>OTP Withdraw Submitted</b>\n\n💰 ${tk(amount)}\n💳 ${method.toUpperCase()}\n📱 <code>${esc(account)}</code>\n\n🟡 Admin approve করার অপেক্ষায়।`, [back]);
  }));

  /* ---------------------------------------------------------------- */
  /*  ADMIN SETTINGS                                                   */
  /* ---------------------------------------------------------------- */
  async function cfgScreen(ctx) {
    const c = await getCfg(true);
    const text =
      `📱 <b>Number Panel Settings</b>\n\n💵 Per OTP: <b>৳${c.perOtp}</b>\n🔢 Withdraw-এর জন্য Min OTP: <b>${c.minOtp}</b>\n` +
      `⬇️ Min Withdraw: <b>${tk(c.minWithdraw)}</b>\n🟢 Number Panel: <b>${c.enabled ? "ON" : "OFF"}</b>\n💸 OTP Withdraw: <b>${c.withdrawEnabled ? "ON" : "OFF"}</b>\n\n` +
      `<i>Rate বদলালে শুধু পরের OTP-গুলোতে প্রযোজ্য হবে।</i>`;
    return show(ctx, text, [
      [ib(`💵 Per OTP (${c.perOtp})`, "np_a_rate", "primary")],
      [ib(`🔢 Min OTP (${c.minOtp})`, "np_a_min", "primary")],
      [ib(`⬇️ Min Withdraw (${c.minWithdraw})`, "np_a_minwd", "primary")],
      [ib(`Number Panel: ${c.enabled ? "ON ✅" : "OFF ❌"}`, "np_a_tog", c.enabled ? "success" : "danger")],
      [ib(`OTP Withdraw: ${c.withdrawEnabled ? "ON ✅" : "OFF ❌"}`, "np_a_wtog", c.withdrawEnabled ? "success" : "danger")],
    ]);
  }
  bot.command("otpcfg", adminOnly(async (ctx) => cfgScreen(ctx)));
  bot.action("np_cfg", adminCb(async (ctx) => { await ctx.answerCbQuery().catch(() => {}); return cfgScreen(ctx); }));

  const askAdmin = (action, label) =>
    adminCb(async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await setSession(ctx.from.id, { action });
      return show(ctx, `✏️ <b>${label}</b> — নতুন মান লিখে পাঠান (শুধু সংখ্যা)\n\nবাতিল: /menu`, []);
    });
  bot.action("np_a_rate", askAdmin("np_a_rate", "Per OTP Rate (৳)"));
  bot.action("np_a_min", askAdmin("np_a_min", "Withdraw-এর জন্য Minimum OTP"));
  bot.action("np_a_minwd", askAdmin("np_a_minwd", "Minimum Withdraw (৳)"));
  bot.action("np_a_tog", adminCb(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const c = await getCfg(true);
    await saveCfg({ enabled: !c.enabled });
    return cfgScreen(ctx);
  }));
  bot.action("np_a_wtog", adminCb(async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const c = await getCfg(true);
    await saveCfg({ withdrawEnabled: !c.withdrawEnabled });
    return cfgScreen(ctx);
  }));

  /* ---------------------------------------------------------------- */
  /*  TEXT INPUT (bot.js-এর session dispatcher থেকে ডাকা হয়)           */
  /* ---------------------------------------------------------------- */
  async function handleText(ctx, s, text) {
    const id = ctx.from.id;
    const uid = String(id);

    switch (s.action) {
      case "np_range": {
        const r = text.replace(/\s/g, "").toUpperCase();
        if (!/^[0-9X]{4,20}$/.test(r)) {
          return ctx.reply("❌ রেঞ্জ ঠিক নেই। শুধু সংখ্যা ও X দিন।\nExample: <code>88017XXXX</code>", { parse_mode: "HTML" });
        }
        await clearSession(id);
        return allocate(ctx, r, "Custom Range", "", true);
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
        const pm = userPending(uid).find(([, v]) => String(v.number).includes(clean));
        if (pm) return show(ctx, `⏳ <b>Pending number</b>\n\n📱 <code>${esc(pm[1].number)}</code>`, [back]);
        return show(ctx, `❌ <code>${esc(clean)}</code> — কোনো OTP পাওয়া যায়নি।`, [back]);
      }

      case "np_wd_acc": {
        const method = s.method;
        if (!METHODS[method]) return ctx.reply("⚠️ আবার শুরু করুন।");
        const acc = normAccount(method, text);
        if (!acc) {
          return ctx.reply(method === "binance" ? "🔴 Binance ID কমপক্ষে ৪ অক্ষরের হতে হবে।" : "🔴 সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।");
        }
        const u = await needUser(ctx);
        if (!u) return;
        const cfg = await getCfg(true);
        await userRef(id).update({ [`wallets.${method}.number`]: acc });
        await setSession(id, { action: "np_wd_amt", method, account: acc });
        return show(ctx, `✅ ${METHODS[method]} নম্বর সেভ হয়েছে।\n\n` + wdAmtText(method, acc, cfg, Number(u.otpBalance) || 0), wdAmtKb(method));
      }

      case "np_wd_amt": {
        const u = await needUser(ctx);
        if (!u) return;
        const [cfg, wcfg] = await Promise.all([getCfg(true), getWdConfig()]);
        const amount = Number(bn2en(text).replace(/,/g, ""));
        const bal = Number(u.otpBalance) || 0;
        if (!Number.isFinite(amount) || amount <= 0) return ctx.reply("⚠️ শুধু সংখ্যা লিখুন। যেমন: 100");
        if ((Number(u.otpCount) || 0) < cfg.minOtp) return ctx.reply(lockMsg(cfg, Number(u.otpCount) || 0), { parse_mode: "HTML" });
        if (amount < cfg.minWithdraw) return ctx.reply(`🔴 Minimum ${tk(cfg.minWithdraw)} তুলতে হবে।`);
        if (amount > bal) return ctx.reply(`🔴 যথেষ্ট OTP balance নেই। আছে ${tk(bal)}।`);
        if (!METHODS[s.method] || !s.account) return ctx.reply("⚠️ আবার শুরু করুন।");
        if (wcfg.methods[s.method] === false) return ctx.reply("🔴 এই method এখন বন্ধ।");
        await setSession(id, { action: "np_wd_cf", amount: round2(amount), method: s.method, account: s.account });
        return show(
          ctx,
          `💸 <b>Confirm OTP Withdraw</b>\n\n💰 Amount: ${tk(amount)}\n💳 Method: ${s.method.toUpperCase()}\n📱 Account: <code>${esc(s.account)}</code>\n\n🟢 Confirm করলে OTP Balance থেকে কাটা হবে।`,
          [[ib("Confirm", "np_wd_ok", "success"), ib("Cancel", "np_wd_no", "danger")]]
        );
      }

      case "np_wd_cf":
        return ctx.reply("☝️ উপরের Confirm বা Cancel বাটন চাপুন। বাতিল: /menu");

      case "np_a_rate":
      case "np_a_min":
      case "np_a_minwd": {
        if (!(await isAdmin(id))) { await clearSession(id); return; }
        const v = Number(bn2en(text).replace(/,/g, ""));
        if (!Number.isFinite(v) || v < 0) return ctx.reply("⚠️ সঠিক সংখ্যা লিখুন।");
        const key = { np_a_rate: "perOtp", np_a_min: "minOtp", np_a_minwd: "minWithdraw" }[s.action];
        await saveCfg({ [key]: key === "minOtp" ? Math.floor(v) : v });
        await clearSession(id);
        return cfgScreen(ctx);
      }

      default:
        return ctx.reply("⚠️ /menu দিন।");
    }
  }

  /* ---------------------------------------------------------------- */
  /*  OTP POLLER  (request_id দেখে OTP এলে OTP Balance-এ টাকা যোগ)      */
  /* ---------------------------------------------------------------- */
  async function credit({ number, otp, full, info }) {
    const service = detectService(full);
    const country = info?.country || "";
    const c = resolveCountry(country, number);

    if (info?.userId) {
      const cfg = await getCfg();
      const uref = userRef(info.userId);
      const snap = await uref.get();
      if (snap.exists) {
        const b = db.batch();
        b.update(uref, {
          otpBalance: FieldValue.increment(cfg.perOtp),
          otpCount: FieldValue.increment(1),
        });
        b.set(uref.collection("otp_logs").doc(), {
          number, otp, service, message: String(full || "").slice(0, 400), earned: cfg.perOtp, at: Timestamp.now(),
        });
        await b.commit(); // এরপর আর throw হবে না (claim ফেরত গেলে double-credit হত)

        try {
          const cnt = (Number(snap.get("otpCount")) || 0) + 1;
          const left = Math.max(0, cfg.minOtp - cnt);
          await bot.telegram.sendMessage(
            Number(info.userId),
            `${c.flag} <b>OTP পেয়েছেন!</b> ✅\n\n📞 <code>${esc(number)}</code>\n📩 ${esc(service)}\n🔑 <code>${esc(otp)}</code>\n\n💰 +${tk(cfg.perOtp)} (OTP Balance)\n🔢 মোট OTP: ${cnt}/${cfg.minOtp}${left ? ` • আর ${left}টি বাকি` : " • 🟢 Withdraw আনলক"}`,
            { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: String(otp), copy_text: { text: String(otp) }, style: "success" }]] } }
          );
        } catch (e) {
          console.error("OTP DM failed:", e.description || e.message);
        }
      }
    }

    if (GROUP_ID) {
      (async () => {
        await wait(2000 + Math.random() * 2000);
        const digits = String(number).replace(/\D/g, "");
        const shown = digits.length >= 8 ? `${digits.slice(0, 4)}****${digits.slice(-3)}` : digits;
        const time = new Date().toLocaleString("en-GB", { timeZone: "Asia/Dhaka" });
        const html =
          `🟢 <b>NEW OTP RECEIVED</b> 🟩\n━━━━━━━━━━━━━━━━━━\n\n${c.flag} <b>${esc(c.name)}</b> ➤ <b>${esc(service)}</b>\n` +
          `📞 <b>Number</b> ➤ <code>${esc(shown)}</code>\n⏰ <b>Time</b> ◇ ${time}\n\n━━━━━━━━━━━━━━━━━━\n🔑 <b>OTP CODE</b>\n<code>${esc(otp)}</code>\n\n` +
          `🔔 <b>MESSAGE</b>\n<blockquote>${esc(String(full || "N/A").slice(0, 400))}</blockquote>`;
        const row = [{ text: String(otp), copy_text: { text: String(otp) }, style: "success" }];
        if (CHANNEL_URL) row.unshift({ text: "JOIN CHANNEL", url: CHANNEL_URL, style: "primary" });
        await bot.telegram.sendMessage(GROUP_ID, html, {
          parse_mode: "HTML", reply_markup: { inline_keyboard: [row] }, link_preview_options: { is_disabled: true },
        });
      })().catch((e) => console.error("group send:", e.description || e.message));
    }
  }

  async function handleResult(r) {
    const rid = String(r.request_id);
    const info = pending.get(rid);

    if (r.status === "success" && r.otp_code) {
      try {
        await db.collection("otp_claims").doc(rid).create({ at: Date.now() });
      } catch (e) {
        if (e.code === 6) { done(rid); return; } // আগেই প্রসেস হয়েছে
        throw e;
      }
      const number = String(r.number || info?.number || "").replace(/\D/g, "");
      try {
        await credit({ number, otp: String(r.otp_code), full: r.full_sms || "", info });
        done(rid);
      } catch (e) {
        console.error("OTP credit failed, retry হবে:", e.message);
        await db.collection("otp_claims").doc(rid).delete().catch(() => {});
      }
    } else if (["expired", "not_found", "cancelled", "failed"].includes(r.status)) {
      done(rid);
    }
  }

  let polling = false;
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const now = Date.now();
      for (const [rid, v] of pending) if (now - v.allocatedAt > MAX_AGE) done(rid);
      const ids = [...pending.keys()];
      for (let i = 0; i < ids.length; i += 100) {
        const res = await checkStatus(ids.slice(i, i + 100));
        const results = res?.data?.results;
        if (!Array.isArray(results)) continue;
        for (const r of results) {
          try { await handleResult(r); } catch (e) { console.error("result error:", e.message); }
        }
      }
    } catch (e) {
      console.error("❌ Poll error:", e.message);
    } finally {
      polling = false;
    }
  }

  async function start() {
    if (!process.env.MKNETWORK_API_KEY) console.error("⚠️ MKNETWORK_API_KEY সেট করা নেই — Number Panel কাজ করবে না।");
    await loadPending();
    setInterval(poll, POLL_INTERVAL);
    setInterval(loadPending, 60 * 1000);
    console.log(`✅ Number Panel started${GROUP_ID ? ` → group ${GROUP_ID}` : ""}`);
  }

  return { open, handleText, start };
}
