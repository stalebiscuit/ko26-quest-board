"""Fold research results into data2.json and the ko-data block in index.html.

Sources (scratchpad):
  data2.json              original data (never modified)
  out/batch*.json         local agents: {Act: {released:[{i..}], unreleased:[{i..}], new_releases:[..]}}
  remote/r*.json          cloud sessions, same shape (i = original index)
  out/missing_sets.json, remote/m_*.json   missing acts: {Act: {note, sets, released, unreleased, new_releases}}
  remote/s*.json          extra sets: {Act: {sets:[..]}}
"""
import glob, json, re, sys, os, unicodedata

S = os.path.dirname(os.path.abspath(__file__))
REPO = "/home/user/ko26-quest-board"
SP = re.compile(r"^[A-Za-z0-9]{22}$")
YT = re.compile(r"^[\w-]{11}$")
stats = {"sp": 0, "album": 0, "yt": 0, "to_released": 0, "to_unreleased": 0, "clips": 0, "new": 0, "sets_added": 0, "missing_sets": 0}


def load(p):
    try:
        return json.load(open(p))
    except Exception as e:
        print("skip", p, e, file=sys.stderr)
        return {}


def norm(t):
    t = unicodedata.normalize("NFKD", str(t)).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"\b(ft|feat|vs|x|and|the)\b\.?", " ", t)
    return re.sub(r"[^a-z0-9]+", "", t)


def sp_ok(x):
    return isinstance(x, str) and bool(SP.match(x))


def yt_of(y):
    if isinstance(y, dict) and isinstance(y.get("id"), str) and YT.match(y["id"]):
        return {"id": y["id"], "channel": y.get("channel") or ""}
    return None


def album_of(a):
    if isinstance(a, dict) and a.get("name"):
        t = str(a.get("type") or "").lower()
        return {"id": a["id"] if sp_ok(a.get("id")) else None, "name": str(a["name"]), "type": t if t in ("single", "ep", "album", "compilation") else "single"}
    return None


def date_ok(d):
    return d if isinstance(d, str) and re.match(r"^\d{4}-\d{2}(-\d{2})?$", d) else None


def apply_spotify(it, r):
    if sp_ok(r.get("spotify_track")):
        if it.get("sp") != r["spotify_track"]:
            stats["sp"] += 1
        it["sp"] = r["spotify_track"]
        it["spotify"] = f"https://open.spotify.com/track/{it['sp']}"
    al = album_of(r.get("album"))
    if al and (sp_ok(r.get("spotify_track")) or al["id"]):
        it["album"] = al
        stats["album"] += 1
    d = date_ok(r.get("release_date"))
    if d:
        it["release_date"] = d
    y = yt_of(r.get("yt"))
    if y and not it.get("yt"):
        it["yt"] = y
        stats["yt"] += 1


def clip_of(c):
    if not isinstance(c, dict) or not c.get("url"):
        return None
    out = {"type": c.get("type") or "link", "url": str(c["url"])}
    if isinstance(c.get("yt_id"), str) and YT.match(c["yt_id"]):
        out["yt_id"] = c["yt_id"]
    if isinstance(c.get("t"), (int, float)):
        out["t"] = int(c["t"])
    return out


def merge_track_results(data, results):
    """results: list of {Act: {...}} in priority order (later wins)."""
    for res in results:
        for act, r in res.items():
            a = data["artists"].get(act)
            if not a or not isinstance(r, dict):
                continue
            orig_rel, orig_un = a["_orig_rel"], a["_orig_un"]
            for e in r.get("released") or []:
                i = e.get("i")
                if not isinstance(i, int) or i >= len(orig_rel):
                    continue
                it = orig_rel[i]
                apply_spotify(it, e)
                if e.get("status") == "unreleased" and not it.get("sp"):
                    it["_flip"] = "unreleased"
                    if e.get("note"):
                        it["_why"] = e["note"]
            for e in r.get("unreleased") or []:
                i = e.get("i")
                if not isinstance(i, int) or i >= len(orig_un):
                    continue
                it = orig_un[i]
                c = clip_of(e.get("clip"))
                if c:
                    it["clip"] = c
                if e.get("status") == "released" and sp_ok(e.get("spotify_track")):
                    apply_spotify(it, e)
                    it["_flip"] = "released"
            for n in r.get("new_releases") or []:
                a["_new"].append(n)


