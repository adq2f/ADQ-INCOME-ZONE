/*
 ============================================================================
  ADQ INCOME ZONE — TELEGRAM BOT  (single file)
 ============================================================================
  DEPLOY (Render.com free tier + UptimeRobot)
  1. GitHub repo-তে bot.js + package.json push করুন।
  2. Render → New → Web Service → repo select।
       Build Command : npm install
       Start Command : npm start
       Node version  : 20+
  3. Render → Environment-এ এগুলো দিন:
       BOT_TOKEN                = BotFather token
       FIREBASE_SERVICE_ACCOUNT = service account JSON (এক লাইনে)
       EXPORT_SECRET            = (optional) /export ফাইল sign করার secret
       GOFILE_TOKEN             = GoFile account API token (profile page থেকে)
  4. Deploy শেষে Render URL কপি করে UptimeRobot-এ HTTP(s) monitor বানান
     (৫ মিনিট interval) — bot জেগে থাকবে।
  5. Firestore-এ নিজের users/{telegramId} ডক-এ role = "admin" সেট করুন।
     এরপর /menu বা /start দিলে মেইন মেনুর নিচে "🛠️ Admin Panel" বাটন আসবে।
     (role সরালে বাটন ও সব admin কমান্ড সাথে সাথে বন্ধ হয়ে যাবে।)

  NOTE: Firestore-এ কিছু query-র জন্য composite index লাগতে পারে। লগে index
  লিংক এলে ক্লিক করে বানিয়ে নিন (bot fallback দিয়ে চলবে)।
 ============================================================================
*/

import http from "http";
import crypto from "crypto";
import { Telegraf, Markup } from "telegraf";
import admin from "firebase-admin";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import axios from "axios";
import FormData from "form-data";

/* ------------------------------------------------------------------ */
/*  KEEP-ALIVE HTTP SERVER (Render + UptimeRobot)                      */
/* ------------------------------------------------------------------ */
const server = http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ADQ Bot is alive ✅");
  })
  .listen(process.env.PORT || 3000);

/* ------------------------------------------------------------------ */
/*  ENV + FIREBASE                                                     */
/* ------------------------------------------------------------------ */
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN || !process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ BOT_TOKEN বা FIREBASE_SERVICE_ACCOUNT সেট করা নেই।");
  process.exit(1);
}
const EXPORT_SECRET = process.env.EXPORT_SECRET || BOT_TOKEN;

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
sa.private_key = sa.private_key.replace(/\\n/g, "\n");
admin.initializeApp({
  credential: admin.credential.cert(sa),
  storageBucket: `${sa.project_id}.firebasestorage.app`,
});
const db = admin.firestore();
const bucket = admin.storage().bucket();
const { FieldValue, Timestamp } = admin.firestore;

const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: Infinity });

/* ------------------------------------------------------------------ */
/*  CONSTANTS                                                          */
/* ------------------------------------------------------------------ */
const BTN = {
  task: "📋 Task Submit",
  balance: "💰 Balance",
  withdraw: "💸 Withdraw",
  leaderboard: "🏆 Leaderboard",
  profile: "👤 Profile",
  history: "📜 History",
  refer: "🎁 Refer",
  help: "❓ Help",
};
const ABTN = {
  stats: "📊 Stats",
  users: "👥 Users",
  files: "📥 All Files",
  bad: "🎯 Process Good", // (key আগের মতোই; এখন Good file দিয়ে প্রসেস হয়)
  wd: "💸 Withdrawals",
  badges: "🎖️ Badges",
  bc: "📢 Broadcast",
  settings: "⚙️ Settings",
  tasks: "🎯 Tasks",
  manage: "👤 User Manage",
  back: "🔙 User Menu",
  panel: "🛠️ Admin Panel", // শুধু role=admin হলে মেইন মেনুতে দেখায়
};

// Telegram-এর নিজস্ব button রঙ (Bot API 9.4+): "success" = সবুজ, "danger" = লাল, "primary" = নীল
const STYLE = {
  [BTN.task]: "success",
  [BTN.balance]: "primary",
  [BTN.withdraw]: "success",
  [BTN.leaderboard]: "primary",
  [BTN.profile]: "primary",
  [BTN.history]: "primary",
  [BTN.refer]: "success",
  [BTN.help]: "primary",
  [ABTN.stats]: "success",
  [ABTN.users]: "primary",
  [ABTN.files]: "danger",
  [ABTN.bad]: "success",
  [ABTN.wd]: "success",
  [ABTN.badges]: "primary",
  [ABTN.bc]: "danger",
  [ABTN.settings]: "primary",
  [ABTN.tasks]: "success",
  [ABTN.manage]: "primary",
  [ABTN.back]: "danger",
  [ABTN.panel]: "danger",
};
// প্রতিটা button-এ রঙ থাকবে (নির্দিষ্ট না থাকলে নীল)
const kbBtn = (label) => ({ text: label, style: STYLE[label] || "primary" });
const ib = (text, data, style = "primary") => ({ text, callback_data: data, style });
const ALL_LABELS = new Set([...Object.values(BTN), ...Object.values(ABTN)]);

const METHODS = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", binance: "Binance" };
const FILE_EXTS = ["xlsx", "xls", "csv", "txt", "tsv"];
const MAX_FILE = 15 * 1024 * 1024;
const ERR_MSG = "❌ কিছু একটা সমস্যা হয়েছে। একটু পরে আবার চেষ্টা করুন।";

// মেইন মেনু — admin হলে নিচে "🛠️ Admin Panel" বাটন যোগ হয়
const buildMainMenu = (isAdm) => {
  const rows = [
    [BTN.task, BTN.balance],
    [BTN.withdraw, BTN.leaderboard],
    [BTN.profile, BTN.history],
    [BTN.refer, BTN.help],
  ];
  if (isAdm) rows.push([ABTN.panel]);
  return Markup.keyboard(rows.map((row) => row.map(kbBtn))).resize();
};

const adminMenu = Markup.keyboard(
  [
    [ABTN.stats, ABTN.users],
    [ABTN.files, ABTN.wd],
    [ABTN.badges, ABTN.bc],
    [ABTN.settings, ABTN.tasks],
    [ABTN.manage, ABTN.back],
  ].map((row) => row.map(kbBtn))
).resize();

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */
const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const toDate = (v) => {
  try {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate();
    if (v instanceof Date) return v;
    if (typeof v === "number") return new Date(v);
  } catch {
    /* ignore */
  }
  return null;
};

const fmtDate = (v) => {
  const d = toDate(v);
  if (!d || isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

const money = (n) => {
  const r = Math.round((Number(n) || 0) * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
};
const tk = (n) => `৳${money(n)}`;
const round2 = (n) => Math.round(n * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bn2en = (s) => String(s).replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d));
const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const extOf = (name) => (String(name || "").split(".").pop() || "").toLowerCase();
const kbx = (kb) => ({ parse_mode: "HTML", reply_markup: kb.reply_markup });

const genReferCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "ADQ";
  for (let i = 0; i < 5; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
};

const statusIcon = (s) => (s === "good" ? "🟢" : s === "bad" ? "🔴" : "🟡");

async function edit(ctx, text, kb) {
  const extra = { parse_mode: "HTML", ...(kb ? { reply_markup: kb.reply_markup } : {}) };
  try {
    await ctx.editMessageText(text, extra);
  } catch (e) {
    const m = e.description || e.message || "";
    if (/not modified/i.test(m)) return;
    console.error("edit failed:", m);
    await ctx.reply(text, extra);
  }
}

async function sendLong(ctx, text, extra = {}) {
  const chunks = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if ((cur + line + "\n").length > 3800) {
      chunks.push(cur);
      cur = "";
    }
    cur += line + "\n";
  }
  if (cur.trim()) chunks.push(cur);
  for (let i = 0; i < chunks.length; i++) {
    await ctx.reply(chunks[i], { parse_mode: "HTML", ...(i === chunks.length - 1 ? extra : {}) });
  }
}

async function dm(userId, text) {
  if (!/^\d+$/.test(String(userId))) return false; // website (Firebase UID) users have no Telegram chat
  try {
    await bot.telegram.sendMessage(Number(userId) || userId, text, { parse_mode: "HTML" });
    return true;
  } catch (e) {
    console.error(`DM failed (${userId}):`, e.description || e.message);
    return false;
  }
}

async function commitOps(ops, size = 400) {
  for (let i = 0; i < ops.length; i += size) {
    const b = db.batch();
    for (const op of ops.slice(i, i + size)) op(b);
    await b.commit();
  }
}

/* ---- sessions ---- */
const sessRef = (id) => db.collection("telegram_sessions").doc(String(id));
const getSession = async (id) => {
  const s = await sessRef(id).get();
  return s.exists ? s.data() : null;
};
const setSession = (id, data) => sessRef(id).set({ ...data, updatedAt: Timestamp.now() });
const clearSession = (id) => sessRef(id).delete();

/* ---- users ---- */
const userRef = (id) => db.collection("users").doc(String(id));
const getUser = async (id) => {
  const s = await userRef(id).get();
  return s.exists ? { id: s.id, ...s.data() } : null;
};
const isAdmin = async (id) => (await getUser(id))?.role === "admin";

// ইউজারের বর্তমান role দেখে সঠিক মেইন মেনু বানায় (admin হলে Admin Panel বাটন সহ)
const userKb = async (id) => kbx(buildMainMenu(await isAdmin(id)));

async function needUser(ctx) {
  const u = await getUser(ctx.from.id);
  if (!u) {
    await ctx.reply("⚠️ আগে /start দিয়ে অ্যাকাউন্ট তৈরি করুন।");
    return null;
  }
  return u;
}

/* ---- wrappers ---- */
const safe = (fn) => async (ctx, next) => {
  try {
    await fn(ctx, next);
  } catch (e) {
    console.error("handler error:", e);
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery("❌ সমস্যা হয়েছে").catch(() => {});
      await ctx.reply(ERR_MSG);
    } catch {
      /* ignore */
    }
  }
};

// Admin check on EVERY action — role সরানো হলে পুরনো admin কিবোর্ড থাকলেও কাজ করবে না,
// আর ইউজারকে সাথে সাথে সাধারণ মেনু ফেরত দেওয়া হবে
const adminOnly = (fn) =>
  safe(async (ctx, next) => {
    if (!(await isAdmin(ctx.from.id))) {
      return ctx.reply("❌ Unknown command.", await userKb(ctx.from.id));
    }
    return fn(ctx, next);
  });

const adminCb = (fn) =>
  safe(async (ctx, next) => {
    if (!(await isAdmin(ctx.from.id))) {
      return ctx.answerCbQuery("❌ Unknown command.", { show_alert: true });
    }
    return fn(ctx, next);
  });

const busy = new Set();
function runBg(ctx, fn, lock = true) {
  const key = String(ctx.from.id);
  if (lock && busy.has(key)) {
    return ctx.reply("⏳ আগের কাজ এখনো চলছে, একটু অপেক্ষা করুন।");
  }
  if (lock) busy.add(key);
  fn()
    .catch(async (e) => {
      console.error("background error:", e);
      try {
        await ctx.reply(ERR_MSG);
      } catch {
        /* ignore */
      }
    })
    .finally(() => {
      if (lock) busy.delete(key);
    });
}

/* ---- tasks ---- */
function taskState(t) {
  const now = Date.now();
  const s = toDate(t.startTime);
  const e = toDate(t.endTime);
  if (s && now < s.getTime()) return "upcoming";
  if (e && now > e.getTime()) return "closed";
  return "open";
}
const stateEmoji = { open: "🟢", upcoming: "🟡", closed: "🔴" };

async function fetchOpenTasks() {
  const snap = await db.collection("tasks").where("active", "==", true).get();
  const now = Date.now();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => {
      const e = toDate(t.endTime);
      return !e || e.getTime() > now;
    })
    .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
}

function taskListKb(tasks) {
  return Markup.inlineKeyboard(
    tasks
      .slice(0, 50)
      .map((t) => [
        ib(`${String(t.title || "").slice(0, 25)} — ৳${money(t.pricePerAccount)}`, `task:${t.id}`, { open: "success", closed: "danger" }[taskState(t)]),
      ])
  );
}

function taskText(t) {
  const ms = [...(t.milestones || [])].sort((a, b) => a.target - b.target);
  let s = `📋 <b>${esc(t.title)}</b>\n\n${esc(t.description || "")}\n\n💰 <b>Rate:</b> ৳${money(t.pricePerAccount)}/account\n`;
  if (ms.length) {
    s += `🔥 <b>Milestones:</b>\n${ms.map((m) => `  • ${m.target}+ = ৳${money(m.price)}`).join("\n")}\n`;
  }
  s += `\n⏰ শুরু: ${fmtDate(t.startTime)}\n⏰ শেষ: ${fmtDate(t.endTime)}\n`;
  if (t.rules) s += `\n📜 <b>Rules:</b>\n${esc(t.rules)}`;
  return s.slice(0, 4000);
}

const DEFAULT_FIELDS = [
  { key: "uid", label: "UID" },
  { key: "password", label: "Password" },
  { key: "twoFA", label: "2FA" },
];

/* ---- file parsing ---- */
// ---- same smart splitting the website uses for single-cell lines ----
function isSpaceProneField(field) {
  const raw = (String(field?.key || "") + " " + String(field?.label || "")).toLowerCase();
  const compact = raw.replace(/[\s_\-.:]+/g, "");
  if (!/2fast|2face/.test(compact)) {
    if (compact.includes("2fa") || compact.includes("twofa") || compact.includes("twofactor") ||
        compact.includes("2factor") || compact.includes("2step") || compact.includes("twostep") ||
        compact.includes("totp") || compact.includes("authenticator") || compact.includes("otp") ||
        /2f$/.test(compact)) return true;
  }
  return ["token", "cookie", "session", "backupcode"].some((k) => compact.includes(k));
}

function mergeParts(parts, fields, joinChar) {
  const cols = fields.length;
  if (cols < 1 || parts.length <= cols) return parts;
  const prone = [];
  fields.forEach((f, i) => { if (isSpaceProneField(f)) prone.push(i); });
  let target = prone.length ? prone[prone.length - 1] : cols - 1;
  if (target >= cols) target = cols - 1;
  const after = cols - 1 - target;
  if (after === 0) return [...parts.slice(0, target), parts.slice(target).join(joinChar)];
  return [
    ...parts.slice(0, target),
    parts.slice(target, parts.length - after).join(joinChar),
    ...parts.slice(parts.length - after),
  ];
}

