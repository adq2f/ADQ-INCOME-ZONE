import admin from "firebase-admin";

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT;
const ALLOWED_METHODS = ["bkash", "nagad", "rocket"];
const MIN_WITHDRAW = 1;

// ✅ নতুন মডেল লিস্ট (২.৫ এবং ২.০ বাদ, নতুন ৩.৮ এবং ৩.৫ যোগ করা হয়েছে)
const MODELS = (process.env.GEMINI_MODELS ||
  "gemini-3.8-flash,gemini-3.5-flash-lite")
  .split(",").map(s => s.trim()).filter(Boolean);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- Firebase Admin init ----------
function getDb() {
  if (!admin.apps.length) {
    if (!FIREBASE_SERVICE_ACCOUNT) throw new Error("FIREBASE_SERVICE_ACCOUNT env missing");
    const sa = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  return admin.firestore();
}

// ---------- ১. ইউজার ভেরিফাই ----------
async function verifyUser(req) {
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

// ---------- ২. পাসওয়ার্ড ভেরিফাই ----------
async function verifyPassword(email, password) {
  if (!email || !password) return false;
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      }
    );
    return r.ok;
  } catch (e) {
    return false;
  }
}

// ---------- ৩. Gemini call (model fallback + retry + timeout) ----------
async function callGemini(payload, apiKey, deadline) {
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 1500) return null;

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(6000, remaining - 500));
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(payload),
            signal: ctrl.signal
          }
        );
        clearTimeout(timer);
        const d = await r.json().catch(() => null);

        if (r.ok && d?.candidates?.[0]?.content?.parts?.length) return d;

        console.error(`Gemini error [${model}] ${r.status}`, d?.error?.message || "");

        if (r.status === 503 && attempt === 0) { await sleep(1000); continue; }
        break;
      } catch (e) {
        clearTimeout(timer);
        console.error(`Gemini fetch error [${model}]`, e?.name || e);
        break;
      }
    }
  }
  return null;
}

