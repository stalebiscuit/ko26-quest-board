# EPIK 2026 quest board: build notes (per-rave steps actually followed)

Output: `site/epik26/index.html` (single self-contained file, about 216 KB). KO26 (`site/ko26/index.html`) was not touched (byte-identical to `ref/ko26-original-index.html`).

Build folder: `build/epik26/`
- `template.html`: KO26 page with the emblem `<symbol>` block replaced by `<!--EMBLEMS-->` and the JSON replaced by `/*DATA*/`, then re-themed and given the lineup mode. Copy this for the next rave.
- `lineup.json`: `mode`, `_readme` (documents the switch), `stages`, `slots` (one per act, lineup order, `row` = head | alpha | battle | host, `vs` pairs battles, `tag` for show names).
- `raw/sets_*.txt`: tracklists copied from 1001Tracklists. `parse_raw.py` turns them into `raw/sets.json` and prints a per-set hash.
- `consolidate.py`: raw sets plus KO26 raw sets go into `artists.json` (same shape as KO26's data2.json). The `PLAN` dict picks the sets for each act, `REUSE` copies KO26 acts unchanged, `EMPTY` gives honest empty states, and `overrides.json` holds the hand fixes.
- `symbols_new.svgfrag`: new emblems (JTS, Villain).
- `build.py`: puts the template, emblems (ko + epik + new pools, chosen by slug) and data together into `site/epik26/index.html`, then checks the embedded JSON parses and prints coverage.
- `shots.py`: Playwright screenshots at 1280x900 and 390x844 (Google Fonts are served from `ref/node_modules/@fontsource` because the container is offline). It opens sheets and clicks every tab, adds a pick, KRs two songs, shows the player card, and reports console errors, horizontal overflow and localStorage keys.

Run order: `python3 -I parse_raw.py && python3 -I consolidate.py && python3 -I build.py && python3 -I shots.py`

## Steps

1. **Read KO26.** Read the CSS tokens, the emblem symbols, the script and the `ko-data` JSON. The embedded data is `{slots, artists}`, and each artist has `sets[{event,date,url}]`, `released`, `unreleased`, `unknown_ids` and an optional `note` (no raw tracks). KO26 localStorage keys: `ko26.picks`, `ko26.kr`, `ko26.custom`, `ko26.view`.
2. **Template.** Copy KO26 into `template.html` with the placeholders.
   - Swap the palette tokens. Variable names are kept, so the shared code is untouched.
   - Add Michroma to the Google Fonts link.
   - Add the hero (`../assets/epik-26.png`), the "← all raves" link and the eyebrow.
   - Move edition specifics into `EDITION` at the top of the script: ns, code, name, day, dates, venue, card title.
   - Stages now come from `data.stages`, with N stages and colours supported.
3. **Lineup / timetable switch.** `data.mode` is "lineup" or "timetable". If it is missing, the board becomes a timetable once any slot has start/end.
   - Lineup mode renders the poster tiles. Clashes are off. The HUD and the card show "TBA". The card lists acts in lineup order.
   - The timetable code is KO26's, generalised to any number of stages.
   - Pick IDs are the artist name in lineup mode and `stage:artist` in timetable mode. A migration step re-keys stored picks by artist name, so picks survive the flip.
   - Tested by flipping a copy to timetable with fake stages and times: it rendered, picks carried over, and there were no errors.
4. **Scraping 1001Tracklists.** WebFetch returns 403 and the container proxy blocks the site. Use the built-in browser on Scott's computer instead.
   - On the first visit Cloudflare showed a "Verify you are human" checkbox. I didn't tick it; I asked Scott to (SendUserMessage) and waited about 15 minutes until it cleared.
   - Artist list: `/dj/<slug>/index.html` redirects to `/artist/<slug>/tracklists.html`. A small JS lister reads `.bItm` rows (date, IDed count, title, href).
   - Tracklist pages: each `.tlpItem` row gives the number from `[id$=_tracknumber_value]` (blank means `w/`) and the text from `.trackValue` plus `.trackEditData`. Use `.trackEditData` because the mix/edit name lives there; `meta[itemprop=name]` drops it.
   - Short link: build `https://1001.tl/<id>` from the path. Don't regex the page, because it has other 1001.tl links.
   - Batch navigate+extract with `browser_batch`. Keep results in localStorage on the 1001 origin (helpers saved in localStorage and `eval`ed per page).
   - Copy the results across in roughly 9 KB chunks and write them to `raw/sets_*.txt`. Then compare the JS hash (`h=h*31+charCode`, uint32) per set against `parse_raw.py`. All 24 sets matched.
   - After about 40 page loads the site falls back to the "Please wait, you will be forwarded" interstitial (rate limit or re-challenge). Do the artist lists first and keep it to 3 or 4 sets per act.
   - Remove the helper localStorage keys afterwards.
5. **Choosing sets.** Take the 3 most recent sets from Oct 2025 onward, and prefer:
   - solo sets
   - the show they're billed with at this rave (Mutilator Rave Reactor, Noxiouz The Catalyst)
   - Sydney or HSU sets (MISH @ EPIK 2025, The Saints @ Midnight Mafia, Rebelion @ KO26 Level Up)

   Refreshed acts merge their KO26 raw sets (`ref/ko26-handoff/data/data.json`) with the newer sets.
6. **Consolidate.** Follow the `data2_report.txt` rules.
   - KO26 classifications are reused only for the same act. Whether an edit is by the performing act depends on whose set it is.
   - Spotify search URL: first 2 artists, base title, and any Remix/Mix/VIP parentheticals.
   - Ordering: plays descending, then the set list, then first appearance.
   - Validation: plays plus unknown_ids must equal the number of rows.
7. **Emblems.** `build.py` picks a symbol by slug from: the KO pool (rebelion, noxiouz, suae, weaver), `symbols_epik.svgfrag` (7 acts) and `symbols_new.svgfrag` (jts = BPM gauge in the red zone, villain = mic with horns and forked tail). All are original artwork.
8. **Previews.** Copied unchanged from KO26: Deezer public search via JSONP at runtime, 30-second previews, with a Spotify search link for the full track. In the offline container Deezer fails, so the page switches to the `dz-off` caption, as designed.

## Gotchas
- `_readme` in the JSON is the "comment" (JSON can't hold comments). There's also an explanatory comment beside `EDITION`.
- The phone tab bar is `position:fixed`, so full-page phone screenshots show it partway down the page. That's a screenshot artefact.
- 1001 counts in the list ("21/24") are IDed/total rows, and `w/` rows count as tracks.
- Villain only appears in the last 12 months as MC on group sets (KO Special Event 2026-10-04, Tweeka-TV). With no DJ sets, the host tile is non-clickable (`isFlat`).
- Kid Finley: neither `/dj/kidfinley/` nor `/artist/kid-finley/` resolved, and the site was rate-limiting by then. The POST-only search wasn't used. Web search found nothing. So the act has an empty-state note, and this is worth a re-check.
