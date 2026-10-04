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
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {auth:{persistSession:true, storageKey:"ko26.auth"}});
      let { data:{ session } } = await sb.auth.getSession();
      if(!session){
        const { data, error } = await sb.auth.signInAnonymously();
        if(error) throw error;
        session = data.session;
      }
      uid = session.user.id;
    },
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
      return data.map(x => shape({id:x.id, act:x.act, songKey:x.song_key, song:x.song, name:x.name, caption:x.caption || "",
        url: live.url(x.path), createdAt:x.created_at, avg:Number(x.avg_stars), votes:x.votes, mine: x.owner === uid, myStars: mine[x.id] || 0}));
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
      if(error){ await sb.storage.from(CFG.bucket).remove([path]); throw error; }
      return shape({id:data.id, act, songKey, song, name, caption: caption || "", url: live.url(path), createdAt:data.created_at, avg:0, votes:0, mine:true, myStars:0});
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
        return shape({id:k.id, act:k.act, songKey:k.songKey, song:k.song, name:k.name, caption:k.caption, url:urls.get(k.id), createdAt:k.createdAt,
          avg, votes:mine.length, mine:false, myStars: mine.length ? mine[0].stars : 0});
      });
    },
    async upload({file, act, songKey, song, name, caption}, onProgress){
      for(let p = 0; p <= 1; p += .25){ onProgress && onProgress(p); await new Promise(r => setTimeout(r, 60)); }
      const k = {id: "demo-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), act, songKey, song, name, caption: caption || "", blob:file, createdAt:new Date().toISOString()};
      await tx("kickrolls", "readwrite", s => s.put(k));
      return (await demo.list({songKey})).find(x => x.id === k.id);
    },
    async rate(id, stars){ await tx("ratings", "readwrite", s => s.put({id, kickrollId:id, stars})); },
    async report(){},
    async remove(id){ await tx("kickrolls", "readwrite", s => s.delete(id)); await tx("ratings", "readwrite", s => s.delete(id)); }
  };

  function shape(k){ k.score = KO.score(k.avg, k.votes); return k; }

  let impl = null, readyP = null;
  KO.ready = () => readyP || (readyP = (async () => {
    await loadSets();
    try{ await live.init(); impl = live; KO.mode = "live"; return {mode:"live"}; }
    catch(e){ await demo.init(); impl = demo; KO.mode = "demo"; return {mode:"demo", reason: e && e.message}; }
  })());
  const guard = () => { if(KO.closed()) throw new Error("voting and uploads closed on " + KO.deadline.toLocaleDateString()); };
  KO.list = o => impl.list(o);
  KO.upload = (o, p) => {
    guard();
    if(!o.file || !/^video\//.test(o.file.type || "video/")) return Promise.reject(new Error("pick a video file"));
    if(o.file.size > KO.maxBytes) return Promise.reject(new Error(`that video is over ${CFG.maxUploadMB} MB. trim it or record at 1080p`));
    if(!String(o.name || "").trim()) return Promise.reject(new Error("add your name"));
    return impl.upload({...o, name:String(o.name).trim().slice(0, 24), caption:String(o.caption || "").trim().slice(0, 140)}, p);
  };
  KO.rate = (id, stars) => { guard(); return impl.rate(id, Math.max(1, Math.min(5, Math.round(stars)))); };
  KO.report = id => impl.report(id);
  KO.remove = id => impl.remove(id);
})();
