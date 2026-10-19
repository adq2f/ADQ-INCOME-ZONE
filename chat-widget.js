import { auth, db } from "./firebase.js";
import {
  doc, getDoc, setDoc, collection, addDoc,
  query, orderBy, onSnapshot, updateDoc, increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

export function initChatWidget() {
  if (document.getElementById("chatFab")) return;

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <button class="chat-fab" id="chatFab" title="Live Chat">
      💬 <span class="fab-badge" id="chatBadge" style="display:none">0</span>
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
