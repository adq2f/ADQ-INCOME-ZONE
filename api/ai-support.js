import { getDb, setCors, verifyUser, ALLOWED_METHODS, normalizeAccount, sendResetEmail } from "./_shared.js";

export const config = { maxDuration: 30 };

// ✅ বর্তমান মডেল (1.5 / 2.0 বন্ধ হয়ে গেছে)। Vercel এ GEMINI_MODELS দিয়ে বদলানো যাবে।
const MODELS = (process.env.GEMINI_MODELS ||
  "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-2.5-flash")
  .split(",").map(s => s.trim()).filter(Boolean);

const TOTAL_BUDGET_MS = 25000;
const PER_CALL_TIMEOUT_MS = 12000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function callGemini(payload, apiKey, deadline, state) {
  for (const model of MODELS) {
    let body = payload;
    let stripped = false;

    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 2000) return null;

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(PER_CALL_TIMEOUT_MS, remaining - 500));

      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(body),
            signal: ctrl.signal
          }
        );
        const d = await r.json().catch(() => null);
        clearTimeout(timer);

        if (r.ok && d?.candidates?.[0]?.content?.parts?.length) return d;

        const msg = d?.error?.message || "";
        state.lastError = `[${model}] ${r.status} ${msg}`.slice(0, 300);
        console.error("Gemini error", state.lastError);

        // মডেল নেই / বন্ধ হয়ে গেছে / key-র সমস্যা → সরাসরি পরের মডেলে
        if ([401, 403, 404].includes(r.status)) break;

        if (r.status === 400 && !stripped && body.generationConfig) {
          stripped = true;
          body = { ...payload };
          delete body.generationConfig;
          attempt--;
          continue;
        }
        if ([429, 500, 503].includes(r.status) && attempt === 0) { await sleep(1000); continue; }
        break;
      } catch (e) {
        clearTimeout(timer);
        state.lastError = `[${model}] ${e?.name === "AbortError" ? "timeout" : (e?.message || e)}`;
        console.error("Gemini fetch error", state.lastError);
        break;
      }
    }
  }
  return null;
}

