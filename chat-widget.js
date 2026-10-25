import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc, getDoc, setDoc, collection, query, orderBy, onSnapshot,
  updateDoc, increment, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ==================================================
// ⚙️ সেটিংস
// ==================================================
const AI_URL = (location.hostname.endsWith("vercel.app") || location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "/api/ai-support"
  : "https://adq-income-zone.vercel.app/api/ai-support";

const AI_WHEN_ADMIN_ONLINE = true;

function injectChatStyles() {
  if (document.getElementById("adq-chat-styles")) return;
  const s = document.createElement("style");
  s.id = "adq-chat-styles";
  s.textContent = `
    body .chat-fab { bottom: calc(98px + env(safe-area-inset-bottom, 0px)); right: 16px; width: 58px; height: 58px; font-size: 25px; background: linear-gradient(135deg, #6366f1, #8b5cf6 55%, #a855f7); background-size: 200% 200%; border: 1px solid rgba(255,255,255,.3); box-shadow: 0 16px 36px -8px rgba(139,92,246,.9), inset 0 1px 0 rgba(255,255,255,.35); transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1); animation: fabFloat 3s ease-in-out infinite, fabGradient 6s ease infinite; }
    @keyframes fabFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @keyframes fabGradient { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
    body .chat-fab:hover { transform: scale(1.1) rotate(-6deg); }
    body .chat-fab .fab-badge { border: 2px solid #06060f; background: #ef4444; }
    body .fab-online { position: absolute; bottom: 2px; right: 2px; width: 15px; height: 15px; border-radius: 50%; background: #10b981; border: 2.5px solid #06060f; animation: onlinePulse 2s infinite; }
    body .fab-pill { position: fixed; z-index: 9997; bottom: calc(112px + env(safe-area-inset-bottom,0px)); right: 84px; align-items: center; padding: 7px 13px; border-radius: 999px; font-size: 12px; font-weight: 700; color: #a7f3d0; background: rgba(18,18,40,.88); border: 1px solid rgba(16,185,129,.5); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: 0 12px 26px -10px rgba(16,185,129,.7); white-space: nowrap; }
    body .chat-panel { max-width: 440px; height: 86vh; height: 86dvh; background: linear-gradient(180deg, #17172f, #0b0b1c); border: 1px solid rgba(255,255,255,.12); border-bottom: none; border-radius: 28px 28px 0 0; box-shadow: 0 -24px 70px -10px rgba(0,0,0,.85); color: #f4f4ff; font-family: 'Hind Siliguri', 'Inter', sans-serif; display: flex; flex-direction: column; }
    body .chat-panel-head { background: linear-gradient(135deg, #4338ca, #7c3aed 55%, #c026d3); border-radius: 28px 28px 0 0; padding: 16px; box-shadow: inset 0 1px 0 rgba(255,255,255,.25); display: flex; align-items: center; gap: 12px; }
    body .chat-admin-avatar { width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, #fbbf24, #f59e0b); display: flex; align-items: center; justify-content: center; font-size: 20px; position: relative; box-shadow: 0 8px 20px -4px rgba(0,0,0,.4); }
    body .chat-online-dot { position: absolute; bottom: 1px; right: 1px; width: 12px; height: 12px; border-radius: 50%; background: #10b981; border: 2px solid #4338ca; animation: onlinePulse 2s infinite; }
    body .chat-online-dot.offline { background: #94a3b8; animation: none; }
    @keyframes onlinePulse { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.7); } 70% { box-shadow: 0 0 0 10px rgba(16,185,129,0); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } }
    body .chat-panel-info h4 { font-size: 15px; font-weight: 700; margin: 0 0 2px; color: #fff; display: flex; align-items: center; gap: 6px; }
    body .chat-panel-info p { font-size: 11.5px; color: rgba(255,255,255,.8); margin: 0; }
    body .chat-close { width: 34px; height: 34px; border-radius: 50%; background: rgba(255,255,255,.18); border: none; color: white; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s; }
    body .chat-close:hover { background: rgba(255,255,255,.32); }
    body .chat-body { flex: 1; overflow-y: auto; padding: 16px; gap: 10px; display: flex; flex-direction: column; scroll-behavior: smooth; }
    body .chat-body::-webkit-scrollbar { width: 0; }
    body .chat-msg { max-width: 80%; padding: 10px 14px; border-radius: 18px; font-size: 14px; line-height: 1.55; word-wrap: break-word; animation: msgIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both; }
    @keyframes msgIn { from { opacity: 0; transform: translateY(8px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
    body .chat-msg.user { align-self: flex-end; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; border-bottom-right-radius: 5px; box-shadow: 0 10px 22px -10px rgba(139,92,246,.9); }
    body .chat-msg.admin { align-self: flex-start; background: rgba(255,255,255,.08); color: #f4f4ff; border: 1px solid rgba(255,255,255,.1); border-bottom-left-radius: 5px; }
    body .chat-msg .msg-time { display: block; font-size: 10px; opacity: 0.65; margin-top: 4px; }
    body .ai-tag { font-size: 9px; font-weight: 800; background: rgba(255,255,255,.18); padding: 1px 7px; border-radius: 8px; margin-left: 6px; vertical-align: 1px; }
    body .chat-typing { display: inline-flex; gap: 4px; align-items: center; padding: 4px 2px; }
    body .chat-typing i { width: 7px; height: 7px; border-radius: 50%; background: #a5b4fc; animation: adqDot 1.2s infinite ease-in-out; }
    body .chat-typing i:nth-child(2) { animation-delay: .18s; }
    body .chat-typing i:nth-child(3) { animation-delay: .36s; }
    @keyframes adqDot { 0%, 80%, 100% { transform: scale(.55); opacity: .4; } 40% { transform: scale(1); opacity: 1; } }
    body .chat-input-bar { padding: 12px 14px; background: rgba(255,255,255,.04); border-top: 1px solid rgba(255,255,255,.1); display: flex; gap: 8px; align-items: center; padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }
    body .chat-input-bar input { flex: 1; padding: 12px 16px; border: 1.5px solid rgba(255,255,255,.12); border-radius: 999px; font-size: 14px; font-family: inherit; outline: none; margin: 0; transition: 0.2s; background: rgba(255,255,255,.06); color: #fff; }
    body .chat-input-bar input::placeholder { color: #6f7090; }
    body .chat-input-bar input:focus { border-color: rgba(139,92,246,.9); background: rgba(139,92,246,.1); box-shadow: 0 0 0 4px rgba(139,92,246,.18); }
    body .chat-send { width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; border: none; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 22px -8px rgba(139,92,246,.95); transition: 0.2s; flex-shrink: 0; }
    body .chat-send:hover { transform: scale(1.08); }
    body .chat-send:disabled { background: rgba(255,255,255,.12); box-shadow: none; cursor: not-allowed; }
    body .chat-empty { text-align: center; color: #9a9bb8; padding: 40px 20px; font-size: 13px; }
    body .chat-empty .em { font-size: 48px; display: block; margin-bottom: 10px; animation: fabFloat 3s ease-in-out infinite; }
  `;
  document.head.appendChild(s);
}

let currentUser = null;
let userName = "User";
let chatId = null;
let unsubMsgs = null;
let recentMessages = [];

export function initChatWidget() {
  if (document.getElementById("chatWidgetFab")) return;
  injectChatStyles();

  const pill = document.createElement("span");
  pill.className = "fab-pill";
  pill.id = "fabPill";
  pill.style.display = "none";
  pill.textContent = "🟢 Admin Online";
  document.body.appendChild(pill);

  const fab = document.createElement("button");
  fab.id = "chatWidgetFab";
  fab.className = "chat-fab";
  fab.title = "Live Chat";
  fab.innerHTML = `💬<span class="fab-online" id="fabOnline" style="display:none"></span><span class="fab-badge" id="chatBadge" style="display:none">0</span>`;
  document.body.appendChild(fab);

  const panel = document.createElement("div");
  panel.id = "chatWidgetPanel";
  panel.className = "chat-panel";
  panel.innerHTML = `
    <div class="chat-panel-head">
      <div class="chat-admin-avatar">
        <span style="font-size:20px;">🎧</span>
        <span class="chat-online-dot" id="chatOnlineDot"></span>
      </div>
      <div class="chat-panel-info">
        <h4>ADQ Support</h4>
        <p id="chatOnlineText">Connecting...</p>
      </div>
      <button class="chat-close" id="chatCloseBtn" aria-label="Close">✕</button>
    </div>
    <div class="chat-body" id="chatBody">
      <div class="chat-empty"><span class="em">👋</span>স্বাগতম! আমাদের এআই অ্যাসিস্ট্যান্ট আপনাকে সাহায্য করতে প্রস্তুত।</div>
    </div>
    <div class="chat-input-bar">
      <input type="text" id="chatInput" placeholder="আপনার প্রশ্ন লিখুন..." maxlength="500">
      <button class="chat-send" id="chatSendBtn" aria-label="Send">➤</button>
    </div>
  `;
  document.body.appendChild(panel);

  const body = document.getElementById("chatBody");
  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("chatSendBtn");
  const badge = document.getElementById("chatBadge");

  let adminOnline = false;
  let waitingAI = false;
  let sending = false;
  let lastDocs = [];

  const EMPTY_HTML = `<div class="chat-empty"><span class="em">👋</span>স্বাগতম! আমাদের এআই অ্যাসিস্ট্যান্ট আপনাকে সাহায্য করতে প্রস্তুত।</div>`;

  function paintOnline(isOnline) {
    adminOnline = !!isOnline;
    const dot = document.getElementById("chatOnlineDot");
    const txt = document.getElementById("chatOnlineText");
    const fo = document.getElementById("fabOnline");
    const fp = document.getElementById("fabPill");
    if (adminOnline) {
      dot.classList.remove("offline");
      txt.textContent = "Admin Online";
      txt.style.color = "#6ee7b7";
    } else {
      dot.classList.add("offline");
      txt.textContent = "AI Assistant Available";
      txt.style.color = "#cbd5e1";
    }
    if (fo) fo.style.display = adminOnline ? "block" : "none";
    if (fp) fp.style.display = adminOnline ? "inline-flex" : "none";
    fab.title = adminOnline ? "Admin Online — Live Chat" : "Live Chat";
  }

  function listenAdminStatus() {
    onSnapshot(doc(db, "settings", "online_status"), (snap) => {
      paintOnline(snap.exists() ? snap.data().adminOnline === true : false);
    }, () => {});
  }

  function render() {
    if (!lastDocs.length && !waitingAI) { body.innerHTML = EMPTY_HTML; return; }
    let html = lastDocs.map(d => {
      const m = d.data();
      const t = m.createdAt?.toDate?.();
      const time = t ? t.toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" }) : "";
      return `<div class="chat-msg ${m.sender === "user" ? "user" : "admin"}">
        ${escapeHtml(m.text)}${m.isAI ? '<span class="ai-tag">AI</span>' : ""}
        <span class="msg-time">${time}</span>
      </div>`;
    }).join("");
    if (waitingAI) html += `<div class="chat-msg admin"><span class="chat-typing"><i></i><i></i><i></i></span></div>`;
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;
  }

  function loadChatHistory() {
    if (unsubMsgs) unsubMsgs();
    const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"));
    unsubMsgs = onSnapshot(q, (snap) => {
      lastDocs = snap.docs;
      recentMessages = [];
      snap.docs.forEach(d => {
        const m = d.data();
        if (m.sender === "user") recentMessages.push({ role: "user", text: m.text });
        else if (m.sender === "admin") recentMessages.push({ role: "model", text: m.text });
      });
      recentMessages = recentMessages.slice(-8);
      render();
    }, (e) => console.error("chat history:", e));

    onSnapshot(doc(db, "chats", chatId), (s) => {
      if (!s.exists()) return;
      const cnt = s.data().unreadForUser || 0;
      if (cnt > 0 && panel.classList.contains("open")) {
        updateDoc(doc(db, "chats", chatId), { unreadForUser: 0 }).catch(() => {});
        badge.style.display = "none";
      } else if (cnt > 0) {
        badge.style.display = "flex";
        badge.textContent = cnt > 99 ? "99+" : cnt;
      } else {
        badge.style.display = "none";
      }
    }, () => {});
  }

  fab.onclick = () => {
    panel.classList.add("open");
    badge.style.display = "none";
    if (chatId) updateDoc(doc(db, "chats", chatId), { unreadForUser: 0 }).catch(() => {});
    body.scrollTop = body.scrollHeight;
    setTimeout(() => input.focus(), 350);
  };
  document.getElementById("chatCloseBtn").onclick = () => panel.classList.remove("open");

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    currentUser = user;
    chatId = user.uid;
    try {
      const u = await getDoc(doc(db, "users", user.uid));
      if (u.exists()) userName = u.data().username || user.displayName || "User";
    } catch (e) {}
    loadChatHistory();
    listenAdminStatus();
  });

  function buildHistory(text) {
    const h = recentMessages.slice();
    if (h.length && h[h.length - 1].role === "user" && h[h.length - 1].text === text) h.pop();
    return h.slice(-6);
  }

  async function getAIReply(text) {
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(AI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ message: text, history: buildHistory(text) })
      });
      let data = null;
      try { data = await res.json(); } catch (e) {}
      if (!res.ok && !(data && data.reply)) {
        console.error("🔥 AI API ERROR:", res.status, data);
        return null;
      }
      if (data && data.error) console.warn("⚠️ AI note:", data.error);
      return data;
    } catch (e) {
      console.error("🔥 AI FETCH ERROR:", e);
      return null;
    }
  }

  async function sendMessage() {
    if (sending) return; 
    const text = input.value.trim();
    if (!text || !currentUser) return;
    
    sending = true;
    input.value = "";
    sendBtn.disabled = true;

    const chatRef = doc(db, "chats", chatId);
    try {
      const chatSnap = await getDoc(chatRef);
      if (!chatSnap.exists()) {
        await setDoc(chatRef, {
          userId: currentUser.uid,
          username: userName,
          userEmail: currentUser.email || "",
          lastMessage: text,
          lastMessageAt: serverTimestamp(),
          lastSender: "user",
          unreadForAdmin: 1,
          unreadForUser: 0,
          createdAt: serverTimestamp()
        });
      } else {
        await updateDoc(chatRef, {
          lastMessage: text,
          lastMessageAt: serverTimestamp(),
          lastSender: "user",
          unreadForAdmin: increment(1)
        });
      }
      await addDoc(collection(db, "chats", chatId, "messages"), {
        sender: "user",
        senderName: userName,
        text,
        createdAt: serverTimestamp(),
        readByAdmin: false,
        readByUser: true
      });
    } catch (e) {
      input.value = text;
      sending = false;
      sendBtn.disabled = false;
      return;
    }

    if (!AI_WHEN_ADMIN_ONLINE && adminOnline) { sending = false; sendBtn.disabled = false; return; }

    waitingAI = true; render();
    const aiData = await getAIReply(text);
    waitingAI = false; render();

    if (aiData && aiData.reply) {
      try {
        await addDoc(collection(db, "chats", chatId, "messages"), {
          sender: "admin",
          senderName: "ADQ Support",
          text: aiData.reply,
          isAI: true,
          createdAt: serverTimestamp(),
          readByAdmin: true,
          readByUser: true
        });
        const updates = {
          lastMessage: aiData.reply,
          lastMessageAt: serverTimestamp(),
          lastSender: "admin",
          unreadForUser: panel.classList.contains("open") ? 0 : increment(1)
        };
        if (aiData.needsHuman) updates.unreadForAdmin = increment(1);
        await updateDoc(chatRef, updates);
      } catch (e) {}
    } else {
      // 🚀 যদি এআই থেকে কোনো উত্তর না আসে, তবে চ্যাটে একটি সুন্দর এরর মেসেজ দেখাবে
      try {
        await addDoc(collection(db, "chats", chatId, "messages"), {
          sender: "admin",
          senderName: "ADQ Support",
          text: "দুঃখিত, আমি এই মুহূর্তে উত্তর দিতে পারছি না। ইন্টারনেট চেক করুন বা অ্যাডমিনের সাথে কথা বলুন।",
          isAI: true,
          createdAt: serverTimestamp(),
          readByAdmin: true,
          readByUser: true
        });
      } catch (e) {}
    }

    sending = false;
    sendBtn.disabled = false;
  }

  sendBtn.onclick = sendMessage;
  input.addEventListener("keypress", (e) => { if (e.key === "Enter") sendMessage(); });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
