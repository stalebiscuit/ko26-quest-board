# New rave playbook

Every rave gets its own edition: a copy of the last board, re-themed, with the new lineup and fresh artist data. Nothing about the app changes between editions. Only the theme, the lineup/set times, and the artist data do.

## Layout
```
index.html          landing page: one card per rave (EDITIONS list at the bottom)
ko26/index.html     Knockout Outdoor 2026 (timetable mode, done)
epik26/index.html   EPIK 2026 (lineup mode until set times drop)
assets/<code>.png   16:9 key art for each edition (used on the landing card and edition hero)
_kit/               everything needed to build the next one (not linked from the site)
  build/epik26/     the EPIK build: template, lineup, scrape, consolidate, build, screenshots
  keyart/           key art generator (gen.html + render.py)
  ref/              KO26 handoff, data shapes, emblem pools, build notes
  landing.template.html
```
Each edition is one self-contained HTML file. Picks are saved in localStorage under a per-edition prefix (`ko26.*`, `epik26:*`), so editions never clash.

## Two modes
- **Lineup mode** (lineup is out, set times aren't). The board is the lineup poster in code: one clickable tile per act (headliner, alphabetical acts, battles, host). Tiles open the artist sheet. The Player card lists picks in lineup order with set times shown as TBA. Clash checks are off.
- **Timetable mode** (set times are out). This is the KO26 board: stages × times, blocks open the artist sheet, clashes are flagged.

The switch is `"mode": "lineup" | "timetable"` at the top of the edition's data (`_kit/build/<code>/lineup.json`, explained in its `_readme`). Picks carry over when you flip, because they're keyed by artist name.

## When a new lineup drops
1. **Set up the build.** Copy `_kit/build/epik26/` to `_kit/build/<code>/`, for example `ko27`. In `template.html`, change `EDITION` at the top of the script (ns/localStorage prefix, code, name, dates, venue) and the palette tokens in `:root`. Pull the palette from the rave's own marketing: the lineup poster on @eventshsu and the event page on hsuevents.com.
2. **Lineup.** Save HSU's official lineup poster to `assets/<code>-lineup.jpg`, with Scott's OK to download it. Write `lineup.json`: `mode:"lineup"`, `poster:{src,w,h,alt}`, then one slot per act in poster order. Each slot gets `box:[x,y,w,h]` in poster pixels (the clickable block over that act's logo), plus `row` (head | alpha | battle | host), `vs` for battles and `tag` for show names. Acts that share one logo on the poster share one block, like Rebelion + MWI. Don't change the poster's layout or order. Without `poster`, the board falls back to built tiles.
3. **Emblems.** Reuse an act's existing emblem if it has one (`_kit/ref/symbols_*.svgfrag`, `build/*/symbols_new.svgfrag`). For new acts, draw new originals in the same style: 64×64, `stroke=currentColor`, accent shapes `class="a"`. Never copy real artist logos.
4. **Artist data.** Scrape 1001Tracklists in the built-in browser. The container can't reach it. If Cloudflare asks you to verify, Scott ticks the box himself. Take 3–4 sets per act from the last 12 months and keep the total to about 40 page loads. Paste them into `raw/sets_*.txt`, then run `parse_raw.py` and `consolidate.py`. Acts already on an earlier board reuse that data, refreshed with newer sets. Never invent tracks. Acts with nothing found get an honest empty state. Full details and DOM selectors are in `_kit/ref/EPIK_BUILD_NOTES.md`.
5. **Build and check.** Run `build.py` (it writes `/<code>/index.html` and validates the JSON), then `shots.py` (desktop and phone screenshots, console errors, overflow). Look at the screenshots.
6. **Key art.** Use the event's own logo file, downloaded from hsuevents.com with Scott's OK, saved in `assets/` and copied into `_kit/keyart/`. Build the background in HSU's own campaign style for that event: EPIK is near-black with grainy red smoke and a glowing red mark, KO26 is near-black with violet haze, light from above and particles. Add a boxed date line. Add a theme to `_kit/keyart/gen.html` and run `render.py`. No generated photos, no act icons, and never redraw a logo by hand.
7. **Landing.** Add a line to `EDITIONS` in `index.html` (newest first), and update the old edition's status chip.

## When the set times drop
In `lineup.json`, set `mode:"timetable"`, fill `stages{}`, and give each slot its stage/start/end from HSU's official timetable. Then rerun `build.py` and `shots.py`. That's the whole change.

## Rules that carry across editions
- Copy tone: casual, lowercase-leaning, no emoji.
- No HSU, Knockout or EPIK official logos, and no Hound wordmark. Emblems and key art are original.
- It has to work on a phone at the rave: 16px gutters and no sideways scroll.
- Credits line in each edition: HSU for times and lineup, 1001Tracklists for tracklists, Deezer for previews.
