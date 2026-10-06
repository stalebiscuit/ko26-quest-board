#!/usr/bin/env python3
"""Parse raw/sets_*.txt (tracklists copied out of the 1001Tracklists pages) into raw/sets.json,
and print a per-set hash that must match the in-browser hash (transcription check)."""
import glob, json, os, re
H = os.path.dirname(os.path.abspath(__file__))
sets = {}
for f in sorted(glob.glob(os.path.join(H, 'raw', 'sets_*.txt'))):
    cur = None
    for line in open(f, encoding='utf-8').read().split('\n'):
        if line.startswith('## '):
            sid, title = line[3:].split(' | ', 1)
            cur = sets[sid] = {'id': sid, 'title': title, 'tracks': []}
        elif line.strip():
            n, t = line.split('\t', 1)
            cur['tracks'].append([n, t])
def h(s):
    x = 0
    for c in s: x = (x * 31 + ord(c)) & 0xffffffff
    return x
for sid, s in sets.items():
    print(sid, h(s['title'] + '\n' + '\n'.join(a + '\t' + b for a, b in s['tracks'])))
json.dump(sets, open(os.path.join(H, 'raw', 'sets.json'), 'w'), ensure_ascii=False, indent=1)
