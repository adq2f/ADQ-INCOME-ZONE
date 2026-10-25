const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const FIREBASE_PROJECT_ID = "adq-income-zone"; // আপনার ফায়ারবেস প্রজেক্ট আইডি

// ১. ইউজার ভেরিফাই (টোকেন ও ইমেইল বের করা)
async function verifyUser(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return null;
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token })
    });
    const d = await r.json();
    if (r.ok && d.users && d.users[0]) {
      return { uid: d.users[0].localId, email: d.users[0].email, token };
    }
    return null;
  } catch (e) { return null; }
}

// ২. পাসওয়ার্ড ভেরিফাই
async function verifyPassword(email, password) {
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    return r.ok;
  } catch (e) { return false; }
}

// ৩. ফায়ারবেস থেকে ডেটা রিড করা (ব্যালেন্স দেখার জন্য)
async function firestoreRead(path) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  const res = await fetch(url);
  return res.json();
}

// ৪. ফায়ারবেসে ডেটা লেখা (উইথড্র বা ওয়ালেট সেভের জন্য)
async function firestoreWrite(path, data, token) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  const formattedData = {};
  for (const key in data) {
    if (typeof data[key] === "string") formattedData[key] = { stringValue: data[key] };
    else if (typeof data[key] === "number") formattedData[key] = { doubleValue: data[key] };
  }
  
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({ fields: formattedData })
  });
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: "লগইন করুন।" });

  const { message, history } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  // ইউজারের বর্তমান ডেটা ফায়ারবেস থেকে নিয়ে আসা (AI-কে কনটেক্সট দিতে)
  let userData = {};
  try {
    const docData = await firestoreRead(`users/${user.uid}`);
    if (docData && docData.fields) {
      userData = {
        balance: docData.fields.balance?.doubleValue || docData.fields.balance?.integerValue || 0,
        username: docData.fields.username?.stringValue || "User",
        totalGood: docData.fields.totalGood?.integerValue || 0
      };
    }
  } catch (e) { console.error("Firestore read error:", e); }

  // AI-এর জন্য প্রম্পট তৈরি
  const SYSTEM_PROMPT = `
    তুমি "ADQ Income Zone" এর স্মার্ট স্পেশাল অ্যাসিস্ট্যান্ট। ইউজারকে বাংলায় সাহায্য করো।
    
    ইউজারের বর্তমান তথ্য:
    - নাম: ${userData.username}
    - ব্যালেন্স: ৳${userData.balance}
    - মোট Good অ্যাকাউন্ট: ${userData.totalGood}

    নিয়ম:
    - ইউজার যদি জিজ্ঞেস করে "আমার ব্যালেন্স কত?", তবে তাকে উপরের ব্যালেন্সটি বলে দাও।
    - ইউজার কোনো উইথড্র করতে চাইলে তাকে জিজ্ঞেস করো: কত টাকা, কোন মেথড (bkash/nagad/rocket) এবং অ্যাকাউন্ট নম্বর কত। এরপর তাকে তার লগইন পাসওয়ার্ড দিতে বলো।
    - পাসওয়ার্ড ছাড়া কখনো request_withdraw কল করবে না।
    - ইউজার বললে "সালাম" বা "হ্যালো" → সুন্দর করে উত্তর দাও।
    - তুমি AI, তবে একদম মানুষের মতো সাহায্য করো।
  `;

  const contents = (history || []).map(m => ({ role: m.role, parts: [{ text: m.text }] }));
  contents.push({ role: "user", parts: [{ text: message }] });

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: contents,
        tools: [{
          functionDeclarations: [
            {
              name: "request_withdraw",
              description: "ইউজারের ব্যালেন্স থেকে টাকা উইথড্র করার রিকোয়েস্ট তৈরি করে।",
              parameters: {
                type: "OBJECT",
                properties: {
                  amount: { type: "NUMBER", description: "কত টাকা উইথড্র করবে" },
                  method: { type: "STRING", description: "bkash, nagad, rocket, binance" },
                  account: { type: "STRING", description: "মোবাইল নম্বর বা ওয়ালেট অ্যাড্রেস" },
                  password: { type: "STRING", description: "ইউজারের লগইন পাসওয়ার্ড" }
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
                  method: { type: "STRING", description: "bkash, nagad, rocket, binance" },
                  account: { type: "STRING", description: "মোবাইল নম্বর" }
                },
                required: ["method", "account"]
              }
            }
          ]
        }]
      })
    });

    const data = await response.json();
    if (!data.candidates || !data.candidates[0]) {
      return res.status(200).json({ reply: "আমি বুঝতে পারিনি।" });
    }

    const parts = data.candidates[0].content.parts;

    if (parts[0].functionCall) {
      const fc = parts[0].functionCall;
      const args = fc.args;
      let reply = "কাজটি সম্পন্ন হয়েছে।";

      if (fc.name === "request_withdraw") {
        if (!args.password) {
          reply = "টাকা উইথড্র করতে হলে আপনাকে আপনার অ্যাকাউন্টের পাসওয়ার্ড দিতে হবে।";
        } else {
          const isPassOk = await verifyPassword(user.email, args.password);
          if (!isPassOk) {
            reply = "❌ পাসওয়ার্ড ভুল! দয়া করে সঠিক পাসওয়ার্ড দিন।";
          } else {
            if (args.amount > userData.balance) {
              reply = `❌ আপনার ব্যালেন্স পর্যাপ্ত নয়। আপনার বর্তমান ব্যালেন্স ৳${userData.balance}।`;
            } else {
              await firestoreWrite("withdrawals", {
                userId: user.uid,
                amount: args.amount,
                method: args.method,
                accountNum: args.account,
                status: "pending",
                requestedAt: new Date().toISOString()
              }, user.token);
              reply = `✅ সফল! আপনার ৳${args.amount} টাকার উইথড্র রিকোয়েস্ট (${args.method}) জমা হয়েছে।`;
            }
          }
        }
      } 
      else if (fc.name === "save_wallet") {
        await firestoreWrite(`users/${user.uid}`, {
          [`wallet_${args.method}`]: args.account
        }, user.token);
        reply = `✅ আপনার ${args.method} নম্বর (${args.account}) সেভ করা হয়েছে!`;
      }

      return res.status(200).json({ reply });
    }

    const textReply = parts.map(p => p.text || "").join("\n");
    return res.status(200).json({ reply: textReply || "আমি বুঝতে পারিনি।" });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ reply: "সার্ভারে সমস্যা হচ্ছে।" });
  }
}