// ---------- ৪. History clean ----------
function cleanHistory(history) {
  const list = Array.isArray(history) ? history : [];
  const out = list
    .filter(m => m && (m.role === "user" || m.role === "model") && typeof m.text === "string" && m.text.trim())
    .slice(-8)
    .map(m => ({ role: m.role, parts: [{ text: m.text.slice(0, 1000) }] }));
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

// ---------- Handler ----------
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const deadline = Date.now() + 8500;

  let db;
  try {
    db = getDb();
  } catch (e) {
    console.error("Firebase admin init error:", e.message);
    return res.status(500).json({ reply: "সার্ভার কনফিগারেশনে সমস্যা আছে। অ্যাডমিনকে জানান।" });
  }

  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: "লগইন করুন।" });

  const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 500) : "";
  if (!message) return res.status(400).json({ reply: "মেসেজ খালি।" });

  const apiKey = process.env.GEMINI_API_KEY;

  let userData = { balance: 0, username: "User", totalGood: 0 };
  try {
    const snap = await db.doc(`users/${user.uid}`).get();
    if (snap.exists) {
      const d = snap.data();
      userData = {
        balance: Number(d.balance) || 0,
        username: d.username || "User",
        totalGood: Number(d.totalGood) || 0
      };
    }
  } catch (e) {
    console.error("Firestore read error:", e);
  }

  const SYSTEM_PROMPT = `
    তুমি "ADQ Income Zone" এর স্মার্ট স্পেশাল অ্যাসিস্ট্যান্ট। ইউজারকে বাংলায় সাহায্য করো।
    ইউজারের বর্তমান তথ্য:
    - নাম: ${userData.username}
    - ব্যালেন্স: ৳${userData.balance}
    - মোট Good অ্যাকাউন্ট: ${userData.totalGood}

    নিয়ম:
    - "আমার ব্যালেন্স কত?" জিজ্ঞেস করলে উপরের ব্যালেন্সটি বলে দাও।
    - উইথড্র করতে চাইলে জিজ্ঞেস করো: কত টাকা, কোন মেথড (bkash/nagad/rocket) এবং অ্যাকাউন্ট নম্বর কত। এরপর পাসওয়ার্ড চাইবে।
    - পাসওয়ার্ড ছাড়া কখনো request_withdraw কল করবে না।
    - save_wallet এ মেথড শুধু bkash, nagad বা rocket হতে পারবে।
    - "সালাম" বা "হ্যালো" বললে সুন্দর করে উত্তর দাও।
  `;

  const contents = cleanHistory(req.body?.history);
  contents.push({ role: "user", parts: [{ text: message }] });

  try {
    const data = await callGemini({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      tools: [{
        functionDeclarations: [
          {
            name: "request_withdraw",
            description: "ইউজারের ব্যালেন্স থেকে টাকা উইথড্র করার রিকোয়েস্ট তৈরি করে।",
            parameters: {
              type: "OBJECT",
              properties: {
                amount: { type: "NUMBER" },
                method: { type: "STRING" },
                account: { type: "STRING" },
                password: { type: "STRING" }
              },
              required: ["amount", "method", "account", "password"]
            }
          },
          {
            name: "save_wallet",
            description: "ইউজারের পেমেন্ট মেথড সেভ করে।",
            parameters: {
              type: "OBJECT",
              properties: {
                method: { type: "STRING" },
                account: { type: "STRING" }
              },
              required: ["method", "account"]
            }
          }
        ]
      }]
    }, apiKey, deadline);

    if (!data) {
      return res.status(200).json({
        reply: "আমি এই মুহূর্তে একটু ব্যস্ত আছি, দয়া করে কিছুক্ষণ পর আবার চেষ্টা করুন।"
      });
    }

    const parts = data.candidates[0].content.parts;
    const fcPart = parts.find(p => p.functionCall);

    if (fcPart) {
      const fc = fcPart.functionCall;
      const args = fc.args || {};
      let reply = "কাজটি সম্পন্ন হয়েছে।";

      if (fc.name === "request_withdraw") {
        const amount = Number(args.amount);
        const method = String(args.method || "").toLowerCase().trim();
        const account = String(args.account || "").trim();
        const password = String(args.password || "");

        if (!password) {
          reply = "টাকা উইথড্র করতে হলে আপনাকে আপনার অ্যাকাউন্টের পাসওয়ার্ড দিতে হবে।";
        } else if (!Number.isFinite(amount) || amount < MIN_WITHDRAW) {
          reply = "❌ সঠিক টাকার পরিমাণ দিন।";
        } else if (!ALLOWED_METHODS.includes(method)) {
          reply = "❌ মেথড অবশ্যই bkash, nagad অথবা rocket হতে হবে।";
        } else if (!/^[0-9+\-]{6,20}$/.test(account)) {
          reply = "❌ অ্যাকাউন্ট নম্বর সঠিক নয়।";
        } else {
          const isPassOk = await verifyPassword(user.email, password);
          if (!isPassOk) {
            reply = "❌ পাসওয়ার্ড ভুল! দয়া করে সঠিক পাসওয়ার্ড দিন।";
          } else {
            try {
              await db.runTransaction(async (t) => {
                const ref = db.doc(`users/${user.uid}`);
                const snap = await t.get(ref);
                const bal = Number(snap.data()?.balance) || 0;
                if (amount > bal) {
                  const err = new Error("INSUFFICIENT");
                  err.balance = bal;
                  throw err;
                }
                t.update(ref, { balance: bal - amount });
                t.set(db.collection("withdrawals").doc(), {
                  userId: user.uid,
                  username: userData.username,
                  amount,
                  method,
                  accountNum: account,
                  status: "pending",
                  requestedAt: new Date().toISOString()
                });
              });
              reply = `✅ সফল! আপনার ৳${amount} টাকার উইথড্র রিকোয়েস্ট (${method}) জমা হয়েছে।`;
            } catch (e) {
              if (e.message === "INSUFFICIENT") {
                reply = `❌ আপনার ব্যালেন্স পর্যাপ্ত নয়। আপনার বর্তমান ব্যালেন্স ৳${e.balance}।`;
              } else {
                console.error("Withdraw transaction error:", e);
                reply = "❌ উইথড্র রিকোয়েস্ট জমা হয়নি। দয়া করে আবার চেষ্টা করুন।";
              }
            }
          }
        }
      } 
      else if (fc.name === "save_wallet") {
        const method = String(args.method || "").toLowerCase().trim();
        const account = String(args.account || "").trim();

        if (!ALLOWED_METHODS.includes(method)) {
          reply = "❌ মেথড অবশ্যই bkash, nagad অথবা rocket হতে হবে।";
        } else if (!/^[0-9+\-]{6,20}$/.test(account)) {
          reply = "❌ অ্যাকাউন্ট নম্বর সঠিক নয়।";
        } else {
          try {
            await db.doc(`users/${user.uid}`).set({ [`wallet_${method}`]: account }, { merge: true });
            reply = `✅ আপনার ${method} নম্বর (${account}) সেভ করা হয়েছে!`;
          } catch (e) {
            console.error("Save wallet error:", e);
            reply = "❌ নম্বর সেভ করা যায়নি। দয়া করে আবার চেষ্টা করুন।";
          }
        }
      }

      return res.status(200).json({ reply });
    }

    const textReply = parts.map(p => p.text || "").join("\n").trim();
    return res.status(200).json({ reply: textReply || "আমি বুঝতে পারিনি।" });

  } catch (err) {
    console.error("Handler Error:", err);
    return res.status(500).json({ reply: "সার্ভারে সমস্যা হচ্ছে। দয়া করে আবার চেষ্টা করুন।" });
  }
}
