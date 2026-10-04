#!/usr/bin/env python3
"""Automatic kickroll review helper, used by the scheduled Claude reviewer (see tools/REVIEWER.md).

  python3 tools/moderate.py fetch            sign in as the moderator, download every pending kickroll (and recently
                                             reported ones), write a 6-frame contact sheet per video, print JSON
  python3 tools/moderate.py decide ID approve|reject "short reason"

Needs environment variables KO26_MOD_EMAIL and KO26_MOD_PASSWORD (an account listed in public.admins), set in the
cloud environment's settings. Supabase URL and anon key come from ko-config.js. Needs ffmpeg + ffprobe.
"""
import json, os, re, subprocess, sys, tempfile, urllib.request, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(tempfile.gettempdir(), "ko26-review")
cfg = open(os.path.join(ROOT, "ko-config.js")).read()
URL = re.search(r'supabaseUrl:\s*"([^"]+)"', cfg).group(1)
KEY = re.search(r'supabaseAnonKey:\s*"([^"]+)"', cfg).group(1)
BUCKET = (re.search(r'bucket:\s*"([^"]+)"', cfg) or [None, "kickrolls"])[1]


def call(method, path, body=None, token=None, raw=False):
    h = {"apikey": KEY, "Content-Type": "application/json", "Authorization": "Bearer " + (token or KEY)}
    req = urllib.request.Request(URL + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            return data if raw else (json.loads(data) if data else None)
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} failed: {e.code} {e.read().decode()[:300]}")


def login():
    email, pw = os.environ.get("KO26_MOD_EMAIL"), os.environ.get("KO26_MOD_PASSWORD")
    if not email or not pw:
        sys.exit("KO26_MOD_EMAIL / KO26_MOD_PASSWORD are not set in this environment")
    return call("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": pw})["access_token"]


def sheet(video, out_jpg):
    """6 evenly spaced frames tiled 3x2 into one image."""
    try:
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video],
                                   capture_output=True, text=True, timeout=60).stdout.strip() or 0)
    except Exception:
        dur = 0
    if dur <= 0:
        return None, 0
    fps = 6 / dur
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-vf", f"fps={fps:.5f},scale=360:-2,tile=3x2", "-frames:v", "1", "-q:v", "4", out_jpg],
                       capture_output=True, text=True, timeout=180)
    return (out_jpg if r.returncode == 0 and os.path.exists(out_jpg) else None), dur


def fetch():
    tok = login()
    os.makedirs(OUT, exist_ok=True)
    pending = call("GET", "/rest/v1/kickrolls?status=eq.pending&order=created_at.asc&limit=25&select=*", token=tok)
    reported = call("GET", "/rest/v1/reports?select=kickroll_id", token=tok) or []
    counts = {}
    for r in reported:
        counts[r["kickroll_id"]] = counts.get(r["kickroll_id"], 0) + 1
    flagged = []
    if counts:
        ids = ",".join(counts)
        flagged = call("GET", f"/rest/v1/kickrolls?id=in.({ids})&status=eq.approved&reviewed_at=is.null&select=*", token=tok) or []
    items = []
    for k, why in [(k, "pending") for k in pending] + [(k, f"reported x{counts[k['id']]}") for k in flagged]:
        url = f"{URL}/storage/v1/object/public/{BUCKET}/" + "/".join(urllib.parse.quote(p) for p in k["path"].split("/"))
        vid = os.path.join(OUT, k["id"] + os.path.splitext(k["path"])[1])
        try:
            urllib.request.urlretrieve(url, vid)
            img, dur = sheet(vid, os.path.join(OUT, k["id"] + ".jpg"))
        except Exception as e:
            img, dur = None, 0
        items.append({"id": k["id"], "why": why, "name": k["name"], "caption": k.get("caption"), "act": k["act"], "song": k["song"],
                      "created_at": k["created_at"], "seconds": round(dur, 1), "size_mb": round(k["size_bytes"] / 1048576, 1),
                      "contact_sheet": img, "video": url})
    print(json.dumps(items, indent=1))


def decide(kid, verdict, note):
    tok = login()
    if verdict not in ("approve", "reject"):
        sys.exit("verdict must be approve or reject")
    call("POST", "/rest/v1/rpc/ko26_moderate", {"kickroll": kid, "approve": verdict == "approve", "note": ("auto: " + note)[:200]}, token=tok)
    print(f"{verdict}d {kid}")


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "fetch":
        fetch()
    elif len(sys.argv) >= 4 and sys.argv[1] == "decide":
        decide(sys.argv[2], sys.argv[3], " ".join(sys.argv[4:]) or "")
    else:
        sys.exit(__doc__)