function splitLine(line, cols, fields) {
  cols = Math.max(1, cols || 3);
  let delim, type;
  if (line.includes("\t")) { delim = "\t"; type = "strong"; }
  else if (line.includes("|")) { delim = "|"; type = "strong"; }
  else if (line.includes(",")) { delim = ","; type = "strong"; }
  else if (/\s{2,}/.test(line)) { delim = /\s{2,}/; type = "multi"; }
  else { delim = /\s+/; type = "single"; }
  let parts = line.split(delim).map((p) => String(p ?? "").trim());
  if (type === "multi" && parts.length < cols) {
    parts = line.trim().split(/\s+/).map((p) => p.trim());
    type = "single";
  }
  if (parts.length > cols) parts = mergeParts(parts, fields, type === "strong" ? String(delim) : " ");
  return parts;
}

function parseTable(buf, ext) {
  if (ext === "xlsx" || ext === "xls") {
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return [];
    return XLSX.utils
      .sheet_to_json(ws, { header: 1, defval: "", raw: true })
      .map((r) => r.map((c) => String(c ?? "").trim()));
  }
  const text = buf.toString("utf8").replace(/^\uFEFF/, "");
  if (ext === "csv") {
    const wb = XLSX.read(text, { type: "string", raw: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return [];
    return XLSX.utils
      .sheet_to_json(ws, { header: 1, defval: "", raw: true })
      .map((r) => r.map((c) => String(c ?? "").trim()));
  }
  return text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean).map((l) => [l]);
}

function extractBadValues(buf, ext) {
  const set = new Set();
  const add = (v) => {
    const n = norm(v);
    if (n) set.add(n);
  };
  if (ext === "xlsx" || ext === "xls") {
    const wb = XLSX.read(buf, { type: "buffer" });
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: true });
      for (const r of rows) for (const c of r) add(c);
    }
  } else {
    const text = buf.toString("utf8").replace(/^\uFEFF/, "");
    for (const line of text.split(/\r?\n/)) {
      add(line);
      for (const p of line.split(/[\t|,;\s]+/)) add(p);
    }
  }
  return set;
}

