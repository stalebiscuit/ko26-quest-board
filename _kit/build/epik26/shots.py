#!/usr/bin/env python3
"""Render site/epik26/index.html with Playwright at desktop + phone, screenshot the main flows,
and report console errors. Google Fonts are served from ref/node_modules/@fontsource (offline container).
Usage: python3 -I shots.py [page.html] [outdir]"""
import os, sys, json
from playwright.sync_api import sync_playwright
H = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(H, '..', '..'))
SITE = os.path.abspath(os.path.join(ROOT, '..'))  # repo root = the served site; ROOT = _kit
PAGE = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(SITE, 'epik26', 'index.html')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'shots', 'epik')
FS = os.path.join(ROOT, 'ref', 'node_modules', '@fontsource')
FACES = [('Pirata One','pirata-one',400),('Michroma','michroma',400),('Cinzel','cinzel',500),('Cinzel','cinzel',700),
         ('Oswald','oswald',400),('Oswald','oswald',500),('Oswald','oswald',600),('Oswald','oswald',700),
         ('IBM Plex Sans','ibm-plex-sans',400),('IBM Plex Sans','ibm-plex-sans',500),('IBM Plex Sans','ibm-plex-sans',600),('Silkscreen','silkscreen',400)]
CSS = ''.join(f"@font-face{{font-family:'{f}';font-weight:{w};font-display:block;src:url(https://fonts.local/{d}/files/{d}-latin-{w}-normal.woff2) format('woff2')}}" for f,d,w in FACES)
def route(r):
    u = r.request.url
    if 'fonts.googleapis.com' in u: return r.fulfill(status=200, content_type='text/css', body=CSS)
    if u.startswith('https://fonts.local/'):
        p = os.path.join(FS, u[len('https://fonts.local/'):])
        return r.fulfill(status=200, content_type='font/woff2', body=open(p,'rb').read()) if os.path.exists(p) else r.fulfill(status=404)
    if u.startswith('file://'): return r.continue_()
    return r.abort()
SHEETS = sys.argv[3].split(',') if len(sys.argv) > 3 else ['Rebelion','Project One','JTS','Kid Finley']
errs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, vp, mob in [('desk', {'width':1280,'height':900}, False), ('phone', {'width':390,'height':844}, True)]:
        ctx = b.new_context(viewport=vp, device_scale_factor=1 if not mob else 2, is_mobile=mob, has_touch=mob)
        pg = ctx.new_page(); pg.route('**/*', route)
        pg.on('console', lambda m, n=name: m.type == 'error' and errs.append(f'{n}: {m.text}'))
        pg.on('pageerror', lambda e, n=name: errs.append(f'{n}: pageerror {e}'))
        pg.goto('file://' + PAGE); pg.evaluate('document.fonts.ready'); pg.wait_for_timeout(400)
        sw = pg.evaluate('document.documentElement.scrollWidth')
        if sw > vp['width']: errs.append(f'{name}: horizontal overflow scrollWidth={sw}')
        pg.screenshot(path=f'{OUT}/{name}-01-board.png', full_page=True)
        for i, a in enumerate(SHEETS):
            pg.click(f'[data-open="{a}"]')
            pg.wait_for_timeout(250)
            for m in ['rel','unrel','sets']:
                if pg.query_selector(f'[data-mode="{m}"]'):
                    pg.click(f'[data-mode="{m}"]'); pg.wait_for_timeout(150)
                pg.screenshot(path=f'{OUT}/{name}-sheet{i+1}-{a.lower().replace(" ","-")}-{m}.png')
                if not pg.query_selector('[data-mode]'): break
            if i == 0:
                pg.click('#sheet [data-pick]'); pg.wait_for_timeout(150)
                kb = pg.query_selector_all('#sheet [data-mode="rel"]')
                if kb: pg.click('#sheet [data-mode="rel"]')
                for k in pg.query_selector_all('#sheet .krb')[:2]: k.click()
            pg.click('#closeSheet'); pg.wait_for_timeout(150)
        kf = pg.query_selector('[data-pick="Kid Finley"]') or pg.query_selector_all('.blk:not(.picked) [data-pick]')[0]
        kf.click(); pg.wait_for_timeout(150)
        pg.screenshot(path=f'{OUT}/{name}-02-board-picked.png', full_page=True)
        pg.click('#tab-card'); pg.wait_for_timeout(200)
        pg.screenshot(path=f'{OUT}/{name}-03-player-card.png', full_page=True)
        ls = pg.evaluate('Object.keys(localStorage)')
        print(name, 'localStorage keys:', ls)
        ctx.close()
    b.close()
print('console errors:', json.dumps(errs, indent=1) if errs else 'none')
