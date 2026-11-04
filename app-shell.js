/* ==================================================
   app-shell.js — ADQ Income Zone (Global Layout & Fixes)
   ================================================== */
(function () {
  if (window.__adqShell) return;
  window.__adqShell = true;

  var root = document.documentElement;
  var file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  var noDock = /^(login|signup|reset-|admin|index)/.test(file);
  var firstVisit = true;
  try { firstVisit = !sessionStorage.getItem("adq_seen"); sessionStorage.setItem("adq_seen", "1"); } catch (e) {}

  root.classList.add("adq-loading");

  /* ---------------- ICONS ---------------- */
  var P = {
    Facebook: { color: "#1877F2", svg: '<svg viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>' },
    Twitter: { color: "#1DA1F2", svg: '<svg viewBox="0 0 24 24" fill="white"><path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z"/></svg>' },
    Instagram: { color: "linear-gradient(45deg,#F58529,#DD2A7B,#8134AF)", svg: '<svg viewBox="0 0 24 24" fill="white"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>' },
    LinkedIn: { color: "#0A66C2", svg: '<svg viewBox="0 0 24 24" fill="white"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>' },
    TikTok: { color: "#000", svg: '<svg viewBox="0 0 24 24" fill="white"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>' },
    Gmail: { color: "#EA4335", svg: '<svg viewBox="0 0 24 24" fill="white"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/></svg>' },
    WhatsApp: { color: "#25D366", svg: '<svg viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>' },
    Other: { color: "linear-gradient(135deg,#64748b,#475569)", svg: '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' }
  };

  function ic(inner) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>'; }
  
  var S = {
    search: ic('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
    bell: ic('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
    logout: ic('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
    chev: ic('<polyline points="9 18 15 12 9 6"/>'),
    check: ic('<polyline points="20 6 9 17 4 12"/>'),
    close: ic('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    clock: ic('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
    gift: ic('<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>'),
    bolt: ic('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
    wallet: ic('<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>'),
    layers: ic('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'),
    download: ic('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
    inbox: ic('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
    activity: ic('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),
    shield: ic('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
    copy: ic('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    edit: ic('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
    phone: ic('<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>'),
    user: ic('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    eye: ic('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: ic('<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'),
    home: ic('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>')
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtMs(ms) {
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d > 0) return d + "d " + (h % 24) + "h";
    if (h > 0) return h + "h " + (m % 60) + "m";
    return Math.max(1, m) + "m";
  }
  function tstatus(t) {
    var now = new Date();
    var s = t.startTime && t.startTime.toDate ? t.startTime.toDate() : null;
    var e = t.endTime && t.endTime.toDate ? t.endTime.toDate() : null;
    if (s && now < s) return { k: "upcoming", text: "শুরু " + fmtMs(s - now) };
    if (e && now > e) return { k: "closed", text: "শেষ" };
    return { k: "open", text: e ? fmtMs(e - now) + " বাকি" : "Open" };
  }
  function logo(platform, cls) {
    var p = P[platform] || P.Other;
    return '<div class="' + (cls || "x-logo") + '" style="background:' + p.color + '">' + p.svg + "</div>";
  }
  function taskRow(t) {
    var st = tstatus(t);
    var fields = (t.fields || []).length;
    var refer = Number(t.referCommission) > 0
      ? '<span class="x-tag gold">' + S.gift + "৳" + esc(t.referCommission) + "</span>" : "";
    return '<a class="x-row" href="task.html?id=' + esc(t.id) + '">' +
      logo(t.platform) +
      '<div class="x-rb"><div class="x-rt">' + esc(t.title) + "</div>" +
      '<div class="x-rs"><span class="x-price">৳' + esc(t.pricePerAccount) + "</span>" +
      '<span class="x-tag ' + st.k + '"><i></i>' + esc(st.text) + "</span>" +
      '<span class="x-tag">' + S.layers + fields + "</span>" + refer + "</div></div>" +
      '<span class="x-go">' + S.chev + "</span></a>";
  }

  /* ---------------- CUSTOM PREMIUM ALERT ---------------- */
  window.showCustomAlert = function(message) {
    return new Promise((resolve) => {
      const oldAlert = document.getElementById("adqCustomAlert");
      if (oldAlert) oldAlert.remove();

      const overlay = document.createElement("div");
      overlay.id = "adqCustomAlert";
      overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(3, 3, 10, 0.75); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
        opacity: 0; visibility: hidden; transition: all 0.3s ease;
        font-family: 'Hind Siliguri', sans-serif; padding: 20px;
      `;

      const box = document.createElement("div");
      box.style.cssText = `
        background: linear-gradient(180deg, #17172f, #0d0d1f);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 24px; padding: 24px; width: 100%; max-width: 320px;
        text-align: center; transform: scale(0.9); transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.1);
      `;

      box.innerHTML = `
        <div style="width: 54px; height: 54px; margin: 0 auto 16px; border-radius: 50%; background: linear-gradient(135deg, #10b981, #0d9488); display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 25px -5px rgba(16,185,129,0.5), inset 0 2px 0 rgba(255,255,255,0.3);">
          <svg viewBox="0 0 24 24" style="width: 28px; height: 28px; fill: none; stroke: #fff; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round;"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div style="color: #e7e5f4; font-size: 15px; line-height: 1.6; margin-bottom: 24px; white-space: pre-wrap; font-weight: 500;">${message}</div>
        <button id="adqAlertOkBtn" style="width: 100%; padding: 14px; border-radius: 14px; border: none; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; font-size: 16px; font-weight: 700; cursor: pointer; box-shadow: 0 10px 25px -5px rgba(139,92,246,0.5), inset 0 1px 0 rgba(255,255,255,0.3); transition: transform 0.2s;">
          ঠিক আছে (OK)
        </button>
      `;

      overlay.appendChild(box);
      document.body.appendChild(overlay);

      setTimeout(() => {
        overlay.style.opacity = "1";
        overlay.style.visibility = "visible";
        box.style.transform = "scale(1)";
      }, 10);

      const closeAlert = () => {
        overlay.style.opacity = "0";
        overlay.style.visibility = "hidden";
        box.style.transform = "scale(0.9)";
        setTimeout(() => { overlay.remove(); resolve(); }, 300);
      };

      const btn = document.getElementById("adqAlertOkBtn");
      btn.onclick = closeAlert;
      btn.onmouseenter = () => btn.style.transform = "translateY(-2px)";
      btn.onmouseleave = () => btn.style.transform = "translateY(0)";
    });
  };

  // ✅ ওভাররাইড ডিফল্ট alert() ফাংশন
  window.alert = function(msg) {
    window.showCustomAlert(msg);
  };

  window.ADQ = { platforms: P, svg: S, esc: esc, tstatus: tstatus, logo: logo, taskRow: taskRow, fmtMs: fmtMs, showAlert: window.showCustomAlert };

  /* ---------------- CSS ---------------- */
  var css = [
    "html.adq-loading body{visibility:hidden}",
    "#adqSplash{position:fixed;inset:0;z-index:2147483000;background:#06060f;display:flex;align-items:center;justify-content:center;transition:opacity .45s ease,visibility .45s}",
    "#adqSplash::before{content:'';position:absolute;inset:0;background:radial-gradient(520px 380px at 12% 8%,rgba(99,102,241,.5),transparent 60%),radial-gradient(480px 380px at 90% 92%,rgba(168,85,247,.45),transparent 60%),radial-gradient(300px 240px at 80% 18%,rgba(34,211,238,.2),transparent 60%)}",
    "#adqSplash.out{opacity:0;visibility:hidden;pointer-events:none}",
    "#adqSplash .sp-in{position:relative;text-align:center;font-family:'Hind Siliguri','Inter',system-ui,sans-serif;color:#f4f4ff}",
    "#adqSplash .sp-logo{width:76px;height:76px;margin:0 auto 16px;border-radius:24px;display:flex;align-items:center;justify-content:center;font:900 34px 'Inter',sans-serif;color:#fff;background:linear-gradient(135deg,#6366f1,#8b5cf6 55%,#22d3ee);box-shadow:0 18px 44px -8px rgba(139,92,246,.85),inset 0 2px 0 rgba(255,255,255,.35);animation:spPulse 1.6s ease-in-out infinite;position:relative}",
    "#adqSplash .sp-logo::after{content:'';position:absolute;inset:-7px;border-radius:29px;border:1px solid rgba(139,92,246,.4)}",
    "#adqSplash .sp-name{font-size:18px;font-weight:700;letter-spacing:-.2px}",
    "#adqSplash .sp-sub{margin-top:3px;font-size:12px;color:#9a9bb8;font-weight:500}",
    "#adqSplash .sp-bar{width:150px;height:4px;margin:20px auto 0;border-radius:4px;background:rgba(255,255,255,.1);overflow:hidden}",
    "#adqSplash .sp-bar i{display:block;width:45%;height:100%;border-radius:4px;background:linear-gradient(90deg,#6366f1,#22d3ee);animation:spBar 1.15s ease-in-out infinite}",
    "@keyframes spPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}",
    "@keyframes spBar{0%{transform:translateX(-110%)}100%{transform:translateX(330%)}}",

    ".x-dock{position:fixed;z-index:60;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 10px);width:calc(100% - 24px);max-width:500px;display:grid;grid-template-columns:repeat(5,1fr);gap:2px;padding:6px;background:rgba(18,18,40,.84);backdrop-filter:blur(24px) saturate(170%);-webkit-backdrop-filter:blur(24px) saturate(170%);border:1px solid rgba(255,255,255,.12);border-radius:24px;box-shadow:0 20px 50px -10px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.1);font-family:'Hind Siliguri','Inter',sans-serif}",
    ".x-dock a{display:flex;flex-direction:column;align-items:center;gap:2px;padding:7px 2px 5px;border-radius:17px;color:#6f7090;font-size:10.5px;font-weight:600;transition:.25s;text-decoration:none}",
    ".x-dock a svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:.25s}",
    ".x-dock a:hover{color:#fff}",
    ".x-dock a.active{color:#fff;background:linear-gradient(135deg,rgba(99,102,241,.5),rgba(139,92,246,.35));box-shadow:inset 0 0 0 1px rgba(167,139,250,.5),0 8px 20px -8px rgba(139,92,246,.9)}",
    ".x-dock a.active svg{transform:translateY(-1px) scale(1.08)}",

    "[hidden]{display:none!important}",
    ".x-body{margin:0;font-family:'Hind Siliguri','Inter',system-ui,sans-serif;background:#06060f;color:#f4f4ff;height:100vh;height:100dvh;overflow:hidden;-webkit-tap-highlight-color:transparent}",
    ".x-body *{box-sizing:border-box}.x-body a{text-decoration:none;color:inherit}.x-body button{font-family:inherit}",
    ".x-body svg{display:block}",
    ".x-bg{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none}",
    ".x-bg .o{position:absolute;border-radius:50%;filter:blur(90px)}",
    ".x-bg .o1{width:420px;height:420px;background:#4f46e5;top:-140px;left:-120px;opacity:.5}",
    ".x-bg .o2{width:380px;height:380px;background:#9333ea;bottom:-160px;right:-120px;opacity:.42}",
    ".x-app{position:relative;z-index:1;height:100vh;height:100dvh;max-width:520px;margin:0 auto;padding:0 14px calc(86px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column}",
    ".x-top{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 10px) 0 10px}",
    ".x-brand{display:flex;align-items:center;gap:9px;font-weight:700;font-size:15.5px}",
    ".x-mark{width:32px;height:32px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#6366f1,#8b5cf6 55%,#22d3ee);color:#fff;font:900 15px 'Inter',sans-serif;box-shadow:0 8px 20px -6px rgba(139,92,246,.8),inset 0 1px 0 rgba(255,255,255,.35)}",
    ".x-actions{display:flex;gap:8px}",
    ".x-ibtn{position:relative;width:38px;height:38px;border-radius:13px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.05);color:#9a9bb8;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:.2s;flex:0 0 38px}",
    ".x-ibtn:hover{color:#fff;background:rgba(255,255,255,.1)}.x-ibtn.danger:hover{background:rgba(239,68,68,.18);border-color:rgba(239,68,68,.45)}",
    ".x-ibtn svg{width:18px;height:18px}",
    ".x-scroll{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;margin:0 -14px;padding:2px 14px 10px;scrollbar-width:none}",
    ".x-scroll::-webkit-scrollbar{display:none}",
    ".x-glass{background:linear-gradient(160deg,rgba(255,255,255,.075),rgba(255,255,255,.025));border:1px solid rgba(255,255,255,.09)}",

    ".x-seg{flex:0 0 auto;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:6px;margin:10px 0;padding:4px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09)}",
    ".x-seg button{display:flex;align-items:center;justify-content:center;gap:7px;padding:9px 6px;border-radius:12px;border:none;background:transparent;color:#9a9bb8;font-size:13px;font-weight:700;cursor:pointer;transition:.25s}",
    ".x-seg button svg{width:16px;height:16px}",
    ".x-seg button.active{color:#fff;background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 10px 22px -8px rgba(139,92,246,.9),inset 0 1px 0 rgba(255,255,255,.3)}",
    ".x-seg .n{font-family:'Inter',sans-serif;font-size:11px;padding:1px 7px;border-radius:999px;background:rgba(255,255,255,.18)}",

    ".x-search{flex:0 0 auto;position:relative}",
    ".x-search svg{position:absolute;left:13px;top:50%;transform:translateY(-50%);width:17px;height:17px;color:#6f7090}",
    ".x-search input{width:100%;padding:12px 14px 12px 40px;border-radius:15px;border:1.5px solid rgba(255,255,255,.09);background:rgba(255,255,255,.05);color:#fff;font:500 14px 'Hind Siliguri','Inter',sans-serif;outline:none;transition:.25s}",
    ".x-search input::placeholder{color:#6f7090}",
    ".x-search input:focus{border-color:rgba(139,92,246,.9);background:rgba(139,92,246,.08);box-shadow:0 0 0 4px rgba(139,92,246,.18)}",
    ".x-chips{flex:0 0 auto;display:flex;gap:7px;overflow-x:auto;padding:10px 0 2px;scrollbar-width:none}",
    ".x-chips::-webkit-scrollbar{display:none}",
    ".x-chips button{padding:7px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.05);color:#9a9bb8;font-size:12.5px;font-weight:700;white-space:nowrap;cursor:pointer;transition:.2s}",
    ".x-chips button.active{color:#fff;border-color:transparent;background:linear-gradient(135deg,#6366f1,#8b5cf6)}",

    ".x-row{display:flex;align-items:center;gap:11px;padding:10px 12px;margin-bottom:8px;border-radius:18px;background:linear-gradient(160deg,rgba(255,255,255,.075),rgba(255,255,255,.025));border:1px solid rgba(255,255,255,.09);transition:.25s;animation:xRise .4s cubic-bezier(.2,.8,.2,1) both}",
    ".x-row:hover{border-color:rgba(139,92,246,.55);transform:translateY(-1px)}.x-row:active{transform:scale(.99)}",
    "@keyframes xRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}",
    ".x-logo{width:44px;height:44px;flex:0 0 44px;border-radius:14px;padding:10px;box-shadow:0 10px 20px -8px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.3)}",
    ".x-logo svg{width:100%;height:100%}",
    ".x-rb{flex:1;min-width:0}",
    ".x-rt{font-size:14px;font-weight:700;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".x-rs{display:flex;align-items:center;gap:6px;margin-top:5px;flex-wrap:nowrap;overflow:hidden}",
    ".x-price{font:900 12px 'Inter',sans-serif;color:#6ee7b7;background:rgba(16,185,129,.14);border:1px solid rgba(16,185,129,.4);padding:2px 9px;border-radius:999px;white-space:nowrap}",
    ".x-tag{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#9a9bb8;white-space:nowrap}",
    ".x-tag svg{width:12px;height:12px}",
    ".x-tag i{width:6px;height:6px;border-radius:50%;background:currentColor}",
    ".x-tag.open{color:#6ee7b7}.x-tag.upcoming{color:#fcd34d}.x-tag.closed{color:#fca5a5}.x-tag.gold{color:#fde68a}",
    ".x-go{width:30px;height:30px;flex:0 0 30px;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;background:linear-gradient(135deg,#6366f1,#8b5cf6);box-shadow:0 8px 18px -8px rgba(139,92,246,.9)}",
    ".x-go svg{width:16px;height:16px}",
    ".x-empty{text-align:center;padding:26px 16px;border-radius:18px;border:1.5px dashed rgba(255,255,255,.14);color:#9a9bb8;font-size:13px;font-weight:600}",
    ".x-empty svg{width:30px;height:30px;margin:0 auto 8px;color:#6f7090}",
    ".x-skel{height:64px;border-radius:18px;margin-bottom:8px;border:1px solid rgba(255,255,255,.09);background:linear-gradient(100deg,rgba(255,255,255,.04) 30%,rgba(255,255,255,.1) 50%,rgba(255,255,255,.04) 70%);background-size:200% 100%;animation:xShim 1.4s infinite linear}",
    "@keyframes xShim{to{background-position:-200% 0}}",
    ".x-more{display:flex;align-items:center;justify-content:center;gap:6px;padding:11px;border-radius:14px;color:#c4b5fd;font-size:13px;font-weight:700;background:rgba(99,102,241,.12);border:1px solid rgba(139,92,246,.35)}",
    ".x-more svg{width:15px;height:15px}",

    ".x-sheet{position:fixed;inset:0;z-index:200;display:flex;align-items:flex-end;justify-content:center;background:rgba(3,3,10,.72);backdrop-filter:blur(6px);opacity:0;visibility:hidden;transition:opacity .25s,visibility .25s}",
    ".x-sheet.show{opacity:1;visibility:visible}",
    ".x-sheet-box{width:100%;max-width:520px;max-height:80dvh;display:flex;flex-direction:column;border-radius:26px 26px 0 0;background:linear-gradient(180deg,#17172f,#0d0d1f);border:1px solid rgba(255,255,255,.12);border-bottom:none;transform:translateY(40px);transition:transform .35s cubic-bezier(.2,.8,.2,1);font-family:'Hind Siliguri','Inter',sans-serif;color:#f4f4ff}",
    ".x-sheet.show .x-sheet-box{transform:none}",
    ".x-sheet-h{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 16px 8px}",
    ".x-sheet-h h3{margin:0;font-size:16px;font-weight:700;color:#fde68a}",
    ".x-sheet-b{overflow-y:auto;padding:4px 16px calc(20px + env(safe-area-inset-bottom,0px));font-size:13.5px;line-height:1.65;color:#e7e5f4;word-break:break-word}",
    ".x-sheet-b .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}",
    ".x-sheet-b .acts a{padding:10px 16px;border-radius:12px;font-size:12.5px;font-weight:700;color:#fff;background:linear-gradient(135deg,#6366f1,#8b5cf6)}",
    ".x-sheet-b .acts a.apk{background:linear-gradient(135deg,#10b981,#0d9488)}",

    "body:not(.x-body) .page,body:not(.x-body) .p-page{padding-top:12px!important}",
    "body:not(.x-body) .lbh{display:none!important}",
    "body:not(.x-body) .podium{min-height:165px!important;margin:0 0 12px!important}",
    "body:not(.x-body) .hhead p,body:not(.x-body) .nh p,body:not(.x-body) .rh p{display:none!important}",
    "body:not(.x-body) .p-hero{margin-bottom:12px!important}",
    "body:not(.x-body) .p-ring{width:72px!important;height:72px!important;margin-bottom:8px!important}",
    "body:not(.x-body) .p-avatar{font-size:28px!important}",
    "body:not(.x-body) .p-sec,body:not(.x-body) .sec{margin:16px 2px 8px!important}",
    "body:not(.x-body) .p-stats{margin-bottom:10px!important}",
    "body:not(.x-body) .bal{padding:16px!important;margin-bottom:10px!important}",
    "body:not(.x-body) .bal-amt{font-size:36px!important;margin-top:8px!important}",
    "body:not(.x-body) .bal-acts{margin-top:12px!important}",
    "body:not(.x-body) .bal-btn{padding:10px!important}",
    "body:not(.x-body) .p-menu{padding:10px 14px!important}",
    "body:not(.x-body) .p-menu-ic{width:36px!important;height:36px!important}",
    "body:not(.x-body) .lr{padding:9px 12px!important;margin-bottom:6px!important}",
    "body:not(.x-body) .wdi,body:not(.x-body) .hrow,body:not(.x-body) .ni,body:not(.x-body) .sr{padding:11px!important;margin-bottom:7px!important}",
    "body:not(.x-body) .wdi-hint{display:none!important}",
    "@media(prefers-reduced-motion:reduce){#adqSplash .sp-logo,#adqSplash .sp-bar i{animation:none}}"
  ].join("\n");

  var st = document.createElement("style");
  st.id = "adq-shell-css";
  st.textContent = css;
  (document.head || root).appendChild(st);

  /* ---------------- SPLASH ---------------- */
  var sp = document.createElement("div");
  sp.id = "adqSplash";
  sp.innerHTML = '<div class="sp-in"><div class="sp-logo">A</div><div class="sp-name">ADQ Income Zone</div><div class="sp-sub">লোড হচ্ছে...</div><div class="sp-bar"><i></i></div></div>';
  root.appendChild(sp);

  var done = false, minDone = false, loaded = document.readyState === "complete", authDone = false;
  function hide() {
    if (done) return;
    done = true;
    root.classList.remove("adq-loading");
    sp.classList.add("out");
    setTimeout(function () { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 600);
  }
  function check() {
    if (minDone && loaded && authDone && !window.adqHold) hide();
  }
  window.adqReady = function () { window.adqHold = false; check(); };

  setTimeout(function () { minDone = true; check(); }, firstVisit ? 900 : 120);
  window.addEventListener("load", function () { loaded = true; check(); });
  setTimeout(hide, 8000); 

  try {
    Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js")
    ]).then(function (m) {
      var off = m[1].onAuthStateChanged(m[0].auth, function () {
        authDone = true; check();
        if (typeof off === "function") off();
      });
    }).catch(function () { authDone = true; check(); });
  } catch (e) { authDone = true; }

  /* ---------------- DOCK ---------------- */
  function buildDock() {
    document.querySelectorAll(".dock,.d-dock,.p-dock,.bottom-nav").forEach(function (e) { e.remove(); });
    if (noDock) return;

    var map = {
      "dashboard.html": "dash", 
      "task-history.html": "dash", 
      "my-submissions.html": "dash",
      "notifications.html": "dash", 
      "reports.html": "dash",
      "tasks.html": "submit", 
      "task.html": "submit",
      "leaderboard.html": "leaders",
      "wallet.html": "wallet", 
      "withdraw.html": "wallet",
      "profile.html": "profile"
    };
    var cur = map[file] || "";
    var items = [
      ["dash", "dashboard.html", "Dashboard", '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>'],
      ["submit", "tasks.html", "Submit", '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'],
      ["leaders", "leaderboard.html", "Leaders", '<path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0012 0V2z"/>'],
      ["wallet", "wallet.html", "Wallet", '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>'],
      ["profile", "profile.html", "Profile", '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>']
    ];
    var nav = document.createElement("nav");
    nav.className = "x-dock";
    nav.innerHTML = items.map(function (i) {
      return '<a href="' + i[1] + '"' + (i[0] === cur ? ' class="active" aria-current="page"' : "") + '><svg viewBox="0 0 24 24">' + i[3] + "</svg><span>" + i[2] + "</span></a>";
    }).join("");
    document.body.appendChild(nav);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildDock);
  else buildDock();
})();