async function downloadTg(ctx, fileId) {
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(link.href);
  if (!res.ok) throw new Error(`download failed ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/* ---- PutPut Helper (Cloudflare R2-based, never blocked by Render) ---- */
async function uploadToPutPut(buffer, filename) {
  try {
    const { PutPutClient } = await import('putput');
    const pp = new PutPutClient();
    const { token } = await pp.createGuestToken();
    pp.setToken(token);
    const file = await pp.upload(buffer, filename, 'application/octet-stream');
    return { link: file.url };
  } catch (error) {
    console.error("PutPut Upload Error:", error.message);
    return null;
  }
}

function rowKeyOf(task, item, cells) {
  if (Array.isArray(task?.dupKeys) && task.dupKeys.length) {
    const v = task.dupKeys.map((k) => norm(item?.[k]));
    return v.some(Boolean) ? v.join("\u00a7") : "";
  }
  const fields = task?.fields?.length ? task.fields : DEFAULT_FIELDS;
  const arr = Array.isArray(cells) && cells.length ? cells : fields.map((f) => item?.[f.key]);
  const vals = arr.map(norm);
  while (vals.length && !vals[vals.length - 1]) vals.pop();
  return vals.some(Boolean) ? vals.join("\u00a7") : "";
}

/* ------------------------------------------------------------------ */
/*  GLOBAL MIDDLEWARE                                                  */
/* ------------------------------------------------------------------ */
// ---- চ্যাট পরিষ্কার রাখা: নতুন মেনু-ট্যাপে আগের মেসেজ মুছে যায় ----
// (ফাইল/ডকুমেন্ট — ইউজারের সাবমিট করা ফাইল ও বটের পাঠানো রিপোর্ট ফাইল — কখনো মুছে না)
const screens = new Map(); // chatId -> [message_id]
const kbMsg = new Map(); // chatId -> যে মেসেজে মেনু keyboard আছে (সেটা মুছলে keyboard চলে যায়)
const trackMsg = (chatId, mid) => {
  const a = screens.get(chatId) || [];
  a.push(mid);
  if (a.length > 80) a.shift();
  screens.set(chatId, a);
};
async function wipeScreens(ctx) {
  const chatId = ctx.chat.id;
  const ids = screens.get(chatId) || [];
  screens.delete(chatId);
  await Promise.all(ids.map((mid) => ctx.telegram.deleteMessage(chatId, mid).catch(() => {})));
}

bot.use(async (ctx, next) => {
  if (ctx.chat && ctx.chat.type !== "private") return;
  const t = ctx.message?.text;
  const isMenu = !!t && (t.startsWith("/") || ALL_LABELS.has(t));
  if (isMenu) {
    try {
      await clearSession(ctx.from.id);
    } catch (e) {
      console.error("clearSession:", e.message);
    }
  }
  if (ctx.chat && ctx.from && !ctx.message?.document) {
    try {
      if (isMenu) {
        await wipeScreens(ctx);
        await ctx.deleteMessage().catch(() => {});
      } else if (t) {
        trackMsg(ctx.chat.id, ctx.message.message_id);
      }
      const origReply = ctx.reply.bind(ctx);
      ctx.reply = async (text, extra) => {
        const m = await origReply(text, extra);
        const chatId = ctx.chat.id;
        if (extra?.reply_markup?.keyboard) {
          const prev = kbMsg.get(chatId);
          kbMsg.set(chatId, m.message_id);
          if (prev) ctx.telegram.deleteMessage(chatId, prev).catch(() => {});
        } else {
          trackMsg(chatId, m.message_id);
        }
        return m;
      };
    } catch (e) {
      console.error("cleaner:", e.message);
    }
  }
  return next();
});

/* ------------------------------------------------------------------ */
/*  /start, /menu                                                      */
/* ------------------------------------------------------------------ */
async function cmdStart(ctx) {
  const f = ctx.from;
  let u = await getUser(f.id);
  if (!u) {
    let code = genReferCode();
    for (let i = 0; i < 5; i++) {
      const dup = await db.collection("users").where("myReferCode", "==", code).limit(1).get();
      if (dup.empty) break;
      code = genReferCode();
    }
    const now = Timestamp.now();
    const doc = {
      username: f.first_name || f.username || "User",
      telegramId: f.id,
      telegramUsername: f.username || null,
      email: null,
      role: "user",
      authProvider: "telegram",
      balance: 0,
      totalGood: 0,
      totalBad: 0,
      totalPending: 0,
      myReferCode: code,
      referredBy: null,
      referCount: 0,
      totalReferEarning: 0,
      wallets: {},
      customBadge: null,
      customBadgeColor: null,
      createdAt: now,
      telegramLinkedAt: now,
    };
    try {
      await userRef(f.id).create(doc);
      return ctx.reply(
        `🎉 <b>স্বাগতম ADQ Income Zone-এ!</b>\n\n👤 নাম: ${esc(doc.username)}\n🆔 আপনার UID (Telegram ID): <code>${f.id}</code>\n🎁 Refer Code: <code>${code}</code>\n\n✅ অ্যাকাউন্ট তৈরি হয়েছে!\n"Task Submit" বাটন থেকে আয় শুরু করুন।`,
        await userKb(f.id)
      );
    } catch (e) {
      if (e.code !== 6) throw e; // 6 = ALREADY_EXISTS (race) -> fall through
      u = await getUser(f.id);
    }
  }
  return ctx.reply(
    `👋 <b>স্বাগতম ${esc(u.username)}!</b>\n\n💰 Balance: ${tk(u.balance)}\n🟢 Good: ${u.totalGood || 0}  🔴 Bad: ${u.totalBad || 0}  🟡 Pending: ${u.totalPending || 0}`,
    await userKb(f.id)
  );
}

async function cmdMenu(ctx) {
  return ctx.reply("📱 <b>মেইন মেনু</b>", await userKb(ctx.from.id));
}

/* ------------------------------------------------------------------ */
/*  USER FEATURES                                                      */
/* ------------------------------------------------------------------ */
async function cmdTasks(ctx) {
  if (!(await needUser(ctx))) return;
  const tasks = await fetchOpenTasks();
  if (!tasks.length) return ctx.reply("📭 এখন কোনো task নেই।");
  return ctx.reply("📋 <b>Available Tasks</b>\n\nনিচের বাটন থেকে টাস্ক সিলেক্ট করুন:", kbx(taskListKb(tasks)));
}

async function cmdBalance(ctx) {
  const u = await needUser(ctx);
  if (!u) return;
  return ctx.reply(
    `💰 <b>ব্যালেন্স</b>\n\nAvailable: <b>${tk(u.balance)}</b>\n\n🟢 Good: ${u.totalGood || 0}\n🔴 Bad: ${u.totalBad || 0}\n🟡 Pending: ${u.totalPending || 0}`,
    { parse_mode: "HTML" }
  );
}

async function getWdConfig() {
  const [s, pm] = await Promise.all([
    db.collection("settings").doc("withdraw_config").get(),
    db.collection("settings").doc("payment_methods").get(),
  ]);
  const d = s.exists ? s.data() : {};
  return {
    minWithdraw: Number(d.minWithdraw ?? 100),
    maxWithdraw: Number(d.maxWithdraw ?? 50000),
    withdrawEnabled: d.withdrawEnabled !== false,
    methods: { bkash: true, nagad: true, rocket: true, binance: true, ...(pm.exists ? pm.data() : {}) },
  };
}

function normAccount(method, raw) {
  const n = String(raw || "").replace(/[\s-]/g, "");
  if (method === "binance") return n.length >= 4 ? n : null;
  const m = n.match(/^(?:\+?88)?(01[3-9]\d{8})$/);
  return m ? m[1] : null;
}
const accountPrompt = (method) =>
  method === "binance" ? "Binance ID / Wallet লিখুন (কমপক্ষে ৪ অক্ষর):" : `${METHODS[method]} নম্বর লিখুন (01XXXXXXXXX):`;

async function cmdWithdraw(ctx) {
  const u = await needUser(ctx);
  if (!u) return;
  const cfg = await getWdConfig();
  if (!cfg.withdrawEnabled) return ctx.reply("🔴 এখন withdraw বন্ধ।");
  const bal = Number(u.balance) || 0;
  if (bal < cfg.minWithdraw) {
    return ctx.reply(`🔴 Minimum ${tk(cfg.minWithdraw)} দরকার। আছে ${tk(bal)}।`);
  }
  const on = Object.keys(METHODS).filter((m) => cfg.methods[m] !== false);
  if (!on.length) return ctx.reply("🔴 এখন কোনো payment method চালু নেই।");
  const rows = on.map((m) => {
    const n = u.wallets?.[m]?.number;
    return [ib(n ? `${METHODS[m]} — ${n}` : `${METHODS[m]} — নম্বর সেট করুন`, `wd_pick:${m}`, "primary")];
  });
  rows.push([ib("Cancel", "wd_no", "danger")]);
  return ctx.reply(
    `💸 <b>Withdraw</b>\n\n💰 Balance: ${tk(bal)}\n📉 Min: ${tk(cfg.minWithdraw)}\n\nকোন method-এ তুলবেন? নম্বর সেট না থাকলে এখানেই সেট করতে পারবেন।`,
    kbx(Markup.inlineKeyboard(rows))
  );
}

async function cmdLeaderboard(ctx) {
  const snap = await db.collection("users").orderBy("totalGood", "desc").limit(40).get();
  const rows = snap.docs.map((d) => d.data()).filter((u) => u.role !== "admin").slice(0, 20);
  if (!rows.length) return ctx.reply("📭 এখনো কেউ নেই।");
  const medals = ["🥇", "🥈", "🥉"];
  const lines = rows.map(
    (u, i) => `${medals[i] || `${i + 1}.`} ${esc(u.username)} — 🟢 ${u.totalGood || 0}`
  );
  return ctx.reply(`🏆 <b>Top 20</b>\n\n${lines.join("\n")}`, { parse_mode: "HTML" });
}

async function cmdProfile(ctx) {
  const u = await needUser(ctx);
  if (!u) return;
  let s = `👤 <b>প্রোফাইল</b>\n\n👤 নাম: ${esc(u.username)}\n🆔 UID: <code>${u.telegramId ?? u.id}</code>\n💰 Balance: ${tk(u.balance)}\n🟢 Good: ${u.totalGood || 0}  🔴 Bad: ${u.totalBad || 0}\n🎁 Refer Code: <code>${esc(u.myReferCode)}</code>\n📅 জয়েন: ${fmtDate(u.createdAt)}`;
  if (u.customBadge) s += `\n🎖️ Badge: ${esc(u.customBadge)}`;
  return ctx.reply(s, { parse_mode: "HTML" });
}

async function recentSubmissions(uid, n) {
  const col = db.collection("submissions");
  try {
    const snap = await col.where("userId", "==", String(uid)).orderBy("submittedAt", "desc").limit(n).get();
    return snap.docs.map((d) => d.data());
  } catch (e) {
    console.error("history index missing, fallback:", e.message);
    const snap = await col
      .where("userId", "==", String(uid))
      .select("uid", "taskTitle", "status", "submittedAt")
      .get();
    return snap.docs
      .map((d) => d.data())
      .sort((a, b) => (toDate(b.submittedAt)?.getTime() || 0) - (toDate(a.submittedAt)?.getTime() || 0))
      .slice(0, n);
  }
}

async function cmdHistory(ctx) {
  const u = await needUser(ctx);
  if (!u) return;
  return ctx.reply(
    `📜 <b>History</b>\n\n✅ TOTAL GOOD = ${u.totalGood || 0}\n❌ TOTAL BAD = ${u.totalBad || 0}\n⏳ TOTAL PENDING = ${u.totalPending || 0}`,
    { parse_mode: "HTML" }
  );
}

async function cmdRefer(ctx) {
  const u = await needUser(ctx);
  if (!u) return;
  return ctx.reply(
    `🎁 <b>Refer &amp; Earn</b>\n\n🔗 আপনার কোড: <code>${esc(u.myReferCode)}</code>\n👥 Refer: ${u.referCount || 0} জন\n💰 মোট আয়: ${tk(u.totalReferEarning)}\n\nবন্ধুকে আপনার কোড দিন — সে আয় করলে আপনি কমিশন পান!`,
    { parse_mode: "HTML" }
  );
}

async function cmdWallet(ctx) {
  const u = await needUser(ctx);
  if (!u) return;
  const lines = Object.entries(u.wallets || {})
    .filter(([m, w]) => METHODS[m] && w?.number)
    .map(([m, w]) => `${METHODS[m]}: <code>${esc(w.number)}</code>`);
  if (!lines.length) {
    return ctx.reply("💳 কোনো wallet নেই।\n\n/setwallet bkash 01XXXXXXXXX");
  }
  return ctx.reply(`💳 <b>আপনার Wallets</b>\n\n${lines.join("\n")}\n\n🔄 আপডেট: /setwallet &lt;method&gt; &lt;number&gt;`, {
    parse_mode: "HTML",
  });
}

async function cmdHelp(ctx) {
  return ctx.reply(
    "❓ <b>সাহায্য</b>\n\n🚀 /start — অ্যাকাউন্ট তৈরি\n📱 /menu — মেইন মেনু\n📋 /tasks — টাস্ক লিস্ট\n💰 /balance — ব্যালেন্স\n💸 /withdraw — টাকা তোলা\n📜 /history — হিস্টোরি\n🏆 /leaderboard — টপ\n👤 /profile — প্রোফাইল\n🎁 /refer — রেফার",
    { parse_mode: "HTML" }
  );
}

async function cmdSetWallet(ctx) {
  const u = await needUser(ctx);
  if (!u) return;
  const parts = ctx.message.text.trim().split(/\s+/);
  const method = (parts[1] || "").toLowerCase();
  const number = (parts[2] || "").replace(/[\s-]/g, "");
  if (!METHODS[method] || !number) {
    return ctx.reply("⚠️ ব্যবহার: /setwallet bkash 01XXXXXXXXX\n\nMethod: bkash, nagad, rocket, binance");
  }
  const ok =
    method === "binance" ? number.length >= 4 : /^(?:\+?88)?01[3-9]\d{8}$/.test(number);
  if (!ok) {
    return ctx.reply(
      method === "binance" ? "🔴 Binance ID কমপক্ষে ৪ অক্ষরের হতে হবে।" : "🔴 সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।"
    );
  }
  await userRef(ctx.from.id).update({ [`wallets.${method}.number`]: number });
  return ctx.reply(`🟢 ${method.toUpperCase()} saved: ${number}`);
}

/* register user commands + buttons */
const USER_ROUTES = [
  ["start", null, cmdStart],
  ["menu", null, cmdMenu],
  ["tasks", BTN.task, cmdTasks],
  ["balance", BTN.balance, cmdBalance],
  ["withdraw", BTN.withdraw, cmdWithdraw],
  ["leaderboard", BTN.leaderboard, cmdLeaderboard],
  ["profile", BTN.profile, cmdProfile],
  ["history", BTN.history, cmdHistory],
  ["refer", BTN.refer, cmdRefer],
  ["wallet", null, cmdWallet],
  ["help", BTN.help, cmdHelp],
];
for (const [cmd, label, fn] of USER_ROUTES) {
  bot.command(cmd, safe(fn));
  if (label) bot.hears(label, safe(fn));
}
bot.command("setwallet", safe(cmdSetWallet));

/* ------------------------------------------------------------------ */
/*  TASK CALLBACKS                                                     */
/* ------------------------------------------------------------------ */
bot.action(
  /^task:(.+)$/,
  safe(async (ctx) => {
    await ctx.answerCbQuery();
    const snap = await db.collection("tasks").doc(ctx.match[1]).get();
    if (!snap.exists) return ctx.reply("❌ টাস্কটি পাওয়া যায়নি।");
    const t = { id: snap.id, ...snap.data() };
    const kb = Markup.inlineKeyboard([
      [ib("Submit File", `sub:${t.id}`, "success")],
      [ib("⬅️ Back", "tasks:back")],
    ]);
    return edit(ctx, taskText(t), kb);
  })
);

bot.action(
  "tasks:back",
  safe(async (ctx) => {
    await ctx.answerCbQuery();
    const tasks = await fetchOpenTasks();
    if (!tasks.length) return edit(ctx, "📭 এখন কোনো task নেই।");
    return edit(ctx, "📋 <b>Available Tasks</b>\n\nনিচের বাটন থেকে টাস্ক সিলেক্ট করুন:", taskListKb(tasks));
  })
);

bot.action(
  /^sub:(.+)$/,
  safe(async (ctx) => {
    const snap = await db.collection("tasks").doc(ctx.match[1]).get();
    if (!snap.exists) return ctx.answerCbQuery("❌ টাস্কটি পাওয়া যায়নি।", { show_alert: true });
    const t = { id: snap.id, ...snap.data() };
    const st = taskState(t);
    if (st === "upcoming") return ctx.answerCbQuery("এখনো শুরু হয়নি।", { show_alert: true });
    if (st === "closed" || t.active === false) {
      return ctx.answerCbQuery("টাস্ক শেষ হয়েছে।", { show_alert: true });
    }
    if (!(await getUser(ctx.from.id))) {
      return ctx.answerCbQuery("আগে /start দিন।", { show_alert: true });
    }
    await ctx.answerCbQuery();
    await setSession(ctx.from.id, { action: "submit_file", taskId: t.id });
    const fields = t.fields?.length ? t.fields : DEFAULT_FIELDS;
    const fmt = fields.map((f) => f.label || f.key).join(" | ");
    return ctx.reply(
      `📤 <b>Submit File</b>\n\n📋 Task: ${esc(t.title)}\n💰 Rate: ৳${money(t.pricePerAccount)}/account\n\n📊 Format:\n<code>${esc(fmt)}</code>\n\n📎 Excel (.xlsx/.xls), CSV, বা TXT file পাঠান।\nপ্রতি রো = ১ অ্যাকাউন্ট\n\n❌ বাতিল: /menu`,
      { parse_mode: "HTML" }
    );
  })
);

/* ---- file submission ---- */
async function submitFile(ctx, session) {
  const doc = ctx.message.document;
  const filename = doc.file_name || "file.txt";
  const ext = extOf(filename);
  if (!FILE_EXTS.includes(ext)) {
    return ctx.reply("❌ শুধু .xlsx, .xls, .csv, .txt বা .tsv ফাইল দিন।");
  }
  if ((doc.file_size || 0) > 19 * 1024 * 1024) {
    return ctx.reply("❌ ফাইল ১৯MB-এর বেশি হতে পারবে না। দয়া করে ছোট ফাইলে ভাগ করে পাঠান।");
  }

  const user = await getUser(ctx.from.id);
  if (!user) return ctx.reply("⚠️ আগে /start দিয়ে অ্যাকাউন্ট তৈরি করুন।");

  const tSnap = await db.collection("tasks").doc(session.taskId).get();
  if (!tSnap.exists) {
    await clearSession(ctx.from.id);
    return ctx.reply("❌ টাস্কটি পাওয়া যায়নি।");
  }
  const task = { id: tSnap.id, ...tSnap.data() };
  const st = taskState(task);
  if (st !== "open" || task.active === false) {
    await clearSession(ctx.from.id);
    return ctx.reply(st === "upcoming" ? "⏳ টাস্ক এখনো শুরু হয়নি।" : "🔴 টাস্ক শেষ হয়েছে।");
  }

  const progressMsg = await ctx.reply("⏳ ফাইল প্রসেস হচ্ছে... 0%");
  let progressInterval = null;

  try {
    const buf = await downloadTg(ctx, doc.file_id);

    let progress = 30;
    await ctx.telegram.editMessageText(ctx.chat.id, progressMsg.message_id, undefined, `⏳ ডাটা পড়া হচ্ছে... ${progress}%`);

    progressInterval = setInterval(async () => {
      progress += 20;
      if (progress > 90) progress = 90;
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, progressMsg.message_id, undefined, `⏳ ডাটাবেসে সেভ হচ্ছে... ${progress}%`);
      } catch (e) { /* ignore */ }
    }, 2000);

    let rows = parseTable(buf, ext);
    let rowBase = 1;
    if (rows.length && String(rows[0][0] || "").toLowerCase().includes("uid")) {
      rows = rows.slice(1);
      rowBase = 2;
    }

    const fields = task.fields?.length ? task.fields : DEFAULT_FIELDS;
    const parsed = [];
    let invalid = 0;
    let blank = 0;

    for (let ri = 0; ri < rows.length; ri++) {
      const rawRow = rows[ri];
      const cells0 = rawRow.map((c) => String(c ?? "").trim());
      const nonEmpty = cells0.filter(Boolean);

      if (!nonEmpty.length) {
        blank++;
        continue;
      }

      let cells = cells0;
      if (nonEmpty.length === 1 && fields.length > 1) {
        cells = splitLine(nonEmpty[0], fields.length, fields);
      }
      cells = cells.map((c) => String(c ?? "").trim());

      const item = {};
      fields.forEach((f, i) => { item[f.key] = cells[i] ?? ""; });

      const uid = item.uid || item[fields[0].key] || cells[0] || "";
      if (!uid) {
        invalid++;
        continue;
      }

      while (cells.length && !cells[cells.length - 1]) cells.pop();

      parsed.push({
        item,
        uid,
        password: item.password ?? cells[1] ?? "",
        twoFA: item.twoFA ?? item["2fa_key"] ?? cells[2] ?? "",
        allCells: cells.slice(0, 50).map((c) => c.slice(0, 500)),
      });
    }

    if (!parsed.length) {
      clearInterval(progressInterval);
      return ctx.reply("❌ ফাইলে কোনো valid রো পাওয়া যায়নি।");
    }

    // dedup (against DB + inside the file)
    const exQ = db.collection("submissions").where("taskId", "==", task.id);
    const existing = Array.isArray(task.dupKeys) && task.dupKeys.length ? await exQ.get() : await exQ.select("allCells").get();
    const seen = new Set();
    existing.docs.forEach((d) => {
      const x = d.data();
      const k = rowKeyOf(task, x, x.allCells);
      if (k) seen.add(k);
    });
    const fresh = [];
    let dupCount = 0;
    for (const r of parsed) {
      const k = rowKeyOf(task, r.item, r.allCells);
      if (k && seen.has(k)) { dupCount++; continue; }
      if (k) seen.add(k);
      fresh.push(r);
    }
    const okCount = fresh.length;
    if (!okCount) {
      clearInterval(progressInterval);
      await clearSession(ctx.from.id);
      return ctx.reply(`⚠️ সব রো Duplicate!\n\n📄 ফাইল: ${esc(filename)}\n🔴 Duplicate বাদ: ${dupCount}`, await userKb(ctx.from.id));
    }

    const now = Timestamp.now();
    const fileRef = db.collection("submitted_files").doc();
    const ops = [];
    ops.push((b) => b.set(fileRef, {
      userId: String(ctx.from.id), username: user.username, taskId: task.id,
      taskTitle: task.title || "", taskPlatform: task.platform || "", filename,
      storagePath: doc.file_id, rowCount: parsed.length, okCount, dupCount,
      status: "pending", uploadedAt: now, processedAt: null,
    }));

    for (const r of fresh) {
      const ref = db.collection("submissions").doc();
      ops.push((b) => b.set(ref, {
        ...r.item, uid: r.uid, password: r.password, twoFA: r.twoFA, allCells: r.allCells,
        taskId: task.id, taskTitle: task.title || "", taskPlatform: task.platform || "",
        userId: String(ctx.from.id), username: user.username, fileId: fileRef.id,
        source: "telegram_file", status: "pending", price: Number(task.pricePerAccount) || 0,
        earned: 0, submittedAt: now, checkedAt: null, processedBy: null,
      }));
    }
    ops.push((b) => b.update(userRef(ctx.from.id), { totalPending: FieldValue.increment(okCount) }));
    await commitOps(ops);
    await clearSession(ctx.from.id);

    clearInterval(progressInterval);
    await ctx.telegram.editMessageText(ctx.chat.id, progressMsg.message_id, undefined, `✅ ফাইল সফলভাবে সাবমিট হয়েছে! 100%`);

    let msg = `✅ <b>File Submit সম্পন্ন!</b>\n\n📋 Task: ${esc(task.title)}\n📄 ফাইল: ${esc(filename)}\n\n🟢 Submit হয়েছে: ${okCount}\n🔴 Duplicate বাদ: ${dupCount}`;
    if (blank) msg += `\n⚪ ফাঁকা রো বাদ: ${blank}`;
    if (invalid) msg += `\n⚠️ UID নেই (বাদ): ${invalid}`;
    msg += "\n\n🟡 Admin রেজাল্ট প্রসেস করবেন।";
    return ctx.reply(msg, await userKb(ctx.from.id));

  } catch (err) {
    console.error("Submit error:", err);
    try {
      await ctx.telegram.editMessageText(ctx.chat.id, progressMsg.message_id, undefined, "❌ ফাইল সাবমিট করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।");
    } catch (e) {
      await ctx.reply("❌ ফাইল সাবমিট করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।");
    }
  } finally {
    if (progressInterval) clearInterval(progressInterval);
  }
}

/* ------------------------------------------------------------------ */
/*  WITHDRAW CALLBACKS                                                 */
/* ------------------------------------------------------------------ */
const wdAmountText = (method, account, cfg, bal) =>
  `💳 <b>${METHODS[method]}</b> — <code>${esc(account)}</code>\n\n💰 Balance: ${tk(bal)}\n📉 Min: ${tk(cfg.minWithdraw)}  📈 Max: ${tk(cfg.maxWithdraw)}\n\nকত টাকা তুলবেন? (শুধু সংখ্যা):`;
const wdAmountKb = (method) =>
  Markup.inlineKeyboard([[ib("✏️ নম্বর বদলান", `wd_chg:${method}`), ib("Cancel", "wd_no", "danger")]]);

bot.action(
  /^wd_pick:(.+)$/,
  safe(async (ctx) => {
    const method = ctx.match[1];
    if (!METHODS[method]) return ctx.answerCbQuery("❌ method সঠিক নয়।", { show_alert: true });
    const [u, cfg] = await Promise.all([getUser(ctx.from.id), getWdConfig()]);
    if (!u) return ctx.answerCbQuery("আগে /start দিন।", { show_alert: true });
    if (!cfg.withdrawEnabled) return ctx.answerCbQuery("🔴 এখন withdraw বন্ধ।", { show_alert: true });
    if (cfg.methods[method] === false) return ctx.answerCbQuery("🔴 এই method এখন বন্ধ।", { show_alert: true });
    await ctx.answerCbQuery();
    const account = u.wallets?.[method]?.number;
    if (account) {
      await setSession(ctx.from.id, { action: "wd_amount", method, account });
      return edit(ctx, wdAmountText(method, account, cfg, Number(u.balance) || 0), wdAmountKb(method));
    }
    await setSession(ctx.from.id, { action: "wd_account", method });
    return edit(ctx, `💳 <b>${METHODS[method]}</b>\n\n${accountPrompt(method)}`, Markup.inlineKeyboard([[ib("Cancel", "wd_no", "danger")]]));
  })
);

bot.action(
  /^wd_chg:(.+)$/,
  safe(async (ctx) => {
    const method = ctx.match[1];
    if (!METHODS[method]) return ctx.answerCbQuery("❌ method সঠিক নয়।", { show_alert: true });
    await ctx.answerCbQuery();
    await setSession(ctx.from.id, { action: "wd_account", method });
    return edit(ctx, `✏️ <b>${METHODS[method]}</b> — নতুন নম্বর\n\n${accountPrompt(method)}`, Markup.inlineKeyboard([[ib("Cancel", "wd_no", "danger")]]));
  })
);

bot.action(
  "wd_ok",
  safe(async (ctx) => {
    const s = await getSession(ctx.from.id);
    if (!s || s.action !== "wd_confirm") {
      return ctx.answerCbQuery("⚠️ সেশন শেষ। আবার /withdraw দিন।", { show_alert: true });
    }
    await ctx.answerCbQuery();
    await clearSession(ctx.from.id); // prevents double-tap
    const { amount, method, account } = s;
    const cfg = await getWdConfig();
    if (!cfg.withdrawEnabled) return edit(ctx, "🔴 এখন withdraw বন্ধ।");
    if (cfg.methods[method] === false) return edit(ctx, "🔴 এই method দিয়ে এখন withdraw বন্ধ।");
    const uref = userRef(ctx.from.id);
    const wref = db.collection("withdrawals").doc(`${ctx.from.id}_${Date.now()}`);
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(uref);
        if (!snap.exists) throw new Error("NO_USER");
        const u = snap.data();
        if ((Number(u.balance) || 0) < amount) throw new Error("LOW_BALANCE");
        tx.update(uref, { balance: round2((Number(u.balance) || 0) - amount) });
        tx.set(wref, {
          userId: String(ctx.from.id),
          username: u.username,
          email: u.email || "",
          method,
          methodName: METHODS[method],
          amount,
          accountNum: account,
          status: "pending",
          requestedAt: Timestamp.now(),
          source: "telegram",
        });
      });
    } catch (e) {
      if (e.message === "LOW_BALANCE") return edit(ctx, "🔴 যথেষ্ট balance নেই।");
      throw e;
    }
    return edit(
      ctx,
      `✅ <b>Withdraw Submitted</b>\n\n💰 ${tk(amount)}\n💳 ${method.toUpperCase()}\n📱 <code>${esc(account)}</code>\n\n🟡 Admin approve করার অপেক্ষায়।`
    );
  })
);

bot.action(
  "wd_no",
  safe(async (ctx) => {
    await ctx.answerCbQuery();
    await clearSession(ctx.from.id);
    return edit(ctx, "🔴 Withdraw বাতিল হয়েছে।");
  })
);

/* ------------------------------------------------------------------ */
/*  ADMIN PANEL                                                        */
/* ------------------------------------------------------------------ */
// /adqincomezone কমান্ড আগের মতোই কাজ করবে (শুধু admin)
bot.command(
  "adqincomezone",
  safe(async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) return ctx.reply("❌ Unknown command.", await userKb(ctx.from.id));
    return ctx.reply("🛠️ <b>Admin Panel</b>", kbx(adminMenu));
  })
);

// মেইন মেনুর "🛠️ Admin Panel" বাটন — শুধু role=admin হলে খুলবে
bot.hears(
  ABTN.panel,
  safe(async (ctx) => {
    if (!(await isAdmin(ctx.from.id))) {
      return ctx.reply("❌ Unknown command.", await userKb(ctx.from.id));
    }
    return ctx.reply("🛠️ <b>Admin Panel</b>", kbx(adminMenu));
  })
);

// Admin Panel থেকে ইউজার মেনুতে ফেরা (admin হলে মেনুতে Admin Panel বাটনও থাকবে)
bot.hears(
  ABTN.back,
  safe(async (ctx) => ctx.reply("📱 <b>মেইন মেনু</b>", await userKb(ctx.from.id)))
);

/* ---- Stats ---- */
bot.hears(
  ABTN.stats,
  adminOnly(async (ctx) => {
    const [tasks, usersCnt, subsCnt, wdCnt, balSnap] = await Promise.all([
      fetchOpenTasks(),
      db.collection("users").count().get(),
      db.collection("submissions").where("status", "==", "pending").count().get(),
      db.collection("withdrawals").where("status", "==", "pending").count().get(),
      db.collection("users").select("balance").get(),
    ]);
    const total = balSnap.docs.reduce((s, d) => s + (Number(d.get("balance")) || 0), 0);
    return ctx.reply(
      `📊 <b>Admin Stats</b>\n\n🎯 Active Tasks: ${tasks.length}\n👥 Users: ${usersCnt.data().count}\n🟡 Pending Subs: ${subsCnt.data().count}\n🟡 Pending Withdrawals: ${wdCnt.data().count}\n\n💰 Total User Balance: ${tk(total)}`,
      { parse_mode: "HTML" }
    );
  })
);

/* ---- Users ---- */
bot.hears(
  ABTN.users,
  adminOnly(async (ctx) => {
    const snap = await db.collection("users").orderBy("totalGood", "desc").limit(20).get();
    if (snap.empty) return ctx.reply("📭 কোনো user নেই।");
    const lines = snap.docs.map((d, i) => {
      const u = d.data();
      return `${i + 1}. ${esc(u.username)} — 🟢 ${u.totalGood || 0} • ${tk(u.balance)}`;
    });
    return sendLong(ctx, `👥 <b>Top 20 Users</b>\n\n${lines.join("\n")}`);
  })
);

const totalsBlock = (submit, good, bad, earn) =>
  `📝 TOTAL SUBMIT = ${submit}\n✅ TOTAL GOOD = ${good}\n❌ TOTAL BAD = ${bad}\n💸 TOTAL EARN = ${tk(earn)}`;
const dateRange = (files) => {
  const t = files.map((f) => toDate(f.uploadedAt)?.getTime()).filter(Boolean).sort((x, y) => x - y);
  if (!t.length) return "—";
  const x = fmtDate(new Date(t[0]));
  const y = fmtDate(new Date(t[t.length - 1]));
  return x === y ? x : `${x} → ${y}`;
};
const stampForFile = () =>
  new Date().toLocaleString("sv-SE", { timeZone: "Asia/Dhaka" }).replace(" ", "_").replace(/:/g, "").slice(0, 15);
const slugOf = (t) => String(t || "task").replace(/\s+/g, "_").replace(/[^A-Za-z0-9_-]/g, "") || "task";
function subValues(sub, fields) {
  return fields.map((f, idx) => {
    let v = sub[f.key];
    if ((v === undefined || v === null || v === "") && Array.isArray(sub.allCells)) v = sub.allCells[idx];
    return v === undefined || v === null ? "" : String(v);
  });
}

/* ---- pending files grouped by task ---- */
async function pendingFilesByTask() {
  const snap = await db.collection("submitted_files").where("status", "==", "pending").get();
  const groups = new Map();
  for (const d of snap.docs) {
    const f = { id: d.id, ...d.data() };
    if (!groups.has(f.taskId)) groups.set(f.taskId, { taskId: f.taskId, title: f.taskTitle, files: [] });
    groups.get(f.taskId).files.push(f);
  }
  return { total: snap.size, groups: [...groups.values()] };
}

/* ---- All Files ---- */
bot.hears(
  ABTN.files,
  adminOnly(async (ctx) => {
    const { total, groups } = await pendingFilesByTask();
    if (!total) return ctx.reply("📭 কোনো pending file নেই।");
    let allRows = 0;
    let list = "";
    for (const g of groups) {
      const rows = g.files.reduce((x, f) => x + (Number(f.rowCount) || 0), 0);
      allRows += rows;
      const users = new Set(g.files.map((f) => f.userId)).size;
      list += `\n📋 <b>${esc(g.title)}</b>\n   👥 ${users} জন • 📄 ${g.files.length} ফাইল • ${rows} submissions\n   📅 ${dateRange(g.files)}\n`;
    }
    const msg = `📥 <b>All Pending Files</b>\n\nমোট ${total}টি ফাইল (${groups.length}টা task)\n\n${totalsBlock(allRows, 0, 0, 0)}\n━━━━━━━━━━━━━━${list}`;
    const kb = Markup.inlineKeyboard(
      groups.slice(0, 50).map((g) => [
        ib(`${String(g.title || "").slice(0, 30)} (${g.files.length} files)`, `af_task:${g.taskId}`, "danger"),
      ])
    );
    return ctx.reply(msg.slice(0, 4000), kbx(kb));
  })
);

// এক ইউজারের সব ফাইল এক লাইনে গ্রুপ হয়ে দেখাবে
bot.action(
  /^af_task:(.+)$/,
  adminCb(async (ctx) => {
    await ctx.answerCbQuery();
    const taskId = ctx.match[1];
    const snap = await db
      .collection("submitted_files")
      .where("taskId", "==", taskId)
      .where("status", "==", "pending")
      .get();
    if (snap.empty) return edit(ctx, "📭 কোনো pending file নেই।");
    const files = snap.docs
      .map((d) => d.data())
      .sort((a, b) => (toDate(a.uploadedAt)?.getTime() || 0) - (toDate(b.uploadedAt)?.getTime() || 0));

    const byUser = new Map();
    for (const f of files) {
      const key = String(f.userId);
      if (!byUser.has(key)) byUser.set(key, { username: f.username, count: 0, rows: 0, last: f.uploadedAt });
      const e = byUser.get(key);
      e.count++;
      e.rows += Number(f.rowCount) || 0;
      if ((toDate(f.uploadedAt)?.getTime() || 0) >= (toDate(e.last)?.getTime() || 0)) e.last = f.uploadedAt;
    }
    const usersList = [...byUser.values()];
    const shown = usersList.slice(0, 30);
    const allRows = files.reduce((x, f) => x + (Number(f.rowCount) || 0), 0);

    let msg = `📥 <b>${esc(files[0].taskTitle)}</b>\n📅 ${dateRange(files)}\n\n${totalsBlock(allRows, 0, 0, 0)}\n━━━━━━━━━━━━━━\n`;
    shown.forEach((u, i) => {
      msg += `\n${i + 1}. 👤 <b>${esc(u.username)}</b>\n   📄 ${u.count} ফাইল • 📊 ${u.rows} rows\n   🕐 ${fmtDate(u.last)}\n`;
    });
    if (usersList.length > shown.length) msg += `\n… আরও ${usersList.length - shown.length} জন ইউজার`;
    const kb = Markup.inlineKeyboard([
      [ib("Download All (Combined)", `af_dl:${taskId}`, "success")],
      [ib("Process Good File", `pb_start:${taskId}`, "success")],
    ]);
    return edit(ctx, msg.slice(0, 4000), kb);
  })
);

bot.action(
  /^af_dl:(.+)$/,
  adminCb(async (ctx) => {
    await ctx.answerCbQuery("⏳ Excel তৈরি হচ্ছে...");
    const taskId = ctx.match[1];
    try {
      const [tSnap, snap] = await Promise.all([
        db.collection("tasks").doc(taskId).get(),
        db.collection("submissions").where("taskId", "==", taskId).where("status", "==", "pending").get(),
      ]);
      if (snap.empty) return ctx.reply("📭 কোনো pending submission নেই।");

      const task = tSnap.exists ? tSnap.data() : {};
      const fields = task.fields?.length ? task.fields : DEFAULT_FIELDS;
      const subs = snap.docs
        .map((d) => d.data())
        .sort((a, b) => (toDate(a.submittedAt)?.getTime() || 0) - (toDate(b.submittedAt)?.getTime() || 0));

      const wb = new ExcelJS.Workbook();
      wb.creator = "ADQ Income Zone";
      const ws = wb.addWorksheet("Pending");

      const hr = ws.addRow(["#", ...fields.map((f) => f.label || f.key), "User", "User ID", "Submitted At"]);
      hr.font = { bold: true, color: { argb: "FFFFFFFF" } };
      hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4338CA" } };

      subs.forEach((sub, i) => {
        ws.addRow([i + 1, ...subValues(sub, fields), sub.username || "", String(sub.userId || ""), fmtDate(sub.submittedAt)]);
      });

      const n = fields.length;
      for (let c = 1; c <= n + 4; c++) ws.getColumn(c).width = c === 1 ? 6 : c <= n + 1 ? 26 : 22;

      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      const fileName = `${slugOf(task.title)}_ALL_PENDING_${stampForFile()}.xlsx`;

      await ctx.reply("⏳ ফাইল আপলোড হচ্ছে, অপেক্ষা করুন...");
      const uploaded = await uploadToPutPut(buf, fileName);
      if (!uploaded) throw new Error("Upload failed (Render logs দেখুন)");

      await ctx.reply(
        `🔗 <b>All Files Download Link:</b>\n${uploaded.link}\n\n📋 Task: ${esc(task.title)}\n📊 Total Rows: ${subs.length}\n\n<i>⚠️ লিংকটি ৩ দিন (৭২ ঘণ্টা) সচল থাকবে। তাই ফাইলটি ডাউনলোড করে নিজের ডিভাইসে সেভ করে রাখুন।</i>`,
        { parse_mode: "HTML", disable_web_page_preview: true }
      );
    } catch (e) {
      console.error("af_dl failed:", e);
      return ctx.reply(`⚠️ ফাইল বানানো/পাঠানো যায়নি: ${e.message}`);
    }
  })
);

/* ---- Process Good ---- */
bot.hears(
  ABTN.bad,
  adminOnly(async (ctx) => {
    const { total, groups } = await pendingFilesByTask();
    if (!total) return ctx.reply("📭 কোনো pending file নেই।");
    const kb = Markup.inlineKeyboard(
      groups.slice(0, 50).map((g) => [
        ib(`${String(g.title || "").slice(0, 30)} (${g.files.length})`, `pb_start:${g.taskId}`, "primary"),
      ])
    );
    return ctx.reply("🎯 <b>Process Good</b>\n\nকোন task-এর good file প্রসেস করবেন?", kbx(kb));
  })
);

bot.action(
  /^pb_start:(.+)$/,
  adminCb(async (ctx) => {
    await ctx.answerCbQuery();
    await setSession(ctx.from.id, { action: "pb_wait_file", taskId: ctx.match[1] });
    return edit(
      ctx,
      "🎯 <b>Process Good File</b>\n\n📤 এখন good file পাঠান।\n\n📋 ফরম্যাট: এক কলামে good UID (প্রতি লাইনে একটি)\nঅথবা Excel/CSV যেখানে প্রথম কলামে UID আছে।\n\n🟢 শুধু এই ফাইলের account Good হয়ে balance পাবে।\n🔴 বাকি সব pending account Bad হবে।"
    );
  })
);

// প্রতিটা user-এর নিজের রিপোর্ট ফাইল — এক শিটে: Good রো সবুজ, Bad রো লাল
async function buildUserReport(task, fields, g, items) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ADQ Income Zone";
  wb.created = new Date();
  const ws = wb.addWorksheet("Report");
  ws.addRow(["#", ...fields.map((f) => f.label || f.key), "Status", "Earned (৳)"]);
  const hr = ws.getRow(1);
  hr.font = { bold: true, color: { argb: "FFFFFFFF" } };
  hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4338CA" } };
  hr.alignment = { horizontal: "center", vertical: "middle" };
  const ordered = [...items.filter((x) => x.good), ...items.filter((x) => !x.good)];
  ordered.forEach(({ s: sub, good }, i) => {
    const row = ws.addRow([i + 1, ...subValues(sub, fields), good ? "GOOD" : "BAD", good ? g.price : 0]);
    for (let c = 2; c <= 1 + fields.length; c++) {
      row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: good ? "FFBBF7D0" : "FFFECACA" } };
    }
    row.getCell(2 + fields.length).font = { bold: true, color: { argb: good ? "FF047857" : "FFB91C1C" } };
  });
  ws.addRow([]);
  [
    ["TOTAL SUBMIT", g.good + g.bad],
    ["TOTAL GOOD", g.good],
    ["TOTAL BAD", g.bad],
    ["TOTAL EARN", g.earned],
  ].forEach((r) => {
    ws.addRow(r).font = { bold: true };
  });
  for (let c = 1; c <= fields.length + 3; c++) ws.getColumn(c).width = c === 1 ? 6 : c <= fields.length + 1 ? 26 : 14;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function processBad(ctx, session) {
  const adminId = ctx.from.id;
  if (!(await isAdmin(adminId))) return ctx.reply("❌ Unknown command.");
  const doc = ctx.message.document;
  const ext = extOf(doc.file_name);
  if (!FILE_EXTS.includes(ext)) return ctx.reply("❌ শুধু .xlsx, .xls, .csv, .txt বা .tsv ফাইল দিন।");
  if ((doc.file_size || 0) > 19 * 1024 * 1024) return ctx.reply("❌ ফাইল ১৯MB-এর বেশি হতে পারবে না।");

  const waitMsg = await ctx.reply("⏳ Good file প্রসেস হচ্ছে...");
  const taskId = session.taskId;
  const buf = await downloadTg(ctx, doc.file_id);
  const goodSet = extractBadValues(buf, ext);
  if (!goodSet.size) return ctx.reply("❌ ফাইলে কোনো ডাটা পাওয়া যায়নি।");

  const tSnap = await db.collection("tasks").doc(taskId).get();
  if (!tSnap.exists) {
    await clearSession(adminId);
    return ctx.reply("❌ টাস্কটি পাওয়া যায়নি।");
  }
  const task = tSnap.data();
  const subsSnap = await db.collection("submissions").where("taskId", "==", taskId).where("status", "==", "pending").get();
  if (subsSnap.empty) {
    await clearSession(adminId);
    return ctx.reply("📭 এই task-এ কোনো pending submission নেই।");
  }

  // classify
  const groups = new Map();
  const verdict = new Map();
  const userItems = new Map();
  for (const d of subsSnap.docs) {
    const s = d.data();
    const tf = task.fields?.length ? task.fields : DEFAULT_FIELDS;
    let vals = tf.map((f) => s[f.key]);
    if (!vals.some((v) => norm(v))) {
      vals = Array.isArray(s.allCells) && s.allCells.length ? s.allCells : [s.uid, s.password, s.twoFA];
    }
    const cells = vals.map(norm).filter(Boolean);
    const isGood = cells.some((c) => goodSet.has(c));
    const bad = !isGood;
    verdict.set(d.id, bad ? "bad" : "good");
    const uid = String(s.userId);
    if (!groups.has(uid)) groups.set(uid, { userId: uid, username: s.username, good: 0, bad: 0, earned: 0, price: 0 });
    groups.get(uid)[bad ? "bad" : "good"]++;
    if (!userItems.has(uid)) userItems.set(uid, []);
    userItems.get(uid).push({ s, good: !bad });
  }

  if (![...verdict.values()].some((v) => v === "good")) {
    return ctx.reply("⚠️ Good file-এর কোনো account এই task-এর pending submission-এর সাথে মেলেনি।\nফাইল ভুল হতে পারে — কিছুই প্রসেস হয়নি।");
  }
  await clearSession(adminId);

  // pricing
  const normal = Number(task.pricePerAccount) || 0;
  const milestones = [...(task.milestones || [])].sort((a, b) => a.target - b.target);
  for (const g of groups.values()) {
    let price = normal;
    for (const m of milestones) if (g.good >= m.target) price = Number(m.price) || price;
    g.price = price;
    g.earned = round2(g.good * price);
  }

  // existing users
  const gl = [...groups.values()];
  const existingUsers = new Set();
  for (let i = 0; i < gl.length; i += 100) {
    const snaps = await db.getAll(...gl.slice(i, i + 100).map((g) => userRef(g.userId)));
    snaps.forEach((s) => {
      if (s.exists) {
        existingUsers.add(s.id);
        const g = groups.get(s.id);
        if (g && s.get("username")) g.username = s.get("username");
      }
    });
  }

  const now = Timestamp.now();
  const ops = [];
  for (const d of subsSnap.docs) {
    const s = d.data();
    const v = verdict.get(d.id);
    const price = groups.get(String(s.userId)).price;
    ops.push((b) => b.update(d.ref, { status: v, earned: v === "good" ? price : 0, checkedAt: now, processedBy: adminId }));
  }
  for (const g of gl) {
    if (!existingUsers.has(g.userId)) continue;
    ops.push((b) => b.update(userRef(g.userId), {
      balance: FieldValue.increment(g.earned),
      totalGood: FieldValue.increment(g.good),
      totalBad: FieldValue.increment(g.bad),
      totalPending: FieldValue.increment(-(g.good + g.bad)),
    }));
  }
  const filesSnap = await db.collection("submitted_files").where("taskId", "==", taskId).where("status", "==", "pending").get();
  filesSnap.docs.forEach((d) => ops.push((b) => b.update(d.ref, { status: "processed", processedAt: now })));

  const totalGood = gl.reduce((s, g) => s + g.good, 0);
  const totalBad = gl.reduce((s, g) => s + g.bad, 0);
  const totalPayout = round2(gl.reduce((s, g) => s + g.earned, 0));

  ops.push((b) => b.set(db.collection("reports").doc(), {
    taskId, taskTitle: task.title || "", platform: task.platform || "", pricePerAccount: normal,
    goodCount: totalGood, badCount: totalBad, totalPayout, totalEarned: totalPayout, pendingCount: 0,
    date: new Date().toISOString(), publishedAt: now,
    perUser: gl.map((g) => ({ userId: g.userId, username: g.username, good: g.good, bad: g.bad, earned: g.earned })),
  }));

  await commitOps(ops);
  ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

  // admin report
  const lines = gl.map((g) => `👤 ${esc(g.username)}: 🟢${g.good} 🔴${g.bad} — ${tk(g.earned)}`);
  const report = `✅ <b>Processing Complete!</b>\n\n📋 Task: <b>${esc(task.title)}</b>\n📅 ${fmtDate(now)}\n\n📊 <b>Summary:</b>\n🟢 Good: ${totalGood}\n🔴 Bad: ${totalBad}\n📦 Total: ${totalGood + totalBad}\n💰 Payout: ${tk(totalPayout)}\n\n👥 <b>Per User:</b>\n${lines.join("\n")}`;
  await sendLong(ctx, report, { reply_markup: adminMenu.reply_markup });

  // প্রতিটা user-কে Litterbox লিংক সহ রিপোর্ট পাঠানো
  const fieldsList = task.fields?.length ? task.fields : DEFAULT_FIELDS;
  const stamp = fmtDate(new Date());
  const dateStr = stampForFile();

  await ctx.reply("⏳ ইউজারদের রিপোর্ট ফাইল আপলোড করে লিংক পাঠানো হচ্ছে...");

  for (const g of gl) {
    if (!/^\d+$/.test(g.userId)) continue;
    const totals = totalsBlock(g.good + g.bad, g.good, g.bad, g.earned);

    try {
      const rbuf = await buildUserReport(task, fieldsList, g, userItems.get(g.userId) || []);
      const fileName = `${slugOf(task.title)}_result_${g.userId}_${dateStr}.xlsx`;

      const uploaded = await uploadToPutPut(rbuf, fileName);
      if (!uploaded) throw new Error("Link generation failed");

      const msgText = `🔗 <b>Report File Download Link:</b>\n${uploaded.link}\n\n📋 Task: ${esc(task.title)}\n📅 Date: ${stamp}\n\n${totals}\n\n<i>⚠️ Report File ৩ থেকে ৭ দিন সচল থাকবে। তাই ফাইলটি ডাউনলোড করে নিজের ডিভাইসে সেভ করে রাখুন অথবা রিপোর্ট দেখুন।</i>`;
      await bot.telegram.sendMessage(Number(g.userId), msgText, { parse_mode: "HTML", disable_web_page_preview: true });
    } catch (e) {
      console.error(`report link failed (${g.userId}):`, e.message);
      await dm(g.userId, `📊 <b>রেজাল্ট প্রস্তুত!</b>\n\n📋 ${esc(task.title)}\n📅 ${stamp}\n\n${totals}\n\n⚠️ ফাইল লিংক তৈরি করতে সমস্যা হয়েছে।`);
    }
    await sleep(3000);
  }
}

/* ---- Withdrawals ---- */
bot.hears(
  ABTN.wd,
  adminOnly(async (ctx) => {
    const snap = await db.collection("withdrawals").where("status", "==", "pending").get();
    if (snap.empty) return ctx.reply("📭 কোনো pending withdraw নেই।");
    const docs = snap.docs
      .sort((a, b) => (toDate(a.get("requestedAt"))?.getTime() || 0) - (toDate(b.get("requestedAt"))?.getTime() || 0))
      .slice(0, 10);
    for (const d of docs) {
      const w = d.data();
      const kb = Markup.inlineKeyboard([
        [ib("Approve", `wdp_ok:${d.id}`, "success"), ib("Reject", `wdp_no:${d.id}`, "danger")],
      ]);
      await ctx.reply(
        `💸 Withdraw Request\n\n👤 ${w.username}\n🆔 ${w.userId}\n💰 ${tk(w.amount)}\n💳 ${String(w.method).toUpperCase()}\n📱 ${w.accountNum}\n🕐 ${fmtDate(w.requestedAt)}`,
        { reply_markup: kb.reply_markup }
      );
    }
    if (snap.size > docs.length) await ctx.reply(`… আরও ${snap.size - docs.length}টি pending আছে।`);
  })
);

bot.action(
  /^wdp_ok:(.+)$/,
  adminCb(async (ctx) => {
    const ref = db.collection("withdrawals").doc(ctx.match[1]);
    let w;
    try {
      await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists) throw new Error("NOT_FOUND");
        w = s.data();
        if (w.status !== "pending") throw new Error("DONE");
        tx.update(ref, { status: "approved", approvedAt: Timestamp.now(), approvedBy: ctx.from.id });
      });
    } catch (e) {
      if (e.message === "NOT_FOUND" || e.message === "DONE") {
        return ctx.answerCbQuery(e.message === "DONE" ? "⚠️ আগেই প্রসেস হয়েছে।" : "❌ পাওয়া যায়নি।", {
          show_alert: true,
        });
      }
      throw e;
    }
    await ctx.answerCbQuery("🟢 Approved");
    await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n🟢 APPROVED`).catch(() => {});
    await dm(
      w.userId,
      `✅ <b>Withdraw Approved!</b>\n\n💰 ${tk(w.amount)}\n💳 ${esc(String(w.method).toUpperCase())}\n📱 ${esc(w.accountNum)}\n\nশীঘ্রই পেমেন্ট পাবেন। ধন্যবাদ! 🎉`
    );
  })
);