def new_item(n):
    it = {"artist": str(n.get("artist") or ""), "title": str(n.get("title") or ""), "plays": 0, "sets": [], "new": True}
    apply_spotify(it, n)
    if not it.get("sp") and not it.get("yt"):
        return None
    it["source"] = "spotify" if it.get("sp") else "youtube"
    it["proof"] = it.get("spotify") or f"https://www.youtube.com/watch?v={it['yt']['id']}"
    if not it.get("spotify"):
        it["spotify"] = "https://open.spotify.com/search/" + re.sub(r"\s+", "%20", f"{it['artist']} {it['title']}".strip())
    return it


def finish_act(a):
    rel, un = [], []
    for it in a["_orig_rel"]:
        if it.pop("_flip", None) == "unreleased":
            why = it.pop("_why", None)
            st = a["sets"][it["sets"][0]] if it["sets"] else None
            u = {"artist": it["artist"], "title": it["title"], "plays": it["plays"], "sets": it["sets"], "kind": "unreleased",
                 "ref": {"label": f"{st['event']} ({st['date']})", "url": st["url"]} if st else {"label": "", "url": ""}, "checked": ["spotify"]}
            un.append(u)
            stats["to_unreleased"] += 1
        else:
            rel.append(it)
    for it in a["_orig_un"]:
        if it.pop("_flip", None) == "released":
            r = {k: it[k] for k in ("artist", "title", "plays", "sets")}
            for k in ("sp", "spotify", "album", "release_date", "yt"):
                if k in it:
                    r[k] = it[k]
            r["source"] = "spotify"
            r["proof"] = r["spotify"]
            rel.append(r)
            stats["to_released"] += 1
        else:
            if it.get("clip"):
                stats["clips"] += 1
            un.append(it)
    seen = {norm(x["title"]) for x in rel + un} | {norm(x["artist"] + x["title"]) for x in rel + un}
    for n in a.pop("_new"):
        it = new_item(n)
        if not it or not it["title"]:
            continue
        k1, k2 = norm(it["title"]), norm(it["artist"] + it["title"])
        if k1 in seen or k2 in seen:
            continue
        seen |= {k1, k2}
        rel.append(it)
        stats["new"] += 1
    a["released"], a["unreleased"] = rel, un
    del a["_orig_rel"], a["_orig_un"]


def set_of(s):
    if not isinstance(s, dict) or not s.get("event"):
        return None
    out = {"event": str(s["event"]), "date": date_ok(s.get("date")) or "", "url": str(s.get("url") or "")}
    v = s.get("video")
    if isinstance(v, dict) and isinstance(v.get("id"), str) and YT.match(v["id"]):
        out["video"] = {"id": v["id"], "dur": v.get("dur") or None}
        if not out["url"]:
            out["url"] = f"https://www.youtube.com/watch?v={v['id']}"
    tr = [[str(t[0]), str(t[1])] for t in (s.get("tracks") or []) if isinstance(t, list) and len(t) >= 2 and t[1]]
    out["tracks"] = tr
    cues = s.get("cues")
    if isinstance(cues, list) and len(cues) == len(tr) and any(isinstance(c, (int, float)) for c in cues):
        out["cues"] = [int(c) if isinstance(c, (int, float)) else None for c in cues]
    if s.get("partial"):
        out["partial"] = True
    if s.get("date_guess"):
        out["date_guess"] = True
    if not out["date"] or not (out.get("video") or out["url"]):
        return None
    return out


def add_extra_sets(a, sets):
    have_v = {s["video"]["id"] for s in a["sets"] if s.get("video")}
    have_u = {s["url"] for s in a["sets"] if s.get("url")}
    have_ed = {(s["date"], norm(s["event"])[:20]) for s in a["sets"]}
    for s in sets:
        st = set_of(s)
        if not st:
            continue
        if (st.get("video") and st["video"]["id"] in have_v) or st["url"] in have_u or (st["date"], norm(st["event"])[:20]) in have_ed:
            continue
        if st["date"] < "2025-01-01" or re.search(r"vlog|interview|\babout\b|q ?& ?a|documentary|podcast talk|reaction|cigarny|maura weaver", st["event"], re.I):
            continue
        st["extra"] = True
        a["sets"].append(st)
        stats["sets_added"] += 1
        if st.get("video"):
            have_v.add(st["video"]["id"])
        have_u.add(st["url"])
        have_ed.add((st["date"], norm(st["event"])[:20]))


