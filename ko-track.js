// Anonymous visit counter for the owner's dashboard (login/). Sends: a random per-browser id, the page,
// phone/tablet/desktop, the referring site's host, and the browser language. No names, no IPs, no cookies.
// Does nothing until Supabase keys are set in ko-config.js, or when the browser sends Do Not Track.
(function(){
  const SRC = document.currentScript && document.currentScript.src;
  const C = window.KO_CONFIG || {};
  if(!C.supabaseUrl || !C.supabaseAnonKey || navigator.doNotTrack === "1") return;
  let id = null, first = false;
  try{
    id = localStorage.getItem("ko26.vid");
    if(!id){ id = (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16))); localStorage.setItem("ko26.vid", id); first = true; }
    // one row per page per 30 minutes, so refreshes don't inflate the numbers
    // a page in a folder (/epik26/ or /epik26/index.html) is named after that folder; the landing stays "index".
    // The site root is this script's own folder, so a GitHub Pages project prefix (/<repo>/) isn't mistaken for one.
    const segs = location.pathname.split("/");
    let page = (segs.pop() || "index.html").replace(/\.html$/, "") || "index";
    const dir = segs.join("/") + "/", root = SRC ? new URL(".", SRC).pathname : "/";
    if(page === "index" && dir !== root && dir.startsWith(root)) page = segs[segs.length - 1] || page;
    // another rave's leaderboard / gallery counts as its own page (leaderboard-epik26); KO26 keeps the plain name
    const rv = (new URLSearchParams(location.search).get("rave") || "").toLowerCase();
    if(/^[a-z0-9]{2,16}$/.test(rv) && rv !== "ko26" && /^(leaderboard|gallery)$/.test(page)) page += "-" + rv;
    const k = "ko26.seen." + page, last = Number(sessionStorage.getItem(k) || localStorage.getItem(k) || 0);
    if(Date.now() - last < 30 * 60 * 1000) return;
    localStorage.setItem(k, String(Date.now()));
    const ua = navigator.userAgent, w = Math.min(screen.width, screen.height);
    const device = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? "tablet" : /Mobi|iPhone|Android/i.test(ua) || w < 600 ? "phone" : "desktop";
    let ref = ""; try{ const r = document.referrer && new URL(document.referrer); if(r && r.host !== location.host) ref = r.host.replace(/^www\./, ""); }catch(e){}
    const body = {visitor_id: id, first_visit: first, page: page.slice(0, 40), referrer: ref.slice(0, 120) || null, device, lang: (navigator.language || "").slice(0, 20)};
    fetch(C.supabaseUrl + "/rest/v1/visits", {method: "POST", keepalive: true,
      headers: {"apikey": C.supabaseAnonKey, "Authorization": "Bearer " + C.supabaseAnonKey, "Content-Type": "application/json", "Prefer": "return=minimal"},
      body: JSON.stringify(body)}).catch(() => {});
  }catch(e){}
})();
