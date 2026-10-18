// ==================================================
// ADQ INCOME ZONE — PREMIUM POPUP SYSTEM
// Welcome Splash + Notice Popup + Live Badge
// ==================================================
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc, getDoc, collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ============ WELCOME SPLASH (once per session) ============
export function showWelcomeSplash(username) {
  if (sessionStorage.getItem("adq_welcome_shown")) return;
  sessionStorage.setItem("adq_welcome_shown", "1");

  const el = document.createElement("div");
  el.id = "welcomeSplash";
  el.innerHTML = `
    <div class="ws-bg"></div>
    <div class="ws-card">
      <div class="ws-logo">⚡</div>
      <h1 class="ws-title">স্বাগতম!</h1>
      <p class="ws-name">👋 ${escapeHtml(username || "User")}</p>
      <p class="ws-sub">ADQ Income Zone — Premium Earning Platform</p>
      <div class="ws-loader"><div class="ws-loader-fill"></div></div>
    </div>
  `;
  document.body.appendChild(el);

  setTimeout(() => {
    el.classList.add("closing");
    setTimeout(() => el.remove(), 500);
  }, 2200);
}

// ============ NOTICE POPUP (প্রথমবার দেখলে) ============
export async function showNoticePopup() {
  try {
    const q = query(collection(db, "notices"), where("active", "==", true));
    const snap = await getDocs(q);
    if (snap.empty) return;

    const notices = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

    const latest = notices[0];
    const seenKey = `adq_notice_seen_${latest.id}`;
    if (localStorage.getItem(seenKey)) return; // already seen

    const timeStr = latest.createdAt?.toDate?.().toLocaleString("bn-BD", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
    }) || "";

    const apkBtn = latest.apkUrl
      ? `<a href="${escapeAttr(latest.apkUrl)}" class="np-btn np-btn-apk" target="_blank" rel="noopener noreferrer">⬇️ Download APK</a>` : "";
    const linkBtn = latest.linkUrl
      ? `<a href="${escapeAttr(latest.linkUrl)}" class="np-btn np-btn-link" target="_blank" rel="noopener noreferrer">🔗 Open Link</a>` : "";

    const el = document.createElement("div");
    el.id = "noticePopup";
    el.className = "notice-popup-overlay";
    el.innerHTML = `
      <div class="notice-popup-card">
        <button class="np-close" id="npClose">✕</button>
        <div class="np-head">
          <div class="np-bell">🔔</div>
          <div>
            <div class="np-label">📢 নতুন নোটিশ</div>
            <h2 class="np-title">${escapeHtml(latest.title)}</h2>
          </div>
        </div>
        <div class="np-msg">${escapeHtml(latest.message)}</div>
        ${(apkBtn || linkBtn) ? `<div class="np-actions">${apkBtn}${linkBtn}</div>` : ""}
        <div class="np-time">🕐 ${timeStr}</div>
        <button class="np-dismiss" id="npDismiss">বুঝেছি ✓</button>
      </div>
    `;
    document.body.appendChild(el);

    requestAnimationFrame(() => el.classList.add("show"));

    const close = () => {
      localStorage.setItem(seenKey, "1");
      el.classList.remove("show");
      setTimeout(() => el.remove(), 400);
    };
    document.getElementById("npClose").onclick = close;
    document.getElementById("npDismiss").onclick = close;
    el.addEventListener("click", (e) => { if (e.target === el) close(); });
  } catch (e) {
    console.error("notice popup:", e);
  }
}

// ============ LIVE BADGE — Task card-এ "● LIVE" pulse ============
export function injectLiveBadges() {
  const tryInject = () => {
    document.querySelectorAll(".hq-task-card .hq-badge.open").forEach(badge => {
      if (badge.dataset.liveAdded) return;
      badge.dataset.liveAdded = "1";
      const live = document.createElement("span");
      live.className = "hq-live-dot";
      live.textContent = "● LIVE";
      badge.parentNode.insertBefore(live, badge.nextSibling);
    });
  };
  tryInject();
  const observer = new MutationObserver(tryInject);
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 30000);
}

// ============ INIT (call once per page) ============
export function initPremiumPopups() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) return;
      const u = snap.data();
      showWelcomeSplash(u.username);
      setTimeout(() => showNoticePopup(), 2400);
      injectLiveBadges();
    } catch (e) {
      console.error("popup init:", e);
    }
  });
}

// ============ UTIL ============
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
