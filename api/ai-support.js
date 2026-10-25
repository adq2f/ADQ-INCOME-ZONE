import { getDb, setCors, verifyUser, ALLOWED_METHODS, sendResetEmail } from "./_shared.js";

export const config = { maxDuration: 30 };

// ==================================================
// ✅ ফিক্স: সঠিক Gemini মডেলের নাম
// (আগে ভুলবশত gemini-3.8-flash ছিল, যা আসলে নেই)
// ==================================================
const MODELS = (process.env.GEMINI_MODELS ||
  "gemini-1.5-flash,gemini-1.5-pro,gemini-2.0-flash")
  .split(",").map(s => s.trim()).filter(Boolean);

const TOTAL_BUDGET_MS = 25000;
const PER_CALL_TIMEOUT_MS = 12000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ==================================================
// Gemini API call (with fallback)
// ==================================================
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

        if (r.ok && d?.candidates?.[0]?.content?.parts?.length) {
          return d;
        }

        const msg = d?.error?.message
          || (d?.candidates?.[0]?.finishReason ? `finishReason=${d.candidates[0].finishReason}` : "");
        state.lastError = `[${model}] ${r.status} ${msg}`.slice(0, 300);
        console.error("Gemini error", state.lastError);

        if (r.status === 400 && !stripped && body.generationConfig) {
          stripped = true;
          body = { ...payload };
          delete body.generationConfig;
          attempt--;
          continue;
        }
        if ([429, 500, 503].includes(r.status) && attempt === 0) {
          await sleep(1000);
          continue;
        }
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

