"""Find each act's 2025-2026 set recordings on YouTube (search, 20+ min videos), read the upload date and any
timestamped tracklist from the description, and write remote/s_yt.json in the extra-sets shape merge.py reads."""
import json, re, os, time, urllib.request, urllib.parse, urllib.error, unicodedata, datetime
from concurrent.futures import ThreadPoolExecutor

S = os.path.dirname(os.path.abspath(__file__))
CF = f"{S}/ytsets_cache.json"
cache = json.load(open(CF)) if os.path.exists(CF) else {}
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36", "Accept-Language": "en", "Cookie": "CONSENT=YES+1; SOCS=CAI"}
LONG = "EgIYAg%3D%3D"  # filter: over 20 minutes
MAX_PER_ACT = 8

ACTS = {  # act -> (title must contain one of these name forms, extra search terms)
    "Suae": (["suae"], []), "Weaver": (["weaver"], ["weaver hardstyle"]), "Hixxy": (["hixxy"], []),
    "Sickmode": (["sickmode"], []), "Rebelion": (["rebelion"], []), "TNT": (["tnt", "technoboy n tuneboy", "technoboy tuneboy"], ["TNT technoboy tuneboy live"]),
    "Da Tweekaz": (["da tweekaz"], []), "Ran-D": (["ran d"], []), "Headhunterz": (["headhunterz"], []),
    "D-Block & S-te-Fan": (["d block s te fan", "d block ste fan"], ["D-Block & S-te-Fan live"]), "Dimitri K": (["dimitri k"], []),
    "Aversion": (["aversion"], ["aversion hardcore"]), "Kruelty": (["kruelty"], []), "Dual Damage": (["dual damage"], []),
    "Big K": (["big k"], ["BIG K hardcore"]), "Radical Redemption": (["radical redemption"], []), "Warface": (["warface"], []),
    "Lekkerfaces": (["lekkerfaces"], []), "Toza": (["toza"], ["TOZA hardstyle"]), "The Straikerz": (["straikerz"], []),
    "Noisemakers": (["noisemakers"], ["Noisemakers Sickmode Krowdexx"]), "Slaughterhouse": (["slaughterhouse"], ["Slaughterhouse hardcore uptempo"]),
    "Greazy Texas Fuckerz": (["greazy texas", "gtf"], ["Greazy Texas Fuckerz"]), "Technikore & JTS": (["technikore"], []),
    "Frontliner": (["frontliner"], []), "Wildstylez": (["wildstylez"], []), "Gammer": (["gammer"], []),
    "Tha Playah": (["tha playah"], []), "Satirized": (["satirized"], []), "Yoshiko": (["yoshiko"], ["Yoshiko hardcore"]),
    "Major Conspiracy": (["major conspiracy"], []), "Noxiouz": (["noxiouz"], []), "The Dope Doctor": (["dope doctor"], []),
    "Da Mouth of Madness": (["mouth of madness", "dr peacock"], ["Dr. Peacock live set 2026", "Dr. Peacock live set 2025"]),
}
SKIP = re.compile(r"tribute(?! to dr)|megamix|top \d+|best of|full album|playlist|compilation|mixtape vol|reaction|interview|aftermovie|trailer|hate5six|lyrics", re.I)
SETWORD = re.compile(r"@|\blive\b|\bset\b|liveset|full set|dj set|\bb2b\b|\bb3b\b|\bvs\.?\b|festival|closing|warm ?up|stage|mainstage|area|edition|\bmix\b|radio|podcast|\d{4}", re.I)


def get(url, tries=3):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=25) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(4 + 5 * k); continue
            return ""
        except Exception:
            time.sleep(1 + k)
    return ""


def init_data(html):
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", html, re.S)
    return json.loads(m.group(1)) if m else {}