bot.action(
  /^wdp_no:(.+)$/,
  adminCb(async (ctx) => {
    const ref = db.collection("withdrawals").doc(ctx.match[1]);
    let w;
    try {
      await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (!s.exists) throw new Error("NOT_FOUND");
        w = s.data();
        if (w.status !== "pending") throw new Error("DONE");
        const uref = userRef(w.userId);
        const us = await tx.get(uref);
        tx.update(ref, { status: "rejected", rejectedAt: Timestamp.now(), rejectedBy: ctx.from.id });
        if (us.exists) tx.update(uref, { balance: round2((Number(us.get("balance")) || 0) + Number(w.amount)) });
      });
    } catch (e) {
      if (e.message === "NOT_FOUND" || e.message === "DONE") {
        return ctx.answerCbQuery(e.message === "DONE" ? "⚠️ আগেই প্রসেস হয়েছে।" : "❌ পাওয়া যায়নি।", {
          show_alert: true,
        });
      }
      throw e;
    }
    await ctx.answerCbQuery("🔴 Rejected");
    await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n🔴 REJECTED`).catch(() => {});
    await dm(
      w.userId,
      `🔴 <b>Withdraw Rejected</b>\n\n💰 ${tk(w.amount)} আপনার ব্যালেন্সে ফেরত দেওয়া হয়েছে।\n\nপ্রশ্ন থাকলে admin-এর সাথে যোগাযোগ করুন।`
    );
  })
);

/* ---- Badges ---- */
bot.hears(
  ABTN.badges,
  adminOnly(async (ctx) => {
    await setSession(ctx.from.id, { action: "badge_username" });
    return ctx.reply("🎖️ কার badge দিতে চান? Username লিখুন:");
  })
);

/* ---- Broadcast ---- */
bot.hears(
  ABTN.bc,
  adminOnly(async (ctx) => {
    await setSession(ctx.from.id, { action: "bc_compose" });
    return ctx.reply("📢 <b>Broadcast</b>\n\nযে message পাঠাতে চান সেটা লিখুন।\n\n⚠️ সব user-এর কাছে যাবে।", {
      parse_mode: "HTML",
    });
  })
);

bot.action(
  "bc_yes",
  adminCb(async (ctx) => {
    const s = await getSession(ctx.from.id);
    if (!s || s.action !== "bc_confirm" || !s.message) {
      return ctx.answerCbQuery("⚠️ কোনো pending broadcast নেই।", { show_alert: true });
    }
    await ctx.answerCbQuery();
    await clearSession(ctx.from.id);
    const message = s.message;
    const chatId = ctx.callbackQuery.message.chat.id;
    const msgId = ctx.callbackQuery.message.message_id;
    const upd = (text) =>
      ctx.telegram.editMessageText(chatId, msgId, undefined, text, { parse_mode: "HTML" }).catch(() => {});

    runBg(
      ctx,
      async () => {
        await db.collection("notices").add({
          title: "📢 Admin Broadcast",
          message,
          apkUrl: null,
          linkUrl: null,
          active: true,
          createdAt: Timestamp.now(),
          source: "telegram_broadcast",
        });
        const snap = await db.collection("users").select("telegramId", "role").get();
        const targets = snap.docs.filter((d) => d.get("telegramId") != null && d.get("role") !== "admin");
        const total = targets.length;
        let sent = 0;
        let failed = 0;
        await upd(`📢 Broadcast চলছে...\n\n⏳ 0/${total}`);
        for (let i = 0; i < total; i++) {
          const chat = Number(targets[i].get("telegramId")) || targets[i].id;
          try {
            await ctx.telegram.sendMessage(chat, message);
            sent++;
          } catch (e) {
            const retry = e.response?.parameters?.retry_after;
            if (retry) {
              await sleep((retry + 1) * 1000);
              try {
                await ctx.telegram.sendMessage(chat, message);
                sent++;
              } catch {
                failed++;
              }
            } else {
              failed++;
            }
          }
          if ((i + 1) % 20 === 0) {
            await sleep(1000);
            await upd(`📢 Broadcast চলছে...\n\n⏳ ${i + 1}/${total}\n🟢 Sent: ${sent}\n🔴 Failed: ${failed}`);
          }
        }
        await upd(`✅ <b>Broadcast Complete!</b>\n\n🟢 Sent: ${sent}\n🔴 Failed: ${failed}\n📊 Total: ${total}`);
      },
      false
    );
  })
);

bot.action(
  "bc_no",
  adminCb(async (ctx) => {
    await ctx.answerCbQuery();
    await clearSession(ctx.from.id);
    return edit(ctx, "🔴 Broadcast বাতিল হয়েছে।");
  })
);

/* ---- Settings ---- */
bot.hears(
  ABTN.settings,
  adminOnly(async (ctx) => {
    const c = await getWdConfig();
    return ctx.reply(
      `⚙️ <b>Settings</b>\n\n💰 Min Withdraw: ${tk(c.minWithdraw)}\n📈 Max Withdraw: ${tk(c.maxWithdraw)}\n🟢 Enabled: ${c.withdrawEnabled ? "হ্যাঁ" : "না"}\n\nআপডেট:\n/setcfg minWithdraw 100\n/setcfg maxWithdraw 50000\n/setcfg withdrawEnabled true`,
      { parse_mode: "HTML" }
    );
  })
);

bot.command(
  "setcfg",
  adminOnly(async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const key = parts[1];
    const raw = parts.slice(2).join(" ");
    if (!key || !raw || !/^\w+$/.test(key)) {
      return ctx.reply("⚠️ ব্যবহার: /setcfg <key> <value>\nযেমন: /setcfg minWithdraw 100");
    }
    let val;
    if (raw === "true") val = true;
    else if (raw === "false") val = false;
    else if (raw !== "" && Number.isFinite(Number(raw))) val = Number(raw);
    else val = raw;
    await db.collection("settings").doc("withdraw_config").set({ [key]: val }, { merge: true });
    return ctx.reply(`🟢 ${key} = ${val} সেট হয়েছে।`);
  })
);

/* ------------------------------------------------------------------ */
/*  ADMIN: USER MANAGE (খোঁজা · balance +/- · নতুন Telegram ID-তে সরানো) */
/* ------------------------------------------------------------------ */
const userCard = (u) => {
  const w = Object.entries(u.wallets || {})
    .filter(([m, x]) => METHODS[m] && x?.number)
    .map(([m, x]) => `${METHODS[m]}: ${x.number}`)
    .join(", ");
  return (
    `👤 <b>${esc(u.username)}</b>\n🆔 UID: <code>${u.id}</code>\n` +
    (u.telegramUsername ? `📛 @${esc(u.telegramUsername)}\n` : "") +
    `💰 Balance: ${tk(u.balance)}\n🟢 Good: ${u.totalGood || 0}  🔴 Bad: ${u.totalBad || 0}  🟡 Pending: ${u.totalPending || 0}\n💳 Wallet: ${esc(w || "নেই")}`
  );
};
const userCardKb = (id) =>
  Markup.inlineKeyboard([
    [ib("➕ Balance যোগ", `um_add:${id}`, "success"), ib("➖ Balance কাটুন", `um_sub:${id}`, "danger")],
    [ib("🔁 নতুন Telegram ID-তে সরান", `um_mv:${id}`, "primary")],
  ]);

bot.hears(
  ABTN.manage,
  adminOnly(async (ctx) => {
    await setSession(ctx.from.id, { action: "um_search" });
    return ctx.reply("🔎 <b>User Manage</b>\n\nUsername / Telegram ID (UID) / @telegram-username লিখুন:\n\nবাতিল: /menu", {
      parse_mode: "HTML",
    });
  })
);

bot.action(
  /^um_sel:(.+)$/,
  adminCb(async (ctx) => {
    await ctx.answerCbQuery();
    const u = await getUser(ctx.match[1]);
    if (!u) return edit(ctx, "❌ user পাওয়া যায়নি।");
    return edit(ctx, userCard(u), userCardKb(u.id));
  })
);

bot.action(
  /^um_(add|sub):(.+)$/,
  adminCb(async (ctx) => {
    await ctx.answerCbQuery();
    const [, op, uid] = ctx.match;
    const u = await getUser(uid);
    if (!u) return edit(ctx, "❌ user পাওয়া যায়নি।");
    await setSession(ctx.from.id, { action: "um_amount", op, uid });
    return ctx.reply(
      `${op === "add" ? "➕ যোগ" : "➖ কাটা"} — <b>${esc(u.username)}</b> (এখন ${tk(u.balance)})\n\nকত টাকা? (শুধু সংখ্যা, বাতিল: /menu)`,
      { parse_mode: "HTML" }
    );
  })
);

bot.action(
  /^um_mv:(.+)$/,
  adminCb(async (ctx) => {
    await ctx.answerCbQuery();
    const u = await getUser(ctx.match[1]);
    if (!u) return edit(ctx, "❌ user পাওয়া যায়নি।");
    await setSession(ctx.from.id, { action: "um_newid", oldId: u.id });
    return ctx.reply(
      `🔁 <b>${esc(u.username)}</b> (UID <code>${u.id}</code>)-এর সব ডাটা নতুন Telegram ID-তে যাবে।\n\n1️⃣ ইউজারকে নতুন অ্যাকাউন্টে বট /start দিতে বলুন\n2️⃣ তার নতুন Telegram ID (শুধু সংখ্যা) এখানে লিখুন:\n\nবাতিল: /menu`,
      { parse_mode: "HTML" }
    );
  })
);

bot.action(
  "um_no",
  adminCb(async (ctx) => {
    await ctx.answerCbQuery();
    await clearSession(ctx.from.id);
    return edit(ctx, "⚪ বাতিল হয়েছে।");
  })
);

bot.action(
  "um_mv_ok",
  adminCb(async (ctx) => {
    const s = await getSession(ctx.from.id);
    if (!s || s.action !== "um_mv_confirm") {
      return ctx.answerCbQuery("⚠️ সেশন শেষ। আবার চেষ্টা করুন।", { show_alert: true });
    }
    await ctx.answerCbQuery();
    await clearSession(ctx.from.id);
    await edit(ctx, "⏳ ডাটা সরানো হচ্ছে...");
    return runBg(ctx, () => moveUser(ctx, s.oldId, s.newId));
  })
);

async function isEmptyAccount(uid, data) {
  if (!data) return true;
  if ((Number(data.balance) || 0) > 0 || (Number(data.totalGood) || 0) > 0 || (Number(data.totalBad) || 0) > 0 || (Number(data.totalPending) || 0) > 0) return false;
  const sub = await db.collection("submissions").where("userId", "==", String(uid)).limit(1).get();
  return sub.empty;
}

async function moveUser(ctx, oldId, newId) {
  const [oldSnap, newSnap] = await Promise.all([userRef(oldId).get(), userRef(newId).get()]);
  if (!oldSnap.exists) return ctx.reply("❌ পুরনো user পাওয়া যায়নি।");
  const old = oldSnap.data();
  const nu = newSnap.exists ? newSnap.data() : null; // নতুন ID-তে আগে থেকে অ্যাকাউন্ট থাকলে মার্জ হবে
  const now = Timestamp.now();
  const sum = (k) => (Number(old[k]) || 0) + (Number(nu?.[k]) || 0);
  const earlier = [old.createdAt, nu?.createdAt]
    .filter(Boolean)
    .sort((x, y) => (toDate(x)?.getTime() || 0) - (toDate(y)?.getTime() || 0))[0];
  const data = {
    ...old,
    telegramId: Number(newId),
    telegramUsername: nu?.telegramUsername ?? null,
    telegramLinkedAt: now,
    role: old.role === "admin" || nu?.role === "admin" ? "admin" : "user",
    balance: round2(sum("balance")),
    totalGood: sum("totalGood"),
    totalBad: sum("totalBad"),
    totalPending: sum("totalPending"),
    referCount: sum("referCount"),
    totalReferEarning: round2(sum("totalReferEarning")),
    wallets: { ...(old.wallets || {}), ...(nu?.wallets || {}) },
    customBadge: nu?.customBadge ?? old.customBadge ?? null,
    customBadgeColor: nu?.customBadgeColor ?? old.customBadgeColor ?? null,
    referredBy: nu?.referredBy ?? old.referredBy ?? null,
    createdAt: earlier ?? now,
  };
  const [subs, wds, files, refd] = await Promise.all([
    db.collection("submissions").where("userId", "==", String(oldId)).select().get(),
    db.collection("withdrawals").where("userId", "==", String(oldId)).select().get(),
    db.collection("submitted_files").where("userId", "==", String(oldId)).select().get(),
    db.collection("users").where("referredBy", "==", String(oldId)).select().get(),
  ]);
  const ops = [(b) => b.set(userRef(newId), data)];
  [...subs.docs, ...wds.docs, ...files.docs].forEach((d) => ops.push((b) => b.update(d.ref, { userId: String(newId) })));
  refd.docs.forEach((d) => ops.push((b) => b.update(d.ref, { referredBy: String(newId) })));
  ops.push((b) => b.delete(sessRef(oldId)));
  ops.push((b) => b.delete(userRef(oldId)));
  await commitOps(ops);

  await ctx.reply(
    `✅ <b>${nu ? "মার্জ সম্পন্ন!" : "সরানো সম্পন্ন!"}</b>\n\n👤 ${esc(old.username)}\n🆔 ${oldId} ➜ <code>${newId}</code>\n💰 Balance: ${nu ? `${tk(old.balance)} + ${tk(nu.balance)} = ${tk(data.balance)}` : tk(old.balance)}\n📋 ${subs.size} submissions • 💸 ${wds.size} withdrawals`,
    { parse_mode: "HTML", reply_markup: adminMenu.reply_markup }
  );
  await dm(
    newId,
    `✅ <b>আপনার অ্যাকাউন্ট এই Telegram ID-তে সরানো হয়েছে!</b>\n\n💰 Balance: ${tk(data.balance)}\n🟢 Good: ${data.totalGood || 0}  🔴 Bad: ${data.totalBad || 0}\n\nমেনু দেখতে /menu দিন।`
  );
}

/* ------------------------------------------------------------------ */
/*  ADMIN: TASKS  (website না থাকলে task এখান থেকেই বানাতে হবে)         */
/* ------------------------------------------------------------------ */
const PLATFORMS = ["Facebook", "Twitter", "Instagram", "LinkedIn", "TikTok", "Gmail", "WhatsApp", "Other"];
const ADDTASK_FORMAT =
  "➕ নতুন Task বানাতে এই ফরম্যাটে পাঠান:\n\n" +
  "/addtask\nTitle: Facebook Account Create\nPrice: 6\nPlatform: Facebook\n" +
  "Start: 2026-11-16 10:00\nEnd: 2026-11-17 22:00\nMilestones: 500:7, 1000:8\n" +
  "Fields: UID, Password, 2FA Key\nDescription: ছোট বিবরণ\nRules: প্রথম লাইন\nদ্বিতীয় লাইন\n\n" +
  "Title, Price, Start, End বাধ্যতামূলক। বাকিগুলো ঐচ্ছিক (Fields না দিলে UID, Password, 2FA Key)।\n" +
  "সময় বাংলাদেশ সময়। Platform: " + PLATFORMS.join(", ");

const parseDhaka = (v) => {
  const m = String(v || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, "0")}:${m[5]}:00+06:00`);
  return isNaN(d.getTime()) ? null : d;
};
const makeFieldKey = (label) =>
  String(label).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").substring(0, 20) ||
  "f_" + crypto.randomBytes(3).toString("hex");

