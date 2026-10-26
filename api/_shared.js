// ==================================================
// api/_shared.js — সব API ফাংশনের কমন কোড
// (নামের শুরুতে _ থাকায় Vercel এটাকে আলাদা endpoint বানায় না)
// ==================================================
import admin from "firebase-admin";

export { admin };

export const ALLOWED_METHODS = ["bkash", "nagad", "rocket", "binance"];
export const DEFAULT_MIN_WITHDRAW = 100;
export const DEFAULT_MAX_WITHDRAW = 50000;

// পুরনো ফাইলের সাথে compatibility (এগুলো না থাকলে পুরনো import ভেঙে যায়)
export const MIN_WITHDRAW = DEFAULT_MIN_WITHDRAW;
export const ACCOUNT_RE = /^(?:\+?88)?01[3-9]\d{8}$/;

const SITE = "https://adq-income-zone.vercel.app";
// এটা Firebase-এর public web key (firebase.js এ যেটা আছে) — গোপন কিছু না
const webKey = () => process.env.FIREBASE_API_KEY || "AIzaSyCffmDp9xRUcLkqe5q4NiQubaT0iMIlDm4";

export function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export function getDb() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT env missing");
    let sa;
    try { sa = JSON.parse(raw); }
    catch (e) { throw new Error("FIREBASE_SERVICE_ACCOUNT সঠিক JSON না (পুরো JSON এক লাইনে paste করুন)"); }
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  return admin.firestore();
}

export async function verifyUser(req) {
  getDb();
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email };
  } catch (e) {
    console.error("Token verify error:", e.message);
    return null;
  }
}

// মেথড অনুযায়ী অ্যাকাউন্ট নম্বর যাচাই + পরিষ্কার করা। ভুল হলে null
export function normalizeAccount(method, raw) {
  const s = String(raw || "").trim();
  if (method === "binance") return /^[A-Za-z0-9_.@:+-]{4,80}$/.test(s) ? s : null;
  const d = s.replace(/[\s-]/g, "");
  const m = d.match(/^(?:\+?88)?(01[3-9]\d{8})$/);
  return m ? m[1] : null;
}

// Firestore Timestamp / ISO string / Date — সবকিছুকে milliseconds এ
export function toMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

// Admin যা সেট করেছে (min/max/on-off/মেথড) সেটাই মানা হবে
export async function getWithdrawConfig(db) {
  const cfg = {
    enabled: true,
    min: DEFAULT_MIN_WITHDRAW,
    max: DEFAULT_MAX_WITHDRAW,
    methods: { bkash: true, nagad: true, rocket: true, binance: true }
  };
  try {
    const [w, p] = await Promise.all([
      db.doc("settings/withdraw_config").get(),
      db.doc("settings/payment_methods").get()
    ]);
    if (w.exists) {
      const d = w.data();
      cfg.enabled = d.withdrawEnabled !== false;
      cfg.min = Number(d.minWithdraw) || DEFAULT_MIN_WITHDRAW;
      cfg.max = Number(d.maxWithdraw) || DEFAULT_MAX_WITHDRAW;
    }
    if (p.exists) cfg.methods = { ...cfg.methods, ...p.data() };
  } catch (e) { console.error("getWithdrawConfig:", e.message); }
  return cfg;
}

// রিটার্ন: "ok" | "bad" (ভুল পাসওয়ার্ড) | "toomany" | "error" (কনফিগ/নেটওয়ার্ক সমস্যা — ইউজারের দোষ না)
export async function verifyPassword(email, password) {
  if (!email || !password) return "bad";
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${webKey()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Referer": SITE + "/" },
        body: JSON.stringify({ email, password, returnSecureToken: false })
      }
    );
    if (r.ok) return "ok";
    const d = await r.json().catch(() => null);
    const msg = String(d?.error?.message || "");
    if (msg.includes("TOO_MANY_ATTEMPTS")) return "toomany";
    // ⚠️ আগে সব 400-কেই "ভুল পাসওয়ার্ড" ধরা হতো — API key ভুল হলেও ইউজার লক হয়ে যেত।
    if (/INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND/.test(msg)) return "bad";
    console.error("verifyPassword config/unexpected:", r.status, msg);
    return "error";
  } catch (e) {
    console.error("verifyPassword fetch error:", e.message);
    return "error";
  }
}

// ইউজারের ইমেইলে পাসওয়ার্ড রিসেট লিংক পাঠানো (সার্ভার থেকেই, তাই সফল/ব্যর্থ সঠিক জানা যায়)
export async function sendResetEmail(email) {
  if (!email) return false;
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${webKey()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Referer": SITE + "/" },
        body: JSON.stringify({ requestType: "PASSWORD_RESET", email })
      }
    );
    if (!r.ok) {
      const d = await r.json().catch(() => null);
      console.error("sendResetEmail failed:", r.status, d?.error?.message);
    }
    return r.ok;
  } catch (e) {
    console.error("sendResetEmail error:", e.message);
    return false;
  }
}