def build_missing(a, m):
    """Missing acts: sets + track lists from scratch."""
    sets = [x for x in (set_of(s) for s in (m.get("sets") or [])) if x]
    if not sets and not m.get("released") and not m.get("new_releases"):
        return
    a["sets"] = sets
    stats["missing_sets"] += len(sets)
    if m.get("note"):
        a["note"] = str(m["note"])
    nsets = len(sets)
    rel, un, seen = [], [], set()
    def idx(x):
        return [i for i in (x.get("sets") or []) if isinstance(i, int) and 0 <= i < nsets]
    for r in m.get("released") or []:
        if not r.get("title") or norm(r["artist"] + r["title"]) in seen:
            continue
        it = {"artist": str(r.get("artist") or ""), "title": str(r["title"]), "plays": len(idx(r)), "sets": idx(r)}
        apply_spotify(it, r)
        if not it.get("sp") and not it.get("yt"):
            it["spotify"] = "https://open.spotify.com/search/" + re.sub(r"\s+", "%20", f"{it['artist']} {it['title']}")
        it["source"] = "spotify" if it.get("sp") else ("youtube" if it.get("yt") else "spotify")
        it["proof"] = it.get("sp") and it["spotify"] or (it.get("yt") and f"https://www.youtube.com/watch?v={it['yt']['id']}") or str(r.get("evidence") or "")
        if not it["sets"] and (it.get("release_date") or "") >= "2026-04-01":
            it["new"] = True
        seen.add(norm(it["artist"] + it["title"]))
        rel.append(it)
    for u in m.get("unreleased") or []:
        if not u.get("title"):
            continue
        si = idx(u)
        st = sets[si[0]] if si else (sets[0] if sets else None)
        it = {"artist": str(u.get("artist") or ""), "title": str(u["title"]), "plays": len(si), "sets": si,
              "kind": u.get("kind") if u.get("kind") in ("ID", "unreleased", "edit", "mashup", "tool") else "unreleased",
              "ref": {"label": f"{st['event']} ({st['date']})", "url": st["url"]} if st else {"label": "", "url": ""}, "checked": []}
        c = clip_of(u.get("clip"))
        if c:
            it["clip"] = c
            stats["clips"] += 1
        un.append(it)
    a["released"], a["unreleased"] = rel, un
    a["_new"] = list(m.get("new_releases") or [])
    a["_orig_rel"], a["_orig_un"] = [], []


def main():
    data = json.load(open(f"{S}/data2.json"))
    for a in data["artists"].values():
        a["_orig_rel"], a["_orig_un"], a["_new"] = list(a["released"]), list(a["unreleased"]), []
    # missing acts first (they replace the empty lists); remote beats local
    missing = load(f"{S}/out/missing_sets.json")
    for p in sorted(glob.glob(f"{S}/remote/m_*.json")):
        for k, v in load(p).items():
            if v.get("sets"):
                missing[k] = v
    for act, m in missing.items():
        if act in data["artists"] and isinstance(m, dict):
            build_missing(data["artists"][act], m)
    local = [load(p) for p in sorted(glob.glob(f"{S}/out/batch*.json"))]
    remote = [load(p) for p in sorted(glob.glob(f"{S}/remote/r*.json"))]
    merge_track_results(data, local + remote)
    for a in data["artists"].values():
        finish_act(a)
    for p in sorted(glob.glob(f"{S}/remote/s*.json")):
        for act, v in load(p).items():
            if act in data["artists"] and isinstance(v, dict):
                add_extra_sets(data["artists"][act], v.get("sets") or [])
    out = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    json.dump(data, open(f"{REPO}/data2.json", "w"), ensure_ascii=False, indent=1)
    html = open(f"{REPO}/index.html").read()
    a = html.index('<script type="application/json" id="ko-data">') + len('<script type="application/json" id="ko-data">')
    b = html.index("</script>", a)
    html = html[:a] + out.replace("</", "<\\/") + html[b:]
    open(f"{REPO}/index.html", "w").write(html)
    tot_rel = sum(len(a["released"]) for a in data["artists"].values())
    with_sp = sum(1 for a in data["artists"].values() for it in a["released"] if it.get("sp"))
    with_yt = sum(1 for a in data["artists"].values() for it in a["released"] if it.get("yt"))
    playable = sum(1 for a in data["artists"].values() for it in a["released"] if it.get("sp") or it.get("yt"))
    print(json.dumps(stats), f"released={tot_rel} with_spotify={with_sp} with_yt={with_yt} playable_in_app={playable}")


main()
