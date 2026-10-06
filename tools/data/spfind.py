"""Find Spotify IDs straight from Spotify's own search (web player's search, anonymous embed token).

For the repo's data2.json:
  * released tracks without a Spotify ID -> sp + album {id, name, type} + release_date
  * unreleased tracks (unreleased / tool / edit / mashup) that are now out under the same version -> flipped to released
  * each act's 2026 releases (singles / EPs / albums) not in the list -> added as new releases
Writes data2.json + index.html in place. Run after merge.py, before verify.py.
"""
import json, re, os, sys, time, urllib.request, urllib.parse, urllib.error
S = os.path.dirname(os.path.abspath(__file__))
REPO = "/home/user/ko26-quest-board"
CF = f"{S}/spfind_cache.json"
cache = json.load(open(CF)) if os.path.exists(CF) else {}
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36", "Accept-Language": "en"}
HASH = "21969b655b795601fb2d2204a4243188e75fdc6d3520e7b9cd3f4db2aff9591e"
NEW_FROM = "2026-04-01"
tok = {"t": None, "exp": 0}
stats = {"found": 0, "flipped": 0, "new": 0, "searched": 0}



def http(url, headers=None, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={**UA, **(headers or {})}), timeout=25) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(3 + 4 * k); continue
            if e.code == 401:
                tok["t"] = None
            return e.code, ""
        except Exception:
            time.sleep(1 + k)
    return 0, ""


def next_data(html):
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    return json.loads(m.group(1))["props"]["pageProps"]["state"] if m else None


def token():
    if tok["t"] and time.time() * 1000 < tok["exp"] - 60000:
        return tok["t"]
    st, html = http("https://open.spotify.com/embed/track/4dJrJx3SfGXHmkqwB9muhO")
    s = next_data(html)["settings"]["session"]
    tok["t"], tok["exp"] = s["accessToken"], s["accessTokenExpirationTimestampMs"]
    return tok["t"]


def search(term, limit=10):
    k = f"q:{limit}:{term}"
    if k in cache:
        return cache[k]
    v = urllib.parse.quote(json.dumps({"searchTerm": term, "offset": 0, "limit": limit, "numberOfTopResults": 5, "includeAudiobooks": False}))
    e = urllib.parse.quote(json.dumps({"persistedQuery": {"version": 1, "sha256Hash": HASH}}))
    for _ in range(2):
        st, body = http(f"https://api-partner.spotify.com/pathfinder/v1/query?operationName=searchDesktop&variables={v}&extensions={e}",
                        {"Authorization": "Bearer " + token(), "app-platform": "WebPlayer"})
        if st == 200:
            break
    stats["searched"] += 1
    time.sleep(0.15)
    if st != 200:
        return None
    d = json.loads(body)["data"]["searchV2"]
    out = {"tracks": [], "albums": [], "artists": []}
    for it in d.get("tracksV2", {}).get("items", []):
        t = it["item"]["data"]
        if t.get("__typename") != "Track":
            continue
        out["tracks"].append({"id": t["id"], "name": t["name"], "artists": [a["profile"]["name"] for a in t["artists"]["items"]],
                              "artist_uris": [a["uri"] for a in t["artists"]["items"]],
                              "album": {"id": t["albumOfTrack"]["id"], "name": t["albumOfTrack"]["name"]}, "ms": t["duration"]["totalMilliseconds"]})
    for it in d.get("albums", {}).get("items", []):
        a = it["data"]
        out["albums"].append({"id": a["uri"].split(":")[-1], "name": a["name"], "artist_uris": [x["uri"] for x in a["artists"]["items"]],
                              "year": (a.get("date") or {}).get("year")})
    for it in d.get("artists", {}).get("items", []):
        a = it["data"]
        out["artists"].append({"uri": a["uri"], "name": a["profile"]["name"]})
    cache[k] = out
    return out


