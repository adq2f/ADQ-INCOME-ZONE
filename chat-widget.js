import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc, getDoc, setDoc, collection, query, orderBy, onSnapshot,
  updateDoc, increment, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// আপনার Vercel API লিংক
const VERCEL_AI_URL = "https://adq-income-zone.vercel.app/api/ai-support";

let currentUser = null;
let chatId = null;
let unsubMsgs = null;
let recentMessages = [];

export function initChatWidget() {
  // ডুপ্লিকেট চ্যাট বাটন তৈরি আটকাতে
  if (document.getElementById("chatWidgetFab")) return;

  // চ্যাট বাটন তৈরি
  const fab = document.createElement("button");
  fab.id = "chatWidgetFab";
  fab.className = "chat-fab";
  fab.innerHTML = `💬<span class="fab-badge" id="chatBadge" style="display:none">0</span>`;
  document.body.appendChild(fab);

  // চ্যাট প্যানেল তৈরি
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

  // চ্যাট ওপেন/ক্লোজ
  fab.onclick = () => {
    panel.classList.add("open");
    if (badge) badge.style.display = "none";
    if (chatId) markChatRead();
    checkAdminStatus();
    body.scrollTop = body.scrollHeight;
  };

  document.getElementById("chatCloseBtn").onclick = () => panel.classList.remove("open");

  // ইউজার লগইন চেক
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      chatId = user.uid;
      loadChatHistory();
      listenAdminStatus();
    }
  });

  // চ্যাট হিস্ট্রি লোড করা
  function loadChatHistory() {
    if (unsubMsgs) unsubMsgs();
    const msgsRef = collection(db, "chats", chatId, "messages");
    const q = query(msgsRef, orderBy("createdAt", "asc"));
    
    unsubMsgs = onSnapshot(q, (snap) => {
      recentMessages = [];
      if (snap.empty) {
        body.innerHTML = `<div class="chat-empty"><span class="em">👋</span>স্বাগতম! আমাদের এআই অ্যাসিস্ট্যান্ট আপনাকে সাহায্য করতে প্রস্তুত।</div>`;
        return;
      }
      
      body.innerHTML = snap.docs.map(d => {
        const m = d.data();
        const t = m.createdAt?.toDate?.();
        const time = t ? t.toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" }) : "";
        
        if (m.sender === "user") {
          recentMessages.push({ role: "user", text: m.text });
        } else if (m.sender === "admin") {
          recentMessages.push({ role: "model", text: m.text });
        }
        
        return `<div class="chat-msg ${m.sender}">
          ${escapeHtml(m.text)}
          ${m.isAI ? '<span style="font-size:9px;background:rgba(255,255,255,0.2);padding:1px 6px;border-radius:8px;margin-left:4px;">AI</span>' : ''}
          <span class="msg-time">${time}</span>
        </div>`;
      }).join("");
      
      recentMessages = recentMessages.slice(-6);
      body.scrollTop = body.scrollHeight;
    });
  }

  async function markChatRead() {
    if (!chatId || !currentUser) return;
    try {
      const chatRef = doc(db, "chats", chatId);
      const chatSnap = await getDoc(chatRef);
      if (chatSnap.exists() && chatSnap.data().unreadForUser > 0) {
        await updateDoc(chatRef, { unreadForUser: 0 });
      }
    } catch (e) {}
  }

  function listenAdminStatus() {
    const statusRef = doc(db, "settings", "online_status");
    onSnapshot(statusRef, (doc) => {
      const isOnline = doc.exists() ? doc.data().adminOnline : false;
      const dot = document.getElementById("chatOnlineDot");
      const txt = document.getElementById("chatOnlineText");
      if (isOnline) {
        dot.classList.remove("offline");
        txt.textContent = "Admin Online";
        txt.style.color = "#6ee7b7";
      } else {
        dot.classList.add("offline");
        txt.textContent = "AI Assistant Available";
        txt.style.color = "#cbd5e1";
      }
    });
  }

  async function checkAdminStatus() {
    try {
      const statusRef = doc(db, "settings", "online_status");
      const snap = await getDoc(statusRef);
      const isOnline = snap.exists() ? snap.data().adminOnline : false;
      const dot = document.getElementById("chatOnlineDot");
      const txt = document.getElementById("chatOnlineText");
      if (isOnline) {
        dot.classList.remove("offline");
        txt.textContent = "Admin Online";
        txt.style.color = "#6ee7b7";
      } else {
        dot.classList.add("offline");
        txt.textContent = "AI Assistant Available";
        txt.style.color = "#cbd5e1";
      }
    } catch (e) {}
  }

  // AI থেকে রিপ্লাই নেওয়া
  async function getAIReply(text) {
    try {
      const res = await fetch(VERCEL_AI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: recentMessages })
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data;
    } catch (e) {
      console.error("AI Fetch Error:", e);
      return null;
    }
  }

  // মেসেজ পাঠানোর মূল ফাংশন
  async function sendMessage() {
    const text = input.value.trim();
    if (!text || !currentUser) return;

    input.value = "";
    sendBtn.disabled = true;

    try {
      // ১. চ্যাট ডকুমেন্ট চেক ও তৈরি করা (এরর আসার সম্ভাবনা দূর করতে)
      const chatRef = doc(db, "chats", chatId);
      const chatSnap = await getDoc(chatRef);
      
      if (!chatSnap.exists()) {
        await setDoc(chatRef, {
          userId: currentUser.uid,
          username: currentUser.displayName || "User",
          userEmail: currentUser.email,
          lastMessage: text,
          lastMessageAt: serverTimestamp(),
          lastSender: "user",
          unreadForAdmin: 1,
          unreadForUser: 0
        });
      } else {
        await updateDoc(chatRef, {
          lastMessage: text,
          lastMessageAt: serverTimestamp(),
          lastSender: "user",
          unreadForAdmin: increment(1)
        });
      }

      // ২. ইউজারের মেসেজ সেভ করা
      await addDoc(collection(db, "chats", chatId, "messages"), {
        sender: "user",
        text: text,
        createdAt: serverTimestamp(),
        readByAdmin: false
      });

      // ৩. এআই থেকে উত্তর নেওয়া
      const aiData = await getAIReply(text);

      if (aiData && aiData.reply) {
        // ৪. এআই এর উত্তর সেভ করা
        await addDoc(collection(db, "chats", chatId, "messages"), {
          sender: "admin",
          senderName: "ADQ Support",
          text: aiData.reply,
          isAI: true,
          createdAt: serverTimestamp(),
          readByAdmin: true,
          readByUser: false
        });

        // ৫. চ্যাট সামারি আপডেট
        const updates = {
          lastMessage: aiData.reply,
          lastMessageAt: serverTimestamp(),
          lastSender: "admin",
          unreadForUser: increment(1)
        };
        
        if (aiData.needsHuman) {
          updates.unreadForAdmin = increment(1);
        }

        await updateDoc(chatRef, updates);
      }

    } catch (e) {
      console.error("Send error:", e);
      // যদি কোনো কারণে এরর হয়, তবে কনসোলে জানাবে
      alert("মেসেজ পাঠাতে সমস্যা হচ্ছে। ইন্টারনেট চেক করুন।");
    }
    sendBtn.disabled = false;
  }

  sendBtn.onclick = sendMessage;
  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
  });
}

// HTML এস্কেপ ফাংশন (XSS ঠেকাতে)
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