function cleanHistory(history) {
  const list = Array.isArray(history) ? history : [];
  const filtered = list
    .filter(m => m && (m.role === "user" || m.role === "model") && typeof m.text === "string" && m.text.trim())
    .slice(-8)
    .map(m => ({ role: m.role, text: m.text.slice(0, 1000) }));

  const out = [];
  for (const m of filtered) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.parts[0].text += "\n" + m.text;
    else out.push({ role: m.role, parts: [{ text: m.text }] });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const state = { lastError: "" };
  const DEBUG = process.env.DEBUG_AI === "1";

  let db;
  try { db = getDb(); }
  catch (e) {
    console.error("Firebase admin init error:", e.message);
    return res.status(500).json({ reply: "সার্ভার কনফিগারেশনে সমস্যা আছে। অ্যাডমিনকে জানান।" });
  }

  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: "লগইন করুন।" });

  const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 500) : "";
  if (!message) return res.status(400).json({ reply: "মেসেজ খালি।" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ reply: "সার্ভার কনফিগারেশনে সমস্যা আছে। অ্যাডমিনকে জানান।" });
  }

  let userData = {
    balance: 0, username: "User", email: user.email, totalGood: 0, totalBad: 0, totalPending: 0,
    wallets: {}, totalReferEarning: 0, myReferCode: "",
    recentWithdrawals: [], recentSubmissions: []
  };

  try {
    const snap = await db.doc(`users/${user.uid}`).get();
    if (snap.exists) {
      const d = snap.data();
      userData.balance = Number(d.balance) || 0;
      userData.username = d.username || "User";
      userData.totalGood = Number(d.totalGood) || 0;
      userData.totalBad = Number(d.totalBad) || 0;
      userData.totalPending = Number(d.totalPending) || 0;
      userData.wallets = d.wallets || {};
      userData.totalReferEarning = Number(d.totalReferEarning) || 0;
      userData.myReferCode = d.myReferCode || "";
    }

    try {
      const wdQuery = db.collection("withdrawals")
        .where("userId", "==", user.uid)
        .orderBy("requestedAt", "desc")
        .limit(5);
      const wdSnap = await wdQuery.get();
      wdSnap.forEach(doc => {
        const w = doc.data();
        userData.recentWithdrawals.push({
          amount: w.amount,
          method: w.method || "",
          account: w.accountNum || w.account,
          status: w.status,
          date: w.requestedAt?.toDate?.()?.toLocaleString("bn-BD") || "N/A"
        });
      });
    } catch (e) { console.error("wd history:", e.message); }

    try {
      const subQuery = db.collection("submissions")
        .where("userId", "==", user.uid)
        .orderBy("submittedAt", "desc")
        .limit(3);
      const subSnap = await subQuery.get();
      subSnap.forEach(doc => {
        const s = doc.data();
        userData.recentSubmissions.push({
          taskTitle: s.taskTitle || "Task",
          status: s.status,
          price: s.price || 0,
          date: s.submittedAt?.toDate?.()?.toLocaleString("bn-BD") || "N/A"
        });
      });
    } catch (e) { console.error("sub history:", e.message); }

  } catch (e) {
    console.error("Firestore read error:", e);
  }

  const savedWallets = Object.keys(userData.wallets).filter(k => userData.wallets[k]?.number);
  const hasWallet = savedWallets.length > 0;

  let walletDetails = "কোনো ওয়ালেট সেভ করা নেই।";
  if (hasWallet) {
    walletDetails = savedWallets.map(k => `- ${k.toUpperCase()}: ${userData.wallets[k].number}`).join("\n");
  }

  let wdHistoryText = "কোনো উইথড্র হিস্টোরি নেই।";
  if (userData.recentWithdrawals.length > 0) {
    wdHistoryText = userData.recentWithdrawals.map(w =>
      `- ৳${w.amount} (${String(w.method).toUpperCase()}) → ${w.account} → ${w.status} → ${w.date}`
    ).join("\n");
  }

  let subHistoryText = "কোনো সাবমিশন নেই।";
  if (userData.recentSubmissions.length > 0) {
    subHistoryText = userData.recentSubmissions.map(s =>
      `- ${s.taskTitle} → ${s.status} → ৳${s.price} → ${s.date}`
    ).join("\n");
  }

  const SYSTEM_PROMPT = `
তুমি "ADQ Income Zone" এর একজন স্মার্ট এবং মানুষের মতো আচরণকারী এআই অ্যাসিস্ট্যান্ট। ইউজারকে বাংলায় সাহায্য করো।

👤 ইউজারের তথ্য:
- নাম: ${userData.username}
- ইমেইল: ${userData.email}
- ব্যালেন্স: ৳${userData.balance}
- Good: ${userData.totalGood} | Bad: ${userData.totalBad} | Pending: ${userData.totalPending}
- রেফার কোড: ${userData.myReferCode || "নেই"}
- মোট রেফার আয়: ৳${userData.totalReferEarning}

💳 ওয়ালেট (${hasWallet ? "সেটআপ আছে" : "সেটআপ নেই"}):
${walletDetails}

📜 লাস্ট ৫টি উইথড্র:
${wdHistoryText}

📋 লাস্ট ৩টি সাবমিশন:
${subHistoryText}

⚠️ নিয়মাবলী:
১. টাকা তুলতে চাইলে আগে ওয়ালেট চেক করো। না থাকলে save_wallet টুল কল করে সেটআপ করাও।
২. নাম/পাসওয়ার্ড/ওয়ালেট পরিবর্তন করতে বললে update_username, send_password_reset, save_wallet টুল কল করো।
৩. হিস্টোরি জিজ্ঞেস করলে উপরের ডাটা থেকে সঠিক উত্তর দাও।
৪. ওয়েবসাইট/কোড/হ্যাকিং নিয়ে জিজ্ঞেস করলে বলো: "🙏 দুঃখিত, আমি এসব বিষয়ে কিছু জানি না। আমি শুধু ADQ Income Zone-এর কাজকর্ম নিয়ে সাহায্য করতে পারি।"
৫. ব্যালেন্স অ্যাড বা টাস্ক সাবমিট করতে বললে বলো: "❌ এগুলো আমি করতে পারি না।"
৬. মাঝে মাঝে ইমোজি ব্যবহার করো (😊, 👍, 💰, ✅)।
৭. মানুষের মতো স্বাভাবিক ভাষায় কথা বলো।
`;

  const contents = cleanHistory(req.body?.history);
  const lastC = contents[contents.length - 1];
  if (lastC && lastC.role === "user") lastC.parts[0].text += "\n" + message;
  else contents.push({ role: "user", parts: [{ text: message }] });

  try {
    const data = await callGemini({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      tools: [{
        functionDeclarations: [
          {
            name: "request_withdraw",
            description: "উইথড্র রিকোয়েস্ট কনফার্ম ফর্ম দেখায়।",
            parameters: {
              type: "OBJECT",
              properties: {
                amount: { type: "NUMBER" },
                method: { type: "STRING", enum: ["bkash", "nagad", "rocket", "binance"] },
                account: { type: "STRING" }
              },
              required: ["amount", "method", "account"]
            }
          },
          {
            name: "save_wallet",
            description: "ইউজারের পেমেন্ট মেথড সেভ করে।",
            parameters: {
              type: "OBJECT",
              properties: {
                method: { type: "STRING", enum: ["bkash", "nagad", "rocket", "binance"] },
                account: { type: "STRING" }
              },
              required: ["method", "account"]
            }
          },
          {
            name: "update_username",
            description: "ইউজারের নাম পরিবর্তন করে।",
            parameters: {
              type: "OBJECT",
              properties: { newUsername: { type: "STRING" } },
              required: ["newUsername"]
            }
          },
          {
            name: "send_password_reset",
            description: "পাসওয়ার্ড রিসেট লিংক ইমেইলে পাঠায়।",
            parameters: { type: "OBJECT", properties: {} }
          }
        ]
      }]
    }, apiKey, deadline, state);

    if (!data) {
      let reply = "আমি এই মুহূর্তে একটু ব্যস্ত আছি, দয়া করে কিছুক্ষণ পর আবার চেষ্টা করুন।";
      if (DEBUG) reply += `\n\nDEBUG: ${state.lastError}`;
      return res.status(200).json({ reply });
    }

    const parts = data.candidates[0].content.parts;
    const fcPart = parts.find(p => p.functionCall);

    if (fcPart) {
      const fc = fcPart.functionCall;
      const args = fc.args || {};

      if (fc.name === "request_withdraw") {
        const amount = Math.round(Number(args.amount) * 100) / 100;
        const method = String(args.method || "").toLowerCase().trim();
        const account = String(args.account || "").trim();

        if (!Number.isFinite(amount) || amount <= 0)
          return res.status(200).json({ reply: "❌ সঠিক টাকার পরিমাণ দিন।" });
        if (!ALLOWED_METHODS.includes(method))
          return res.status(200).json({ reply: "❌ মেথড সঠিক নয়।" });
        if (amount > userData.balance)
          return res.status(200).json({ reply: `❌ ব্যালেন্স পর্যাপ্ত নয়। বর্তমান ৳${userData.balance}।` });

        const normalized = normalizeAccount(method, account);
        const savedAccount = userData.wallets[method]?.number;
        const finalAccount = savedAccount || normalized;
        if (!finalAccount)
          return res.status(200).json({ reply: `❌ আপনার ${method} ওয়ালেট সেটআপ নেই।` });

        return res.status(200).json({
          reply: `আপনার ৳${amount} (${method.toUpperCase()} - ${finalAccount}) উইথড্র রিকোয়েস্ট প্রস্তুত। 🔒 পাসওয়ার্ড দিয়ে নিশ্চিত করুন।`,
          action: { type: "withdraw_confirm", amount, method, account: finalAccount }
        });
      }

      if (fc.name === "save_wallet") {
        const method = String(args.method || "").toLowerCase().trim();
        const account = String(args.account || "").trim();
        if (!ALLOWED_METHODS.includes(method))
          return res.status(200).json({ reply: "❌ মেথড সঠিক নয়।" });

        const normalized = normalizeAccount(method, account);
        if (!normalized)
          return res.status(200).json({ reply: "❌ অ্যাকাউন্ট নম্বর সঠিক নয়।" });

        try {
          const currentWallets = userData.wallets || {};
          currentWallets[method] = { number: normalized, name: userData.username };
          await db.doc(`users/${user.uid}`).update({ wallets: currentWallets });
          return res.status(200).json({ reply: `✅ আপনার ${method.toUpperCase()} নম্বর সেভ হয়েছে!` });
        } catch (e) {
          return res.status(200).json({ reply: "❌ সেভ করা যায়নি।" });
        }
      }

      if (fc.name === "update_username") {
        const newUsername = String(args.newUsername || "").trim();
        if (newUsername.length < 3)
          return res.status(200).json({ reply: "❌ নাম কমপক্ষে ৩ অক্ষরের হতে হবে।" });
        try {
          await db.doc(`users/${user.uid}`).update({ username: newUsername });
          return res.status(200).json({ reply: `✅ আপনার নতুন নাম "${newUsername}" সেভ হয়েছে!` });
        } catch (e) {
          return res.status(200).json({ reply: "❌ নাম পরিবর্তন করা যায়নি।" });
        }
      }

      if (fc.name === "send_password_reset") {
        const ok = await sendResetEmail(userData.email);
        if (ok) {
          return res.status(200).json({
            reply: `✅ পাসওয়ার্ড রিসেট লিংক আপনার ইমেইলে (${userData.email}) পাঠানো হয়েছে।`
          });
        } else {
          return res.status(200).json({
            reply: "❌ রিসেট লিংক পাঠানো যায়নি। আবার চেষ্টা করুন।"
          });
        }
      }

      return res.status(200).json({ reply: "কাজটি সম্পন্ন হয়েছে।" });
    }

    const textReply = parts.filter(p => !p.thought).map(p => p.text || "").join("\n").trim();
    return res.status(200).json({ reply: textReply || "আমি বুঝতে পারিনি।" });

  } catch (err) {
    console.error("Handler Error:", err);
    return res.status(500).json({ reply: "আমি এই মুহূর্তে একটু ব্যস্ত আছি, দয়া করে কিছুক্ষণ পর আবার চেষ্টা করুন।" });
  }
}
