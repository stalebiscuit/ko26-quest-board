#!/usr/bin/env python3
"""Turn raw tracklists into the quest-board `artists` shape (same as KO26's data2.json):
  {sets:[{event,date,url}], released:[{artist,title,plays,sets,spotify,confidence?}],
   unreleased:[{artist,title,plays,sets,kind,ref:{label,url},confidence?}], unknown_ids, note?}
Inputs: raw/sets.json (this edition's scrape), ref/ko26-handoff/data/data.json (KO26 raw sets, reused),
        KO26 embedded artists (classification reused where the same track was already classified),
        overrides.json (hand review). Output: artists.json.
Rules follow ref/ko26-handoff/data/data2_report.txt."""
import json, os, re, urllib.parse
H = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(H, '..', '..'))
SITE = os.path.abspath(os.path.join(ROOT, '..'))  # repo root = the served site; ROOT = _kit
RAW = json.load(open(os.path.join(H, 'raw', 'sets.json')))
KO_RAW = json.load(open(os.path.join(ROOT, 'ref', 'ko26-handoff', 'data', 'data.json')))['artists']
s = open(os.path.join(SITE, 'ko26', 'index.html')).read()
KO = json.loads(re.search(r'(?s)<script type="application/json" id="ko-data">(.*?)</script>', s).group(1))['artists']
OV = json.load(open(os.path.join(H, 'overrides.json'))) if os.path.exists(os.path.join(H, 'overrides.json')) else {}

def new(sid): return ('new', sid)
def ko(artist, i): return ('ko', artist, i)
# per act: sets newest first. ('new', id) = scraped for EPIK; ('ko', act, i) = KO26 raw set reused.
PLAN = {
  'Project One': {'sets': [new('kd8shdt'), new('2pbm2xgk'), new('q000z41')]},
  'Code Black': {'sets': [new('2c3p0ggt'), new('1nrrkbp1'), new('2wsrmkl1')], 'note': 'Includes shared sets with Adrenalize and Toneshifterz.'},
  'MISH': {'sets': [new('2t2wzt89'), new('2kn5uw31'), new('1kxxzd99')]},
  'Mutilator': {'sets': [new('2htbr8h9'), new('19lw0hxt'), new('1y21mt8t')]},
  'Noxiouz': {'sets': [ko('Noxiouz', 0), ko('Noxiouz', 1), ko('Noxiouz', 2), new('2uy3j6qk')], 'note': 'Includes shared Dynamite sets. The REBiRTH set is his Catalyst show.'},
  'Phuture Noize': {'sets': [new('1w7bh821'), new('1326g02t'), new('2uxqsxj1')]},
  'Rebelion': {'sets': [new('22s4bjvk'), ko('Rebelion', 0), ko('Rebelion', 1), ko('Rebelion', 2)]},
  'The Saints': {'sets': [new('108yv9xk'), new('116kjrl9'), new('1x4f2uc9')]},
  'Weaver': {'sets': [ko('Weaver', 0), ko('Weaver', 1), ko('Weaver', 2), new('n4k1dxk')], 'note': 'Includes shared b2b sets with Technikore & JTS.'},
  'JTS': {'sets': [new('1lxhx391'), new('1ch21331'), new('1dd92fjk')], 'note': 'Hardcore Evolution is a solo set. The other two are shared with Technikore (Knockout Outdoor) and Klubfiller (Ravelife Radio).'},
}
REUSE = ['Suae']  # no newer tracklists than the KO26 build: copied as-is

def strip_date(t): return re.sub(r'\s+\d{4}-\d{2}-\d{2}$', '', t).strip()
def date_of(t): m = re.search(r'(\d{4}-\d{2}-\d{2})$', t); return m.group(1) if m else ''
def event_of(title, act):
    t = strip_date(title)
    if ' @ ' in t:
        who, ev = t.split(' @ ', 1)
        if who.strip().lower() == act.lower() or who.strip().lower().startswith(act.lower() + ' ('): return ev.strip()
    return t
def load_set(ref, act):
    if ref[0] == 'new':
        r = RAW[ref[1]]
        return {'event': event_of(r['title'], act), 'date': date_of(r['title']), 'url': 'https://1001.tl/' + r['id']}, r['tracks']
    a = KO_RAW[ref[1]]['sets'][ref[2]]
    return {'event': a['event'], 'date': a['date'], 'url': a['url']}, a['tracks']

def norm_artist(a): return ' & '.join(sorted(p.strip().lower() for p in re.split(r'\s+(?:&|and)\s+', a.replace(' ft. ', ' & '))))
def key(artist, title): return norm_artist(artist) + ' - ' + title.strip().lower()
def split(t):
    i = t.find(' - ')
    return (t[:i].strip(), t[i+3:].strip()) if i > 0 else ('', t.strip())

def spotify(artist, title):
    a = re.split(r'\s+ft\.?\s+|\s+feat\.?\s+', artist)[0]
    parts = [p for p in re.split(r'\s+&\s+|\s+x\s+|\s+vs\.?\s+|,\s*', a) if p][:2]
    keep = []
    for m in re.finditer(r'\(([^)]*)\)', title):
        if re.search(r'remix|mix\b|vip', m.group(1), re.I): keep.append(m.group(1))
    base = re.sub(r'\s*\([^)]*\)', '', title)
    q = ' '.join(parts + [base] + keep)
    q = re.sub(r'\bAcappella\b', '', q, flags=re.I)
    q = re.sub(r'[!?()\[\]&/"]', ' ', q)
    q = re.sub(r'\s+', ' ', q).strip()
    return 'https://open.spotify.com/search/' + urllib.parse.quote(q)

