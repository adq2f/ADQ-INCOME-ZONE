// ==================================================
// api/withdraw.js — নিরাপদ উইথড্র (পাসওয়ার্ড যাচাই + transaction)
// ==================================================
import {
  admin, getDb, setCors, verifyUser, verifyPassword,
  getWithdrawConfig, normalizeAccount, ALLOWED_METHODS
} from "./_shared.js";

export const config = { maxDuration: 15 };

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const METHOD_NAMES = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", binance: "Binance" };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, reply: "Method not allowed" });

  let db;
  try { db = getDb(); }
  catch (e) {
    console.error("Firebase init error:", e.message);
    return res.status(500).json({ ok: false, reply: "সার্ভার কনফিগারেশনে সমস্যা আছে।" });
  }

  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ ok: false, reply: "আবার লগইন করুন।" });

  const b = req.body || {};
  const amount = Math.round(Number(b.amount) * 100) / 100;
  const method = String(b.method || "").toLowerCase().trim();
  const requestId = String(b.requestId || "");
  const password = typeof b.password === "string" ? b.password : "";

  if (!ALLOWED_METHODS.includes(method))
    return res.status(400).json({ ok: false, reply: "❌ মেথড সঠিক নয়।" });
  const account = normalizeAccount(method, b.account);
  if (!account)
    return res.status(400).json({ ok: false, reply: "❌ অ্যাকাউন্ট নম্বর সঠিক নয়।" });
  if (!Number.isFinite(amount) || amount <= 0)
    return res.status(400).json({ ok: false, reply: "❌ সঠিক টাকার পরিমাণ দিন।" });
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId))
    return res.status(400).json({ ok: false, reply: "❌ রিকোয়েস্ট সঠিক নয়। আবার চেষ্টা করুন।" });
  if (!password)
    return res.status(400).json({ ok: false, reply: "❌ পাসওয়ার্ড দিন।" });

  // ---------- Admin এর সেটিং মানা ----------
  const cfg = await getWithdrawConfig(db);
  if (!cfg.enabled)
    return res.status(403).json({ ok: false, reply: "🚫 এখন উইথড্র বন্ধ আছে। পরে চেষ্টা করুন।" });
  if (cfg.methods[method] === false)
    return res.status(403).json({ ok: false, reply: `🚫 ${METHOD_NAMES[method]} দিয়ে এখন উইথড্র বন্ধ আছে।` });
  if (amount < cfg.min)
    return res.status(400).json({ ok: false, reply: `❌ সর্বনিম্ন উইথড্র ৳${cfg.min}।` });
  if (amount > cfg.max)
    return res.status(400).json({ ok: false, reply: `❌ সর্বোচ্চ উইথড্র ৳${cfg.max}।` });

  // ---------- লক চেক ----------
  const secRef = db.doc(`withdraw_security/${user.uid}`);
  let sec = {};
  try { sec = (await secRef.get()).data() || {}; } catch (e) { console.error("sec read:", e); }

  if (sec.lockedUntil && sec.lockedUntil > Date.now()) {
    const mins = Math.ceil((sec.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ ok: false, reply: `🔒 অনেকবার ভুল পাসওয়ার্ড দেওয়া হয়েছে। ${mins} মিনিট পর আবার চেষ্টা করুন।` });
  }

  // ---------- পাসওয়ার্ড যাচাই ----------
  const pw = await verifyPassword(user.email, password);

  if (pw === "toomany")
    return res.status(429).json({ ok: false, reply: "🔒 অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।" });
  if (pw === "error")
    return res.status(503).json({ ok: false, reply: "⚠️ পাসওয়ার্ড যাচাই করা যায়নি (সার্ভার সমস্যা)। আবার চেষ্টা করুন।" });
  if (pw === "bad") {
    const fails = (Number(sec.fails) || 0) + 1;
    try {
      if (fails >= MAX_FAILS) {
        await secRef.set({ fails: 0, lockedUntil: Date.now() + LOCK_MS });
        return res.status(429).json({ ok: false, reply: "🔒 ৫ বার ভুল হয়েছে। ১৫ মিনিটের জন্য উইথড্র বন্ধ করা হলো।" });
      }
      await secRef.set({ fails, lockedUntil: 0 });
    } catch (e) { console.error("sec write:", e); }
    return res.status(401).json({ ok: false, reply: `❌ পাসওয়ার্ড ভুল! আর ${MAX_FAILS - fails} বার চেষ্টা করতে পারবেন।` });
  }

  // ---------- উইথড্র (transaction: ব্যালেন্স কাটা + রিকোয়েস্ট তৈরি একসাথে) ----------
  try {
    const userRef = db.doc(`users/${user.uid}`);
    const wdRef = db.collection("withdrawals").doc(`${user.uid}_${requestId}`);

    await db.runTransaction(async (t) => {
      const [uSnap, wSnap] = await Promise.all([t.get(userRef), t.get(wdRef)]);
      if (wSnap.exists) throw new Error("DUPLICATE");
      if (!uSnap.exists) throw new Error("NOUSER");

      const u = uSnap.data();
      const bal = Number(u.balance) || 0;
      if (amount > bal) {
        const err = new Error("INSUFFICIENT");
        err.balance = bal;
        throw err;
      }
      t.update(userRef, { balance: Math.round((bal - amount) * 100) / 100 });
      // ✅ সাইটের বাকি অংশ (wallet / admin withdraw) যে ফরম্যাট পড়ে ঠিক সেই ফরম্যাটে
      t.set(wdRef, {
        userId: user.uid,
        username: u.username || "User",
        email: u.email || user.email || "",
        method,
        methodName: METHOD_NAMES[method],
        amount,
        accountNum: account,
        status: "pending",
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
        via: "ai-chat"
      });
    });

    secRef.delete().catch(() => {});
    return res.status(200).json({
      ok: true,
      reply: `✅ সফল! আপনার ৳${amount} টাকার উইথড্র রিকোয়েস্ট (${METHOD_NAMES[method]}) জমা হয়েছে। অ্যাডমিন Approve করলে টাকা পাবেন।`
    });
  } catch (e) {
    if (e.message === "DUPLICATE")
      return res.status(200).json({ ok: true, reply: "✅ এই উইথড্র রিকোয়েস্ট আগেই জমা হয়েছে।" });
    if (e.message === "INSUFFICIENT")
      return res.status(400).json({ ok: false, reply: `❌ ব্যালেন্স পর্যাপ্ত নয়। বর্তমান ব্যালেন্স ৳${e.balance}।` });
    if (e.message === "NOUSER")
      return res.status(404).json({ ok: false, reply: "❌ অ্যাকাউন্ট খুঁজে পাওয়া যায়নি।" });
    console.error("Withdraw tx error:", e);
    return res.status(500).json({ ok: false, reply: "❌ উইথড্র রিকোয়েস্ট জমা হয়নি। আবার চেষ্টা করুন।" });
  }
}
