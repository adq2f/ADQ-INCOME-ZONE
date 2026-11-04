/* ==================================================
   alerts.js — Premium High-Quality Alert System
   ================================================== */
(function () {
  if (window.__adqAlertsLoaded) return;
  window.__adqAlertsLoaded = true;

  function injectStyles() {
    if (document.getElementById("adq-alert-styles")) return;
    const style = document.createElement("style");
    style.id = "adq-alert-styles";
    style.textContent = `
      .adq-alert-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(3,3,12,.85);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;visibility:hidden;transition:all .3s;font-family:'Hind Siliguri','Inter',sans-serif}
      .adq-alert-overlay.show{opacity:1;visibility:visible}
      .adq-alert-box{width:100%;max-width:340px;background:linear-gradient(180deg,#1b1b38,#0e0e22);border:1px solid rgba(139,92,246,.35);border-radius:26px;padding:26px 22px;color:#f4f4ff;text-align:center;box-shadow:0 35px 90px -10px rgba(0,0,0,.95),0 0 0 1px rgba(139,92,246,.15),inset 0 1px 0 rgba(255,255,255,.1);transform:translateY(20px) scale(.92);transition:transform .4s cubic-bezier(.34,1.56,.64,1);position:relative;overflow:hidden}
      .adq-alert-box::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#6366f1,#a855f7,#22d3ee,#6366f1);background-size:200% 100%;animation:adqAlertGradient 3s linear infinite}
      @keyframes adqAlertGradient{0%{background-position:0% 50%}100%{background-position:200% 50%}}
      .adq-alert-overlay.show .adq-alert-box{transform:translateY(0) scale(1)}
      .adq-alert-icon{width:60px;height:60px;margin:0 auto 16px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 15px 35px -8px rgba(0,0,0,.4),inset 0 2px 0 rgba(255,255,255,.4);animation:adqAlertIconPop .6s cubic-bezier(.34,1.56,.64,1)}
      @keyframes adqAlertIconPop{0%{transform:scale(0) rotate(-90deg);opacity:0}100%{transform:scale(1) rotate(0);opacity:1}}
      .adq-alert-icon.success{background:linear-gradient(135deg,#34d399,#10b981 55%,#059669);box-shadow:0 15px 35px -8px rgba(16,185,129,.7),inset 0 2px 0 rgba(255,255,255,.4)}
      .adq-alert-icon.error{background:linear-gradient(135deg,#f87171,#ef4444 55%,#b91c1c);box-shadow:0 15px 35px -8px rgba(239,68,68,.7),inset 0 2px 0 rgba(255,255,255,.4)}
      .adq-alert-icon.warning{background:linear-gradient(135deg,#fcd34d,#f59e0b 55%,#d97706);box-shadow:0 15px 35px -8px rgba(245,158,11,.7),inset 0 2px 0 rgba(255,255,255,.4)}
      .adq-alert-icon.info{background:linear-gradient(135deg,#60a5fa,#3b82f6 55%,#1d4ed8);box-shadow:0 15px 35px -8px rgba(59,130,246,.7),inset 0 2px 0 rgba(255,255,255,.4)}
      .adq-alert-icon.question{background:linear-gradient(135deg,#c4b5fd,#8b5cf6 55%,#6d28d9);box-shadow:0 15px 35px -8px rgba(139,92,246,.7),inset 0 2px 0 rgba(255,255,255,.4)}
      .adq-alert-icon svg{width:28px;height:28px;fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 2px 4px rgba(0,0,0,.3))}
      .adq-alert-title{font-size:18px;font-weight:700;color:#fff;margin:0 0 6px;line-height:1.3}
      .adq-alert-msg{font-size:14px;line-height:1.65;color:#cfd0e6;margin:0 0 20px;white-space:pre-wrap;word-break:break-word}
      .adq-alert-input{width:100%;box-sizing:border-box;padding:13px 16px;border-radius:14px;border:1.5px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;font-family:inherit;font-size:15px;outline:none;margin:0 0 20px;transition:all .25s}
      .adq-alert-input:focus{border-color:rgba(139,92,246,.9);background:rgba(139,92,246,.1);box-shadow:0 0 0 4px rgba(139,92,246,.2)}
      .adq-alert-btns{display:flex;gap:10px}
      .adq-alert-btns button{flex:1;padding:14px;border-radius:14px;border:none;font-size:14.5px;font-weight:700;font-family:inherit;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center}
      .adq-alert-btn-primary{background:linear-gradient(135deg,#6366f1,#8b5cf6 55%,#a855f7);color:#fff;box-shadow:0 12px 24px -10px rgba(139,92,246,.9),inset 0 1px 0 rgba(255,255,255,.35)}
      .adq-alert-btn-primary:active{transform:scale(.96)}
      .adq-alert-btn-danger{background:linear-gradient(135deg,#ef4444,#b91c1c);color:#fff;box-shadow:0 12px 24px -10px rgba(239,68,68,.9),inset 0 1px 0 rgba(255,255,255,.25)}
      .adq-alert-btn-outline{background:rgba(255,255,255,.06);border:1.5px solid rgba(255,255,255,.15)!important;color:#cbd5e1}
      .adq-alert-btn-outline:active{transform:scale(.96)}
      .adq-toast-container{position:fixed;bottom:100px;left:50%;transform:translateX(-50%);z-index:2147483646;display:flex;flex-direction:column;gap:8px;pointer-events:none;align-items:center}
      .adq-toast{padding:12px 22px;border-radius:999px;font-family:'Hind Siliguri',sans-serif;font-size:13px;font-weight:700;color:#fff;white-space:nowrap;animation:adqToastIn .4s cubic-bezier(.34,1.56,.64,1),adqToastOut .4s ease 2.6s both;box-shadow:0 10px 30px -5px rgba(0,0,0,.5)}
      .adq-toast.success{background:linear-gradient(135deg,#10b981,#059669)}
      .adq-toast.error{background:linear-gradient(135deg,#ef4444,#b91c1c)}
      @keyframes adqToastIn{from{opacity:0;transform:translateY(20px) scale(.9)}to{opacity:1;transform:translateY(0) scale(1)}}
      @keyframes adqToastOut{to{opacity:0;transform:translateY(-10px) scale(.95)}}
    `;
    document.head.appendChild(style);
  }

  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  const ICONS = {
    success: `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`,
    error: `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    warning: `<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    question: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
  };

  function showBase(message, opts = {}) {
    return new Promise((resolve) => {
      injectStyles();
      const old = document.getElementById("adqAlertOverlay");
      if (old) old.remove();
      
      const overlay = document.createElement("div");
      overlay.id = "adqAlertOverlay";
      overlay.className = "adq-alert-overlay";
      
      const type = opts.type || "info";
      const title = opts.title || "";
      const isConfirm = !!opts.isConfirm;
      const isPrompt = !!opts.isPrompt;
      const defaultValue = opts.defaultValue || "";
      const okText = opts.okText || (isConfirm || isPrompt ? "হ্যাঁ" : "ঠিক আছে");
      const cancelText = opts.cancelText || "বাতিল";
      const okClass = opts.type === 'error' ? 'adq-alert-btn-danger' : 'adq-alert-btn-primary';

      overlay.innerHTML = `
        <div class="adq-alert-box">
          <div class="adq-alert-icon ${type}">${ICONS[type] || ICONS.info}</div>
          ${title ? `<h3 class="adq-alert-title">${esc(title)}</h3>` : ""}
          <div class="adq-alert-msg">${esc(message)}</div>
          ${isPrompt ? `<input type="text" class="adq-alert-input" id="adqAlertInput" value="${esc(defaultValue)}" autocomplete="off">` : ""}
          <div class="adq-alert-btns">
            ${isConfirm || isPrompt ? `<button class="adq-alert-btn-outline" id="adqAlertCancel">${esc(cancelText)}</button>` : ""}
            <button class="${okClass}" id="adqAlertOk">${esc(okText)}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add("show"));

      const close = (val) => {
        overlay.classList.remove("show");
        setTimeout(() => { overlay.remove(); resolve(val); }, 300);
      };

      const input = document.getElementById("adqAlertInput");
      document.getElementById("adqAlertOk").onclick = () => close(isPrompt ? (input ? input.value : "") : true);
      const cancelBtn = document.getElementById("adqAlertCancel");
      if (cancelBtn) cancelBtn.onclick = () => close(isPrompt ? null : false);
      
      overlay.addEventListener("click", (e) => { if (e.target === overlay && !isPrompt) close(isConfirm ? false : true); });
      if (input) {
        setTimeout(() => input.focus(), 200);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("adqAlertOk").click(); });
      }
    });
  }

  // Global Functions
  window.showCustomAlert = (msg, opts = {}) => showBase(msg, opts);
  window.showSuccess = (msg, opts = {}) => showBase(msg, { ...opts, type: "success", title: opts.title || "সফল!" });
  window.showError = (msg, opts = {}) => showBase(msg, { ...opts, type: "error", title: opts.title || "সমস্যা!" });
  window.showWarning = (msg, opts = {}) => showBase(msg, { ...opts, type: "warning", title: opts.title || "সতর্কতা!" });
  window.showInfo = (msg, opts = {}) => showBase(msg, { ...opts, type: "info", title: opts.title || "তথ্য" });
  window.showCustomConfirm = (msg, opts = {}) => showBase(msg, { ...opts, type: "question", isConfirm: true, title: opts.title || "নিশ্চিত করুন" });
  window.showCustomPrompt = (msg, defaultValue = "", placeholder = "", opts = {}) => showBase(msg, { ...opts, type: "question", isPrompt: true, defaultValue, title: opts.title || "ইনপুট দিন" });

  window.showToast = function (msg, type = "success") {
    injectStyles();
    let c = document.getElementById("adqToastContainer");
    if (!c) { c = document.createElement("div"); c.id = "adqToastContainer"; c.className = "adq-toast-container"; document.body.appendChild(c); }
    const t = document.createElement("div"); t.className = `adq-toast ${type}`; t.textContent = msg;
    c.appendChild(t); setTimeout(() => t.remove(), 3200);
  };

  // Auto Override native alert
  window.alert = function (msg) {
    if (!document.body) return;
    window.showCustomAlert(String(msg ?? ""));
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectStyles);
  else injectStyles();
})();
