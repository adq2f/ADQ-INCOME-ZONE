import { auth, db } from "./firebase.js";
import {
  doc, getDoc, setDoc, collection, addDoc,
  query, orderBy, onSnapshot, updateDoc, increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ============ DARK PREMIUM STYLES (style.css-এর উপরে বসে) ============
function injectChatStyles() {
  if (document.getElementById("adq-chat-styles")) return;
  const s = document.createElement("style");
  s.id = "adq-chat-styles";
  s.textContent = `
    body .chat-fab{bottom:calc(98px + env(safe-area-inset-bottom,0px));right:16px;width:58px;height:58px;font-size:25px;background:linear-gradient(135deg,#6366f1,#8b5cf6 55%,#a855f7);background-size:200% 200%;border:1px solid rgba(255,255,255,.3);box-shadow:0 16px 36px -8px rgba(139,92,246,.9),inset 0 1px 0 rgba(255,255,255,.35)}
    body .chat-fab .fab-badge{border:2px solid #06060f;background:#ef4444}
    body .chat-panel{max-width:440px;height:86vh;height:86dvh;background:linear-gradient(180deg,#17172f,#0b0b1c);border:1px solid rgba(255,255,255,.12);border-bottom:none;border-radius:28px 28px 0 0;box-shadow:0 -24px 70px -10px rgba(0,0,0,.85);color:#f4f4ff;font-family:'Hind Siliguri','Inter',sans-serif}
    body .chat-panel-head{background:linear-gradient(135deg,#4338ca,#7c3aed 55%,#c026d3);border-radius:28px 28px 0 0;padding:16px 16px;box-shadow:inset 0 1px 0 rgba(255,255,255,.25)}
    body .chat-close{background:rgba(255,255,255,.18)}
    body .chat-admin-avatar{background:linear-gradient(135deg,#fbbf24,#f59e0b);box-shadow:0 8px 20px -4px rgba(0,0,0,.4)}
    body .chat-online-dot{border-color:#4338ca}
    body .chat-panel-info h4{color:#fff}
    body .chat-panel-info p{color:rgba(255,255,255,.8)}
    body .admin-online-badge{color:#a7f3d0}
    body .admin-online-badge.offline{color:#cbd5e1}
    body .chat-body{background:transparent;padding:16px;gap:10px}
    body .chat-body::-webkit-scrollbar{width:0}
    body .chat-msg{font-size:14px;line-height:1.55;border-radius:18px}
    body .chat-msg.user{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;border-bottom-right-radius:5px;box-shadow:0 10px 22px -10px rgba(139,92,246,.9)}
    body .chat-msg.admin{background:rgba(255,255,255,.08);color:#f4f4ff;border:1px solid rgba(255,255,255,.1);border-bottom-left-radius:5px;box-shadow:none}
    body .chat-msg .msg-time{opacity:.65}
    body .chat-empty{color:#9a9bb8}
    body .chat-input-bar{background:rgba(255,255,255,.04);border-top:1px solid rgba(255,255,255,.1)}
    body .chat-input-bar input{background:rgba(255,255,255,.06);border:1.5px solid rgba(255,255,255,.12);color:#fff;border-radius:999px}
    body .chat-input-bar input::placeholder{color:#6f7090}
    body .chat-input-bar input:focus{border-color:rgba(139,92,246,.9);background:rgba(139,92,246,.1);box-shadow:0 0 0 4px rgba(139,92,246,.18)}
    body .chat-send{background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 10px 22px -8px rgba(139,92,246,.95)}
    body .chat-send:disabled{background:rgba(255,255,255,.12);box-shadow:none}
    body .fab-online{position:absolute;bottom:2px;right:2px;width:15px;height:15px;border-radius:50%;background:#10b981;border:2.5px solid #06060f;animation:onlinePulse 2s infinite}
    body .fab-pill{position:fixed;z-index:9997;bottom:calc(112px + env(safe-area-inset-bottom,0px));right:84px;align-items:center;padding:7px 13px;border-radius:999px;font-size:12px;font-weight:700;color:#a7f3d0;background:rgba(18,18,40,.88);border:1px solid rgba(16,185,129,.5);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 12px 26px -10px rgba(16,185,129,.7);white-space:nowrap}
  `;
  document.head.appendChild(s);
}

export function initChatWidget() {
  if (document.getElementById("chatFab")) return;
  injectChatStyles();

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <span class="fab-pill" id="fabPill" style="display:none">🟢 Admin Online</span>
    <button class="chat-fab" id="chatFab" title="Live Chat">
      💬 <span class="fab-online" id="fabOnline" style="display:none"></span><span class="fab-badge" id="chatBadge" style="display:none">0</span>
    </button>
    <div class="chat-panel" id="chatPanel">
      <div class="chat-panel-head">
        <button class="chat-close" id="chatClose" style="font-size:20px;margin-right:5px;">←</button>
        <div class="chat-admin-avatar">
          🛡️ <span class="chat-online-dot" id="chatOnlineDot"></span>
        </div>
        <div class="chat-panel-info">
          <h4 id="chatAdminName">ADQ Admin <span class="admin-online-badge" id="chatStatusText">Online</span></h4>
          <p>সাধারণত ৫ মিনিটে রিপ্লাই</p>
        </div>
      </div>
      <div class="chat-body" id="chatBody">
        <div class="chat-empty"><span class="em">👋</span>স্বাগতম! এখানে লিখুন, Admin শীঘ্রই রিপ্লাই দেবে।</div>
      </div>
      <div class="chat-input-bar">
        <input type="text" id="chatInput" placeholder="মেসেজ লিখুন..." maxlength="500">
        <button class="chat-send" id="chatSend">➤</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  const fab = document.getElementById("chatFab");
  const panel = document.getElementById("chatPanel");
  const body = document.getElementById("chatBody");
  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("chatSend");
  const badge = document.getElementById("chatBadge");

  let currentUser = null;
  let userData = null;
  let chatId = null;
  let unsubMsgs = null;
  let unsubChat = null;

  function watchOnlineStatus() {
    try {
      const ref = doc(db, "settings", "online_status");
      onSnapshot(ref, (snap) => {
        const data = snap.exists() ? snap.data() : { adminOnline: false };
        const dot = document.getElementById("chatOnlineDot");
        const statusText = document.getElementById("chatStatusText");
        const adminName = document.getElementById("chatAdminName");
        const isOnline = data.adminOnline === true;
        const name = data.adminName || "ADQ Admin";

        if (dot) dot.classList.toggle("offline", !isOnline);
        const fo = document.getElementById("fabOnline");
        const fp = document.getElementById("fabPill");
        if (fo) fo.style.display = isOnline ? "block" : "none";
        if (fp) fp.style.display = isOnline ? "inline-flex" : "none";
        const fb = document.getElementById("chatFab");
        if (fb) fb.title = isOnline ? "Admin Online — Live Chat" : "Live Chat";
        if (adminName) {
          adminName.innerHTML = `${escapeHtml(name)} <span class="admin-online-badge ${isOnline ? '' : 'offline'}" id="chatStatusText">${isOnline ? 'Online' : 'Offline'}</span>`;
        }
      });
    } catch (e) {}
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    currentUser = user;

    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists()) userData = snap.data();
    } catch (e) {}

    chatId = user.uid;
    const chatRef = doc(db, "chats", chatId);

    try {
      const chatSnap = await getDoc(chatRef);
      if (!chatSnap.exists()) {
        await setDoc(chatRef, {
          userId: user.uid,
          username: userData?.username || "User",
          userEmail: userData?.email || "",
          lastMessage: "",
          lastMessageAt: serverTimestamp(),
          lastSender: "user",
          unreadForAdmin: 0,
          unreadForUser: 0,
          createdAt: serverTimestamp()
        });
      }
    } catch (e) {}

    unsubChat = onSnapshot(chatRef, (s) => {
      if (!s.exists()) return;
      const cnt = s.data().unreadForUser || 0;
      if (cnt > 0) {
        badge.style.display = "flex";
        badge.textContent = cnt > 99 ? "99+" : cnt;
      } else {
        badge.style.display = "none";
      }
    });

    if (unsubMsgs) unsubMsgs();
    const msgsRef = collection(db, "chats", chatId, "messages");
    const q = query(msgsRef, orderBy("createdAt", "asc"));
    unsubMsgs = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (msgs.length === 0) {
        body.innerHTML = `<div class="chat-empty"><span class="em">👋</span>স্বাগতম! এখানে লিখুন, Admin শীঘ্রই রিপ্লাই দেবে।</div>`;
      } else {
        body.innerHTML = msgs.map(m => {
          const t = m.createdAt?.toDate?.();
          const time = t ? t.toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" }) : "";
          return `<div class="chat-msg ${m.sender}">${escapeHtml(m.text)}<span class="msg-time">${time}</span></div>`;
        }).join("");
        body.scrollTop = body.scrollHeight;
      }
    });
  });

  fab.onclick = async () => {
    panel.classList.add("open");
    history.pushState({ chatOpen: true }, ""); // মোবাইল ব্যাক বাটন হ্যান্ডেল করার জন্য
    if (chatId) {
      try {
        const cRef = doc(db, "chats", chatId);
        const cSnap = await getDoc(cRef);
        if (cSnap.exists() && (cSnap.data().unreadForUser || 0) > 0) {
          await updateDoc(cRef, { unreadForUser: 0 });
        }
      } catch (e) {}
    }
  };

  // ক্লোজ বাটনে ক্লিক করলে
  document.getElementById("chatClose").onclick = () => {
    panel.classList.remove("open");
    history.back(); // হিস্ট্রি থেকে সরানো
  };

  // মোবাইলের ফিজিক্যাল ব্যাক বাটনে ক্লিক করলে চ্যাট বন্ধ হবে
  window.addEventListener("popstate", () => {
    if (panel.classList.contains("open")) {
      panel.classList.remove("open");
    }
  });

  sendBtn.onclick = async () => {
    const text = input.value.trim();
    if (!text || !currentUser || !chatId) return;
    sendBtn.disabled = true;
    try {
      await addDoc(collection(db, "chats", chatId, "messages"), {
        sender: "user",
        senderName: userData?.username || "User",
        text,
        createdAt: serverTimestamp(),
        readByAdmin: false,
        readByUser: true
      });
      await updateDoc(doc(db, "chats", chatId), {
        lastMessage: text,
        lastMessageAt: serverTimestamp(),
        lastSender: "user",
        unreadForAdmin: increment(1)
      });
      input.value = "";
    } catch (e) { alert("❌ " + e.message); }
    sendBtn.disabled = false;
  };

  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendBtn.click();
  });

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  watchOnlineStatus();
}