def album_info(aid):
    k = "al:" + aid
    if k in cache:
        return cache[k]
    st, html = http(f"https://open.spotify.com/embed/album/{aid}")
    s = next_data(html) if st == 200 else None
    if not s:
        return None
    e = s["data"]["entity"]
    tl = e.get("trackList") or []
    out = {"name": e.get("name") or e.get("title"), "n": len(tl),
           "tracks": [{"id": t["uri"].split(":")[-1], "name": t.get("title"), "artists": t.get("subtitle", "")} for t in tl]}
    # Spotify's own rule of thumb: 1-3 tracks single, 4-6 EP, 7+ album
    out["type"] = "single" if out["n"] <= 3 else "ep" if out["n"] <= 6 else "album"
    cache[k] = out
    return out


def track_date(tid):
    k = "td:" + tid
    if k in cache:
        return cache[k]
    st, html = http(f"https://open.spotify.com/embed/track/{tid}")
    s = next_data(html) if st == 200 else None
    d = ((s or {}).get("data", {}).get("entity", {}).get("releaseDate") or {}).get("isoString", "")[:10] if s else ""
    cache[k] = d
    return d


# ---- matching (shared with verify.py) ----
import difflib, unicodedata  # noqa
def norm(t):
    t = unicodedata.normalize("NFKD", str(t)).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"\b(ft|feat|featuring|vs|x|and|the|original mix|extended mix|radio edit|extended|edit|mix|official|video|videoclip|audio|hq|hd)\b\.?", " ", t)
    return re.sub(r"[^a-z0-9]+", " ", t).strip()
def core(t): return norm(re.sub(r"\(.*?\)|\[.*?\]", " ", str(t)))
def ver_tag(t):
    m = re.findall(r"[(\[-]\s*([^)\]]*?(remix|edit|mix|rework|bootleg|vip|flip|remaster|anthem|tool)[^)\]]*)", str(t), re.I)
    return norm(m[0][0]) if m else ""


def names(artist):
    parts = re.split(r"\s*(?:&|,|\bft\.?|\bfeat\.?|\bvs\.?|\bx\b|\bpres\.?|\band\b)\s*", artist, flags=re.I)
    return [norm(p) for p in parts if norm(p)]


def match(want_artist, want_title, t, strict_version=True):
    got_title = t["name"]
    c, gc = core(want_title), core(got_title)
    if not c or not gc:
        return False
    if difflib.SequenceMatcher(None, c, gc).ratio() < 0.85 and not (set(c.split()) == set(gc.split())):
        return False
    ga = norm(" ".join(t["artists"]))
    wa = names(want_artist)
    if not any(w and w in ga for w in wa):
        return False
    vw, vg = ver_tag(want_title), ver_tag(got_title)
    strip = lambda v: {w for w in v.split() if w not in ("remix", "edit", "mix", "rework", "bootleg", "radio", "extended", "original", "pro")}
    if strip(vw) != strip(vg):
        # 'Radio Edit' / 'Extended Mix' vs plain title are the same song; a named remix/edit is not
        if strip(vw) or (strip(vg) and re.search(r"remix|bootleg|rework|vip|edit", vg) and not re.search(r"radio|extended|original|pro", vg)):
            return False
    return True


def find(it, strict=True):
    main = names(it["artist"])[0] if names(it["artist"]) else ""
    t_clean = re.sub(r"\s+", " ", re.sub(r"[()\[\]]", " ", it["title"])).strip()
    for q in (f"{it['artist']} {it['title']}", f"{main} {t_clean}", f"{main} {core(it['title'])}"):
        r = search(q)
        if not r:
            continue
        for t in r["tracks"]:
            if match(it["artist"], it["title"], t):
                return t
    return None


def set_album(it, t):
    a = album_info(t["album"]["id"])
    if a:
        it["album"] = {"id": t["album"]["id"], "name": a["name"], "type": a["type"]}
    d = track_date(t["id"])
    if d:
        it["release_date"] = d


