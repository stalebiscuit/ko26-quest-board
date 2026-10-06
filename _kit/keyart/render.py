"""Render the 16:9 key art for each edition.
Setup once in this folder: npm i @fontsource/oswald @fontsource/cinzel @fontsource/silkscreen @fontsource/michroma @fontsource/press-start-2p
Run: python3 render.py  -> writes ../../assets/<name>.png
To add a rave: add a theme branch in gen.html (palette, word, sub-lines, emblem ids), add an emblem pool to a .svgfrag, add it to JOBS below."""
import asyncio, os, threading, functools, http.server, socketserver
from playwright.async_api import async_playwright
H = os.path.dirname(os.path.abspath(__file__))
JOBS = [('knockout', 'knockout-26.png'), ('epik', 'epik-26.png')]
g = open(os.path.join(H, 'gen.html')).read().replace('__KO_SYMS__', open(os.path.join(H, 'symbols_ko.svgfrag')).read()).replace('__EP_SYMS__', open(os.path.join(H, 'symbols_epik.svgfrag')).read())
open(os.path.join(H, 'gen_built.html'), 'w').write(g)
# serve this folder over http: CSS masks don't load from file:// URLs
_srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=H))
threading.Thread(target=_srv.serve_forever, daemon=True).start()
PORT = _srv.server_address[1]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1920, 'height': 1080})
        for t, out in JOBS:
            await pg.goto(f'http://127.0.0.1:{PORT}/gen_built.html?t={t}')
            await pg.wait_for_selector('body[data-ready]'); await pg.wait_for_timeout(500)
            await pg.locator('.art').screenshot(path=os.path.join(H, '..', '..', 'assets', out))
        await b.close()
asyncio.run(main())
