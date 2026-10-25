import { auth, db } from "./firebase.js";
import { onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc, getDoc, setDoc, collection, query, orderBy, onSnapshot,
  updateDoc, increment, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ==================================================
// ⚙️ সেটিংস
// ==================================================
const API_BASE = (location.hostname.endsWith("vercel.app") || location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? ""
  : "https://adq-income-zone.vercel.app";
const AI_URL = API_BASE + "/api/ai-support";
const WITHDRAW_URL = API_BASE + "/api/withdraw";

const AI_WHEN_ADMIN_ONLINE = true;

const METHOD_LABEL = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", binance: "Binance" };

let currentUser = null;
let userName = "User";
let chatId = null;
let unsubMsgs = null;
let recentMessages = [];

function newRequestId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

// ==================================================
// 🎨 প্রিমিয়াম স্টাইল (Glassmorphism + Neon Glow + Smooth Animations)
// ==================================================
function injectChatStyles() {
  if (document.getElementById("adq-chat-styles")) return;
  const s = document.createElement("style");
  s.id = "adq-chat-styles";
  s.textContent = `
    /* ===== FAB Button ===== */
    body .chat-fab {
      position: fixed;
      bottom: calc(98px + env(safe-area-inset-bottom, 0px));
      right: 16px;
      width: 62px; height: 62px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1, #8b5cf6 55%, #a855f7);
      background-size: 200% 200%;
      border: 1.5px solid rgba(255,255,255,.35);
      color: white; font-size: 26px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      box-shadow: 0 20px 45px -10px rgba(139,92,246,.85), inset 0 1px 0 rgba(255,255,255,.4);
      z-index: 9998;
      transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.3s;
      animation: fabFloat 4s ease-in-out infinite, fabGradient 6s ease infinite;
    }
    @keyframes fabFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @keyframes fabGradient { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
    body .chat-fab:hover { transform: scale(1.1) rotate(-8deg); box-shadow: 0 24px 55px -10px rgba(139,92,246,1); }
    body .chat-fab:active { transform: scale(.95); }
    body .chat-fab .fab-badge {
      position: absolute; top: -4px; right: -4px;
      min-width: 22px; height: 22px;
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: #fff; border-radius: 11px;
      font-size: 11px; font-weight: 800;
      display: flex; align-items: center; justify-content: center;
      padding: 0 6px;
      border: 2.5px solid #06060f;
      box-shadow: 0 4px 12px rgba(239,68,68,.7);
      animation: badgePop .5s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes badgePop { 0% { transform: scale(0); } 100% { transform: scale(1); } }
    body .fab-online {
      position: absolute; bottom: 4px; right: 4px;
      width: 15px; height: 15px;
      border-radius: 50%; background: #10b981;
      border: 2.5px solid #06060f;
      box-shadow: 0 0 0 0 rgba(16,185,129,.7);
      animation: onlinePulse 2s infinite;
    }
    @keyframes onlinePulse {
      0% { box-shadow: 0 0 0 0 rgba(16,185,129,.7); }
      70% { box-shadow: 0 0 0 12px rgba(16,185,129,0); }
      100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); }
    }

    /* ===== Online Pill ===== */
    body .fab-pill {
      position: fixed;
      z-index: 9997;
      bottom: calc(116px + env(safe-area-inset-bottom,0px));
      right: 88px;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 15px; border-radius: 999px;
      font-size: 12px; font-weight: 700; color: #a7f3d0;
      background: rgba(18,18,40,.9);
      border: 1px solid rgba(16,185,129,.5);
      backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      box-shadow: 0 12px 30px -10px rgba(16,185,129,.7);
      white-space: nowrap;
      animation: pillSlide .5s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes pillSlide { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }

    /* ===== Chat Panel ===== */
    body .chat-panel {
      position: fixed;
      bottom: 0; right: 0;
      width: 100%; max-width: 440px;
      height: 88vh; height: 88dvh;
      background: linear-gradient(180deg, #13132b 0%, #0a0a1a 100%);
      border: 1px solid rgba(255,255,255,.12);
      border-bottom: none;
      border-radius: 30px 30px 0 0;
      box-shadow: 0 -30px 90px -10px rgba(0,0,0,.9), 0 0 0 1px rgba(139,92,246,.15);
      color: #f4f4ff;
      font-family: 'Hind Siliguri', 'Inter', sans-serif;
      display: flex; flex-direction: column;
      z-index: 9999;
      transform: translateY(100%);
      transition: transform 0.45s cubic-bezier(0.34,1.56,0.64,1);
      overflow: hidden;
    }
    body .chat-panel.open { transform: translateY(0); }
    body .chat-panel::before {
      content: '';
      position: absolute; top: 0; left: 0; right: 0; height: 3px;
      background: linear-gradient(90deg, #6366f1, #a855f7, #22d3ee, #6366f1);
      background-size: 300% 100%;
      animation: gradientShift 3s linear infinite;
    }
    @keyframes gradientShift { 0% { background-position: 0% 50%; } 100% { background-position: 300% 50%; } }

    /* ===== Chat Header ===== */
    body .chat-panel-head {
      position: relative;
      background: linear-gradient(135deg, #4338ca 0%, #7c3aed 55%, #c026d3 100%);
      border-radius: 30px 30px 0 0;
      padding: 18px 16px;
      display: flex; align-items: center; gap: 12px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.3), 0 8px 24px -8px rgba(0,0,0,.5);
      overflow: hidden;
    }
    body .chat-panel-head::before {
      content: '';
      position: absolute; top: -40px; right: -30px;
      width: 150px; height: 150px;
      background: radial-gradient(circle, rgba(255,255,255,.25), transparent 70%);
      border-radius: 50%;
      animation: headerGlow 4s ease-in-out infinite;
    }
    @keyframes headerGlow { 0%,100% { transform: scale(1); opacity: .8; } 50% { transform: scale(1.15); opacity: 1; } }
    body .chat-admin-avatar {
      width: 46px; height: 46px;
      border-radius: 50%;
      background: linear-gradient(135deg, #fbbf24, #f59e0b);
      display: flex; align-items: center; justify-content: center;
      font-size: 22px;
      flex-shrink: 0;
      position: relative;
      box-shadow: 0 10px 24px -6px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.5);
      z-index: 1;
    }
    body .chat-online-dot {
      position: absolute; bottom: 0; right: 0;
      width: 13px; height: 13px;
      border-radius: 50%; background: #10b981;
      border: 2.5px solid #4338ca;
      box-shadow: 0 0 0 0 rgba(16,185,129,.7);
      animation: onlinePulse 2s infinite;
    }
    body .chat-online-dot.offline { background: #94a3b8; animation: none; }
    body .chat-panel-info { flex: 1; min-width: 0; position: relative; z-index: 1; }
    body .chat-panel-info h4 {
      font-size: 16px; font-weight: 700; margin: 0 0 2px; color: #fff;
      display: flex; align-items: center; gap: 6px;
      text-shadow: 0 2px 6px rgba(0,0,0,.25);
    }
    body .chat-panel-info p { font-size: 12px; color: rgba(255,255,255,.85); margin: 0; font-weight: 500; }
    body .chat-close {
      width: 38px; height: 38px;
      border-radius: 50%;
      background: rgba(255,255,255,.18);
      border: 1px solid rgba(255,255,255,.2);
      color: white; font-size: 18px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.25s;
      position: relative; z-index: 1;
      backdrop-filter: blur(6px);
    }
    body .chat-close:hover { background: rgba(255,255,255,.35); transform: rotate(90deg) scale(1.1); }

    /* ===== Chat Body ===== */
    body .chat-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px 16px;
      display: flex; flex-direction: column;
      gap: 12px;
      scroll-behavior: smooth;
      background: radial-gradient(circle at 50% 0%, rgba(139,92,246,.08), transparent 60%);
    }
    body .chat-body::-webkit-scrollbar { width: 4px; }
    body .chat-body::-webkit-scrollbar-thumb { background: rgba(139,92,246,.4); border-radius: 4px; }

    /* ===== Message Bubbles ===== */
    body .chat-msg {
      max-width: 82%;
      padding: 11px 15px;
      border-radius: 20px;
      font-size: 14.5px;
      line-height: 1.55;
      word-wrap: break-word;
      animation: msgSlideIn 0.45s cubic-bezier(0.34,1.56,0.64,1) both;
      position: relative;
      box-shadow: 0 6px 20px -8px rgba(0,0,0,.4);
    }
    @keyframes msgSlideIn {
      from { opacity: 0; transform: translateY(12px) scale(.92); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    body .chat-msg.user {
      align-self: flex-end;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      border-bottom-right-radius: 6px;
      box-shadow: 0 12px 28px -10px rgba(139,92,246,.95), inset 0 1px 0 rgba(255,255,255,.25);
    }
    body .chat-msg.admin {
      align-self: flex-start;
      background: rgba(255,255,255,.08);
      color: #f4f4ff;
      border: 1px solid rgba(255,255,255,.12);
      border-bottom-left-radius: 6px;
      backdrop-filter: blur(8px);
      box-shadow: 0 8px 22px -12px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.08);
    }
    body .chat-msg .msg-time {
      display: block;
      font-size: 10px;
      opacity: 0.6;
      margin-top: 5px;
      font-weight: 500;
    }
    body .ai-tag {
      font-size: 9px;
      font-weight: 800;
      background: rgba(255,255,255,.2);
      padding: 2px 7px;
      border-radius: 8px;
      margin-left: 6px;
      vertical-align: 1px;
      letter-spacing: .5px;
    }

    /* ===== Typing Indicator ===== */
    body .chat-typing {
      display: inline-flex; gap: 5px; align-items: center;
      padding: 4px 2px;
    }
    body .chat-typing i {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: linear-gradient(135deg, #a5b4fc, #c4b5fd);
      animation: typingDot 1.3s infinite ease-in-out;
    }
    body .chat-typing i:nth-child(2) { animation-delay: .18s; }
    body .chat-typing i:nth-child(3) { animation-delay: .36s; }
    @keyframes typingDot {
      0%, 80%, 100% { transform: scale(.6); opacity: .4; }
      40% { transform: scale(1.1); opacity: 1; }
    }

    /* ===== Input Bar ===== */
    body .chat-input-bar {
      padding: 14px;
      background: rgba(10,10,26,.95);
      border-top: 1px solid rgba(255,255,255,.1);
      display: flex; gap: 10px; align-items: center;
      padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px));
      backdrop-filter: blur(20px);
    }
    body .chat-input-bar input {
      flex: 1;
      padding: 13px 18px;
      border: 1.5px solid rgba(255,255,255,.14);
      border-radius: 999px;
      font-size: 14.5px;
      font-family: inherit;
      outline: none; margin: 0;
      transition: all 0.25s;
      background: rgba(255,255,255,.06);
      color: #fff;
    }
    body .chat-input-bar input::placeholder { color: #6f7090; }
    body .chat-input-bar input:focus {
      border-color: rgba(139,92,246,.9);
      background: rgba(139,92,246,.12);
      box-shadow: 0 0 0 4px rgba(139,92,246,.2), 0 8px 24px -10px rgba(139,92,246,.6);
    }
    body .chat-send {
      width: 48px; height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white; border: none; cursor: pointer;
      font-size: 19px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 12px 26px -8px rgba(139,92,246,.95), inset 0 1px 0 rgba(255,255,255,.3);
      transition: all 0.25s cubic-bezier(0.34,1.56,0.64,1);
      flex-shrink: 0;
    }
    body .chat-send:hover { transform: scale(1.08) rotate(-8deg); }
    body .chat-send:active { transform: scale(.92); }
    body .chat-send:disabled { background: rgba(255,255,255,.12); box-shadow: none; cursor: not-allowed; transform: none; }

    /* ===== Empty State ===== */
    body .chat-empty {
      text-align: center;
      color: #9a9bb8;
      padding: 50px 20px;
      font-size: 13.5px;
      line-height: 1.7;
      font-weight: 500;
    }
    body .chat-empty .em {
      font-size: 56px;
      display: block;
      margin-bottom: 14px;
      animation: fabFloat 3s ease-in-out infinite;
    }

    /* ===== Secure Withdraw Modal ===== */
    .adq-wd-overlay {
      position: fixed; inset: 0; z-index: 10050;
      display: none;
      align-items: center; justify-content: center;
      padding: 20px;
      background: rgba(3,3,12,.82);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      font-family: 'Hind Siliguri', 'Inter', sans-serif;
    }
    .adq-wd-overlay.show { display: flex; animation: fadeIn .3s ease; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .adq-wd-card {
      width: 100%; max-width: 380px;
      background: linear-gradient(160deg, #1b1b38, #0e0e22);
      border: 1px solid rgba(139,92,246,.35);
      border-radius: 26px;
      padding: 24px 22px 20px;
      color: #f4f4ff;
      box-shadow: 0 35px 90px -10px rgba(0,0,0,.95), 0 0 0 1px rgba(139,92,246,.15), inset 0 1px 0 rgba(255,255,255,.1);
      animation: modalPop .45s cubic-bezier(0.34,1.56,0.64,1) both;
      position: relative;
      overflow: hidden;
    }
    .adq-wd-card::before {
      content: '';
      position: absolute; top: 0; left: 0; right: 0; height: 3px;
      background: linear-gradient(90deg, #6366f1, #a855f7, #22d3ee);
    }
    @keyframes modalPop {
      from { opacity: 0; transform: translateY(30px) scale(.9); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .adq-wd-card h3 { margin: 0 0 6px; font-size: 18px; font-weight: 700; }
    .adq-wd-card .sub { margin: 0 0 16px; font-size: 12.5px; color: #a7f3d0; font-weight: 600; }
    .adq-wd-rows {
      background: rgba(255,255,255,.04);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 16px;
      padding: 4px 16px;
      margin-bottom: 16px;
    }
    .adq-wd-row {
      display: flex; justify-content: space-between; gap: 10px;
      padding: 11px 0;
      font-size: 13.5px;
      border-bottom: 1px dashed rgba(255,255,255,.1);
    }
    .adq-wd-row:last-child { border-bottom: none; }
    .adq-wd-row span:first-child { color: #9a9bb8; font-weight: 600; }
    .adq-wd-row b { color: #fff; word-break: break-all; text-align: right; font-family: 'Inter'; }
    .adq-wd-pw { position: relative; margin-bottom: 10px; }
    .adq-wd-pw input {
      width: 100%; box-sizing: border-box;
      padding: 13px 46px 13px 15px;
      border-radius: 14px;
      border: 1.5px solid rgba(255,255,255,.15);
      background: rgba(255,255,255,.06);
      color: #fff; font-size: 14px; font-family: inherit;
      outline: none; margin: 0;
      transition: all 0.2s;
    }
    .adq-wd-pw input:focus {
      border-color: rgba(139,92,246,.9);
      background: rgba(139,92,246,.1);
      box-shadow: 0 0 0 4px rgba(139,92,246,.18);
    }
    .adq-wd-eye {
      position: absolute; right: 6px; top: 50%;
      transform: translateY(-50%);
      background: none; border: none; color: #cbd5e1;
      font-size: 17px; cursor: pointer; padding: 8px 10px;
      border-radius: 10px; transition: all 0.2s;
    }
    .adq-wd-eye:hover { background: rgba(255,255,255,.1); color: #fff; }
    .adq-wd-err { min-height: 18px; margin: 0 0 12px; font-size: 12.5px; color: #fca5a5; font-weight: 600; }
    .adq-wd-btns { display: flex; gap: 10px; }
    .adq-wd-btns button {
      flex: 1; padding: 14px;
      border-radius: 14px; border: none;
      font-size: 14.5px; font-weight: 700;
      font-family: inherit; cursor: pointer;
      transition: all 0.25s;
    }
    .adq-wd-cancel { background: rgba(255,255,255,.08); color: #e5e7eb; border: 1px solid rgba(255,255,255,.12) !important; }
    .adq-wd-cancel:hover { background: rgba(255,255,255,.15); }
    .adq-wd-ok {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      box-shadow: 0 14px 30px -10px rgba(139,92,246,.95), inset 0 1px 0 rgba(255,255,255,.3);
    }
    .adq-wd-ok:hover:not(:disabled) { transform: translateY(-2px); }
    .adq-wd-btns button:disabled { opacity: .55; cursor: not-allowed; }

    @media (max-width: 480px) {
      body .chat-panel { max-width: 100%; }
      body .fab-pill { display: none !important; }
    }
  `;
  document.head.appendChild(s);
}

// ==================================================
// 🚀 Main Widget Init
// ==================================================
export function initChatWidget() {
  if (document.getElementById("chatWidgetFab")) return;
  injectChatStyles();

  const pill = document.createElement("span");
  pill.className = "fab-pill";
  pill.id = "fabPill";
  pill.style.display = "none";
  pill.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#10b981;box-shadow:0 0 8px #10b981;display:inline-block;"></span> Admin Online`;
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
        🎧
        <span class="chat-online-dot" id="chatOnlineDot"></span>
      </div>
      <div class="chat-panel-info">
        <h4>ADQ Support <span id="adminBadge" style="display:none;font-size:9px;background:rgba(16,185,129,.3);padding:2px 8px;border-radius:6px;font-weight:800;">LIVE</span></h4>
        <p id="chatOnlineText">Connecting...</p>
      </div>
      <button class="chat-close" id="chatCloseBtn" aria-label="Close">✕</button>
    </div>
    <div class="chat-body" id="chatBody">
      <div class="chat-empty"><span class="em">👋</span>স্বাগতম! আমাদের স্মার্ট এআই অ্যাসিস্ট্যান্ট আপনাকে সাহায্য করতে প্রস্তুত।</div>
    </div>
    <div class="chat-input-bar">
      <input type="text" id="chatInput" placeholder="আপনার প্রশ্ন লিখুন..." maxlength="500" autocomplete="off">
      <button class="chat-send" id="chatSendBtn" aria-label="Send">➤</button>
    </div>
  `;
  document.body.appendChild(panel);

  const overlay = document.createElement("div");
  overlay.className = "adq-wd-overlay";
  overlay.id = "adqWdOverlay";
  overlay.innerHTML = `
    <div class="adq-wd-card" role="dialog" aria-modal="true" aria-labelledby="adqWdTitle">
      <h3 id="adqWdTitle">🔒 উইথড্র নিশ্চিত করুন</h3>
      <p class="sub">✓ পাসওয়ার্ড চ্যাটে সেভ হয় না, সরাসরি নিরাপদ সার্ভারে যায়।</p>
      <div class="adq-wd-rows">
        <div class="adq-wd-row"><span>টাকা</span><b id="adqWdAmount"></b></div>
        <div class="adq-wd-row"><span>মেথড</span><b id="adqWdMethod"></b></div>
        <div class="adq-wd-row"><span>নম্বর</span><b id="adqWdAccount"></b></div>
      </div>
      <div class="adq-wd-pw">
        <input type="password" id="adqWdPass" placeholder="আপনার অ্যাকাউন্টের পাসওয়ার্ড" autocomplete="current-password">
        <button type="button" class="adq-wd-eye" id="adqWdEye" aria-label="Show password">👁</button>
      </div>
      <p class="adq-wd-err" id="adqWdErr"></p>
      <div class="adq-wd-btns">
        <button type="button" class="adq-wd-cancel" id="adqWdCancel">বাতিল</button>
        <button type="button" class="adq-wd-ok" id="adqWdOk">নিশ্চিত করুন</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const body = document.getElementById("chatBody");
  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("chatSendBtn");
  const badge = document.getElementById("chatBadge");
  const adminBadge = document.getElementById("adminBadge");

  const wdAmount = document.getElementById("adqWdAmount");
  const wdMethod = document.getElementById("adqWdMethod");
  const wdAccount = document.getElementById("adqWdAccount");
  const wdPass = document.getElementById("adqWdPass");
  const wdErr = document.getElementById("adqWdErr");
  const wdOk = document.getElementById("adqWdOk");
  const wdCancel = document.getElementById("adqWdCancel");
  const wdEye = document.getElementById("adqWdEye");

  let adminOnline = false;
  let waitingAI = false;
  let sending = false;
  let lastDocs = [];
  let pendingWithdraw = null;
  let withdrawing = false;

  const EMPTY_HTML = `<div class="chat-empty"><span class="em">👋</span>স্বাগতম! আমাদের স্মার্ট এআই অ্যাসিস্ট্যান্ট আপনাকে সাহায্য করতে প্রস্তুত।</div>`;

  function openWithdrawModal(action) {
    pendingWithdraw = {
      amount: Number(action.amount),
      method: String(action.method || ""),
      account: String(action.account || ""),
      requestId: newRequestId()
    };
    wdAmount.textContent = "৳" + pendingWithdraw.amount;
    wdMethod.textContent = METHOD_LABEL[pendingWithdraw.method] || pendingWithdraw.method;
    wdAccount.textContent = pendingWithdraw.account;
    wdPass.value = "";
    wdPass.type = "password";
    wdErr.textContent = "";
    wdOk.disabled = false;
    wdCancel.disabled = false;
    overlay.classList.add("show");
    setTimeout(() => wdPass.focus(), 150);
  }

  function closeWithdrawModal() {
    wdPass.value = "";
    wdPass.type = "password";
    wdErr.textContent = "";
    pendingWithdraw = null;
    withdrawing = false;
    overlay.classList.remove("show");
  }

  wdEye.onclick = () => { wdPass.type = wdPass.type === "password" ? "text" : "password"; };
  wdCancel.onclick = () => { if (!withdrawing) closeWithdrawModal(); };

  async function confirmWithdraw() {
    if (withdrawing || !pendingWithdraw || !currentUser) return;
    const password = wdPass.value;
    if (!password) { wdErr.textContent = "পাসওয়ার্ড দিন।"; return; }

    withdrawing = true;
    wdOk.disabled = true;
    wdCancel.disabled = true;
    wdErr.textContent = "";
    wdOk.textContent = "অপেক্ষা করুন...";

    try {
      const token = await currentUser.getIdToken(true);
      const res = await fetch(WITHDRAW_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({
          amount: pendingWithdraw.amount,
          method: pendingWithdraw.method,
          account: pendingWithdraw.account,
          requestId: pendingWithdraw.requestId,
          password
        })
      });
      let data = null;
      try { data = await res.json(); } catch (e) {}

      if (data?.ok) {
        const reply = data.reply || "✅ উইথড্র রিকোয়েস্ট জমা হয়েছে।";
        closeWithdrawModal();
        await postAIMessage(reply);
      } else {
        wdErr.textContent = data?.reply || "❌ কাজটি সম্পন্ন হয়নি। আবার চেষ্টা করুন।";
        wdPass.value = "";
        wdPass.focus();
        if (res.status === 429) {
          const msg = data?.reply || "🔒 কিছুক্ষণ পর আবার চেষ্টা করুন।";
          closeWithdrawModal();
          await postAIMessage(msg);
        }
      }
    } catch (e) {
      console.error("withdraw error:", e);
      wdErr.textContent = "⚠️ নেটওয়ার্ক সমস্যা। ইন্টারনেট চেক করে আবার চেষ্টা করুন।";
    } finally {
      withdrawing = false;
      wdOk.disabled = false;
      wdCancel.disabled = false;
      wdOk.textContent = "নিশ্চিত করুন";
    }
  }

  wdOk.onclick = confirmWithdraw;
  wdPass.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); confirmWithdraw(); }
  });

  function paintOnline(isOnline) {
    adminOnline = !!isOnline;
    const dot = document.getElementById("chatOnlineDot");
    const txt = document.getElementById("chatOnlineText");
    const fo = document.getElementById("fabOnline");
    const fp = document.getElementById("fabPill");
    
    if (adminOnline) {
      dot.classList.remove("offline");
      txt.textContent = "Admin Online — Quick Reply";
      txt.style.color = "#6ee7b7";
      adminBadge.style.display = "inline-block";
    } else {
      dot.classList.add("offline");
      txt.textContent = "AI Assistant Available 24/7";
      txt.style.color = "#cbd5e1";
      adminBadge.style.display = "none";
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
    setTimeout(() => input.focus(), 400);
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
      const token = await currentUser.getIdToken(true);
      const res = await fetch(AI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ message: text, history: buildHistory(text) })
      });

      let data = null;
      try { data = await res.json(); } catch (e) {}

      if (!res.ok || !data || data.error) {
        console.error("🔥 AI API ERROR:", res.status, data);
        return { reply: `⚠️ সিস্টেম এরর: ${data?.error || data?.reply || res.status}` };
      }
      return data;
    } catch (e) {
      console.error("🔥 AI FETCH ERROR:", e);
      return { reply: "⚠️ নেটওয়ার্ক সমস্যা হচ্ছে। ইন্টারনেট চেক করুন।" };
    }
  }

  async function postAIMessage(text, needsHuman = false) {
    if (!chatId || !text) return;
    try {
      await addDoc(collection(db, "chats", chatId, "messages"), {
        sender: "admin",
        senderName: "ADQ Support",
        text,
        isAI: true,
        createdAt: serverTimestamp(),
        readByAdmin: true,
        readByUser: true
      });
      const updates = {
        lastMessage: text,
        lastMessageAt: serverTimestamp(),
        lastSender: "admin",
        unreadForUser: panel.classList.contains("open") ? 0 : increment(1)
      };
      if (needsHuman) updates.unreadForAdmin = increment(1);
      await updateDoc(doc(db, "chats", chatId), updates);
    } catch (e) { console.error("postAIMessage:", e); }
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
      await postAIMessage(aiData.reply, !!aiData.needsHuman);
    }

    // 🔒 উইথড্র কনফার্ম ফর্ম
    if (aiData?.action?.type === "withdraw_confirm") {
      openWithdrawModal(aiData.action);
    }

    // 🔑 পাসওয়ার্ড রিসেট
    if (aiData?.action?.type === "password_reset") {
      try {
        await sendPasswordResetEmail(auth, currentUser.email);
      } catch (e) {
        console.error("Password reset from chat error:", e);
      }
    }

    sending = false;
    sendBtn.disabled = false;
    if (panel.classList.contains("open") && !overlay.classList.contains("show")) input.focus();
  }

  sendBtn.onclick = sendMessage;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); sendMessage(); }
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
