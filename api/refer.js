// ==================================================
// api/refer.js — Refer code যাচাই (login ছাড়াই) + apply (login করা user)
// ==================================================
import { admin, getDb, setCors, verifyUser, toMs } from "./_shared.js";

export const config = { maxDuration: 15 };

const CODE_RE = /^[A-Z0-9]{3,12}$/;
const WINDOW_MS = 60 * 1000;
const MAX_CHECKS = 20;          // প্রতি IP প্রতি মিনিটে সর্বোচ্চ check
const APPLY_WINDOW_MS = 15 * 60 * 1000; // নতুন অ্যাকাউন্টের ১৫ মিনিটের মধ্যেই শুধু apply হবে
const hits = new Map();

function tooMany(req) {
  const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > MAX_CHECKS;
}

async function findOwner(db, code) {
  const s = await db.collection("users").where("myReferCode", "==", code).limit(1).get();
  return s.empty ? null : s.docs[0];
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ valid: false, ok: false, error: "Method not allowed" });

  let db;
  try { db = getDb(); }
  catch (e) {
    console.error("Firebase init error:", e.message);
    return res.status(500).json({ valid: false, ok: false, error: "server config" });
  }

  const body = req.method === "POST" ? (req.body || {}) : {};
  const action = req.method === "POST" ? String(body.action || "check") : "check";
  const code = String(body.code || req.query?.code || "").toUpperCase().trim();

  if (!CODE_RE.test(code)) return res.status(200).json({ valid: false, ok: false });

  try {
    // ---------- check: login ছাড়াই ----------
    if (action === "check") {
      if (tooMany(req)) return res.status(429).json({ valid: false, error: "অনেকবার চেষ্টা হয়েছে" });
      const owner = await findOwner(db, code);
      if (!owner) return res.status(200).json({ valid: false });
      return res.status(200).json({ valid: true, username: owner.data().username || "User" });
    }

    // ---------- apply: signup শেষে (login করা অবস্থায়) ----------
    if (action === "apply") {
      if (req.method !== "POST") return res.status(405).json({ ok: false });
      const user = await verifyUser(req);
      if (!user) return res.status(401).json({ ok: false, error: "login" });

      const meRef = db.doc(`users/${user.uid}`);
      const meSnap = await meRef.get();
      if (!meSnap.exists) return res.status(404).json({ ok: false, error: "no user" });
      const me = meSnap.data();

      if (me.referredBy) return res.status(200).json({ ok: true, already: true });
      if (Date.now() - toMs(me.createdAt) > APPLY_WINDOW_MS)
        return res.status(403).json({ ok: false, error: "too late" });

      const owner = await findOwner(db, code);
      if (!owner || owner.id === user.uid) return res.status(200).json({ ok: false });

      const batch = db.batch();
      batch.update(meRef, { referredBy: owner.id });
      batch.update(owner.ref, { referCount: admin.firestore.FieldValue.increment(1) });
      await batch.commit();

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: "bad action" });
  } catch (e) {
    console.error("refer error:", e);
    return res.status(500).json({ valid: false, ok: false, error: "server" });
  }
}