def norm(t):
    t = unicodedata.normalize("NFKD", str(t)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def search(q):
    k = "s:" + q
    if k in cache:
        return cache[k]
    d = init_data(get(f"https://www.youtube.com/results?search_query={urllib.parse.quote(q)}&sp={LONG}"))
    out = []
    def walk(o):
        if isinstance(o, dict):
            if "videoRenderer" in o:
                v = o["videoRenderer"]
                out.append({"id": v["videoId"], "title": "".join(r.get("text", "") for r in v["title"]["runs"]),
                            "len": (v.get("lengthText") or {}).get("simpleText"),
                            "ago": (v.get("publishedTimeText") or {}).get("simpleText", ""),
                            "owner": "".join(r.get("text", "") for r in (v.get("ownerText") or {}).get("runs", []))})
            for x in o.values():
                walk(x)
        elif isinstance(o, list):
            for x in o:
                walk(x)
    walk(d)
    if out:
        cache[k] = out
    time.sleep(0.7)
    return out


def parse_date(s):
    s = re.sub(r"^(Premiered|Streamed live on|Streamed live|Started streaming on)\s*", "", s or "").strip()
    for f in ("%b %d, %Y", "%d %b %Y", "%B %d, %Y"):
        try:
            return datetime.datetime.strptime(s, f).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return ""


TS = re.compile(r"^\s*[\[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*[-–—|.:]?\s*(.+?)\s*$")


def tracklist(desc):
    tracks, cues = [], []
    for line in (desc or "").splitlines():
        m = TS.match(line)
        if not m:
            continue
        txt = re.sub(r"^\d{1,3}[.)]\s*", "", m.group(2)).strip(" -–")
        if len(txt) < 3 or not re.search(r"[A-Za-z]", txt):
            continue
        p = [int(x) for x in m.group(1).split(":")]
        sec = p[0] * 3600 + p[1] * 60 + p[2] if len(p) == 3 else p[0] * 60 + p[1]
        if cues and sec < cues[-1]:
            continue
        tracks.append([f"{len(tracks) + 1:02d}", txt.replace(" – ", " - ").replace(" — ", " - ")]); cues.append(sec)
    return (tracks, cues) if len(tracks) >= 4 else ([], [])


def video(vid):
    k = "v:" + vid
    if k in cache:
        return cache[k]
    d = init_data(get(f"https://www.youtube.com/watch?v={vid}"))
    t = json.dumps(d)
    m = re.search(r'"dateText": \{"simpleText": "([^"]+)"', t)
    date = parse_date(m.group(1)) if m else ""
    desc = ""
    m = re.search(r'"attributedDescription": \{"content": ("(?:[^"\\]|\\.)*")', t)
    if m:
        desc = json.loads(m.group(1))
    tr, cues = tracklist(desc)
    out = {"date": date, "tracks": tr, "cues": cues}
    if date:  # a blocked / throttled page has no date: don't remember it, fall back to the search result's age
        cache[k] = out
    return out


def from_ago(ago):
    m = re.search(r"(\d+)\s*(second|sec|s|minute|min|hour|h|day|d|week|w|month|mo|year|y)", ago or "", re.I)
    if not m:
        return ""
    n, u = int(m.group(1)), m.group(2).lower()
    days = {"y": 365, "year": 365, "mo": 30, "month": 30, "w": 7, "week": 7, "d": 1, "day": 1}.get(u, 0) * n
    return (datetime.date(2026, 10, 2) - datetime.timedelta(days=days)).isoformat()


AMBIG = {"Weaver", "TNT", "Toza", "Gammer", "Aversion", "Yoshiko", "Slaughterhouse", "Big K", "Suae", "Warface", "Satirized",
         "Noisemakers", "Major Conspiracy", "Rebelion", "Frontliner", "Noxiouz", "Kruelty"}
CTX = re.compile(r"hsu|harder|hardstyle|hardcore|hard ?techno|hard dance|q-?dance|defqon|qlimax|rebirth|intents|dominator|thunderdome|masters of hardcore|"
                 r"verknipt|knockout|htid|reverze|decibel|bkjn|get wrecked|midnight mafia|norplaser|uptempo|frenchcore|rawstyle|gabber|xxlerator|supremacy|"
                 r"hard bass|loudness|dynamite|parookaville|tomorrowland|mysteryland|sefa|spoontech|art of dance|b2s|scantraxx|roughstate|dirty workz|"
                 r"wildstylez|headhunterz|sickmode|rooler|hive festival|fury|tegendraads|nacht wacht|hardbeats|elektrum|toffler|awakenings|ravage|"
                 r"aggressive records|lmtlss|darren styles|tweekaz|harmony of hardcore|ground zero|euphoric|hardshock|psy|anthem|mainstage|festival", re.I)


BLOCKED = {"watch": False, "fails": 0}


def mins(l):
    p = [int(x) for x in (l or "0").split(":") if x.isdigit()]
    return (p[0] * 60 + p[1] + p[2] / 60) if len(p) == 3 else (p[0] + p[1] / 60) if len(p) == 2 else 0


def act_sets(act):
    forms, extra = ACTS[act]
    qs = [f"{act} full set", f"{act} live set 2026", f"{act} live 2025", f"{act} @ festival"] + extra
    cands = {}
    for q in qs:
        for v in search(q):
            nt = " " + norm(v["title"]) + " "
            if v["id"] in cands or SKIP.search(v["title"]) or not any(f" {f} " in nt for f in forms):
                continue
            if not SETWORD.search(v["title"]) or not (20 <= mins(v["len"]) <= 300):
                continue
            if act in AMBIG and not CTX.search(v["title"] + " " + v["owner"]):
                continue
            yrs = [int(y) for y in re.findall(r"\b(?:19|20)\d\d\b", v["title"])]
            if yrs and max(yrs) < 2025:
                continue
            cands[v["id"]] = v
    out = []
    for vid, v in cands.items():
        info = video(vid) if not BLOCKED["watch"] else {"date": "", "tracks": [], "cues": []}
        if not info["date"]:
            BLOCKED["fails"] += 1
            if BLOCKED["fails"] >= 5:
                BLOCKED["watch"] = True
        date, guess = info["date"], False
        if not date:
            date, guess = from_ago(v.get("ago")), True
        if not date or date < "2025-01-01":
            continue
        out.append({"event": v["title"], "date": date, "date_guess": guess, "url": f"https://www.youtube.com/watch?v={vid}",
                    "video": {"id": vid, "dur": v["len"]}, "tracks": info["tracks"], "cues": info["cues"] or None,
                    "partial": False, "channel": v["owner"]})
    out.sort(key=lambda s: s["date"], reverse=True)
    return act, out[:MAX_PER_ACT]


def main():
    res = {}
    with ThreadPoolExecutor(2) as ex:
        for act, sets in ex.map(act_sets, list(ACTS)):
            res[act] = {"sets": sets}
            print(f"{act}: {len(sets)} sets, {sum(1 for s in sets if s['tracks'])} with tracklists", flush=True)
            json.dump(cache, open(CF, "w"))
    os.makedirs(f"{S}/remote", exist_ok=True)
    json.dump(res, open(f"{S}/remote/s_yt.json", "w"), ensure_ascii=False, indent=1)


main()
