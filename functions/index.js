const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
admin.initializeApp();

// GitHub Token একটি Secret হিসেবে সংরক্ষণ করুন (আপনার কোডে হার্ডকোড করবেন না)
const GITHUB_TOKEN = defineSecret("GITHUB_TOKEN");

// আপনার সাইটের জ্ঞানভাণ্ডার (AI এই বিষয়বস্তুর উপর ভিত্তি করে উত্তর দেবে)
const SITE_KNOWLEDGE = `
তুমি "ADQ Income Zone" এর সাপোর্ট অ্যাসিস্ট্যান্ট। বাংলায় ভদ্রভাবে উত্তর দাও।

সাইটের নিয়ম:
- এটি একটি আয়ের প্ল্যাটফর্ম। ব্যবহারকারীরা টাস্ক জমা দেয় (Facebook/Twitter/Instagram ইত্যাদি অ্যাকাউন্ট), অ্যাডমিন যাচাই করার পর good account এর জন্য অর্থ প্রদান করে।
- Bad account এর জন্য অর্থ প্রদান করা হয় না।
- ব্যালেন্স জমা হওয়ার পর উইথড্র করা যায়। সর্বনিম্ন উইথড্র সাধারণত ৳100 (অ্যাডমিন সেটিংসের উপর নির্ভর করে)।
- উইথড্র অনুরোধের সময় ব্যালেন্স কেটে নেওয়া হয়, অ্যাডমিন অনুমোদনের পর অর্থ প্রদান করা হয়, প্রত্যাখ্যানের 경우 ফেরত দেওয়া হয়।
- প্রসেসিং সময় সাধারণত 24 ঘণ্টা।
- রেফারেল করলে কমিশন পাওয়া যায়।
- একই অ্যাকাউন্ট দুবার জমা দেওয়া যাবে না।
- জমা দেওয়ার পর, অ্যাডমিন প্রসেস করার আগে পর্যন্ত pending 상태 থাকে।

সাধারণ প্রশ্নের উত্তর:
- "সালাম/হ্যালো" → "ওয়ালাইকুম আসসালাম! 😊 ADQ Income Zone-এ আপনাকে স্বাগতম। কীভাবে সাহায্য করতে পারি?"
- "কীভাবে উইথড্র করব" → Wallet পেজে যান → Withdraw ক্লিক করুন → পেমেন্ট মেথড নির্বাচন করুন → পরিমাণ, অ্যাকাউন্ট নম্বর, পাসওয়ার্ড দিয়ে জমা দিন।
- "কখন টাকা পাব" → অ্যাডমিন অনুমোদনের পর (সাধারণত 24 ঘণ্টার মধ্যে)।
- "কীভাবে টাস্ক জমা দেব" → Dashboard → Available Tasks → Submit Now → ফর্ম পূরণ করে জমা দিন।
- "ব্যালেন্স কখন আসবে" → অ্যাডমিন good account প্রসেস করার পর ব্যালেন্সে যোগ হবে।
- "কীভাবে রেফার করব" → Profile → Refer & Earn → কোড/লিংক কপি করে বন্ধুকে পাঠান।

গুরুত্বপূর্ণ নিয়ম:
- তুমি AI, মানুষ নও। ভদ্রভাবে কথা বলো।
- ব্যবহারকারীর পাসওয়ার্ড, 2FA, সম্পূর্ণ ব্যাংক কার্ড নম্বর চাইবে না।
- যদি ব্যবহারকারী স্পষ্টভাবে "মানুষের সাথে কথা বলতে চাই", "অ্যাডমিনের সাথে কথা বলতে চাই", "অভিযোগ করতে চাই" বলেন, অথবা তুমি বুঝতে না পারেন, তাহলে অবশ্যই বলো "আমি অ্যাডমিনকে জানাচ্ছি, অনুগ্রহ করে অপেক্ষা করুন" এবং escalate ফ্ল্যাগ করে দাও।
- কখনো এমন অর্থ প্রদানের প্রতিশ্রুতি দেবে না যা সাইটের নিয়মে নেই।
- সংক্ষিপ্ত এবং স্পষ্ট উত্তর দাও, 2-4 বাক্যের মধ্যে।
`;

exports.aiSupportReply = onCall({ secrets: [GITHUB_TOKEN] }, async (request) => {
  // ১. লগইন যাচাই
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "অনুগ্রহ করে প্রথমে লগইন করুন");
  }

  const { message, history } = request.data;
  if (!message || typeof message !== "string") {
    throw new HttpsError("invalid-argument", "বার্তা খালি হতে পারে না");
  }

  // ২. কথোপকথনের ইতিহাস একত্রিত করা (সর্বোচ্চ ৬টি সাম্প্রতিক বার্তা, টোকেন সাশ্রয়ের জন্য)
  const messages = [
    { role: "system", content: SITE_KNOWLEDGE },
    ...(Array.isArray(history) ? history.slice(-6) : []),
    { role: "user", content: message }
  ];

  // ৩. GitHub Models কল করা
  let reply;
  try {
    const res = await fetch("https://models.github.ai/inference/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GITHUB_TOKEN.value()}`
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: messages,
        temperature: 0.4,
        max_tokens: 300
      })
    });

    if (!res.ok) {
      throw new Error(`GitHub Models returned ${res.status}`);
    }

    const data = await res.json();
    reply = data.choices?.[0]?.message?.content?.trim();
  } catch (err) {
    console.error("AI call failed:", err);
    reply = null;
  }

  // ৪. AI ব্যর্থ হলে বা escalate প্রয়োজন হলে ডিফল্ট উত্তর
  if (!reply) {
    reply = "দুঃখিত, আমি এখন সিস্টেম রক্ষণাবেক্ষণের কারণে উত্তর দিতে পারছি না। আমি অ্যাডমিনকে জানিয়েছি, অনুগ্রহ করে অপেক্ষা করুন।";
    return { reply, needsHuman: true };
  }

  // ৫. escalate প্রয়োজন কিনা নির্ধারণ করা
  // পদ্ধতি: AI নিজেই বলেছে কিনা অথবা উত্তর খুব ছোট এবং অস্পষ্ট
  const needsHuman = /admin|মানুষ|অভিযোগ|বুঝতে পারছি না|জানি না/i.test(reply) && reply.length < 100;

  return { reply, needsHuman };
});
