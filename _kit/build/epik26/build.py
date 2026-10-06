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
data = {**lineup, 'artists': {n: artists[n] for n in names if n in artists}}
# emblems: new EPIK set + reused KO26 symbols + the ones drawn for this edition
def syms(path):
    return dict(re.findall(r'(?s)(?<=<symbol id="em-)([a-z0-9-]+)(".*?</symbol>)', open(path).read()))
pool = {}
pool.update(syms(os.path.join(ROOT, 'ref', 'symbols_ko.svgfrag')))
pool.update(syms(os.path.join(ROOT, 'ref', 'symbols_epik.svgfrag')))
pool.update(syms(os.path.join(H, 'symbols_new.svgfrag')))
slug = lambda n: re.sub(r'^-+|-+$', '', re.sub(r'[^a-z0-9]+', '-', n.lower()))
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
    print(f"  {n:15s}", 'NO DATA' if not a else f"sets {len(a['sets'])} rel {len(a['released'])} unrel {len(a['unreleased'])} unk {a.get('unknown_ids',0)}")
