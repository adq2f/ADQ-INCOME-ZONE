// ==================================================
// ADQ Income Zone — AI Support (Vercel Serverless Function)
// ফাইলের জায়গা: প্রজেক্টের রুটে  api/ai-support.js
// ==================================================
// Vercel → Project → Settings → Environment Variables:
//   GEMINI_API_KEY   (বাধ্যতামূলক)  — aistudio.google.com থেকে নেওয়া key
//   GEMINI_MODEL     (ঐচ্ছিক)       — যেমন: gemini-3.5-flash
//   AUTH_MODE        (ঐচ্ছিক)       — "verify" (ডিফল্ট) অথবা "off"
//   FIREBASE_API_KEY (ঐচ্ছিক)       — না দিলে নিচের public web key ব্যবহার হবে
// Env বদলালে অবশ্যই Redeploy করতে হবে।
// ==================================================

// ⚠️ gemini-2.0-flash ১ জুন ২০২৬-এ বন্ধ হয়ে গেছে — তাই আগের কোড কাজ করছিল না।
// এই তালিকার প্রথম যেটা চলবে সেটাই ব্যবহার হবে।
const FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-flash-latest"];

const FIREBASE_WEB_KEY = process.env.FIREBASE_API_KEY || "AIzaSyCffmDp9xRUcLkqe5q4NiQubaT0iMIlDm4";
const SITE_ORIGIN = "https://adq-income-zone.vercel.app";
const ALLOWED_ORIGINS = [SITE_ORIGIN, "http://localhost:3000", "http://localhost:5500", "http://127.0.0.1:5500"];

const SYSTEM_PROMPT = `
তুমি "ADQ Income Zone" এর একজন সাপোর্ট অ্যাসিস্ট্যান্ট। বাংলায় ভদ্রভাবে, সংক্ষেপে (সর্বোচ্চ ৪-৫ লাইন) এবং পেশাদারভাবে উত্তর দাও।
সাইটের নিয়মাবলী:
- ইউজাররা টাস্ক (যেমন ফেসবুক, টুইটার অ্যাকাউন্ট) সাবমিট করে।
- সাবমিট করা অ্যাকাউন্ট Good হলে টাকা পায়, Bad হলে পায় না।
- ব্যালেন্স ১০০ টাকা হলেই Withdraw করা যায়।
- Withdraw রিকোয়েস্ট দিলে টাকা সাথে সাথে ব্যালেন্স থেকে কাটা যায়, অ্যাডমিন Approve করলে টাকা পায়, Reject করলে ফেরত আসে।
- রেফার করলে কমিশন পাওয়া যায়।
- ব্যবহারকারীর পাসওয়ার্ড বা 2FA কখনো চাইবে না।
- কেউ "সালাম" বা "হ্যালো" বললে সুন্দর করে উত্তর দাও (যেমন: "ওয়ালাইকুম আসসালাম! কীভাবে সাহায্য করতে পারি?")।
- ব্যালেন্স, নির্দিষ্ট পেমেন্ট বা কারো অ্যাকাউন্টের তথ্য তুমি দেখতে পাও না — অনুমান করে বলবে না।
- যদি উত্তর জানা না থাকে, কিংবা ইউজার অ্যাডমিনের সাথে কথা বলতে চায়, তবে বলো "আমি অ্যাডমিনকে জানাচ্ছি" এবং উত্তরের একদম শেষে আলাদা করে লিখো [[HUMAN]]।
- সাইটের বাইরের বিষয়ে (রাজনীতি, ধর্ম, কোডিং ইত্যাদি) উত্তর দেবে না; ভদ্রভাবে বলবে তুমি শুধু ADQ Income Zone নিয়ে সাহায্য করতে পারো।
`;

const FALLBACK_REPLY = "দুঃখিত, এখন উত্তর দেওয়া সম্ভব হচ্ছে না। আমি অ্যাডমিনকে জানাচ্ছি।";

// ---------- ছোট in-memory rate limit (প্রতি instance-এ) ----------
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 2000) { for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k); }
  return arr.length > max;
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// ---------- Firebase login token যাচাই (শুধু লগইন করা user ব্যবহার করতে পারবে) ----------
async function verifyUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false, reason: "no-token" };
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Referer": SITE_ORIGIN + "/" },
      body: JSON.stringify({ idToken: token })
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.users && d.users[0]) return { ok: true, uid: d.users[0].localId };
    const msg = d?.error?.message || "";
    if (/INVALID_ID_TOKEN|TOKEN_EXPIRED|USER_NOT_FOUND|USER_DISABLED/.test(msg)) return { ok: false, reason: "invalid-token" };
    console.error("Token verify config error:", r.status, msg);
    return { ok: false, reason: "verify-failed:" + (msg || r.status) };
  } catch (e) {
    console.error("Token verify network error:", e);
    return { ok: false, reason: "verify-network" };
  }
}

