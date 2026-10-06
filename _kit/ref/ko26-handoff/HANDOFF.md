# KO26 Quest Board: handoff

Daniel's personal planner for **Knockout Outdoor 2026, "Level Up"**: Sat 3 Oct 2026, ENGIE Stadium, Sydney Showground, run by HSU Events. Daniel is @danielhdmn on TikTok ("Chef"), a hardstyle kickroll dancer.

The live version (v1) is a Claude artifact: https://claude.ai/artifact/Mxiv8Xpzh3Wuw2XMNzT7bK

## What the app does
- **Quest board:** the official set-times poster recreated in code. It has three stages (The Arena / Main Stage, The Megapit / Raw + Core, The Oasis / Happy + Hard), purple blocks, the Get Wrecked and BKJN banners, and "hosted by" under each stage. Tap a block to open that artist. The **+** in the corner adds the set to your run, and clashes are flagged.
- **Artist sheet:** the act's recent sets (Oct 2025 to Sep 2026) from 1001Tracklists. Tap **KR** on a song to mark it as one you'll kick roll to. You can also add your own songs.
- **Player card:** the sets you picked, in time order, with your KR songs under each. It has a Copy card button. State is saved in localStorage.

Daniel likes the Quest board and the Player card as they are.

## Files in this bundle
- `template.html`: the current page as a body fragment (no doctype; the artifact publisher adds the skeleton). Data is injected by replacing the literal `/*DATA*/null`, which appears once.
- `published_v1.html`: template.html with data.json injected, exactly what is live as the artifact.
- `data/slots.json`: all 40 timetable slots, verified against the official HSU image.
- `data/data.json`: `{slots, artists:{Name:{note?, sets:[{event,date,url,tracks:[[num,"Artist - Title"]]}]}}}`. Track num is "01".. or "w/" (played together with the previous track). "ID - ID" means unidentified.
- `data/data2.json`: the same acts with tracks consolidated per artist:
  - `released[]`: `{artist, title, plays, sets, spotify}`, where `spotify` is a search URL.
  - `unreleased[]`: `{artist, title, plays, sets, kind, ref:{label, url}}`. `kind` is ID, edit, tool, mashup or unreleased. `ref` is the 1001Tracklists set it was heard in.
  - `unknown_ids`: a count of fully anonymous IDs.
  - An optional `confidence:"guess"` on either list.
  - `data/data2_report.txt` explains the classification.
- `art/<slug>.svg`: 34 original emblems, one per act. They are 64×64, `stroke=currentColor`, and accent shapes have `class="a"`. Colour accents with CSS `color` (for example `.a{color:#FFC85A}`), not `stroke`. `art/notes_a.json` and `art/notes_b.json` hold the motif notes. These are not yet wired into the page.
- `logos/logo_opt1..4.svg` and `logos/logo_options.png`: 4 new header logos. All keep the spiked crescent sides and none has the knife. They are 400×150 viewBox, the same as the current emblem. Daniel hasn't picked one yet.

## Data gaps
- No recent sets were found for D-Block & S-te-Fan, Noisemakers, Major Conspiracy or Da Mouth of Madness. The last one is a Dr. Peacock tribute.
- GTF (GPF vs Lil Texas) uses GPF's and Lil Texas's own sets.
- One 105-track Darren Styles / Gammer b2b set was left out.

## Design system
- **Page chrome:** near-black #0A0A0B, warm panels #16110A and #1A1206, cream text #F4ECD8, gold #C9A84C (highlight #FFC85A), blood red #A3271A, muted #9A8F74.
- **Poster:** purple blocks (#4a1f8a to #5b26a6) inside a violet neon frame.
- **Fonts:** Pirata One for big words only, Cinzel for UI labels, Oswald for artist names and times, Silkscreen for tiny badges, IBM Plex Sans for body text.
- **Copy:** casual, lowercase-leaning, no emoji.
- **Brand rules:** no Hound wordmark and no Knockout/HSU logos. Emblems are original, not copies of artists' real logos.

## Pending changes Daniel asked for
1. Header: remove "kickroll merchant" and "with Hound". Swap the knife emblem for his chosen logo option.
2. Put the artist emblems into the timetable blocks so they aren't plain purple. All emblems use the same colours so the poster flows. Also show the emblem large in the artist sheet.
3. Redesign the artist sheet, which feels clunky. Use tabs: **Released** (consolidated rows with play and Spotify), **Unreleased & IDs** (each with a "heard at <set>" link to 1001Tracklists), and **Sets**.
4. Make it a **GitHub repo / GitHub Pages site** so released songs can be played inside the app. Claude artifacts block embedded players.
   - Spotify embeds need track IDs, which need the Spotify API and a developer app.
   - Deezer's public JSONP search gives 30-second previews with no key, so it's a workable option on Pages.
