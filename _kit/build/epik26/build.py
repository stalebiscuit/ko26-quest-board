#!/usr/bin/env python3
"""Build site/epik26/index.html: template.html + emblems + data (lineup.json + artists.json).
Run: python3 -I build.py   (from anywhere)"""
import json, os, re
H = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(H, '..', '..'))
SITE = os.path.abspath(os.path.join(ROOT, '..'))  # repo root = the served site; ROOT = _kit
tpl = open(os.path.join(H, 'template.html')).read()
lineup = json.load(open(os.path.join(H, 'lineup.json')))
artists = json.load(open(os.path.join(H, 'artists.json')))
names = [s['artist'] for s in lineup['slots']]
# verified/<Act>.json (KO26 artist shape: sets/released/unreleased with sp, yt, video, cues, clip ...) replaces
# that act's artists.json entry when present. EPIK26_VERIFIED=<dir> points at another folder (test fixtures).
VER = os.environ.get('EPIK26_VERIFIED') or os.path.join(H, 'verified')
slug = lambda n: re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', n.lower()))
src = {}
def load_act(n):
    for fn in (n + '.json', slug(n) + '.json'):
        p = os.path.join(VER, fn)
        if not os.path.isfile(p):
            continue
        try:
            a = json.load(open(p))
            if isinstance(a, dict) and isinstance(a.get('artists'), dict) and n in a['artists']:
                a = a['artists'][n]  # tolerate {"artists": {Act: {...}}}
            assert isinstance(a, dict) and all(isinstance(a.get(k, []), list) for k in ('sets', 'released', 'unreleased'))
            src[n] = p if os.environ.get('EPIK26_VERIFIED') else 'verified/' + fn
            return a
        except Exception as e:
            print(f'  WARNING: {p} unreadable ({e}); using artists.json for {n}')
            break
    if n in artists:
        src[n] = 'artists.json'
        return artists[n]
    return None
data = {**lineup, 'artists': {n: a for n in names for a in [load_act(n)] if a is not None}}
# emblems: new EPIK set + reused KO26 symbols + the ones drawn for this edition
def syms(path):
    return dict(re.findall(r'(?s)(?<=<symbol id="em-)([a-z0-9-]+)(".*?</symbol>)', open(path).read()))
pool = {}
pool.update(syms(os.path.join(ROOT, 'ref', 'symbols_ko.svgfrag')))
pool.update(syms(os.path.join(ROOT, 'ref', 'symbols_epik.svgfrag')))
pool.update(syms(os.path.join(H, 'symbols_new.svgfrag')))
missing = [n for n in names if slug(n) not in pool]
em = '\n'.join(f'<symbol id="em-{slug(n)}{pool[slug(n)]}' for n in names if slug(n) in pool)
js = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
assert tpl.count('<!--EMBLEMS-->') == 1 and tpl.count('/*DATA*/') == 1
out = tpl.replace('<!--EMBLEMS-->', em).replace('/*DATA*/', js)
dst = os.path.join(SITE, 'epik26', 'index.html')
open(dst, 'w').write(out)
json.loads(re.search(r'(?s)<script type="application/json" id="ko-data">(.*?)</script>', out).group(1))
print('wrote', dst, len(out), 'bytes; emblems missing for:', missing or 'none')
for n in names:
    a = data['artists'].get(n)
    if not a:
        print(f"  {n:15s} NO DATA"); continue
    rel = a.get('released', []); sets = a.get('sets', [])
    print(f"  {n:15s} sets {len(sets)} (video {sum(1 for x in sets if x.get('video'))}) rel {len(rel)} (sp {sum(1 for x in rel if x.get('sp'))}, yt {sum(1 for x in rel if x.get('yt'))})"
          f" unrel {len(a.get('unreleased', []))} (clip {sum(1 for x in a.get('unreleased', []) if x.get('clip'))}) unk {a.get('unknown_ids', 0)}  <- {src[n]}")