bot.command(
  "addtask",
  adminOnly(async (ctx) => {
    const body = ctx.message.text.replace(/^\/addtask(@\w+)?/i, "").trim();
    if (!body) return ctx.reply(ADDTASK_FORMAT);
    const map = {};
    let last = null;
    for (const line of body.split(/\r?\n/)) {
      const m = line.match(/^\s*(title|description|price|platform|start|end|milestones|fields|rules)\s*:\s*(.*)$/i);
      if (m) {
        last = m[1].toLowerCase();
        map[last] = m[2];
      } else if (last === "rules" || last === "description") {
        map[last] += "\n" + line;
      }
    }
    const title = (map.title || "").trim();
    const price = Number(map.price);
    const start = parseDhaka(map.start);
    const end = parseDhaka(map.end);
    if (!title) return ctx.reply("❌ Title দিন।\n\n" + ADDTASK_FORMAT);
    if (!Number.isFinite(price) || price <= 0) return ctx.reply("❌ Price সঠিক নয়।");
    if (!start || !end) return ctx.reply("❌ Start/End ফরম্যাট ভুল। যেমন: 2026-11-16 10:00");
    if (start >= end) return ctx.reply("❌ End time Start-এর পরে হতে হবে।");
    let platform = PLATFORMS.find((p) => p.toLowerCase() === String(map.platform || "").trim().toLowerCase()) || "Other";

    const milestones = String(map.milestones || "")
      .split(",")
      .map((x) => x.split(":"))
      .filter((p) => p.length === 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
      .map((p) => ({ target: parseInt(p[0], 10), price: Number(p[1]) }))
      .sort((a, b) => a.target - b.target);

    const labels = String(map.fields || "UID, Password, 2FA Key").split(",").map((x) => x.trim()).filter(Boolean);
    const used = new Set();
    const fields = labels.map((label) => {
      let key = makeFieldKey(label);
      const base = key;
      let n = 1;
      while (used.has(key)) key = `${base}_${n++}`;
      used.add(key);
      return { key, label };
    });
    if (!fields.length) return ctx.reply("❌ কমপক্ষে একটা field দিন।");

    const ref = await db.collection("tasks").add({
      title,
      description: (map.description || "").trim(),
      pricePerAccount: price,
      milestones,
      platform,
      fields,
      rules: (map.rules || "").trim(),
      startTime: Timestamp.fromDate(start),
      endTime: Timestamp.fromDate(end),
      active: true,
      createdAt: Timestamp.now(),
    });
    return ctx.reply(
      `🟢 Task তৈরি হয়েছে!\n\n📋 ${title}\n💰 ৳${money(price)}/account\n📝 Fields: ${labels.join(" | ")}\n🔥 Milestones: ${
        milestones.length ? milestones.map((m) => `${m.target}=৳${m.price}`).join(", ") : "নেই"
      }\n⏰ ${fmtDate(start)} → ${fmtDate(end)}\n🆔 ${ref.id}`
    );
  })
);

// সময় শেষ হওয়া task অটো active:false হয়ে যায় এবং লিস্ট থেকে সরে যায়
bot.hears(
  ABTN.tasks,
  adminOnly(async (ctx) => {
    const snap = await db.collection("tasks").where("active", "==", true).get();
    const nowMs = Date.now();
    const isExpired = (d) => {
      const e = toDate(d.get("endTime"));
      return !!e && e.getTime() <= nowMs;
    };
    const expiredDocs = snap.docs.filter(isExpired);
    if (expiredDocs.length) {
      await commitOps(
        expiredDocs.map((d) => (b) => b.update(d.ref, { active: false, updatedAt: Timestamp.now() }))
      );
    }
    const tasks = snap.docs
      .filter((d) => !isExpired(d))
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0))
      .slice(0, 30);
    const head = "🎯 <b>Tasks</b>\n\n➕ নতুন task: /addtask পাঠান (ফরম্যাট দেখাবে)\n";
    if (!tasks.length) return ctx.reply(head + "\n📭 কোনো active task নেই।", { parse_mode: "HTML" });
    const lines = tasks.map(
      (t, i) => `${i + 1}. ${stateEmoji[taskState(t)]} ${esc(t.title)} — ৳${money(t.pricePerAccount)}`
    );
    const kb = Markup.inlineKeyboard(
      tasks.map((t) => [ib(`Close — ${String(t.title || "").slice(0, 25)}`, `tk_close:${t.id}`, "danger")])
    );
    return ctx.reply(`${head}\n${lines.join("\n")}`, kbx(kb));
  })
);