def main():
    data = json.load(open(f"{REPO}/data2.json"))
    known_sp = {it.get("sp") for a in data["artists"].values() for it in a["released"]}
    for act, a in data["artists"].items():
        # 1. released without an ID
        for it in a["released"]:
            if it.get("sp"):
                continue
            t = find(it)
            if t:
                it["sp"] = t["id"]; it["spotify"] = f"https://open.spotify.com/track/{t['id']}"
                set_album(it, t); stats["found"] += 1; known_sp.add(t["id"])
        # 2. unreleased that are out now (only when the exact version is on Spotify)
        keep = []
        for it in a["unreleased"]:
            if it["kind"] in ("ID",) or re.match(r"^ID$", it["title"].strip(), re.I) or re.match(r"^ID$", it["artist"].strip(), re.I):
                keep.append(it); continue
            t = find(it)
            if t:
                # everything in the brackets (the edit / mashup / year) must be in the Spotify title too
                want = set(norm(" ".join(re.findall(r"\(([^)]*)\)", it["title"]))).split()) - {"official", "anthem"}
                if not want <= set(norm(t["name"]).split()) | set(norm(re.sub(r"\b(edit|mix)\b", " ", t["name"])).split()) or (want and not re.search(r"\(|-", t["name"])):
                    t = None
            if t and t["id"] not in known_sp:
                r = {k: it[k] for k in ("artist", "title", "plays", "sets")}
                r.update(sp=t["id"], spotify=f"https://open.spotify.com/track/{t['id']}", source="spotify", proof=f"https://open.spotify.com/track/{t['id']}", was="unreleased")
                set_album(r, t)
                a["released"].append(r); known_sp.add(t["id"]); stats["flipped"] += 1
            else:
                keep.append(it)
        a["unreleased"] = keep
        # 3. 2026 releases by the act
        r = search(act, 10) or {"artists": []}
        uris = [x["uri"] for x in r["artists"] if norm(x["name"]) == norm(act)]
        if not uris:
            uris = [x["uri"] for n in names(act) for x in r["artists"] if norm(x["name"]) == n][:2]
        if not uris:
            continue
        seen_titles = {core(x["title"]) for x in a["released"] + a["unreleased"]}
        albums = {}
        for q in (act, f"{act} 2026", f"{act} single", f"{act} EP"):
            for al in (search(q, 30) or {"albums": []})["albums"]:
                if al["year"] and al["year"] >= 2026 and set(al["artist_uris"]) & set(uris):
                    albums[al["id"]] = al
        for aid, al in albums.items():
            info = album_info(aid)
            if not info:
                continue
            for tr in info["tracks"][:12]:
                if tr["id"] in known_sp or core(tr["name"]) in seen_titles or re.search(r"live cut|live version|- live\b", tr["name"], re.I):
                    continue
                tr_art = re.sub(r"\s*,\s*", " & ", (tr["artists"] or "").replace("\xa0", " ")).strip(" &")
                if not any(n and n in norm(tr_art) for n in names(act)):
                    continue  # label samplers list the label's other artists too
                d = track_date(tr["id"])
                if not d or d < NEW_FROM:
                    continue
                it = {"artist": tr_art or act, "title": tr["name"], "plays": 0, "sets": [], "new": True,
                      "sp": tr["id"], "spotify": f"https://open.spotify.com/track/{tr['id']}", "source": "spotify",
                      "proof": f"https://open.spotify.com/track/{tr['id']}", "release_date": d,
                      "album": {"id": aid, "name": info["name"], "type": info["type"]}}
                a["released"].append(it); known_sp.add(tr["id"]); seen_titles.add(core(tr["name"])); stats["new"] += 1
        json.dump(cache, open(CF, "w"))
        print(act, stats, flush=True)
    json.dump(cache, open(CF, "w"))
    json.dump(data, open(f"{REPO}/data2.json", "w"), ensure_ascii=False, indent=1)
    html = open(f"{REPO}/index.html").read()
    st = html.index('<script type="application/json" id="ko-data">') + len('<script type="application/json" id="ko-data">')
    en = html.index("</script>", st)
    html = html[:st] + json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/") + html[en:]
    open(f"{REPO}/index.html", "w").write(html)
    print("done", stats)


main()