// ---------- history পরিষ্কার করা (Gemini-র নিয়ম: user দিয়ে শুরু, role পর্যায়ক্রমে) ----------
function buildContents(history, message) {
  let h = Array.isArray(history) ? history.slice(-10) : [];
  h = h
    .filter(m => m && typeof m.text === "string" && m.text.trim())
    .map(m => ({ role: m.role === "user" ? "user" : "model", text: m.text.slice(0, 500) }));

  // শেষ user মেসেজটাই যদি এখনকার মেসেজ হয়, তাহলে বাদ (ডুপ্লিকেট আটকাতে)
  if (h.length && h[h.length - 1].role === "user" && h[h.length - 1].text.trim() === message.trim()) h.pop();
  // শুরুতে model মেসেজ থাকলে বাদ
  while (h.length && h[0].role === "model") h.shift();
  // পর পর একই role হলে জুড়ে দেওয়া
  const merged = [];
  for (const m of h) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.text += "\n" + m.text;
    else merged.push({ ...m });
  }
  let finalMsg = message;
  if (merged.length && merged[merged.length - 1].role === "user") {
    finalMsg = merged.pop().text + "\n" + message;
  }
  const contents = merged.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
  contents.push({ role: "user", parts: [{ text: finalMsg }] });
  return contents;
}

// ---------- Gemini call (model fallback সহ) ----------
async function askGemini(contents, apiKey) {
  const models = [...new Set([process.env.GEMINI_MODEL, ...FALLBACK_MODELS].filter(Boolean))];
  let lastErr = null;

  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: { temperature: 0.4, maxOutputTokens: 1024 }
        })
      });
      const data = await r.json().catch(() => ({}));

      if (r.ok) {
        const parts = data.candidates?.[0]?.content?.parts || [];
        const text = parts.map(p => p.text || "").join("").trim();
        return { ok: true, text, model, blocked: !text };
      }

      const err = data.error || {};
      lastErr = { status: r.status, code: err.status || r.status, message: err.message || "unknown", model };
      console.error(`Gemini error [${model}]`, r.status, err.status, err.message);

      // key ভুল/অনুমতি নেই → অন্য model চেষ্টা করে লাভ নেই
      if (r.status === 401 || r.status === 403 || /API key/i.test(err.message || "")) break;
      // model নেই/বন্ধ, quota, সার্ভার সমস্যা → পরের model
      continue;
    } catch (e) {
      lastErr = { status: 0, code: "NETWORK", message: String(e && e.message || e), model };
      console.error(`Gemini fetch failed [${model}]`, e);
    }
  }
  return { ok: false, error: lastErr };
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const API_KEY = process.env.GEMINI_API_KEY;
  const authMode = (process.env.AUTH_MODE || "verify").toLowerCase();

  // ---------- অবস্থা পরীক্ষার জন্য: /api/ai-support?ping=1  (&test=1 হলে Gemini-কেও ডাকবে) ----------
  if (req.method === "GET") {
    if (!req.query || !req.query.ping) return res.status(405).json({ error: "Method not allowed" });
    const info = { ok: true, hasKey: !!API_KEY, authMode, models: [process.env.GEMINI_MODEL, ...FALLBACK_MODELS].filter(Boolean) };
    if (req.query.test && API_KEY) {
      const ip = String(req.headers["x-forwarded-for"] || "ip").split(",")[0];
      if (limited("test:" + ip, 5, 60000)) return res.status(429).json({ error: "Too many tests" });
      const t = await askGemini([{ role: "user", parts: [{ text: "হ্যালো" }] }], API_KEY);
      info.gemini = t.ok ? { ok: true, model: t.model, sample: t.text.slice(0, 80) } : { ok: false, error: t.error };
    }
    return res.status(200).json(info);
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!API_KEY) {
    console.error("GEMINI_API_KEY সেট করা নেই (Vercel env var + Redeploy লাগবে)");
    return res.status(200).json({ reply: FALLBACK_REPLY, needsHuman: true, error: "NO_API_KEY" });
  }

  // ---------- লগইন যাচাই ----------
  let uid = "anon";
  if (authMode !== "off") {
    const v = await verifyUser(req);
    if (!v.ok) {
      const code = v.reason === "no-token" || v.reason === "invalid-token" ? 401 : 200;
      return res.status(code).json({ reply: code === 401 ? null : FALLBACK_REPLY, needsHuman: code !== 401, error: "AUTH_" + v.reason });
    }
    uid = v.uid;
  }

  if (limited("u:" + uid, 12, 60000)) {
    return res.status(429).json({ reply: "একটু ধীরে — এক মিনিট পরে আবার লিখুন।", needsHuman: false, error: "RATE_LIMIT" });
  }

  // ---------- ইনপুট যাচাই ----------
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 500) : "";
  if (!message) return res.status(400).json({ error: "Message cannot be empty" });

  const contents = buildContents(body?.history, message);
  const r = await askGemini(contents, API_KEY);

  if (!r.ok) {
    // Vercel Logs-এ আসল কারণ দেখা যাবে; ইউজার পাবে সাধারণ উত্তর
    return res.status(200).json({ reply: FALLBACK_REPLY, needsHuman: true, error: "GEMINI_" + (r.error?.code || "FAIL") });
  }

  let reply = r.text || "দুঃখিত, আমি বুঝতে পারিনি। আমি অ্যাডমিনকে জানাচ্ছি।";
  const needsHuman = /\[\[HUMAN\]\]/.test(reply) || !r.text;
  reply = reply.replace(/\[\[HUMAN\]\]/g, "").trim() || FALLBACK_REPLY;

  return res.status(200).json({ reply, needsHuman, model: r.model });
}