bot.action(
  /^tk_close:(.+)$/,
  adminCb(async (ctx) => {
    await db.collection("tasks").doc(ctx.match[1]).update({ active: false, updatedAt: Timestamp.now() });
    await ctx.answerCbQuery("🔴 Task বন্ধ হয়েছে");
    return edit(ctx, "🔴 Task বন্ধ করা হয়েছে।");
  })
);

/* ------------------------------------------------------------------ */
/*  ADMIN: WEBSITE DATA CLEANUP  (/cleanweb)                           */
/* ------------------------------------------------------------------ */
const isWebId = (id) => !/^\d+$/.test(String(id)); // Telegram ID = শুধু সংখ্যা, Firebase UID = অক্ষর+সংখ্যা

async function listAuthUids() {
  const uids = [];
  let token;
  do {
    const r = await admin.auth().listUsers(1000, token);
    uids.push(...r.users.map((u) => u.uid));
    token = r.pageToken;
  } while (token);
  return uids;
}

async function scanWebsiteData() {
  const [users, subs, wds, chats, sec, refs, adminPass, online] = await Promise.all([
    db.collection("users").select().get(),
    db.collection("submissions").select("userId").get(),
    db.collection("withdrawals").select("userId").get(),
    db.collection("chats").select().get(),
    db.collection("withdraw_security").select().get(),
    db.collection("refer_earnings").select().get(),
    db.collection("settings").doc("admin_pass").get(),
    db.collection("settings").doc("online_status").get(),
  ]);
  let authUids = [];
  try {
    authUids = await listAuthUids();
  } catch (e) {
    console.error("listUsers failed:", e.message);
  }
  const settingRefs = [adminPass, online].filter((d) => d.exists).map((d) => d.ref);
  return {
    users: users.docs.filter((d) => isWebId(d.id)).map((d) => d.ref),
    subs: subs.docs.filter((d) => isWebId(d.get("userId"))).map((d) => d.ref),
    wds: wds.docs.filter((d) => isWebId(d.get("userId"))).map((d) => d.ref),
    chats: chats.docs.map((d) => d.ref),
    sec: sec.docs.map((d) => d.ref),
    refs: refs.docs.map((d) => d.ref),
    settings: settingRefs,
    authUids,
  };
}