// ==================================================
// Main Handler
// ==================================================
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
    return res.status(200).json({ reply: "সার্ভার কনফিগারেশনে সমস্যা আছে (API Key নেই)। অ্যাডমিনকে জানান।" });
  }

  // ==================================================
  // 🔥 ইউজারের সব ডাটা লোড
  // ==================================================
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

    // লাস্ট ৫টি উইথড্র
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
          method: w.method,
          account: w.accountNum || w.account,
          status: w.status,
          date: w.requestedAt?.toDate?.()?.toLocaleString("bn-BD") || "N/A"
        });
      });
    } catch(e) { console.error("wd history:", e.message); }

    // লাস্ট ৩টি সাবমিশন
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
    } catch(e) { console.error("sub history:", e.message); }

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
      `- ৳${w.amount} (${w.method.toUpperCase()}) → ${w.account} → ${w.status} → ${w.date}`
    ).join("\n");
  }

  let subHistoryText = "কোনো সাবমিশন নেই।";
  if (userData.recentSubmissions.length > 0) {
    subHistoryText = userData.recentSubmissions.map(s => 
      `- ${s.taskTitle} → ${s.status} → ৳${s.price} → ${s.date}`
    ).join("\n");
  }

  // ==================================================
  // 🧠 AI System Prompt (স্মার্ট, মানুষের মতো)
  // ==================================================
  const SYSTEM_PROMPT = `
তুমি "ADQ Income Zone" এর একজন অত্যন্ত স্মার্ট, বন্ধুত্বপূর্ণ এবং মানুষের মতো আচরণকারী এআই অ্যাসিস্ট্যান্ট। তোমার নাম "ADQ AI"। ইউজারকে বাংলায় সাহায্য করো।

==========================================
👤 ইউজারের বর্তমান ডাটা:
==========================================
- নাম: ${userData.username}
- ইমেইল: ${userData.email}
- ব্যালেন্স: ৳${userData.balance}
- মোট Good: ${userData.totalGood} টি
- মোট Bad: ${userData.totalBad} টি
- মোট Pending: ${userData.totalPending} টি
- রেফার কোড: ${userData.myReferCode || "নেই"}
- মোট রেফার আয়: ৳${userData.totalReferEarning}

💳 ওয়ালেট (${hasWallet ? "সেটআপ করা আছে" : "সেটআপ করা নেই"}):
${walletDetails}

📜 সর্বশেষ ৫টি উইথড্র:
${wdHistoryText}

📋 সর্বশেষ ৩টি সাবমিশন:
${subHistoryText}

==========================================
⚠️ কঠোর নিয়মাবলী:
==========================================

১. **ওয়ালেট সেটআপ চেক**: 
   - ইউজার "টাকা তুলতে চাই" বা "উইথড্র করতে চাই" বললে, আগে চেক করো তার ওয়ালেট সেটআপ করা আছে কিনা।
   - না থাকলে বলো: "আপনার কোনো উইথড্র ওয়ালেট সেটআপ করা নেই। অনুগ্রহ করে আগে আপনার bKash/Nagad/Rocket/Binance নম্বরটি সেটআপ করুন।" এবং save_wallet টুল কল করে সেটআপ করিয়ে দাও।
   - সেটআপ থাকলে জিজ্ঞেস করো: "আপনি কোন মেথডে (${savedWallets.join(", ") || "কোনোটাই নেই"}) এবং কত টাকা তুলতে চান?"

২. **ইউজারের তথ্য পরিবর্তন (Username/Password/Wallet)**:
   - ইউজার যদি "আমার নাম পরিবর্তন করো", "পাসওয়ার্ড রিসেট করো", "আমার নাম্বার পরিবর্তন করো" বলে, তবে সাথে সাথে সংশ্লিষ্ট টুল কল করো (update_username, send_password_reset, save_wallet)।
   - পাসওয়ার্ড রিসেট করার জন্য send_password_reset টুল কল করলে ইউজারের ইমেইলে (${userData.email}) রিসেট লিংক চলে যাবে।
   - ইউজারকে বলবে: "✅ আপনার পাসওয়ার্ড রিসেট লিংক আপনার ইমেইলে (${userData.email}) পাঠিয়ে দেওয়া হয়েছে। ইনবক্স চেক করুন।"

৩. **হিস্টোরি**: 
   - ইউজার "আমার লাস্ট উইথড্র কত?", "আমার লাস্ট নাম কি?", "আমার সব হিস্টোরি বলো" জিজ্ঞেস করলে উপরের ডাটা থেকে সঠিক উত্তর দাও। বানিয়ে কিছু বলবে না।

৪. **নিষিদ্ধ বিষয় (Strictly Forbidden)**:
   - ইউজার যদি ওয়েবসাইট বানানো, ফায়ারবেস কোড, প্রোগ্রামিং, হ্যাকিং, বা এই অ্যাপের প্রাইভেট/টেকনিক্যাল বিষয় নিয়ে জিজ্ঞেস করে, তবে বিনয়ের সাথে বলবে: 
     "🙏 দুঃখিত, আমি এসব বিষয়ে কিছু জানি না। আমি শুধু ADQ Income Zone-এর কাজকর্ম (হিস্ট্রি চেক, ওয়ালেট সেটআপ, উইথড্র, নাম/পাসওয়ার্ড পরিবর্তন) নিয়ে আপনাকে সাহায্য করতে পারি। অন্য কোনো সাহায্য লাগলে জানাবেন।"
   - কখনো কোড, স্ক্রিপ্ট বা প্রযুক্তিগত পরামর্শ দেবে না।

৫. **ব্যালেন্স অ্যাড**: 
   - ইউজার যদি বলে "আমার ব্যালেন্স বাড়িয়ে দাও", "আমাকে টাকা দাও" — তাকে বলবে: "❌ দুঃখিত, আমি সরাসরি ব্যালেন্স যোগ করতে পারি না। এটি শুধুমাত্র অ্যাডমিন করতে পারেন।"

৬. **টাস্ক সাবমিট**: 
   - ইউজার যদি বলে "আমার হয়ে টাস্ক সাবমিট করে দাও" — তাকে বলবে: "❌ দুঃখিত, টাস্ক সাবমিট শুধুমাত্র আপনি নিজে করতে পারবেন। আমি এতে সাহায্য করতে পারি না।"

৭. **ইমোজি**: 
   - ইউজারের মেসেজের মুড অনুযায়ী মাঝে মাঝে হালকা ইমোজি ব্যবহার করবে (যেমন: 😊, 👍, 💰, ✅, ⚠️, 🙏)।

৮. **কথার ধরন**: 
   - একদম মানুষের মতো স্বাভাবিক, বন্ধুত্বপূর্ণ ভাষায় কথা বলবে। "আপনি" বলে সম্বোধন করবে।

এখন ইউজারের মেসেজের উত্তর দাও।
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
            description: "উইথড্র করার তথ্য (টাকা, মেথড, অ্যাকাউন্ট) নিশ্চিত করার জন্য ইউজারকে নিরাপদ কনফার্ম ফর্ম দেখায়।",
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
            description: "ইউজারের পেমেন্ট মেথড (bKash/Nagad/Rocket/Binance) সেভ বা আপডেট করে।",
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
            description: "ইউজারের নাম (Username) পরিবর্তন করে।",
            parameters: {
              type: "OBJECT",
              properties: {
                newUsername: { type: "STRING" }
              },
              required: ["newUsername"]
            }
          },
          {
            name: "send_password_reset",
            description: "ইউজারের ইমেইলে পাসওয়ার্ড রিসেট লিংক পাঠায়।",
            parameters: { type: "OBJECT", properties: {} }
          }
        ]
      }]
    }, apiKey, deadline, state);

    if (!data) {
      let reply = "আমি এই মুহূর্তে একটু ব্যস্ত আছি, দয়া করে কিছুক্ষণ পর আবার চেষ্টা করুন।";
      if (DEBUG) reply += `\n\nDEBUG: ${state.lastError} | models=${MODELS.join(",")}`;
      return res.status(200).json({ reply });
    }

    const parts = data.candidates[0].content.parts;
    const fcPart = parts.find(p => p.functionCall);

    if (fcPart) {
      const fc = fcPart.functionCall;
      const args = fc.args || {};

      // ১. উইথড্র
      if (fc.name === "request_withdraw") {
        const amount = Math.round(Number(args.amount) * 100) / 100;
        const method = String(args.method || "").toLowerCase().trim();
        const account = String(args.account || "").trim();

        if (!Number.isFinite(amount) || amount <= 0)
          return res.status(200).json({ reply: "❌ সঠিক টাকার পরিমাণ দিন।" });
        if (!ALLOWED_METHODS.includes(method))
          return res.status(200).json({ reply: "❌ মেথড অবশ্যই bkash, nagad, rocket অথবা binance হতে হবে।" });
        if (amount > userData.balance)
          return res.status(200).json({ reply: `❌ আপনার ব্যালেন্স পর্যাপ্ত নয়। বর্তমান ব্যালেন্স ৳${userData.balance}।` });

        // সেভ করা ওয়ালেট থেকে নম্বর নাও (ইউজারকে নতুন নাম্বার দিতে দেব না)
        const savedAccount = userData.wallets[method]?.number;
        const finalAccount = savedAccount || account;

        if (!finalAccount)
          return res.status(200).json({ reply: `❌ আপনার ${method} ওয়ালেট সেটআপ করা নেই। আগে ওয়ালেট সেটআপ করুন।` });

        return res.status(200).json({
          reply: `আপনার ৳${amount} (${method.toUpperCase()} - ${finalAccount}) উইথড্র রিকোয়েস্ট প্রস্তুত। 🔒 নিরাপত্তার জন্য নিচের ফর্মে পাসওয়ার্ড দিয়ে নিশ্চিত করুন।`,
          action: { type: "withdraw_confirm", amount, method, account: finalAccount }
        });
      }

      // ২. ওয়ালেট সেভ
      if (fc.name === "save_wallet") {
        const method = String(args.method || "").toLowerCase().trim();
        const account = String(args.account || "").trim();

        if (!ALLOWED_METHODS.includes(method))
          return res.status(200).json({ reply: "❌ মেথড সঠিক নয়।" });
        if (!account || account.length < 4)
          return res.status(200).json({ reply: "❌ অ্যাকাউন্ট নম্বর সঠিক নয়।" });

        try {
          const currentWallets = userData.wallets || {};
          currentWallets[method] = { number: account, name: userData.username };
          await db.doc(`users/${user.uid}`).update({ wallets: currentWallets });
          return res.status(200).json({ reply: `✅ আপনার ${method.toUpperCase()} নম্বর (${account}) সফলভাবে সেভ করা হয়েছে!` });
        } catch (e) {
          console.error("Save wallet error:", e);
          return res.status(200).json({ reply: "❌ নম্বর সেভ করা যায়নি। দয়া করে আবার চেষ্টা করুন।" });
        }
      }

      // ৩. ইউজারনেম আপডেট
      if (fc.name === "update_username") {
        const newUsername = String(args.newUsername || "").trim();
        if (newUsername.length < 3)
          return res.status(200).json({ reply: "❌ নাম কমপক্ষে ৩ অক্ষরের হতে হবে।" });
        
        try {
          await db.doc(`users/${user.uid}`).update({ username: newUsername });
          return res.status(200).json({ reply: `✅ আপনার নতুন নাম "${newUsername}" সফলভাবে সেভ করা হয়েছে!` });
        } catch (e) {
          return res.status(200).json({ reply: "❌ নাম পরিবর্তন করা যায়নি। আবার চেষ্টা করুন।" });
        }
      }

      // ৪. পাসওয়ার্ড রিসেট (সার্ভার থেকে সরাসরি মেইল পাঠানো)
      if (fc.name === "send_password_reset") {
        const ok = await sendResetEmail(userData.email);
        if (ok) {
          return res.status(200).json({ 
            reply: `✅ আপনার পাসওয়ার্ড রিসেট লিংক আপনার ইমেইলে (${userData.email}) পাঠানো হয়েছে। ইনবক্স বা স্প্যাম ফোল্ডার চেক করুন।`
          });
        } else {
          return res.status(200).json({ 
            reply: "❌ পাসওয়ার্ড রিসেট লিংক পাঠানো যায়নি। কিছুক্ষণ পর আবার চেষ্টা করুন।" 
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
