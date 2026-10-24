export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, history } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  const API_KEY = process.env.GEMINI_API_KEY; 

  // আপনার সাইটের সব ফিচার ও নিয়মের বর্ণনা (AI এই তথ্য দেখে উত্তর দিবে)
  const SYSTEM_PROMPT = `
    তুমি "ADQ Income Zone" এর একজন সাপোর্ট অ্যাসিস্ট্যান্ট। বাংলায় ভদ্রভাবে এবং পেশাদারভাবে উত্তর দাও।
    সাইটের নিয়মাবলী:
    - ইউজাররা টাস্ক (যেমন ফেসবুক, টুইটার অ্যাকাউন্ট) সাবমিট করে।
    - সাবমিট করা অ্যাকাউন্ট Good হলে টাকা পায়, Bad হলে পায় না।
    - ব্যালেন্স ১০০ টাকা হলেই Withdraw করা যায়।
    - Withdraw রিকোয়েস্ট দিলে টাকা কাটা যায়, অ্যাডমিন Approve করলে টাকা পায়, Reject করলে ফেরত আসে।
    - রেফার করলে কমিশন পাওয়া যায়।
    - ব্যবহারকারীর পাসওয়ার্ড বা 2FA কখনো চাইবে না।
    - কেউ "সালাম" বা "হ্যালো" বললে সুন্দর করে উত্তর দাও (যেমন: "ওয়ালাইকুম আসসালাম! কীভাবে সাহায্য করতে পারি?")।
    - যদি কিছু না বুঝো বা ইউজার অ্যাডমিনের সাথে কথা বলতে চায়, তবে বলো "আমি অ্যাডমিনকে জানাচ্ছি"।
  `;

  // গুগলের ফরম্যাটে চ্যাট হিস্ট্রি সাজানো
  const contents = history ? history.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.text }]
  })) : [];

  contents.push({
    role: 'user',
    parts: [{ text: message }]
  });

  try {
    // গুগলের নতুন মডেল (Gemini 2.0 Flash) এ রিকোয়েস্ট পাঠানো
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        system_instruction: {
          parts: { text: SYSTEM_PROMPT }
        },
        contents: contents
      })
    });

    const data = await response.json();
    
    if (data.error) {
      console.error("Gemini Error:", data.error);
      return res.status(500).json({ reply: 'দুঃখিত, এখন উত্তর দেওয়া সম্ভব হচ্ছে না। অ্যাডমিনকে জানাচ্ছি।', needsHuman: true });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'দুঃখিত, আমি বুঝতে পারিনি।';
    const needsHuman = /অ্যাডমিন|জানি না|বুঝতে পারছি না/i.test(reply);

    return res.status(200).json({ reply, needsHuman });
  } catch (err) {
    console.error('Fetch Error:', err);
    return res.status(500).json({ reply: 'সিস্টেমে সমস্যা হচ্ছে। অ্যাডমিনকে জানাচ্ছি।', needsHuman: true });
  }
}
