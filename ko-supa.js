// Shared data layer for the Kickroll Leaderboard (leaderboard.html) and Gallery (gallery.html).
// Live mode: Supabase (anonymous sign-in, table kickrolls / ratings / reports, view kickroll_scores, bucket kickrolls).
// Demo mode (no keys in ko-config.js, or Supabase unreachable): the same API backed by IndexedDB on this device.
//
//   await KO.ready()                     -> {mode: "live" | "demo", reason?}
//   KO.sets                              -> KO26 sets: {act: {stage, start, end, url, video, tracks:[{n, text, artist, title, key, id}]}}
//   KO.songs()                           -> flat list of every song: {act, stage, key, text, artist, title, n}
//   await KO.list({act?, songKey?})      -> kickrolls: {id, act, songKey, song, name, caption, url, createdAt, avg, votes, score, mine, myStars}
//   await KO.upload({file, act, songKey, song, name, caption}, onProgress(0..1)) -> kickroll
//   await KO.rate(id, stars 1..5)
//   await KO.report(id)
//   await KO.remove(id)                  (own videos only)
//   KO.closed(), KO.deadline (Date), KO.timeLeft() -> ms
//   KO.score(avg, votes)                 Bayesian score used for ranking
//   KO.rank(list)                        sorted best first
//   KO.winners(list)                     {overall, byStage:{stage:k}, byAct:{act:k}, bySong:{songKey:k}} (k = kickroll or undefined)
//   KO.myName() / KO.setMyName(n)        uploader name remembered on this device (shared with the player card name)
//   KO.user()                            signed-in account {id, email, name} or null
//   KO.onAuth(fn)                        fn(user) whenever someone signs in or out
//   await KO.requireAccount(reason)      resolves with the user; opens the sign-in / sign-up sheet first if needed
//   KO.openAccount() / await KO.signOut()
// Posting, rating and reporting need an account (email + password, email confirmed). Supabase Auth hashes the
// passwords (bcrypt); this site never sees or stores them. Browsing needs nothing.
// Kickrolls carry status: "approved" (public), or "pending" / "rejected" (only the uploader sees those).
(function(){
  const CFG = Object.assign({bucket:"kickrolls", maxUploadMB:50, deadline:"2026-10-10T23:59:59+11:00"}, window.KO_CONFIG || {});
  const KO = window.KO = {};
  KO.config = CFG;
  KO.deadline = new Date(CFG.deadline);
  KO.closed = () => Date.now() >= KO.deadline.getTime();
  KO.timeLeft = () => Math.max(0, KO.deadline.getTime() - Date.now());
  KO.maxBytes = CFG.maxUploadMB * 1024 * 1024;
  KO.STAGES = {arena:"The Arena", pit:"The Megapit", oasis:"The Oasis"};

  // ---- ranking: Bayesian average so one 5-star vote doesn't beat twenty 4.8s ----
  const PRIOR = 3.5, WEIGHT = 3;
  KO.score = (avg, votes) => votes ? (PRIOR * WEIGHT + avg * votes) / (WEIGHT + votes) : 0;
  KO.rank = list => list.slice().sort((a, b) => b.score - a.score || b.votes - a.votes || new Date(a.createdAt) - new Date(b.createdAt));
  KO.winners = list => {
    const r = KO.rank(list.filter(k => k.votes > 0));
    const out = {overall: r[0], byStage:{}, byAct:{}, bySong:{}};
    for(const k of r){
      const st = (KO.sets[k.act] || {}).stage;
      if(st && !out.byStage[st]) out.byStage[st] = k;
      if(!out.byAct[k.act]) out.byAct[k.act] = k;
      if(!out.bySong[k.songKey]) out.bySong[k.songKey] = k;
    }
    return out;
  };

  // ---- names: share the player card's name ("ko26.name") ----
  const ls = { get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
               set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} } };
  KO.myName = () => String(ls.get("ko26.name", "") || "").slice(0, 24);
  KO.setMyName = n => ls.set("ko26.name", String(n || "").slice(0, 24));

  // ---- the KO26 sets: ko26.json, built from each act's 1001Tracklists listing ----
  KO.sets = {};
  const slug = s => String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  KO.slug = slug;
  KO.songs = () => Object.entries(KO.sets).flatMap(([act, s]) => (s.tracks || []).map(t => ({act, stage: s.stage, ...t})));
  KO.song = key => KO.songs().find(s => s.key === key);
  async function loadSets(){
    const r = await fetch("ko26.json", {cache: "no-cache"});
    const d = await r.json();
    KO.event = d.event || {};
    for(const [act, s] of Object.entries(d.acts || {})){
      s.tracks = (s.tracks || []).map(([n, text], i) => {
        const j = text.indexOf(" - ");
        return { n, text, artist: j > 0 ? text.slice(0, j) : "", title: j > 0 ? text.slice(j + 3) : text, key: slug(act) + "/" + slug(text) + (/^id\s*-\s*id$/i.test(text) ? "-" + i : ""), id: /^id\s*-\s*id$/i.test(text) };
      });
      KO.sets[act] = s;
    }
  }

  // ======================= live: Supabase =======================
  let sb = null, uid = null;
  const live = {
    async init(){
      if(!CFG.supabaseUrl || !CFG.supabaseAnonKey) throw new Error("no keys");
      if(!window.supabase){
        await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"; s.onload = res; s.onerror = () => rej(new Error("supabase-js didn't load")); document.head.appendChild(s); });
      }
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {auth:{persistSession:true, storageKey:"ko26.auth", detectSessionInUrl:true}});
      const { data:{ session } } = await sb.auth.getSession();
      setUser(session && session.user);
      sb.auth.onAuthStateChange((_e, sess) => setUser(sess && sess.user));
    },
    async signUp({email, password, name, captchaToken}){
      const { data, error } = await sb.auth.signUp({email, password, options:{data:{name}, emailRedirectTo: location.href.split("#")[0], captchaToken}});
      if(error) throw error;
      if(data.user && Array.isArray(data.user.identities) && !data.user.identities.length) throw new Error("that email already has an account. sign in instead");
      return {needsConfirm: !data.session};
    },
    async signIn({email, password, captchaToken}){
      const { error } = await sb.auth.signInWithPassword({email, password, options:{captchaToken}});
      if(error) throw new Error(/confirm/i.test(error.message) ? "confirm your email first (check your inbox)" : /invalid/i.test(error.message) ? "wrong email or password" : error.message);
    },
    async resetPassword(email){
      const { error } = await sb.auth.resetPasswordForEmail(email, {redirectTo: location.href.split("#")[0]});
      if(error) throw error;
    },
    async signOut(){ await sb.auth.signOut(); },
    url: path => `${CFG.supabaseUrl}/storage/v1/object/public/${CFG.bucket}/${path.split("/").map(encodeURIComponent).join("/")}`,
    async list({act, songKey} = {}){
      let q = sb.from("kickroll_scores").select("*").order("created_at", {ascending:false}).limit(1000);
      if(act) q = q.eq("act", act);
      if(songKey) q = q.eq("song_key", songKey);
      const { data, error } = await q; if(error) throw error;
      const ids = data.map(x => x.id);
      let mine = {};
      if(ids.length){
        const { data: rs } = await sb.from("ratings").select("kickroll_id, stars").eq("rater", uid).in("kickroll_id", ids);
        for(const r of rs || []) mine[r.kickroll_id] = r.stars;
      }
      const out = data.map(x => shape({id:x.id, act:x.act, songKey:x.song_key, song:x.song, name:x.name, caption:x.caption || "", status:"approved",
        url: live.url(x.path), createdAt:x.created_at, avg:Number(x.avg_stars), votes:x.votes, mine: !!uid && x.owner === uid, myStars: mine[x.id] || 0}));
      if(uid){  // my own uploads that are still waiting for review (or were turned down)
        let q2 = sb.from("kickrolls").select("*").eq("owner", uid).neq("status", "approved");
        if(act) q2 = q2.eq("act", act);
        if(songKey) q2 = q2.eq("song_key", songKey);
        const { data: own } = await q2;
        for(const x of own || []) out.push(shape({id:x.id, act:x.act, songKey:x.song_key, song:x.song, name:x.name, caption:x.caption || "", status:x.status,
          reviewNote:x.review_note || "", url: live.url(x.path), createdAt:x.created_at, avg:0, votes:0, mine:true, myStars:0}));
      }
      return out;
    },
    async upload({file, act, songKey, song, name, caption}, onProgress){
      const ext = (file.name.match(/\.(mp4|mov|webm|m4v)$/i) || [".mp4"])[0].toLowerCase();
      const path = `${uid}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      const { data:{ session } } = await sb.auth.getSession();
      await new Promise((res, rej) => {  // XHR for upload progress
        const x = new XMLHttpRequest();
        x.open("POST", `${CFG.supabaseUrl}/storage/v1/object/${CFG.bucket}/${path}`);
        x.setRequestHeader("Authorization", "Bearer " + session.access_token);
        x.setRequestHeader("apikey", CFG.supabaseAnonKey);
        x.setRequestHeader("Content-Type", file.type || "video/mp4");
        x.setRequestHeader("x-upsert", "false");
        x.upload.onprogress = e => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
        x.onload = () => x.status < 300 ? res() : rej(new Error(errText(x.responseText) || "upload failed (" + x.status + ")"));
        x.onerror = () => rej(new Error("network error during upload"));
        x.send(file);
      });
      const row = {act, song_key: songKey, song, name, caption: caption || null, path, mime: file.type || "video/mp4", size_bytes: file.size};
      const { data, error } = await sb.from("kickrolls").insert(row).select().single();
      if(error){
        await sb.storage.from(CFG.bucket).remove([path]);
        throw new Error(/kickrolls_one_per_song|duplicate key/.test(error.message) ? "you've already posted a kickroll to this song. delete it first to post a new one"
          : /kickrolls_no_links/.test(error.message) ? "no links in names or captions" : error.message);
      }
      return shape({id:data.id, act, songKey, song, name, caption: caption || "", status:data.status, url: live.url(path), createdAt:data.created_at, avg:0, votes:0, mine:true, myStars:0});
    },
    async rate(id, stars){
      const { error } = await sb.from("ratings").upsert({kickroll_id:id, rater:uid, stars}, {onConflict:"kickroll_id,rater"});
      if(error) throw error;
    },
    async report(id){
      const { error } = await sb.from("reports").insert({kickroll_id:id, reporter:uid});
      if(error && error.code !== "23505") throw error;   // already reported: fine
    },
    async remove(id){
      const { data } = await sb.from("kickrolls").select("path").eq("id", id).single();
      const { error } = await sb.from("kickrolls").delete().eq("id", id); if(error) throw error;
      if(data) await sb.storage.from(CFG.bucket).remove([data.path]);
    }
  };
  const errText = t => { try{ const j = JSON.parse(t); return j.message || j.error; }catch(e){ return ""; } };

  // ======================= demo: IndexedDB on this device =======================
  let idb = null;
  const tx = (store, mode, fn) => new Promise((res, rej) => { const t = idb.transaction(store, mode); const s = t.objectStore(store); const r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); });
  const all = store => new Promise((res, rej) => { const r = idb.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const urls = new Map();
  const demo = {
    async init(){
      idb = await new Promise((res, rej) => {
        const r = indexedDB.open("ko26-kickrolls", 1);
        r.onupgradeneeded = () => { r.result.createObjectStore("kickrolls", {keyPath:"id"}); r.result.createObjectStore("ratings", {keyPath:"id"}); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    },
    async list({act, songKey} = {}){
      const ks = (await all("kickrolls")).filter(k => (!act || k.act === act) && (!songKey || k.songKey === songKey));
      const rs = await all("ratings");
      return ks.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(k => {
        const mine = rs.filter(r => r.kickrollId === k.id);
        const avg = mine.length ? mine.reduce((s, r) => s + r.stars, 0) / mine.length : 0;
        if(!urls.has(k.id)) urls.set(k.id, URL.createObjectURL(k.blob));
        return shape({id:k.id, act:k.act, songKey:k.songKey, song:k.song, name:k.name, caption:k.caption, status:"approved", url:urls.get(k.id), createdAt:k.createdAt,
          avg, votes:mine.length, mine: !!k.mine, myStars: mine.length ? mine[0].stars : 0});
      });
    },
    async upload({file, act, songKey, song, name, caption}, onProgress){
      for(let p = 0; p <= 1; p += .25){ onProgress && onProgress(p); await new Promise(r => setTimeout(r, 60)); }
      const k = {id: "demo-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), act, songKey, song, name, caption: caption || "", blob:file, createdAt:new Date().toISOString(), mine:true};
      await tx("kickrolls", "readwrite", s => s.put(k));
      return (await demo.list({songKey})).find(x => x.id === k.id);
    },
    async rate(id, stars){ await tx("ratings", "readwrite", s => s.put({id, kickrollId:id, stars})); },
    async report(){},
    async remove(id){ await tx("kickrolls", "readwrite", s => s.delete(id)); await tx("ratings", "readwrite", s => s.delete(id)); },
    // demo accounts live on this device only, so the sign-up flow can be tried without a backend
    async signUp({email, name}){ ls.set("ko26.demoUser", {id:"demo-user", email, name}); setUser({id:"demo-user", email, user_metadata:{name}}); return {needsConfirm:false}; },
    async signIn({email}){ const u = ls.get("ko26.demoUser", null) || {email}; setUser({id:"demo-user", email:u.email || email, user_metadata:{name:u.name}}); },
    async resetPassword(){},
    async signOut(){ setUser(null); }
  };

  function shape(k){ k.score = KO.score(k.avg, k.votes); return k; }

  // ======================= accounts =======================
  let me = null; const authFns = [];
  function setUser(u){
    const was = me && me.id;
    me = u && !u.is_anonymous ? {id:u.id, email:u.email || "", name:(u.user_metadata && u.user_metadata.name) || ""} : null;
    uid = me && me.id;
    if(me && me.name && !KO.myName()) KO.setMyName(me.name);
    if((me && me.id) !== was) authFns.forEach(f => { try{ f(me); }catch(e){} });
  }
  KO.user = () => me;
  KO.onAuth = fn => { authFns.push(fn); };
  KO.signOut = async () => { await impl.signOut(); setUser(null); };
  KO.requireAccount = reason => me ? Promise.resolve(me) : KO.openAccount(reason);
  let sheet = null, sheetWait = null;
  KO.openAccount = reason => new Promise((res, rej) => {
    if(sheetWait) sheetWait.rej(new Error("cancelled"));
    sheetWait = {res, rej};
    buildSheet(); sheet.querySelector(".koa-why").textContent = reason || "Make a free account to post your kickroll and rate others.";
    sheet.hidden = false; document.body.style.overflow = "hidden";
    mode("up"); setTimeout(() => sheet.querySelector("[name=email]").focus(), 30);
  });
  function closeSheet(ok){
    if(!sheet) return; sheet.hidden = true; document.body.style.overflow = "";
    const w = sheetWait; sheetWait = null;
    if(w) ok ? w.res(me) : w.rej(new Error("sign in to do that"));
  }
  function mode(m){
    sheet.dataset.mode = m;
    sheet.querySelector(".koa-title").textContent = m === "up" ? "Join the leaderboard" : m === "in" ? "Welcome back" : m === "reset" ? "Reset your password" : "Check your email";
    sheet.querySelector(".koa-name").hidden = m !== "up";
    sheet.querySelector(".koa-pw").hidden = m === "reset" || m === "sent";
    sheet.querySelector(".koa-form").hidden = m === "sent";
    sheet.querySelector(".koa-go").textContent = m === "up" ? "Create account" : m === "in" ? "Sign in" : "Send reset link";
    sheet.querySelector(".koa-msg").textContent = "";
  }
  let captcha = null;
  function loadTurnstile(box){
    if(!CFG.turnstileSiteKey) return;
    const draw = () => { box.innerHTML = ""; captcha = null; window.turnstile.render(box, {sitekey: CFG.turnstileSiteKey, theme:"dark", callback: t => { captcha = t; }, "expired-callback": () => { captcha = null; }}); };
    if(window.turnstile) return draw();
    const s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true; s.onload = draw; document.head.appendChild(s);
  }
  function buildSheet(){
    if(sheet) return;
    const css = document.createElement("style");
    css.textContent = `.koa{position:fixed;inset:0;z-index:90;display:grid;place-items:center;padding:16px;background:rgba(6,5,3,.82)}
.koa[hidden]{display:none}
.koa-box{width:min(420px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:var(--panel-2,#1a1206);border:1px solid var(--gold,#c9a84c);padding:20px;color:var(--fg,#f4ecd8);font-family:var(--body,system-ui);box-shadow:0 10px 40px rgba(0,0,0,.6)}
.koa-title{margin:0 0 4px;font-family:var(--blackletter,Georgia,serif);font-weight:400;font-size:34px;line-height:1.1}
.koa-why{margin:0 0 14px;color:var(--muted,#9a8f74);font-size:14px;line-height:1.5}
.koa label{display:grid;gap:4px;margin:0 0 10px;font-family:var(--rpg,Georgia);font-weight:700;font-size:12px;letter-spacing:.08em;color:var(--muted,#9a8f74)}
.koa input{min-height:44px;background:var(--panel,#16110a);color:var(--fg,#f4ecd8);border:1px solid var(--line,#3a2e1a);padding:8px 12px;font:16px var(--body,system-ui);letter-spacing:0}
.koa input:focus-visible{outline:2px solid var(--gold-hi,#ffc85a);outline-offset:1px}
.koa-go{width:100%;min-height:46px;margin-top:4px;background:var(--gold,#c9a84c);color:var(--kick-ink,#1a1206);border:1px solid var(--gold-hi,#ffc85a);font-family:var(--rpg,Georgia);font-weight:700;font-size:15px;letter-spacing:.08em;cursor:pointer}
.koa-go:disabled{opacity:.6;cursor:progress}
.koa-msg{min-height:20px;margin:10px 0 0;font-size:14px;color:var(--warn,#ff6a3d)}
.koa-msg.ok{color:var(--rel,#72e6ad)}
.koa-links{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;margin-top:12px;font-size:14px}
.koa-links button,.koa-x{background:none;border:0;color:var(--gold-hi,#ffc85a);text-decoration:underline;text-underline-offset:3px;cursor:pointer;font:inherit;padding:6px 0}
.koa-x{float:right;text-decoration:none;font-size:22px;line-height:1;color:var(--muted,#9a8f74);padding:0 0 0 12px;min-width:44px;min-height:44px}
.koa-fine{margin:12px 0 0;font-size:12px;color:var(--dim,#6b6250);line-height:1.5}
.koa-cap{margin:4px 0 8px;min-height:0}`;
    document.head.appendChild(css);
    sheet = document.createElement("div");
    sheet.className = "koa"; sheet.hidden = true;
    sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-labelledby", "koaTitle");
    sheet.innerHTML = `<div class="koa-box"><button type="button" class="koa-x" aria-label="Close">×</button>
<h2 class="koa-title" id="koaTitle"></h2><p class="koa-why"></p>
<form class="koa-form" novalidate>
<label class="koa-name">Name on your kickrolls<input name="name" maxlength="24" autocomplete="nickname" required></label>
<label>Email<input name="email" type="email" autocomplete="email" required></label>
<label class="koa-pw">Password<input name="password" type="password" minlength="8" autocomplete="current-password" required></label>
<div class="koa-cap"></div>
<button class="koa-go" type="submit"></button>
</form>
<p class="koa-msg" role="status"></p>
<div class="koa-links"><button type="button" data-m="in">I have an account</button><button type="button" data-m="up">Make an account</button><button type="button" data-m="reset">Forgot password?</button></div>
<p class="koa-fine">Browsing is free. An account lets you post and rate, one rating per person. Passwords are stored hashed by our database provider (Supabase); this site never sees them.</p></div>`;
    document.body.appendChild(sheet);
    const f = sheet.querySelector("form"), msg = sheet.querySelector(".koa-msg"), go = sheet.querySelector(".koa-go");
    sheet.querySelector("[name=name]").value = KO.myName();
    loadTurnstile(sheet.querySelector(".koa-cap"));
    sheet.addEventListener("click", e => {
      if(e.target === sheet || e.target.closest(".koa-x")) return closeSheet(false);
      const m = e.target.closest("[data-m]"); if(m){ mode(m.dataset.m); sheet.querySelector(m.dataset.m === "up" ? "[name=name]" : "[name=email]").focus(); }
    });
    sheet.addEventListener("keydown", e => { if(e.key === "Escape") closeSheet(false); });
    f.addEventListener("submit", async e => {
      e.preventDefault(); msg.className = "koa-msg"; msg.textContent = "";
      const m = sheet.dataset.mode, email = f.email.value.trim(), password = f.password.value, name = f.name.value.trim();
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg.textContent = "enter a valid email";
      if(m !== "reset" && password.length < 8) return msg.textContent = "password needs at least 8 characters";
      if(m === "up" && !name) return msg.textContent = "add the name people will see";
      if(m === "up" && /(https?:|www\.|\.com\b)/i.test(name)) return msg.textContent = "no links in names";
      if(CFG.turnstileSiteKey && m !== "reset" && !captcha) return msg.textContent = "tick the 'I'm human' check first";
      go.disabled = true;
      try{
        if(m === "up"){
          const r = await impl.signUp({email, password, name, captchaToken: captcha || undefined});
          KO.setMyName(name);
          if(r.needsConfirm){ mode("sent"); msg.className = "koa-msg ok"; msg.textContent = "We sent a confirmation link to " + email + ". Tap it, then come back and sign in."; }
          else closeSheet(true);
        } else if(m === "in"){ await impl.signIn({email, password, captchaToken: captcha || undefined}); closeSheet(true); }
        else { await impl.resetPassword(email); msg.className = "koa-msg ok"; msg.textContent = "If that email has an account, a reset link is on its way."; }
      }catch(err){ msg.textContent = (err && err.message) || "something went wrong"; }
      finally{ go.disabled = false; if(window.turnstile && CFG.turnstileSiteKey){ try{ window.turnstile.reset(); }catch(e){} captcha = null; } }
    });
  }

  let impl = null, readyP = null;
  KO.ready = () => readyP || (readyP = (async () => {
    await loadSets();
    try{ await live.init(); impl = live; KO.mode = "live"; return {mode:"live"}; }
    catch(e){ await demo.init(); impl = demo; KO.mode = "demo"; return {mode:"demo", reason: e && e.message}; }
  })());
  const guard = () => { if(KO.closed()) throw new Error("voting and uploads closed on " + KO.deadline.toLocaleDateString()); };
  KO.list = o => impl.list(o);
  KO.upload = async (o, p) => {
    guard();
    if(!o.file || !/^video\//.test(o.file.type || "video/")) throw new Error("pick a video file");
    if(o.file.size > KO.maxBytes) throw new Error(`that video is over ${CFG.maxUploadMB} MB. trim it or record at 1080p`);
    if(!String(o.name || "").trim()) throw new Error("add your name");
    if(/(https?:|www\.)/i.test(o.caption || "") || /(https?:|www\.)/i.test(o.name || "")) throw new Error("no links in names or captions");
    await KO.requireAccount("Make a free account to post your kickroll. It keeps the leaderboard spam-free.");
    return impl.upload({...o, name:String(o.name).trim().slice(0, 24), caption:String(o.caption || "").trim().slice(0, 140)}, p);
  };
  KO.rate = async (id, stars) => { guard(); await KO.requireAccount("Make a free account to rate kickrolls: one vote per person keeps it fair."); return impl.rate(id, Math.max(1, Math.min(5, Math.round(stars)))); };
  KO.report = async id => { await KO.requireAccount("Sign in to report a video."); return impl.report(id); };
  KO.remove = id => impl.remove(id);
})();
