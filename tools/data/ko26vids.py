import json,re,urllib.request,urllib.parse,time,unicodedata
H={"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) Chrome/140","Accept-Language":"en","Cookie":"CONSENT=YES+1; SOCS=CAI"}
d=json.load(open('/home/user/ko26-quest-board/data2.json'))
acts=[s['artist'] for s in d['slots'] if not s.get('special')]
norm=lambda t: re.sub(r'[^a-z0-9]+',' ',unicodedata.normalize('NFKD',t).encode('ascii','ignore').decode().lower()).strip()
ALIAS={"Da Mouth of Madness":["mouth of madness","dr peacock"],"D-Block & S-te-Fan":["d block"],"Greazy Texas Fuckerz":["greazy","gtf"],"Technikore & JTS":["technikore","jts"],"Big K":["big k"]}
out={}
for a in acts:
    q=f"{a} knockout outdoor 2026"
    try:
        s=urllib.request.urlopen(urllib.request.Request("https://www.youtube.com/results?search_query="+urllib.parse.quote(q),headers=H),timeout=25).read().decode('utf-8','replace')
    except Exception as e: print(a,'ERR',e); continue
    m=re.search(r'var ytInitialData = (\{.*?\});</script>',s,re.S)
    if not m: print(a,'nodata'); continue
    vids=[]
    def walk(o):
        if isinstance(o,dict):
            if 'videoRenderer' in o:
                v=o['videoRenderer']; vids.append((v['videoId'],''.join(r.get('text','') for r in v['title']['runs']),(v.get('lengthText') or {}).get('simpleText') or '',''.join(r.get('text','') for r in (v.get('ownerText') or {}).get('runs',[]))))
            for x in o.values(): walk(x)
        elif isinstance(o,list):
            for x in o: walk(x)
    walk(json.loads(m.group(1)))
    forms=ALIAS.get(a,[norm(a)])
    best=None
    for vid,t,l,o in vids:
        nt=' '+norm(t)+' '
        if 'knockout' in nt and '2026' in nt and any(' '+f+' ' in nt for f in forms):
            p=[int(x) for x in l.split(':')] if l else [0]
            mins=p[0]*60+p[1] if len(p)==3 else p[0]
            if mins>=15: best={"id":vid,"title":t,"dur":l,"channel":o}; break
    out[a]=best; print(a,'->',best and best['title']); time.sleep(1)
json.dump(out,open('/tmp/claude-0/-home-user-ko26-quest-board/81f8a016-4005-5247-94b8-870ee5511899/scratchpad/ko26_videos.json','w'),indent=1)
