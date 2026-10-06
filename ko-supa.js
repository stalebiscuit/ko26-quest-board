// Shared data layer for the Kickroll Leaderboard (leaderboard.html), Gallery (gallery.html) and Groups (groups.html).
// Every rave has its own leaderboard: the page's ?rave= (default ko26, see `raves` in ko-config.js) picks the rave, its
// songs (<rave>.json), its deadline, and which kickrolls / song ratings are listed and posted. Groups are global.
// Live mode: Supabase (anonymous sign-in, table kickrolls / ratings / reports, view kickroll_scores, bucket kickrolls).
// Demo mode (no keys in ko-config.js, or Supabase unreachable): the same API backed by IndexedDB on this device.
//
//   await KO.ready()                     -> {mode: "live" | "demo", reason?}
//   KO.rave / KO.raveInfo / KO.RAVES     current rave id ("ko26"), its ko-config entry {name, short, tagline, board, theme, deadline}, all raves
//   KO.raveName(id) / KO.raveHref(page, id?)  short name ("EPIK26") / "leaderboard.html?rave=epik26"
//   KO.sets                              -> this rave's sets: {act: {stage, start, end, url, video, tracks:[{n, text, artist, title, key, id}]}}
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
//   KO.parseLink(text)                   TikTok / Instagram post link -> {source, url, id, handle, short} (throws on anything else)
//   await KO.linkPost({url, act, songKey, song, name, caption})   post a TikTok / Instagram link instead of uploading a file
//   KO.profile() / await KO.saveProfile({tiktok, instagram})      the signed-in person's linked social handles
//   KO.socialUrl("tiktok"|"instagram", handle)                    profile page link
// Groups (friends compare kickrolls; account needed):
//   await KO.myGroups()                  [{id, name, invite, isOwner, members}]
//   await KO.createGroup(name) / KO.joinGroup(code)  -> {id, name}
//   await KO.groupBoard(id, rave?)       (every rave, or just one) {group:{id, name, invite, isOwner}, members:[{userId, name, isMe, isOwner, posts, avg, votes,
//                                         best:{id, rave, song, songKey, act, avg, votes}|null, raves:[...], bestScore, ratingsGiven, social:{tiktok, instagram}}]} ranked best first
//   await KO.leaveGroup(id) / KO.groupAdmin(id, "remove"|"new_code"|"rename"|"delete", {target, name})
//   KO.inviteUrl(code)                   link that opens groups.html and joins
// Song ratings (rate the track itself, 1-5; only you and your group mates see them):
//   await KO.rateSong({songKey, act, song, stars})     stars 0 removes your rating
//   await KO.mySongRatings()             {songKey: stars} for the signed-in person
//   await KO.songMates(songKey)          [{userId, name, stars, isMe}] you + group mates who rated it
//   await KO.groupSongs(groupId, rave?)  [{rave, songKey, act, song, avg, n, ratings:[{userId, name, stars, isMe}]}] best first
// Every kickroll item: {id, act, songKey, song, name, caption, status, source:"upload"|"tiktok"|"instagram",
//   url (video file, uploads only), link (the post on TikTok/Instagram), embedUrl (official player, or null),
//   thumb (cover image or null), handle (the post's @handle), social:{tiktok, instagram} (uploader's linked socials),
//   createdAt, avg, votes, score, mine, myStars}
// Posting, rating and reporting need an account (email + password, email confirmed). Supabase Auth hashes the
// passwords (bcrypt); this site never sees or stores them. Browsing needs nothing.
// Kickrolls carry status: "approved" (public), or "pending" / "rejected" (only the uploader sees those).
(function(){
  const CFG = Object.assign({bucket:"kickrolls", maxUploadMB:50, defaultRave:"ko26"}, window.KO_CONFIG || {});
  if(!CFG.raves) CFG.raves = {ko26:{name:"Knockout Outdoor 2026", short:"KO26", tagline:"Level Up", board:"ko26.html", theme:"ko", deadline: CFG.deadline || "2026-10-10T23:59:59+11:00"}};
  const KO = window.KO = {};
  KO.config = CFG;
  // ---- which rave this page is about: ?rave=<id>, else the default ----
  KO.RAVES = CFG.raves;
  const askedRave = (new URLSearchParams(location.search).get("rave") || "").toLowerCase();
  KO.rave = /^[a-z0-9]{2,16}$/.test(askedRave) && CFG.raves[askedRave] ? askedRave : (CFG.raves[CFG.defaultRave] ? CFG.defaultRave : Object.keys(CFG.raves)[0]);
  KO.raveInfo = Object.assign({short: KO.rave.toUpperCase(), name: KO.rave.toUpperCase()}, CFG.raves[KO.rave]);
  KO.raveName = id => ((CFG.raves[id] || {}).short) || String(id || "").toUpperCase();
  KO.raveHref = (page, id) => page + "?rave=" + encodeURIComponent(id || KO.rave);
  const GLOBAL = !!(document.currentScript && document.currentScript.hasAttribute("data-global"));   // groups.html: no rave of its own
  KO.deadline = new Date(KO.raveInfo.deadline || CFG.deadline || "2026-10-10T23:59:59+11:00");
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

  // ---- this rave's sets: <rave>.json (ko26.json is built from each act's 1001Tracklists listing) ----
  KO.sets = {};
  const slug = s => String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  KO.slug = slug;
  KO.songs = () => Object.entries(KO.sets).flatMap(([act, s]) => (s.tracks || []).map(t => ({act, stage: s.stage, ...t})));
  KO.song = key => KO.songs().find(s => s.key === key);
  async function loadSets(){
    if(GLOBAL){ KO.event = {}; return; }
    const r = await fetch(KO.rave + ".json", {cache: "no-cache"});
    if(!r.ok) throw new Error("couldn't load the " + KO.raveInfo.short + " songs (" + r.status + ")");
    const d = await r.json();
    KO.event = d.event || {};
    if(d.event && d.event.stages) KO.STAGES = d.event.stages;
    for(const [act, s] of Object.entries(d.acts || {})){
      s.tracks = (s.tracks || []).map(([n, text], i) => {
        const j = text.indexOf(" - ");
        return { n, text, artist: j > 0 ? text.slice(0, j) : "", title: j > 0 ? text.slice(j + 3) : text, key: slug(act) + "/" + slug(text) + (/^id\s*-\s*id$/i.test(text) ? "-" + i : ""), id: /^id\s*-\s*id$/i.test(text) };
      });
      KO.sets[act] = s;
    }
  }

  // ======================= TikTok / Instagram links =======================
  const RX = {
    tt: /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9._]{2,24})\/video\/(\d{8,25})/i,
    ttShort: /^https?:\/\/(?:(?:vm|vt)\.tiktok\.com\/[A-Za-z0-9]{5,20}|(?:www\.)?tiktok\.com\/t\/[A-Za-z0-9]{5,20})\/?/i,
    ig: /^https?:\/\/(?:www\.)?instagram\.com\/(?:([A-Za-z0-9._]{1,30})\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]{5,40})/i
  };
  const cleanHandle = (h, max) => { h = String(h || "").trim().replace(/^https?:\/\/(www\.)?(tiktok|instagram)\.com\/@?/i, "").replace(/^@/, "").replace(/[/?#].*$/, ""); return /^[A-Za-z0-9._]+$/.test(h) && h.length <= max ? h : ""; };
  KO.parseLink = text => {
    const t = String(text || "").trim().match(/https?:\/\/\S+/); const u = t ? t[0] : "";
    let m;
    if((m = RX.tt.exec(u))) return {source:"tiktok", url:`https://www.tiktok.com/@${m[1]}/video/${m[2]}`, id:m[2], handle:m[1], short:false};
    if((m = RX.ttShort.exec(u))) return {source:"tiktok", url:m[0].replace(/^http:/, "https:").replace(/\/?$/, "/"), id:null, handle:null, short:true};
    if((m = RX.ig.exec(u))){ const kind = m[2].toLowerCase() === "p" ? "p" : "reel"; return {source:"instagram", url:`https://www.instagram.com/${kind}/${m[3]}/`, id:m[3], handle:m[1] && !/^(reel|reels|p|tv)$/i.test(m[1]) ? m[1] : null, short:false}; }
    throw new Error("paste a TikTok or Instagram post link (tiktok.com/@you/video/… or instagram.com/reel/…)");
  };
  // TikTok's public oEmbed (CORS-open): real @handle, video id and cover for a link, short links included when TikTok allows
  async function tiktokInfo(url){
    try{
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 7000);
      const r = await fetch("https://www.tiktok.com/oembed?url=" + encodeURIComponent(url), {signal:c.signal}); clearTimeout(t);
      if(!r.ok) return null;
      const j = await r.json(); const m = /cite="([^"]+)"/.exec(j.html || ""); const p = m ? RX.tt.exec(m[1]) : null;
      return {id: p ? p[2] : null, handle: j.author_unique_id || (p && p[1]) || null, thumb: /^https:\/\//.test(j.thumbnail_url || "") ? j.thumbnail_url : null, url: p ? `https://www.tiktok.com/@${p[1]}/video/${p[2]}` : null};
    }catch(e){ return null; }
  }
  KO.embedUrl = (source, id, link) => source === "tiktok" && id ? `https://www.tiktok.com/player/v1/${encodeURIComponent(id)}?loop=1&rel=0&music_info=1&description=1`
    : source === "instagram" && id ? `https://www.instagram.com/${/\/p\//.test(link || "") ? "p" : "reel"}/${encodeURIComponent(id)}/embed/` : null;
  KO.socialUrl = (net, h) => !h ? null : net === "tiktok" ? `https://www.tiktok.com/@${encodeURIComponent(h)}` : `https://www.instagram.com/${encodeURIComponent(h)}/`;
  let myProfile = {tiktok:"", instagram:""};
  KO.profile = () => ({...myProfile});

  // ======================= live: Supabase =======================
  let sb = null, uid = null, noRaveCol = false;
  const live = {
    async init(){
      if(!CFG.supabaseUrl || !CFG.supabaseAnonKey) throw new Error("no keys");
      if(!window.supabase){
        // jsdelivr first, unpkg as a backup if that request fails
        const load = src => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => { s.remove(); rej(new Error("supabase-js didn't load")); }; document.head.appendChild(s); });
        await load("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2").catch(() => load("https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js"));
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
      const base = () => { let q = sb.from("kickroll_scores").select("*").order("created_at", {ascending:false}).limit(1000);
        if(act) q = q.eq("act", act); if(songKey) q = q.eq("song_key", songKey); return q; };
      let { data, error } = await base().eq("rave", KO.rave);
      // the database hasn't had the multi-rave setup.sql yet: every kickroll is KO26
      if(error && /rave/.test(error.message || "") && KO.rave === "ko26"){ noRaveCol = true; ({ data, error } = await base()); }
      if(error) throw error;
      const ids = data.map(x => x.id);
      let mine = {};
      if(ids.length){
        const { data: rs } = await sb.from("ratings").select("kickroll_id, stars").eq("rater", uid).in("kickroll_id", ids);
        for(const r of rs || []) mine[r.kickroll_id] = r.stars;
      }
      const out = data.map(x => fromRow(x, {status:"approved", avg:Number(x.avg_stars), votes:x.votes, mine: !!uid && x.owner === uid, myStars: mine[x.id] || 0,
        social:{tiktok:x.owner_tiktok || "", instagram:x.owner_instagram || ""}}));
      if(uid){  // my own uploads that are still waiting for review (or were turned down)
        let q2 = sb.from("kickrolls").select("*").eq("owner", uid).neq("status", "approved");
        if(!noRaveCol) q2 = q2.eq("rave", KO.rave);
        if(act) q2 = q2.eq("act", act);
        if(songKey) q2 = q2.eq("song_key", songKey);
        const { data: own } = await q2;
        for(const x of own || []) out.push(fromRow(x, {status:x.status, reviewNote:x.review_note || "", avg:0, votes:0, mine:true, myStars:0, social:KO.profile()}));
      }
      return out;
    },
    async upload({file, act, songKey, song, name, caption}, onProgress){
      const ext = (file.name.match(/\.(mp4|mov|webm|m4v)$/i) || [".mp4"])[0].toLowerCase();
      const path = `${uid}/${KO.rave}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`;
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
      const row = {rave: KO.rave, act, song_key: songKey, song, name, caption: caption || null, path, mime: file.type || "video/mp4", size_bytes: file.size};
      const { data, error } = await sb.from("kickrolls").insert(row).select().single();
      if(error){
        await sb.storage.from(CFG.bucket).remove([path]);
        throw new Error(/kickrolls_one_per_song|duplicate key/.test(error.message) ? "you've already posted a kickroll to this song. delete it first to post a new one"
          : /kickrolls_no_links/.test(error.message) ? "no links in names or captions" : error.message);
      }
      return fromRow(data, {status:data.status, avg:0, votes:0, mine:true, myStars:0, social:KO.profile()});
    },
    async linkPost(o){
      const row = {rave: KO.rave, act:o.act, song_key:o.songKey, song:o.song, name:o.name, caption:o.caption || null, source:o.source, external_url:o.url, external_id:o.id, handle:o.handle, thumb_url:o.thumb};
      const { data, error } = await sb.from("kickrolls").insert(row).select().single();
      if(error) throw new Error(/kickrolls_one_external|external_url/.test(error.message) ? "that post is already on the leaderboard"
        : /kickrolls_one_per_song/.test(error.message) ? "you've already posted a kickroll to this song. delete it first to post a new one"
        : /kickrolls_no_links/.test(error.message) ? "no links in names or captions" : /source_check|link_fields/.test(error.message) ? "that link doesn't look like a TikTok or Instagram post" : error.message);
      return fromRow(data, {status:data.status, avg:0, votes:0, mine:true, myStars:0, social:KO.profile()});
    },
    async rateSong(o){
      const q = o.stars ? sb.from("song_ratings").upsert({rave:KO.rave, song_key:o.songKey, user_id:uid, act:o.act, song:o.song, stars:o.stars, updated_at:new Date().toISOString()}, {onConflict:"rave,song_key,user_id"})
                        : sb.from("song_ratings").delete().eq("rave", KO.rave).eq("song_key", o.songKey).eq("user_id", uid);
      const { error } = await q; if(error) throw new Error(error.message);
    },
    async mySongRatings(){
      if(!uid) return {};
      const { data } = await sb.from("song_ratings").select("song_key, stars").eq("user_id", uid).eq("rave", KO.rave);
      return Object.fromEntries((data || []).map(r => [r.song_key, r.stars]));
    },
    async rpc(fn, args){
      const { data, error } = await sb.rpc(fn, args || {});
      if(error) throw new Error(error.message);
      return data;
    },
    async loadProfile(){
      if(!uid){ myProfile = {tiktok:"", instagram:""}; return; }
      const { data } = await sb.from("profiles").select("tiktok, instagram").eq("user_id", uid).maybeSingle();
      myProfile = {tiktok:(data && data.tiktok) || "", instagram:(data && data.instagram) || ""};
    },
    async saveProfile(p){
      const { error } = await sb.from("profiles").upsert({user_id:uid, tiktok:p.tiktok || null, instagram:p.instagram || null, updated_at:new Date().toISOString()}, {onConflict:"user_id"});
      if(error) throw error;
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
      if(data && data.path) await sb.storage.from(CFG.bucket).remove([data.path]);
    }
  };
  const errText = t => { try{ const j = JSON.parse(t); return j.message || j.error; }catch(e){ return ""; } };
  function fromRow(x, extra){
    const source = x.source || "upload";
    return shape({id:x.id, rave:x.rave || "ko26", act:x.act, songKey:x.song_key, song:x.song, name:x.name, caption:x.caption || "", createdAt:x.created_at, source,
      url: source === "upload" && x.path ? live.url(x.path) : null, link: x.external_url || null, embedUrl: KO.embedUrl(source, x.external_id, x.external_url),
      thumb: x.thumb_url || null, handle: x.handle || "", ...extra, social: extra.social || {tiktok:"", instagram:""}});
  }

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
    // demo rows from before multi-rave have no rave: they're KO26. rave "*" lists every rave (demo groups)
    async list({act, songKey, rave} = {}){
      rave = rave || KO.rave;
      const ks = (await all("kickrolls")).filter(k => (rave === "*" || (k.rave || "ko26") === rave) && (!act || k.act === act) && (!songKey || k.songKey === songKey));
      const rs = await all("ratings");
      return ks.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(k => {
        const mine = rs.filter(r => r.kickrollId === k.id);
        const avg = mine.length ? mine.reduce((s, r) => s + r.stars, 0) / mine.length : 0;
        if(k.blob && !urls.has(k.id)) urls.set(k.id, URL.createObjectURL(k.blob));
        const source = k.source || "upload";
        return shape({id:k.id, rave:k.rave || "ko26", act:k.act, songKey:k.songKey, song:k.song, name:k.name, caption:k.caption, status:"approved", createdAt:k.createdAt, source,
          url: k.blob ? urls.get(k.id) : null, link:k.link || null, embedUrl: KO.embedUrl(source, k.externalId, k.link), thumb:k.thumb || null, handle:k.handle || "",
          social: k.mine ? KO.profile() : {tiktok:"", instagram:""}, avg, votes:mine.length, mine: !!k.mine, myStars: mine.length ? mine[0].stars : 0});
      });
    },
    async upload({file, act, songKey, song, name, caption}, onProgress){
      for(let p = 0; p <= 1; p += .25){ onProgress && onProgress(p); await new Promise(r => setTimeout(r, 60)); }
      if((await all("kickrolls")).some(x => x.mine && (x.rave || "ko26") === KO.rave && x.songKey === songKey)) throw new Error("you've already posted a kickroll to this song. delete it first to post a new one");
      const k = {id: "demo-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), rave: KO.rave, act, songKey, song, name, caption: caption || "", blob:file, createdAt:new Date().toISOString(), mine:true};
      await tx("kickrolls", "readwrite", s => s.put(k));
      return (await demo.list({songKey})).find(x => x.id === k.id);
    },
    async linkPost(o){
      const dup = (await all("kickrolls")).find(k => k.link === o.url || (o.id && k.externalId === o.id));
      if(dup) throw new Error("that post is already on the leaderboard");
      const k = {id: "demo-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), rave: KO.rave, act:o.act, songKey:o.songKey, song:o.song, name:o.name, caption:o.caption || "",
        source:o.source, link:o.url, externalId:o.id, handle:o.handle, thumb:o.thumb, createdAt:new Date().toISOString(), mine:true};
      await tx("kickrolls", "readwrite", s => s.put(k));
      return (await demo.list({songKey:o.songKey})).find(x => x.id === k.id);
    },
    async loadProfile(){ myProfile = ls.get("ko26.demoProfile", {tiktok:"", instagram:""}); },
    // demo song ratings: {"<rave>|<songKey>": {stars, act, song}}; keys without a "|" are from before multi-rave (KO26)
    async rateSong(o){ const r = ls.get("ko26.demoSongs", {}), k = KO.rave + "|" + o.songKey; if(KO.rave === "ko26") delete r[o.songKey]; if(o.stars) r[k] = {stars:o.stars, act:o.act, song:o.song}; else delete r[k]; ls.set("ko26.demoSongs", r); },
    async mySongRatings(){ return Object.fromEntries(demoSongs().filter(x => x.rave === KO.rave).map(x => [x.songKey, x.stars])); },
    // demo groups: on this device only, you're the only member
    async rpc(fn, a){
      if(fn === "ko26_song_mates"){ const r = demoSongs().find(x => x.rave === (a.rv || "ko26") && x.songKey === a.key); return r ? [{user_id:"demo-user", rave:r.rave, stars:r.stars, is_me:true, name:KO.myName() || "You"}] : []; }
      if(fn === "ko26_group_songs") return demoSongs().filter(v => !a.rv || v.rave === a.rv).map(v => ({rave:v.rave, song_key:v.songKey, act:v.act, song:v.song, avg:v.stars, n:1,
        ratings:[{user_id:"demo-user", stars:v.stars, is_me:true, name:KO.myName() || "You"}]})).sort((x, y) => y.avg - x.avg);
      const gs = ls.get("ko26.demoGroups", []); const save = () => ls.set("ko26.demoGroups", gs);
      const find = id => { const g = gs.find(x => x.id === id); if(!g) throw new Error("you are not in that group"); return g; };
      if(fn === "ko26_group_create"){ const g = {id:"demo-g-" + Date.now().toString(36), name:a.gname.trim(), invite:Math.random().toString(36).slice(2, 10).toUpperCase()}; gs.push(g); save(); return {id:g.id, name:g.name, code:g.invite}; }
      if(fn === "ko26_group_join") throw new Error("joining needs the live leaderboard (demo mode is this device only)");
      if(fn === "ko26_my_groups") return gs.map(g => ({id:g.id, name:g.name, code:g.invite, invite:g.invite, is_owner:true, members:1}));
      if(fn === "ko26_group_board"){
        const g = find(a.g), mine = (await demo.list({rave: a.rv || "*"})).filter(k => k.mine), rated = mine.filter(k => k.votes);
        const best = rated.sort((x, y) => y.score - x.score)[0];
        return {group:{id:g.id, name:g.name, invite:g.invite, is_owner:true, owner:"demo-user"}, members:[{user_id:"demo-user", is_me:true, name:KO.myName() || "You",
          tiktok:myProfile.tiktok, instagram:myProfile.instagram, posts:mine.length, avg_stars: rated.length ? rated.reduce((s, k) => s + k.avg, 0) / rated.length : null,
          votes: mine.reduce((s, k) => s + k.votes, 0), best_score: best ? best.score : null, best: best ? {id:best.id, rave:best.rave, song:best.song, song_key:best.songKey, act:best.act, avg:best.avg, votes:best.votes} : null,
          raves:[...new Set((await demo.list({rave:"*"})).filter(k => k.mine).map(k => k.rave))], ratings_given:0}]};
      }
      if(fn === "ko26_group_leave") throw new Error("you own this group: delete it instead, or it stays yours");
      if(fn === "ko26_group_admin"){
        const g = find(a.g);
        if(a.action === "delete"){ gs.splice(gs.indexOf(g), 1); save(); return {}; }
        if(a.action === "rename"){ g.name = a.new_name.trim(); save(); return {}; }
        if(a.action === "new_code"){ g.invite = Math.random().toString(36).slice(2, 10).toUpperCase(); save(); return {code:g.invite}; }
        throw new Error("only one member in demo mode");
      }
      throw new Error("unknown");
    },
    async saveProfile(p){ ls.set("ko26.demoProfile", p); },
    async rate(id, stars){ await tx("ratings", "readwrite", s => s.put({id, kickrollId:id, stars})); },
    async report(){},
    async remove(id){ await tx("kickrolls", "readwrite", s => s.delete(id)); await tx("ratings", "readwrite", s => s.delete(id)); },
    // demo accounts live on this device only, so the sign-up flow can be tried without a backend
    async signUp({email, name}){ ls.set("ko26.demoUser", {id:"demo-user", email, name}); setUser({id:"demo-user", email, user_metadata:{name}}); return {needsConfirm:false}; },
    async signIn({email}){ const u = ls.get("ko26.demoUser", null) || {email}; setUser({id:"demo-user", email:u.email || email, user_metadata:{name:u.name}}); },
    async resetPassword(){},
    async signOut(){ setUser(null); }
  };

  const demoSongs = () => Object.entries(ls.get("ko26.demoSongs", {})).map(([k, v]) => { const i = k.indexOf("|");
    return {rave: i > 0 ? k.slice(0, i) : "ko26", songKey: i > 0 ? k.slice(i + 1) : k, stars:v.stars, act:v.act, song:v.song}; });
  function shape(k){ k.score = KO.score(k.avg, k.votes); return k; }

  // ======================= accounts =======================
  let me = null; const authFns = [];
  function setUser(u){
    const was = me && me.id;
    me = u && !u.is_anonymous ? {id:u.id, email:u.email || "", name:(u.user_metadata && u.user_metadata.name) || ""} : null;
    uid = me && me.id;
    if(me && me.name && !KO.myName()) KO.setMyName(me.name);
    if((me && me.id) !== was){
      const fire = () => authFns.forEach(f => { try{ f(me); }catch(e){} });
      if(impl && impl.loadProfile) impl.loadProfile().catch(() => {}).then(fire); else fire();
    }
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
    try{ await live.init(); impl = live; KO.mode = "live"; if(me) await live.loadProfile().catch(() => {}); return {mode:"live"}; }
    catch(e){ await demo.init(); impl = demo; KO.mode = "demo"; return {mode:"demo", reason: e && e.message}; }
  })());
  const guard = () => { if(KO.closed()) throw new Error(KO.raveInfo.short + " voting and uploads closed on " + KO.deadline.toLocaleDateString()); };
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
  KO.linkPost = async o => {
    guard();
    const L = KO.parseLink(o.url);
    if(!String(o.name || "").trim()) throw new Error("add your name");
    if(/(https?:|www\.)/i.test(o.caption || "")) throw new Error("no links in captions");
    await KO.requireAccount("Make a free account to post your kickroll. It keeps the leaderboard spam-free.");
    let thumb = null;
    if(L.source === "tiktok"){
      const info = await tiktokInfo(L.url);
      if(info){ if(info.url){ L.url = info.url; L.id = info.id; L.short = false; } L.handle = info.handle || L.handle; thumb = info.thumb; }
      else if(!L.short) throw new Error("TikTok couldn't find that video. is it public?");
    }
    if(L.source === "instagram" && !L.handle) L.handle = myProfile.instagram || null;
    return impl.linkPost({...L, thumb, act:o.act, songKey:o.songKey, song:o.song, name:String(o.name).trim().slice(0, 24), caption:String(o.caption || "").trim().slice(0, 140)});
  };
  // ---- groups ----
  const grp = (fn, args) => impl.rpc(fn, args);
  KO.inviteUrl = code => location.href.replace(/[^/]*([?#].*)?$/, "") + "groups.html#join=" + encodeURIComponent(code);
  KO.myGroups = async () => { if(!me) return []; return ((await grp("ko26_my_groups")) || []).map(g => ({id:g.id, name:g.name, invite:g.invite, isOwner:!!g.is_owner, members:Number(g.members) || 1})); };
  KO.createGroup = async name => {
    name = String(name || "").trim();
    if(!name || name.length > 40) throw new Error("give the group a name (up to 40 characters)");
    if(/(https?:|www\.)/i.test(name)) throw new Error("no links in group names");
    await KO.requireAccount("Make a free account to start a group with your friends.");
    return grp("ko26_group_create", {gname:name});
  };
  KO.joinGroup = async code => {
    code = String(code || "").trim().replace(/^.*join=/, "").replace(/[^A-Za-z0-9]/g, "");
    if(code.length < 6) throw new Error("that invite code looks too short");
    await KO.requireAccount("Make a free account (or sign in) to join your friends' group.");
    return grp("ko26_group_join", {code});
  };
  KO.groupBoard = async (id, rave) => {
    const d = await grp("ko26_group_board", {g:id, rv:rave || null});
    return {group:{id:d.group.id, name:d.group.name, invite:d.group.invite, isOwner:!!d.group.is_owner},
      members:(d.members || []).map(m => ({userId:m.user_id, name:m.name || "Raver", isMe:!!m.is_me, isOwner:m.user_id === d.group.owner,
        posts:Number(m.posts) || 0, avg:m.avg_stars == null ? null : Number(m.avg_stars), votes:Number(m.votes) || 0,
        bestScore:m.best_score == null ? null : Number(m.best_score), best:m.best ? {...m.best, rave:m.best.rave || "ko26", songKey:m.best.song_key || ""} : null,
        raves:Array.isArray(m.raves) ? m.raves : [], ratingsGiven:Number(m.ratings_given) || 0,
        social:{tiktok:m.tiktok || "", instagram:m.instagram || ""}}))};
  };
  KO.leaveGroup = id => grp("ko26_group_leave", {g:id});
  KO.rateSong = async o => {
    const stars = Math.max(0, Math.min(5, Math.round(Number(o.stars) || 0)));
    await KO.requireAccount("Make a free account to rate songs and see what your group thinks.");
    return impl.rateSong({songKey:o.songKey, act:o.act, song:String(o.song || "").slice(0, 300), stars});
  };
  KO.mySongRatings = async () => me ? impl.mySongRatings() : {};
  const mates = rs => (rs || []).map(r => ({userId:r.user_id, name:r.name || "Raver", stars:Number(r.stars), isMe:!!r.is_me}));
  KO.songMates = async key => me ? mates(await grp("ko26_song_mates", {key, rv:KO.rave})) : [];
  KO.groupSongs = async (id, rave) => ((await grp("ko26_group_songs", {g:id, rv:rave || null})) || []).map(x => ({rave:x.rave || "ko26", songKey:x.song_key, act:x.act, song:x.song, avg:Number(x.avg), n:Number(x.n), ratings:mates(x.ratings)}));
  KO.groupAdmin = (id, action, o = {}) => grp("ko26_group_admin", {g:id, action, target:o.target || null, new_name:o.name || null});

  KO.saveProfile = async p => {
    await KO.requireAccount("Sign in to link your TikTok and Instagram.");
    const tiktok = cleanHandle(p.tiktok, 24), instagram = cleanHandle(p.instagram, 30);
    if(String(p.tiktok || "").trim() && !tiktok) throw new Error("that TikTok handle doesn't look right");
    if(String(p.instagram || "").trim() && !instagram) throw new Error("that Instagram handle doesn't look right");
    await impl.saveProfile({tiktok, instagram}); myProfile = {tiktok, instagram};
    return KO.profile();
  };
  KO.report = async id => { await KO.requireAccount("Sign in to report a video."); return impl.report(id); };
  KO.remove = id => impl.remove(id);
})();
