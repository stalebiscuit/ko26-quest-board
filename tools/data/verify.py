"""Check every Spotify track ID and YouTube video ID in the repo's data2.json against the real services,
fill release info (single / EP / album) from Deezer, drop links that don't match, and rewrite data2.json + index.html.

Spotify: open.spotify.com/embed/track/<id> (name, artists, release date)
YouTube: youtube.com/oembed (exists + embeddable, title)
Deezer:  api.deezer.com search + album (record_type, release date) for grouping
"""
import json, re, sys, os, time, difflib, unicodedata, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

S = os.path.dirname(os.path.abspath(__file__))
REPO = "/home/user/ko26-quest-board"
CACHE_F = f"{S}/verify_cache.json"
cache = json.load(open(CACHE_F)) if os.path.exists(CACHE_F) else {}
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36", "Accept-Language": "en"}


def get(url, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
                return r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2 + 3 * k)
                continue
            return e.code, ""
        except Exception:
            time.sleep(1 + k)
    return 0, ""


def norm(t):
    t = unicodedata.normalize("NFKD", str(t)).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"\b(ft|feat|featuring|vs|x|and|the|original mix|extended mix|radio edit|extended|edit|mix|official|video|videoclip|audio|hq|hd)\b\.?", " ", t)
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def core(t):
    return norm(re.sub(r"\(.*?\)|\[.*?\]", " ", str(t)))


def ver_tag(t):
    """the version marker in brackets, e.g. 'dimitri k remix'"""
    m = re.findall(r"\(([^)]*?(remix|edit|mix|rework|bootleg|vip|flip|remaster)[^)]*)\)", str(t), re.I)
    return norm(m[0][0]) if m else ""


def title_ok(want_title, want_artist, got_title, got_artists):
    g = norm(got_title + " " + " ".join(got_artists))
    c = core(want_title)
    if not c:
        return False
    cw = set(c.split())
    gw = set(g.split())
    hit = len(cw & gw) / max(1, len(cw))
    ratio = difflib.SequenceMatcher(None, c, core(got_title)).ratio()
    ok = hit >= 0.75 or ratio >= 0.8
    vt = ver_tag(want_title)
    if ok and vt:
        vtw = [w for w in vt.split() if w not in ("remix", "edit", "mix", "rework", "bootleg")]
        if vtw and not all(w in gw for w in vtw):
            return False  # wrong version (e.g. original instead of the remix)
    if ok and not vt and ver_tag(got_title) and re.search(r"remix|bootleg|rework", ver_tag(got_title)):
        # want the original, got someone's remix
        return False
    return ok


def sp_info(tid):
    k = "sp:" + tid
    if k in cache:
        return cache[k]
    st, html = get(f"https://open.spotify.com/embed/track/{tid}")
    out = {"status": st}
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if st == 200 and m:
        try:
            e = json.loads(m.group(1))["props"]["pageProps"]["state"]["data"]["entity"]
            out.update(name=e.get("name") or e.get("title"), artists=[a["name"] for a in e.get("artists", [])],
                       date=(e.get("releaseDate") or {}).get("isoString", "")[:10], dur=e.get("duration"))
        except Exception:
            out["status"] = -1
    if st in (200, 404, 400) or out.get("name"):
        cache[k] = out
    return out