bot.command(
  "cleanweb",
  adminOnly(async (ctx) => {
    await ctx.reply("🔍 স্ক্যান হচ্ছে...");
    const r = await scanWebsiteData();
    const kb = Markup.inlineKeyboard([
      [ib("হ্যাঁ, মুছুন", "cw_yes", "danger"), ib("বাতিল", "cw_no", "danger")],
    ]);
    return ctx.reply(
      `🧹 <b>Website Data Cleanup</b>\n\n👥 Website users: ${r.users.length}\n📤 তাদের Submissions: ${r.subs.length}\n💸 তাদের Withdrawals: ${r.wds.length}\n💬 Chats: ${r.chats.length}\n🔐 withdraw_security: ${r.sec.length}\n🎁 refer_earnings: ${r.refs.length}\n⚙️ settings (admin_pass, online_status): ${r.settings.length}\n🔑 Firebase Auth login account: ${r.authUids.length}\n\n✅ <b>থাকবে:</b> Telegram users (numeric ID) ও তাদের সব ডাটা, tasks, notices, reports, withdraw_config, payment_methods।\n\n⚠️ <b>আগে নিশ্চিত করুন:</b> আপনার নিজের Telegram ID-র user doc-এ <code>role: "admin"</code> আছে (Firebase Console থেকে সেট করুন)। Website user-দের balance আর ফেরত আসবে না।`,
      kbx(kb)
    );
  })
);

bot.action(
  "cw_yes",
  adminCb(async (ctx) => {
    await ctx.answerCbQuery();
    await setSession(ctx.from.id, { action: "cw_confirm" });
    return edit(ctx, "⚠️ <b>চূড়ান্ত নিশ্চিতকরণ</b>\n\nUndo হবে না। চালিয়ে যেতে ঠিক এটা টাইপ করুন:\n<code>DELETE WEBSITE</code>\n\nবাতিল: /menu");
  })
);

bot.action(
  "cw_no",
  adminCb(async (ctx) => {
    await ctx.answerCbQuery();
    await clearSession(ctx.from.id);
    return edit(ctx, "⚪ Cleanup বাতিল হয়েছে।");
  })
);

async function doCleanWeb(ctx) {
  const r = await scanWebsiteData();
  await ctx.reply("🗑️ মুছা শুরু হচ্ছে...");
  await commitOps([...r.users, ...r.subs, ...r.wds, ...r.sec, ...r.refs, ...r.settings].map((ref) => (b) => b.delete(ref)));
  for (const c of r.chats) await db.recursiveDelete(c);
  let authDeleted = 0;
  for (let i = 0; i < r.authUids.length; i += 1000) {
    const res = await admin.auth().deleteUsers(r.authUids.slice(i, i + 1000));
    authDeleted += res.successCount;
  }
  await ctx.reply(
    `✅ <b>Cleanup সম্পন্ন!</b>\n\n👥 Users: ${r.users.length}\n📤 Submissions: ${r.subs.length}\n?? Withdrawals: ${r.wds.length}\n💬 Chats: ${r.chats.length}\n🔐 Security: ${r.sec.length}\n🎁 Refer earnings: ${r.refs.length}\n⚙️ Settings: ${r.settings.length}\n🔑 Auth accounts: ${authDeleted}`,
    { parse_mode: "HTML", reply_markup: adminMenu.reply_markup }
  );
}

/* ------------------------------------------------------------------ */
/*  EXPORT / IMPORT                                                    */
/* ------------------------------------------------------------------ */
const ser = (v) => {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v.toDate === "function") return { __ts: v.toDate().toISOString() };
  if (Array.isArray(v)) return v.map(ser);
  if (typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = ser(x);
    return o;
  }
  return v;
};
const deser = (v) => {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(deser);
  if (typeof v === "object") {
    if (typeof v.__ts === "string" && Object.keys(v).length === 1) {
      const d = new Date(v.__ts);
      return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
    }
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = deser(x);
    return o;
  }
  return v;
};
const sign = (obj) => crypto.createHmac("sha256", EXPORT_SECRET).update(JSON.stringify(obj)).digest("hex");

bot.command(
  "export",
  safe(async (ctx) => {
    const u = await needUser(ctx);
    if (!u) return;
    await ctx.reply("⏳ Backup তৈরি হচ্ছে...");
    const uid = String(ctx.from.id);
    const [subs, wds, r1, r2] = await Promise.all([
      db.collection("submissions").where("userId", "==", uid).get(),
      db.collection("withdrawals").where("userId", "==", uid).get(),
      db.collection("refer_earnings").where("userId", "==", uid).get().catch(() => ({ docs: [] })),
      db.collection("refer_earnings").where("referrerId", "==", uid).get().catch(() => ({ docs: [] })),
    ]);
    const refMap = new Map();
    [...r1.docs, ...r2.docs].forEach((d) => refMap.set(d.id, { _id: d.id, ...ser(d.data()) }));
    const { id: _ignore, ...userData } = u;
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      source: "ADQ Income Zone Bot",
      user: ser(userData),
      submissions: subs.docs.map((d) => ({ _id: d.id, ...ser(d.data()) })),
      withdrawals: wds.docs.map((d) => ({ _id: d.id, ...ser(d.data()) })),
      referEarnings: [...refMap.values()],
    };
    payload.signature = sign(payload);
    const name = String(u.username || "user").replace(/[^\w-]+/g, "_").slice(0, 30);
    return ctx.replyWithDocument(
      { source: Buffer.from(JSON.stringify(payload, null, 2)), filename: `adq_backup_${name}_${Date.now()}.json` },
      {
        caption: `📤 Backup Ready\n\n👤 ${u.username}\n📋 ${payload.submissions.length} submissions\n💸 ${payload.withdrawals.length} withdrawals\n\n⚠️ এই ফাইল সংরক্ষিত রাখুন।`,
      }
    );
  })
);

bot.command(
  "import",
  safe(async (ctx) => {
    await setSession(ctx.from.id, { action: "import_wait_file" });
    return ctx.reply("📥 <b>Data Import</b>\n\nআপনার পুরনো bot থেকে export করা .json ফাইল পাঠান।", {
      parse_mode: "HTML",
    });
  })
);

