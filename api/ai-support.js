import { getDb, setCors, verifyUser, ALLOWED_METHODS, MIN_WITHDRAW, ACCOUNT_RE } from "./_shared.js";

export const config = { maxDuration: 30 };

const MODELS = (process.env.GEMINI_MODELS ||
  "gemini-3.8-flash,gemini-3.5-flash,gemini-3.5-flash-lite")
  .split(",").map(s => s.trim()).filter(Boolean);

const TOTAL_BUDGET_MS = 25000;
const PER_CALL_TIMEOUT_MS = 12000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- Gemini call (fallback + retry + timeout) ----------
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

// ---------- History clean ----------
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

// ---------- Handler ----------
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
    console.error("GEMINI_API_KEY env missing");
    return res.status(200).json({
      reply: DEBUG ? "DEBUG: GEMINI_API_KEY env নেই" : "সার্ভার কনফিগারেশনে সমস্যা আছে। অ্যাডমিনকে জানান।"
    });
  }

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
  } catch (e) { console.error("Firestore read error:", e); }

  const SYSTEM_PROMPT = `
    তুমি "ADQ Income Zone" এর স্মার্ট স্পেশাল অ্যাসিস্ট্যান্ট। ইউজারকে বাংলায় সাহায্য করো।
    ইউজারের বর্তমান তথ্য:
    - নাম: ${userData.username}
    - ব্যালেন্স: ৳${userData.balance}
    - মোট Good অ্যাকাউন্ট: ${userData.totalGood}

    নিয়ম:
    - "আমার ব্যালেন্স কত?" জিজ্ঞেস করলে উপরের ব্যালেন্সটি বলে দাও।
    - উইথড্র করতে চাইলে জিজ্ঞেস করো: কত টাকা, কোন মেথড (bkash/nagad/rocket) এবং অ্যাকাউন্ট নম্বর কত। তিনটি তথ্য পেলেই request_withdraw কল করো।
    - তুমি কখনো পাসওয়ার্ড চাইবে না। পাসওয়ার্ড সিস্টেম নিজেই একটি নিরাপদ ফর্মে নেবে।
    - ইউজার চ্যাটে পাসওয়ার্ড লিখতে চাইলে বারণ করো এবং বলো পাসওয়ার্ড কাউকে বা চ্যাটে দেওয়া যাবে না।
    - save_wallet এ মেথড শুধু bkash, nagad বা rocket হতে পারবে।
    - "সালাম" বা "হ্যালো" বললে সুন্দর করে উত্তর দাও।
  `;

  const contents = cleanHistory(req.body?.history);
  const lastC = contents[contents.length - 1];
  if (lastC && lastC.role === "user") lastC.parts[0].text += "\n" + message;
  else contents.push({ role: "user", parts: [{ text: message }] });

  try {
    const data = await callGemini({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: { thinkingConfig: { thinkingLevel: "low" } },
      tools: [{
        functionDeclarations: [
          {
            name: "request_withdraw",
            description: "উইথড্র করার তথ্য (টাকা, মেথড, অ্যাকাউন্ট) নিশ্চিত করার জন্য ইউজারকে নিরাপদ কনফার্ম ফর্ম দেখায়। পাসওয়ার্ড লাগে না।",
            parameters: {
              type: "OBJECT",
              properties: {
                amount: { type: "NUMBER" },
                method: { type: "STRING" },
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
                method: { type: "STRING" },
                account: { type: "STRING" }
              },
              required: ["method", "account"]
            }
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

      if (fc.name === "request_withdraw") {
        const amount = Math.round(Number(args.amount) * 100) / 100;
        const method = String(args.method || "").toLowerCase().trim();
        const account = String(args.account || "").trim();

        if (!Number.isFinite(amount) || amount < MIN_WITHDRAW)
          return res.status(200).json({ reply: "❌ সঠিক টাকার পরিমাণ দিন।" });
        if (!ALLOWED_METHODS.includes(method))
          return res.status(200).json({ reply: "❌ মেথড অবশ্যই bkash, nagad অথবা rocket হতে হবে।" });
        if (!ACCOUNT_RE.test(account))
          return res.status(200).json({ reply: "❌ অ্যাকাউন্ট নম্বর সঠিক নয়।" });
        if (amount > userData.balance)
          return res.status(200).json({ reply: `❌ আপনার ব্যালেন্স পর্যাপ্ত নয়। বর্তমান ব্যালেন্স ৳${userData.balance}।` });

        // ✅ পাসওয়ার্ড এখানে নেওয়া হয় না — ক্লায়েন্ট একটি নিরাপদ ফর্ম দেখাবে
        return res.status(200).json({
          reply: `আপনার ৳${amount} (${method} - ${account}) উইথড্র রিকোয়েস্ট প্রস্তুত। 🔒 নিরাপত্তার জন্য নিচের ফর্মে পাসওয়ার্ড দিয়ে নিশ্চিত করুন।`,
          action: { type: "withdraw_confirm", amount, method, account }
        });
      }

      if (fc.name === "save_wallet") {
        const method = String(args.method || "").toLowerCase().trim();
        const account = String(args.account || "").trim();

        if (!ALLOWED_METHODS.includes(method))
          return res.status(200).json({ reply: "❌ মেথড অবশ্যই bkash, nagad অথবা rocket হতে হবে।" });
        if (!ACCOUNT_RE.test(account))
          return res.status(200).json({ reply: "❌ অ্যাকাউন্ট নম্বর সঠিক নয়।" });

        try {
          await db.doc(`users/${user.uid}`).set({ [`wallet_${method}`]: account }, { merge: true });
          return res.status(200).json({ reply: `✅ আপনার ${method} নম্বর (${account}) সেভ করা হয়েছে!` });
        } catch (e) {
          console.error("Save wallet error:", e);
          return res.status(200).json({ reply: "❌ নম্বর সেভ করা যায়নি। দয়া করে আবার চেষ্টা করুন।" });
        }
      }

      return res.status(200).json({ reply: "কাজটি সম্পন্ন হয়েছে।" });
    }

    const textReply = parts.filter(p => !p.thought).map(p => p.text || "").join("\n").trim();
    return res.status(200).json({ reply: textReply || "আমি বুঝতে পারিনি।" });

  } catch (err) {
    console.error("Handler Error:", err);
    return res.status(500).json({ reply: "সার্ভারে সমস্যা হচ্ছে। দয়া করে আবার চেষ্টা করুন।" });
  }
}