def yt_info(vid):
    k = "yt:" + vid
    if k in cache:
        return cache[k]
    st, body = get("https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(f"https://www.youtube.com/watch?v={vid}"))
    out = {"status": st}
    if st == 200:
        try:
            j = json.loads(body)
            out.update(title=j.get("title"), author=j.get("author_name"))
        except Exception:
            pass
    if st in (200, 401, 403, 404, 400):
        cache[k] = out
    return out


def dz_album(artist, title):
    q = re.sub(r" (ft|feat|vs|x)\.? .*$", "", artist, flags=re.I) + " " + re.sub(r"[()]", " ", title)
    k = "dz:" + q
    if k in cache:
        return cache[k]
    st, body = get("https://api.deezer.com/search?limit=5&q=" + urllib.parse.quote(q))
    out = None
    if st == 200:
        try:
            for t in json.loads(body).get("data", []):
                if title_ok(title, artist, t["title"] + (" (" + t["title_version"] + ")" if t.get("title_version") else ""), [t["artist"]["name"]]):
                    ast, ab = get(f"https://api.deezer.com/album/{t['album']['id']}")
                    a = json.loads(ab) if ast == 200 else {}
                    name = a.get("title") or t["album"]["title"]
                    # skip compilations, DJ mixes and best-ofs: we want the release the track came out on
                    if re.search(r"various", (a.get("artist") or {}).get("name", ""), re.I) or a.get("record_type") == "compile" \
                            or re.search(r"mixed by|compilation|best of|greatest|hits|tunes|volume|vol\.|\bmix\b|qontinent|qlimax|defqon|20\d\d$", name, re.I) and (a.get("nb_tracks") or 0) > 6:
                        continue
                    out = {"name": name, "type": a.get("record_type") or "single",
                           "date": a.get("release_date"), "dz": t["album"]["id"], "n": a.get("nb_tracks")}
                    break
        except Exception:
            out = None
        cache[k] = out
    return out


def main():
    data = json.load(open(f"{REPO}/data2.json"))
    items = [(act, it) for act, a in data["artists"].items() for it in a["released"]]
    sp_ids = {it["sp"] for _, it in items if it.get("sp")}
    yt_ids = {it["yt"]["id"] for _, it in items if it.get("yt")}
    for a in data["artists"].values():
        for it in a["unreleased"]:
            if it.get("clip", {}).get("yt_id"):
                yt_ids.add(it["clip"]["yt_id"])
        for s in a["sets"]:
            if s.get("video"):
                yt_ids.add(s["video"]["id"])
    with ThreadPoolExecutor(6) as ex:
        list(ex.map(sp_info, sorted(sp_ids)))
        list(ex.map(yt_info, sorted(yt_ids)))
        list(ex.map(lambda p: dz_album(p[1]["artist"], p[1]["title"]), [p for p in items if not p[1].get("album")]))
    json.dump(cache, open(CACHE_F, "w"))
    rep = {"sp_ok": 0, "sp_bad": [], "sp_dead": [], "yt_ok": 0, "yt_noembed": [], "yt_dead": [], "yt_mismatch": [], "album_dz": 0, "clip_dead": [], "set_dead": []}
    for act, it in items:
        k = f"{it['artist']} - {it['title']}"
        if it.get("sp"):
            i = sp_info(it["sp"])
            if i.get("status") in (404, 400):
                rep["sp_dead"].append(k); it.pop("sp"); it["spotify"] = "https://open.spotify.com/search/" + urllib.parse.quote(k)
            elif i.get("name"):
                if title_ok(it["title"], it["artist"], i["name"], i["artists"]):
                    rep["sp_ok"] += 1
                    it["sp_title"] = f"{', '.join(i['artists'])} - {i['name']}"
                    if i.get("date") and not it.get("release_date"):
                        it["release_date"] = i["date"]
                else:
                    rep["sp_bad"].append(f"{k}  !=  {', '.join(i['artists'])} - {i['name']}")
                    it.pop("sp"); it.pop("album", None) if not (it.get("album") or {}).get("dz") else None
                    it["spotify"] = "https://open.spotify.com/search/" + urllib.parse.quote(k)
        if it.get("yt"):
            i = yt_info(it["yt"]["id"])
            if i.get("status") in (401, 403):
                rep["yt_noembed"].append(k); it.pop("yt")
            elif i.get("status") in (404, 400):
                rep["yt_dead"].append(k); it.pop("yt")
            elif i.get("title"):
                if title_ok(it["title"], it["artist"], i["title"], [i.get("author") or ""]):
                    rep["yt_ok"] += 1
                    if not it["yt"].get("channel"):
                        it["yt"]["channel"] = i.get("author") or ""
                else:
                    rep["yt_mismatch"].append(f"{k}  !=  {i['title']} [{i.get('author')}]")
                    it.pop("yt")
        if not it.get("album"):
            d = dz_album(it["artist"], it["title"])
            if d:
                it["album"] = {"id": None, "name": d["name"], "type": d["type"] if d["type"] in ("single", "ep", "album", "compilation") else "single"}
                if d.get("date") and not it.get("release_date"):
                    it["release_date"] = d["date"]
                rep["album_dz"] += 1
        if it.get("source") == "youtube" and not it.get("yt") and it.get("proof", "").find("youtu") >= 0 and not it.get("sp"):
            pass
    for act, a in data["artists"].items():
        for it in a["unreleased"]:
            c = it.get("clip")
            if c and c.get("yt_id"):
                i = yt_info(c["yt_id"])
                if i.get("status") in (401, 403, 404, 400):
                    rep["clip_dead"].append(f"{it['artist']} - {it['title']}")
                    c.pop("yt_id")
                    if i["status"] in (404, 400):
                        it.pop("clip")
        for s in a["sets"]:
            v = s.get("video")
            if v:
                i = yt_info(v["id"])
                if i.get("status") in (401, 403, 404, 400):
                    rep["set_dead"].append(f"{act}: {s['event']} ({i['status']})")
                    s.pop("video")
                    if s.get("extra") and not s.get("tracks"):
                        s["_drop"] = True
        a["sets"] = [s for s in a["sets"] if not s.get("_drop")]
    json.dump(data, open(f"{REPO}/data2.json", "w"), ensure_ascii=False, indent=1)
    html = open(f"{REPO}/index.html").read()
    st = html.index('<script type="application/json" id="ko-data">') + len('<script type="application/json" id="ko-data">')
    en = html.index("</script>", st)
    html = html[:st] + json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/") + html[en:]
    open(f"{REPO}/index.html", "w").write(html)
    json.dump(rep, open(f"{S}/verify_report.json", "w"), indent=1)
    rel = [it for _, it in items]
    print({k: (len(v) if isinstance(v, list) else v) for k, v in rep.items()},
          f"released={len(rel)} sp={sum(1 for x in rel if x.get('sp'))} yt={sum(1 for x in rel if x.get('yt'))} playable={sum(1 for x in rel if x.get('sp') or x.get('yt'))} album={sum(1 for x in rel if x.get('album'))}")


main()
