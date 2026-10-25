import {
  admin, getDb, setCors, verifyUser, verifyPassword,
  ALLOWED_METHODS, MIN_WITHDRAW, ACCOUNT_RE
} from "./_shared.js";

export const config = { maxDuration: 15 };

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, reply: "Method not allowed" });

  let db;
  try {
    db = getDb();
  } catch (e) {
    console.error("Firebase init error:", e.message);
    return res.status(500).json({ ok: false, reply: "সার্ভার কনফিগারেশনে সমস্যা আছে।" });
  }

  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ ok: false, reply: "আবার লগইন করুন।" });

  const b = req.body || {};
  const amount = Math.round(Number(b.amount) * 100) / 100;
  const method = String(b.method || "").toLowerCase().trim();
  const account = String(b.account || "").trim();
  const password = typeof b.password === "string" ? b.password : "";
  const requestId = String(b.requestId || "");

  if (!Number.isFinite(amount) || amount < MIN_WITHDRAW)
    return res.status(400).json({ ok: false, reply: "❌ সঠিক টাকার পরিমাণ দিন।" });
  if (!ALLOWED_METHODS.includes(method))
    return res.status(400).json({ ok: false, reply: "❌ মেথড অবশ্যই bkash, nagad অথবা rocket হতে হবে।" });
  if (!ACCOUNT_RE.test(account))
    return res.status(400).json({ ok: false, reply: "❌ অ্যাকাউন্ট নম্বর সঠিক নয়।" });
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId))
    return res.status(400).json({ ok: false, reply: "❌ রিকোয়েস্ট সঠিক নয়। আবার চেষ্টা করুন।" });
  if (!password)
    return res.status(400).json({ ok: false, reply: "❌ পাসওয়ার্ড দিন।" });

  // ---------- লক চেক ----------
  const secRef = db.doc(`withdraw_security/${user.uid}`);
  let sec = {};
  try { sec = (await secRef.get()).data() || {}; } catch (e) { console.error("sec read:", e); }

  if (sec.lockedUntil && sec.lockedUntil > Date.now()) {
    const mins = Math.ceil((sec.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({
      ok: false,
      reply: `🔒 অনেকবার ভুল পাসওয়ার্ড দেওয়া হয়েছে। ${mins} মিনিট পর আবার চেষ্টা করুন।`
    });
  }

  // ---------- পাসওয়ার্ড যাচাই ----------
  const pw = await verifyPassword(user.email, password);

  if (pw === "toomany") {
    return res.status(429).json({ ok: false, reply: "🔒 অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।" });
  }
  if (pw === "error") {
    return res.status(503).json({ ok: false, reply: "⚠️ পাসওয়ার্ড যাচাই করা যায়নি। আবার চেষ্টা করুন।" });
  }
  if (pw === "bad") {
    const fails = (Number(sec.fails) || 0) + 1;
    try {
      if (fails >= MAX_FAILS) {
        await secRef.set({ fails: 0, lockedUntil: Date.now() + LOCK_MS });
        return res.status(429).json({ ok: false, reply: "🔒 ৫ বার ভুল হয়েছে। ১৫ মিনিটের জন্য উইথড্র বন্ধ করা হলো।" });
      }
      await secRef.set({ fails, lockedUntil: 0 });
    } catch (e) { console.error("sec write:", e); }
    return res.status(401).json({
      ok: false,
      reply: `❌ পাসওয়ার্ড ভুল! আর ${MAX_FAILS - fails} বার চেষ্টা করতে পারবেন।`
    });
  }

  // ---------- উইথড্র ----------
  try {
    const userRef = db.doc(`users/${user.uid}`);
    const wdRef = db.collection("withdrawals").doc(`${user.uid}_${requestId}`);

    await db.runTransaction(async (t) => {
      const [uSnap, wSnap] = await Promise.all([t.get(userRef), t.get(wdRef)]);
      if (wSnap.exists) throw new Error("DUPLICATE");

      const bal = Number(uSnap.data()?.balance) || 0;
      if (amount > bal) {
        const err = new Error("INSUFFICIENT");
        err.balance = bal;
        throw err;
      }
      t.update(userRef, { balance: Math.round((bal - amount) * 100) / 100 });
      t.set(wdRef, {
        userId: user.uid,
        username: uSnap.data()?.username || "User",
        amount,
        method,
        accountNum: account,
        status: "pending",
        requestedAt: new Date().toISOString()
      });
    });

    secRef.delete().catch(() => {});
    return res.status(200).json({
      ok: true,
      reply: `✅ সফল! আপনার ৳${amount} টাকার উইথড্র রিকোয়েস্ট (${method}) জমা হয়েছে।`
    });
  } catch (e) {
    if (e.message === "DUPLICATE") {
      return res.status(200).json({ ok: true, reply: "✅ এই উইথড্র রিকোয়েস্ট আগেই জমা হয়েছে।" });
    }
    if (e.message === "INSUFFICIENT") {
      return res.status(400).json({ ok: false, reply: `❌ ব্যালেন্স পর্যাপ্ত নয়। বর্তমান ব্যালেন্স ৳${e.balance}।` });
    }
    console.error("Withdraw tx error:", e);
    return res.status(500).json({ ok: false, reply: "❌ উইথড্র রিকোয়েস্ট জমা হয়নি। আবার চেষ্টা করুন।" });
  }
}
