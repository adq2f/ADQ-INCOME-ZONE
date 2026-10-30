// ==================================================
// ADQ INCOME ZONE — PREMIUM POPUP SYSTEM (Dark Premium)
// Welcome Splash + Notice Popup + Live Badge
// ==================================================
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc, getDoc, collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ============ DARK PREMIUM STYLES (style.css-এর উপরে বসে) ============
function injectPopupStyles() {
  if (document.getElementById("adq-popup-styles")) return;
  const s = document.createElement("style");
  s.id = "adq-popup-styles";
  s.textContent = `
    body #welcomeSplash .ws-bg{background:#06060f}
    body #welcomeSplash .ws-bg::after{background:radial-gradient(circle at 18% 25%,rgba(99,102,241,.55),transparent 45%),radial-gradient(circle at 82% 75%,rgba(168,85,247,.5),transparent 45%),radial-gradient(circle at 70% 15%,rgba(34,211,238,.25),transparent 40%)}
    body #welcomeSplash .ws-card{background:linear-gradient(160deg,rgba(255,255,255,.09),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.14);border-radius:30px;box-shadow:0 30px 80px -20px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.14)}
    body #welcomeSplash .ws-logo{background:linear-gradient(135deg,#6366f1,#8b5cf6 55%,#22d3ee);box-shadow:0 20px 50px -8px rgba(139,92,246,.8),inset 0 2px 0 rgba(255,255,255,.35);color:#fff}
    body #welcomeSplash .ws-title{font-family:'Hind Siliguri','Inter',sans-serif}
    body #welcomeSplash .ws-name{color:#fde68a}
    body #welcomeSplash .ws-loader{background:rgba(255,255,255,.12)}
    body #welcomeSplash .ws-loader-fill{background:linear-gradient(90deg,#6366f1,#22d3ee)}

    body .notice-popup-overlay{background:rgba(3,3,10,.78);padding:16px;display:flex;align-items:center;justify-content:center}
    body .notice-popup-card{
      background:linear-gradient(180deg,#17172f,#0d0d1f);
      border:1px solid rgba(255,255,255,.14);
      border-radius:28px;
      color:#f4f4ff;
      box-shadow:0 30px 80px -10px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.1);
      display:flex;
      flex-direction:column;
      max-height:min(85vh,85dvh);
      max-height:min(85vh,85dvh);
      width:100%;
      max-width:400px;
      position:relative;
      overflow:hidden;
      padding:0;
    }
    body .notice-popup-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#fbbf24,#f59e0b,#a855f7);z-index:2}
    body .notice-popup-card .np-close{
      position:absolute;top:14px;right:14px;
      width:34px;height:34px;border-radius:50%;
      background:rgba(255,255,255,.08);color:#9a9bb8;
      border:1px solid rgba(255,255,255,.1);
      cursor:pointer;font-size:15px;
      display:flex;align-items:center;justify-content:center;
      transition:.2s;z-index:10;
    }
    body .notice-popup-card .np-close:hover{background:rgba(255,255,255,.16);color:#fff;transform:rotate(90deg)}
    body .notice-popup-card .np-bell{background:linear-gradient(135deg,#fbbf24,#f59e0b);box-shadow:0 10px 24px -6px rgba(245,158,11,.7)}
    body .notice-popup-card .np-label{color:#fcd34d}
    body .notice-popup-card .np-title{color:#fff}
    body .notice-popup-card .np-msg{color:#cfd0e6}
    body .notice-popup-card .np-time{color:#9a9bb8}
    body .notice-popup-card .np-btn-apk{background:linear-gradient(135deg,#10b981,#0d9488)}
    body .notice-popup-card .np-btn-link{background:linear-gradient(135deg,#6366f1,#8b5cf6)}
    body .notice-popup-card .np-dismiss{background:linear-gradient(135deg,#6366f1,#8b5cf6 55%,#a855f7);box-shadow:0 14px 30px -10px rgba(139,92,246,.9)}

    /* === ফিক্স: header + scrollable body + footer === */
    body .notice-popup-card .np-head{
      display:flex;align-items:flex-start;gap:14px;
      padding:24px 56px 14px 20px;
      flex-shrink:0;
    }
    body .notice-popup-card .np-bell{
      width:48px;height:48px;border-radius:15px;
      display:flex;align-items:center;justify-content:center;
      font-size:24px;flex-shrink:0;
      animation:npBellRing 2.5s ease-in-out infinite;
    }
    @keyframes npBellRing{0%,80%,100%{transform:rotate(0)}83%{transform:rotate(15deg)}86%{transform:rotate(-15deg)}89%{transform:rotate(10deg)}92%{transform:rotate(-10deg)}}
    body .notice-popup-card .np-label{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
    body .notice-popup-card .np-title{font-size:17px;font-weight:700;margin:0;line-height:1.3}
    body .notice-popup-scrollable{
      padding:0 20px 14px;
      overflow-y:auto;
      flex:1 1 auto;
      min-height:0;
      -webkit-overflow-scrolling:touch;
      overscroll-behavior:contain;
    }
    body .notice-popup-card .np-msg{font-size:13.5px;line-height:1.65;margin-bottom:14px;word-break:break-word}
    body .notice-popup-card .np-actions{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
    body .notice-popup-card .np-btn{
      flex:1;min-width:120px;
      display:inline-flex;align-items:center;justify-content:center;gap:6px;
      padding:12px 14px;border-radius:14px;
      font-size:13px;font-weight:700;text-decoration:none;border:none;cursor:pointer;transition:.3s;
    }
    body .notice-popup-card .np-btn:hover{transform:translateY(-2px)}
    body .notice-popup-card .np-time{font-size:11.5px;font-weight:600}
    body .notice-popup-footer{
      padding:14px 20px calc(14px + env(safe-area-inset-bottom,0px));
      background:rgba(255,255,255,.03);
      border-top:1px solid rgba(255,255,255,.1);
      flex-shrink:0;
    }
    body .notice-popup-card .np-dismiss{
      width:100%;padding:14px;border-radius:16px;
      color:#fff;border:none;
      font-size:14.5px;font-weight:700;
      cursor:pointer;transition:.2s;
    }
    body .notice-popup-card .np-dismiss:hover{transform:translateY(-2px)}
  `;
  document.head.appendChild(s);
}