async function importBackup(ctx) {
  const doc = ctx.message.document;
  if (extOf(doc.file_name) !== "json") return ctx.reply("❌ শুধু .json backup ফাইল দিন।");
  if ((doc.file_size || 0) > MAX_FILE) return ctx.reply("❌ ফাইল ১৫MB-এর বেশি হতে পারবে না।");
  await ctx.reply("⏳ Import হচ্ছে...");

  let data;
  try {
    data = JSON.parse((await downloadTg(ctx, doc.file_id)).toString("utf8"));
  } catch {
    return ctx.reply("❌ ফাইলটি পড়া যাচ্ছে না — সঠিক JSON নয়।");
  }
  if (!data || data.version !== 1 || !data.user) {
    return ctx.reply("❌ এটি সঠিক ADQ backup ফাইল নয় (version মেলেনি)।");
  }
  const { signature, ...unsigned } = data;
  const expected = sign(unsigned);
  const sigOk =
    typeof signature === "string" &&
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!sigOk) return ctx.reply("❌ Backup যাচাই হয়নি (signature মেলেনি)। শুধু bot-এর নিজের export করা ফাইল চলবে।");

  const newId = ctx.from.id;
  const existing = await getUser(newId);
  if (existing) {
    const empty =
      !(Number(existing.balance) > 0) &&
      !(Number(existing.totalGood) > 0) &&
      !(Number(existing.totalBad) > 0) &&
      !(Number(existing.totalPending) > 0);
    const hasSubs = !(await db.collection("submissions").where("userId", "==", String(newId)).limit(1).get()).empty;
    if (!empty || hasSubs) {
      await clearSession(newId);
      return ctx.reply("⚠️ এই Telegram ID-তে আগে থেকেই ডাটা সহ অ্যাকাউন্ট আছে, তাই import করা গেল না।");
    }
  }

  const logRef = db.collection("import_logs").doc(signature);
  try {
    await logRef.create({ userId: String(newId), importedAt: Timestamp.now() });
  } catch (e) {
    if (e.code === 6) {
      await clearSession(newId);
      return ctx.reply("⚠️ এই backup আগেই import করা হয়েছে।");
    }
    throw e;
  }

  try {
    const b = deser(data.user) || {};
    const now = Timestamp.now();
    const uname = b.username || ctx.from.first_name || "User";
    const newUser = {
      username: uname,
      telegramId: newId,
      telegramUsername: ctx.from.username || null,
      email: null,
      role: existing?.role || "user",
      authProvider: "telegram",
      balance: Number(b.balance) || 0,
      totalGood: Number(b.totalGood) || 0,
      totalBad: Number(b.totalBad) || 0,
      totalPending: Number(b.totalPending) || 0,
      myReferCode: b.myReferCode || genReferCode(),
      referredBy: b.referredBy ?? null,
      referCount: Number(b.referCount) || 0,
      totalReferEarning: Number(b.totalReferEarning) || 0,
      wallets: b.wallets && typeof b.wallets === "object" ? b.wallets : {},
      customBadge: b.customBadge ?? null,
      customBadgeColor: b.customBadgeColor ?? null,
      createdAt: b.createdAt || now,
      telegramLinkedAt: now,
    };
    const ops = [(bt) => bt.set(userRef(newId), newUser)];
    const subs = Array.isArray(data.submissions) ? data.submissions : [];
    const wds = Array.isArray(data.withdrawals) ? data.withdrawals : [];
    for (const s of subs) {
      const { _id, ...rest } = deser(s) || {};
      ops.push((bt) =>
        bt.set(db.collection("submissions").doc(), { ...rest, userId: String(newId), username: uname })
      );
    }
    wds.forEach((w, i) => {
      const { _id, ...rest } = deser(w) || {};
      const ms = toDate(rest.requestedAt)?.getTime() || Date.now();
      ops.push((bt) =>
        bt.set(db.collection("withdrawals").doc(`${newId}_${ms}_${i}`), {
          ...rest,
          userId: String(newId),
          username: uname,
        })
      );
    });
    await commitOps(ops);
    await clearSession(newId);
    return ctx.reply(
      `✅ <b>Import সফল!</b>\n\n👤 ${esc(uname)}\n💰 Balance: ${tk(newUser.balance)}\n📋 ${subs.length} submissions\n💸 ${wds.length} withdrawals\n\n🆔 নতুন UID: <code>${newId}</code>`,
      await userKb(ctx.from.id)
    );
  } catch (e) {
    await logRef.delete().catch(() => {});
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/*  SESSION DISPATCHERS                                                */
/* ------------------------------------------------------------------ */
bot.on(
  "text",
  safe(async (ctx, next) => {
    const text = (ctx.message.text || "").trim();
    if (text.startsWith("/")) return next();
    const s = await getSession(ctx.from.id);
    if (!s) return next();
    const id = ctx.from.id;

    switch (s.action) {
      case "wd_account": {
        const method = s.method;
        const acc = normAccount(method, text);
        if (!METHODS[method]) return ctx.reply("⚠️ আবার /withdraw দিন।");
        if (!acc) {
          return ctx.reply(method === "binance" ? "🔴 Binance ID কমপক্ষে ৪ অক্ষরের হতে হবে।" : "🔴 সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।");
        }
        const [u, cfg] = await Promise.all([getUser(id), getWdConfig()]);
        if (!u) return ctx.reply("⚠️ আগে /start দিন।");
        await userRef(id).update({ [`wallets.${method}.number`]: acc });
        await setSession(id, { action: "wd_amount", method, account: acc });
        return ctx.reply(`✅ ${METHODS[method]} নম্বর সেভ হয়েছে।\n\n` + wdAmountText(method, acc, cfg, Number(u.balance) || 0), kbx(wdAmountKb(method)));
      }

      case "wd_amount": {
        const u = await getUser(id);
        if (!u) return ctx.reply("⚠️ আগে /start দিন।");
        const cfg = await getWdConfig();
        const amount = Number(bn2en(text).replace(/,/g, ""));
        if (!Number.isFinite(amount) || amount <= 0) return ctx.reply("⚠️ শুধু সংখ্যা লিখুন। যেমন: 500");
        if (amount < cfg.minWithdraw) return ctx.reply(`🔴 Minimum ${tk(cfg.minWithdraw)} তুলতে হবে।`);
        if (amount > cfg.maxWithdraw) return ctx.reply(`🔴 Maximum ${tk(cfg.maxWithdraw)} তুলতে পারবেন।`);
        if (amount > (Number(u.balance) || 0)) return ctx.reply(`🔴 যথেষ্ট balance নেই। আছে ${tk(u.balance)}।`);
        if (!METHODS[s.method] || !s.account) return ctx.reply("⚠️ আবার /withdraw দিন।");
        if (cfg.methods[s.method] === false) return ctx.reply("🔴 এই method এখন বন্ধ।");
        await setSession(id, { action: "wd_confirm", amount: round2(amount), method: s.method, account: s.account });
        const kb = Markup.inlineKeyboard([[ib("Confirm", "wd_ok", "success"), ib("Cancel", "wd_no", "danger")]]);
        return ctx.reply(
          `💸 <b>Confirm Withdraw</b>\n\n💰 Amount: ${tk(amount)}\n💳 Method: ${s.method.toUpperCase()}\n📱 Account: <code>${esc(s.account)}</code>\n\n🟢 Confirm করলে balance থেকে কাটা হবে।`,
          kbx(kb)
        );
      }

      case "badge_username": {
        if (!(await isAdmin(id))) {
          await clearSession(id);
          return ctx.reply("❌ Unknown command.", await userKb(id));
        }
        const q = await db.collection("users").where("username", "==", text).limit(1).get();
        if (q.empty) return ctx.reply("❌ এই username-এর কোনো user পাওয়া যায়নি। আবার লিখুন:");
        await setSession(id, { action: "badge_name", targetUid: q.docs[0].id });
        return ctx.reply("🎖️ Badge নাম লিখুন (যেমন: CHAMPION):");
      }

      case "badge_name": {
        if (!(await isAdmin(id))) {
          await clearSession(id);
          return ctx.reply("❌ Unknown command.", await userKb(id));
        }
        const badge = text.toUpperCase().slice(0, 20);
        await userRef(s.targetUid).update({ customBadge: badge, customBadgeColor: "#fbbf24" });
        await clearSession(id);
        return ctx.reply("🟢 Badge set হয়েছে!", kbx(adminMenu));
      }

      case "bc_compose": {
        if (!(await isAdmin(id))) {
          await clearSession(id);
          return ctx.reply("❌ Unknown command.", await userKb(id));
        }
        await setSession(id, { action: "bc_confirm", message: ctx.message.text });
        const kb = Markup.inlineKeyboard([
          [ib("Send All", "bc_yes", "success"), ib("Cancel", "bc_no", "danger")],
        ]);
        return ctx.reply(`📢 <b>Preview:</b>\n\n${esc(ctx.message.text)}\n\nসব user-কে পাঠাবেন?`, kbx(kb));
      }

      case "um_search": {
        if (!(await isAdmin(id))) {
          await clearSession(id);
          return ctx.reply("❌ Unknown command.", await userKb(id));
        }
        const q = text.replace(/^@/, "").trim();
        const ql = q.toLowerCase();
        let found = [];
        if (/^\d+$/.test(q)) {
          const u = await getUser(q);
          if (u) found.push({ id: u.id, username: u.username, telegramUsername: u.telegramUsername });
        }
        if (!found.length) {
          const snap = await db.collection("users").select("username", "telegramUsername").get();
          found = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter(
              (u) =>
                u.id.toLowerCase() === ql ||
                String(u.username || "").toLowerCase().includes(ql) ||
                String(u.telegramUsername || "").toLowerCase().includes(ql)
            )
            .slice(0, 10);
        }
        if (!found.length) return ctx.reply("❌ কোনো user পাওয়া যায়নি। আবার লিখুন (বাতিল: /menu):");
        await clearSession(id);
        if (found.length === 1) {
          const full = await getUser(found[0].id);
          return ctx.reply(userCard(full), kbx(userCardKb(full.id)));
        }
        const kb = Markup.inlineKeyboard(
          found.map((u) => [
            ib(`${String(u.username || "User").slice(0, 20)}${u.telegramUsername ? ` @${u.telegramUsername}` : ""} — ${u.id}`, `um_sel:${u.id}`),
          ])
        );
        return ctx.reply(`🔎 ${found.length}টি ফল — একজন বাছুন:`, kbx(kb));
      }

      case "um_amount": {
        if (!(await isAdmin(id))) {
          await clearSession(id);
          return ctx.reply("❌ Unknown command.", await userKb(id));
        }
        const amt = Number(bn2en(text).replace(/,/g, ""));
        if (!Number.isFinite(amt) || amt <= 0) return ctx.reply("⚠️ শুধু সংখ্যা লিখুন। যেমন: 100");
        const uref = userRef(s.uid);
        let after = 0;
        try {
          await db.runTransaction(async (tx) => {
            const sn = await tx.get(uref);
            if (!sn.exists) throw new Error("NO_USER");
            const bal = Number(sn.get("balance")) || 0;
            const nb = s.op === "add" ? bal + amt : bal - amt;
            if (nb < 0) {
              const e = new Error("LOW");
              e.bal = bal;
              throw e;
            }
            after = round2(nb);
            tx.update(uref, { balance: after });
          });
        } catch (e) {
          if (e.message === "LOW") {
            await clearSession(id);
            return ctx.reply(`🔴 ইউজারের balance ${tk(e.bal)} — এর বেশি কাটা যাবে না।`);
          }
          if (e.message === "NO_USER") {
            await clearSession(id);
            return ctx.reply("❌ user পাওয়া যায়নি।");
          }
          throw e;
        }
        await clearSession(id);
        await ctx.reply(`✅ ${s.op === "add" ? "যোগ" : "কাটা"} হয়েছে: ${tk(amt)}\n💰 নতুন balance: ${tk(after)}`, kbx(adminMenu));
        await dm(
          s.uid,
          `💰 <b>Balance আপডেট</b>\n\nAdmin আপনার ব্যালেন্সে ${tk(amt)} ${s.op === "add" ? "যোগ করেছে" : "কেটে নিয়েছে"}।\nনতুন Balance: ${tk(after)}`
        );
        return;
      }

      case "um_newid": {
        if (!(await isAdmin(id))) {
          await clearSession(id);
          return ctx.reply("❌ Unknown command.", await userKb(id));
        }
        const nid = text.trim();
        if (!/^\d{5,15}$/.test(nid)) return ctx.reply("⚠️ সঠিক Telegram ID (শুধু সংখ্যা) লিখুন।");
        if (nid === s.oldId) return ctx.reply("⚠️ এটা তো আগের ID-ই। নতুন ID লিখুন।");
        const [oldU, newU] = await Promise.all([getUser(s.oldId), getUser(nid)]);
        if (!oldU) {
          await clearSession(id);
          return ctx.reply("❌ পুরনো user পাওয়া যায়নি।");
        }
        await setSession(id, { action: "um_mv_confirm", oldId: s.oldId, newId: nid });
        const kb = Markup.inlineKeyboard([[ib("হ্যাঁ, সরান", "um_mv_ok", "success"), ib("বাতিল", "um_no", "danger")]]);
        return ctx.reply(
          `🔁 <b>নিশ্চিত করুন</b>\n\n👤 ${esc(oldU.username)}\n🆔 ${s.oldId} ➜ <code>${nid}</code>\n💰 Balance: ${newU ? `${tk(oldU.balance)} + ${tk(newU.balance)} = ${tk((Number(oldU.balance) || 0) + (Number(newU.balance) || 0))}` : tk(oldU.balance)}\n\n${newU ? "নতুন ID-তে আগে থেকেই অ্যাকাউন্ট আছে — দুটো মার্জ হবে (balance, Good/Bad, submissions, withdrawals সব যোগ হবে)। " : ""}পুরনো ID-র সব ডাটা নতুন ID-তে যাবে, আর পুরনো অ্যাকাউন্ট মুছে যাবে।`,
          kbx(kb)
        );
      }

      case "cw_confirm": {
        if (!(await isAdmin(id))) {
          await clearSession(id);
          return ctx.reply("❌ Unknown command.", await userKb(id));
        }
        await clearSession(id);
        if (text !== "DELETE WEBSITE") return ctx.reply("⚪ মেলেনি, Cleanup বাতিল হয়েছে।");
        return runBg(ctx, () => doCleanWeb(ctx));
      }

      case "submit_file":
      case "pb_wait_file":
      case "import_wait_file":
        return ctx.reply("📎 এখন ফাইল পাঠান। বাতিল করতে /menu দিন।");

      default:
        return next();
    }
  })
);

bot.on(
  "document",
  safe(async (ctx) => {
    const s = await getSession(ctx.from.id);
    if (!s) {
      return ctx.reply("📎 ফাইল সাবমিট করতে আগে \"📋 Task Submit\" থেকে টাস্ক সিলেক্ট করুন।");
    }
    switch (s.action) {
      case "submit_file":
        return runBg(ctx, () => submitFile(ctx, s));
      case "pb_wait_file":
        if (!(await isAdmin(ctx.from.id))) {
          await clearSession(ctx.from.id);
          return ctx.reply("❌ Unknown command.", await userKb(ctx.from.id));
        }
        return runBg(ctx, () => processBad(ctx, s));
      case "import_wait_file":
        return runBg(ctx, () => importBackup(ctx));
      default:
        return ctx.reply("⚠️ এখন ফাইলের দরকার নেই। /menu");
    }
  })
);

// fallback
bot.on(
  "text",
  safe(async (ctx) => {
    return ctx.reply("🤔 বুঝতে পারিনি। নিচের মেনু ব্যবহার করুন অথবা /menu দিন।", await userKb(ctx.from.id));
  })
);

bot.catch((err, ctx) => {
  console.error(`Unhandled bot error (${ctx?.updateType}):`, err);
});

/* ------------------------------------------------------------------ */
/*  LAUNCH + STARTUP SETUP                                             */
/* ------------------------------------------------------------------ */
bot.launch({ dropPendingUpdates: true }).catch((e) => {
  console.error("Launch failed:", e);
  process.exit(1);
});

(async () => {
  try {
    await bot.telegram.setChatMenuButton({ menu_button: { type: "commands" } });
    // /adqincomezone is intentionally NOT listed here
    await bot.telegram.setMyCommands([
      { command: "start", description: "অ্যাকাউন্ট তৈরি / শুরু" },
      { command: "menu", description: "মেইন মেনু" },
      { command: "tasks", description: "টাস্ক লিস্ট" },
      { command: "balance", description: "ব্যালেন্স" },
      { command: "withdraw", description: "টাকা তোলা" },
      { command: "history", description: "হিস্টোরি" },
      { command: "leaderboard", description: "টপ ইউজার" },
      { command: "profile", description: "প্রোফাইল" },
      { command: "refer", description: "রেফার" },
      { command: "help", description: "সাহায্য" },
    ]);
    console.log("✅ ADQ Bot started");
  } catch (e) {
    console.error("Startup setup failed:", e.message);
  }
})();

const shutdown = (sig) => {
  console.log(`${sig} received, shutting down...`);
  try {
    bot.stop(sig);
  } catch {
    /* ignore */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