def classify(artist, title, act):
    """-> ('released', conf) or ('unreleased', kind, conf). conf: None | 'guess'"""
    t, a, low = title, artist, title.lower()
    act_l = act.lower()
    if re.fullmatch(r'id', t.strip(), re.I) or re.search(r'\(id\b|^id\s*\(', t, re.I) or re.fullmatch(r'id', a.strip(), re.I):
        return ('unreleased', 'ID', None)
    if re.search(r'mash', low) or ' vs. ' in t or re.search(r'\s+x\s+', t) and '(' not in t:
        return ('unreleased', 'mashup', None)
    if ' vs. ' in a:
        if 'remix' in low: return ('released', 'guess')
        return ('unreleased', 'mashup', 'guess')
    if re.search(r'\btool\b|\bintro\b|^outro$', low): return ('unreleased', 'tool', None)
    if re.search(r'live edit|bootleg|exclusive|closing edit|2026 (edit|rework)|b2b|dose\b|dose edit', low):
        return ('unreleased', 'edit', None)
    m = re.search(r'\(([^)]*\b(edit|vip|flip|rework|re-edit|re-fuk|fix)\b[^)]*)\)', t, re.I)
    if m:
        rest = re.sub(r'\b(\d{4}|2k\d\d|live|edit|kick|uptempo|festival|encore|raw|zaag|intro|extended|original|vip|rework|re-edit|flip|closing|special|nightmare|slowtempo|mix|remix)\b', ' ', m.group(1), flags=re.I)
        rest = re.sub(r'[/&,]', ' ', rest).strip()
        by_act = act_l in m.group(1).lower() or (act_l in a.lower() and not rest)
        return ('unreleased', 'edit', None if by_act else 'guess')
    if re.search(r'2026 ost|\b2026\b.*\bost\b', low): return ('unreleased', 'unreleased', 'guess')
    if re.search(r'official .*2026 anthem', low): return ('released', 'guess')
    return ('released', None)

# KO26 classifications, by key, to stay consistent with the shipped KO26 edition
# (same act only: whether an edit is "by the performing act" depends on whose set it is)
KO_CLASS = {}
for act, a in KO.items():
    for it in a['released']: KO_CLASS[(act, key(it['artist'], it['title']))] = ('released', it.get('confidence'))
    for it in a['unreleased']: KO_CLASS[(act, key(it['artist'], it['title']))] = ('unreleased', it['kind'], it.get('confidence'))

def build(act, plan):
    sets, rows = [], []
    for i, ref in enumerate(plan['sets']):
        meta, tracks = load_set(ref, act)
        sets.append(meta)
        rows += [(i, t) for _, t in tracks]
    items, order, unknown = {}, [], 0
    for i, t in rows:
        if re.fullmatch(r'ID\s*-\s*ID', t.strip(), re.I): unknown += 1; continue
        ar, ti = split(t)
        if not ar: ar = 'ID'
        k = key(ar, ti)
        if k not in items:
            items[k] = {'artist': ar, 'title': ti, 'plays': 0, 'sets': []}; order.append(k)
        it = items[k]; it['plays'] += 1
        if i not in it['sets']: it['sets'].append(i)
    rel, unrel = [], []
    for n, k in enumerate(order):
        it = items[k]; it['sets'].sort()
        ov = OV.get(act, {}).get(f"{it['artist']} - {it['title']}") or OV.get('*', {}).get(f"{it['artist']} - {it['title']}")
        c = tuple(ov) if ov else KO_CLASS.get((act, k)) or classify(it['artist'], it['title'], act)
        if c[0] == 'released':
            o = {**it, 'spotify': spotify(it['artist'], it['title'])}
            if c[1]: o['confidence'] = c[1]
            rel.append((n, o))
        else:
            first = it['sets'][0]; s0 = sets[first]
            o = {**it, 'kind': c[1], 'ref': {'label': f"{s0['event']} ({s0['date']})", 'url': s0['url']}}
            if c[2]: o['confidence'] = c[2]
            unrel.append((n, o))
    srt = lambda L: [o for n, o in sorted(L, key=lambda x: (-x[1]['plays'], x[1]['sets'], x[0]))]
    out = {'sets': sets}
    if plan.get('note'): out['note'] = plan['note']
    out.update({'released': srt(rel), 'unreleased': srt(unrel), 'unknown_ids': unknown})
    assert sum(x['plays'] for x in out['released'] + out['unreleased']) + unknown == len(rows), act
    return out

ART = {act: build(act, p) for act, p in PLAN.items()}
for act in REUSE: ART[act] = KO[act]
# acts with no findable recent tracklists: honest empty state (the sheet still lets you add your own songs)
EMPTY = {'Kid Finley': "Couldn't find recent Kid Finley tracklists on 1001Tracklists. Add the songs you're hoping for below.",
         'Villain': "Villain's hosting EPIK. In the last 12 months he's only been on the mic for group sets, so there are no DJ tracklists to pull from. Add the songs you're hoping for below."}
for act, note in EMPTY.items(): ART[act] = {'sets': [], 'note': note, 'released': [], 'unreleased': [], 'unknown_ids': 0}
json.dump(ART, open(os.path.join(H, 'artists.json'), 'w'), ensure_ascii=False, indent=1)
print(f"{'act':15s} sets rows released unreleased unknown")
for act, a in ART.items():
    rows = sum(x['plays'] for x in a['released'] + a['unreleased']) + a['unknown_ids']
    print(f"{act:15s} {len(a['sets']):4d} {rows:4d} {len(a['released']):8d} {len(a['unreleased']):10d} {a['unknown_ids']:7d}")