// ============ WELCOME SPLASH (once per session) ============
export function showWelcomeSplash(username) {
  if (sessionStorage.getItem("adq_welcome_shown")) return;
  sessionStorage.setItem("adq_welcome_shown", "1");
  injectPopupStyles();

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

// ============ NOTICE POPUP (Fixed for Mobile) ============
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
    injectPopupStyles();

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

    // ✅ ফিক্স: header + scrollable body + fixed footer
    el.innerHTML = `
      <div class="notice-popup-card">
        <button class="np-close" id="npClose" aria-label="Close">✕</button>

        <div class="np-head">
          <div class="np-bell">🔔</div>
          <div>
            <div class="np-label">📢 নতুন নোটিশ</div>
            <h2 class="np-title">${escapeHtml(latest.title)}</h2>
          </div>
        </div>

        <div class="notice-popup-scrollable">
          <div class="np-msg">${escapeHtml(latest.message)}</div>
          ${(apkBtn || linkBtn) ? `<div class="np-actions">${apkBtn}${linkBtn}</div>` : ""}
          <div class="np-time">🕐 ${timeStr}</div>
        </div>

        <div class="notice-popup-footer">
          <button class="np-dismiss" id="npDismiss">বুঝেছি ✓</button>
        </div>
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
// নতুন dashboard (.d-task .d-badge.open) এবং পুরনো (.hq-task-card .hq-badge.open) দুটোই কাজ করবে
export function injectLiveBadges() {
  const tryInject = () => {
    document.querySelectorAll(".d-task .d-badge.open, .hq-task-card .hq-badge.open").forEach(badge => {
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
