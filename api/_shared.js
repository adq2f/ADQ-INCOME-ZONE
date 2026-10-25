import admin from "firebase-admin";

export { admin };

export const ALLOWED_METHODS = ["bkash", "nagad", "rocket"];
export const MIN_WITHDRAW = 1;
export const ACCOUNT_RE = /^[0-9+\-]{6,20}$/;

export function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export function getDb() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT env missing");
    const sa = JSON.parse(raw);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  return admin.firestore();
}

export async function verifyUser(req) {
  getDb();
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

// রিটার্ন: "ok" | "bad" (ভুল পাসওয়ার্ড) | "toomany" (Firebase নিজেই ব্লক করেছে) | "error" (নেটওয়ার্ক/সার্ভার সমস্যা)
export async function verifyPassword(email, password) {
  if (!email || !password) return "bad";
  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: false })
      }
    );
    if (r.ok) return "ok";
    const d = await r.json().catch(() => null);
    const msg = String(d?.error?.message || "");
    if (msg.includes("TOO_MANY_ATTEMPTS")) return "toomany";
    if (r.status === 400) return "bad";
    console.error("verifyPassword unexpected:", r.status, msg);
    return "error";
  } catch (e) {
    console.error("verifyPassword fetch error:", e.message);
    return "error";
  }
}
