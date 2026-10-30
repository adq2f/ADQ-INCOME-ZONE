// ==================================================
// api/leaderboard.js — শুধু নিরাপদ ফিল্ড (email, balance, wallet কিছুই যায় না)
// ==================================================
import { getDb, setCors, verifyUser, toMs } from "./_shared.js";

export const config = { maxDuration: 15 };

const CACHE_MS = 60 * 1000;
const MAX_ROWS = 300;
let cache = { at: 0, rows: null };

async function loadRows(db) {
  if (cache.rows && Date.now() - cache.at < CACHE_MS) return cache.rows;

  const snap = await db.collection("users")
    .select("username", "role", "totalGood", "totalBad", "totalReferEarning",
            "balance", "customBadge", "customBadgeColor", "createdAt")
    .get();

  const rows = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(u => u.role !== "admin")
    .map(u => ({
      id: d_id(u),
      name: (u.username && String(u.username).trim()) || "User",
      totalGood: Number(u.totalGood) || 0,
      totalBad: Number(u.totalBad) || 0,
      hasRefer: (Number(u.totalReferEarning) || 0) > 0,
      rich: (Number(u.balance) || 0) >= 1000,
      customBadge: u.customBadge || null,
      customBadgeColor: u.customBadgeColor || null,
      createdAt: toMs(u.createdAt)
    }))
    .sort((a, b) => b.totalGood - a.totalGood)
    .slice(0, MAX_ROWS);

  cache = { at: Date.now(), rows };
  return rows;
}
function d_id(u) { return u.id; }

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  let db;
  try { db = getDb(); }
  catch (e) {
    console.error("Firebase init error:", e.message);
    return res.status(500).json({ error: "সার্ভার কনফিগারেশনে সমস্যা" });
  }

  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: "লগইন করুন" });

  try {
    const rows = await loadRows(db);
    const users = rows.map(r => {
      const { id, ...safe } = r;
      return { ...safe, me: id === user.uid };
    });
    res.setHeader("Cache-Control", "private, max-age=30");
    return res.status(200).json({ users });
  } catch (e) {
    console.error("leaderboard error:", e);
    return res.status(500).json({ error: "লিডারবোর্ড লোড হয়নি" });
  }
}
